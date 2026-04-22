/**
 * FABRIC Directory Tailer
 *
 * Watches a directory for *.jsonl files, spawning a LogTailer per file.
 * Hot-adds new *.jsonl files via fs.watch rename events.
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
}

export class DirectoryTailer extends EventEmitter {
  private directory: string;
  private deduplicator?: EventDeduplicator;
  private children: Map<string, LogTailer> = new Map();
  private dirWatcher?: fs.FSWatcher;
  private stopped: boolean = false;

  constructor(options: DirectoryTailerOptions) {
    super();
    this.directory = options.directory;
    this.deduplicator = options.deduplicator;
  }

  start(): void {
    if (!fs.existsSync(this.directory)) {
      this.emit('error', new Error(`Directory not found: ${this.directory}`));
      return;
    }

    // Spawn tailers for existing *.jsonl files
    const entries = fs.readdirSync(this.directory);
    for (const entry of entries) {
      if (entry.endsWith('.jsonl')) {
        this.spawnTailer(path.join(this.directory, entry));
      }
    }

    // Watch for new files
    this.dirWatcher = fs.watch(this.directory, (eventType, filename) => {
      if (this.stopped) return;
      if (!filename || !filename.endsWith('.jsonl')) return;
      if (eventType === 'rename') {
        const fullPath = path.join(this.directory, filename);
        // Small delay — the file may not be fully created yet
        setTimeout(() => {
          if (this.stopped) return;
          if (fs.existsSync(fullPath) && !this.children.has(fullPath)) {
            this.spawnTailer(fullPath);
          }
        }, 50);
      }
    });

    this.dirWatcher.on('error', (err) => {
      this.emit('error', err);
    });
  }

  stop(): void {
    this.stopped = true;
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

  get activeFiles(): string[] {
    return [...this.children.keys()];
  }

  private spawnTailer(filePath: string): void {
    if (this.children.has(filePath)) return;

    const tailer = new LogTailer({
      path: filePath,
      follow: true,
      lines: 0,
      deduplicator: this.deduplicator,
    });

    // Forward child events
    tailer.on('line', (line: string) => this.emit('line', line, filePath));
    tailer.on('event', (event) => this.emit('event', event, filePath));
    tailer.on('error', (err: Error) => this.emit('error', err));

    this.children.set(filePath, tailer);
    tailer.start();
  }
}
