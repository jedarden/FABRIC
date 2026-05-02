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
  NeedleState,
  needleStateToStatus,
  VALID_TRANSITIONS,
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
  FileAnomaly,
  AnomalyDetectionOptions,
  AnomalyStats,
  TimelapseOptions,
  HeatmapTimelapse,
  HeatmapSnapshot,
  compareEventsBySequence,
} from './types.js';
import { isWorkerStuck } from './tui/utils/stuckDetection.js';
import { detectAnomalies, getAnomalyStats } from './tui/utils/fileAnomalyDetection.js';
import { ErrorGroupManager, getErrorGroupManager } from './errorGrouping.js';
import { RecoveryManager, getRecoveryManager } from './tui/utils/recoveryPlaybook.js';
import { CrossReferenceManager, getCrossReferenceManager } from './crossReferenceManager.js';
import { WorkerAnalytics, getWorkerAnalytics } from './workerAnalytics.js';
import { CostTracker } from './tui/utils/costTracking.js';
import { SemanticNarrativeGenerator, getSemanticNarrativeManager } from './semanticNarrative.js';
import { HistoricalStore, getHistoricalStore } from './historicalStore.js';

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
  avgModificationInterval?: number;
}

/** Max events stored in collision records before trimming. */
const MAX_COLLISION_EVENTS = 50;

/** Max timestamps retained per file in the heatmap tracker. */
const MAX_FILE_TIMESTAMPS = 200;

/** Max age (ms) for taskStartTimes entries before considering them abandoned. */
const TASK_START_MAX_AGE_MS = 86_400_000; // 24 hours

/** Max age (ms) for inactive collision entries before deletion from the map. */
const STALE_COLLISION_MAX_AGE_MS = 300_000; // 5 minutes

/** Max age (ms) for inactive fileModification entries before deletion. */
const STALE_FILE_MOD_MAX_AGE_MS = 3_600_000; // 1 hour

/** Max files retained per worker in activeFiles/activeDirectories arrays. */
const MAX_WORKER_ACTIVE_FILES = 200;

/** How many events to trim at once (batch trim amortises O(n) splice cost). */
const TRIM_BATCH_SIZE = 100;

/** Max events buffered before batch processing flushes immediately. */
const MAX_BATCH_BUFFER_SIZE = 500;

/** Max age (ms) for inactive workers before pruning from the workers map. */
const STALE_WORKER_MAX_AGE_MS = 3_600_000; // 1 hour

export class InMemoryEventStore implements EventStore {
  private events: LogEvent[] = [];
  private sequenceIndex: Map<string, LogEvent> = new Map(); // key: `${worker}:${sequence}`
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
  private historicalStore: HistoricalStore;
  private maxEvents: number;
  private alertCounter = 0;
  private batchBuffer: LogEvent[] = [];
  private batchTimeout: NodeJS.Timeout | null = null;
  private sessionStartTime: number = 0;
  private taskStartTimes: Map<string, number> = new Map(); // beadId -> startTime
  /** Index of file-path → last modification timestamp — used by detectCollision for O(1) lookups. */
  private recentFileMods: Map<string, { workerId: string; ts: number }[]> = new Map();

  constructor(maxEvents: number = 10000) {
    this.maxEvents = maxEvents;
    this.errorGroupManager = new ErrorGroupManager();
    this.recoveryManager = getRecoveryManager();
    this.crossReferenceManager = getCrossReferenceManager();
    this.workerAnalytics = getWorkerAnalytics();
    this.semanticNarrativeManager = getSemanticNarrativeManager();
    this.historicalStore = getHistoricalStore();
    this.sessionStartTime = Date.now();
    this.historicalStore.startSession();
  }

