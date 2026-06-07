// FABRIC Web Frontend Types

export type NeedleState =
  | 'BOOTING'
  | 'SELECTING'
  | 'CLAIMING'
  | 'WORKING'
  | 'BUILDING'
  | 'DISPATCHING'
  | 'EXECUTING'
  | 'HANDLING'
  | 'LOGGING'
  | 'CLOSING'
  | 'EXHAUSTED_IDLE'
  | 'STOPPED';

export interface LogEvent {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  worker: string;
  tool?: string;
  message: string;
  raw: string;
  bead?: string;
  sequence?: number;
  ts?: number;
  msg?: string;
  error?: string;
  path?: string;
  provider?: string;
  model?: string;
  session?: string;
  duration_ms?: number;
}

/**
 * Compare two LogEvents by (worker, sequence), falling back to ts/timestamp.
 */
export function compareEventsBySequence(a: LogEvent, b: LogEvent): number {
  const seqA = a.sequence != null && a.sequence >= 0 ? a.sequence : null;
  const seqB = b.sequence != null && b.sequence >= 0 ? b.sequence : null;

  if (seqA !== null && seqB !== null) {
    if (a.worker !== b.worker) return a.worker.localeCompare(b.worker);
    return seqA - seqB;
  }

  const tsA = a.ts ?? new Date(a.timestamp).getTime();
  const tsB = b.ts ?? new Date(b.timestamp).getTime();
  return tsA - tsB;
}

export interface WorkerInfo {
  id: string;
  lastSeen: string;
  eventCount: number;
  beadsCompleted: number;
  currentBead: string | null;
  status: 'active' | 'idle' | 'error';
  needleState?: NeedleState;
  currentTool?: string;
  recentEvents: LogEvent[];
  hasCollision?: boolean;
  activeFiles?: string[];
  stuck?: boolean;
  stuckReason?: string;
  // Memory fields from RSS sampling
  rssKb?: number;
  peakRssKb?: number;
  rssLimitBytes?: number;
  rssPercent?: number;
  swapKb?: number;
  pid?: number;
}

export interface FileCollision {
  path: string;
  workers: string[];
  detectedAt: string;
  isActive: boolean;
}

export interface WebSocketMessage {
  type: 'init' | 'event' | 'collision' | 'collision-alert';
  data: {
    workers?: WorkerInfo[];
    recentEvents?: LogEvent[];
    collisions?: FileCollision[];
    alerts?: CollisionAlert[];
  } | LogEvent | FileCollision | CollisionAlert;
}

// Cross-Reference Types
export type CrossReferenceEntityType = 'event' | 'bead' | 'file' | 'worker' | 'session';
export type CrossReferenceRelationship =
  | 'same_bead'
  | 'same_file'
  | 'same_worker'
  | 'temporal_proximity'
  | 'same_session'
  | 'dependency'
  | 'collision'
  | 'parent_child'
  | 'error_related'
  | 'tool_sequence';

export interface CrossReferenceLink {
  id: string;
  sourceType: CrossReferenceEntityType;
  sourceId: string;
  targetType: CrossReferenceEntityType;
  targetId: string;
  relationship: CrossReferenceRelationship;
  strength: number;
  detectedAt: number;
  context?: string;
}

export interface CrossReferenceEntity {
  type: CrossReferenceEntityType;
  id: string;
  label: string;
  linkCount: number;
  lastLinkedAt: number;
  firstSeen: number;
  occurrenceCount: number;
}

export interface CrossReferenceStats {
  totalLinks: number;
  totalEntities: number;
  byRelationship: Record<CrossReferenceRelationship, number>;
  byEntityType: Record<CrossReferenceEntityType, number>;
  mostLinked: CrossReferenceEntity[];
  recentLinks: CrossReferenceLink[];
}

export interface CrossReferencePath {
  start: CrossReferenceEntity;
  end: CrossReferenceEntity;
  steps: CrossReferenceLink[];
  length: number;
  description: string;
}

// Session Replay Types
export type ReplaySpeed = 0.5 | 1 | 2 | 5 | 10;
export type ReplayState = 'idle' | 'playing' | 'paused' | 'ended';

export interface ReplayProgress {
  current: number;
  total: number;
  percent: number;
}

// Collision Alert Types
export interface FileCollision {
  path: string;
  workers: string[];
  detectedAt: number;
  isActive: boolean;
  events?: LogEvent[];
}

