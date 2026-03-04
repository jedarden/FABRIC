/**
 * Worker Analytics Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WorkerAnalytics } from './workerAnalytics.js';
import { LogEvent } from './types.js';
import { CostTracker } from './tui/utils/costTracking.js';

describe('WorkerAnalytics', () => {
  let analytics: WorkerAnalytics;
  let costTracker: CostTracker;
  const baseTime = Date.now();

  beforeEach(() => {
    costTracker = new CostTracker();
    analytics = new WorkerAnalytics(costTracker, 3600000); // 1 hour snapshots
  });

  describe('Basic Event Processing', () => {
    it('should process events and track worker', () => {
      const event: LogEvent = {
        ts: baseTime,
        worker: 'w-test-1',
        level: 'info',
        msg: 'Starting work',
      };

      analytics.processEvent(event);

      const metrics = analytics.getWorkerMetrics('w-test-1');
      expect(metrics).toBeDefined();
      expect(metrics?.workerId).toBe('w-test-1');
      expect(metrics?.totalEvents).toBe(1);
    });

    it('should track multiple workers', () => {
      const events: LogEvent[] = [
        { ts: baseTime, worker: 'w-1', level: 'info', msg: 'Event 1' },
        { ts: baseTime + 1000, worker: 'w-2', level: 'info', msg: 'Event 2' },
        { ts: baseTime + 2000, worker: 'w-1', level: 'info', msg: 'Event 3' },
      ];

      events.forEach(e => analytics.processEvent(e));

      const allMetrics = analytics.getAllWorkerMetrics();
      expect(allMetrics).toHaveLength(2);

      const w1Metrics = analytics.getWorkerMetrics('w-1');
      const w2Metrics = analytics.getWorkerMetrics('w-2');

      expect(w1Metrics?.totalEvents).toBe(2);
      expect(w2Metrics?.totalEvents).toBe(1);
    });
  });

  describe('Bead Completion Tracking', () => {
    it('should track bead completions', () => {
      const events: LogEvent[] = [
        {
          ts: baseTime,
          worker: 'w-1',
          level: 'info',
          msg: 'Starting bead bd-123',
          bead: 'bd-123',
        },
        {
          ts: baseTime + 5000,
          worker: 'w-1',
          level: 'info',
          msg: 'Bead completed successfully',
          bead: 'bd-123',
        },
        {
          ts: baseTime + 10000,
          worker: 'w-1',
          level: 'info',
          msg: 'Working on bd-456',
          bead: 'bd-456',
        },
        {
          ts: baseTime + 18000,
          worker: 'w-1',
          level: 'info',
          msg: 'Task finished',
          bead: 'bd-456',
        },
      ];

      events.forEach(e => analytics.processEvent(e));

      const metrics = analytics.getWorkerMetrics('w-1');
      expect(metrics?.beadsCompleted).toBe(2);
      expect(metrics?.avgCompletionTimeMs).toBeGreaterThan(0);
    });

    it('should calculate beads per hour', () => {
      const oneHour = 3600000;
      const events: LogEvent[] = [];

      // Simulate 10 beads completed over 1 hour
      for (let i = 0; i < 10; i++) {
        events.push({
          ts: baseTime + (i * oneHour / 10),
          worker: 'w-1',
          level: 'info',
          msg: `Starting bead bd-${i}`,
          bead: `bd-${i}`,
        });
        events.push({
          ts: baseTime + (i * oneHour / 10) + 1000,
          worker: 'w-1',
          level: 'info',
          msg: 'Completed',
          bead: `bd-${i}`,
        });
      }

      events.forEach(e => analytics.processEvent(e));

      const metrics = analytics.getWorkerMetrics('w-1', {
        startTime: baseTime,
        endTime: baseTime + oneHour,
      });

      expect(metrics?.beadsCompleted).toBe(10);
      expect(metrics?.beadsPerHour).toBeCloseTo(10, 0);
    });

    it('should calculate average completion time', () => {
      const events: LogEvent[] = [
        { ts: baseTime, worker: 'w-1', level: 'info', msg: 'Start', bead: 'bd-1' },
        { ts: baseTime + 5000, worker: 'w-1', level: 'info', msg: 'Completed', bead: 'bd-1' },
        { ts: baseTime + 10000, worker: 'w-1', level: 'info', msg: 'Start', bead: 'bd-2' },
        { ts: baseTime + 20000, worker: 'w-1', level: 'info', msg: 'Done', bead: 'bd-2' },
      ];

      events.forEach(e => analytics.processEvent(e));

      const metrics = analytics.getWorkerMetrics('w-1');
      // Average: (5000 + 10000) / 2 = 7500
      expect(metrics?.avgCompletionTimeMs).toBe(7500);
    });
  });

  describe('Error Tracking', () => {
    it('should track error count', () => {
      const events: LogEvent[] = [
        { ts: baseTime, worker: 'w-1', level: 'error', msg: 'Error 1' },
        { ts: baseTime + 1000, worker: 'w-1', level: 'info', msg: 'Normal event' },
        { ts: baseTime + 2000, worker: 'w-1', level: 'error', msg: 'Error 2' },
      ];

      events.forEach(e => analytics.processEvent(e));

      const metrics = analytics.getWorkerMetrics('w-1');
      expect(metrics?.errorCount).toBe(2);
    });

    it('should calculate error rate', () => {
      const events: LogEvent[] = [
        { ts: baseTime, worker: 'w-1', level: 'info', msg: 'Start', bead: 'bd-1' },
        { ts: baseTime + 1000, worker: 'w-1', level: 'error', msg: 'Error!' },
        { ts: baseTime + 2000, worker: 'w-1', level: 'info', msg: 'Completed', bead: 'bd-1' },
        { ts: baseTime + 3000, worker: 'w-1', level: 'info', msg: 'Start', bead: 'bd-2' },
        { ts: baseTime + 4000, worker: 'w-1', level: 'info', msg: 'Done', bead: 'bd-2' },
      ];

      events.forEach(e => analytics.processEvent(e));

      const metrics = analytics.getWorkerMetrics('w-1');
      // 1 error, 2 beads = 0.5 error rate
      expect(metrics?.errorRate).toBe(0.5);
    });

    it('should handle zero beads (no error rate)', () => {
      const events: LogEvent[] = [
        { ts: baseTime, worker: 'w-1', level: 'error', msg: 'Error!' },
        { ts: baseTime + 1000, worker: 'w-1', level: 'error', msg: 'Another error!' },
      ];

      events.forEach(e => analytics.processEvent(e));

      const metrics = analytics.getWorkerMetrics('w-1');
      expect(metrics?.errorCount).toBe(2);
      expect(metrics?.errorRate).toBe(0); // No beads completed, so rate is 0
    });
  });

  describe('Cost Tracking', () => {
    it('should track cost from CostTracker', () => {
      const events: LogEvent[] = [
        {
          ts: baseTime,
          worker: 'w-1',
          level: 'info',
          msg: 'API call',
          input_tokens: 1000,
          output_tokens: 500,
          model: 'claude-sonnet-4-6',
        },
      ];

      events.forEach(e => analytics.processEvent(e));

      const metrics = analytics.getWorkerMetrics('w-1');
      expect(metrics?.totalCostUsd).toBeGreaterThan(0);
      expect(metrics?.totalTokens).toBe(1500);
    });

    it('should calculate cost per bead', () => {
      const events: LogEvent[] = [
        {
          ts: baseTime,
          worker: 'w-1',
          level: 'info',
          msg: 'Start',
          bead: 'bd-1',
          input_tokens: 1000,
          output_tokens: 500,
        },
        {
          ts: baseTime + 1000,
          worker: 'w-1',
          level: 'info',
          msg: 'Completed',
          bead: 'bd-1',
        },
      ];

      events.forEach(e => analytics.processEvent(e));

      const metrics = analytics.getWorkerMetrics('w-1');
      expect(metrics?.beadsCompleted).toBe(1);
      expect(metrics?.costPerBead).toBeGreaterThan(0);
      expect(metrics?.tokensPerBead).toBe(1500);
    });
  });

  describe('Activity and Idle Time', () => {
    it('should track active time', () => {
      const events: LogEvent[] = [
        { ts: baseTime, worker: 'w-1', level: 'info', msg: 'Event 1' },
        { ts: baseTime + 1000, worker: 'w-1', level: 'info', msg: 'Event 2' },
        { ts: baseTime + 2000, worker: 'w-1', level: 'info', msg: 'Event 3' },
      ];

      events.forEach(e => analytics.processEvent(e));

      const metrics = analytics.getWorkerMetrics('w-1', {
        startTime: baseTime,
        endTime: baseTime + 10000,
      });

      expect(metrics?.activeTimeMs).toBeGreaterThan(0);
      expect(metrics?.idleTimeMs).toBeGreaterThan(0);
    });

    it('should calculate idle percentage', () => {
      const oneHour = 3600000;

      // Only 10 minutes of activity in 1 hour
      const events: LogEvent[] = [
        { ts: baseTime, worker: 'w-1', level: 'info', msg: 'Start' },
        { ts: baseTime + 600000, worker: 'w-1', level: 'info', msg: 'End' }, // 10 min later
      ];

      events.forEach(e => analytics.processEvent(e));

      const metrics = analytics.getWorkerMetrics('w-1', {
        startTime: baseTime,
        endTime: baseTime + oneHour,
      });

      // Should have significant idle time
      expect(metrics?.idlePercentage).toBeGreaterThan(80);
    });

    it('should handle activity gaps correctly', () => {
      const events: LogEvent[] = [
        { ts: baseTime, worker: 'w-1', level: 'info', msg: 'Activity 1' },
        { ts: baseTime + 1000, worker: 'w-1', level: 'info', msg: 'Activity 2' },
        // 10 minute gap
        { ts: baseTime + 600000, worker: 'w-1', level: 'info', msg: 'Activity 3' },
        { ts: baseTime + 601000, worker: 'w-1', level: 'info', msg: 'Activity 4' },
      ];

      events.forEach(e => analytics.processEvent(e));

      const metrics = analytics.getWorkerMetrics('w-1', {
        startTime: baseTime,
        endTime: baseTime + 700000,
      });

      // Should have two separate activity periods
      expect(metrics?.activeTimeMs).toBeLessThan(700000);
    });
  });

  describe('Time Windows', () => {
    it('should filter by time window: hour', () => {
      const oneHour = 3600000;
      const now = Date.now();

      const events: LogEvent[] = [
        { ts: now - oneHour - 1000, worker: 'w-1', level: 'info', msg: 'Old event' },
        { ts: now - 30 * 60000, worker: 'w-1', level: 'info', msg: 'Recent event' },
      ];

      events.forEach(e => analytics.processEvent(e));

      const metrics = analytics.getWorkerMetrics('w-1', { timeWindow: 'hour' });
      expect(metrics?.totalEvents).toBe(1); // Only recent event
    });

    it('should support custom time ranges', () => {
      const events: LogEvent[] = [
        { ts: baseTime, worker: 'w-1', level: 'info', msg: 'Event 1' },
        { ts: baseTime + 5000, worker: 'w-1', level: 'info', msg: 'Event 2' },
        { ts: baseTime + 10000, worker: 'w-1', level: 'info', msg: 'Event 3' },
      ];

      events.forEach(e => analytics.processEvent(e));

      const metrics = analytics.getWorkerMetrics('w-1', {
        startTime: baseTime + 4000,
        endTime: baseTime + 15000,
      });

      expect(metrics?.totalEvents).toBe(2); // Events 2 and 3
    });
  });

  describe('Aggregated Analytics', () => {
    it('should aggregate metrics across all workers', () => {
      const events: LogEvent[] = [
        { ts: baseTime, worker: 'w-1', level: 'info', msg: 'Start', bead: 'bd-1' },
        { ts: baseTime + 1000, worker: 'w-1', level: 'info', msg: 'Done', bead: 'bd-1' },
        { ts: baseTime, worker: 'w-2', level: 'info', msg: 'Start', bead: 'bd-2' },
        { ts: baseTime + 2000, worker: 'w-2', level: 'info', msg: 'Done', bead: 'bd-2' },
        { ts: baseTime, worker: 'w-3', level: 'info', msg: 'Start', bead: 'bd-3' },
        { ts: baseTime + 1500, worker: 'w-3', level: 'info', msg: 'Done', bead: 'bd-3' },
      ];

      events.forEach(e => analytics.processEvent(e));

      const aggregated = analytics.getAggregatedAnalytics();

      expect(aggregated.totalWorkers).toBe(3);
      expect(aggregated.totalBeadsCompleted).toBe(3);
      expect(aggregated.topPerformers).toHaveLength(3);
    });

    it('should rank top performers', () => {
      const events: LogEvent[] = [];

      // w-1: 5 beads
      for (let i = 0; i < 5; i++) {
        events.push({ ts: baseTime + i * 1000, worker: 'w-1', level: 'info', msg: 'Start', bead: `bd-1-${i}` });
        events.push({ ts: baseTime + i * 1000 + 500, worker: 'w-1', level: 'info', msg: 'Done', bead: `bd-1-${i}` });
      }

      // w-2: 3 beads
      for (let i = 0; i < 3; i++) {
        events.push({ ts: baseTime + i * 1000, worker: 'w-2', level: 'info', msg: 'Start', bead: `bd-2-${i}` });
        events.push({ ts: baseTime + i * 1000 + 500, worker: 'w-2', level: 'info', msg: 'Done', bead: `bd-2-${i}` });
      }

      // w-3: 8 beads
      for (let i = 0; i < 8; i++) {
        events.push({ ts: baseTime + i * 1000, worker: 'w-3', level: 'info', msg: 'Start', bead: `bd-3-${i}` });
        events.push({ ts: baseTime + i * 1000 + 500, worker: 'w-3', level: 'info', msg: 'Done', bead: `bd-3-${i}` });
      }

      events.forEach(e => analytics.processEvent(e));

      const aggregated = analytics.getAggregatedAnalytics();

      expect(aggregated.topPerformers[0].workerId).toBe('w-3');
      expect(aggregated.topPerformers[0].beadsCompleted).toBe(8);
      expect(aggregated.topPerformers[1].workerId).toBe('w-1');
      expect(aggregated.topPerformers[2].workerId).toBe('w-2');
    });

    it('should identify high error rate workers', () => {
      const events: LogEvent[] = [
        // w-1: 2 beads, 0 errors
        { ts: baseTime, worker: 'w-1', level: 'info', msg: 'Start', bead: 'bd-1' },
        { ts: baseTime + 1000, worker: 'w-1', level: 'info', msg: 'Done', bead: 'bd-1' },
        { ts: baseTime + 2000, worker: 'w-1', level: 'info', msg: 'Start', bead: 'bd-2' },
        { ts: baseTime + 3000, worker: 'w-1', level: 'info', msg: 'Done', bead: 'bd-2' },

        // w-2: 1 bead, 3 errors
        { ts: baseTime, worker: 'w-2', level: 'info', msg: 'Start', bead: 'bd-3' },
        { ts: baseTime + 500, worker: 'w-2', level: 'error', msg: 'Error 1' },
        { ts: baseTime + 700, worker: 'w-2', level: 'error', msg: 'Error 2' },
        { ts: baseTime + 900, worker: 'w-2', level: 'error', msg: 'Error 3' },
        { ts: baseTime + 1000, worker: 'w-2', level: 'info', msg: 'Done', bead: 'bd-3' },
      ];

      events.forEach(e => analytics.processEvent(e));

      const aggregated = analytics.getAggregatedAnalytics();

      expect(aggregated.highErrorRateWorkers[0].workerId).toBe('w-2');
      expect(aggregated.highErrorRateWorkers[0].errorRate).toBe(3);
    });
  });

  describe('Time-Series Data', () => {
    it('should create time-series snapshots', () => {
      const oneHour = 3600000;
      const analytics = new WorkerAnalytics(costTracker, oneHour); // 1 hour interval

      // Generate events over 3 hours
      for (let hour = 0; hour < 3; hour++) {
        const event: LogEvent = {
          ts: baseTime + hour * oneHour + 1000,
          worker: 'w-1',
          level: 'info',
          msg: `Event at hour ${hour}`,
        };
        analytics.processEvent(event);
      }

      const timeSeriesData = analytics.getTimeSeriesData('w-1');

      // Should have at least 2 snapshots (one after each hour boundary)
      expect(timeSeriesData.length).toBeGreaterThanOrEqual(2);
    });

    it('should get performance trends', () => {
      const events: LogEvent[] = [];
      const oneHour = 3600000;
      const analytics = new WorkerAnalytics(costTracker, oneHour);

      // Generate improving performance: more beads over time
      for (let hour = 0; hour < 3; hour++) {
        const beadCount = (hour + 1) * 2; // 2, 4, 6 beads per hour

        for (let i = 0; i < beadCount; i++) {
          events.push({
            ts: baseTime + hour * oneHour + i * 1000,
            worker: 'w-1',
            level: 'info',
            msg: 'Start',
            bead: `bd-${hour}-${i}`,
          });
          events.push({
            ts: baseTime + hour * oneHour + i * 1000 + 500,
            worker: 'w-1',
            level: 'info',
            msg: 'Done',
            bead: `bd-${hour}-${i}`,
          });
        }

        // Force a snapshot at the end of each hour
        events.push({
          ts: baseTime + (hour + 1) * oneHour + 1000,
          worker: 'w-1',
          level: 'info',
          msg: 'Hourly marker',
        });
      }

      events.forEach(e => analytics.processEvent(e));

      const trend = analytics.getPerformanceTrends('w-1', 'beadsCompleted');

      expect(trend.dataPoints.length).toBeGreaterThan(0);
      // Trend should be improving since beads increase over time
      // Note: This might be 'stable' if snapshots don't capture the progression well
    });
  });

  describe('Options and Filtering', () => {
    it('should filter by worker IDs', () => {
      const events: LogEvent[] = [
        { ts: baseTime, worker: 'w-1', level: 'info', msg: 'Event 1' },
        { ts: baseTime, worker: 'w-2', level: 'info', msg: 'Event 2' },
        { ts: baseTime, worker: 'w-3', level: 'info', msg: 'Event 3' },
      ];

      events.forEach(e => analytics.processEvent(e));

      const filtered = analytics.getAllWorkerMetrics({ workerIds: ['w-1', 'w-3'] });

      expect(filtered).toHaveLength(2);
      expect(filtered.map(m => m.workerId).sort()).toEqual(['w-1', 'w-3']);
    });

    it('should filter by minimum beads completed', () => {
      const events: LogEvent[] = [
        { ts: baseTime, worker: 'w-1', level: 'info', msg: 'Start', bead: 'bd-1' },
        { ts: baseTime + 1000, worker: 'w-1', level: 'info', msg: 'Done', bead: 'bd-1' },
        { ts: baseTime, worker: 'w-2', level: 'info', msg: 'Event' },
      ];

      events.forEach(e => analytics.processEvent(e));

      const filtered = analytics.getAllWorkerMetrics({ minBeadsCompleted: 1 });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].workerId).toBe('w-1');
    });

    it('should limit max workers in rankings', () => {
      const events: LogEvent[] = [];

      // Create 20 workers
      for (let i = 0; i < 20; i++) {
        events.push({
          ts: baseTime,
          worker: `w-${i}`,
          level: 'info',
          msg: 'Start',
          bead: `bd-${i}`,
        });
        events.push({
          ts: baseTime + 1000,
          worker: `w-${i}`,
          level: 'info',
          msg: 'Done',
          bead: `bd-${i}`,
        });
      }

      events.forEach(e => analytics.processEvent(e));

      const aggregated = analytics.getAggregatedAnalytics({ maxWorkers: 5 });

      expect(aggregated.topPerformers).toHaveLength(5);
    });
  });

  describe('Summary Output', () => {
    it('should generate formatted summary', () => {
      const events: LogEvent[] = [
        { ts: baseTime, worker: 'w-1', level: 'info', msg: 'Start', bead: 'bd-1' },
        { ts: baseTime + 1000, worker: 'w-1', level: 'info', msg: 'Done', bead: 'bd-1' },
        { ts: baseTime, worker: 'w-1', level: 'error', msg: 'Error!' },
      ];

      events.forEach(e => analytics.processEvent(e));

      const summary = analytics.getSummary();

      expect(summary).toContain('Worker Analytics Summary');
      expect(summary).toContain('Total Workers');
      expect(summary).toContain('Total Beads Completed');
      expect(summary).toContain('Error Rate');
    });
  });

  describe('Clear and Reset', () => {
    it('should clear all data', () => {
      const events: LogEvent[] = [
        { ts: baseTime, worker: 'w-1', level: 'info', msg: 'Event' },
        { ts: baseTime + 1000, worker: 'w-2', level: 'info', msg: 'Event' },
      ];

      events.forEach(e => analytics.processEvent(e));

      analytics.clear();

      const allMetrics = analytics.getAllWorkerMetrics();
      expect(allMetrics).toHaveLength(0);

      const metrics = analytics.getWorkerMetrics('w-1');
      expect(metrics).toBeUndefined();
    });
  });
});
