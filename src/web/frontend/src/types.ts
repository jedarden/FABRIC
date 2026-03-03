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
  type: 'init' | 'event' | 'collision';
  data: {
    workers?: WorkerInfo[];
    recentEvents?: LogEvent[];
    collisions?: FileCollision[];
  } | LogEvent | FileCollision;
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
