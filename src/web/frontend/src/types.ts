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
