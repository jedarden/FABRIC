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
} from './types.js';
import { CostTracker } from './tui/utils/costTracking.js';

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

  constructor(costTracker?: CostTracker, timeSeriesInterval: number = 3600000) {
    this.costTracker = costTracker || new CostTracker();
    this.timeSeriesInterval = timeSeriesInterval;
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
      worker = this.createWorkerTrackingData(event.worker, event.ts);
      this.workers.set(event.worker, worker);
    }

    // Update activity tracking
    worker.lastSeen = event.ts;
    worker.eventTimestamps.push(event.ts);
    this.updateActivityPeriods(worker, event.ts);

    // Track bead events
    if (event.bead) {
      this.trackBeadEvent(worker, event);
    }

    // Track errors
    if (event.level === 'error' || event.error) {
      worker.errorCount++;
      worker.errorTimestamps.push(event.ts);
    }

    // Update cost from cost tracker
    const costSummary = this.costTracker.getSummary();
    const workerCost = costSummary.byWorker.get(event.worker);
    if (workerCost) {
      worker.totalCostUsd = workerCost.costUsd;
      worker.totalTokens = workerCost.total;
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
    this.lastSnapshotTime = 0;
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
    if (
      msg.includes('completed') ||
      msg.includes('finished') ||
      msg.includes('done') ||
      msg.includes('success')
    ) {
      const startTime = worker.beadStartTimes.get(beadId);
      if (startTime) {
        const duration = event.ts - startTime;
        worker.beadCompletionTimes.push(duration);
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
      // Extend current period
      lastPeriod.end = timestamp;
    } else {
      // Start new period
      worker.activityPeriods.push({ start: timestamp, end: timestamp });
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
