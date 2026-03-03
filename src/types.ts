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

  /** Files currently being modified by this worker */
  activeFiles: string[];

  /** Whether this worker is involved in any collisions */
  hasCollision: boolean;
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

/**
 * File collision event - when multiple workers modify the same file concurrently
 */
export interface FileCollision {
  /** File path being contested */
  path: string;

  /** Workers involved in the collision */
  workers: string[];

  /** Timestamp when collision was detected */
  detectedAt: number;

  /** Events that triggered the collision */
  events: LogEvent[];

  /** Whether the collision is still active */
  isActive: boolean;
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

  /** Get all active collisions */
  getCollisions(): FileCollision[];

  /** Get collisions for a specific worker */
  getWorkerCollisions(workerId: string): FileCollision[];
}

// ============================================
// Error Grouping Types
// ============================================

/**
 * Error fingerprint - used to identify similar errors
 */
export interface ErrorFingerprint {
  /** Normalized pattern signature (e.g., "ECONNREFUSED_*:*" for connection errors) */
  signature: string;

  /** Category of error (network, permission, validation, etc.) */
  category: ErrorCategory;

  /** Original error message (first occurrence) */
  sampleMessage: string;

  /** Hash of the signature for quick comparison */
  hash: string;
}

/**
 * Error categories for grouping
 */
export type ErrorCategory =
  | 'network'      // Connection errors, timeouts, DNS issues
  | 'permission'   // Auth failures, access denied
  | 'validation'   // Invalid input, schema errors
  | 'resource'     // Out of memory, disk full, quota exceeded
  | 'not_found'    // File not found, 404 errors
  | 'timeout'      // Operation timed out
  | 'syntax'       // Parse errors, malformed data
  | 'tool'         // Tool-specific failures
  | 'unknown';     // Uncategorized errors

/**
 * Grouped error - clusters similar errors together
 */
export interface ErrorGroup {
  /** Unique group ID */
  id: string;

  /** Fingerprint identifying this group */
  fingerprint: ErrorFingerprint;

  /** All error events in this group */
  events: LogEvent[];

  /** First occurrence timestamp */
  firstSeen: number;

  /** Most recent occurrence timestamp */
  lastSeen: number;

  /** Number of occurrences */
  count: number;

  /** Workers that have encountered this error */
  affectedWorkers: string[];

  /** Whether this error group is currently active (seen recently) */
  isActive: boolean;

  /** Severity based on frequency and recency */
  severity: 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Options for error grouping
 */
export interface ErrorGroupingOptions {
  /** Time window to consider errors as active (ms), default 5 minutes */
  activeWindowMs?: number;

  /** Minimum occurrences for high severity */
  highSeverityThreshold?: number;

  /** Minimum occurrences for critical severity */
  criticalSeverityThreshold?: number;

  /** Maximum groups to track */
  maxGroups?: number;
}

// ============================================
// Session Replay Types
// ============================================

export type ReplaySpeed = 0.5 | 1 | 2 | 5 | 10;

export type ReplayState = 'idle' | 'playing' | 'paused' | 'ended';

export interface ReplaySession {
  /** Unique session identifier */
  id: string;

  /** Source log file path */
  sourcePath: string;

  /** Total events in the session */
  totalEvents: number;

  /** Current playback position (event index) */
  currentIndex: number;

  /** Playback state */
  state: ReplayState;

  /** Playback speed multiplier */
  speed: ReplaySpeed;

  /** Start timestamp of session (first event) */
  startTime: number;

  /** End timestamp of session (last event) */
  endTime: number;

  /** Filter applied during replay */
  filter?: EventFilter;
}

export interface ReplayControls {
  /** Start or resume playback */
  play(): void;

  /** Pause playback */
  pause(): void;

  /** Toggle play/pause */
  toggle(): void;

  /** Step to next event */
  stepForward(): void;

  /** Step to previous event */
  stepBackward(): void;

  /** Jump to specific event index */
  seekTo(index: number): void;

  /** Set playback speed */
  setSpeed(speed: ReplaySpeed): void;

  /** Stop and reset replay */
  reset(): void;
}
