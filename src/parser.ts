/**
 * FABRIC Log Parser
 *
 * Parses NEEDLE log lines into structured LogEvent objects.
 */

import { LogEvent, LogLevel } from './types.js';

/**
 * Parse a single log line
 *
 * @param line - Raw log line (JSON string)
 * @returns Parsed LogEvent or null if invalid
 */
export function parseLogLine(line: string): LogEvent | null {
  // Skip empty lines
  if (!line || !line.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(line);

    // Validate required fields
    if (typeof parsed.ts !== 'number') {
      return null;
    }
    if (typeof parsed.worker !== 'string') {
      return null;
    }
    if (!isValidLogLevel(parsed.level)) {
      return null;
    }
    if (typeof parsed.msg !== 'string') {
      return null;
    }

    // Construct LogEvent with validated fields
    const event: LogEvent = {
      ts: parsed.ts,
      worker: parsed.worker,
      level: parsed.level,
      msg: parsed.msg,
    };

    // Copy optional fields if present
    if (typeof parsed.tool === 'string') event.tool = parsed.tool;
    if (typeof parsed.path === 'string') event.path = parsed.path;
    if (typeof parsed.bead === 'string') event.bead = parsed.bead;
    if (typeof parsed.duration_ms === 'number') event.duration_ms = parsed.duration_ms;
    if (typeof parsed.error === 'string') event.error = parsed.error;

    // Copy any additional fields
    for (const key of Object.keys(parsed)) {
      if (!isStandardField(key) && !(key in event)) {
        event[key] = parsed[key];
      }
    }

    return event;
  } catch {
    // Not valid JSON
    return null;
  }
}

/**
 * Parse multiple log lines
 *
 * @param content - Multi-line string of log entries
 * @returns Array of parsed LogEvents (skips invalid lines)
 */
export function parseLogLines(content: string): LogEvent[] {
  const events: LogEvent[] = [];

  for (const line of content.split('\n')) {
    const event = parseLogLine(line);
    if (event) {
      events.push(event);
    }
  }

  return events;
}

/**
 * Format a LogEvent for display
 */
export function formatEvent(event: LogEvent, options: FormatOptions = {}): string {
  const { showWorker = true, showLevel = true, colorize = false } = options;

  const timestamp = formatTimestamp(event.ts);
  const parts: string[] = [];

  if (showWorker) {
    parts.push(padWorker(event.worker));
  }

  if (showLevel) {
    parts.push(formatLevel(event.level, colorize));
  }

  parts.push(event.msg);

  // Add optional context
  if (event.tool) {
    parts.push(`[${event.tool}]`);
  }
  if (event.path) {
    parts.push(event.path);
  }
  if (event.bead) {
    parts.push(`bead:${event.bead}`);
  }
  if (event.duration_ms !== undefined) {
    parts.push(`(${formatDuration(event.duration_ms)})`);
  }
  if (event.error) {
    parts.push(`ERROR: ${event.error}`);
  }

  return `${timestamp}  ${parts.join('  ')}`;
}

export interface FormatOptions {
  showWorker?: boolean;
  showLevel?: boolean;
  colorize?: boolean;
}

/**
 * Check if level is valid
 */
function isValidLogLevel(level: unknown): level is LogLevel {
  return level === 'debug' || level === 'info' || level === 'warn' || level === 'error';
}

/**
 * Check if field is a standard LogEvent field
 */
function isStandardField(key: string): boolean {
  return ['ts', 'worker', 'level', 'msg', 'tool', 'path', 'bead', 'duration_ms', 'error'].includes(key);
}

/**
 * Format timestamp for display
 */
function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Pad worker ID for alignment
 */
function padWorker(worker: string): string {
  return worker.padEnd(12);
}

/**
 * Format log level with optional color
 */
function formatLevel(level: LogLevel, colorize: boolean): string {
  const padded = level.toUpperCase().padEnd(5);

  if (!colorize) {
    return padded;
  }

  // ANSI color codes
  const colors: Record<LogLevel, string> = {
    debug: '\x1b[36m', // cyan
    info: '\x1b[32m',  // green
    warn: '\x1b[33m',  // yellow
    error: '\x1b[31m', // red
  };
  const reset = '\x1b[0m';

  return `${colors[level]}${padded}${reset}`;
}

/**
 * Format duration in human-readable form
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}
