/**
 * FABRIC In-Memory Event Store
 *
 * Stores and indexes LogEvents for efficient querying.
 * Includes collision detection for concurrent file modifications.
 * Includes error grouping for smart error clustering.
 */

import {
  LogEvent,
  WorkerInfo,
  WorkerStatus,
  EventFilter,
  EventStore,
  FileCollision,
  ErrorGroup,
  ErrorCategory,
  FileHeatmapEntry,
  FileHeatmapStats,
  HeatLevel,
  WorkerFileContribution,
  HeatmapOptions,
  BeadCollision,
  TaskCollision,
  CollisionAlert,
  RecoverySuggestion,
  RecoveryOptions,
  RecoveryStats,
  CrossReferenceLink,
  CrossReferenceEntity,
  CrossReferenceEntityType,
  CrossReferenceQueryOptions,
  CrossReferenceStats,
  CrossReferencePath,
  SemanticNarrative,
  NarrativeOptions,
  NarrativeUpdate,
} from './types.js';
import { ErrorGroupManager, getErrorGroupManager } from './errorGrouping.js';
import { RecoveryManager, getRecoveryManager } from './tui/utils/recoveryPlaybook.js';
import { CrossReferenceManager, getCrossReferenceManager } from './crossReferenceManager.js';
import { WorkerAnalytics, getWorkerAnalytics } from './workerAnalytics.js';
import { SemanticNarrativeGenerator, getSemanticNarrativeManager } from './semanticNarrative.js';

/** Time window (in ms) to consider events as concurrent */
const COLLISION_WINDOW_MS = 5000;

/** Time window for bead collision detection (longer since tasks span more time) */
const BEAD_COLLISION_WINDOW_MS = 60000; // 60 seconds

