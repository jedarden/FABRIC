/**
 * FABRIC In-Memory Event Store
 *
 * Stores and indexes LogEvents for efficient querying.
 * Includes collision detection for concurrent file modifications.
 * Includes error grouping for smart error clustering.
 */

import { LogEvent, WorkerInfo, WorkerStatus, EventFilter, EventStore, FileCollision, ErrorGroup, ErrorCategory, FileHeatmapEntry, FileHeatmapStats, HeatLevel, WorkerFileContribution, HeatmapOptions } from './types.js';
import { ErrorGroupManager, getErrorGroupManager } from './errorGrouping.js';

/** Time window (in ms) to consider events as concurrent */
const COLLISION_WINDOW_MS = 5000;

/** File operations that indicate modification */
const FILE_MODIFICATION_TOOLS = ['Edit', 'Write', 'NotebookEdit'];

/** Heat level thresholds (modifications count) */
const HEAT_THRESHOLDS = {
  cold: 1,      // 1-2 modifications
  warm: 3,      // 3-5 modifications
  hot: 6,       // 6-10 modifications
  critical: 11, // 11+ modifications
};

/**
 * Internal tracking structure for file modifications
 */
interface FileModificationTracker {
  path: string;
  modifications: number;
  firstModified: number;
  lastModified: number;
  workerModifications: Map<string, { count: number; lastModified: number }>;
  timestamps: number[];
}

export class InMemoryEventStore implements EventStore {
  private events: LogEvent[] = [];
  private workers: Map<string, WorkerInfo> = new Map();
  private collisions: Map<string, FileCollision> = new Map();
  private errorGroupManager: ErrorGroupManager;
  private maxEvents: number;

  constructor(maxEvents: number = 10000) {
    this.maxEvents = maxEvents;
    this.errorGroupManager = new ErrorGroupManager();
  }

