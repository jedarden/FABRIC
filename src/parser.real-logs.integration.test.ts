/**
 * Real NEEDLE Log Integration Test (bd-129)
 *
 * Reads actual NEEDLE log files from ~/.needle/logs/ and verifies
 * the parser correctly extracts worker, bead, timestamp and event
 * information from production logs.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseLogLine, parseLogLines } from './parser.js';

const NEEDLE_LOGS_DIR = join(
  process.env.HOME || '/home/coding',
  '.needle',
  'logs',
);

/** Read first N lines from a file (avoids loading multi-MB files entirely). */
function headLines(filePath: string, maxLines: number): string {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').slice(0, maxLines);
  return lines.join('\n');
}

/** Read lines matching a grep pattern from a file. */
function grepLines(filePath: string, pattern: RegExp, maxLines = 50): string {
  const content = readFileSync(filePath, 'utf-8');
  const matching = content
    .split('\n')
    .filter((line) => pattern.test(line))
    .slice(0, maxLines);
  return matching.join('\n');
}

/** Pick a small-ish log file with a variety of events for targeted tests. */
function pickFixtureFile(dir: string): string {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith('needle-') && f.endsWith('.log'))
    .sort();
  // Prefer foxtrot — small file with worker lifecycle, claim, exhaust, idle, and bead work events
  const preferred = files.find((f) => f.includes('foxtrot'));
  return preferred ? join(dir, preferred) : join(dir, files[0]);
}

