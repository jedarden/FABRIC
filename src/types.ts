/**
 * FABRIC Type Definitions
 *
 * Core types for NEEDLE log parsing and worker state management.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type WorkerStatus = 'active' | 'idle' | 'error';

export interface LogEvent {
  /** Unix timestamp in milliseconds */
  ts: number;

  /** Worker identifier (e.g., 'w-abc123') */
  worker: string;

  /** Log level */
  level: LogLevel;

  /** Log message */
  msg: string;

  /** Optional: Tool that was called */
  tool?: string;

  /** Optional: File path being operated on */
  path?: string;

  /** Optional: Bead/task identifier */
  bead?: string;

  /** Optional: Duration in milliseconds */
  duration_ms?: number;

  /** Optional: Error details */
  error?: string;

  /** Any additional fields */
  [key: string]: unknown;
}

export interface WorkerInfo {
  /** Worker identifier */
  id: string;

  /** Current status */
  status: WorkerStatus;

  /** Last event received */
  lastEvent?: LogEvent;

  /** Total beads completed */
  beadsCompleted: number;

  /** First seen timestamp */
  firstSeen: number;

  /** Last activity timestamp */
  lastActivity: number;
}

export interface EventFilter {
  /** Filter by worker ID */
  worker?: string;

  /** Filter by log level */
  level?: LogLevel;

  /** Filter by bead ID */
  bead?: string;

  /** Filter by file path */
  path?: string;

  /** Time range start (Unix timestamp) */
  since?: number;

  /** Time range end (Unix timestamp) */
  until?: number;
}

export interface EventStore {
  /** Add an event to the store */
  add(event: LogEvent): void;

  /** Query events with optional filter */
  query(filter?: EventFilter): LogEvent[];

  /** Get worker info */
  getWorker(workerId: string): WorkerInfo | undefined;

  /** Get all workers */
  getWorkers(): WorkerInfo[];

  /** Clear all events */
  clear(): void;
}
