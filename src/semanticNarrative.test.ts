/**
 * Tests for Semantic Narrative Summarization
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticNarrativeGenerator } from './semanticNarrative.js';
import { LogEvent, NarrativeUpdate, EventPattern } from './types.js';

describe('SemanticNarrativeGenerator', () => {
  let generator: SemanticNarrativeGenerator;

  beforeEach(() => {
    generator = new SemanticNarrativeGenerator();
  });

  describe('processEvent', () => {
    it('should process events and create narratives', () => {
      const event: LogEvent = {
        ts: Date.now(),
        worker: 'w-test-1',
        level: 'info',
        msg: 'Started working on task',
        bead: 'bd-123',
      };

      generator.processEvent(event);

      const narrative = generator.generateNarrative('w-test-1');
      expect(narrative).toBeDefined();
      expect(narrative.workerId).toBe('w-test-1');
      expect(narrative.stats.totalEvents).toBe(1);
    });

    it('should track multiple workers separately', () => {
      const event1: LogEvent = {
        ts: Date.now(),
        worker: 'w-alpha',
        level: 'info',
        msg: 'Working',
      };

      const event2: LogEvent = {
        ts: Date.now() + 1000,
        worker: 'w-beta',
        level: 'info',
        msg: 'Also working',
      };

      generator.processEvent(event1);
      generator.processEvent(event2);

      const narrativeAlpha = generator.generateNarrative('w-alpha');
      const narrativeBeta = generator.generateNarrative('w-beta');

      expect(narrativeAlpha.workerId).toBe('w-alpha');
      expect(narrativeBeta.workerId).toBe('w-beta');
      expect(narrativeAlpha.stats.totalEvents).toBe(1);
      expect(narrativeBeta.stats.totalEvents).toBe(1);
    });

    it('should track files, beads, and tools', () => {
      const events: LogEvent[] = [
        {
          ts: Date.now(),
          worker: 'w-test',
          level: 'info',
          msg: 'Editing file',
          tool: 'Edit',
          path: '/src/test.ts',
          bead: 'bd-123',
        },
        {
          ts: Date.now() + 1000,
          worker: 'w-test',
          level: 'info',
          msg: 'Writing file',
          tool: 'Write',
          path: '/src/new.ts',
          bead: 'bd-123',
        },
      ];

      events.forEach(e => generator.processEvent(e));

      const narrative = generator.generateNarrative('w-test');
      expect(narrative.stats.filesModified).toBe(2);
      expect(narrative.stats.toolsUsed).toBe(2);
      expect(narrative.stats.beadsWorked).toBe(1);
    });

    it('should count errors', () => {
      const events: LogEvent[] = [
        {
          ts: Date.now(),
          worker: 'w-test',
          level: 'error',
          msg: 'Error occurred',
          error: 'ECONNREFUSED',
        },
        {
          ts: Date.now() + 1000,
          worker: 'w-test',
          level: 'error',
          msg: 'Another error',
          error: 'File not found',
        },
      ];

      events.forEach(e => generator.processEvent(e));

      const narrative = generator.generateNarrative('w-test');
      expect(narrative.stats.errorsEncountered).toBe(2);
    });
  });

  describe('pattern detection', () => {
    it('should detect bead_started pattern', () => {
      const event: LogEvent = {
        ts: Date.now(),
        worker: 'w-test',
        level: 'info',
        msg: 'Started working on bead',
        bead: 'bd-456',
      };

      generator.processEvent(event);

      const narrative = generator.generateNarrative('w-test');
      expect(narrative.segments.length).toBeGreaterThan(0);
      expect(narrative.segments[0].pattern).toBe('bead_started');
    });

    it('should detect bead_completed pattern', () => {
      const event: LogEvent = {
        ts: Date.now(),
        worker: 'w-test',
        level: 'info',
        msg: 'Completed bead successfully',
        bead: 'bd-456',
      };

      generator.processEvent(event);

      const narrative = generator.generateNarrative('w-test');
      expect(narrative.segments.length).toBeGreaterThan(0);
      expect(narrative.segments[0].pattern).toBe('bead_completed');
    });

    it('should detect file_editing pattern', () => {
      const event: LogEvent = {
        ts: Date.now(),
        worker: 'w-test',
        level: 'info',
        msg: 'Editing file',
        tool: 'Edit',
        path: '/src/app.ts',
      };

      generator.processEvent(event);

      const narrative = generator.generateNarrative('w-test');
      expect(narrative.segments.length).toBeGreaterThan(0);
      expect(narrative.segments[0].pattern).toBe('file_editing');
    });

    it('should detect file_created pattern', () => {
      const event: LogEvent = {
        ts: Date.now(),
        worker: 'w-test',
        level: 'info',
        msg: 'Creating new file',
        tool: 'Write',
        path: '/src/new.ts',
      };

      generator.processEvent(event);

      const narrative = generator.generateNarrative('w-test');
      expect(narrative.segments.length).toBeGreaterThan(0);
      expect(narrative.segments[0].pattern).toBe('file_created');
    });

    it('should detect testing pattern', () => {
      const event: LogEvent = {
        ts: Date.now(),
        worker: 'w-test',
        level: 'info',
        msg: 'Running vitest',
      };

      generator.processEvent(event);

      const narrative = generator.generateNarrative('w-test');
      expect(narrative.segments.length).toBeGreaterThan(0);
      expect(narrative.segments[0].pattern).toBe('testing');
    });

    it('should detect debugging pattern', () => {
      const event: LogEvent = {
        ts: Date.now(),
        worker: 'w-test',
        level: 'error',
        msg: 'Error in code',
        error: 'TypeError',
      };

      generator.processEvent(event);

      const narrative = generator.generateNarrative('w-test');
      expect(narrative.segments.length).toBeGreaterThan(0);
      expect(narrative.segments[0].pattern).toBe('debugging');
    });

    it('should detect git_operations pattern', () => {
      const event: LogEvent = {
        ts: Date.now(),
        worker: 'w-test',
        level: 'info',
        msg: 'Committing changes',
        tool: 'git',
      };

      generator.processEvent(event);

      const narrative = generator.generateNarrative('w-test');
      expect(narrative.segments.length).toBeGreaterThan(0);
      expect(narrative.segments[0].pattern).toBe('git_operations');
    });

    it('should detect investigation pattern', () => {
      const event: LogEvent = {
        ts: Date.now(),
        worker: 'w-test',
        level: 'info',
        msg: 'Reading files',
        tool: 'Read',
        path: '/src/index.ts',
      };

      generator.processEvent(event);

      const narrative = generator.generateNarrative('w-test');
      expect(narrative.segments.length).toBeGreaterThan(0);
      expect(narrative.segments[0].pattern).toBe('investigation');
    });
  });

  describe('segment generation', () => {
    it('should group similar events into segments', () => {
      const baseTime = Date.now();
      const events: LogEvent[] = [
        {
          ts: baseTime,
          worker: 'w-test',
          level: 'info',
          msg: 'Editing',
          tool: 'Edit',
          path: '/src/file1.ts',
        },
        {
          ts: baseTime + 1000,
          worker: 'w-test',
          level: 'info',
          msg: 'Editing',
          tool: 'Edit',
          path: '/src/file2.ts',
        },
        {
          ts: baseTime + 2000,
          worker: 'w-test',
          level: 'info',
          msg: 'Editing',
          tool: 'Edit',
          path: '/src/file3.ts',
        },
      ];

      events.forEach(e => generator.processEvent(e));

      const narrative = generator.generateNarrative('w-test');
      expect(narrative.segments.length).toBe(1);
      expect(narrative.segments[0].events.length).toBe(3);
      expect(narrative.segments[0].pattern).toBe('file_editing');
    });

    it('should split segments on pattern change', () => {
      const baseTime = Date.now();
      const events: LogEvent[] = [
        {
          ts: baseTime,
          worker: 'w-test',
          level: 'info',
          msg: 'Editing',
          tool: 'Edit',
          path: '/src/file.ts',
        },
        {
          ts: baseTime + 1000,
          worker: 'w-test',
          level: 'info',
          msg: 'Running tests',
        },
        {
          ts: baseTime + 2000,
          worker: 'w-test',
          level: 'info',
          msg: 'Committing',
          tool: 'git',
        },
      ];

      events.forEach(e => generator.processEvent(e));

      const narrative = generator.generateNarrative('w-test');
      expect(narrative.segments.length).toBeGreaterThanOrEqual(2);
      expect(narrative.segments[0].pattern).toBe('file_editing');
      expect(narrative.segments[1].pattern).toBe('testing');
    });

    it('should split segments on time gaps', () => {
      const baseTime = Date.now();
      const events: LogEvent[] = [
        {
          ts: baseTime,
          worker: 'w-test',
          level: 'info',
          msg: 'Editing',
          tool: 'Edit',
          path: '/src/file.ts',
        },
        {
          ts: baseTime + 1000,
          worker: 'w-test',
          level: 'info',
          msg: 'Editing',
          tool: 'Edit',
          path: '/src/file.ts',
        },
        {
          ts: baseTime + 400000, // 6+ minute gap
          worker: 'w-test',
          level: 'info',
          msg: 'Editing',
          tool: 'Edit',
          path: '/src/file.ts',
        },
      ];

      events.forEach(e => generator.processEvent(e));

      const narrative = generator.generateNarrative('w-test', { segmentWindowMs: 300000 });
      expect(narrative.segments.length).toBeGreaterThanOrEqual(2);
    });

    it('should track entities in segments', () => {
      const baseTime = Date.now();
      const events: LogEvent[] = [
        {
          ts: baseTime,
          worker: 'w-test',
          level: 'info',
          msg: 'Editing',
          tool: 'Edit',
          path: '/src/file1.ts',
          bead: 'bd-123',
        },
        {
          ts: baseTime + 1000,
          worker: 'w-test',
          level: 'info',
          msg: 'Editing',
          tool: 'Edit',
          path: '/src/file2.ts',
          bead: 'bd-123',
        },
      ];

      events.forEach(e => generator.processEvent(e));

      const narrative = generator.generateNarrative('w-test');
      const segment = narrative.segments[0];

      expect(segment.entities.files).toContain('/src/file1.ts');
      expect(segment.entities.files).toContain('/src/file2.ts');
      expect(segment.entities.tools).toContain('Edit');
      expect(segment.entities.beads).toContain('bd-123');
    });
  });

  describe('narrative generation', () => {
    it('should generate summary', () => {
      const baseTime = Date.now();
      const events: LogEvent[] = [
        {
          ts: baseTime,
          worker: 'w-test',
          level: 'info',
          msg: 'Editing',
          tool: 'Edit',
          path: '/src/file.ts',
          bead: 'bd-123',
        },
        {
          ts: baseTime + 60000,
          worker: 'w-test',
          level: 'info',
          msg: 'Completed',
          bead: 'bd-123',
        },
      ];

      events.forEach(e => generator.processEvent(e));

      const narrative = generator.generateNarrative('w-test');
      expect(narrative.summary).toBeDefined();
      expect(narrative.summary.length).toBeGreaterThan(0);
      expect(narrative.summary).toContain('1m');
    });

    it('should generate full narrative', () => {
      const baseTime = Date.now();
      const events: LogEvent[] = [
        {
          ts: baseTime,
          worker: 'w-test',
          level: 'info',
          msg: 'Editing',
          tool: 'Edit',
          path: '/src/file.ts',
        },
        {
          ts: baseTime + 1000,
          worker: 'w-test',
          level: 'info',
          msg: 'Running tests',
        },
      ];

      events.forEach(e => generator.processEvent(e));

      const narrative = generator.generateNarrative('w-test');
      expect(narrative.fullNarrative).toBeDefined();
      expect(narrative.fullNarrative.length).toBeGreaterThan(0);
    });

    it('should generate timeline', () => {
      const baseTime = Date.now();
      const events: LogEvent[] = [
        {
          ts: baseTime,
          worker: 'w-test',
          level: 'info',
          msg: 'Started',
          bead: 'bd-123',
        },
        {
          ts: baseTime + 1000,
          worker: 'w-test',
          level: 'info',
          msg: 'Editing',
          tool: 'Edit',
          path: '/src/file.ts',
        },
        {
          ts: baseTime + 2000,
          worker: 'w-test',
          level: 'info',
          msg: 'Completed',
          bead: 'bd-123',
        },
      ];

      events.forEach(e => generator.processEvent(e));

      const narrative = generator.generateNarrative('w-test', { includeTimeline: true });
      expect(narrative.timeline).toBeDefined();
      expect(narrative.timeline.length).toBeGreaterThan(0);
    });

    it('should extract accomplishments', () => {
      const baseTime = Date.now();
      const events: LogEvent[] = [
        {
          ts: baseTime,
          worker: 'w-test',
          level: 'info',
          msg: 'Completed task',
          bead: 'bd-123',
        },
        {
          ts: baseTime + 1000,
          worker: 'w-test',
          level: 'info',
          msg: 'Creating file',
          tool: 'Write',
          path: '/src/new.ts',
        },
      ];

      events.forEach(e => generator.processEvent(e));

      const narrative = generator.generateNarrative('w-test');
      expect(narrative.accomplishments.length).toBeGreaterThan(0);
    });

    it('should extract challenges', () => {
      const baseTime = Date.now();
      const events: LogEvent[] = [
        {
          ts: baseTime,
          worker: 'w-test',
          level: 'error',
          msg: 'Error occurred',
          error: 'TypeError',
        },
        {
          ts: baseTime + 1000,
          worker: 'w-test',
          level: 'error',
          msg: 'Another error',
          error: 'ECONNREFUSED',
        },
      ];

      events.forEach(e => generator.processEvent(e));

      const narrative = generator.generateNarrative('w-test');
      expect(narrative.challenges.length).toBeGreaterThan(0);
    });

    it('should determine sentiment - productive', () => {
      const baseTime = Date.now();
      const events: LogEvent[] = [
        {
          ts: baseTime,
          worker: 'w-test',
          level: 'info',
          msg: 'Editing',
          tool: 'Edit',
          path: '/src/file.ts',
        },
        {
          ts: baseTime + 1000,
          worker: 'w-test',
          level: 'info',
          msg: 'Completed',
          bead: 'bd-123',
        },
      ];

      events.forEach(e => generator.processEvent(e));

      const narrative = generator.generateNarrative('w-test');
      expect(narrative.sentiment).toBe('productive');
    });

    it('should determine sentiment - struggling', () => {
      const baseTime = Date.now();
      const events: LogEvent[] = [
        {
          ts: baseTime,
          worker: 'w-test',
          level: 'error',
          msg: 'Error 1',
          error: 'Error',
        },
        {
          ts: baseTime + 1000,
          worker: 'w-test',
          level: 'error',
          msg: 'Error 2',
          error: 'Error',
        },
        {
          ts: baseTime + 2000,
          worker: 'w-test',
          level: 'error',
          msg: 'Error 3',
          error: 'Error',
        },
      ];

      events.forEach(e => generator.processEvent(e));

      const narrative = generator.generateNarrative('w-test');
      expect(narrative.sentiment).toBe('struggling');
    });

    it('should determine sentiment - idle', () => {
      const narrative = generator.generateNarrative('w-nonexistent');
      expect(narrative.sentiment).toBe('idle');
    });
  });

  describe('aggregated narratives', () => {
    it('should generate aggregated narrative for all workers', () => {
      const baseTime = Date.now();
      const events: LogEvent[] = [
        {
          ts: baseTime,
          worker: 'w-alpha',
          level: 'info',
          msg: 'Editing',
          tool: 'Edit',
          path: '/src/file1.ts',
        },
        {
          ts: baseTime + 1000,
          worker: 'w-beta',
          level: 'info',
          msg: 'Editing',
          tool: 'Edit',
          path: '/src/file2.ts',
        },
        {
          ts: baseTime + 2000,
          worker: 'w-alpha',
          level: 'info',
          msg: 'Completed',
          bead: 'bd-123',
        },
      ];

      events.forEach(e => generator.processEvent(e));

      const narrative = generator.generateAggregatedNarrative();
      expect(narrative.workerId).toBe('all');
      expect(narrative.stats.totalEvents).toBe(3);
      expect(narrative.title).toContain('2 workers');
    });

    it('should aggregate statistics correctly', () => {
      const baseTime = Date.now();
      const events: LogEvent[] = [
        {
          ts: baseTime,
          worker: 'w-alpha',
          level: 'info',
          msg: 'Working',
          bead: 'bd-123',
          path: '/src/file1.ts',
        },
        {
          ts: baseTime + 1000,
          worker: 'w-beta',
          level: 'info',
          msg: 'Working',
          bead: 'bd-456',
          path: '/src/file2.ts',
        },
      ];

      events.forEach(e => generator.processEvent(e));

      const narrative = generator.generateAggregatedNarrative();
      expect(narrative.stats.beadsWorked).toBe(2);
      expect(narrative.stats.filesModified).toBe(2);
    });
  });

  describe('narrative updates', () => {
    it('should emit updates when events are processed', async () => {
      const updates: NarrativeUpdate[] = [];

      const unsubscribe = generator.onUpdate((update) => {
        updates.push(update);
      });

      const baseTime = Date.now();
      generator.processEvent({
        ts: baseTime,
        worker: 'w-test',
        level: 'info',
        msg: 'Editing',
        tool: 'Edit',
        path: '/src/file.ts',
      });

      generator.processEvent({
        ts: baseTime + 1000,
        worker: 'w-test',
        level: 'info',
        msg: 'Editing more',
        tool: 'Edit',
        path: '/src/file.ts',
      });

      // Wait for updates to be emitted
      await new Promise<void>((resolve) => {
        const checkUpdates = () => {
          if (updates.length >= 2) {
            expect(updates[0].type).toBe('segment_updated');
            expect(updates[1].type).toBe('segment_updated');
            unsubscribe();
            resolve();
          } else {
            setTimeout(checkUpdates, 10);
          }
        };
        checkUpdates();
      });
    });

    it('should allow unsubscribing from updates', () => {
      let updateCount = 0;

      const unsubscribe = generator.onUpdate(() => {
        updateCount++;
      });

      generator.processEvent({
        ts: Date.now(),
        worker: 'w-test',
        level: 'info',
        msg: 'Event 1',
      });

      expect(updateCount).toBe(1);

      unsubscribe();

      generator.processEvent({
        ts: Date.now() + 1000,
        worker: 'w-test',
        level: 'info',
        msg: 'Event 2',
      });

      expect(updateCount).toBe(1); // Should not have increased
    });
  });

  describe('formatting', () => {
    it('should format narrative as markdown - brief style', () => {
      const baseTime = Date.now();
      generator.processEvent({
        ts: baseTime,
        worker: 'w-test',
        level: 'info',
        msg: 'Editing',
        tool: 'Edit',
        path: '/src/file.ts',
      });

      const narrative = generator.generateNarrative('w-test');
      const formatted = generator.formatNarrative(narrative, 'brief');

      expect(formatted).toContain('# ');
      expect(formatted).toContain('## Summary');
      expect(formatted).toContain('## Statistics');
    });

    it('should format narrative as markdown - detailed style', () => {
      const baseTime = Date.now();
      generator.processEvent({
        ts: baseTime,
        worker: 'w-test',
        level: 'info',
        msg: 'Editing',
        tool: 'Edit',
        path: '/src/file.ts',
      });

      const narrative = generator.generateNarrative('w-test');
      const formatted = generator.formatNarrative(narrative, 'detailed');

      expect(formatted).toContain('## Narrative');
    });

    it('should format narrative as markdown - timeline style', () => {
      const baseTime = Date.now();
      generator.processEvent({
        ts: baseTime,
        worker: 'w-test',
        level: 'info',
        msg: 'Editing',
        tool: 'Edit',
        path: '/src/file.ts',
      });

      const narrative = generator.generateNarrative('w-test', { includeTimeline: true });
      const formatted = generator.formatNarrative(narrative, 'timeline');

      expect(formatted).toContain('## Timeline');
    });

    it('should format narrative as markdown - technical style', () => {
      const baseTime = Date.now();
      generator.processEvent({
        ts: baseTime,
        worker: 'w-test',
        level: 'info',
        msg: 'Editing',
        tool: 'Edit',
        path: '/src/file.ts',
      });

      const narrative = generator.generateNarrative('w-test');
      const formatted = generator.formatNarrative(narrative, 'technical');

      expect(formatted).toContain('## Detailed Segments');
    });
  });

  describe('filtering', () => {
    it('should filter by time range', () => {
      const baseTime = Date.now();
      const events: LogEvent[] = [
        {
          ts: baseTime,
          worker: 'w-test',
          level: 'info',
          msg: 'Event 1',
        },
        {
          ts: baseTime + 60000,
          worker: 'w-test',
          level: 'info',
          msg: 'Event 2',
        },
        {
          ts: baseTime + 120000,
          worker: 'w-test',
          level: 'info',
          msg: 'Event 3',
        },
      ];

      events.forEach(e => generator.processEvent(e));

      const narrative = generator.generateNarrative('w-test', {
        startTime: baseTime + 30000,
        endTime: baseTime + 90000,
      });

      expect(narrative.stats.totalEvents).toBe(1);
    });

    it('should filter by bead', () => {
      const baseTime = Date.now();
      const events: LogEvent[] = [
        {
          ts: baseTime,
          worker: 'w-test',
          level: 'info',
          msg: 'Event 1',
          bead: 'bd-123',
        },
        {
          ts: baseTime + 1000,
          worker: 'w-test',
          level: 'info',
          msg: 'Event 2',
          bead: 'bd-456',
        },
        {
          ts: baseTime + 2000,
          worker: 'w-test',
          level: 'info',
          msg: 'Event 3',
          bead: 'bd-123',
        },
      ];

      events.forEach(e => generator.processEvent(e));

      const narrative = generator.generateNarrative('w-test', {
        beadId: 'bd-123',
      });

      expect(narrative.stats.totalEvents).toBe(2);
      expect(narrative.stats.beadsWorked).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all narratives and contexts', () => {
      generator.processEvent({
        ts: Date.now(),
        worker: 'w-test',
        level: 'info',
        msg: 'Event',
      });

      let narrative = generator.generateNarrative('w-test');
      expect(narrative.stats.totalEvents).toBe(1);

      generator.clear();

      narrative = generator.generateNarrative('w-test');
      expect(narrative.stats.totalEvents).toBe(0);
    });
  });
});