/** Time window for directory collision detection */
const DIRECTORY_COLLISION_WINDOW_MS = 30000; // 30 seconds

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
  private beadCollisions: Map<string, BeadCollision> = new Map();
  private taskCollisions: Map<string, TaskCollision> = new Map();
  private fileModifications: Map<string, FileModificationTracker> = new Map();
  private errorGroupManager: ErrorGroupManager;
  private recoveryManager: RecoveryManager;
  private crossReferenceManager: CrossReferenceManager;
  private workerAnalytics: WorkerAnalytics;
  private semanticNarrativeManager: SemanticNarrativeGenerator;
  private maxEvents: number;
  private alertCounter = 0;
  private batchBuffer: LogEvent[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;

  constructor(maxEvents: number = 10000) {
    this.maxEvents = maxEvents;
    this.errorGroupManager = new ErrorGroupManager();
    this.recoveryManager = getRecoveryManager();
    this.crossReferenceManager = getCrossReferenceManager();
    this.workerAnalytics = getWorkerAnalytics();
    this.semanticNarrativeManager = getSemanticNarrativeManager();
  }

  /**
   * Add an event to the store
   */
  add(event: LogEvent): void {
    this.events.push(event);
    this.updateWorkerInfo(event);
    this.detectCollision(event);
    this.detectBeadCollision(event);
    this.detectTaskCollision(event);
    this.trackFileModification(event);

    // Track errors in error groups
    if (event.level === 'error') {
      this.errorGroupManager.addError(event);
    }

    // Process event for cross-references (immediate)
    this.crossReferenceManager.processEvent(event);

    // Process event for worker analytics
    this.workerAnalytics.processEvent(event);

    // Process event for semantic narrative (real-time)
    this.semanticNarrativeManager.processEvent(event);

    // Add to batch buffer for relationship detection
    this.batchBuffer.push(event);
    this.scheduleBatchProcessing();

    // Trim if over limit
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  /**
   * Schedule batch processing for cross-reference relationship detection
   */
  private scheduleBatchProcessing(): void {
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }

    this.batchTimeout = setTimeout(() => {
      if (this.batchBuffer.length > 0) {
        this.crossReferenceManager.processBatch([...this.batchBuffer]);
        this.batchBuffer = [];
      }
      this.batchTimeout = null;
    }, 1000); // Process batch every 1 second
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
    this.beadCollisions.clear();
    this.taskCollisions.clear();
    this.fileModifications.clear();
    this.errorGroupManager.clear();
    this.crossReferenceManager.clear();
    this.batchBuffer = [];
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
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
        activeBead: event.bead,
        activeDirectories: [],
        collisionTypes: [],
        eventCount: 1,
      };
      this.workers.set(event.worker, worker);
    } else {
      // Increment event count
      worker.eventCount++;
    }

    // Update last activity
    worker.lastActivity = event.ts;

    // Track active bead
    if (event.bead) {
      worker.activeBead = event.bead;
    }

    // Track active files
    if (event.path && this.isFileModification(event)) {
      if (!worker.activeFiles.includes(event.path)) {
        worker.activeFiles.push(event.path);
      }
      // Track directory
      const directory = event.path.substring(0, event.path.lastIndexOf('/')) || '/';
      if (!worker.activeDirectories.includes(directory)) {
        worker.activeDirectories.push(directory);
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
      // Clear active files and bead on completion
      worker.activeFiles = [];
      worker.activeBead = undefined;
    } else if (event.msg.includes('Starting') || event.msg.includes('starting')) {
      worker.status = 'active';
    }

    // Update last event
    worker.lastEvent = event;

    // Update collision status (check all collision types)
    const hasFileCollision = this.getWorkerCollisions(worker.id).length > 0;
    const hasBeadCollision = this.getWorkerBeadCollisions(worker.id).length > 0;
    const hasTaskCollision = this.getWorkerTaskCollisions(worker.id).length > 0;
    worker.hasCollision = hasFileCollision || hasBeadCollision || hasTaskCollision;
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

  // ============================================
  // Bead Collision Detection
  // ============================================

  /**
   * Detect bead collision when multiple workers work on the same bead
   */
  private detectBeadCollision(event: LogEvent): void {
    if (!event.bead) return;

    const beadId = event.bead;
    const workerId = event.worker;

    // Look for other workers working on the same bead
    const recentEvents = this.events.filter(e => {
      if (e.bead !== beadId) return false;
      if (e.worker === workerId) return false;
      if (Math.abs(e.ts - event.ts) > BEAD_COLLISION_WINDOW_MS) return false;
      return true;
    });

    if (recentEvents.length > 0) {
      // Bead collision detected!
      const collisionKey = `bead:${beadId}`;
      const workers = new Set<string>([workerId]);
      const collisionEvents: LogEvent[] = [event];

      for (const e of recentEvents) {
        workers.add(e.worker);
        collisionEvents.push(e);
      }

      // Determine severity based on tool usage
      const allTools = collisionEvents.map(e => e.tool).filter(Boolean);
      const hasWriteTools = allTools.some(t => FILE_MODIFICATION_TOOLS.includes(t || ''));
      const severity: 'warning' | 'critical' = hasWriteTools ? 'critical' : 'warning';

      // Update or create collision record
      const existing = this.beadCollisions.get(collisionKey);
      if (existing) {
        for (const w of workers) {
          if (!existing.workers.includes(w)) {
            existing.workers.push(w);
          }
        }
        existing.events.push(event);
        existing.detectedAt = event.ts;
        existing.severity = severity;
      } else {
        const collision: BeadCollision = {
          beadId,
          workers: Array.from(workers),
          detectedAt: event.ts,
          events: collisionEvents,
          isActive: true,
          severity,
        };
        this.beadCollisions.set(collisionKey, collision);
      }

      // Update worker collision status
      for (const w of workers) {
        const workerInfo = this.workers.get(w);
        if (workerInfo) {
          workerInfo.hasCollision = true;
          if (!workerInfo.collisionTypes.includes('bead')) {
            workerInfo.collisionTypes.push('bead');
          }
        }
      }
    }
  }

  /**
   * Get all active bead collisions
   */
  getBeadCollisions(): BeadCollision[] {
    this.cleanupStaleBeadCollisions();
    return Array.from(this.beadCollisions.values()).filter(c => c.isActive);
  }

  /**
   * Get bead collisions for a specific worker
   */
  getWorkerBeadCollisions(workerId: string): BeadCollision[] {
    return this.getBeadCollisions().filter(c => c.workers.includes(workerId));
  }

  /**
   * Clean up stale bead collisions
   */
  private cleanupStaleBeadCollisions(): void {
    const now = Date.now();
    const staleThreshold = 120000; // 2 minutes

    for (const [key, collision] of this.beadCollisions) {
      // Check if all involved workers are still working on this bead
      const isStale = collision.workers.every(workerId => {
        const worker = this.workers.get(workerId);
        if (!worker) return true;
        if (worker.activeBead !== collision.beadId) return true;
        if (now - collision.detectedAt > staleThreshold) return true;
        return false;
      });

      if (isStale) {
        collision.isActive = false;
        // Update worker collision status
        for (const workerId of collision.workers) {
          const worker = this.workers.get(workerId);
          if (worker) {
            worker.collisionTypes = worker.collisionTypes.filter(t => t !== 'bead');
            worker.hasCollision = worker.collisionTypes.length > 0 || this.getWorkerCollisions(workerId).length > 0 || this.getWorkerTaskCollisions(workerId).length > 0;
          }
        }
      }
    }
  }

  // ============================================
  // Task Collision Detection
  // ============================================

  /**
   * Detect task collision when workers work in the same directory
   */
  private detectTaskCollision(event: LogEvent): void {
    if (!event.path) return;

    const workerId = event.worker;
    const directory = event.path.substring(0, event.path.lastIndexOf('/')) || '/';

    // Track directory for this worker
    const worker = this.workers.get(workerId);
    if (worker) {
      if (!worker.activeDirectories.includes(directory)) {
        worker.activeDirectories.push(directory);
      }
    }

    // Look for other workers in the same directory
    const workersInDir = Array.from(this.workers.values()).filter(w => {
      if (w.id === workerId) return false;
      if (!w.activeDirectories.includes(directory)) return false;
      return true;
    });

    if (workersInDir.length > 0) {
      // Task collision detected - workers in same directory
      const collisionKey = `task:dir:${directory}`;
      const involvedWorkers = [workerId, ...workersInDir.map(w => w.id)];

      // Determine risk level based on activity
      const activeCount = involvedWorkers.filter(wId => {
        const w = this.workers.get(wId);
        return w?.status === 'active';
      }).length;

      const riskLevel: 'low' | 'medium' | 'high' = activeCount >= 3 ? 'high' : (activeCount >= 2 ? 'medium' : 'low');

      const existing = this.taskCollisions.get(collisionKey);
      if (existing) {
        // Update existing collision
        for (const w of involvedWorkers) {
          if (!existing.workers.includes(w)) {
            existing.workers.push(w);
          }
        }
        existing.detectedAt = event.ts;
        existing.riskLevel = riskLevel;
      } else {
        const collision: TaskCollision = {
          type: 'directory',
          description: `Multiple workers active in ${directory}`,
          workers: involvedWorkers,
          affectedResources: [directory],
          detectedAt: event.ts,
          isActive: true,
          riskLevel,
        };
        this.taskCollisions.set(collisionKey, collision);
      }

      // Update worker collision status
      for (const w of involvedWorkers) {
        const workerInfo = this.workers.get(w);
        if (workerInfo) {
          workerInfo.hasCollision = true;
          if (!workerInfo.collisionTypes.includes('task')) {
            workerInfo.collisionTypes.push('task');
          }
        }
      }
    }
  }

  /**
   * Get all active task collisions
   */
  getTaskCollisions(): TaskCollision[] {
    this.cleanupStaleTaskCollisions();
    return Array.from(this.taskCollisions.values()).filter(c => c.isActive);
  }

  /**
   * Get task collisions for a specific worker
   */
  getWorkerTaskCollisions(workerId: string): TaskCollision[] {
    return this.getTaskCollisions().filter(c => c.workers.includes(workerId));
  }

  /**
   * Clean up stale task collisions
   */
  private cleanupStaleTaskCollisions(): void {
    const now = Date.now();
    const staleThreshold = 60000; // 1 minute

    for (const [key, collision] of this.taskCollisions) {
      const isStale = collision.workers.every(workerId => {
        const worker = this.workers.get(workerId);
        if (!worker) return true;
        if (worker.status !== 'active') return true;
        if (now - collision.detectedAt > staleThreshold) return true;
        return false;
      });

      if (isStale) {
        collision.isActive = false;
        for (const workerId of collision.workers) {
          const worker = this.workers.get(workerId);
          if (worker) {
            worker.collisionTypes = worker.collisionTypes.filter(t => t !== 'task');
            worker.hasCollision = worker.collisionTypes.length > 0;
          }
        }
      }
    }
  }

  // ============================================
  // Collision Alerts
  // ============================================

  /**
   * Generate collision alerts for all active collisions
   */
  generateCollisionAlerts(): CollisionAlert[] {
    const alerts: CollisionAlert[] = [];

    // Generate file collision alerts
    for (const collision of this.getCollisions()) {
      const severity = this.mapCollisionSeverity('file', collision);
      alerts.push({
        id: `alert:file:${collision.path}:${collision.detectedAt}`,
        type: 'file',
        severity,
        title: `File Collision: ${collision.path}`,
        description: `${collision.workers.length} workers modifying the same file concurrently`,
        workers: collision.workers,
        timestamp: collision.detectedAt,
        acknowledged: false,
        collision,
        suggestion: 'Consider coordinating changes or having workers take turns on this file.',
      });
    }

    // Generate bead collision alerts
    for (const collision of this.getBeadCollisions()) {
      const severity = this.mapCollisionSeverity('bead', collision);
      alerts.push({
        id: `alert:bead:${collision.beadId}:${collision.detectedAt}`,
        type: 'bead',
        severity,
        title: `Task Collision: ${collision.beadId}`,
        description: `${collision.workers.length} workers working on the same bead concurrently`,
        workers: collision.workers,
        timestamp: collision.detectedAt,
        acknowledged: false,
        collision,
        suggestion: collision.severity === 'critical'
          ? 'URGENT: One worker should claim this bead exclusively.'
          : 'Monitor for potential duplicate work.',
      });
    }

    // Generate task collision alerts
    for (const collision of this.getTaskCollisions()) {
      const severity = this.mapCollisionSeverity('task', collision);
      alerts.push({
        id: `alert:task:${collision.type}:${collision.detectedAt}`,
        type: 'task',
        severity,
        title: `Directory Collision: ${collision.affectedResources[0]}`,
        description: `${collision.workers.length} workers active in the same directory`,
        workers: collision.workers,
        timestamp: collision.detectedAt,
        acknowledged: false,
        collision,
        suggestion: collision.riskLevel === 'high'
          ? 'High collision risk - consider task reassignment.'
          : 'Monitor for potential conflicts.',
      });
    }

    return alerts.sort((a, b) => {
      const severityOrder = { critical: 0, error: 1, warning: 2, info: 3 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }

  /**
   * Map collision to alert severity
   */
  private mapCollisionSeverity(
    type: 'file' | 'bead' | 'task',
    collision: FileCollision | BeadCollision | TaskCollision
  ): 'info' | 'warning' | 'error' | 'critical' {
    if (type === 'bead') {
      const beadCollision = collision as BeadCollision;
      return beadCollision.severity === 'critical' ? 'error' : 'warning';
    }

    if (type === 'task') {
      const taskCollision = collision as TaskCollision;
      if (taskCollision.riskLevel === 'high') return 'error';
      if (taskCollision.riskLevel === 'medium') return 'warning';
      return 'info';
    }

    // File collision - check worker count
    const fileCollision = collision as FileCollision;
    if (fileCollision.workers.length >= 3) return 'error';
    return 'warning';
  }

  /**
   * Get all collision alerts (including acknowledged ones)
   */
  getAllCollisionAlerts(): CollisionAlert[] {
    return this.generateCollisionAlerts();
  }

  /**
   * Acknowledge a collision alert
   */
  acknowledgeAlert(alertId: string): void {
    // Alerts are regenerated on each call, so we need to track acknowledged IDs
    // This is a simplified implementation - in production you'd want persistent storage
    const alerts = this.generateCollisionAlerts();
    const alert = alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
    }
  }

  /**
   * Get collision statistics
   */
  getCollisionStats(): {
    totalFileCollisions: number;
    totalBeadCollisions: number;
    totalTaskCollisions: number;
    activeFileCollisions: number;
    activeBeadCollisions: number;
    activeTaskCollisions: number;
    workersWithCollisions: number;
    criticalAlerts: number;
  } {
    const workers = Array.from(this.workers.values());
    return {
      totalFileCollisions: this.collisions.size,
      totalBeadCollisions: this.beadCollisions.size,
      totalTaskCollisions: this.taskCollisions.size,
      activeFileCollisions: this.getCollisions().length,
      activeBeadCollisions: this.getBeadCollisions().length,
      activeTaskCollisions: this.getTaskCollisions().length,
      workersWithCollisions: workers.filter(w => w.hasCollision).length,
      criticalAlerts: this.generateCollisionAlerts().filter(a => a.severity === 'error' || a.severity === 'critical').length,
    };
  }

  // ============================================
  // Recovery Suggestion Methods
  // ============================================

  /**
   * Get recovery suggestions for all active errors
   */
  getRecoverySuggestions(options?: RecoveryOptions): RecoverySuggestion[] {
    const errorGroups = this.getActiveErrorGroups();
    return this.recoveryManager.generateAllSuggestions(errorGroups, options);
  }

  /**
   * Get recovery suggestions for a specific worker
   */
  getWorkerRecoverySuggestions(workerId: string): RecoverySuggestion[] {
    const errorGroups = this.getWorkerErrorGroups(workerId);
    return this.recoveryManager.generateAllSuggestions(errorGroups, { workerId });
  }

  /**
   * Get recovery suggestions for a specific error group
   */
  getErrorRecoverySuggestions(errorGroupId: string): RecoverySuggestion | null {
    const errorGroup = this.errorGroupManager.getGroup(errorGroupId);
    if (!errorGroup) return null;
    return this.recoveryManager.generateSuggestion(errorGroup);
  }

  /**
   * Get recovery statistics
   */
  getRecoveryStats(): RecoveryStats {
    return this.recoveryManager.getStats();
  }

  // ============================================
  // Worker Analytics Methods
  // ============================================

  /**
   * Get worker analytics instance
   */
  getWorkerAnalytics(): WorkerAnalytics {
    return this.workerAnalytics;
  }

  /**
   * Get analytics metrics for a specific worker
   */
  getWorkerMetrics(workerId: string, options?: any) {
    return this.workerAnalytics.getWorkerMetrics(workerId, options);
  }

  /**
   * Get analytics metrics for all workers
   */
  getAllWorkerMetrics(options?: any) {
    return this.workerAnalytics.getAllWorkerMetrics(options);
  }

  /**
   * Get aggregated analytics across all workers
   */
  getAggregatedAnalytics(options?: any) {
    return this.workerAnalytics.getAggregatedAnalytics(options);
  }

  /**
   * Get performance trends for a worker
   */
  getPerformanceTrends(workerId: string, metric: any, options?: any) {
    return this.workerAnalytics.getPerformanceTrends(workerId, metric, options);
  }

  /**
   * Get worker analytics summary
   */
  getAnalyticsSummary(options?: any): string {
    return this.workerAnalytics.getSummary(options);
  }

  /**
   * Get all available recovery playbooks
   */
  getRecoveryPlaybooks() {
    return this.recoveryManager.getPlaybooks();
  }

  /**
   * Clear all recovery suggestions
   */
  clearRecoverySuggestions(): void {
    this.recoveryManager.clear();
  }

  // ============================================
  // Cross-Reference Methods
  // ============================================

  /**
   * Query cross-references with optional filter
   */
  queryCrossReferences(filter?: CrossReferenceQueryOptions): CrossReferenceLink[] {
    return this.crossReferenceManager.query(filter);
  }

  /**
   * Get all links for a specific entity
   */
  getCrossReferenceLinksForEntity(
    type: CrossReferenceEntityType,
    id: string
  ): CrossReferenceLink[] {
    return this.crossReferenceManager.getLinksForEntity(type, id);
  }

  /**
   * Get linked entities for a specific entity
   */
  getLinkedEntities(
    type: CrossReferenceEntityType,
    id: string
  ): CrossReferenceEntity[] {
    return this.crossReferenceManager.getLinkedEntities(type, id);
  }

  /**
   * Find a navigation path between two entities
   */
  findCrossReferencePath(
    sourceType: CrossReferenceEntityType,
    sourceId: string,
    targetType: CrossReferenceEntityType,
    targetId: string,
    maxDepth?: number
  ): CrossReferencePath | null {
    return this.crossReferenceManager.findPath(
      sourceType,
      sourceId,
      targetType,
      targetId,
      maxDepth
    );
  }

  /**
   * Get cross-reference statistics
   */
  getCrossReferenceStats(): CrossReferenceStats {
    return this.crossReferenceManager.getStats();
  }

  /**
   * Get entity by type and ID
   */
  getCrossReferenceEntity(
    type: CrossReferenceEntityType,
    id: string
  ): CrossReferenceEntity | undefined {
    return this.crossReferenceManager.getEntity(type, id);
  }

  /**
   * Get all cross-reference entities
   */
  getAllCrossReferenceEntities(): CrossReferenceEntity[] {
    return this.crossReferenceManager.getAllEntities();
  }

  /**
   * Get all cross-reference links
   */
  getAllCrossReferenceLinks(): CrossReferenceLink[] {
    return this.crossReferenceManager.getAllLinks();
  }

  /**
   * Clear all cross-references
   */
  clearCrossReferences(): void {
    this.crossReferenceManager.clear();
  }

  // ============================================
  // Semantic Narrative Methods
  // ============================================

  /**
   * Generate semantic narrative for a specific worker
   */
  generateNarrative(workerId: string, options?: NarrativeOptions): SemanticNarrative {
    return this.semanticNarrativeManager.generateNarrative(workerId, options);
  }

  /**
   * Generate aggregated narrative for all workers
   */
  generateAggregatedNarrative(options?: NarrativeOptions): SemanticNarrative {
    return this.semanticNarrativeManager.generateAggregatedNarrative(options);
  }

  /**
   * Get all active narratives
   */
  getActiveNarratives(): SemanticNarrative[] {
    return this.semanticNarrativeManager.getActiveNarratives();
  }

  /**
   * Get narrative by ID
   */
  getNarrative(narrativeId: string): SemanticNarrative | undefined {
    return this.semanticNarrativeManager.getNarrative(narrativeId);
  }

  /**
   * Subscribe to narrative updates
   */
  onNarrativeUpdate(callback: (update: NarrativeUpdate) => void): () => void {
    return this.semanticNarrativeManager.onUpdate(callback);
  }

  /**
   * Format narrative as markdown
   */
  formatNarrative(narrative: SemanticNarrative, style?: 'brief' | 'detailed' | 'timeline' | 'technical'): string {
    return this.semanticNarrativeManager.formatNarrative(narrative, style);
  }

  /**
   * Get semantic narrative manager instance
   */
  getSemanticNarrativeManager(): SemanticNarrativeGenerator {
    return this.semanticNarrativeManager;
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
