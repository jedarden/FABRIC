// FABRIC Web Frontend Types

export interface LogEvent {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  worker: string;
  tool?: string;
  message: string;
  raw: string;
  bead?: string; // Bead/task identifier for Focus Mode
}

export interface WorkerInfo {
  id: string;
  lastSeen: string;
  eventCount: number;
  status: 'active' | 'idle' | 'error';
  currentTool?: string;
  recentEvents: LogEvent[];
  hasCollision?: boolean;
  activeFiles?: string[];
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
