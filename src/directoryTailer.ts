/**
 * FABRIC Directory Tailer
 *
 * Watches a directory for *.jsonl files and tails a bounded active set of
 * them (LRU, capped at maxActiveFiles).  Inactive files are tracked but not
 * watched; when their mtime changes they are re-opened from the last saved
 * byte position.  This keeps file-descriptor and heap usage O(maxActiveFiles)
 * regardless of how many total *.jsonl files exist in the directory.
 *
 * Memory / fd ceiling (documented contract):
 *   - Open inotify watches  ≤  maxActiveFiles + 1  (1 for the dir watcher)
 *   - Heap per active tailer ≈  1–5 KB  (FSWatcher + EventEmitter + buffers)
 *   - fileInfo Map entries  =  total discovered *.jsonl count  (~200 B each)
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { LogTailer, TailerEvents } from './tailer.js';
import { EventDeduplicator } from './normalizer.js';

export interface DirectoryTailerOptions {
  /** Directory to watch for *.jsonl files */
  directory: string;

  /** Shared deduplicator for cross-source dedup. */
  deduplicator?: EventDeduplicator;

  /**
   * Maximum number of concurrently open file watchers.
   * LRU eviction kicks in when the active set would exceed this.
   * Default: 200.
   */
  maxActiveFiles?: number;

  /**
   * At startup, only activate files whose mtime is within this many
   * milliseconds of now.  Older files are registered in fileInfo but left
   * inactive until their mtime changes.  Default: 86_400_000 (24 h).
   */
  recentMtimeMs?: number;

  /**
   * How often (ms) the inactive-file poll runs to detect mtime changes.
   * Default: 30_000 (30 s).
   */
  inactiveCheckIntervalMs?: number;

  /**
   * Process RSS bytes threshold above which new activations are skipped
   * (back-pressure).  The LRU eviction path still runs so that the most
   * recently used file can displace a stale one.  Default: 400 MB.
   */
  maxRssBytes?: number;
}

interface FileInfo {
  /** Last observed mtime (ms since epoch). */
  mtime: number;
  /** Byte offset of the last confirmed read — used to resume after eviction. */
  position: number;
  /** Wall-clock ms of the last 'event' emitted from this file. */
  lastActivity: number;
}

export class DirectoryTailer extends EventEmitter {
  private directory: string;
  private deduplicator?: EventDeduplicator;
  private maxActiveFiles: number;
  private recentMtimeMs: number;
  private inactiveCheckIntervalMs: number;
  private maxRssBytes: number;

  /** Metadata for every discovered *.jsonl file (active and inactive). */
  private fileInfo: Map<string, FileInfo> = new Map();
  /** Currently open tailers (subset of fileInfo, size ≤ maxActiveFiles). */
  private children: Map<string, LogTailer> = new Map();

  private dirWatcher?: fs.FSWatcher;
  private pollInterval?: ReturnType<typeof setInterval>;
  private stopped: boolean = false;

  constructor(options: DirectoryTailerOptions) {
    super();
    this.directory = options.directory;
    this.deduplicator = options.deduplicator;
    this.maxActiveFiles = options.maxActiveFiles ?? 200;
    this.recentMtimeMs = options.recentMtimeMs ?? 86_400_000;
    this.inactiveCheckIntervalMs = options.inactiveCheckIntervalMs ?? 30_000;
    this.maxRssBytes = options.maxRssBytes ?? 400 * 1024 * 1024;
  }

  start(): void {
    if (!fs.existsSync(this.directory)) {
      this.emit('error', new Error(`Directory not found: ${this.directory}`));
      return;
    }

    const now = Date.now();
    const candidates: Array<{ fullPath: string; mtime: number; size: number }> = [];

    for (const entry of fs.readdirSync(this.directory)) {
      if (!entry.endsWith('.jsonl')) continue;
      const fullPath = path.join(this.directory, entry);
      try {
        const stat = fs.statSync(fullPath);
        // Register all files; position = stat.size so initial activation
        // starts from the current end (don't re-emit historical events).
        this.fileInfo.set(fullPath, {
          mtime: stat.mtimeMs,
          position: stat.size,
          lastActivity: 0,
        });
        if (now - stat.mtimeMs <= this.recentMtimeMs) {
          candidates.push({ fullPath, mtime: stat.mtimeMs, size: stat.size });
        }
      } catch {
        // Skip files we cannot stat (race with deletion, permissions, etc.)
      }
    }

    // Activate the most recently modified files first, up to the cap.
    candidates.sort((a, b) => b.mtime - a.mtime);
    for (let i = 0; i < Math.min(candidates.length, this.maxActiveFiles); i++) {
      this.activateFile(candidates[i].fullPath);
    }

    // Watch for new files appearing in the directory.
    this.dirWatcher = fs.watch(this.directory, (eventType, filename) => {
      if (this.stopped) return;
      if (!filename || !filename.endsWith('.jsonl')) return;
      if (eventType !== 'rename') return;

      const fullPath = path.join(this.directory, filename);
      // Small delay — the file may not be fully created yet.
      setTimeout(() => {
        if (this.stopped) return;
        if (!fs.existsSync(fullPath)) return;
        if (this.children.has(fullPath)) return;
        try {
          const stat = fs.statSync(fullPath);
          if (!this.fileInfo.has(fullPath)) {
            // Brand-new file: start reading from byte 0 so we capture all content.
            this.fileInfo.set(fullPath, {
              mtime: stat.mtimeMs,
              position: 0,
              lastActivity: 0,
            });
          }
        } catch {
          return;
        }
        this.activateWithEviction(fullPath);
      }, 50);
    });

    this.dirWatcher.on('error', (err) => this.emit('error', err));

    // Periodically check inactive files for mtime changes.
    this.pollInterval = setInterval(
      () => this.pollInactiveFiles(),
      this.inactiveCheckIntervalMs,
    );
  }

