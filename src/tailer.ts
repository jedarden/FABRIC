/**
 * FABRIC Log Tailer
 *
 * Watches and tails NEEDLE log files, emitting events as lines are parsed.
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { StringDecoder } from 'string_decoder';
import { LogEvent } from './types.js';
import { normalizeToLogEvent, EventDeduplicator } from './normalizer.js';

export interface TailerOptions {
  /** Path to log file or directory */
  path: string;

  /** Parse as JSON log lines */
  parseJson?: boolean;

  /** Follow mode (watch for new lines) */
  follow?: boolean;

  /** Number of existing lines to read on start */
  lines?: number;

  /** Shared deduplicator for cross-source dedup (JSONL + OTLP). */
  deduplicator?: EventDeduplicator;

  /**
   * Start reading from this byte offset instead of end-of-file.
   * When set, any content between startPosition and current EOF is read
   * immediately on start (catch-up read), then the tailer follows new writes.
   * Use 0 to read the whole file from the beginning.
   */
  startPosition?: number;
}

export interface TailerEvents {
  'event': (event: LogEvent) => void;
  'line': (line: string) => void;
  'error': (error: Error) => void;
  'end': () => void;
}

export class LogTailer extends EventEmitter {
  private filePath: string;
  private parseJson: boolean;
  private follow: boolean;
  private lines: number;
  private deduplicator?: EventDeduplicator;
  private startPositionOpt?: number;
  private watcher?: fs.FSWatcher;
  private position: number = 0;
  private buffer: string = '';
  private decoder = new StringDecoder('utf8');
  private ended: boolean = false;
  private reading: boolean = false;
  private readAgain: boolean = false;

  constructor(options: TailerOptions) {
    super();
    this.filePath = this.expandPath(options.path);
    this.parseJson = options.parseJson ?? true;
    this.follow = options.follow ?? true;
    this.lines = options.lines ?? 0;
    this.deduplicator = options.deduplicator;
    this.startPositionOpt = options.startPosition;
  }

  /** Current read position in bytes (useful for checkpointing before eviction). */
  get currentPosition(): number {
    return this.position;
  }

  /**
   * Expand ~ to home directory
   */
  private expandPath(p: string): string {
    if (p.startsWith('~')) {
      return path.join(process.env.HOME || '', p.slice(1));
    }
    return p;
  }

  /**
   * Start tailing the log file
   */
  start(): void {
    // Check if file exists
    if (!fs.existsSync(this.filePath)) {
      this.emit('error', new Error(`Log file not found: ${this.filePath}`));
      return;
    }

    // Read existing content if requested
    if (this.lines > 0) {
      this.readExistingLines();
    } else if (this.startPositionOpt !== undefined) {
      this.position = this.startPositionOpt;
    } else {
      // Start from end of file
      const stats = fs.statSync(this.filePath);
      this.position = stats.size;
    }

    // Watch for changes if follow mode
    if (this.follow) {
      this.watch();
    }

    // When given an explicit start position, do an immediate catch-up read to
    // consume any bytes written between the checkpoint and now, then rely on
    // the watcher for future writes.
    if (this.startPositionOpt !== undefined) {
      void this.readNewContent();
    }
  }

  /**
   * Read existing lines from file
   */
  private readExistingLines(): void {
    const content = fs.readFileSync(this.filePath, 'utf-8');
    const allLines = content.split('\n');

    // Get last N lines
    const startIdx = Math.max(0, allLines.length - this.lines - 1);
    const lines = allLines.slice(startIdx);

    for (const line of lines) {
      if (line.trim()) {
        this.processLine(line);
      }
    }

    // Update position to end of file
    this.position = Buffer.byteLength(content, 'utf-8');
  }

  /**
   * Watch file for changes
   */
  private watch(): void {
    this.watcher = fs.watch(this.filePath, (eventType) => {
      if (eventType === 'change') {
        void this.readNewContent();
      } else if (eventType === 'rename') {
        // File was rotated or deleted
        this.checkFileExists();
      }
    });

    this.watcher.on('error', (err) => {
      this.emit('error', err);
    });
  }

  /**
   * Read new content from file
   */
  private async readNewContent(): Promise<void> {
    if (this.ended) return;
    if (this.reading) {
      this.readAgain = true;
      return;
    }

    this.reading = true;
    try {
      do {
        this.readAgain = false;
        await this.readAvailableContent();
      } while (this.readAgain && !this.ended);
    } catch (err) {
      this.emit('error', err as Error);
    } finally {
      this.reading = false;
      // A watcher notification can arrive as the last async read is settling.
      // Re-arm after clearing `reading` so that notification is never lost.
      if (this.readAgain && !this.ended) void this.readNewContent();
    }
  }

  /** Read a snapshot of currently available bytes, yielding between chunks. */
  private async readAvailableContent(): Promise<void> {
    const stats = await fs.promises.stat(this.filePath);
    if (this.ended) return;

    if (stats.size < this.position) {
      // File was truncated, start from the beginning and discard partial state.
      this.position = 0;
      this.buffer = '';
      this.decoder = new StringDecoder('utf8');
    }
    if (stats.size <= this.position) return;

    const file = await fs.promises.open(this.filePath, 'r');
    try {
      const readThrough = stats.size;
      let linesSinceYield = 0;

      while (!this.ended && this.position < readThrough) {
        const length = Math.min(64 * 1024, readThrough - this.position);
        const chunk = Buffer.allocUnsafe(length);
        const { bytesRead } = await file.read(chunk, 0, length, this.position);
        if (bytesRead === 0) break;

        this.position += bytesRead;
        this.buffer += this.decoder.write(chunk.subarray(0, bytesRead));

        // Process complete lines while retaining a partial final line for the
        // next write. Bound synchronous event handling so the TUI and timers
        // run during large startup replays.
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim()) this.processLine(line);
          linesSinceYield++;
          if (linesSinceYield >= 128) {
            linesSinceYield = 0;
            await new Promise<void>((resolve) => setImmediate(resolve));
            if (this.ended) break;
          }
        }
      }
    } finally {
      await file.close();
    }
  }

  /**
   * Check if file still exists
   */
  private checkFileExists(): void {
    if (!fs.existsSync(this.filePath)) {
      // Wait for file to be recreated
      setTimeout(() => {
        if (fs.existsSync(this.filePath)) {
          this.position = 0;
          void this.readNewContent();
        }
      }, 1000);
    }
  }

  /**
   * Process a single line
   */
  private processLine(line: string): void {
    this.emit('line', line);

    if (this.parseJson) {
      const event = normalizeToLogEvent(line, 'jsonl', this.deduplicator);
      if (event) {
        this.emit('event', event);
      }
    }
  }

  /**
   * Stop tailing
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
    this.ended = true;
    this.emit('end');
  }

  /**
   * Check if tailer is active
   */
  get isActive(): boolean {
    return !this.ended && this.watcher !== undefined;
  }
}

/**
 * Tail a log file and return a promise that resolves when done
 */
export function tailLogFile(options: TailerOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const tailer = new LogTailer(options);

    tailer.on('error', (err) => {
      reject(err);
      tailer.stop();
    });

    tailer.on('end', () => {
      resolve();
    });

    // Handle SIGINT gracefully
    const handleExit = () => {
      tailer.stop();
      resolve();
    };

    process.on('SIGINT', handleExit);
    process.on('SIGTERM', handleExit);

    tailer.start();
  });
}
