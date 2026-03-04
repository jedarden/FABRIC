/**
 * FABRIC Type Definitions
 *
 * Core types for NEEDLE log parsing and worker state management.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type WorkerStatus = 'active' | 'idle' | 'error';

// ============================================
// Conversation Event Types
// ============================================

/**
 * Role in a conversation
 */
export type ConversationRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Type of conversation event
 */
export type ConversationEventType =
  | 'prompt'        // User input/prompt
  | 'response'      // Assistant response text
  | 'thinking'      // Internal reasoning/thinking block
  | 'tool_call'     // Tool being called with arguments
  | 'tool_result';  // Result from a tool call

/**
 * Base interface for all conversation events
 */
export interface ConversationEventBase {
  /** Unique event identifier */
  id: string;

  /** Type of conversation event */
  type: ConversationEventType;

  /** Role in conversation */
  role: ConversationRole;

  /** Unix timestamp in milliseconds */
  ts: number;

  /** Worker identifier */
  worker: string;

  /** Associated bead/task ID (if any) */
  bead?: string;

  /** Sequence number within the conversation */
  sequence: number;

  /** Token count for this event (if available) */
  tokens?: number;
}

/**
 * User prompt event
 */
export interface PromptEvent extends ConversationEventBase {
  type: 'prompt';
  role: 'user';

  /** The user's prompt text */
  content: string;

  /** Whether this is a continuation of a previous prompt */
  isContinuation?: boolean;
}

/**
 * Assistant response event
 */
export interface ResponseEvent extends ConversationEventBase {
  type: 'response';
  role: 'assistant';

  /** The response text */
  content: string;

  /** Whether the response is truncated */
  isTruncated?: boolean;

  /** Model used for this response */
  model?: string;

  /** Stop reason (if available) */
  stopReason?: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';
}

/**
 * Thinking/reasoning block event
 */
export interface ThinkingEvent extends ConversationEventBase {
  type: 'thinking';
  role: 'assistant';

  /** The thinking content */
  content: string;

  /** Whether thinking is truncated */
  isTruncated?: boolean;

  /** Duration of thinking in ms (if available) */
  durationMs?: number;
}

/**
 * Tool argument types
 */
export type ToolArgValue = string | number | boolean | null | ToolArgValue[] | { [key: string]: ToolArgValue };

/**
 * Tool call event
 */
export interface ToolCallEvent extends ConversationEventBase {
  type: 'tool_call';
  role: 'assistant';

  /** Tool name */
  tool: string;

  /** Tool arguments */
  args: Record<string, ToolArgValue>;

  /** Tool call ID (for correlating with results) */
  toolCallId?: string;

  /** Human-readable summary of the call */
  summary?: string;
}

/**
 * Tool result event
 */
export interface ToolResultEvent extends ConversationEventBase {
  type: 'tool_result';
  role: 'tool';

  /** Tool name */
  tool: string;

  /** Tool call ID this is a response to */
  toolCallId?: string;

  /** Result content (may be truncated) */
  content: string;

  /** Whether the tool call succeeded */
  success: boolean;

  /** Error message if failed */
  error?: string;

  /** Duration of tool call in ms */
  durationMs?: number;

  /** Whether the result is truncated */
  isTruncated?: boolean;

  /** Size of full result in bytes (for context) */
  resultSize?: number;
}

/**
 * Union type for all conversation events
 */
export type ConversationEvent =
  | PromptEvent
  | ResponseEvent
  | ThinkingEvent
  | ToolCallEvent
  | ToolResultEvent;

/**
 * A complete conversation session
 */
export interface ConversationSession {
  /** Session identifier */
  id: string;

  /** Worker ID */
  workerId: string;

  /** Associated bead ID (if any) */
  beadId?: string;

  /** Start timestamp */
  startTime: number;

  /** End timestamp (if complete) */
  endTime?: number;

  /** All events in chronological order */
  events: ConversationEvent[];

  /** Total token count */
  totalTokens: number;

  /** Number of turns */
  turnCount: number;

  /** Tools used in this session */
  toolsUsed: string[];

  /** Whether the session is still active */
  isActive: boolean;
}

/**
 * Options for parsing conversation events
 */
