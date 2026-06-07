/**
 * Worker Analytics Aggregation
 *
 * Tracks and aggregates worker performance metrics:
 * - Beads per hour
 * - Average completion time
 * - Error rate
 * - Cost per bead
 * - Idle percentage
 * - Time-series data
 */

import {
  LogEvent,
  WorkerMetrics,
  MetricsDataPoint,
  PerformanceTrend,
  AggregatedAnalytics,
  WorkerAnalyticsOptions,
  WorkerAnalyticsStore,
  TimeWindow,
  WorkerComparison,
} from './types.js';
import { CostTracker } from './tui/utils/costTracking.js';
import { getHistoricalStore, HistoricalStore, WorkerComparisonMetrics } from './historicalStore.js';

// ── Canonical OTLP metric instrument names ───────────────────────

export const INSTRUMENT_NAMES = {
  TOKENS_IN:       'needle.worker.tokens.in',
  TOKENS_OUT:      'needle.worker.tokens.out',
  COST_USD:        'needle.worker.cost.usd',
  BEAD_DURATION:   'needle.bead.duration',
  BEAD_COMPLETED:  'needle.bead.completed',
  BEAD_FAILED:     'needle.bead.failed',
  WORKER_ERRORS:   'needle.worker.errors',
  WORKER_UPTIME:   'needle.worker.uptime',
} as const;

const ALL_INSTRUMENTS = new Set(Object.values(INSTRUMENT_NAMES));

/**
 * Alias map: NEEDLE's OTLP emitter uses `needle.worker.beads.*` (plural)
 * while the canonical schema uses `needle.bead.*` (singular). Both forms
 * are accepted and resolved to the canonical name before accumulation.
 */
const INSTRUMENT_ALIASES: Record<string, string> = {
  'needle.worker.beads.completed': INSTRUMENT_NAMES.BEAD_COMPLETED,
  'needle.worker.beads.failed':    INSTRUMENT_NAMES.BEAD_FAILED,
};

/** Resolve an incoming metric name to its canonical instrument name. */
export function resolveInstrumentName(name: string): string {
  return INSTRUMENT_ALIASES[name] || name;
}

// ── MetricAccumulator ────────────────────────────────────────────

export interface MetricSample {
  workerId: string;
  metricName: string;
  value: number;
  timestamp: number;
  beadId?: string;
}

export interface WorkerMetricSnapshot {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  beadsCompleted: number;
  beadsFailed: number;
  errors: number;
  durations: number[];
}

/**
 * Accumulates OTLP metric data points, keyed by (worker, instrument).
 * drainSamples() is called periodically by the store to flush to SQLite.
 */
export class MetricAccumulator {
  private samples: MetricSample[] = [];
  private hasData = false;

  /** Per-worker running totals for cumulative instruments */
  private workerTotals = new Map<string, Map<string, number>>();

  /** Per-worker bead duration samples */
  private workerDurations = new Map<string, number[]>();

  /** Per-worker bead completion/failure counts */
  private workerBeadCompleted = new Map<string, number>();
  private workerBeadFailed = new Map<string, number>();
  private workerErrors = new Map<string, number>();

  /**
   * Ingest a LogEvent that was produced by normalizing an OTLP metric.
   * event.msg is "metric.<name>" and event.value / event.metric_name carry the payload.
   */
  processEvent(event: LogEvent): void {
    const msg = event.msg || '';
    if (!msg.startsWith('metric.')) return;

    const rawName = (event.metric_name as string) || msg.slice(7);
    if (!rawName) return;

    // Resolve NEEDLE's naming convention to canonical instrument name
    const metricName = resolveInstrumentName(rawName);

    const value = typeof event.value === 'number' ? event.value
      : typeof event.metric_value === 'number' ? event.metric_value as number
      : undefined;
    if (value === undefined) return;

    this.hasData = true;

    const sample: MetricSample = {
      workerId: event.worker,
      metricName,
      value,
      timestamp: event.ts,
    };
    if (event.bead) sample.beadId = event.bead;

    this.samples.push(sample);

    // Update per-worker running totals
    if (!this.workerTotals.has(event.worker)) {
      this.workerTotals.set(event.worker, new Map());
    }
    const totals = this.workerTotals.get(event.worker)!;

    switch (metricName) {
      case INSTRUMENT_NAMES.TOKENS_IN:
      case INSTRUMENT_NAMES.TOKENS_OUT:
      case INSTRUMENT_NAMES.COST_USD:
        totals.set(metricName, (totals.get(metricName) || 0) + value);
        break;
      case INSTRUMENT_NAMES.BEAD_DURATION: {
        let durations = this.workerDurations.get(event.worker);
        if (!durations) {
          durations = [];
          this.workerDurations.set(event.worker, durations);
        }
        durations.push(value);
        break;
      }
      case INSTRUMENT_NAMES.BEAD_COMPLETED:
        this.workerBeadCompleted.set(event.worker,
          (this.workerBeadCompleted.get(event.worker) || 0) + value);
        break;
      case INSTRUMENT_NAMES.BEAD_FAILED:
        this.workerBeadFailed.set(event.worker,
          (this.workerBeadFailed.get(event.worker) || 0) + value);
        break;
      case INSTRUMENT_NAMES.WORKER_ERRORS:
        this.workerErrors.set(event.worker,
          (this.workerErrors.get(event.worker) || 0) + value);
        break;
    }
  }

