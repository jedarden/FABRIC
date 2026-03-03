// FABRIC Web Frontend Types

export interface LogEvent {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  worker: string;
  tool?: string;
  message: string;
  raw: string;
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