export interface ConversationParseOptions {
  /** Maximum content length before truncation */
  maxContentLength?: number;

  /** Include thinking blocks */
  includeThinking?: boolean;

  /** Include tool results */
  includeToolResults?: boolean;

  /** Truncate tool results longer than this */
  maxToolResultLength?: number;
}

// ============================================
// Core Log Event Types
// ============================================

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

  /** Current bead/task being worked on */
  activeBead?: string;

  /** Directories this worker is active in */
  activeDirectories: string[];

  /** All collision types this worker is involved in */
  collisionTypes: ('file' | 'bead' | 'task')[];
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

/**
 * Bead collision - when multiple workers work on the same bead/task
 */
export interface BeadCollision {
  /** Bead ID being contested */
  beadId: string;

  /** Workers working on this bead */
  workers: string[];

  /** Timestamp when collision was detected */
  detectedAt: number;

  /** Events that triggered the collision */
  events: LogEvent[];

  /** Whether the collision is still active */
  isActive: boolean;

  /** Collision severity based on operation types */
  severity: 'warning' | 'critical';
}

/**
 * Task collision - when workers work on tasks that may conflict
 */
export interface TaskCollision {
  /** Type of collision */
  type: 'directory' | 'related_files' | 'dependency';

  /** Human-readable description */
  description: string;

  /** Workers involved */
  workers: string[];

  /** Affected paths/beads */
  affectedResources: string[];

  /** Timestamp when collision was detected */
  detectedAt: number;

  /** Whether the collision is still active */
  isActive: boolean;

  /** Risk level */
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * Collision alert for user notification
 */
export interface CollisionAlert {
  /** Unique alert ID */
  id: string;

  /** Alert type */
  type: 'file' | 'bead' | 'task';

  /** Severity level */
  severity: 'info' | 'warning' | 'error' | 'critical';

  /** Human-readable title */
  title: string;

  /** Detailed description */
  description: string;

  /** Workers involved */
  workers: string[];

  /** Timestamp when alert was generated */
  timestamp: number;

  /** Whether the alert has been acknowledged */
  acknowledged: boolean;

  /** Related collision data */
  collision: FileCollision | BeadCollision | TaskCollision;

  /** Suggested resolution */
  suggestion?: string;
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

// ============================================
// Git Event Types
// ============================================

/**
 * Type of git event
 */
export type GitEventType =
  | 'status'   // Git status output (staged, unstaged, untracked)
  | 'commit'   // Git commit
  | 'branch'   // Branch information
  | 'diff';    // Git diff output

/**
 * File status in git
 */
export type GitFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'unmerged';

/**
 * Single file change in git
 */
export interface GitFileChange {
  /** File path */
  path: string;

  /** Status of the file */
  status: GitFileStatus;

  /** Original path (for renames) */
  originalPath?: string;

  /** Staging area status */
  staged: boolean;
}

/**
 * Base interface for all git events
 */
export interface GitEventBase {
  /** Unique event identifier */
  id: string;

  /** Type of git event */
  type: GitEventType;

  /** Unix timestamp in milliseconds */
  ts: number;

  /** Worker identifier */
  worker: string;

  /** Associated bead/task ID (if any) */
  bead?: string;
}

/**
 * Git status event
 */
export interface GitStatusEvent extends GitEventBase {
  type: 'status';

  /** Current branch name */
  branch: string;

  /** Commit hash (HEAD) */
  commit?: string;

  /** Staged file changes */
  staged: GitFileChange[];

  /** Unstaged file changes */
  unstaged: GitFileChange[];

  /** Untracked files */
  untracked: string[];

  /** Commits ahead of remote */
  ahead?: number;

  /** Commits behind remote */
  behind?: number;

  /** Remote tracking branch */
  tracking?: string;
}

/**
 * Git commit event
 */
export interface GitCommitEvent extends GitEventBase {
  type: 'commit';

  /** Commit hash */
  hash: string;

  /** Commit message */
  message: string;

  /** Branch name */
  branch?: string;

  /** Author name */
  author?: string;

  /** Author email */
  email?: string;

  /** Parent commit hash(es) */
  parents?: string[];