  /**
   * Drain buffered samples for SQLite persistence.
   * Returns the samples and clears the buffer.
   */
  drainSamples(): MetricSample[] {
    const drained = this.samples;
    this.samples = [];
    return drained;
  }

  /**
   * Whether any OTLP metric data has been received.
   */
  hasMetricData(): boolean {
    return this.hasData;
  }

  /**
   * Get a snapshot of accumulated metric values for a specific worker.
   * Returns null if no metric data exists for this worker.
   */
  getSnapshot(workerId: string): WorkerMetricSnapshot | null {
    const totals = this.workerTotals.get(workerId);
    if (!totals && !this.workerDurations.has(workerId)
        && !this.workerBeadCompleted.has(workerId)) {
      return null;
    }

    return {
      tokensIn: totals?.get(INSTRUMENT_NAMES.TOKENS_IN) || 0,
      tokensOut: totals?.get(INSTRUMENT_NAMES.TOKENS_OUT) || 0,
      costUsd: totals?.get(INSTRUMENT_NAMES.COST_USD) || 0,
      beadsCompleted: this.workerBeadCompleted.get(workerId) || 0,
      beadsFailed: this.workerBeadFailed.get(workerId) || 0,
      errors: this.workerErrors.get(workerId) || 0,
      durations: this.workerDurations.get(workerId) || [],
    };
  }

  /** Reset all accumulated data. */
  reset(): void {
    this.samples = [];
    this.hasData = false;
    this.workerTotals.clear();
    this.workerDurations.clear();
    this.workerBeadCompleted.clear();
    this.workerBeadFailed.clear();
    this.workerErrors.clear();
  }
}

const DEFAULT_OPTIONS: Required<WorkerAnalyticsOptions> = {
  timeWindow: 'all',
  startTime: 0,
  endTime: 0, // 0 means "use worker's last activity time"
  workerIds: [],
  minBeadsCompleted: 0,
  maxWorkers: 10,
  includeTimeSeries: false,
  timeSeriesInterval: 3600000, // 1 hour
};

/** Maximum entries retained for unbounded-per-worker arrays. */
const MAX_EVENT_TIMESTAMPS = 5000;
const MAX_ERROR_TIMESTAMPS = 500;
const MAX_ACTIVITY_PERIODS = 500;
const MAX_BEAD_COMPLETION_TIMES = 500;

/** Maximum number of workers to track in analytics (LRU eviction). */
const MAX_WORKERS = 1000;

/** Maximum age (ms) for inactive workers before pruning from analytics. */
const STALE_WORKER_MAX_AGE_MS = 3_600_000; // 1 hour

/**
 * Internal tracking data for a worker
 */
interface WorkerTrackingData {
  workerId: string;
  firstSeen: number;
  lastSeen: number;
  lastActivity: number;

  // Bead tracking
  beadsCompleted: number;
  beadsReleased: number;
  beadStartTimes: Map<string, number>; // beadId -> start timestamp
  beadCompletionTimes: number[]; // completion durations in ms

  // Error tracking
  errorCount: number;
  errorTimestamps: number[];

  // Activity tracking
  eventTimestamps: number[];
  activityPeriods: Array<{ start: number; end: number }>;

  // Cost tracking (updated from CostTracker)
  totalCostUsd: number;
  totalTokens: number;

  // Time-series snapshots
  timeSeriesData: MetricsDataPoint[];
}

/**
 * Worker Analytics Manager
 */
export class WorkerAnalytics implements WorkerAnalyticsStore {
  private workers: Map<string, WorkerTrackingData> = new Map();
  private costTracker: CostTracker;
  private timeSeriesInterval: number;
  private lastSnapshotTime: number = 0;
  private metricAccumulator: MetricAccumulator;
  private workerLRU: string[] = []; // Least recently used at front
  private eventCountForCleanup: number = 0;

  constructor(costTracker?: CostTracker, timeSeriesInterval: number = 3600000) {
    this.costTracker = costTracker || new CostTracker();
    this.timeSeriesInterval = timeSeriesInterval;
    this.metricAccumulator = new MetricAccumulator();
  }