  /**
   * Add an event to the store
   */
  add(event: LogEvent): void {
    this.events.push(event);
    this.updateWorkerInfo(event);
    this.detectCollision(event);

    // Track errors in error groups
    if (event.level === 'error') {
      this.errorGroupManager.addError(event);
    }

    // Trim if over limit
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  /**
   * Query events with optional filter
   */
  query(filter?: EventFilter): LogEvent[] {
    if (!filter) {
      return [...this.events];
    }

    return this.events.filter((event) => {
      if (filter.worker && event.worker !== filter.worker) return false;
      if (filter.level && event.level !== filter.level) return false;
      if (filter.bead && event.bead !== filter.bead) return false;
      if (filter.path && event.path !== filter.path) return false;
      if (filter.since && event.ts < filter.since) return false;
      if (filter.until && event.ts > filter.until) return false;
      return true;
    });
  }

  /**
   * Get worker info
   */
  getWorker(workerId: string): WorkerInfo | undefined {
    return this.workers.get(workerId);
  }

  /**
   * Get all workers
   */
  getWorkers(): WorkerInfo[] {
    return Array.from(this.workers.values());
  }

  /**
   * Get all active collisions
   */
  getCollisions(): FileCollision[] {
    // Clean up stale collisions first
    this.cleanupStaleCollisions();
    return Array.from(this.collisions.values()).filter(c => c.isActive);
  }

  /**
   * Get collisions for a specific worker
   */
  getWorkerCollisions(workerId: string): FileCollision[] {
    return this.getCollisions().filter(c => c.workers.includes(workerId));
  }

  /**
   * Clear all events
   */
  clear(): void {
    this.events = [];
    this.workers.clear();
    this.collisions.clear();
    this.errorGroupManager.clear();
  }

  /**
   * Get all error groups
   */
  getErrorGroups(): ErrorGroup[] {
    return this.errorGroupManager.getGroups();
  }

  /**
   * Get active error groups only
   */
  getActiveErrorGroups(): ErrorGroup[] {
    return this.errorGroupManager.getActiveGroups();
  }

  /**
   * Get error groups for a specific worker
   */
  getWorkerErrorGroups(workerId: string): ErrorGroup[] {
    return this.errorGroupManager.getWorkerGroups(workerId);
  }

  /**
   * Get error groups by category
   */
  getErrorGroupsByCategory(category: ErrorCategory): ErrorGroup[] {
    return this.errorGroupManager.getGroupsByCategory(category);
  }

  /**
   * Get error group statistics
   */
  getErrorStats(): {
    totalGroups: number;
    activeGroups: number;
    totalErrors: number;
    byCategory: Record<ErrorCategory, number>;
    bySeverity: Record<string, number>;
  } {
    return this.errorGroupManager.getStats();
  }

  /**
   * Get event count
   */
  get size(): number {
    return this.events.length;
  }

  /**
   * Update worker info based on event
   */
  private updateWorkerInfo(event: LogEvent): void {
    let worker = this.workers.get(event.worker);

    if (!worker) {
      worker = {
        id: event.worker,
        status: 'active',
        beadsCompleted: 0,
        firstSeen: event.ts,
        lastActivity: event.ts,
        activeFiles: [],
        hasCollision: false,
      };
      this.workers.set(event.worker, worker);
    }

    // Update last activity
    worker.lastActivity = event.ts;

    // Track active files
    if (event.path && this.isFileModification(event)) {
      if (!worker.activeFiles.includes(event.path)) {
        worker.activeFiles.push(event.path);
      }
    }

    // Update status based on event
    if (event.level === 'error') {
      worker.status = 'error';
    } else if (event.msg.includes('completed') || event.msg.includes('complete')) {
      worker.status = 'idle';
      if (event.bead) {
        worker.beadsCompleted++;
      }
      // Clear active files on completion
      worker.activeFiles = [];
    } else if (event.msg.includes('Starting') || event.msg.includes('starting')) {
      worker.status = 'active';
    }

    // Update last event
    worker.lastEvent = event;

    // Update collision status
    worker.hasCollision = this.getWorkerCollisions(worker.id).length > 0;
  }

  /**
   * Check if event represents a file modification
   */
  private isFileModification(event: LogEvent): boolean {
    if (!event.tool) return false;
    return FILE_MODIFICATION_TOOLS.includes(event.tool);
  }

  /**
   * Detect collision when a file modification event occurs
   */
  private detectCollision(event: LogEvent): void {
    if (!event.path || !this.isFileModification(event)) {
      return;
    }

    const path = event.path;
    const workerId = event.worker;

    // Look for other workers modifying the same file within the time window
    const recentEvents = this.events.filter(e => {
      if (e.path !== path) return false;
      if (e.worker === workerId) return false;
      if (!this.isFileModification(e)) return false;
      if (Math.abs(e.ts - event.ts) > COLLISION_WINDOW_MS) return false;
      return true;
    });

    if (recentEvents.length > 0) {
      // Collision detected!
      const collisionKey = path;
      const workers = new Set<string>([workerId]);
      const collisionEvents: LogEvent[] = [event];

      for (const e of recentEvents) {
        workers.add(e.worker);
        collisionEvents.push(e);
      }

      // Update or create collision record
      const existing = this.collisions.get(collisionKey);
      if (existing) {
        // Add new worker if not already tracked
        for (const w of workers) {
          if (!existing.workers.includes(w)) {
            existing.workers.push(w);
          }
        }
        existing.events.push(event);
        existing.detectedAt = event.ts;
      } else {
        const collision: FileCollision = {
          path,
          workers: Array.from(workers),
          detectedAt: event.ts,
          events: collisionEvents,
          isActive: true,
        };
        this.collisions.set(collisionKey, collision);
      }

      // Update collision status for all involved workers
      for (const w of workers) {
        const workerInfo = this.workers.get(w);
        if (workerInfo) {
          workerInfo.hasCollision = true;
        }
      }
    }
  }

  /**
   * Clean up collisions that are no longer active
   */
  private cleanupStaleCollisions(): void {
    const now = Date.now();
    const staleThreshold = 30000; // 30 seconds

    for (const [key, collision] of this.collisions) {
      // Check if all involved workers are still active on this file
      const isStale = collision.workers.every(workerId => {
        const worker = this.workers.get(workerId);
        if (!worker) return true;
        if (!worker.activeFiles.includes(collision.path)) return true;
        if (now - collision.detectedAt > staleThreshold) return true;
        return false;
      });

      if (isStale) {
        collision.isActive = false;
        // Update worker collision status
        for (const workerId of collision.workers) {
          const worker = this.workers.get(workerId);
          if (worker) {
            worker.hasCollision = this.getWorkerCollisions(workerId).some(c => c.isActive);
          }
        }
      }
    }
  }
}

/**
 * Create a singleton store instance
 */
let globalStore: InMemoryEventStore | undefined;

export function getStore(): InMemoryEventStore {
  if (!globalStore) {
    globalStore = new InMemoryEventStore();
  }
  return globalStore;
}

export function resetStore(): void {
  globalStore = undefined;
}
