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
import { applyLimitForLogFile } from './workerMemoryLimiter.js';

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
   * Maximum number of inactive fileInfo entries examined per poll tick.
   * Keeps each tick's work bounded no matter how large fileInfo grows (e.g.
   * when the log pruner is broken and files pile up) — a full sweep is
   * spread round-robin across as many ticks as it takes instead of statting
   * every known file synchronously in one go.  Default: 2_000.
   */
  pollBatchSize?: number;

  /**
   * Maximum number of concurrent fs.stat calls in flight while processing a
   * poll batch.  Default: 64.
   */
  pollConcurrency?: number;

  /**
   * Process RSS bytes threshold above which new activations are skipped
   * (back-pressure).  The LRU eviction path still runs so that the most
   * recently used file can displace a stale one.  Default: 400 MB.
   */
  maxRssBytes?: number;

  /**
   * Files modified within this window of now are read from position 0 on
   * startup (replay history). Older files start at EOF (no replay).
   * Default: 4 hours. Set to Infinity to read all files from the beginning.
   */
  startupRereadMs?: number;
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
  private pollBatchSize: number;
  private pollConcurrency: number;
  private maxRssBytes: number;
  private startupRereadMs: number;

  /** Metadata for every discovered *.jsonl file (active and inactive). */
  private fileInfo: Map<string, FileInfo> = new Map();
  /** Currently open tailers (subset of fileInfo, size ≤ maxActiveFiles). */
  private children: Map<string, LogTailer> = new Map();

  private dirWatcher?: fs.FSWatcher;
  private pollInterval?: ReturnType<typeof setInterval>;
  private stopped: boolean = false;

  /** Round-robin cursor into fileInfo so a poll batch resumes where the last one left off. */
  private pollCursor?: IterableIterator<[string, FileInfo]>;
  /** True while a poll batch's async stat calls are in flight (prevents overlapping ticks). */
  private polling: boolean = false;

  constructor(options: DirectoryTailerOptions) {
    super();
    this.directory = options.directory;
    this.deduplicator = options.deduplicator;
    this.maxActiveFiles = options.maxActiveFiles ?? 200;
    this.recentMtimeMs = options.recentMtimeMs ?? 86_400_000;
    this.inactiveCheckIntervalMs = options.inactiveCheckIntervalMs ?? 30_000;
    this.pollBatchSize = options.pollBatchSize ?? 2_000;
    this.pollConcurrency = options.pollConcurrency ?? 64;
    this.maxRssBytes = options.maxRssBytes ?? 400 * 1024 * 1024;
    this.startupRereadMs = options.startupRereadMs ?? 4 * 60 * 60 * 1000; // Default: 4 hours
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
        // Files modified within startupRereadMs window are read from the start on startup so
        // FABRIC can reconstruct current worker state after a restart. Use startupRereadMs
        // option (configurable, default 4 hours) instead of hardcoded value.
        const isRecent = now - stat.mtimeMs <= this.startupRereadMs;
        // Recent files: read from the beginning so state is reconstructed.
        // Old files: start at EOF — don't replay ancient history on restart.
        this.fileInfo.set(fullPath, {
          mtime: stat.mtimeMs,
          position: isRecent ? 0 : stat.size,
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
    this.pollCursor = undefined;
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

    // Apply memory limit to needle worker when activating its log file
    const fileName = path.basename(filePath);
    applyLimitForLogFile(fileName);
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
   * Iterate a bounded batch of inactive files and re-activate any whose
   * mtime has advanced since we last observed it.  Also evicts under memory
   * pressure.
   *
   * This is deliberately non-blocking and bounded per tick:
   *   - Stats are issued via fs.promises.stat (libuv threadpool), never
   *     fs.statSync, so this can never park Node's single JS thread no
   *     matter how large fileInfo grows.
   *   - Only up to pollBatchSize entries are examined per tick, round-robin
   *     via pollCursor, so a fileInfo map with hundreds of thousands of
   *     entries (e.g. because the log pruner is broken and files are
   *     piling up, see bf-18ib2) still costs a bounded amount of work per
   *     tick — a full sweep just spans more ticks instead of blowing the
   *     event loop budget for one of them.
   *   - Concurrency within a batch is capped (pollConcurrency) so we don't
   *     flood the libuv threadpool and starve other fs work (active
   *     tailers, prune, etc).
   *   - Files that no longer exist (e.g. archived + deleted by
   *     fabric-prune.service) are dropped from fileInfo as soon as this
   *     poll notices the ENOENT — this is what keeps fileInfo bounded again
   *     once pruning is actually working, instead of only ever growing.
   */
  private pollInactiveFiles(): void {
    if (this.stopped || this.polling) return;

    // Opportunistic eviction when RSS is high (cheap — no syscalls).
    if (process.memoryUsage().rss > this.maxRssBytes && this.children.size > 0) {
      this.evictLRU();
    }

    this.polling = true;
    this.runPollBatch().finally(() => {
      this.polling = false;
    });
  }

  /** Process up to pollBatchSize inactive entries, resuming from pollCursor. */
  private async runPollBatch(): Promise<void> {
    if (!this.pollCursor) {
      this.pollCursor = this.fileInfo.entries();
    }

    const batch: Array<[string, FileInfo]> = [];
    let next = this.pollCursor.next();
    while (!next.done) {
      const [filePath] = next.value;
      // Active files don't need stat-ing — skip without counting against
      // the batch size cap (there are at most maxActiveFiles of these).
      if (!this.children.has(filePath)) {
        batch.push(next.value);
        if (batch.length >= this.pollBatchSize) break;
      }
      next = this.pollCursor.next();
    }

    // Reached the end of the map — next tick starts a fresh sweep.
    if (next.done) {
      this.pollCursor = undefined;
    }

    for (let i = 0; i < batch.length; i += this.pollConcurrency) {
      if (this.stopped) return;
      const chunk = batch.slice(i, i + this.pollConcurrency);
      await Promise.all(chunk.map(([filePath, info]) => this.checkInactiveFile(filePath, info)));
    }
  }

  /** Stat one inactive file asynchronously and re-activate/forget it as needed. */
  private async checkInactiveFile(filePath: string, info: FileInfo): Promise<void> {
    if (this.stopped) return;
    try {
      const stat = await fs.promises.stat(filePath);
      if (this.stopped) return;
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
      // File is gone (deleted directly, or archived+deleted by the log
      // pruner) — stop tracking it so fileInfo shrinks back down instead of
      // growing forever regardless of whether pruning is currently working.
      this.fileInfo.delete(filePath);
    }
  }
}