  stop(): void {
    this.stopped = true;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
    if (this.dirWatcher) {
      this.dirWatcher.close();
      this.dirWatcher = undefined;
    }
    for (const tailer of this.children.values()) {
      tailer.stop();
    }
    this.children.clear();
    this.emit('end');
  }

  get isActive(): boolean {
    return !this.stopped;
  }

  /** Paths of files with an open watcher right now. */
  get activeFiles(): string[] {
    return [...this.children.keys()];
  }

  /** Total number of *.jsonl files discovered (active + inactive). */
  get knownFileCount(): number {
    return this.fileInfo.size;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private activateFile(filePath: string): void {
    if (this.children.has(filePath)) return;

    const info = this.fileInfo.get(filePath);

    const tailer = new LogTailer({
      path: filePath,
      follow: true,
      lines: 0,
      deduplicator: this.deduplicator,
      // info.position drives the start offset:
      //   • stat.size  → initial activation, starts at EOF (no history replayed)
      //   • 0          → new hot-added file, reads all existing content
      //   • savedPos   → re-activation after eviction, resumes from checkpoint
      startPosition: info?.position,
    });

    tailer.on('line', (line: string) => this.emit('line', line, filePath));
    tailer.on('event', (event) => {
      const fi = this.fileInfo.get(filePath);
      if (fi) fi.lastActivity = Date.now();
      this.emit('event', event, filePath);
    });
    tailer.on('error', (err: Error) => this.emit('error', err));

    this.children.set(filePath, tailer);
    tailer.start();
  }

  /**
   * Activate a file, evicting the least-recently-active tailer first if the
   * active set is at capacity.  Also applies RSS back-pressure.
   */
  private activateWithEviction(filePath: string): void {
    if (this.children.has(filePath)) return;

    // RSS back-pressure: if memory is tight and we're already at the cap, only
    // proceed by evicting an existing tailer (don't grow the set further).
    const underMemPressure = process.memoryUsage().rss > this.maxRssBytes;
    if (underMemPressure && this.children.size >= this.maxActiveFiles) {
      this.evictLRU();
    } else if (!underMemPressure && this.children.size >= this.maxActiveFiles) {
      this.evictLRU();
    } else if (underMemPressure) {
      // Memory pressure but still room in active set — skip activation.
      return;
    }

    this.activateFile(filePath);
  }

  /**
   * Save the current read position of the least-recently-active tailer, stop
   * it, and remove it from the active set so a new file can take its slot.
   */
  private evictLRU(): void {
    let lruPath: string | undefined;
    let lruTime = Infinity;

    for (const filePath of this.children.keys()) {
      const info = this.fileInfo.get(filePath);
      const lastActivity = info?.lastActivity ?? 0;
      if (lastActivity < lruTime) {
        lruTime = lastActivity;
        lruPath = filePath;
      }
    }

    if (!lruPath) return;

    const tailer = this.children.get(lruPath);
    if (tailer) {
      const info = this.fileInfo.get(lruPath);
      if (info) info.position = tailer.currentPosition;
      tailer.stop();
      this.children.delete(lruPath);
    }
  }

  /**
   * Iterate inactive files and re-activate any whose mtime has advanced since
   * we last observed it.  Also evicts under memory pressure.
   */
  private pollInactiveFiles(): void {
    if (this.stopped) return;

    // Opportunistic eviction when RSS is high.
    if (process.memoryUsage().rss > this.maxRssBytes && this.children.size > 0) {
      this.evictLRU();
    }

    for (const [filePath, info] of this.fileInfo) {
      if (this.children.has(filePath)) continue;

      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs > info.mtime) {
          info.mtime = stat.mtimeMs;
          if (this.children.size >= this.maxActiveFiles) {
            this.evictLRU();
          }
          if (this.children.size < this.maxActiveFiles) {
            this.activateFile(filePath);
          }
        }
      } catch {
        // File was deleted — remove from tracking.
        this.fileInfo.delete(filePath);
      }
    }
  }
}
