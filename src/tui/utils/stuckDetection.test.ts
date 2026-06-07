/**
 * Tests for Stuck Worker Detection
 */

import { describe, it, expect } from 'vitest';
import { isWorkerStuck, getStuckReason, getStuckIndicator, StuckPattern } from './stuckDetection.js';
import { LogEvent, WorkerInfo } from '../../types.js';

const makeWorker = (overrides: Partial<WorkerInfo> = {}): WorkerInfo => ({
  id: 'w-test',
  status: 'active',
  beadsCompleted: 0, // All processed (including timed-out/deferred)
  beadsSucceeded: 3, // Successful completions only
  beadsTimedOut: 0, // Timed out or deferred
  firstSeen: Date.now() - 5 * 60 * 1000,
  lastActivity: Date.now(),
  activeFiles: [],
  hasCollision: false,
  activeDirectories: [],
  collisionTypes: [],
  eventCount: 10,
  currentBead: null,
  ...overrides,
});

const makeEvent = (overrides: Partial<LogEvent> = {}): LogEvent => ({
  ts: Date.now(),
  worker: 'w-test',
  level: 'info',
  msg: 'test event',
  ...overrides,
});

describe('Stuck Detection', () => {
  describe('isWorkerStuck', () => {
    it('returns null for a healthy worker with recent events', () => {
      const worker = makeWorker();
      const events = [makeEvent()];

      expect(isWorkerStuck(worker, events)).toBeNull();
    });

    it('returns null when no events exist', () => {
      const worker = makeWorker();

      expect(isWorkerStuck(worker, [])).toBeNull();
    });
  });

  describe('state-transition gap detection', () => {
    it('detects worker stuck in WORKING with no state transition for too long', () => {
      const gapMs = 7 * 60 * 1000; // 7 minutes (< 2×5min threshold)
      const worker = makeWorker({
        needleState: 'WORKING',
        lastStateTransition: Date.now() - gapMs,
      });
      const events = [makeEvent()];

      const pattern = isWorkerStuck(worker, events, {
        stateTransitionGapMs: 5 * 60 * 1000,
      });

      expect(pattern).not.toBeNull();
      expect(pattern!.type).toBe('state_gap');
      expect(pattern!.severity).toBe('warning');
      expect(pattern!.reason).toContain('WORKING');
      expect(pattern!.reason).toContain('7m');
    });

    it('escalates to critical at 2x the gap threshold', () => {
      const gapMs = 15 * 60 * 1000; // 15 minutes (> 2×5min threshold)
      const worker = makeWorker({
        needleState: 'WORKING',
        lastStateTransition: Date.now() - gapMs,
      });
      const events = [makeEvent()];

      const pattern = isWorkerStuck(worker, events, {
        stateTransitionGapMs: 5 * 60 * 1000,
      });

      expect(pattern).not.toBeNull();
      expect(pattern!.severity).toBe('critical');
    });

    it('does not fire for STOPPED workers', () => {
      const worker = makeWorker({
        needleState: 'STOPPED',
        lastStateTransition: Date.now() - 10 * 60 * 1000,
      });
      const events = [makeEvent()];

      const pattern = isWorkerStuck(worker, events, {
        stateTransitionGapMs: 5 * 60 * 1000,
      });

      expect(pattern).toBeNull();
    });

    it('does not fire when gap is under threshold', () => {
      const worker = makeWorker({
        needleState: 'WORKING',
        lastStateTransition: Date.now() - 2 * 60 * 1000, // 2 min
      });
      const events = [makeEvent()];

      const pattern = isWorkerStuck(worker, events, {
        stateTransitionGapMs: 5 * 60 * 1000,
      });

      expect(pattern).toBeNull();
    });

    it('does not fire when needleState is not set', () => {
      const worker = makeWorker();
      const events = [makeEvent()];

      const pattern = isWorkerStuck(worker, events, {
        stateTransitionGapMs: 5 * 60 * 1000,
      });

      expect(pattern).toBeNull();
    });

    it('detects gap for SELECTING state', () => {
      const worker = makeWorker({
        needleState: 'SELECTING',
        lastStateTransition: Date.now() - 8 * 60 * 1000,
      });
      const events = [makeEvent()];

      const pattern = isWorkerStuck(worker, events, {
        stateTransitionGapMs: 5 * 60 * 1000,
      });

      expect(pattern).not.toBeNull();
      expect(pattern!.type).toBe('state_gap');
      expect(pattern!.reason).toContain('SELECTING');
    });

    it('detects gap for CLAIMING state', () => {
      const worker = makeWorker({
        needleState: 'CLAIMING',
        lastStateTransition: Date.now() - 7 * 60 * 1000,
      });
      const events = [makeEvent()];

      const pattern = isWorkerStuck(worker, events, {
        stateTransitionGapMs: 5 * 60 * 1000,
      });

      expect(pattern).not.toBeNull();
      expect(pattern!.reason).toContain('CLAIMING');
    });
  });

  describe('getStuckReason', () => {
    it('returns the reason string when stuck', () => {
      const worker = makeWorker({
        needleState: 'WORKING',
        lastStateTransition: Date.now() - 10 * 60 * 1000,
      });
      const events = [makeEvent()];

      const reason = getStuckReason(worker, events, {
        stateTransitionGapMs: 5 * 60 * 1000,
      });

      expect(reason).toContain('WORKING');
    });

    it('returns null when not stuck', () => {
      const worker = makeWorker();
      const events = [makeEvent()];

      expect(getStuckReason(worker, events)).toBeNull();
    });
  });

  describe('getStuckIndicator', () => {
    it('returns ⚠ for critical', () => {
      const pattern: StuckPattern = {
        type: 'state_gap',
        reason: 'test',
        severity: 'critical',
        evidence: [],
        suggestion: 'test',
      };
      expect(getStuckIndicator(pattern)).toBe('⚠');
    });

    it('returns ⚡ for warning', () => {
      const pattern: StuckPattern = {
        type: 'state_gap',
        reason: 'test',
        severity: 'warning',
        evidence: [],
        suggestion: 'test',
      };
      expect(getStuckIndicator(pattern)).toBe('⚡');
    });

    it('returns empty string for null', () => {
      expect(getStuckIndicator(null)).toBe('');
    });
  });

  describe('long-running detection', () => {
    it('detects worker with many beads released but zero successful completions', () => {
      // Worker that has processed 100 beads (all timed out/deferred)
      const worker = makeWorker({
        firstSeen: Date.now() - 40 * 60 * 1000, // 40 minutes ago
        lastActivity: Date.now(), // Recent activity to avoid no_progress detection
        beadsCompleted: 100, // All beads timed out/deferred (now counts processed)
        beadsSucceeded: 0, // No successful completions
      });
      const events: LogEvent[] = [];
      // Create only 5 events to avoid triggering "events but no completions" in no_progress
      for (let i = 0; i < 5; i++) {
        events.push(makeEvent({ ts: Date.now() - i * 30000, msg: 'working on task' }));
      }

      const pattern = isWorkerStuck(worker, events);

      expect(pattern).not.toBeNull();
      expect(pattern!.type).toBe('long_running');
      expect(pattern!.reason).toContain('40m'); // Running for 40 minutes
      expect(pattern!.reason).toContain('100 processed'); // 100 beads processed
      expect(pattern!.reason).toContain('0 successful completions'); // No successful completions
      expect(pattern!.reason).toContain('timed out/deferred'); // Clarifies why
      expect(pattern!.evidence).toContain('Beads successfully completed: 0');
      expect(pattern!.evidence).toContain('Beads processed (including timed-out/deferred): 100');
    });

    it('detects worker with only 1 successful completion after long runtime', () => {
      const worker = makeWorker({
        firstSeen: Date.now() - 30 * 60 * 1000, // 30 minutes ago
        beadsCompleted: 50, // 50 beads processed (including timed-out)
        beadsSucceeded: 1, // Only 1 successful completion
      });
      const events: LogEvent[] = [];
      for (let i = 0; i < 30; i++) {
        events.push(makeEvent({ ts: Date.now() - i * 40000 }));
      }

      const pattern = isWorkerStuck(worker, events);

      expect(pattern).not.toBeNull();
      expect(pattern!.type).toBe('long_running');
      expect(pattern!.reason).toContain('30m');
      expect(pattern!.reason).toContain('only 1 successful completion');
      expect(pattern!.evidence).toContain('Beads successfully completed: 1');
      expect(pattern!.evidence).toContain('Beads processed (including timed-out/deferred): 50');
    });
  });

  describe('legacy detection (non-state-transition)', () => {
    it('still detects repeated tool calls', () => {
      const worker = makeWorker();
      const events: LogEvent[] = [];
      for (let i = 0; i < 6; i++) {
        events.push(makeEvent({ tool: 'Read', path: '/src/index.ts', ts: Date.now() - i * 10000 }));
      }

      const pattern = isWorkerStuck(worker, events);

      expect(pattern).not.toBeNull();
      expect(pattern!.type).toBe('repeated_tool');
    });

    it('still detects no progress', () => {
      const worker = makeWorker({
        lastActivity: Date.now() - 3 * 60 * 1000,
      });
      const events = [makeEvent({ ts: Date.now() - 3 * 60 * 1000 })];

      const pattern = isWorkerStuck(worker, events, {
        noProgressThresholdMs: 2 * 60 * 1000,
      });

      expect(pattern).not.toBeNull();
      expect(pattern!.type).toBe('no_progress');
    });
  });
});