  /**
   * Process an event and update analytics
   */
  processEvent(event: LogEvent): void {
    // Update cost tracker
    this.costTracker.processEvent(event);

    // Get or create worker tracking data
    let worker = this.workers.get(event.worker);
    if (!worker) {
      // Enforce worker cap with LRU eviction
      if (this.workers.size >= MAX_WORKERS) {
        this.evictLRUWorker();
      }
      worker = this.createWorkerTrackingData(event.worker, event.ts);
      this.workers.set(event.worker, worker);
      this.workerLRU.push(event.worker);
    } else {
      // Update LRU order (move to end)
      this.touchWorkerLRU(event.worker);
    }

    // Update activity tracking
    worker.lastSeen = event.ts;
    worker.eventTimestamps.push(event.ts);
    if (worker.eventTimestamps.length > MAX_EVENT_TIMESTAMPS) {
      worker.eventTimestamps = worker.eventTimestamps.slice(-MAX_EVENT_TIMESTAMPS);
    }
    this.updateActivityPeriods(worker, event.ts);

    // Track bead events
    if (event.bead) {
      this.trackBeadEvent(worker, event);
    }

    // Track errors
    if (event.level === 'error' || event.error) {
      worker.errorCount++;
      worker.errorTimestamps.push(event.ts);
      if (worker.errorTimestamps.length > MAX_ERROR_TIMESTAMPS) {
        worker.errorTimestamps = worker.errorTimestamps.slice(-MAX_ERROR_TIMESTAMPS);
      }
    }

    // Update cost from cost tracker
    const costSummary = this.costTracker.getSummary();
    const workerCost = costSummary.byWorker.get(event.worker);
    if (workerCost) {
      worker.totalCostUsd = workerCost.costUsd;
      worker.totalTokens = workerCost.total;
    }

    // Feed OTLP metric events to the accumulator
    if (event.msg?.startsWith('metric.')) {
      this.metricAccumulator.processEvent(event);
    }

    // Periodic cleanup of stale workers (every 1000 events)
    this.eventCountForCleanup++;
    if (this.eventCountForCleanup >= 1000) {
      this.cleanupStaleWorkers();
      this.eventCountForCleanup = 0;
    }

    // Periodic time-series snapshot
    this.maybeCreateSnapshot(event.ts);
  }

  /**
   * Get metrics for a specific worker
   */
  getWorkerMetrics(workerId: string, options: WorkerAnalyticsOptions = {}): WorkerMetrics | undefined {
    const worker = this.workers.get(workerId);
    if (!worker) return undefined;

    const opts = this.buildOptions(options);
    const { startTime, endTime } = this.getTimeRange(opts);

    return this.calculateMetrics(worker, startTime, endTime);
  }

  /**
   * Get metrics for all workers
   */
  getAllWorkerMetrics(options: WorkerAnalyticsOptions = {}): WorkerMetrics[] {
    const opts = this.buildOptions(options);
    const { startTime, endTime } = this.getTimeRange(opts);

    const allMetrics: WorkerMetrics[] = [];

    for (const worker of this.workers.values()) {
      // Filter by worker IDs if specified
      if (opts.workerIds.length > 0 && !opts.workerIds.includes(worker.workerId)) {
        continue;
      }

      const metrics = this.calculateMetrics(worker, startTime, endTime);

      // Filter by minimum beads completed
      if (metrics.beadsCompleted < opts.minBeadsCompleted) {
        continue;
      }

      allMetrics.push(metrics);
    }

    return allMetrics;
  }