  /**
   * Add an event to the store
   */
  add(event: LogEvent): void {
    this.events.push(event);

    // Populate secondary index keyed on (worker, sequence)
    if (event.sequence != null && event.sequence >= 0) {
      this.sequenceIndex.set(`${event.worker}:${event.sequence}`, event);
    }

    this.updateWorkerInfo(event);
    this.detectCollision(event);
    this.detectBeadCollision(event);
    this.detectTaskCollision(event);
    this.trackFileModification(event);

    // Track task starts and completions for historical storage
    if (event.bead) {
      this.trackTaskForHistory(event);
    }

    // Track errors in error groups
    if (event.level === 'error') {
      this.errorGroupManager.addError(event);
    }

    // Process event for cross-references (immediate)
    this.crossReferenceManager.processEvent(event);

    // Process event for worker analytics (also feeds MetricAccumulator)
    this.workerAnalytics.processEvent(event);

    // Drain OTLP metric samples to SQLite for persistence
    this.flushMetricSamples();

    // Process event for semantic narrative (real-time)
    this.semanticNarrativeManager.processEvent(event);

    // Add to batch buffer for relationship detection
    if (this.batchBuffer.length < MAX_BATCH_BUFFER_SIZE) {
      this.batchBuffer.push(event);
    }
    this.scheduleBatchProcessing();

    // Trim events when exceeding the limit (keeps most recent)
    if (this.events.length > this.maxEvents) {
      const removeCount = this.events.length - this.maxEvents;
      const removed = this.events.splice(0, removeCount);
      // Prune sequenceIndex entries for the evicted events
      for (const ev of removed) {
        if (ev.sequence != null && ev.sequence >= 0) {
          this.sequenceIndex.delete(`${ev.worker}:${ev.sequence}`);
        }
      }
    }

    // Periodic cleanup of stale secondary structures (every 10k events)
    if (this.events.length % 10_000 === 0) {
      this.cleanupStaleSecondaryData();
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
        const batch = this.batchBuffer;
        this.batchBuffer = [];
        this.crossReferenceManager.processBatch(batch);
      }
      this.batchTimeout = null;
    }, 1000);
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
   * Query events sorted by (worker, sequence), falling back to ts.
   * This is the authoritative ordering — use instead of timestamp-based sort.
   */
  queryOrdered(filter?: EventFilter): LogEvent[] {
    return this.query(filter).sort(compareEventsBySequence);
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
    // Persist session data before clearing
    this.persistSession();

    this.events = [];
    this.sequenceIndex.clear();
    this.workers.clear();
    this.collisions.clear();
    this.beadCollisions.clear();
    this.taskCollisions.clear();
    this.fileModifications.clear();
    this.recentFileMods.clear();
    this.errorGroupManager.clear();
    this.crossReferenceManager.clear();
    this.batchBuffer = [];
    this.taskStartTimes.clear();
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
      this.batchTimeout = null;
    }
  }

  /**
   * Flush accumulated OTLP metric samples from the MetricAccumulator
   * into the metric_samples SQLite table, upsert per-worker session
   * summaries, and update the live session with the latest aggregates.
   */
  private flushMetricSamples(): void {
    const accumulator = this.workerAnalytics.getMetricAccumulator();
    const samples = accumulator.drainSamples();
    for (const s of samples) {
      this.historicalStore.recordMetricSample({
        workerId: s.workerId,
        metricName: s.metricName,
        value: s.value,
        timestamp: s.timestamp,
        source: 'otlp-metric',
        beadId: s.beadId,
      });
    }

    // Upsert per-worker session summaries from the accumulator snapshots.
    // Only write rows for workers that have actual OTLP metric snapshots —
    // the upsert will protect any existing metric-sourced rows from
    // lower-priority log-derived overwrites.
    const hasMetricData = accumulator.hasMetricData();
    if (hasMetricData) {
      const allWorkerMetrics = this.workerAnalytics.getAllWorkerMetrics({ timeWindow: 'all' });
      for (const wm of allWorkerMetrics) {
        const metricSnap = accumulator.getSnapshot(wm.workerId);
        if (!metricSnap) continue;
        this.historicalStore.upsertSessionWorkerSummary({
          workerId: wm.workerId,
          tokensIn: metricSnap.tokensIn,
          tokensOut: metricSnap.tokensOut,
          costUsd: metricSnap.costUsd,
          beadsCompleted: metricSnap.beadsCompleted,
          beadsFailed: metricSnap.beadsFailed,
          errors: metricSnap.errors,
          metricsSource: 'otlp-metric',
        });
      }
    }

    // Update the live session row with current metric-derived aggregates
    if (samples.length > 0 || hasMetricData) {
      const analytics = this.workerAnalytics.getAggregatedAnalytics({ timeWindow: 'all' });
      this.historicalStore.updateLiveSession({
        workerCount: this.workers.size,
        taskCount: analytics.totalBeadsCompleted,
        totalCost: analytics.totalCostUsd,
        totalTokens: analytics.totalTokens,
        metricsSource: hasMetricData ? 'otlp-metric' : 'log-derived',
      });
    }
  }

  /**
   * Periodic cleanup of secondary data structures that can grow stale.
   */
  private cleanupStaleSecondaryData(): void {
    const now = Date.now();

    // Clean up abandoned task start times
    for (const [beadId, startTime] of this.taskStartTimes) {
      if (now - startTime > TASK_START_MAX_AGE_MS) {
        this.taskStartTimes.delete(beadId);
      }
    }

    // Clean up recentFileMods entries that are past the collision window
    for (const [path, mods] of this.recentFileMods) {
      const cutoff = now - COLLISION_WINDOW_MS;
      while (mods.length > 0 && mods[0].ts < cutoff) {
        mods.shift();
      }
      if (mods.length === 0) {
        this.recentFileMods.delete(path);
      }
    }

    // Delete inactive collisions past their retention window
    const staleCollisionCutoff = now - STALE_COLLISION_MAX_AGE_MS;
    for (const [key, c] of this.collisions) {
      if (!c.isActive && c.detectedAt < staleCollisionCutoff) {
        this.collisions.delete(key);
      }
    }
    for (const [key, c] of this.beadCollisions) {
      if (!c.isActive && c.detectedAt < staleCollisionCutoff) {
        this.beadCollisions.delete(key);
      }
    }
    for (const [key, c] of this.taskCollisions) {
      if (!c.isActive && c.detectedAt < staleCollisionCutoff) {
        this.taskCollisions.delete(key);
      }
    }

    // Delete stale fileModification trackers
    const staleFileModCutoff = now - STALE_FILE_MOD_MAX_AGE_MS;
    for (const [path, tracker] of this.fileModifications) {
      if (tracker.lastModified < staleFileModCutoff) {
        this.fileModifications.delete(path);
      } else {
        // Prune per-worker entries for workers no longer in the active set
        for (const wId of tracker.workerModifications.keys()) {
          if (!this.workers.has(wId)) {
            tracker.workerModifications.delete(wId);
          }
        }
      }
    }

    // Prune workers with no recent activity
    const staleWorkerCutoff = now - STALE_WORKER_MAX_AGE_MS;
    for (const [workerId, worker] of this.workers) {
      if (worker.status !== 'active' && worker.lastActivity < staleWorkerCutoff) {
        this.workers.delete(workerId);
      }
    }
  }

  /**
   * Persist current session to historical store
   */
  private persistSession(): void {
    if (this.events.length === 0) return;

    // Calculate session metrics
    const analytics = this.workerAnalytics.getAggregatedAnalytics({ timeWindow: 'all' });

    // End the historical session
    const hasMetricData = this.workerAnalytics.getMetricAccumulator().hasMetricData();
    this.historicalStore.endSession({
      workerCount: this.workers.size,
      taskCount: analytics.totalBeadsCompleted,
      totalCost: analytics.totalCostUsd,
      totalTokens: analytics.totalTokens,
      metricsSource: hasMetricData ? 'otlp-metric' : 'log-derived',
    });

    // Record any completed tasks that haven't been recorded yet
    for (const [beadId, startTime] of this.taskStartTimes) {
      // Find the completion event for this bead
      const completionEvent = this.events.find(e =>
        e.bead === beadId &&
        (e.msg === 'bead.completed' || e.msg === 'bead.failed')
      );

      if (completionEvent) {
        // Find which worker worked on this bead
        const workerEvents = this.events.filter(e => e.bead === beadId);
        const workerId = workerEvents[0]?.worker || 'unknown';

        // Prefer OTLP metric snapshot over log-derived estimates
        const accumulator = this.workerAnalytics.getMetricAccumulator();
        const metricSnap = accumulator.getSnapshot(workerId);

        let tokensIn: number;
        let tokensOut: number;
        let cost: number;

        if (metricSnap) {
          tokensIn = metricSnap.tokensIn;
          tokensOut = metricSnap.tokensOut;
          cost = metricSnap.costUsd;
        } else {
          const costSummary = this.workerAnalytics.getAllWorkerMetrics({ workerIds: [workerId] });
          cost = costSummary[0]?.totalCostUsd || 0;
          const workerTokens = costSummary[0]?.totalTokens || 0;
          tokensIn = Math.floor(workerTokens * 0.7);
          tokensOut = Math.floor(workerTokens * 0.3);
        }

        this.historicalStore.recordTask({
          workerId,
          taskType: 'bead',
          startedAt: startTime,
          endedAt: completionEvent.ts,
          cost,
          tokensIn,
          tokensOut,
          success: completionEvent.level !== 'error',
          retryCount: 0,
        });
      }
    }

    // Record errors from error groups
    const errorGroups = this.errorGroupManager.getGroups();
    for (const group of errorGroups) {
      for (const event of group.events) {
        this.historicalStore.recordError({
          workerId: event.worker,
          errorType: group.fingerprint.category,
          errorMessage: group.fingerprint.sampleMessage,
          filePath: event.path,
          timestamp: event.ts,
        });
      }
    }

    // Start a new session
    this.sessionStartTime = Date.now();
    this.historicalStore.startSession();
  }

  /**
   * Get historical store for queries
   */
  getHistoricalStore(): HistoricalStore {
    return this.historicalStore;
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

  /** Expose historical store for error history queries */
  get historical(): HistoricalStore {
    return this.historicalStore;
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

    // Track active files (bounded to prevent unbounded growth)
    if (event.path && this.isFileModification(event)) {
      if (!worker.activeFiles.includes(event.path)) {
        worker.activeFiles.push(event.path);
        if (worker.activeFiles.length > MAX_WORKER_ACTIVE_FILES) {
          worker.activeFiles = worker.activeFiles.slice(-MAX_WORKER_ACTIVE_FILES);
        }
      }
      // Track directory
      const directory = event.path.substring(0, event.path.lastIndexOf('/')) || '/';
      if (!worker.activeDirectories.includes(directory)) {
        worker.activeDirectories.push(directory);
        if (worker.activeDirectories.length > MAX_WORKER_ACTIVE_FILES) {
          worker.activeDirectories = worker.activeDirectories.slice(-MAX_WORKER_ACTIVE_FILES);
        }
      }
    }

    // Handle worker.state_transition events (authoritative state machine)
    const needleEvent = event.msg;
    if (needleEvent === 'worker.state_transition') {
      const from = event.from as string | undefined;
      const to = event.to as string | undefined;
      if (to && this.isValidNeedleState(to)) {
        worker.needleState = to as NeedleState;
        worker.lastStateTransition = event.ts;
        worker.status = event.level === 'error' ? 'error' : needleStateToStatus(to as NeedleState);
      }
    } else {
      // Fallback: infer state from legacy event types when no state_transition events arrive
      if (event.level === 'error') {
        worker.status = 'error';
      } else if (
        needleEvent === 'bead.completed' ||
        needleEvent === 'worker.idle' ||
        needleEvent === 'worker.stopped' ||
        needleEvent === 'worker.draining'
      ) {
        worker.status = 'idle';
        if (needleEvent === 'bead.completed' && event.bead) {
          worker.beadsCompleted++;
        }
        if (needleEvent === 'bead.completed') {
          worker.activeFiles = [];
          worker.activeDirectories = [];
          worker.activeBead = undefined;
        }
      } else if (
        needleEvent === 'worker.started' ||
        needleEvent === 'bead.claimed' ||
        needleEvent === 'bead.agent_started' ||
        needleEvent === 'execution.started'
      ) {
        worker.status = 'active';
      }
    }

    // Update last event
    worker.lastEvent = event;

    // Run gap-based stuck detection (throttled — only every 100 events per worker)
    if (worker.eventCount % 100 === 0) {
      const stuckPattern = isWorkerStuck(worker, this.events);
      worker.stuck = stuckPattern != null;
      worker.stuckReason = stuckPattern?.reason ?? undefined;
    }

    // Update collision status (throttled — only when a new collision is detected
    // or every 500 events per worker to avoid O(collisions × workers) per event)
    if (this.collisions.has(event.path || '') ||
        (event.bead && this.beadCollisions.has(`bead:${event.bead}`)) ||
        worker.eventCount % 500 === 0) {
      const hasFileCollision = this.getWorkerCollisions(worker.id).length > 0;
      const hasBeadCollision = this.getWorkerBeadCollisions(worker.id).length > 0;
      const hasTaskCollision = this.getWorkerTaskCollisions(worker.id).length > 0;
      worker.hasCollision = hasFileCollision || hasBeadCollision || hasTaskCollision;
    }
  }

  /**
   * Check if a string is a valid NeedleState value.
   */
  private isValidNeedleState(value: string): value is NeedleState {
    return ['BOOTING', 'SELECTING', 'CLAIMING', 'WORKING', 'CLOSING', 'STOPPED'].includes(value);
  }

  /**
   * Check if event represents a file modification
   */
  private isFileModification(event: LogEvent): boolean {
    if (!event.tool) return false;
    return FILE_MODIFICATION_TOOLS.includes(event.tool);
  }

  /**
   * Track task events for historical storage
   */
  private trackTaskForHistory(event: LogEvent): void {
    const beadId = event.bead!;

    // Track task start
    if (!this.taskStartTimes.has(beadId)) {
      this.taskStartTimes.set(beadId, event.ts);
    }

    // Check for task completion — match on NEEDLE event type exactly
    const msg = event.msg || '';
    if (msg === 'bead.completed' || msg === 'bead.failed') {
      const startTime = this.taskStartTimes.get(beadId);
      if (startTime) {
        const durationMs = event.ts - startTime;

        // Prefer OTLP metric snapshot over log-derived estimates
        const accumulator = this.workerAnalytics.getMetricAccumulator();
        const metricSnap = accumulator.getSnapshot(event.worker);

        let tokensIn: number;
        let tokensOut: number;
        let cost: number;

        if (metricSnap) {
          tokensIn = metricSnap.tokensIn;
          tokensOut = metricSnap.tokensOut;
          cost = metricSnap.costUsd;
        } else {
          // Fallback: log-derived estimate with 70/30 split
          const workerMetrics = this.workerAnalytics.getWorkerMetrics(event.worker);
          cost = workerMetrics?.costPerBead || 0;
          tokensIn = Math.floor((workerMetrics?.totalTokens || 0) * 0.7);
          tokensOut = Math.floor((workerMetrics?.totalTokens || 0) * 0.3);
        }

        this.historicalStore.recordTask({
          workerId: event.worker,
          taskType: 'bead',
          startedAt: startTime,
          endedAt: event.ts,
          cost,
          tokensIn,
          tokensOut,
          success: event.level !== 'error',
          retryCount: 0,
        });

        // Clean up
        this.taskStartTimes.delete(beadId);
      }
    }
  }

  /**
   * Detect collision when a file modification event occurs.
   * Uses recentFileMods index for O(k) lookups instead of scanning all events.
   */
  private detectCollision(event: LogEvent): void {
    if (!event.path || !this.isFileModification(event)) {
      return;
    }

    const path = event.path;
    const workerId = event.worker;

    // Maintain the per-file recent modifications index
    let mods = this.recentFileMods.get(path);
    if (!mods) {
      mods = [];
      this.recentFileMods.set(path, mods);
    }
    mods.push({ workerId, ts: event.ts });

    // Trim index entries older than the collision window
    const cutoff = event.ts - COLLISION_WINDOW_MS;
    while (mods.length > 0 && mods[0].ts < cutoff) {
      mods.shift();
    }

    // Check for collisions: other workers modifying same file within window
    const otherWorkers = new Set<string>();
    for (const m of mods) {
      if (m.workerId !== workerId) {
        otherWorkers.add(m.workerId);
      }
    }

    if (otherWorkers.size > 0) {
      const collisionKey = path;
      const workers = new Set<string>([workerId, ...otherWorkers]);

      const existing = this.collisions.get(collisionKey);
      if (existing) {
        for (const w of workers) {
          if (!existing.workers.includes(w)) {
            existing.workers.push(w);
          }
        }
        if (existing.events.length < MAX_COLLISION_EVENTS) {
          existing.events.push(event);
        }
        existing.detectedAt = event.ts;
      } else {
        const collision: FileCollision = {
          path,
          workers: Array.from(workers),
          detectedAt: event.ts,
          events: [event],
          isActive: true,
        };
        this.collisions.set(collisionKey, collision);
      }

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
    if (tracker.timestamps.length < MAX_FILE_TIMESTAMPS) {
      tracker.timestamps.push(event.ts);
    }

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
   * Get heatmap timelapse data for animation
   */
  getHeatmapTimelapse(options: TimelapseOptions = {}): HeatmapTimelapse {
    const {
      startTimestamp,
      endTimestamp,
      snapshotCount = 30,
      minModifications = 1,
      maxEntries = 50,
      sortBy = 'modifications',
      directoryFilter,
      collisionsOnly = false,
    } = options;

    // Determine time range
    let oldestTimestamp = Date.now();
    let newestTimestamp = Date.now();

    for (const tracker of this.fileModifications.values()) {
      if (tracker.firstModified < oldestTimestamp) {
        oldestTimestamp = tracker.firstModified;
      }
      if (tracker.lastModified > newestTimestamp) {
        newestTimestamp = tracker.lastModified;
      }
    }

    const start = startTimestamp ?? oldestTimestamp;
    const end = endTimestamp ?? newestTimestamp;
    const interval = Math.max(1, Math.floor((end - start) / snapshotCount));

    // Generate snapshots
    const snapshots: HeatmapSnapshot[] = [];
    for (let i = 0; i <= snapshotCount; i++) {
      const snapshotTime = start + (i * interval);
      if (snapshotTime > end) break;

      // Get heatmap state at this point in time
      const entries: FileHeatmapEntry[] = [];
      for (const tracker of this.fileModifications.values()) {
        // Skip files that didn't exist yet or don't meet threshold
        if (tracker.firstModified > snapshotTime) continue;
        if (tracker.modifications < minModifications) continue;

        // Apply directory filter
        if (directoryFilter && !tracker.path.startsWith(directoryFilter)) {
          continue;
        }

        // Check for collisions at this point in time
        const hasCollision = this.collisions.has(tracker.path) &&
          this.collisions.get(tracker.path)!.isActive;

        if (collisionsOnly && !hasCollision) continue;

        // Count active workers at this point in time
        let activeWorkers = 0;
        const workerMods: WorkerFileContribution[] = [];
        let totalModsAtTime = 0;

        for (const [workerId, modData] of tracker.workerModifications) {
          if (modData.lastModified <= snapshotTime) {
            activeWorkers++;
            const mods = modData.count;
            totalModsAtTime += mods;
            workerMods.push({
              workerId,
              modifications: mods,
              lastModified: modData.lastModified,
              percentage: 0, // Will be calculated
            });
          }
        }

        if (totalModsAtTime === 0) continue;

        // Calculate percentages
        for (const w of workerMods) {
          w.percentage = Math.round((w.modifications / totalModsAtTime) * 100);
        }

        // Calculate heat level based on modifications at this point in time
        let heatLevel: HeatLevel = 'cold';
        if (totalModsAtTime >= 20) heatLevel = 'critical';
        else if (totalModsAtTime >= 10) heatLevel = 'hot';
        else if (totalModsAtTime >= 5) heatLevel = 'warm';

        entries.push({
          path: tracker.path,
          modifications: totalModsAtTime,
          heatLevel,
          workers: workerMods,
          firstModified: tracker.firstModified,
          lastModified: Math.min(tracker.lastModified, snapshotTime),
          hasCollision,
          activeWorkers,
          avgModificationInterval: tracker.avgModificationInterval ?? 0,
        });
      }

      // Sort entries
      const sortedEntries = this.sortHeatmapEntries(entries, sortBy).slice(0, maxEntries);

      // Calculate stats for this snapshot
      const stats = this.calculateStatsForEntries(sortedEntries);

      snapshots.push({
        timestamp: snapshotTime,
        entries: sortedEntries,
        stats,
      });
    }

    return {
      startTimestamp: start,
      endTimestamp: end,
      interval,
      totalSnapshots: snapshots.length,
      snapshots,
    };
  }

  /**
   * Sort heatmap entries by the specified mode
   */
  private sortHeatmapEntries(entries: FileHeatmapEntry[], sortBy: string): FileHeatmapEntry[] {
    switch (sortBy) {
      case 'recent':
        return [...entries].sort((a, b) => b.lastModified - a.lastModified);
      case 'workers':
        return [...entries].sort((a, b) => b.workers.length - a.workers.length);
      case 'collisions':
        return [...entries].sort((a, b) => (b.hasCollision ? 1 : 0) - (a.hasCollision ? 1 : 0));
      default: // modifications
        return [...entries].sort((a, b) => b.modifications - a.modifications);
    }
  }

  /**
   * Calculate stats for a set of heatmap entries
   */
  private calculateStatsForEntries(entries: FileHeatmapEntry[]): FileHeatmapStats {
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

      const dir = entry.path.substring(0, entry.path.lastIndexOf('/')) || '/';
      directoryCounts.set(dir, (directoryCounts.get(dir) || 0) + entry.modifications);
    }

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
  // File Anomaly Detection
  // ============================================

  /**
   * Get file anomalies detected from current activity
   */
  getFileAnomalies(options: AnomalyDetectionOptions = {}): FileAnomaly[] {
    const entries = this.getFileHeatmap({ maxEntries: Infinity });
    return detectAnomalies(entries, options);
  }

  /**
   * Get statistics about detected anomalies
   */
  getAnomalyStats(): AnomalyStats {
    const anomalies = this.getFileAnomalies();
    return getAnomalyStats(anomalies);
  }

  // ============================================
  // Bead Collision Detection
  // ============================================

  /**
   * Detect bead collision when multiple workers work on the same bead.
   * Uses worker activeBead tracking for O(1) lookup instead of scanning all events.
   */
  private detectBeadCollision(event: LogEvent): void {
    if (!event.bead) return;

    const beadId = event.bead;
    const workerId = event.worker;

    // Check if any other worker is currently assigned to this bead
    // AND was recently active (within collision time window)
    const otherWorkersOnBead: string[] = [];
    for (const [wId, worker] of this.workers) {
      if (wId !== workerId && worker.activeBead === beadId) {
        // Only consider it a collision if the other worker was recently active
        const timeSinceActivity = event.ts - worker.lastActivity;
        if (timeSinceActivity <= BEAD_COLLISION_WINDOW_MS) {
          otherWorkersOnBead.push(wId);
        }
      }
    }

    if (otherWorkersOnBead.length > 0) {
      // Bead collision detected!
      const collisionKey = `bead:${beadId}`;
      // Include ALL workers involved: current worker + other workers on same bead
      const workers = new Set<string>([workerId, ...otherWorkersOnBead]);
      const collisionEvents: LogEvent[] = [event];

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
        if (existing.events.length < MAX_COLLISION_EVENTS) {
          existing.events.push(event);
        }
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
   * Get cost tracker instance for budget/cost data
   */
  getCostTracker(): CostTracker {
    return this.workerAnalytics.getCostTracker();
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