export interface BeadCollision {
  beadId: string;
  workers: string[];
  detectedAt: number;
  isActive: boolean;
  severity: 'warning' | 'critical';
  events?: LogEvent[];
}

export interface TaskCollision {
  type: 'directory' | 'related_files' | 'dependency';
  description: string;
  workers: string[];
  affectedResources: string[];
  detectedAt: number;
  isActive: boolean;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface CollisionAlert {
  id: string;
  type: 'file' | 'bead' | 'task';
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  description: string;
  workers: string[];
  timestamp: number;
  acknowledged: boolean;
  collision: FileCollision | BeadCollision | TaskCollision;
  suggestion?: string;
}

// File Heatmap Types
export type HeatLevel = 'cold' | 'warm' | 'hot' | 'critical';

export interface WorkerFileContribution {
  workerId: string;
  modifications: number;
  lastModified: number;
  percentage: number;
}

export interface FileHeatmapEntry {
  path: string;
  modifications: number;
  heatLevel: HeatLevel;
  workers: WorkerFileContribution[];
  firstModified: number;
  lastModified: number;
  hasCollision: boolean;
  activeWorkers: number;
  avgModificationInterval: number;
}

export interface FileHeatmapStats {
  totalFiles: number;
  totalModifications: number;
  collisionFiles: number;
  activeFiles: number;
  heatDistribution: Record<HeatLevel, number>;
  mostActiveDirectory: string;
  avgModificationsPerFile: number;
}

export type HeatmapSortMode = 'modifications' | 'recent' | 'workers' | 'collisions';

// Dependency DAG Types
export type BeadStatus = 'open' | 'in_progress' | 'blocked' | 'completed' | 'closed' | 'deferred';

export interface BeadNode {
  id: string;
  title: string;
  status: BeadStatus;
  priority: number;
  depth: number;
  dependentCount: number;
  dependencyCount: number;
  isCriticalPath: boolean;
  estimatedEffort?: number;
}

export interface DependencyEdge {
  from: string;
  to: string;
  isCritical: boolean;
}

export interface DagComponent {
  nodes: BeadNode[];
  edges: DependencyEdge[];
  roots: string[];
  hasCycle: boolean;
  criticalPath: string[];
  maxDepth: number;
}

export interface DependencyGraph {
  components: DagComponent[];
  totalNodes: number;
  totalEdges: number;
  totalComponents: number;
  globalCriticalPath: string[];
  generatedAt: number;
}

export interface DagStats {
  totalBeads: number;
  blockedCount: number;
  readyCount: number;
  avgDependencies: number;
  avgDependents: number;
  maxDepth: number;
  cycleCount: number;
  criticalPathLength: number;
  criticalPathBeads: number;
}

export interface DagOptions {
  status?: BeadStatus | 'all';
  minPriority?: number;
  maxPriority?: number;
  criticalOnly?: boolean;
  maxDepth?: number;
  sortBy?: 'priority' | 'depth' | 'dependents';
  includeClosed?: boolean;
}

export type DagViewMode = 'tree' | 'blockers' | 'ready' | 'stats';

// ============================================
// Span DAG Types (OTLP span hierarchy)
// ============================================

export interface SpanNode {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  name: string;
  worker_id: string;
  bead_id: string | null;
  start_ts: number | null;
  end_ts: number | null;
  duration_ms: number | null;
  status: 'ok' | 'error' | 'unknown';
  attributes: Record<string, unknown>;
  children: SpanNode[];
}

export interface SpanDagResponse {
  roots: SpanNode[];
  totalSpans: number;
  traces: Array<{ trace_id: string; span_count: number }>;
}

// ============================================
// Recovery Playbook Types
// ============================================

export type ErrorCategory =
  | 'network'
  | 'permission'
  | 'validation'
  | 'resource'
  | 'not_found'
  | 'timeout'
  | 'syntax'
  | 'tool'
  | 'unknown';

export type RecoveryPriority = 'immediate' | 'high' | 'normal' | 'low';

export type RecoveryActionType =
  | 'retry'
  | 'backoff'
  | 'alternative'
  | 'escalate'
  | 'skip'
  | 'fix_config'
  | 'install_dep'
  | 'fix_permissions'
  | 'cleanup'
  | 'restart'
  | 'investigate';

export interface RecoveryAction {
  id: string;
  type: RecoveryActionType;
  title: string;
  description: string;
  priority: RecoveryPriority;
  automated: boolean;
  command?: string;
  expectedOutcome?: string;
  prerequisites?: string[];
  riskLevel?: 'safe' | 'moderate' | 'risky';
  estimatedTime?: number;
}

export interface RecoverySuggestion {
  id: string;
  errorGroupId: string;
  playbookId?: string;
  category: ErrorCategory;
  title: string;
  errorSummary: string;
  actions: RecoveryAction[];
  generatedAt: number;
  confidence: number;
  affectedWorkers: string[];
  relatedErrors?: string[];
  isActive: boolean;
}

export interface RecoveryStats {
  totalSuggestions: number;
  activeSuggestions: number;
  byCategory: Record<ErrorCategory, number>;
  automatedActions: number;
  manualActions: number;
  avgConfidence: number;
  topActionTypes: Array<{ type: RecoveryActionType; count: number }>;
}

// ============================================
// Fleet Analytics Types
// ============================================

export interface DurationBucket {
  label: string;
  range: string;
  count: number;
}

export interface ModelMetrics {
  model: string;
  beadsCompleted: number;
  avgDurationMs: number;
  medianDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  durationBuckets: DurationBucket[];
  shallowCount: number;
  shallowPercent: number;
}

export interface StrandMetrics {
  strand: string;
  invocations: number;
  successCount: number;
  failCount: number;
  successRate: number;
  totalDurationMs: number;
  avgDurationMs: number;
}

export interface ShallowCompletion {
  beadId: string;
  worker: string;
  model: string;
  durationMs: number;
  timestamp: number;
  session: string;
}

export interface BeadCompletion {
  beadId: string;
  worker: string;
  model: string;
  durationMs: number;
  timestamp: number;
  session: string;
  isShallow: boolean;
}

export interface FleetTimePoint {
  hour: string;
  activeWorkers: number;
  beadsCompleted: number;
  timestamp: number;
}

export interface WorkspaceEntry {
  workspace: string;
  workerCount: number;
  beadCount: number;
}

export interface ClaimRace {
  beadId: string;
  workers: string[];
  claimCount: number;
}

export interface FleetAnalytics {
  periodStart: number;
  periodEnd: number;
  totalEvents: number;
  logFiles: string[];
  modelMetrics: ModelMetrics[];
  strandMetrics: StrandMetrics[];
  shallowCompletions: ShallowCompletion[];
  totalCompletions: number;
  shallowPercent: number;
  claimRaces: ClaimRace[];
  fleetTimeSeries: FleetTimePoint[];
  workerRelaunchCount: number;
  workspaceCoverage: WorkspaceEntry[];
  beadsPerHour: number;
  beadCompletions: BeadCompletion[];
}

// ============================================
// Error Group Types
// ============================================

export interface ErrorFingerprint {
  signature: string;
  category: ErrorCategory;
  sampleMessage: string;
  hash: string;
}

export interface ErrorGroupCard {
  id: string;
  fingerprint: ErrorFingerprint;
  firstSeen: number;
  lastSeen: number;
  count: number;
  affectedWorkers: string[];
  isActive: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  recentEvents: Array<{
    timestamp: string;
    level: string;
    worker: string;
    message: string;
    tool?: string;
    ts?: number;
    error?: string;
  }>;
  sampleStack?: string;
}

export interface ErrorGroupStats {
  totalGroups: number;
  activeGroups: number;
  totalErrors: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
}

export interface SimilarError {
  id: number;
  session_id: string;
  worker_id: string;
  error_type: string;
  error_message: string;
  file_path: string | null;
  timestamp: number;
  resolution: string | null;
  resolution_successful: boolean | null;
  similarity: number;
}

// ============================================
// Conversation Transcript Types
// ============================================

// ============================================
// Session Digest Types
// ============================================

export interface DigestBeadCompletion {
  beadId: string;
  workerId: string;
  completedAt: number;
  durationMs?: number;
}

export interface DigestFileModification {
  path: string;
  modifications: number;
  workers: string[];
  tools: string[];
}

export interface DigestErrorOccurrence {
  message: string;
  category: ErrorCategory;
  workerId: string;
  timestamp: number;
  fingerprint?: string;
}

export interface DigestWorkerSummary {
  workerId: string;
  beadsCompleted: number;
  filesModified: number;
  errorsEncountered: number;
  totalEvents: number;
  activeTimeMs: number;
  firstActivity: number;
  lastActivity: number;
}

export interface SessionDigestData {
  sessionId: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  beadsCompleted: DigestBeadCompletion[];
  filesModified: DigestFileModification[];
  errors: DigestErrorOccurrence[];
  workers: DigestWorkerSummary[];
  cost: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
  };
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

export type DigestTab = 'summary' | 'beads' | 'files' | 'errors' | 'workers';

// ============================================
// Git Integration Types
// ============================================

export type GitFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'unmerged';

export interface GitFileChange {
  path: string;
  status: GitFileStatus;
  originalPath?: string;
  staged: boolean;
}

export interface GitStatusEvent {
  id: string;
  type: 'status';
  ts: number;
  worker: string;
  bead?: string;
  branch: string;
  commit?: string;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  untracked: string[];
  ahead?: number;
  behind?: number;
  tracking?: string;
}

export interface GitCommitEvent {
  id: string;
  type: 'commit';
  ts: number;
  worker: string;
  bead?: string;
  hash: string;
  message: string;
  branch?: string;
  author?: string;
  email?: string;
  parents?: string[];
  files?: GitFileChange[];
}

export interface PRFileChange extends GitFileChange {
  linesAdded: number;
  linesDeleted: number;
  worker?: string;
}

export interface PotentialConflict {
  hasUpstreamCommits: boolean;
  upstreamCommitCount: number;
  conflictingFiles: string[];
  rebaseRecommended: boolean;
  rebaseReason?: string;
}

export interface PRPreview {
  title: string;
  description: string;
  commitMessage: string;
  files: PRFileChange[];
  totalLinesAdded: number;
  totalLinesDeleted: number;
  filesChanged: number;
  conflicts: PotentialConflict;
  sourceBranch: string;
  targetBranch: string;
  ahead: number;
  behind: number;
  hasUncommittedChanges: boolean;
  generatedAt: number;
}

export interface GitStatusResponse {
  status: GitStatusEvent | null;
  commits: GitCommitEvent[];
  prPreview: PRPreview | null;
  hasConflicts: boolean;
  fileWorkerMap: Record<string, string[]>;
  totalGitEvents: number;
  updatedAt: number;
}

export type GitViewMode = 'status' | 'pr-preview' | 'diff';

export type ConversationTurnRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ConversationTurn {
  id: string;
  role: ConversationTurnRole;
  eventType: string;
  timestamp: number;
  content: string;
  isCollapsible: boolean;
  isCollapsed: boolean;
  tool?: string;
  durationMs?: number;
  error?: string;
  success?: boolean;
  sequence?: number;
  meta?: Record<string, unknown>;
}

// ============================================
// Semantic Narrative Types
// ============================================

export type EventPattern =
  | 'bead_started'
  | 'bead_completed'
  | 'file_editing'
  | 'file_created'
  | 'testing'
  | 'debugging'
  | 'git_operations'
  | 'dependency_install'
  | 'collision_detected'
  | 'error_recovery'
  | 'iteration'
  | 'investigation'
  | 'tool_usage'
  | 'error_handling'
  | 'task_completion'
  | 'exploration'
  | 'planning'
  | 'research';

export type NarrativeSentiment = 'productive' | 'struggling' | 'mixed' | 'idle';

export interface NarrativeSegmentView {
  id: string;
  pattern: EventPattern;
  summary: string;
  details?: string;
  startTime: number;
  endTime: number;
  durationMs: number;
  workerId: string;
  beadId?: string;
  entities: {
    files?: string[];
    tools?: string[];
    beads?: string[];
    errors?: string[];
  };
  confidence: number;
  isActive: boolean;
  eventCount: number;
}

export interface SemanticNarrativeView {
  id: string;
  workerId: string;
  title: string;
  summary: string;
  segments: NarrativeSegmentView[];
  fullNarrative: string;
  timeline: string[];
  startTime: number;
  endTime: number;
  durationMs: number;
  accomplishments: string[];
  challenges: string[];
  sentiment: NarrativeSentiment;
  stats: {
    totalEvents: number;
    segmentCount: number;
    beadsWorked: number;
    filesModified: number;
    errorsEncountered: number;
    toolsUsed: number;
  };
  generatedAt: number;
  isLive: boolean;
}