  /**
   * Get aggregated analytics
   */
  getAggregatedAnalytics(options: WorkerAnalyticsOptions = {}): AggregatedAnalytics {
    const opts = this.buildOptions(options);
    const { startTime, endTime } = this.getTimeRange(opts);

    const allMetrics = this.getAllWorkerMetrics(options);

    if (allMetrics.length === 0) {
      return this.createEmptyAggregatedAnalytics(startTime, endTime);
    }

    // Calculate aggregated metrics
    const totalBeadsCompleted = allMetrics.reduce((sum, m) => sum + m.beadsCompleted, 0);
    const totalErrors = allMetrics.reduce((sum, m) => sum + m.errorCount, 0);
    const totalCostUsd = allMetrics.reduce((sum, m) => sum + m.totalCostUsd, 0);

    const avgBeadsPerHour = allMetrics.reduce((sum, m) => sum + m.beadsPerHour, 0) / allMetrics.length;
    const avgCompletionTimeMs = allMetrics.reduce((sum, m) => sum + m.avgCompletionTimeMs, 0) / allMetrics.length;
    const overallErrorRate = totalBeadsCompleted > 0 ? totalErrors / totalBeadsCompleted : 0;
    const avgCostPerBead = totalBeadsCompleted > 0 ? totalCostUsd / totalBeadsCompleted : 0;

    // Top performers (by beads completed)
    const topPerformers = [...allMetrics]
      .sort((a, b) => b.beadsCompleted - a.beadsCompleted)
      .slice(0, opts.maxWorkers);

    // Highest error rate workers
    const highErrorRateWorkers = [...allMetrics]
      .filter(m => m.beadsCompleted > 0)
      .sort((a, b) => b.errorRate - a.errorRate)
      .slice(0, opts.maxWorkers);

    // Most cost-efficient workers
    const costEfficientWorkers = [...allMetrics]
      .filter(m => m.beadsCompleted > 0)
      .sort((a, b) => a.costPerBead - b.costPerBead)
      .slice(0, opts.maxWorkers);

    // Calculate aggregated additional metrics
    const activeWorkerCount = allMetrics.filter(m => m.beadsCompleted > 0).length;
    const totalTokens = allMetrics.reduce((sum, m) => sum + m.totalTokens, 0);
    const avgEfficiency = allMetrics.length > 0
      ? allMetrics.reduce((sum, m) => sum + m.efficiencyScore, 0) / allMetrics.length
      : 0;
    const underperformers = allMetrics
      .filter(m => m.errorRate > 0.2 || m.efficiencyScore < 0.5)
      .slice(0, opts.maxWorkers);

    return {
      periodStart: startTime,
      periodEnd: endTime,
      totalWorkers: allMetrics.length,
      totalBeadsCompleted,
      avgBeadsPerHour,
      avgCompletionTimeMs,
      totalErrors,
      overallErrorRate,
      totalCostUsd,
      avgCostPerBead,
      topPerformers,
      highErrorRateWorkers,
      costEfficientWorkers,
      activeWorkerCount,
      totalTokens,
      avgEfficiency,
      underperformers,
    };
  }

