/**
 * FABRIC Log Tailer
 *
 * Watches and tails NEEDLE log files, emitting events as lines are parsed.
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { LogEvent } from './types.js';
import { parseLogLine } from './parser.js';

export interface TailerOptions {
  /** Path to log file or directory */
  path: string;

  /** Parse as JSON log lines */
  parseJson?: boolean;

  /** Follow mode (watch for new lines) */
  follow?: boolean;

  /** Number of existing lines to read on start */
  lines?: number;
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
  private watcher?: fs.FSWatcher;
  private position: number = 0;
  private buffer: string = '';
  private ended: boolean = false;

  constructor(options: TailerOptions) {
    super();
    this.filePath = this.expandPath(options.path);
    this.parseJson = options.parseJson ?? true;
    this.follow = options.follow ?? true;
    this.lines = options.lines ?? 0;
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
    } else {
      // Start from end of file
      const stats = fs.statSync(this.filePath);
      this.position = stats.size;
    }

    // Watch for changes if follow mode
    if (this.follow) {
      this.watch();
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
        this.readNewContent();
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
  private readNewContent(): void {
    try {
      const stats = fs.statSync(this.filePath);
      if (stats.size < this.position) {
        // File was truncated, start from beginning
        this.position = 0;
      }

      if (stats.size > this.position) {
        const fd = fs.openSync(this.filePath, 'r');
        const buffer = Buffer.alloc(stats.size - this.position);
        fs.readSync(fd, buffer, 0, buffer.length, this.position);
        fs.closeSync(fd);

        this.position = stats.size;
        this.buffer += buffer.toString('utf-8');

        // Process complete lines
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim()) {
            this.processLine(line);
          }
        }
      }
    } catch (err) {
      this.emit('error', err as Error);
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
          this.readNewContent();
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
      const event = parseLogLine(line);
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