  /** Files changed in this commit */
  files?: GitFileChange[];
}

/**
 * Git branch event
 */
export interface GitBranchEvent extends GitEventBase {
  type: 'branch';

  /** Current branch name */
  current: string;

  /** All local branches */
  branches?: string[];

  /** Remote tracking branch */
  tracking?: string;

  /** Commits ahead of tracking */
  ahead?: number;

  /** Commits behind tracking */
  behind?: number;
}

/**
 * Git diff event
 */
export interface GitDiffEvent extends GitEventBase {
  type: 'diff';

  /** Diff target (e.g., 'HEAD', 'origin/main') */
  target: string;

  /** Files with changes */
  files: GitFileChange[];

  /** Total lines added */
  linesAdded: number;

  /** Total lines deleted */
  linesDeleted: number;

  /** Diff content (may be truncated) */
  content?: string;

  /** Whether diff content is truncated */
  isTruncated?: boolean;
}

/**
 * Union type for all git events
 */
export type GitEvent =
  | GitStatusEvent
  | GitCommitEvent
  | GitBranchEvent
  | GitDiffEvent;

/**
 * Options for parsing git events
 */
export interface GitParseOptions {
  /** Maximum diff content length before truncation */
  maxDiffLength?: number;

  /** Include file change details */
  includeFileChanges?: boolean;

  /** Maximum files to track in a single event */
  maxFiles?: number;
}

// ============================================
// Cross-Reference Types
// ============================================

/**
 * Type of entity that can be cross-referenced
 */
export type CrossReferenceEntityType = 'event' | 'bead' | 'file' | 'worker' | 'session';

/**
 * A single cross-reference link
 */
export interface CrossReferenceLink {
  /** Unique link ID */
  id: string;

  /** Source entity type */
  sourceType: CrossReferenceEntityType;

  /** Source entity ID */
  sourceId: string;

  /** Target entity type */
  targetType: CrossReferenceEntityType;

  /** Target entity ID */
  targetId: string;

  /** Relationship type */
  relationship: CrossReferenceRelationship;

  /** Strength of the relationship (0-1) */
  strength: number;

  /** When this link was detected */
  detectedAt: number;

  /** Optional context about why this link exists */
  context?: string;
}

/**
 * Types of relationships between entities
 */
export type CrossReferenceRelationship =
  | 'same_bead'         // Events working on the same bead/task
  | 'same_file'         // Events modifying the same file
  | 'same_worker'       // Events from the same worker
  | 'temporal_proximity' // Events happening close together in time
  | 'same_session'      // Events in the same worker session
  | 'dependency'        // One bead depends on another
  | 'collision'         // Workers colliding on the same file
  | 'parent_child'      // Hierarchical relationship
  | 'error_related'     // Events related to the same error
  | 'tool_sequence';    // Tool calls that form a logical sequence

/**
 * A cross-reference entity with its links
 */
export interface CrossReferenceEntity {
  /** Entity type */
  type: CrossReferenceEntityType;

  /** Entity ID */
  id: string;

  /** Human-readable label */
  label: string;

  /** All links from this entity */
  outgoingLinks: CrossReferenceLink[];

  /** All links to this entity */
  incomingLinks: CrossReferenceLink[];

  /** Related entities grouped by type */
  relatedEntities: Map<CrossReferenceEntityType, CrossReferenceLink[]>;

  /** Total link count */
  linkCount: number;

  /** Most recent link timestamp */
  lastLinkedAt: number;

  /** First seen timestamp */
  firstSeen: number;

  /** Number of occurrences */
  occurrenceCount: number;
}

/**
 * Options for cross-reference queries
 */
export interface CrossReferenceQueryOptions {
  /** Filter by source entity type */
  sourceType?: CrossReferenceEntityType;

  /** Filter by target entity type */
  targetType?: CrossReferenceEntityType;

  /** Filter by relationship type */
  relationship?: CrossReferenceRelationship;

  /** Minimum relationship strength */
  minStrength?: number;

  /** Time range start */
  since?: number;

  /** Time range end */
  until?: number;

