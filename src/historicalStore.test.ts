/**
 * Tests for FABRIC Historical Store
 *
 * Tests SQLite-based persistent storage for historical session analytics.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  HistoricalStore,
  SessionRecord,
  TaskMetricsRecord,
  ErrorHistoryRecord,
} from './historicalStore.js';
import { MetricAccumulator, INSTRUMENT_NAMES } from './workerAnalytics.js';
import { normalizeToLogEvent } from './normalizer.js';

// Test database path
const TEST_DB_DIR = path.join(os.tmpdir(), 'fabric-test-' + Date.now());
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test-fabric.db');

describe('HistoricalStore', () => {
  let store: HistoricalStore;

  beforeEach(() => {
    // Create test directory
    if (!fs.existsSync(TEST_DB_DIR)) {
      fs.mkdirSync(TEST_DB_DIR, { recursive: true });
    }

    // Create fresh store instance
    store = new HistoricalStore(TEST_DB_PATH);
  });

  afterEach(() => {
    // Close and cleanup
    store.close();
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
    }
  });

  describe('Session Management', () => {
    it('should start a new session', () => {
      const sessionId = store.startSession('test-session-1');
      expect(sessionId).toBe('test-session-1');
      expect(store.getCurrentSessionId()).toBe('test-session-1');
    });

    it('should generate session ID if not provided', () => {
      const sessionId = store.startSession();
      expect(sessionId).toMatch(/^session-/);
      expect(store.getCurrentSessionId()).toBe(sessionId);
    });

    it('should end session with metrics', () => {
      store.startSession('test-session-2');
      store.endSession({
        workerCount: 3,
        taskCount: 10,
        totalCost: 0.5,
        totalTokens: 5000,
      });

      const session = store.getSession('test-session-2');
      expect(session).not.toBeNull();
      expect(session!.worker_count).toBe(3);
      expect(session!.task_count).toBe(10);
      expect(session!.total_cost).toBe(0.5);
      expect(session!.total_tokens).toBe(5000);
    });

    it('should retrieve sessions within time range', () => {
      const now = Date.now();

      // Create multiple sessions
      store.startSession('session-1');
      store.endSession({ workerCount: 1, taskCount: 1, totalCost: 0.1, totalTokens: 100 });

      store.startSession('session-2');
      store.endSession({ workerCount: 2, taskCount: 2, totalCost: 0.2, totalTokens: 200 });

      const sessions = store.getSessions({ startTime: now - 1000, endTime: now + 10000 });
      expect(sessions.length).toBe(2);
      expect(sessions[0].id).toBe('session-2'); // Most recent first
    });
  });

  describe('Task Metrics', () => {
    beforeEach(() => {
      store.startSession('metrics-test-session');
    });

    it('should record task completion', () => {
      const startedAt = Date.now() - 60000;
      const endedAt = startedAt + 60000;
      const taskId = store.recordTask({
        workerId: 'worker-1',
        taskType: 'bead',
        startedAt,
        endedAt,
        cost: 0.05,
        tokensIn: 500,
        tokensOut: 200,
        success: true,
        retryCount: 0,
      });

      expect(taskId).toMatch(/metrics-test-session-task-\d+/);

      const tasks = store.getTaskMetrics({ sessionId: 'metrics-test-session' });
      expect(tasks.length).toBe(1);
      expect(tasks[0].worker_id).toBe('worker-1');
      expect(tasks[0].success).toBe(1); // SQLite stores boolean as 0/1
      expect(tasks[0].duration_ms).toBe(60000);
    });

    it('should record failed tasks', () => {
      store.recordTask({
        workerId: 'worker-2',
        taskType: 'bead',
        startedAt: Date.now() - 30000,
        endedAt: Date.now(),
        cost: 0.02,
        tokensIn: 200,
        tokensOut: 50,
        success: false,
        retryCount: 3,
      });

      const tasks = store.getTaskMetrics({ workerId: 'worker-2' });
      expect(tasks.length).toBe(1);
      expect(tasks[0].success).toBe(0);
      expect(tasks[0].retry_count).toBe(3);
    });

    it('should filter tasks by worker', () => {
      store.recordTask({
        workerId: 'worker-a',
        taskType: 'bead',
        startedAt: Date.now(),
        endedAt: Date.now() + 1000,
        cost: 0,
        tokensIn: 0,
        tokensOut: 0,
        success: true,
        retryCount: 0,
      });

      store.recordTask({
        workerId: 'worker-b',
        taskType: 'bead',
        startedAt: Date.now(),
        endedAt: Date.now() + 1000,
        cost: 0,
        tokensIn: 0,
        tokensOut: 0,
        success: true,
        retryCount: 0,
      });

      const workerATasks = store.getTaskMetrics({ workerId: 'worker-a' });
      expect(workerATasks.length).toBe(1);
      expect(workerATasks[0].worker_id).toBe('worker-a');
    });
  });

  describe('Error History', () => {
    beforeEach(() => {
      store.startSession('error-test-session');
    });

    it('should record errors', () => {
      const errorId = store.recordError({
        workerId: 'worker-1',
        errorType: 'network',
        errorMessage: 'ECONNREFUSED: Connection refused',
        filePath: '/src/api.ts',
        timestamp: Date.now(),
      });

      expect(errorId).toBeGreaterThan(0);

      const errors = store.getErrorHistory({ sessionId: 'error-test-session' });
      expect(errors.length).toBe(1);
      expect(errors[0].error_type).toBe('network');
      expect(errors[0].file_path).toBe('/src/api.ts');
    });

    it('should update error resolution', () => {
      const errorId = store.recordError({
        workerId: 'worker-1',
        errorType: 'permission',
        errorMessage: 'EACCES: Permission denied',
        timestamp: Date.now(),
      });

      store.updateErrorResolution(errorId, 'Fixed file permissions with chmod', true);

      const errors = store.getErrorHistory({ errorType: 'permission' });
      expect(errors[0].resolution).toBe('Fixed file permissions with chmod');
      expect(errors[0].resolution_successful).toBe(1);
    });

    it('should filter resolved errors', () => {
      const errorId = store.recordError({
        workerId: 'worker-1',
        errorType: 'timeout',
        errorMessage: 'Request timeout',
        timestamp: Date.now(),
      });

      store.updateErrorResolution(errorId, 'Increased timeout', true);

      store.recordError({
        workerId: 'worker-2',
        errorType: 'timeout',
        errorMessage: 'Another timeout',
        timestamp: Date.now(),
      });

      const resolvedOnly = store.getErrorHistory({ resolvedOnly: true });
      expect(resolvedOnly.length).toBe(1);
      expect(resolvedOnly[0].resolution_successful).toBe(1);
    });

    it('should search for similar errors', () => {
      store.recordError({
        workerId: 'worker-1',
        errorType: 'network',
        errorMessage: 'ECONNREFUSED connection to localhost refused',
        timestamp: Date.now() - 10000,
      });

      store.recordError({
        workerId: 'worker-2',
        errorType: 'network',
        errorMessage: 'ETIMEDOUT connection timeout waiting for response',
        timestamp: Date.now() - 5000,
      });

      const similar = store.findSimilarErrors('ECONNREFUSED connection refused', 10);
      expect(similar.length).toBeGreaterThan(0);
      expect(similar[0].similarity).toBeGreaterThan(0);
    });
  });

  describe('Worker Comparison', () => {
    beforeEach(() => {
      // Create multiple sessions with tasks for a worker
      store.startSession('compare-sess-1');
      store.recordTask({
        workerId: 'test-worker',
        taskType: 'bead',
        startedAt: Date.now() - 10000,
        endedAt: Date.now() - 5000,
        cost: 0.1,
        tokensIn: 1000,
        tokensOut: 500,
        success: true,
        retryCount: 0,
      });
      store.endSession({ workerCount: 1, taskCount: 1, totalCost: 0.1, totalTokens: 1500 });

      store.startSession('compare-sess-2');
      store.recordTask({
        workerId: 'test-worker',
        taskType: 'bead',
        startedAt: Date.now() - 4000,
        endedAt: Date.now() - 2000,
        cost: 0.05,
        tokensIn: 500,
        tokensOut: 250,
        success: true,
        retryCount: 0,
      });
      store.recordTask({
        workerId: 'test-worker',
        taskType: 'bead',
        startedAt: Date.now() - 2000,
        endedAt: Date.now() - 1000,
        cost: 0.08,
        tokensIn: 800,
        tokensOut: 400,
        success: false,
        retryCount: 1,
      });
      store.endSession({ workerCount: 1, taskCount: 2, totalCost: 0.13, totalTokens: 1950 });
    });

    it('should get worker comparison metrics', () => {
      const metrics = store.getWorkerComparisonMetrics('test-worker');

      expect(metrics).not.toBeNull();
      expect(metrics!.workerId).toBe('test-worker');
      expect(metrics!.sessionsCount).toBe(2);
      expect(metrics!.totalBeadsCompleted).toBe(2); // 2 successful tasks
      expect(metrics!.totalErrors).toBe(1);
      expect(metrics!.totalCostUsd).toBeCloseTo(0.23, 2);
    });

    it('should return null for unknown worker', () => {
      const metrics = store.getWorkerComparisonMetrics('unknown-worker');
      expect(metrics).toBeNull();
    });
  });

  describe('Learned Recoveries', () => {
    beforeEach(() => {
      store.startSession('learn-sess');
    });

    it('should learn from error resolutions', () => {
      // Record resolved errors
      const error1 = store.recordError({
        workerId: 'w1',
        errorType: 'network',
        errorMessage: 'ECONNREFUSED connection refused',
        timestamp: Date.now() - 5000,
      });
      store.updateErrorResolution(error1, 'Retry with exponential backoff', true);

      const error2 = store.recordError({
        workerId: 'w2',
        errorType: 'network',
        errorMessage: 'ECONNREFUSED connection timeout',
        timestamp: Date.now(),
      });
      store.updateErrorResolution(error2, 'Retry with exponential backoff', true);

      const learned = store.getLearnedRecoveries();
      expect(learned.length).toBeGreaterThan(0);
      expect(learned[0].errorType).toBe('network');
      expect(learned[0].resolution).toBe('Retry with exponential backoff');
      expect(learned[0].occurrenceCount).toBe(2);
      expect(learned[0].successRate).toBe(1);
    });
  });

  describe('Aggregated Analytics', () => {
    beforeEach(() => {
      store.startSession('agg-sess-1');
      store.recordTask({
        workerId: 'worker-a',
        taskType: 'bead',
        startedAt: Date.now() - 10000,
        endedAt: Date.now() - 5000,
        cost: 0.1,
        tokensIn: 1000,
        tokensOut: 500,
        success: true,
        retryCount: 0,
      });
      store.endSession({ workerCount: 1, taskCount: 1, totalCost: 0.1, totalTokens: 1500 });
    });

    it('should get aggregated analytics', () => {
      const analytics = store.getAggregatedAnalytics();

      expect(analytics.totalWorkers).toBeGreaterThanOrEqual(1);
      expect(analytics.totalBeadsCompleted).toBeGreaterThanOrEqual(1);
      expect(analytics.totalCostUsd).toBeGreaterThanOrEqual(0.1);
    });

    it('should filter by time range', () => {
      const now = Date.now();
      const analytics = store.getAggregatedAnalytics({
        startTime: now + 10000, // Future time - should be empty
        endTime: now + 20000,
      });

      expect(analytics.totalBeadsCompleted).toBe(0);
    });
  });

  describe('Database Statistics', () => {
    it('should return database stats', () => {
      store.startSession('stats-sess');
      store.recordTask({
        workerId: 'w1',
        taskType: 'bead',
        startedAt: Date.now(),
        endedAt: Date.now() + 1000,
        cost: 0.01,
        tokensIn: 100,
        tokensOut: 50,
        success: true,
        retryCount: 0,
      });
      store.recordError({
        workerId: 'w1',
        errorType: 'test',
        errorMessage: 'Test error',
        timestamp: Date.now(),
      });

      const stats = store.getStats();

      expect(stats.sessionsCount).toBeGreaterThanOrEqual(1);
      expect(stats.tasksCount).toBeGreaterThanOrEqual(1);
      expect(stats.errorsCount).toBeGreaterThanOrEqual(1);
      expect(stats.dbSizeBytes).toBeGreaterThan(0);
    });
  });

  describe('Clear and Reset', () => {
    it('should clear all data', () => {
      store.startSession('clear-sess');
      store.recordTask({
        workerId: 'w1',
        taskType: 'bead',
        startedAt: Date.now(),
        endedAt: Date.now() + 1000,
        cost: 0.01,
        tokensIn: 100,
        tokensOut: 50,
        success: true,
        retryCount: 0,
      });

      store.clear();

      const stats = store.getStats();
      expect(stats.sessionsCount).toBe(0);
      expect(stats.tasksCount).toBe(0);
      expect(stats.errorsCount).toBe(0);
    });
  });

  describe('Database Path', () => {
    it('should return database path', () => {
      const dbPath = store.getDatabasePath();
      expect(dbPath).toBe(TEST_DB_PATH);
    });

    it('should use default path if not specified', () => {
      const defaultStore = new HistoricalStore();
      const dbPath = defaultStore.getDatabasePath();
      expect(dbPath).toContain('.needle');
      expect(dbPath).toContain('fabric.db');
      defaultStore.close();
    });
  });

  describe('OTLP Metric Persistence', () => {
    it('should record metric samples and upsert session worker summaries from OTLP metrics', () => {
      store.startSession('otlp-metric-sess');

      const accumulator = new MetricAccumulator();

      // Simulate OTLP metric events flowing through the normalizer → accumulator → store
      const metrics = [
        { name: INSTRUMENT_NAMES.TOKENS_IN, value: 1500, worker: 'needle-alpha' },
        { name: INSTRUMENT_NAMES.TOKENS_OUT, value: 600, worker: 'needle-alpha' },
        { name: INSTRUMENT_NAMES.COST_USD, value: 0.084, worker: 'needle-alpha' },
        { name: INSTRUMENT_NAMES.BEAD_COMPLETED, value: 2, worker: 'needle-alpha' },
        { name: INSTRUMENT_NAMES.BEAD_FAILED, value: 1, worker: 'needle-alpha' },
        { name: INSTRUMENT_NAMES.WORKER_ERRORS, value: 1, worker: 'needle-alpha' },
        { name: INSTRUMENT_NAMES.BEAD_DURATION, value: 4500, worker: 'needle-alpha' },
      ];

      for (const m of metrics) {
        // Simulate what extractDataPoints + normalizer produces
        const rawPoint = {
          name: m.name,
          timeUnixNano: String(Date.now() * 1_000_000),
          asDouble: m.value,
          attributes: [
            { key: 'worker_id', value: { stringValue: m.worker } },
            { key: 'session_id', value: { stringValue: 'otlp-metric-sess' } },
          ],
        };
        const logEvent = normalizeToLogEvent(rawPoint, 'otlp-metric');
        expect(logEvent).not.toBeNull();
        accumulator.processEvent(logEvent!);
      }

      // Drain and persist samples (mirrors store.ts flushMetricSamples)
      const samples = accumulator.drainSamples();
      for (const s of samples) {
        store.recordMetricSample({
          workerId: s.workerId,
          metricName: s.metricName,
          value: s.value,
          timestamp: s.timestamp,
          source: 'otlp-metric',
          beadId: s.beadId,
        });
      }

      // Upsert session worker summary from accumulator snapshot
      const snap = accumulator.getSnapshot('needle-alpha');
      expect(snap).not.toBeNull();
      store.upsertSessionWorkerSummary({
        workerId: 'needle-alpha',
        tokensIn: snap!.tokensIn,
        tokensOut: snap!.tokensOut,
        costUsd: snap!.costUsd,
        beadsCompleted: snap!.beadsCompleted,
        beadsFailed: snap!.beadsFailed,
        errors: snap!.errors,
        metricsSource: 'otlp-metric',
      });

      // Verify metric_samples were persisted
      const metricRows = store.getMetricSamples({ workerId: 'needle-alpha' });
      expect(metricRows).toHaveLength(7);
      expect(metricRows.every(r => r.source === 'otlp-metric')).toBe(true);

      // Verify session_worker_summaries were persisted with correct values
      const summaries = store.getSessionWorkerSummaries({ sessionId: 'otlp-metric-sess' });
      expect(summaries).toHaveLength(1);
      const summary = summaries[0];
      expect(summary.workerId).toBe('needle-alpha');
      expect(summary.tokensIn).toBe(1500);
      expect(summary.tokensOut).toBe(600);
      expect(summary.costUsd).toBeCloseTo(0.084);
      expect(summary.beadsCompleted).toBe(2);
      expect(summary.beadsFailed).toBe(1);
      expect(summary.errors).toBe(1);
      expect(summary.metricsSource).toBe('otlp-metric');

      // Verify getAggregatedAnalytics prefers metric-sourced data
      store.endSession({
        workerCount: 1,
        taskCount: 3,
        totalCost: 0.084,
        totalTokens: 2100,
        metricsSource: 'otlp-metric',
      });
    });

    it('should handle histogram metric data points via sum field', () => {
      store.startSession('histogram-sess');

      // Simulate a histogram data point — no asDouble/asInt, only sum/count
      const rawPoint = {
        name: INSTRUMENT_NAMES.BEAD_DURATION,
        timeUnixNano: String(Date.now() * 1_000_000),
        sum: 12345,
        count: '1',
        attributes: [
          { key: 'worker_id', value: { stringValue: 'needle-beta' } },
          { key: 'session_id', value: { stringValue: 'histogram-sess' } },
        ],
      };

      const logEvent = normalizeToLogEvent(rawPoint, 'otlp-metric');
      expect(logEvent).not.toBeNull();
      expect(logEvent!.value).toBe(12345);

      const accumulator = new MetricAccumulator();
      accumulator.processEvent(logEvent!);

      const snap = accumulator.getSnapshot('needle-beta');
      expect(snap).not.toBeNull();
      expect(snap!.durations).toEqual([12345]);

      // Persist
      const samples = accumulator.drainSamples();
      for (const s of samples) {
        store.recordMetricSample({
          workerId: s.workerId,
          metricName: s.metricName,
          value: s.value,
          timestamp: s.timestamp,
          source: 'otlp-metric',
        });
      }

      const metricRows = store.getMetricSamples({ metricName: INSTRUMENT_NAMES.BEAD_DURATION });
      expect(metricRows).toHaveLength(1);
      expect(metricRows[0].value).toBe(12345);
      expect(metricRows[0].source).toBe('otlp-metric');

      store.endSession({ workerCount: 1, taskCount: 0, totalCost: 0, totalTokens: 0 });
    });

    it('should prefer otlp-metric summaries over log-derived task_metrics in aggregated analytics', () => {
      const now = Date.now();

      // Session with both log-derived task_metrics AND otlp-metric summaries
      store.startSession('mixed-sess');

      // Log-derived task (coarse estimates)
      store.recordTask({
        workerId: 'needle-gamma',
        taskType: 'bead',
        startedAt: now - 10000,
        endedAt: now - 5000,
        cost: 0.1,
        tokensIn: 700,
        tokensOut: 300,
        success: true,
        retryCount: 0,
      });

      // OTLP-metric summary (authoritative)
      store.upsertSessionWorkerSummary({
        workerId: 'needle-gamma',
        tokensIn: 1200,
        tokensOut: 450,
        costUsd: 0.092,
        beadsCompleted: 5,
        beadsFailed: 0,
        errors: 0,
        metricsSource: 'otlp-metric',
      });

      store.endSession({
        workerCount: 1,
        taskCount: 5,
        totalCost: 0.092,
        totalTokens: 1650,
        metricsSource: 'otlp-metric',
      });

      // Query aggregated analytics — metric-sourced data should win
      const analytics = store.getAggregatedAnalytics({
        startTime: now - 60000,
        endTime: now + 60000,
      });

      // The worker should appear with metric-sourced values
      const gammaPerf = analytics.topPerformers.find(p => p.workerId === 'needle-gamma');
      expect(gammaPerf).toBeDefined();
      // OTLP metric data: 5 completed, 0.092 cost, 1650 tokens
      expect(gammaPerf!.beadsCompleted).toBe(5);
      expect(gammaPerf!.totalCostUsd).toBeCloseTo(0.092);
      expect(gammaPerf!.totalTokens).toBe(1650);
    });

    it('should prefer otlp-metric source over log-derived in getLatestWorkerMetrics', () => {
      store.startSession('source-pref-sess');

      // Write a log-derived sample first
      store.recordMetricSample({
        workerId: 'needle-delta',
        metricName: INSTRUMENT_NAMES.TOKENS_IN,
        value: 500,
        timestamp: Date.now() - 1000,
        source: 'log-derived',
      });

      // Write an OTLP-metric sample for the same instrument
      store.recordMetricSample({
        workerId: 'needle-delta',
        metricName: INSTRUMENT_NAMES.TOKENS_IN,
        value: 1200,
        timestamp: Date.now(),
        source: 'otlp-metric',
      });

      const latest = store.getLatestWorkerMetrics('needle-delta');
      expect(latest[INSTRUMENT_NAMES.TOKENS_IN]).toBeDefined();
      expect(latest[INSTRUMENT_NAMES.TOKENS_IN].value).toBe(1200);
      expect(latest[INSTRUMENT_NAMES.TOKENS_IN].source).toBe('otlp-metric');

      store.endSession({ workerCount: 1, taskCount: 0, totalCost: 0, totalTokens: 0 });
    });

    it('should mark metricsSource as otlp-metric even without cost data', () => {
      store.startSession('no-cost-sess');

      const accumulator = new MetricAccumulator();

      // Only send token metrics — no cost
      const logEvent1 = normalizeToLogEvent({
        name: INSTRUMENT_NAMES.TOKENS_IN,
        timeUnixNano: String(Date.now() * 1_000_000),
        asDouble: 800,
        attributes: [
          { key: 'worker_id', value: { stringValue: 'needle-epsilon' } },
          { key: 'session_id', value: { stringValue: 'no-cost-sess' } },
        ],
      }, 'otlp-metric');
      accumulator.processEvent(logEvent1!);

      const snap = accumulator.getSnapshot('needle-epsilon');
      expect(snap).not.toBeNull();
      // costUsd should be 0 but source should still be otlp-metric
      expect(snap!.costUsd).toBe(0);
      expect(snap!.tokensIn).toBe(800);

      store.upsertSessionWorkerSummary({
        workerId: 'needle-epsilon',
        tokensIn: snap!.tokensIn,
        tokensOut: snap!.tokensOut,
        costUsd: snap!.costUsd,
        beadsCompleted: snap!.beadsCompleted,
        beadsFailed: snap!.beadsFailed,
        errors: snap!.errors,
        metricsSource: snap ? 'otlp-metric' : 'log-derived',
      });

      const summaries = store.getSessionWorkerSummaries({ sessionId: 'no-cost-sess' });
      expect(summaries).toHaveLength(1);
      expect(summaries[0].metricsSource).toBe('otlp-metric');
      expect(summaries[0].tokensIn).toBe(800);
      expect(summaries[0].costUsd).toBe(0);

      store.endSession({ workerCount: 1, taskCount: 0, totalCost: 0, totalTokens: 800, metricsSource: 'otlp-metric' });
    });

    it('should protect otlp-metric rows from log-derived overwrites', () => {
      store.startSession('priority-sess');

      // Write the authoritative metric-sourced row first
      store.upsertSessionWorkerSummary({
        workerId: 'needle-zeta',
        tokensIn: 2000,
        tokensOut: 800,
        costUsd: 0.12,
        beadsCompleted: 6,
        beadsFailed: 0,
        errors: 0,
        metricsSource: 'otlp-metric',
      });

      // Attempt to overwrite with lower-priority log-derived data
      store.upsertSessionWorkerSummary({
        workerId: 'needle-zeta',
        tokensIn: 500,
        tokensOut: 200,
        costUsd: 0.05,
        beadsCompleted: 2,
        beadsFailed: 1,
        errors: 1,
        metricsSource: 'log-derived',
      });

      const summaries = store.getSessionWorkerSummaries({ sessionId: 'priority-sess' });
      expect(summaries).toHaveLength(1);
      const s = summaries[0];
      // Metric-sourced values must survive the log-derived overwrite
      expect(s.metricsSource).toBe('otlp-metric');
      expect(s.tokensIn).toBe(2000);
      expect(s.tokensOut).toBe(800);
      expect(s.costUsd).toBeCloseTo(0.12);
      expect(s.beadsCompleted).toBe(6);

      // A second metric-sourced write should still update (equal priority)
      store.upsertSessionWorkerSummary({
        workerId: 'needle-zeta',
        tokensIn: 2500,
        tokensOut: 1000,
        costUsd: 0.15,
        beadsCompleted: 8,
        beadsFailed: 0,
        errors: 0,
        metricsSource: 'otlp-metric',
      });

      const updated = store.getSessionWorkerSummaries({ sessionId: 'priority-sess' });
      expect(updated[0].tokensIn).toBe(2500);
      expect(updated[0].beadsCompleted).toBe(8);

      store.endSession({ workerCount: 1, taskCount: 8, totalCost: 0.15, totalTokens: 3500, metricsSource: 'otlp-metric' });
    });
  });
});
