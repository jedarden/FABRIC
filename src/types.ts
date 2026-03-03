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

// ============================================
// File Heatmap Types
// ============================================

/**
 * Heat level for a file based on modification frequency
 */
export type HeatLevel = 'cold' | 'warm' | 'hot' | 'critical';

/**
 * Worker contribution to a file's modification history
 */
export interface WorkerFileContribution {
  /** Worker ID */
  workerId: string;

  /** Number of modifications by this worker */
  modifications: number;

  /** Last modification timestamp */
  lastModified: number;

  /** Percentage of total modifications (0-100) */
  percentage: number;
}

/**
 * Single file entry in the heatmap
 */
export interface FileHeatmapEntry {
  /** File path */
  path: string;

  /** Total modification count */
  modifications: number;

  /** Heat level based on frequency */
  heatLevel: HeatLevel;

  /** Workers who have modified this file */
  workers: WorkerFileContribution[];

  /** First modification timestamp */
  firstModified: number;

  /** Most recent modification timestamp */
  lastModified: number;

  /** Whether this file is currently being modified by multiple workers */
  hasCollision: boolean;

  /** Number of workers currently active on this file */
  activeWorkers: number;

  /** Average time between modifications (ms) */
  avgModificationInterval: number;
}

/**
 * Options for heatmap generation
 */
export interface HeatmapOptions {
  /** Minimum modifications to be included in heatmap */
  minModifications?: number;

  /** Maximum entries to return */
  maxEntries?: number;

  /** Sort by: 'modifications' | 'recent' | 'workers' | 'collisions' */
  sortBy?: 'modifications' | 'recent' | 'workers' | 'collisions';

  /** Filter by directory prefix */
  directoryFilter?: string;

  /** Only show files with collisions */
  collisionsOnly?: boolean;
}

/**
 * Statistics for the entire file heatmap
 */
export interface FileHeatmapStats {
  /** Total files being tracked */
  totalFiles: number;

  /** Total modifications across all files */
  totalModifications: number;

  /** Files with collisions */
  collisionFiles: number;

  /** Files currently being modified */
  activeFiles: number;

  /** Heat level distribution */
  heatDistribution: Record<HeatLevel, number>;

  /** Most active directory */
  mostActiveDirectory: string;

  /** Average modifications per file */
  avgModificationsPerFile: number;
}

// ============================================
// Dependency DAG Types
// ============================================

/**
 * Bead status type
 */
export type BeadStatus = 'open' | 'in_progress' | 'blocked' | 'completed' | 'closed' | 'deferred';

/**
 * Single node in the dependency graph
 */
export interface BeadNode {
  /** Bead ID (e.g., 'bd-abc123') */
  id: string;

  /** Bead title */
  title: string;

  /** Current status */
  status: BeadStatus;

  /** Priority level (0-4) */
  priority: number;

  /** Depth in the dependency tree (0 = root) */
  depth: number;

  /** Number of dependents (beads that depend on this) */
  dependentCount: number;

  /** Number of dependencies (beads this depends on) */
  dependencyCount: number;

  /** Whether this is on the critical path */
  isCriticalPath: boolean;

  /** Estimated effort (if available) */
  estimatedEffort?: number;
}

/**
 * Edge in the dependency graph
 */
export interface DependencyEdge {
  /** Source bead ID (the one that depends) */
  from: string;

  /** Target bead ID (the dependency) */
  to: string;

  /** Whether this edge is part of the critical path */
  isCritical: boolean;
}

/**
 * Connected component in the dependency graph
 */
export interface DagComponent {
  /** All nodes in this component */
  nodes: BeadNode[];

  /** All edges in this component */
  edges: DependencyEdge[];

  /** Root nodes (no incoming edges) */
  roots: string[];

  /** Whether this component contains cycles */
  hasCycle: boolean;

  /** Critical path through this component (bead IDs) */
  criticalPath: string[];

  /** Total depth of the component */
  maxDepth: number;
}

/**
 * Full dependency graph
 */
export interface DependencyGraph {
  /** All connected components */
  components: DagComponent[];

  /** Total nodes across all components */
  totalNodes: number;

  /** Total edges across all components */
  totalEdges: number;

  /** Total components */
  totalComponents: number;

  /** Overall critical path (longest path across all components) */
  globalCriticalPath: string[];

  /** Timestamp when graph was generated */
  generatedAt: number;
}

/**
 * Options for DAG visualization
 */
export interface DagOptions {
  /** Filter by status */
  status?: BeadStatus | 'all';

  /** Filter by priority range */
  minPriority?: number;
  maxPriority?: number;

  /** Show only critical path */
  criticalOnly?: boolean;

  /** Maximum depth to display */
  maxDepth?: number;

  /** Sort order: 'priority' | 'depth' | 'dependents' */
  sortBy?: 'priority' | 'depth' | 'dependents';

  /** Include closed/completed beads */
  includeClosed?: boolean;
}

/**
 * Statistics about the dependency graph
 */
export interface DagStats {
  /** Total beads tracked */
  totalBeads: number;

  /** Blocked beads count */
  blockedCount: number;

  /** Ready beads (unblocked, open) */
  readyCount: number;

  /** Average dependencies per bead */
  avgDependencies: number;

  /** Average dependents per bead */
  avgDependents: number;

  /** Maximum depth found */
  maxDepth: number;

  /** Number of cycles detected */
  cycleCount: number;

  /** Critical path length */
  criticalPathLength: number;

  /** Beads on critical path */
  criticalPathBeads: number;
}