  /** Maximum results */
  limit?: number;
}

/** Alias for backward compatibility */
export type CrossReferenceFilter = CrossReferenceQueryOptions;

/**
 * Statistics about cross-references
 */
export interface CrossReferenceStats {
  /** Total links tracked */
  totalLinks: number;

  /** Total entities tracked */
  totalEntities: number;

  /** Links by relationship type */
  byRelationship: Record<CrossReferenceRelationship, number>;

  /** Entities by type */
  byEntityType: Record<CrossReferenceEntityType, number>;

  /** Most linked entities */
  mostLinked: CrossReferenceEntity[];

  /** Recent links */
  recentLinks: CrossReferenceLink[];
}

/**
 * A navigation path through cross-references
 */
export interface CrossReferencePath {
  /** Starting entity */
  start: CrossReferenceEntity;

  /** Ending entity */
  end: CrossReferenceEntity;

  /** Path steps */
  steps: CrossReferenceLink[];

  /** Total path length */
  length: number;

  /** Path description */
  description: string;
}

// ============================================
// Recovery Playbook Types
// ============================================

/**
 * Priority level for recovery actions
 */
export type RecoveryPriority = 'immediate' | 'high' | 'normal' | 'low';

/**
 * Type of recovery action
 */
export type RecoveryActionType =
  | 'retry'           // Simple retry the operation
  | 'backoff'         // Retry with exponential backoff
  | 'alternative'     // Use alternative approach
  | 'escalate'        // Escalate to human
  | 'skip'            // Skip and continue
  | 'fix_config'      // Fix configuration
  | 'install_dep'     // Install missing dependency
  | 'fix_permissions' // Fix file permissions
  | 'cleanup'         // Clean up resources
  | 'restart'         // Restart service/process
  | 'investigate';    // Requires further investigation

/**
 * A single recovery action step
 */
export interface RecoveryAction {
  /** Unique action ID */
  id: string;

  /** Action type */
  type: RecoveryActionType;

  /** Human-readable title */
  title: string;

  /** Detailed description of the action */
  description: string;

  /** Priority for ordering actions */
  priority: RecoveryPriority;

  /** Whether this action can be automated */
  automated: boolean;

  /** Command or code snippet to execute (if applicable) */
  command?: string;

  /** Expected outcome */
  expectedOutcome?: string;

  /** Prerequisites before this action */
  prerequisites?: string[];

  /** Risk level of this action */
  riskLevel?: 'safe' | 'moderate' | 'risky';

  /** Estimated time to complete (seconds) */
  estimatedTime?: number;
}

/**
 * A recovery playbook entry mapping error patterns to actions
 */
export interface RecoveryPlaybookEntry {
  /** Unique playbook ID */
  id: string;

  /** Error category this applies to */
  category: ErrorCategory;

  /** Title for this recovery playbook */
  title: string;

  /** Description of the error pattern */
  description: string;

  /** Pattern to match error messages */
  patterns: RegExp[];

  /** Recovery actions in order */
  actions: RecoveryAction[];

  /** When this playbook was created */
  createdAt: number;

  /** When this playbook was last updated */
  updatedAt: number;

  /** Tags for categorization */
  tags: string[];
}

/**
 * A specific recovery suggestion for an error
 */
export interface RecoverySuggestion {
  /** Unique suggestion ID */
  id: string;

  /** The error group this suggestion is for */
  errorGroupId: string;

  /** The playbook entry this came from (if any) */
  playbookId?: string;

  /** Error category */
  category: ErrorCategory;

  /** Title for the suggestion */
  title: string;

  /** Summary of the error */
  errorSummary: string;

  /** Recommended actions in order */
  actions: RecoveryAction[];

  /** When this suggestion was generated */
  generatedAt: number;

  /** Confidence level (0-1) */
  confidence: number;

  /** Related workers affected */
  affectedWorkers: string[];

  /** Similar past errors (if any) */
  relatedErrors?: string[];

  /** Whether this is still relevant */
  isActive: boolean;
}

/**
 * Options for recovery suggestion generation
 */
export interface RecoveryOptions {
  /** Maximum actions to include per suggestion */
  maxActions?: number;

  /** Only include automated actions */
  automatedOnly?: boolean;

  /** Minimum confidence threshold */
  minConfidence?: number;

  /** Filter by category */
  category?: ErrorCategory;

