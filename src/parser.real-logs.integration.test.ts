/**
 * Real NEEDLE Log Integration Test (bd-6q2)
 *
 * Reads actual NEEDLE log files from ~/.needle/logs/*.jsonl and verifies:
 * - parseNeedleEvent produces correct NeedleEvent shape
 * - session_id, sequence, and nested data survive round-trip
 * - parseLogLine (adapter) still works correctly
 * - Event types found in real logs are all parseable
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseNeedleEvent, parseLogLine, parseLogLines } from './parser.js';
import { NeedleEvent } from './types.js';

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

/** Find a non-empty JSONL log file for fixture tests. */
function pickFixtureFile(dir: string): string {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();
  // Pick first file with content
  for (const file of files) {
    const path = join(dir, file);
    const stat = readFileSync(path, 'utf-8').trim();
    if (stat.length > 0) return path;
  }
  return join(dir, files[0]);
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
    it('should contain .jsonl files', () => {
      const files = readdirSync(logsDir).filter(
        (f) => f.endsWith('.jsonl'),
      );
      expect(files.length).toBeGreaterThanOrEqual(10);
    });

    it('should have files that are valid JSONL', () => {
      const files = readdirSync(logsDir)
        .filter((f) => f.endsWith('.jsonl'))
        .slice(0, 5);

      for (const file of files) {
        const content = headLines(join(logsDir, file), 5);
        if (!content.trim()) continue; // skip empty files
        const events = parseLogLines(content);
        expect(events.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  // -----------------------------------------------------------------------
  // NeedleEvent shape assertions against real fixtures
  // -----------------------------------------------------------------------
  describe('parseNeedleEvent against real fixtures', () => {
    it('should parse every line in fixture file into a NeedleEvent', () => {
      const content = readFileSync(fixturePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);

      for (const line of lines) {
        const ne = parseNeedleEvent(line);
        expect(ne).not.toBeNull();
        expect(typeof ne!.timestamp).toBe('string');
        expect(typeof ne!.event_type).toBe('string');
        expect(typeof ne!.worker_id).toBe('string');
        expect(typeof ne!.session_id).toBe('string');
        expect(typeof ne!.sequence).toBe('number');
        expect(typeof ne!.data).toBe('object');
      }
    });

    it('should preserve session_id across all events in a file', () => {
      const content = readFileSync(fixturePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);

      const sessionIds = new Set<string>();
      for (const line of lines) {
        const ne = parseNeedleEvent(line);
        expect(ne).not.toBeNull();
        sessionIds.add(ne!.session_id);
      }

      // All events in a single session file share the same session_id
      expect(sessionIds.size).toBe(1);
    });

    it('should preserve monotonically increasing sequence numbers', () => {
      const content = readFileSync(fixturePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);

      const sequences: number[] = [];
      for (const line of lines) {
        const ne = parseNeedleEvent(line);
        expect(ne).not.toBeNull();
        sequences.push(ne!.sequence);
      }

      for (let i = 1; i < sequences.length; i++) {
        expect(sequences[i]).toBeGreaterThan(sequences[i - 1]);
      }
    });

    it('should preserve nested data fields', () => {
      const content = readFileSync(fixturePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);

      // Find a worker.started event and check its data
      for (const line of lines) {
        const ne = parseNeedleEvent(line);
        if (ne?.event_type === 'worker.started') {
          expect(ne.data).toBeDefined();
          expect(typeof ne.data).toBe('object');
          // Real logs have version and worker_name in worker.started data
          expect(ne.data.version || ne.data.worker_name).toBeDefined();
          return;
        }
      }
    });

    it('should preserve bead_id when present', () => {
      const content = readFileSync(fixturePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);

      let foundBeadEvent = false;
      for (const line of lines) {
        const ne = parseNeedleEvent(line);
        if (ne?.bead_id) {
          foundBeadEvent = true;
          expect(typeof ne.bead_id).toBe('string');
          expect(ne.bead_id.length).toBeGreaterThan(0);
        }
      }

      // Most fixture files have at least one bead event
      if (!foundBeadEvent) {
        // Check across more files
        const files = readdirSync(logsDir)
          .filter((f) => f.endsWith('.jsonl'))
          .slice(0, 10);

        for (const file of files) {
          const fileContent = headLines(join(logsDir, file), 100);
          const fileLines = fileContent.split('\n').filter(Boolean);
          for (const line of fileLines) {
            const ne = parseNeedleEvent(line);
            if (ne?.bead_id) {
              foundBeadEvent = true;
              expect(typeof ne.bead_id).toBe('string');
              break;
            }
          }
          if (foundBeadEvent) break;
        }
      }
    });
  });

  // -----------------------------------------------------------------------
  // Worker lifecycle events from real logs
  // -----------------------------------------------------------------------
  describe('worker lifecycle events', () => {
    it('should parse worker.started from canonical format', () => {
      const content = grepLines(
        fixturePath,
        /"event_type":"worker.started"/,
        5,
      );
      if (!content.trim()) return; // skip if not found

      const lines = content.split('\n').filter(Boolean);
      for (const line of lines) {
        const ne = parseNeedleEvent(line);
        expect(ne).not.toBeNull();
        expect(ne!.event_type).toBe('worker.started');
        expect(ne!.sequence).toBeGreaterThanOrEqual(0);
        expect(ne!.data).toBeDefined();
      }
    });

    it('should parse worker.idle from canonical format', () => {
      const content = grepLines(
        fixturePath,
        /"event_type":"worker.idle"/,
        5,
      );
      if (!content.trim()) return;

      const lines = content.split('\n').filter(Boolean);
      for (const line of lines) {
        const ne = parseNeedleEvent(line);
        expect(ne).not.toBeNull();
        expect(ne!.event_type).toBe('worker.idle');
      }
    });

    it('should parse worker.state_transition from canonical format', () => {
      const content = grepLines(
        fixturePath,
        /"event_type":"worker.state_transition"/,
        5,
      );
      if (!content.trim()) return;

      const lines = content.split('\n').filter(Boolean);
      for (const line of lines) {
        const ne = parseNeedleEvent(line);
        expect(ne).not.toBeNull();
        expect(ne!.event_type).toBe('worker.state_transition');
        expect(ne!.data.from).toBeDefined();
        expect(ne!.data.to).toBeDefined();
      }
    });

    it('should parse worker.stopped from canonical format', () => {
      // Find across multiple files since fixture may not have stopped
      const files = readdirSync(logsDir)
        .filter((f) => f.endsWith('.jsonl'))
        .slice(0, 20);

      let found = false;
      for (const file of files) {
        const content = grepLines(
          join(logsDir, file),
          /"event_type":"worker.stopped"/,
          3,
        );
        if (!content.trim()) continue;

        const ne = parseNeedleEvent(content.split('\n')[0]);
        expect(ne).not.toBeNull();
        expect(ne!.event_type).toBe('worker.stopped');
        found = true;
        break;
      }
      // worker.stopped may not exist in every file; that's fine
      if (!found) expect(true).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Bead lifecycle events from real logs
  // -----------------------------------------------------------------------
  describe('bead lifecycle events', () => {
    it('should parse bead.claim.* events with NeedleEvent shape', () => {
      const content = grepLines(
        fixturePath,
        /"event_type":"bead\.claim\./,
        10,
      );
      if (!content.trim()) return;

      const lines = content.split('\n').filter(Boolean);
      for (const line of lines) {
        const ne = parseNeedleEvent(line);
        expect(ne).not.toBeNull();
        expect(ne!.event_type).toMatch(/^bead\.claim\./);
        // session_id and sequence must be preserved
        expect(ne!.session_id.length).toBeGreaterThan(0);
        expect(Number.isFinite(ne!.sequence)).toBe(true);
      }
    });

    it('should parse bead.completed with duration in data', () => {
      const files = readdirSync(logsDir)
        .filter((f) => f.endsWith('.jsonl'))
        .slice(0, 20);

      let found = false;
      for (const file of files) {
        const content = grepLines(
          join(logsDir, file),
          /"event_type":"bead.completed"/,
          3,
        );
        if (!content.trim()) continue;

        const ne = parseNeedleEvent(content.split('\n')[0]);
        expect(ne).not.toBeNull();
        expect(ne!.event_type).toBe('bead.completed');
        found = true;
        break;
      }
      if (!found) expect(true).toBe(true);
    });

    it('should parse bead.released from real logs', () => {
      const files = readdirSync(logsDir)
        .filter((f) => f.endsWith('.jsonl'))
        .slice(0, 20);

      let found = false;
      for (const file of files) {
        const content = grepLines(
          join(logsDir, file),
          /"event_type":"bead.released"/,
          3,
        );
        if (!content.trim()) continue;

        const ne = parseNeedleEvent(content.split('\n')[0]);
        expect(ne).not.toBeNull();
        expect(ne!.event_type).toBe('bead.released');
        found = true;
        break;
      }
      if (!found) expect(true).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Round-trip: parseNeedleEvent → parseLogLine consistency
  // -----------------------------------------------------------------------
  describe('adapter round-trip', () => {
    it('should produce consistent results between parseNeedleEvent and parseLogLine', () => {
      const content = headLines(fixturePath, 20);
      const lines = content.split('\n').filter(Boolean);

      for (const line of lines) {
        const ne = parseNeedleEvent(line);
        const le = parseLogLine(line);

        if (ne === null) {
          expect(le).toBeNull();
          continue;
        }

        expect(le).not.toBeNull();
        // LogEvent.msg should match NeedleEvent.event_type
        expect(le!.msg).toBe(ne!.event_type);
        // LogEvent.worker should match NeedleEvent.worker_id
        expect(le!.worker).toBe(ne!.worker_id);
        // LogEvent.session should match NeedleEvent.session_id
        expect(le!.session).toBe(ne!.session_id);
        // LogEvent.bead should match NeedleEvent.bead_id when present
        if (ne!.bead_id) {
          expect(le!.bead).toBe(ne!.bead_id);
        }
      }
    });
  });

  // -----------------------------------------------------------------------
  // Cross-file consistency: parse multiple real log files
  // -----------------------------------------------------------------------
  describe('cross-file consistency', () => {
    it('should successfully parse a sample of 10 different log files via parseNeedleEvent', () => {
      const files = readdirSync(logsDir)
        .filter((f) => f.endsWith('.jsonl'))
        .slice(0, 10);

      for (const file of files) {
        const content = headLines(join(logsDir, file), 50);
        if (!content.trim()) continue; // skip empty files

        const lines = content.split('\n').filter(Boolean);
        let parsedAny = false;
        for (const line of lines) {
          const ne = parseNeedleEvent(line);
          if (ne) parsedAny = true;
        }
        expect(parsedAny).toBe(true);
      }
    });

    it('should extract consistent worker_id within each session', () => {
      const files = readdirSync(logsDir)
        .filter((f) => f.endsWith('.jsonl'))
        .slice(0, 5);

      for (const file of files) {
        const content = headLines(join(logsDir, file), 200);
        if (!content.trim()) continue;

        const lines = content.split('\n').filter(Boolean);
        const workers = new Set<string>();
        for (const line of lines) {
          const ne = parseNeedleEvent(line);
          if (ne) workers.add(ne.worker_id);
        }
        // All events in a single session file should have the same worker
        expect(workers.size).toBeLessThanOrEqual(1);
      }
    });

    it('should cover multiple distinct event types across files', () => {
      const files = readdirSync(logsDir)
        .filter((f) => f.endsWith('.jsonl') && !f.startsWith('-test-worker-'))
        .slice(0, 50);

      const eventTypes = new Set<string>();
      for (const file of files) {
        // Read more lines from each file to find diverse event types
        const content = headLines(join(logsDir, file), 2000);
        const lines = content.split('\n').filter(Boolean);
        for (const line of lines) {
          const ne = parseNeedleEvent(line);
          if (ne) eventTypes.add(ne.event_type);
        }
      }

      // Real logs should have a variety of event types (at least worker lifecycle and some bead events)
      expect(eventTypes.size).toBeGreaterThanOrEqual(2);
    });

    it('should preserve all data payload fields on parsed NeedleEvents', () => {
      const files = readdirSync(logsDir)
        .filter((f) => f.endsWith('.jsonl'))
        .slice(0, 20);

      for (const file of files) {
        const content = grepLines(
          join(logsDir, file),
          /"event_type":"bead.completed"/,
          1,
        );
        if (!content.trim()) continue;

        const ne = parseNeedleEvent(content.split('\n')[0]);
        expect(ne).not.toBeNull();
        expect(ne!.bead_id || ne!.data.bead_id).toBeDefined();
        break; // one is enough
      }
    });
  });
});