  /**
   * Get performance trends
   */
  getPerformanceTrends(workerId: string, metric: keyof WorkerMetrics, options: WorkerAnalyticsOptions = {}): PerformanceTrend {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`Worker ${workerId} not found`);
    }

    const opts = this.buildOptions(options);
    const { startTime, endTime } = this.getTimeRange(opts);

    // Filter time-series data by time range
    const dataPoints = worker.timeSeriesData.filter(
      dp => dp.timestamp >= startTime && dp.timestamp <= endTime
    );

    if (dataPoints.length === 0) {
      return {
        workerId,
        metric,
        dataPoints: [],
        trend: 'stable',
        changePercent: 0,
        average: 0,
        min: 0,
        max: 0,
      };
    }

    // Extract values for the specific metric
    const values = dataPoints
      .map(dp => dp.metrics[metric] as number)
      .filter(v => v !== undefined && !isNaN(v));

    if (values.length === 0) {
      return {
        workerId,
        metric,
        dataPoints,
        trend: 'stable',
        changePercent: 0,
        average: 0,
        min: 0,
        max: 0,
      };
    }

    // Calculate statistics
    const average = values.reduce((sum, v) => sum + v, 0) / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);

    // Calculate trend
    const firstValue = values[0];
    const lastValue = values[values.length - 1];
    const changePercent = firstValue !== 0 ? ((lastValue - firstValue) / firstValue) * 100 : 0;

    let trend: 'improving' | 'declining' | 'stable' = 'stable';
    if (Math.abs(changePercent) > 5) {
      // Determine if improvement based on metric type
      const improvementMetrics = ['beadsPerHour', 'beadsCompleted', 'tokensPerBead'];
      const declineMetrics = ['errorRate', 'costPerBead', 'avgCompletionTimeMs', 'idlePercentage'];

      if (improvementMetrics.includes(metric)) {
        trend = changePercent > 0 ? 'improving' : 'declining';
      } else if (declineMetrics.includes(metric)) {
        trend = changePercent < 0 ? 'improving' : 'declining';
      }
    }

    return {
      workerId,
      metric,
      dataPoints,
      trend,
      changePercent,
      average,
      min,
      max,
    };
  }

  /**
   * Get time-series data
   */
  getTimeSeriesData(workerId: string, options: WorkerAnalyticsOptions = {}): MetricsDataPoint[] {
    const worker = this.workers.get(workerId);
    if (!worker) return [];

    const opts = this.buildOptions(options);
    const { startTime, endTime } = this.getTimeRange(opts);

    return worker.timeSeriesData.filter(
      dp => dp.timestamp >= startTime && dp.timestamp <= endTime
    );
  }

  /**
   * Clear all analytics data
   */
  clear(): void {
    this.workers.clear();
    this.costTracker.reset();
    this.metricAccumulator.reset();
    this.lastSnapshotTime = 0;
  }

  /**
   * Get the underlying CostTracker instance
   */
  getCostTracker(): CostTracker {
    return this.costTracker;
  }

  /**
   * Get the MetricAccumulator for OTLP metric data
   */
  getMetricAccumulator(): MetricAccumulator {
    return this.metricAccumulator;
  }

  /**
   * Get analytics summary as formatted string
   */
  getSummary(options: WorkerAnalyticsOptions = {}): string {
    const aggregated = this.getAggregatedAnalytics(options);
    const lines: string[] = [];

    lines.push('=== Worker Analytics Summary ===');
    lines.push('');
    lines.push(`Period: ${new Date(aggregated.periodStart).toLocaleString()} - ${new Date(aggregated.periodEnd).toLocaleString()}`);
    lines.push(`Total Workers: ${aggregated.totalWorkers}`);
    lines.push(`Total Beads Completed: ${aggregated.totalBeadsCompleted}`);
    lines.push(`Average Beads/Hour: ${aggregated.avgBeadsPerHour.toFixed(2)}`);
    lines.push(`Average Completion Time: ${(aggregated.avgCompletionTimeMs / 1000).toFixed(1)}s`);
    lines.push(`Total Errors: ${aggregated.totalErrors}`);
    lines.push(`Overall Error Rate: ${(aggregated.overallErrorRate * 100).toFixed(2)}%`);
    lines.push(`Total Cost: $${aggregated.totalCostUsd.toFixed(4)}`);
    lines.push(`Average Cost/Bead: $${aggregated.avgCostPerBead.toFixed(4)}`);
    lines.push('');

    if (aggregated.topPerformers.length > 0) {
      lines.push('Top Performers:');
      aggregated.topPerformers.forEach((w, i) => {
        lines.push(`  ${i + 1}. ${w.workerId}: ${w.beadsCompleted} beads (${w.beadsPerHour.toFixed(2)}/hr)`);
      });
      lines.push('');
    }

    if (aggregated.costEfficientWorkers.length > 0) {
      lines.push('Most Cost-Efficient:');
      aggregated.costEfficientWorkers.forEach((w, i) => {
        lines.push(`  ${i + 1}. ${w.workerId}: $${w.costPerBead.toFixed(4)}/bead`);
      });
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Update worker LRU order (move to end when accessed).
   */
  private touchWorkerLRU(workerId: string): void {
    const idx = this.workerLRU.indexOf(workerId);
    if (idx !== -1) {
      this.workerLRU.splice(idx, 1);
    }
    this.workerLRU.push(workerId);
  }

  /**
   * Evict least recently used worker when over cap.
   */
  private evictLRUWorker(): void {
    const lruWorkerId = this.workerLRU.shift();
    if (lruWorkerId) {
      this.workers.delete(lruWorkerId);
    }
  }

  /**
   * Periodic cleanup of stale workers.
   */
  private cleanupStaleWorkers(): void {
    const now = Date.now();
    const staleWorkerCutoff = now - STALE_WORKER_MAX_AGE_MS;

    for (const [workerId, worker] of this.workers) {
      if (worker.lastActivity < staleWorkerCutoff) {
        this.workers.delete(workerId);
        const lruIdx = this.workerLRU.indexOf(workerId);
        if (lruIdx !== -1) {
          this.workerLRU.splice(lruIdx, 1);
        }
      }
    }
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  private createWorkerTrackingData(workerId: string, timestamp: number): WorkerTrackingData {
    return {
      workerId,
      firstSeen: timestamp,
      lastSeen: timestamp,
      lastActivity: timestamp,
      beadsCompleted: 0,
      beadsReleased: 0,
      beadStartTimes: new Map(),
      beadCompletionTimes: [],
      errorCount: 0,
      errorTimestamps: [],
      eventTimestamps: [],
      activityPeriods: [],
      totalCostUsd: 0,
      totalTokens: 0,
      timeSeriesData: [],
    };
  }

  private trackBeadEvent(worker: WorkerTrackingData, event: LogEvent): void {
    const beadId = event.bead!;

    // Detect bead start (first mention of bead)
    if (!worker.beadStartTimes.has(beadId)) {
      worker.beadStartTimes.set(beadId, event.ts);
    }

    // Detect bead completion
    const msg = event.msg?.toLowerCase() || '';
    const isReleasedSuccess = event.msg === 'bead.released' && event['reason'] === 'release_success';
    if (
      msg.includes('completed') ||
      msg.includes('finished') ||
      msg.includes('done') ||
      isReleasedSuccess
    ) {
      const startTime = worker.beadStartTimes.get(beadId);
      if (startTime) {
        const duration = event.ts - startTime;
        worker.beadCompletionTimes.push(duration);
        if (worker.beadCompletionTimes.length > MAX_BEAD_COMPLETION_TIMES) {
          worker.beadCompletionTimes = worker.beadCompletionTimes.slice(-MAX_BEAD_COMPLETION_TIMES);
        }
        worker.beadsCompleted++;
        worker.beadStartTimes.delete(beadId); // Clean up
      }
    }
  }

  private updateActivityPeriods(worker: WorkerTrackingData, timestamp: number): void {
    const ACTIVITY_GAP_MS = 300000; // 5 minutes

    if (worker.activityPeriods.length === 0) {
      worker.activityPeriods.push({ start: timestamp, end: timestamp });
      return;
    }

    const lastPeriod = worker.activityPeriods[worker.activityPeriods.length - 1];

    if (timestamp - lastPeriod.end <= ACTIVITY_GAP_MS) {
      lastPeriod.end = timestamp;
    } else {
      worker.activityPeriods.push({ start: timestamp, end: timestamp });
      if (worker.activityPeriods.length > MAX_ACTIVITY_PERIODS) {
        worker.activityPeriods = worker.activityPeriods.slice(-MAX_ACTIVITY_PERIODS);
      }
    }
  }

  private calculateMetrics(worker: WorkerTrackingData, startTime: number, endTime: number): WorkerMetrics {
    // Filter events within time range
    const eventsInRange = worker.eventTimestamps.filter(ts => ts >= startTime && ts <= endTime);
    const errorsInRange = worker.errorTimestamps.filter(ts => ts >= startTime && ts <= endTime);

    // Calculate time metrics
    const periodDurationMs = endTime - startTime;
    const periodDurationHours = periodDurationMs / 3600000;

    // Calculate active time
    let activeTimeMs = 0;
    for (const period of worker.activityPeriods) {
      const periodStart = Math.max(period.start, startTime);
      const periodEnd = Math.min(period.end, endTime);
      if (periodEnd > periodStart) {
        activeTimeMs += periodEnd - periodStart;
      }
    }

    const idleTimeMs = periodDurationMs - activeTimeMs;
    const idlePercentage = periodDurationMs > 0 ? (idleTimeMs / periodDurationMs) * 100 : 0;

    // Calculate bead metrics
    const beadsCompleted = worker.beadsCompleted;
    const beadsPerHour = periodDurationHours > 0 ? beadsCompleted / periodDurationHours : 0;

    const avgCompletionTimeMs = worker.beadCompletionTimes.length > 0
      ? worker.beadCompletionTimes.reduce((sum, t) => sum + t, 0) / worker.beadCompletionTimes.length
      : 0;

    // Error metrics
    const errorCount = errorsInRange.length;
    const errorRate = beadsCompleted > 0 ? errorCount / beadsCompleted : 0;

    // Cost metrics
    const totalCostUsd = worker.totalCostUsd;
    const costPerBead = beadsCompleted > 0 ? totalCostUsd / beadsCompleted : 0;

    // Token metrics
    const totalTokens = worker.totalTokens;
    const tokensPerBead = beadsCompleted > 0 ? totalTokens / beadsCompleted : 0;

    // Efficiency score: ratio of active time to total time (0-1)
    const totalTimeMs = activeTimeMs + idleTimeMs;
    const efficiencyScore = totalTimeMs > 0 ? activeTimeMs / totalTimeMs : 0;

    return {
      workerId: worker.workerId,
      periodStart: startTime,
      periodEnd: endTime,
      beadsCompleted,
      beadsPerHour,
      avgCompletionTimeMs,
      errorCount,
      errorRate,
      totalCostUsd,
      costPerBead,
      activeTimeMs,
      idleTimeMs,
      idlePercentage,
      totalEvents: eventsInRange.length,
      totalTokens,
      tokensPerBead,
      efficiencyScore,
    };
  }

  private maybeCreateSnapshot(currentTime: number): void {
    if (currentTime - this.lastSnapshotTime >= this.timeSeriesInterval) {
      this.createSnapshotForAllWorkers(currentTime);
      this.lastSnapshotTime = currentTime;
    }
  }

  private createSnapshotForAllWorkers(timestamp: number): void {
    for (const worker of this.workers.values()) {
      const metrics = this.calculateMetrics(worker, worker.firstSeen, timestamp);

      const dataPoint: MetricsDataPoint = {
        timestamp,
        workerId: worker.workerId,
        metrics,
      };

      worker.timeSeriesData.push(dataPoint);

      // Limit time-series data size (keep last 1000 points)
      if (worker.timeSeriesData.length > 1000) {
        worker.timeSeriesData.shift();
      }
    }
  }

  private buildOptions(options: WorkerAnalyticsOptions): Required<WorkerAnalyticsOptions> {
    return {
      ...DEFAULT_OPTIONS,
      ...options,
      workerIds: options.workerIds || [],
    };
  }

  private getTimeRange(options: Required<WorkerAnalyticsOptions>): { startTime: number; endTime: number } {
    const now = Date.now();

    // If timeWindow is 'all', ignore the default times and use worker data
    if (options.timeWindow === 'all' && options.startTime === 0 && options.endTime === 0) {
      let startTime = 0;
      let endTime = now;

      // Find earliest and latest events across all workers
      for (const worker of this.workers.values()) {
        if (startTime === 0 || worker.firstSeen < startTime) {
          startTime = worker.firstSeen;
        }
        if (worker.lastSeen > endTime) {
          endTime = worker.lastSeen;
        }
      }

      return { startTime, endTime };
    }

    // Use custom times if explicitly provided (non-zero)
    if (options.startTime > 0 || options.endTime > 0) {
      return {
        startTime: options.startTime > 0 ? options.startTime : 0,
        endTime: options.endTime > 0 ? options.endTime : now
      };
    }

    // Use time window presets
    let startTime = 0;
    let endTime = now;

    switch (options.timeWindow) {
      case 'hour':
        startTime = now - 3600000;
        break;
      case 'day':
        startTime = now - 86400000;
        break;
      case 'week':
        startTime = now - 604800000;
        break;
      case 'all':
      default:
        // Find earliest event across all workers
        for (const worker of this.workers.values()) {
          if (startTime === 0 || worker.firstSeen < startTime) {
            startTime = worker.firstSeen;
          }
          if (worker.lastSeen > endTime) {
            endTime = worker.lastSeen;
          }
        }
        break;
    }

    return { startTime, endTime };
  }

  private createEmptyAggregatedAnalytics(startTime: number, endTime: number): AggregatedAnalytics {
    return {
      periodStart: startTime,
      periodEnd: endTime,
      totalWorkers: 0,
      totalBeadsCompleted: 0,
      avgBeadsPerHour: 0,
      avgCompletionTimeMs: 0,
      totalErrors: 0,
      overallErrorRate: 0,
      totalCostUsd: 0,
      avgCostPerBead: 0,
      topPerformers: [],
      highErrorRateWorkers: [],
      costEfficientWorkers: [],
      activeWorkerCount: 0,
      totalTokens: 0,
      avgEfficiency: 0,
      underperformers: [],
    };
  }

  // ============================================
  // Historical Data Methods
  // ============================================

  /**
   * Get historical store instance
   */
  getHistoricalStore(): HistoricalStore {
    return getHistoricalStore();
  }

  /**
   * Get worker comparison metrics across sessions
   */
  getHistoricalWorkerMetrics(workerId: string): WorkerComparisonMetrics | null {
    return getHistoricalStore().getWorkerComparisonMetrics(workerId);
  }

  /**
   * Get historical aggregated analytics
   */
  getHistoricalAnalytics(options: { startTime?: number; endTime?: number } = {}): AggregatedAnalytics {
    return getHistoricalStore().getAggregatedAnalytics(options);
  }

  /**
   * Compare current worker performance with historical averages
   */
  compareWithHistory(workerId: string): {
    current: WorkerMetrics | null;
    historical: WorkerComparisonMetrics | null;
    comparison: {
      beadsPerHourChange: number;
      errorRateChange: number;
      costPerBeadChange: number;
      efficiencyChange: number;
    } | null;
  } {
    const current = this.getWorkerMetrics(workerId) || null;
    const historical = getHistoricalStore().getWorkerComparisonMetrics(workerId);

    let comparison = null;
    if (current && historical) {
      comparison = {
        beadsPerHourChange: historical.avgBeadsPerHour > 0
          ? ((current.beadsPerHour - historical.avgBeadsPerHour) / historical.avgBeadsPerHour) * 100
          : 0,
        errorRateChange: ((current.errorRate - historical.avgErrorRate) / (historical.avgErrorRate || 0.01)) * 100,
        costPerBeadChange: historical.avgCostPerBead > 0
          ? ((current.costPerBead - historical.avgCostPerBead) / historical.avgCostPerBead) * 100
          : 0,
        efficiencyChange: ((current.efficiencyScore - (historical.totalBeadsCompleted > 0 ? 1 : 0)) * 100),
      };
    }

    return { current, historical, comparison };
  }

  /**
   * Get historical database statistics
   */
  getHistoricalStats(): {
    sessionsCount: number;
    tasksCount: number;
    errorsCount: number;
    dbSizeBytes: number;
    oldestSession: number | null;
    newestSession: number | null;
  } {
    return getHistoricalStore().getStats();
  }

  /**
   * Compare two workers side-by-side
   */
  compareWorkers(worker1Id: string, worker2Id: string, options: WorkerAnalyticsOptions = {}): WorkerComparison | null {
    const worker1 = this.getWorkerMetrics(worker1Id, options);
    const worker2 = this.getWorkerMetrics(worker2Id, options);

    if (!worker1 || !worker2) {
      return null;
    }

    // Calculate raw differences (worker1 - worker2)
    const differences = {
      beadsCompleted: worker1.beadsCompleted - worker2.beadsCompleted,
      beadsPerHour: worker1.beadsPerHour - worker2.beadsPerHour,
      avgCompletionTimeMs: worker1.avgCompletionTimeMs - worker2.avgCompletionTimeMs,
      errorRate: worker1.errorRate - worker2.errorRate,
      costPerBead: worker1.costPerBead - worker2.costPerBead,
      efficiencyScore: worker1.efficiencyScore - worker2.efficiencyScore,
    };

    // Calculate percentage differences
    const percentDifferences = {
      beadsCompleted: worker2.beadsCompleted > 0
        ? ((worker1.beadsCompleted - worker2.beadsCompleted) / worker2.beadsCompleted) * 100
        : (worker1.beadsCompleted > 0 ? 100 : 0),
      beadsPerHour: worker2.beadsPerHour > 0
        ? ((worker1.beadsPerHour - worker2.beadsPerHour) / worker2.beadsPerHour) * 100
        : 0,
      avgCompletionTimeMs: worker2.avgCompletionTimeMs > 0
        ? ((worker1.avgCompletionTimeMs - worker2.avgCompletionTimeMs) / worker2.avgCompletionTimeMs) * 100
        : 0,
      errorRate: worker2.errorRate > 0
        ? ((worker1.errorRate - worker2.errorRate) / worker2.errorRate) * 100
        : 0,
      costPerBead: worker2.costPerBead > 0
        ? ((worker1.costPerBead - worker2.costPerBead) / worker2.costPerBead) * 100
        : 0,
      efficiencyScore: worker2.efficiencyScore > 0
        ? ((worker1.efficiencyScore - worker2.efficiencyScore) / worker2.efficiencyScore) * 100
        : 0,
    };

    // Determine which worker is better for each metric
    const EPSILON = 0.0001; // Small value for floating point comparison
    const betterWorker = {
      beadsCompleted: Math.abs(differences.beadsCompleted) < EPSILON
        ? 'tie' as const
        : (differences.beadsCompleted > 0 ? 'worker1' as const : 'worker2' as const),
      beadsPerHour: Math.abs(differences.beadsPerHour) < EPSILON
        ? 'tie' as const
        : (differences.beadsPerHour > 0 ? 'worker1' as const : 'worker2' as const),
      avgCompletionTimeMs: Math.abs(differences.avgCompletionTimeMs) < EPSILON
        ? 'tie' as const
        : (differences.avgCompletionTimeMs < 0 ? 'worker1' as const : 'worker2' as const), // Lower is better
      errorRate: Math.abs(differences.errorRate) < EPSILON
        ? 'tie' as const
        : (differences.errorRate < 0 ? 'worker1' as const : 'worker2' as const), // Lower is better
      costPerBead: Math.abs(differences.costPerBead) < EPSILON
        ? 'tie' as const
        : (differences.costPerBead < 0 ? 'worker1' as const : 'worker2' as const), // Lower is better
      efficiencyScore: Math.abs(differences.efficiencyScore) < EPSILON
        ? 'tie' as const
        : (differences.efficiencyScore > 0 ? 'worker1' as const : 'worker2' as const),
    };

    // Calculate score tally
    let worker1Score = 0;
    let worker2Score = 0;

    Object.values(betterWorker).forEach(winner => {
      if (winner === 'worker1') worker1Score++;
      else if (winner === 'worker2') worker2Score++;
    });

    // Determine overall winner
    const overallWinner: 'worker1' | 'worker2' | 'tie' =
      worker1Score > worker2Score ? 'worker1' :
      worker2Score > worker1Score ? 'worker2' : 'tie';

    return {
      worker1,
      worker2,
      differences,
      percentDifferences,
      betterWorker,
      overallWinner,
      score: { worker1: worker1Score, worker2: worker2Score },
    };
  }
}

/**
 * Global worker analytics instance
 */
let globalAnalytics: WorkerAnalytics | undefined;

export function getWorkerAnalytics(): WorkerAnalytics {
  if (!globalAnalytics) {
    globalAnalytics = new WorkerAnalytics();
  }
  return globalAnalytics;
}

export function resetWorkerAnalytics(): void {
  globalAnalytics = undefined;
}