  /** Filter by worker */
  workerId?: string;
}

/**
 * Statistics about recovery suggestions
 */
export interface RecoveryStats {
  /** Total suggestions generated */
  totalSuggestions: number;

  /** Active suggestions */
  activeSuggestions: number;

  /** Suggestions by category */
  byCategory: Record<ErrorCategory, number>;

  /** Automated vs manual actions */
  automatedActions: number;
  manualActions: number;

  /** Average confidence */
  avgConfidence: number;

  /** Most common recovery action types */
  topActionTypes: Array<{ type: RecoveryActionType; count: number }>;
}

// ============================================
// Session Digest Types
// ============================================

/**
 * Bead completion summary
 */
export interface BeadCompletion {
  /** Bead ID */
  beadId: string;

  /** Worker that completed the bead */
  workerId: string;

  /** Completion timestamp */
  completedAt: number;

  /** Duration in milliseconds */
  durationMs?: number;
}

/**
 * File modification summary
 */
export interface FileModificationSummary {
  /** File path */
  path: string;

  /** Number of modifications */
  modifications: number;

  /** Workers who modified this file */
  workers: string[];

  /** Tools used */
  tools: string[];
}

/**
 * Error occurrence in session
 */
export interface ErrorOccurrence {
  /** Error message */
  message: string;

  /** Error category */
  category: ErrorCategory;

  /** Worker that encountered the error */
  workerId: string;

  /** Timestamp */
  timestamp: number;

  /** Error fingerprint */
  fingerprint?: string;
}

/**
 * Worker session summary
 */
export interface WorkerSessionSummary {
  /** Worker ID */
  workerId: string;

  /** Beads completed */
  beadsCompleted: number;

  /** Files modified */
  filesModified: number;

  /** Errors encountered */
  errorsEncountered: number;

  /** Total events */
  totalEvents: number;

  /** Active time in milliseconds */
  activeTimeMs: number;

  /** First activity timestamp */
  firstActivity: number;

  /** Last activity timestamp */
  lastActivity: number;
}

/**
 * Complete session digest
 */
export interface SessionDigest {
  /** Session ID or identifier */
  sessionId: string;

  /** Session start timestamp */
  startTime: number;

  /** Session end timestamp */
  endTime: number;

  /** Total duration in milliseconds */
  durationMs: number;

  /** Beads completed */
  beadsCompleted: BeadCompletion[];

  /** Files modified */
  filesModified: FileModificationSummary[];

  /** Errors encountered */
  errors: ErrorOccurrence[];

  /** Worker summaries */
  workers: WorkerSessionSummary[];

  /** Token usage and cost */
  cost: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };

  /** Overall statistics */
  stats: {
    totalEvents: number;
    totalWorkers: number;
    totalBeads: number;
    totalFiles: number;
    totalErrors: number;
    avgEventsPerWorker: number;
    avgBeadsPerWorker: number;
  };
}

/**
 * Options for session digest generation
 */
export interface SessionDigestOptions {
  /** Start time filter */
  startTime?: number;

  /** End time filter */
  endTime?: number;

  /** Include only specific workers */
  workers?: string[];

  /** Include error details */
  includeErrors?: boolean;

  /** Include cost breakdown */
  includeCost?: boolean;

  /** Maximum files to list */
  maxFiles?: number;

  /** Maximum errors to list */
  maxErrors?: number;
}

// ============================================
// Worker Analytics Types
// ============================================

/**
 * Time window for aggregation
 */
export type TimeWindow = 'hour' | 'day' | 'week' | 'all';

/**
 * Worker analytics metrics for a specific time period
 */
export interface WorkerMetrics {
  /** Worker ID */
  workerId: string;

  /** Time period start (Unix timestamp) */
  periodStart: number;

  /** Time period end (Unix timestamp) */
  periodEnd: number;

  /** Total beads completed in this period */
  beadsCompleted: number;

  /** Beads per hour (rate) */
  beadsPerHour: number;

  /** Average completion time per bead (milliseconds) */
  avgCompletionTimeMs: number;

  /** Total errors encountered */
  errorCount: number;

  /** Error rate (errors per bead) */
  errorRate: number;

