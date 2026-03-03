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
  private fileModifications: Map<string, FileModificationTracker> = new Map();
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
    this.trackFileModification(event);

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
    this.fileModifications.clear();
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

  /**
   * Track file modifications for heatmap
   */
  private trackFileModification(event: LogEvent): void {
    if (!event.path || !this.isFileModification(event)) {
      return;
    }

    const path = event.path;
    const workerId = event.worker;
    let tracker = this.fileModifications.get(path);

    if (!tracker) {
      tracker = {
        path,
        modifications: 0,
        firstModified: event.ts,
        lastModified: event.ts,
        workerModifications: new Map(),
        timestamps: [],
      };
      this.fileModifications.set(path, tracker);
    }

    // Update modification count
    tracker.modifications++;
    tracker.lastModified = event.ts;
    tracker.timestamps.push(event.ts);

    // Track worker contribution
    const workerMods = tracker.workerModifications.get(workerId);
    if (workerMods) {
      workerMods.count++;
      workerMods.lastModified = event.ts;
    } else {
      tracker.workerModifications.set(workerId, {
        count: 1,
        lastModified: event.ts,
      });
    }
  }

  /**
   * Get heat level based on modification count
   */
  private getHeatLevel(modifications: number): HeatLevel {
    if (modifications >= HEAT_THRESHOLDS.critical) return 'critical';
    if (modifications >= HEAT_THRESHOLDS.hot) return 'hot';
    if (modifications >= HEAT_THRESHOLDS.warm) return 'warm';
    return 'cold';
  }

  /**
   * Calculate average modification interval
   */
  private calculateAvgInterval(timestamps: number[]): number {
    if (timestamps.length < 2) return 0;

    const sorted = [...timestamps].sort((a, b) => a - b);
    let totalInterval = 0;

    for (let i = 1; i < sorted.length; i++) {
      totalInterval += sorted[i] - sorted[i - 1];
    }

    return Math.floor(totalInterval / (sorted.length - 1));
  }

  /**
   * Get file heatmap entries
   */
  getFileHeatmap(options: HeatmapOptions = {}): FileHeatmapEntry[] {
    const {
      minModifications = 1,
      maxEntries = 50,
      sortBy = 'modifications',
      directoryFilter,
      collisionsOnly = false,
    } = options;

    const entries: FileHeatmapEntry[] = [];
    const now = Date.now();

    for (const tracker of this.fileModifications.values()) {
      // Apply filters
      if (tracker.modifications < minModifications) continue;

      if (directoryFilter && !tracker.path.startsWith(directoryFilter)) {
        continue;
      }

      const hasCollision = this.collisions.has(tracker.path) &&
        this.collisions.get(tracker.path)!.isActive;

      if (collisionsOnly && !hasCollision) continue;

      // Count active workers
      let activeWorkers = 0;
      for (const workerId of tracker.workerModifications.keys()) {
        const worker = this.workers.get(workerId);
        if (worker?.activeFiles.includes(tracker.path)) {
          activeWorkers++;
        }
      }

      // Build worker contributions
      const workers: WorkerFileContribution[] = [];
      for (const [workerId, data] of tracker.workerModifications) {
        workers.push({
          workerId,
          modifications: data.count,
          lastModified: data.lastModified,
          percentage: Math.round((data.count / tracker.modifications) * 100),
        });
      }

      // Sort workers by modification count
      workers.sort((a, b) => b.modifications - a.modifications);

      entries.push({
        path: tracker.path,
        modifications: tracker.modifications,
        heatLevel: this.getHeatLevel(tracker.modifications),
        workers,
        firstModified: tracker.firstModified,
        lastModified: tracker.lastModified,
        hasCollision,
        activeWorkers,
        avgModificationInterval: this.calculateAvgInterval(tracker.timestamps),
      });
    }

    // Sort entries
    switch (sortBy) {
      case 'modifications':
        entries.sort((a, b) => b.modifications - a.modifications);
        break;
      case 'recent':
        entries.sort((a, b) => b.lastModified - a.lastModified);
        break;
      case 'workers':
        entries.sort((a, b) => b.workers.length - a.workers.length);
        break;
      case 'collisions':
        entries.sort((a, b) => {
          // Prioritize files with collisions, then by modification count
          if (a.hasCollision !== b.hasCollision) {
            return a.hasCollision ? -1 : 1;
          }
          return b.modifications - a.modifications;
        });
        break;
    }

    return entries.slice(0, maxEntries);
  }

  /**
   * Get heatmap statistics
   */
  getFileHeatmapStats(): FileHeatmapStats {
    const entries = this.getFileHeatmap({ maxEntries: Infinity });

    let totalModifications = 0;
    let collisionFiles = 0;
    let activeFiles = 0;
    const heatDistribution: Record<HeatLevel, number> = {
      cold: 0,
      warm: 0,
      hot: 0,
      critical: 0,
    };

    const directoryCounts: Map<string, number> = new Map();

    for (const entry of entries) {
      totalModifications += entry.modifications;
      heatDistribution[entry.heatLevel]++;
      if (entry.hasCollision) collisionFiles++;
      if (entry.activeWorkers > 0) activeFiles++;

      // Track directory activity
      const dir = entry.path.substring(0, entry.path.lastIndexOf('/')) || '/';
      directoryCounts.set(dir, (directoryCounts.get(dir) || 0) + entry.modifications);
    }

    // Find most active directory
    let mostActiveDirectory = '/';
    let maxCount = 0;
    for (const [dir, count] of directoryCounts) {
      if (count > maxCount) {
        maxCount = count;
        mostActiveDirectory = dir;
      }
    }

    return {
      totalFiles: entries.length,
      totalModifications,
      collisionFiles,
      activeFiles,
      heatDistribution,
      mostActiveDirectory,
      avgModificationsPerFile: entries.length > 0
        ? Math.round(totalModifications / entries.length * 10) / 10
        : 0,
    };
  }

  /**
   * Get files modified by a specific worker
   */
  getWorkerFiles(workerId: string): FileHeatmapEntry[] {
    const entries = this.getFileHeatmap({ maxEntries: Infinity });
    return entries.filter(entry =>
      entry.workers.some(w => w.workerId === workerId)
    ).map(entry => ({
      ...entry,
      workers: entry.workers.filter(w => w.workerId === workerId),
    }));
  }

  /**
   * Get top collision risk files (high modification count + multiple workers)
   */
  getCollisionRiskFiles(threshold: number = 3): FileHeatmapEntry[] {
    const entries = this.getFileHeatmap({ maxEntries: Infinity });
    return entries
      .filter(entry => entry.workers.length >= threshold)
      .sort((a, b) => {
        // Sort by collision risk score: workers * modifications
        const scoreA = a.workers.length * a.modifications;
        const scoreB = b.workers.length * b.modifications;
        return scoreB - scoreA;
      })
      .slice(0, 20);
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
