/**
 * Session Digest Tests
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { SessionDigestGenerator, formatDigestAsMarkdown } from './sessionDigest.js';
import { InMemoryEventStore } from './store.js';
import { LogEvent, SessionDigest } from './types.js';
import { CostTracker } from './tui/utils/costTracking.js';

describe('SessionDigestGenerator', () => {
  let store: InMemoryEventStore;
  let generator: SessionDigestGenerator;
  let costTracker: CostTracker;

  beforeEach(() => {
    store = new InMemoryEventStore();
    costTracker = new CostTracker();
    generator = new SessionDigestGenerator(store, costTracker);
  });

  describe('generateDigest', () => {
    test('generates empty digest for no events', () => {
      const digest = generator.generateDigest();

      expect(digest.beadsCompleted).toHaveLength(0);
      expect(digest.filesModified).toHaveLength(0);
      expect(digest.errors).toHaveLength(0);
      expect(digest.workers).toHaveLength(0);
      expect(digest.stats.totalEvents).toBe(0);
      expect(digest.stats.totalWorkers).toBe(0);
    });

    test('extracts bead completions from events', () => {
      const now = Date.now();

      // Add events showing bead work
      const events: LogEvent[] = [
        {
          ts: now,
          worker: 'w-abc',
          level: 'info',
          msg: 'Started working on bead',
          bead: 'bd-123',
        },
        {
          ts: now + 1000,
          worker: 'w-abc',
          level: 'info',
          msg: 'Bead completed successfully',
          bead: 'bd-123',
        },
        {
          ts: now + 2000,
          worker: 'w-xyz',
          level: 'info',
          msg: 'Task finished',
          bead: 'bd-456',
        },
      ];

      events.forEach(e => store.add(e));

      const digest = generator.generateDigest();

      expect(digest.beadsCompleted.length).toBeGreaterThanOrEqual(1);
      const bd123 = digest.beadsCompleted.find(b => b.beadId === 'bd-123');
      expect(bd123).toBeDefined();
      expect(bd123?.workerId).toBe('w-abc');
      expect(bd123?.durationMs).toBeGreaterThan(0);
    });

    test('extracts file modifications', () => {
      const now = Date.now();

      const events: LogEvent[] = [
        {
          ts: now,
          worker: 'w-abc',
          level: 'info',
          msg: 'Editing file',
          tool: 'Edit',
          path: '/src/file1.ts',
        },
        {
          ts: now + 1000,
          worker: 'w-abc',
          level: 'info',
          msg: 'Editing file again',
          tool: 'Edit',
          path: '/src/file1.ts',
        },
        {
          ts: now + 2000,
          worker: 'w-xyz',
          level: 'info',
          msg: 'Writing file',
          tool: 'Write',
          path: '/src/file2.ts',
        },
        {
          ts: now + 3000,
          worker: 'w-xyz',
          level: 'info',
          msg: 'Reading file',
          tool: 'Read',
          path: '/src/file3.ts',
        },
      ];

      events.forEach(e => store.add(e));

      const digest = generator.generateDigest();

      expect(digest.filesModified).toHaveLength(2);

      const file1 = digest.filesModified.find(f => f.path === '/src/file1.ts');
      expect(file1).toBeDefined();
      expect(file1?.modifications).toBe(2);
      expect(file1?.workers).toContain('w-abc');
      expect(file1?.tools).toContain('Edit');

      const file2 = digest.filesModified.find(f => f.path === '/src/file2.ts');
      expect(file2).toBeDefined();
      expect(file2?.modifications).toBe(1);
      expect(file2?.workers).toContain('w-xyz');

      // file3.ts should not be included (Read is not a modification)
      const file3 = digest.filesModified.find(f => f.path === '/src/file3.ts');
      expect(file3).toBeUndefined();
    });

    test('extracts errors from events', () => {
      const now = Date.now();

      const events: LogEvent[] = [
        {
          ts: now,
          worker: 'w-abc',
          level: 'error',
          msg: 'ECONNREFUSED connection failed',
          error: 'Network error',
        },
        {
          ts: now + 1000,
          worker: 'w-xyz',
          level: 'error',
          msg: 'File not found',
          error: 'ENOENT: no such file',
        },
        {
          ts: now + 2000,
          worker: 'w-abc',
          level: 'warn',
          msg: 'Warning message',
        },
      ];

      events.forEach(e => store.add(e));

      const digest = generator.generateDigest({ includeErrors: true });

      expect(digest.errors).toHaveLength(2);

      const networkError = digest.errors.find(e => e.category === 'network');
      expect(networkError).toBeDefined();
      expect(networkError?.workerId).toBe('w-abc');

      const notFoundError = digest.errors.find(e => e.category === 'not_found');
      expect(notFoundError).toBeDefined();
      expect(notFoundError?.workerId).toBe('w-xyz');
    });

    test('generates worker summaries', () => {
      const now = Date.now();

      const events: LogEvent[] = [
        {
          ts: now,
          worker: 'w-abc',
          level: 'info',
          msg: 'Event 1',
          bead: 'bd-123',
          path: '/src/file1.ts',
        },
        {
          ts: now + 1000,
          worker: 'w-abc',
          level: 'info',
          msg: 'Event 2',
          bead: 'bd-123',
          path: '/src/file2.ts',
        },
        {
          ts: now + 2000,
          worker: 'w-xyz',
          level: 'error',
          msg: 'Error occurred',
          error: 'Test error',
        },
      ];

      events.forEach(e => store.add(e));

      const digest = generator.generateDigest();

      expect(digest.workers).toHaveLength(2);

      const workerAbc = digest.workers.find(w => w.workerId === 'w-abc');
      expect(workerAbc).toBeDefined();
      expect(workerAbc?.totalEvents).toBe(2);
      expect(workerAbc?.beadsCompleted).toBe(1);
      expect(workerAbc?.filesModified).toBe(2);
      expect(workerAbc?.errorsEncountered).toBe(0);
      expect(workerAbc?.activeTimeMs).toBe(1000);

      const workerXyz = digest.workers.find(w => w.workerId === 'w-xyz');
      expect(workerXyz).toBeDefined();
      expect(workerXyz?.totalEvents).toBe(1);
      expect(workerXyz?.errorsEncountered).toBe(1);
    });

    test('calculates statistics correctly', () => {
      const now = Date.now();

      const events: LogEvent[] = [
        {
          ts: now,
          worker: 'w-abc',
          level: 'info',
          msg: 'Working',
          bead: 'bd-123',
          tool: 'Edit',
          path: '/file1.ts',
        },
        {
          ts: now + 1000,
          worker: 'w-xyz',
          level: 'info',
          msg: 'Working',
          bead: 'bd-456',
          tool: 'Write',
          path: '/file2.ts',
        },
        {
          ts: now + 2000,
          worker: 'w-abc',
          level: 'error',
          msg: 'Error',
          error: 'Test error',
        },
      ];

      events.forEach(e => store.add(e));

      const digest = generator.generateDigest();

      expect(digest.stats.totalEvents).toBe(3);
      expect(digest.stats.totalWorkers).toBe(2);
      expect(digest.stats.totalBeads).toBeGreaterThanOrEqual(2);
      expect(digest.stats.totalFiles).toBe(2);
      expect(digest.stats.totalErrors).toBe(1);
      expect(digest.stats.avgEventsPerWorker).toBe(1.5);
    });

    test('filters by time range', () => {
      const now = Date.now();

      const events: LogEvent[] = [
        { ts: now - 2000, worker: 'w-abc', level: 'info', msg: 'Old event' },
        { ts: now, worker: 'w-abc', level: 'info', msg: 'Current event' },
        { ts: now + 2000, worker: 'w-abc', level: 'info', msg: 'Future event' },
      ];

      events.forEach(e => store.add(e));

      const digest = generator.generateDigest({
        startTime: now - 500,
        endTime: now + 500,
      });

      expect(digest.stats.totalEvents).toBe(1);
    });

    test('filters by workers', () => {
      const now = Date.now();

      const events: LogEvent[] = [
        { ts: now, worker: 'w-abc', level: 'info', msg: 'Event 1' },
        { ts: now + 1000, worker: 'w-xyz', level: 'info', msg: 'Event 2' },
        { ts: now + 2000, worker: 'w-123', level: 'info', msg: 'Event 3' },
      ];

      events.forEach(e => store.add(e));

      const digest = generator.generateDigest({
        workers: ['w-abc', 'w-xyz'],
      });

      expect(digest.stats.totalEvents).toBe(2);
      expect(digest.stats.totalWorkers).toBe(2);
    });

    test('limits files and errors', () => {
      const now = Date.now();

      // Add many files
      for (let i = 0; i < 100; i++) {
        store.add({
          ts: now + i,
          worker: 'w-abc',
          level: 'info',
          msg: `Editing file ${i}`,
          tool: 'Edit',
          path: `/src/file${i}.ts`,
        });
      }

      // Add many errors
      for (let i = 0; i < 100; i++) {
        store.add({
          ts: now + 1000 + i,
          worker: 'w-abc',
          level: 'error',
          msg: `Error ${i}`,
          error: `Error message ${i}`,
        });
      }

      const digest = generator.generateDigest({
        maxFiles: 10,
        maxErrors: 5,
      });

      expect(digest.filesModified.length).toBeLessThanOrEqual(10);
      expect(digest.errors.length).toBeLessThanOrEqual(5);
    });

    test('includes cost data when token events are present', () => {
      const now = Date.now();

      const events: LogEvent[] = [
        {
          ts: now,
          worker: 'w-abc',
          level: 'info',
          msg: 'API call',
          input_tokens: 1000,
          output_tokens: 500,
        } as LogEvent,
        {
          ts: now + 1000,
          worker: 'w-xyz',
          level: 'info',
          msg: 'API call',
          input_tokens: 2000,
          output_tokens: 1000,
        } as LogEvent,
      ];

      events.forEach(e => store.add(e));

      const digest = generator.generateDigest({ includeCost: true });

      expect(digest.cost.totalTokens).toBe(4500);
      expect(digest.cost.inputTokens).toBe(3000);
      expect(digest.cost.outputTokens).toBe(1500);
      expect(digest.cost.estimatedCostUsd).toBeGreaterThan(0);
    });
  });

  describe('formatDigestAsMarkdown', () => {
    test('formats empty digest', () => {
      const now = Date.now();
      const digest: SessionDigest = {
        sessionId: 'test-session',
        startTime: now,
        endTime: now + 1000,
        durationMs: 1000,
        beadsCompleted: [],
        filesModified: [],
        errors: [],
        workers: [],
        cost: {
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
        },
        stats: {
          totalEvents: 0,
          totalWorkers: 0,
          totalBeads: 0,
          totalFiles: 0,
          totalErrors: 0,
          avgEventsPerWorker: 0,
          avgBeadsPerWorker: 0,
        },
      };

      const markdown = formatDigestAsMarkdown(digest);

      expect(markdown).toContain('# Session Digest');
      expect(markdown).toContain('test-session');
      expect(markdown).toContain('## Summary');
      expect(markdown).toContain('Total Events');
    });

    test('formats complete digest with all sections', () => {
      const now = Date.now();
      const digest: SessionDigest = {
        sessionId: 'test-session',
        startTime: now,
        endTime: now + 60000,
        durationMs: 60000,
        beadsCompleted: [
          {
            beadId: 'bd-123',
            workerId: 'w-abc',
            completedAt: now + 30000,
            durationMs: 30000,
          },
        ],
        filesModified: [
          {
            path: '/src/file1.ts',
            modifications: 5,
            workers: ['w-abc'],
            tools: ['Edit'],
          },
        ],
        errors: [
          {
            message: 'Test error',
            category: 'network',
            workerId: 'w-abc',
            timestamp: now + 10000,
          },
        ],
        workers: [
          {
            workerId: 'w-abc',
            beadsCompleted: 1,
            filesModified: 1,
            errorsEncountered: 1,
            totalEvents: 10,
            activeTimeMs: 60000,
            firstActivity: now,
            lastActivity: now + 60000,
          },
        ],
        cost: {
          totalTokens: 5000,
          inputTokens: 3000,
          outputTokens: 2000,
          estimatedCostUsd: 0.05,
        },
        stats: {
          totalEvents: 10,
          totalWorkers: 1,
          totalBeads: 1,
          totalFiles: 1,
          totalErrors: 1,
          avgEventsPerWorker: 10,
          avgBeadsPerWorker: 1,
        },
      };

      const markdown = formatDigestAsMarkdown(digest);

      // Check all major sections
      expect(markdown).toContain('# Session Digest');
      expect(markdown).toContain('## Summary');
      expect(markdown).toContain('## Cost Summary');
      expect(markdown).toContain('## Worker Activity');
      expect(markdown).toContain('## Beads Completed');
      expect(markdown).toContain('## Files Modified');
      expect(markdown).toContain('## Errors Encountered');

      // Check content
      expect(markdown).toContain('bd-123');
      expect(markdown).toContain('w-abc');
      expect(markdown).toContain('/src/file1.ts');
      expect(markdown).toContain('Test error');
      expect(markdown).toContain('5,000');
      expect(markdown).toContain('$0.0500');
    });

    test('omits cost section when no tokens', () => {
      const now = Date.now();
      const digest: SessionDigest = {
        sessionId: 'test-session',
        startTime: now,
        endTime: now + 1000,
        durationMs: 1000,
        beadsCompleted: [],
        filesModified: [],
        errors: [],
        workers: [],
        cost: {
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
        },
        stats: {
          totalEvents: 10,
          totalWorkers: 1,
          totalBeads: 0,
          totalFiles: 0,
          totalErrors: 0,
          avgEventsPerWorker: 10,
          avgBeadsPerWorker: 0,
        },
      };

      const markdown = formatDigestAsMarkdown(digest);

      expect(markdown).not.toContain('## Cost Summary');
    });

    test('formats durations correctly', () => {
      const now = Date.now();
      const digest: SessionDigest = {
        sessionId: 'test-session',
        startTime: now,
        endTime: now + 3723000, // 1h 2m 3s
        durationMs: 3723000,
        beadsCompleted: [],
        filesModified: [],
        errors: [],
        workers: [
          {
            workerId: 'w-abc',
            beadsCompleted: 0,
            filesModified: 0,
            errorsEncountered: 0,
            totalEvents: 1,
            activeTimeMs: 3723000,
            firstActivity: now,
            lastActivity: now + 3723000,
          },
        ],
        cost: {
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: 0,
        },
        stats: {
          totalEvents: 1,
          totalWorkers: 1,
          totalBeads: 0,
          totalFiles: 0,
          totalErrors: 0,
          avgEventsPerWorker: 1,
          avgBeadsPerWorker: 0,
        },
      };

      const markdown = formatDigestAsMarkdown(digest);

      expect(markdown).toContain('1h 2m');
    });
  });
});