  /** Total cost incurred (USD) */
  totalCostUsd: number;

  /** Cost per bead (USD) */
  costPerBead: number;

  /** Total active time (milliseconds) */
  activeTimeMs: number;

  /** Total idle time (milliseconds) */
  idleTimeMs: number;

  /** Idle percentage (0-100) */
  idlePercentage: number;

  /** Total events processed */
  totalEvents: number;

  /** Total tokens used */
  totalTokens: number;

  /** Tokens per bead */
  tokensPerBead: number;
}

/**
 * Time-series data point for worker metrics
 */
export interface MetricsDataPoint {
  /** Timestamp of this data point */
  timestamp: number;

  /** Worker ID */
  workerId: string;

  /** Metrics snapshot at this time */
  metrics: Partial<WorkerMetrics>;
}

/**
 * Worker performance trend
 */
export interface PerformanceTrend {
  /** Worker ID */
  workerId: string;

  /** Metric being tracked */
  metric: keyof WorkerMetrics;

  /** Time-series data points */
  dataPoints: MetricsDataPoint[];

  /** Trend direction: 'improving' | 'declining' | 'stable' */
  trend: 'improving' | 'declining' | 'stable';

  /** Percentage change from first to last data point */
  changePercent: number;

  /** Average value across all data points */
  average: number;

  /** Minimum value */
  min: number;

  /** Maximum value */
  max: number;
}

/**
 * Aggregated analytics across all workers
 */
export interface AggregatedAnalytics {
  /** Time period covered */
  periodStart: number;
  periodEnd: number;

  /** Total workers tracked */
  totalWorkers: number;

  /** Total beads completed */
  totalBeadsCompleted: number;

  /** Average beads per hour across all workers */
  avgBeadsPerHour: number;

  /** Average completion time across all workers */
  avgCompletionTimeMs: number;

  /** Total errors across all workers */
  totalErrors: number;

  /** Overall error rate */
  overallErrorRate: number;

  /** Total cost across all workers */
  totalCostUsd: number;

  /** Average cost per bead */
  avgCostPerBead: number;

  /** Top performers (sorted by beads completed) */
  topPerformers: WorkerMetrics[];

  /** Workers with highest error rates */
  highErrorRateWorkers: WorkerMetrics[];

  /** Most cost-efficient workers (lowest cost per bead) */
  costEfficientWorkers: WorkerMetrics[];
}

/**
 * Options for worker analytics
 */
export interface WorkerAnalyticsOptions {
  /** Time window for aggregation */
  timeWindow?: TimeWindow;

  /** Custom start time (overrides timeWindow) */
  startTime?: number;

  /** Custom end time (overrides timeWindow) */
  endTime?: number;

  /** Filter by specific worker IDs */
  workerIds?: string[];

  /** Minimum beads completed to be included */
  minBeadsCompleted?: number;

  /** Maximum workers to return in rankings */
  maxWorkers?: number;

  /** Include time-series data */
  includeTimeSeries?: boolean;

  /** Time-series data point interval (milliseconds) */
  timeSeriesInterval?: number;
}

/**
 * Worker analytics store interface
 */
export interface WorkerAnalyticsStore {
  /** Process an event and update analytics */
  processEvent(event: LogEvent): void;

  /** Get metrics for a specific worker */
  getWorkerMetrics(workerId: string, options?: WorkerAnalyticsOptions): WorkerMetrics | undefined;

  /** Get metrics for all workers */
  getAllWorkerMetrics(options?: WorkerAnalyticsOptions): WorkerMetrics[];

  /** Get aggregated analytics */
  getAggregatedAnalytics(options?: WorkerAnalyticsOptions): AggregatedAnalytics;

  /** Get performance trends */
  getPerformanceTrends(workerId: string, metric: keyof WorkerMetrics, options?: WorkerAnalyticsOptions): PerformanceTrend;

  /** Get time-series data */
  getTimeSeriesData(workerId: string, options?: WorkerAnalyticsOptions): MetricsDataPoint[];

  /** Clear all analytics data */
  clear(): void;

  /** Get analytics summary as formatted string */
  getSummary(options?: WorkerAnalyticsOptions): string;
}