describe('Real NEEDLE Log Integration', () => {
  let logsDir: string;
  let fixturePath: string;

  beforeAll(() => {
    if (!existsSync(NEEDLE_LOGS_DIR)) {
      throw new Error(
        `NEEDLE logs directory not found: ${NEEDLE_LOGS_DIR}. ` +
          `This test requires production NEEDLE log files.`,
      );
    }
    logsDir = NEEDLE_LOGS_DIR;
    fixturePath = pickFixtureFile(logsDir);
  });

  // -----------------------------------------------------------------------
  // Directory-level sanity checks
  // -----------------------------------------------------------------------
  describe('log directory', () => {
    it('should contain needle-*.log files', () => {
      const files = readdirSync(logsDir).filter(
        (f) => f.startsWith('needle-') && f.endsWith('.log'),
      );
      expect(files.length).toBeGreaterThanOrEqual(10);
    });

    it('should have files that are valid JSONL', () => {
      const files = readdirSync(logsDir)
        .filter((f) => f.startsWith('needle-') && f.endsWith('.log'))
        .slice(0, 5);

      for (const file of files) {
        const content = headLines(join(logsDir, file), 5);
        const events = parseLogLines(content);
        expect(events.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Fixture file: targeted assertions on a single small log
  // -----------------------------------------------------------------------
  describe('fixture file parsing', () => {
    it('should parse every line in the fixture file', () => {
      const content = readFileSync(fixturePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      const events = parseLogLines(content);

      // Every non-empty line should produce an event (no silent drops)
      expect(events).toHaveLength(lines.length);
    });

    it('should extract worker identifier on every event', () => {
      const content = readFileSync(fixturePath, 'utf-8');
      const events = parseLogLines(content);

      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.worker).toBeTruthy();
        expect(typeof event.worker).toBe('string');
      }
    });

    it('should extract ISO timestamps and convert to Unix ms', () => {
      const content = headLines(fixturePath, 10);
      const events = parseLogLines(content);

      for (const event of events) {
        expect(event.ts).toBeGreaterThan(1700000000000); // after 2023
        expect(event.ts).toBeLessThan(2000000000000); // before 2033
        expect(Number.isFinite(event.ts)).toBe(true);
      }
    });

    it('should extract session identifier matching log filename', () => {
      const content = headLines(fixturePath, 20);
      const events = parseLogLines(content);
      const expectedSession = fixturePath
        .replace(/\.log$/, '')
        .split('/')
        .pop()!;

      for (const event of events) {
        expect(event.session).toBe(expectedSession);
      }
    });

    it('should produce monotonically increasing timestamps', () => {
      const content = readFileSync(fixturePath, 'utf-8');
      const events = parseLogLines(content);

      for (let i = 1; i < events.length; i++) {
        expect(events[i].ts).toBeGreaterThanOrEqual(events[i - 1].ts);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Worker lifecycle events from real logs
  // -----------------------------------------------------------------------
  describe('worker lifecycle events', () => {
    it('should parse worker.started with pid and workspace from real logs', () => {
      const content = grepLines(
        join(logsDir, 'needle-claude-anthropic-sonnet-alpha.log'),
        /"event":"worker.started"/,
        5,
      );
      const events = parseLogLines(content);

      const startedEvents = events.filter((e) => e.msg === 'worker.started');
      expect(startedEvents.length).toBeGreaterThanOrEqual(1);

      // First worker.started should have PID
      const first = startedEvents[0];
      expect(first.pid).toBeDefined();
      expect(typeof first.pid).toBe('number');
      expect(first.workspace).toBeDefined();
      expect(typeof first.workspace).toBe('string');
      expect(first.level).toBe('info');
    });

    it('should parse worker.idle with consecutive_empty from real logs', () => {
      const content = grepLines(
        fixturePath,
        /"event":"worker.idle"/,
        5,
      );
      const events = parseLogLines(content);

      expect(events.length).toBeGreaterThanOrEqual(1);
      const idle = events[0];
      expect(idle.msg).toBe('worker.idle');
      expect(idle.level).toBe('info');
      expect(typeof idle.consecutive_empty).toBe('number');
      expect(typeof idle.idle_seconds).toBe('number');
    });

    it('should parse worker.draining from real logs', () => {
      const content = grepLines(
        join(logsDir, 'needle-claude-anthropic-sonnet-alpha.log'),
        /"event":"worker.draining"/,
        3,
      );
      const events = parseLogLines(content);

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].msg).toBe('worker.draining');
      expect(events[0].level).toBe('info');
    });
  });

  // -----------------------------------------------------------------------
  // Bead lifecycle events from real logs
  // -----------------------------------------------------------------------
  describe('bead lifecycle events', () => {
    it('should parse bead.claimed with bead_id and workspace from real logs', () => {
      const content = grepLines(
        fixturePath,
        /"event":"bead.claimed"/,
        10,
      );
      const events = parseLogLines(content).filter(
        (e) => e.msg === 'bead.claimed',
      );

      expect(events.length).toBeGreaterThanOrEqual(1);
      const claimed = events[0];
      expect(claimed.bead).toBeTruthy();
      expect(typeof claimed.bead).toBe('string');
      expect(claimed.workspace).toBeTruthy();
      expect(typeof claimed.workspace).toBe('string');
      expect(claimed.level).toBe('info');
    });

    it('should parse bead.claim_retry with warn level from real logs', () => {
      const content = grepLines(
        fixturePath,
        /"event":"bead.claim_retry"/,
        5,
      );
      const events = parseLogLines(content);

      expect(events.length).toBeGreaterThanOrEqual(1);
      const retry = events[0];
      expect(retry.msg).toBe('bead.claim_retry');
      expect(retry.level).toBe('warn');
      expect(typeof retry.bead).toBe('string');
      expect(typeof retry.attempt).toBe('number');
    });

    it('should parse bead.claim_exhausted with error level from real logs', () => {
      const content = grepLines(
        fixturePath,
        /"event":"bead.claim_exhausted"/,
        5,
      );
      const events = parseLogLines(content);

      expect(events.length).toBeGreaterThanOrEqual(1);
      const exhausted = events[0];
      expect(exhausted.msg).toBe('bead.claim_exhausted');
      expect(exhausted.level).toBe('error');
    });

    it('should parse bead.completed with duration_ms from real logs', () => {
      const content = grepLines(
        join(logsDir, 'needle-claude-code-glm-4.7-bravo.log'),
        /"event":"bead.completed"/,
        5,
      );
      const events = parseLogLines(content);

      expect(events.length).toBeGreaterThanOrEqual(1);
      const completed = events[0];
      expect(completed.msg).toBe('bead.completed');
      expect(completed.level).toBe('info');
      expect(typeof completed.bead).toBe('string');
      expect(typeof completed.duration_ms).toBe('number');
      expect(completed.duration_ms).toBeGreaterThan(0);
      expect(typeof completed.output_file).toBe('string');
    });

    it('should parse bead.prompt_built with prompt_length from real logs', () => {
      const content = grepLines(
        fixturePath,
        /"event":"bead.prompt_built"/,
        5,
      );
      const events = parseLogLines(content);

      expect(events.length).toBeGreaterThanOrEqual(1);
      const prompt = events[0];
      expect(prompt.msg).toBe('bead.prompt_built');
      expect(typeof prompt.bead).toBe('string');
      expect(typeof prompt.prompt_length).toBe('number');
      expect(prompt.prompt_length).toBeGreaterThan(0);
    });

    it('should parse bead.agent_started from real logs', () => {
      const content = grepLines(
        fixturePath,
        /"event":"bead.agent_started"/,
        5,
      );
      const events = parseLogLines(content);

      expect(events.length).toBeGreaterThanOrEqual(1);
      const started = events[0];
      expect(started.msg).toBe('bead.agent_started');
      expect(typeof started.bead).toBe('string');
      expect(typeof started.agent).toBe('string');
    });

    it('should parse bead.mitosis.check from real logs', () => {
      const content = grepLines(
        fixturePath,
        /"event":"bead.mitosis.check"/,
        5,
      );
      const events = parseLogLines(content);

      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events[0].msg).toBe('bead.mitosis.check');
    });
  });

  // -----------------------------------------------------------------------
  // Error events from real logs
  // -----------------------------------------------------------------------
  describe('error events', () => {
    it('should parse error.release_failed with error level from real logs', () => {
      const content = grepLines(
        join(logsDir, 'needle-claude-anthropic-sonnet-alpha.log'),
        /"event":"error.release_failed"/,
        5,
      );
      const events = parseLogLines(content);

      if (events.length > 0) {
        expect(events[0].level).toBe('error');
        expect(events[0].msg).toBe('error.release_failed');
      }
      // If no events found, test passes — file may not have this event type
    });

    it('should parse error.agent_crash with error level from real logs', () => {
      const content = grepLines(
        join(logsDir, 'needle-claude-anthropic-sonnet-alpha.log'),
        /"event":"error.agent_crash"/,
        5,
      );
      const events = parseLogLines(content);

      if (events.length > 0) {
        expect(events[0].level).toBe('error');
        expect(events[0].msg).toBe('error.agent_crash');
      }
    });

    it('should parse bead.failed with error level from real logs', () => {
      const content = grepLines(
        join(logsDir, 'needle-claude-anthropic-sonnet-alpha.log'),
        /"event":"bead.failed"/,
        5,
      );
      const events = parseLogLines(content);

      if (events.length > 0) {
        expect(events[0].level).toBe('error');
        expect(events[0].msg).toBe('bead.failed');
      }
    });
  });

  // -----------------------------------------------------------------------
  // Cross-file consistency: parse multiple real log files
  // -----------------------------------------------------------------------
  describe('cross-file consistency', () => {
    it('should successfully parse a sample of 10 different log files', () => {
      const files = readdirSync(logsDir)
        .filter((f) => f.startsWith('needle-') && f.endsWith('.log'))
        .slice(0, 10);

      for (const file of files) {
        const content = headLines(join(logsDir, file), 100);
        const events = parseLogLines(content);
        expect(events.length).toBeGreaterThan(0);
      }
    });

    it('should extract consistent worker names within each session', () => {
      const files = readdirSync(logsDir)
        .filter((f) => f.startsWith('needle-') && f.endsWith('.log'))
        .slice(0, 5);

      for (const file of files) {
        const content = headLines(join(logsDir, file), 200);
        const events = parseLogLines(content);
        if (events.length === 0) continue;

        const workers = new Set(events.map((e) => e.worker));
        // All events in a single session file should have the same worker
        expect(workers.size).toBe(1);
      }
    });

    it('should extract valid event types across all log files', () => {
      const files = readdirSync(logsDir)
        .filter((f) => f.startsWith('needle-') && f.endsWith('.log'))
        .slice(0, 10);

      const knownPrefixes = [
        'worker.',
        'bead.',
        'effort.',
        'error.',
        'explore.',
        'engine.',
        'pulse.',
        'config.',
        'hook.',
        'intent.',
        'file.',
        'test.',
      ];

      for (const file of files) {
        const content = headLines(join(logsDir, file), 100);
        const events = parseLogLines(content);

        for (const event of events) {
          const hasKnownPrefix = knownPrefixes.some((p) =>
            event.msg.startsWith(p),
          );
          expect(hasKnownPrefix).toBe(true);
        }
      }
    });

    it('should preserve all data payload fields on parsed events', () => {
      const content = grepLines(
        join(logsDir, 'needle-claude-code-glm-4.7-bravo.log'),
        /"event":"bead.completed"/,
        1,
      );
      const events = parseLogLines(content);

      expect(events.length).toBe(1);
      const completed = events[0];
      // These fields come from data payload and should be spread onto the event
      expect(completed.bead).toBeDefined();
      expect(completed.duration_ms).toBeDefined();
      expect(completed.output_file).toBeDefined();
    });
  });
});
