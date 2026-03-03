/**
 * Tests for FABRIC Log Parser
 */

import { describe, it, expect } from 'vitest';
import { parseLogLine, parseLogLines, formatEvent } from './parser.js';
import { LogEvent, LogLevel } from './types.js';

describe('parseLogLine', () => {
  describe('valid inputs', () => {
    it('should parse a minimal valid log line', () => {
      const line = JSON.stringify({
        ts: 1709337600000,
        worker: 'w-abc123',
        level: 'info',
        msg: 'Test message',
      });

      const result = parseLogLine(line);

      expect(result).toEqual({
        ts: 1709337600000,
        worker: 'w-abc123',
        level: 'info',
        msg: 'Test message',
      });
    });

    it('should parse a log line with all optional fields', () => {
      const line = JSON.stringify({
        ts: 1709337600000,
        worker: 'w-abc123',
        level: 'debug',
        msg: 'Tool call',
        tool: 'Read',
        path: '/src/main.ts',
        bead: 'bd-xyz',
        duration_ms: 5000,
        error: 'some error',
      });

      const result = parseLogLine(line);

      expect(result).toEqual({
        ts: 1709337600000,
        worker: 'w-abc123',
        level: 'debug',
        msg: 'Tool call',
        tool: 'Read',
        path: '/src/main.ts',
        bead: 'bd-xyz',
        duration_ms: 5000,
        error: 'some error',
      });
    });

    it('should preserve additional non-standard fields', () => {
      const line = JSON.stringify({
        ts: 1709337600000,
        worker: 'w-abc123',
        level: 'info',
        msg: 'Test',
        customField: 'custom value',
        tokens: 150,
      });

      const result = parseLogLine(line);

      expect(result).toMatchObject({
        ts: 1709337600000,
        worker: 'w-abc123',
        level: 'info',
        msg: 'Test',
        customField: 'custom value',
        tokens: 150,
      });
    });

    it('should accept all valid log levels', () => {
      const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];

      for (const level of levels) {
        const line = JSON.stringify({
          ts: 1709337600000,
          worker: 'w-test',
          level,
          msg: 'Test',
        });

        const result = parseLogLine(line);
        expect(result?.level).toBe(level);
      }
    });
  });

  describe('invalid inputs', () => {
    it('should return null for empty string', () => {
      expect(parseLogLine('')).toBeNull();
    });

    it('should return null for whitespace-only string', () => {
      expect(parseLogLine('   \n\t  ')).toBeNull();
    });

    it('should return null for non-JSON string', () => {
      expect(parseLogLine('not valid json')).toBeNull();
    });

    it('should return null for malformed JSON', () => {
      expect(parseLogLine('{"ts": 123,')).toBeNull();
    });

    it('should return null when ts is missing', () => {
      const line = JSON.stringify({
        worker: 'w-test',
        level: 'info',
        msg: 'Test',
      });

      expect(parseLogLine(line)).toBeNull();
    });

    it('should return null when ts is not a number', () => {
      const line = JSON.stringify({
        ts: 'not-a-number',
        worker: 'w-test',
        level: 'info',
        msg: 'Test',
      });

      expect(parseLogLine(line)).toBeNull();
    });

    it('should return null when worker is missing', () => {
      const line = JSON.stringify({
        ts: 1709337600000,
        level: 'info',
        msg: 'Test',
      });

      expect(parseLogLine(line)).toBeNull();
    });

    it('should return null when worker is not a string', () => {
      const line = JSON.stringify({
        ts: 1709337600000,
        worker: 123,
        level: 'info',
        msg: 'Test',
      });

      expect(parseLogLine(line)).toBeNull();
    });

    it('should return null when level is missing', () => {
      const line = JSON.stringify({
        ts: 1709337600000,
        worker: 'w-test',
        msg: 'Test',
      });

      expect(parseLogLine(line)).toBeNull();
    });

    it('should return null when level is invalid', () => {
      const line = JSON.stringify({
        ts: 1709337600000,
        worker: 'w-test',
        level: 'invalid',
        msg: 'Test',
      });

      expect(parseLogLine(line)).toBeNull();
    });

    it('should return null when msg is missing', () => {
      const line = JSON.stringify({
        ts: 1709337600000,
        worker: 'w-test',
        level: 'info',
      });

      expect(parseLogLine(line)).toBeNull();
    });

    it('should return null when msg is not a string', () => {
      const line = JSON.stringify({
        ts: 1709337600000,
        worker: 'w-test',
        level: 'info',
        msg: { text: 'nested' },
      });

      expect(parseLogLine(line)).toBeNull();
    });
  });
});

describe('parseLogLines', () => {
  it('should parse multiple valid log lines', () => {
    const content = [
      JSON.stringify({ ts: 1, worker: 'w1', level: 'info', msg: 'first' }),
      JSON.stringify({ ts: 2, worker: 'w2', level: 'debug', msg: 'second' }),
      JSON.stringify({ ts: 3, worker: 'w3', level: 'warn', msg: 'third' }),
    ].join('\n');

    const results = parseLogLines(content);

    expect(results).toHaveLength(3);
    expect(results[0].msg).toBe('first');
    expect(results[1].msg).toBe('second');
    expect(results[2].msg).toBe('third');
  });

  it('should skip invalid lines', () => {
    const content = [
      JSON.stringify({ ts: 1, worker: 'w1', level: 'info', msg: 'valid' }),
      'invalid json',
      JSON.stringify({ ts: 2, worker: 'w2', level: 'info', msg: 'also valid' }),
    ].join('\n');

    const results = parseLogLines(content);

    expect(results).toHaveLength(2);
    expect(results[0].msg).toBe('valid');
    expect(results[1].msg).toBe('also valid');
  });

  it('should skip empty lines', () => {
    const content = [
      JSON.stringify({ ts: 1, worker: 'w1', level: 'info', msg: 'first' }),
      '',
      '   ',
      JSON.stringify({ ts: 2, worker: 'w2', level: 'info', msg: 'second' }),
    ].join('\n');

    const results = parseLogLines(content);

    expect(results).toHaveLength(2);
  });

  it('should return empty array for empty content', () => {
    expect(parseLogLines('')).toEqual([]);
    expect(parseLogLines('\n\n\n')).toEqual([]);
  });

  it('should handle content with trailing newline', () => {
    const content =
      JSON.stringify({ ts: 1, worker: 'w1', level: 'info', msg: 'test' }) + '\n';

    const results = parseLogLines(content);

    expect(results).toHaveLength(1);
  });
});

describe('formatEvent', () => {
  const baseEvent: LogEvent = {
    ts: 1709337600000, // 2024-03-02 00:00:00 UTC
    worker: 'w-test',
    level: 'info',
    msg: 'Test message',
  };

  it('should format a basic event', () => {
    const formatted = formatEvent(baseEvent);

    expect(formatted).toContain('w-test');
    expect(formatted).toContain('INFO');
    expect(formatted).toContain('Test message');
  });

  it('should include timestamp', () => {
    const formatted = formatEvent(baseEvent);

    // Timestamp should be in HH:MM:SS format
    expect(formatted).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('should hide worker when showWorker is false', () => {
    const formatted = formatEvent(baseEvent, { showWorker: false });

    // Worker ID should be padded to 12 chars in normal mode
    // In hidden mode, it shouldn't appear
    expect(formatted).not.toContain('w-test');
  });

  it('should hide level when showLevel is false', () => {
    const formatted = formatEvent(baseEvent, { showLevel: false });

    expect(formatted).not.toContain('INFO');
  });

  it('should include tool when present', () => {
    const event: LogEvent = { ...baseEvent, tool: 'Read' };
    const formatted = formatEvent(event);

    expect(formatted).toContain('[Read]');
  });

  it('should include path when present', () => {
    const event: LogEvent = { ...baseEvent, path: '/src/main.ts' };
    const formatted = formatEvent(event);

    expect(formatted).toContain('/src/main.ts');
  });

  it('should include bead when present', () => {
    const event: LogEvent = { ...baseEvent, bead: 'bd-xyz' };
    const formatted = formatEvent(event);

    expect(formatted).toContain('bead:bd-xyz');
  });

  it('should include duration when present', () => {
    const event: LogEvent = { ...baseEvent, duration_ms: 5000 };
    const formatted = formatEvent(event);

    expect(formatted).toContain('5.0s');
  });

  it('should include error when present', () => {
    const event: LogEvent = { ...baseEvent, error: 'Something went wrong' };
    const formatted = formatEvent(event);

    expect(formatted).toContain('ERROR: Something went wrong');
  });

  it('should format short durations in milliseconds', () => {
    const event: LogEvent = { ...baseEvent, duration_ms: 500 };
    const formatted = formatEvent(event);

    expect(formatted).toContain('500ms');
  });

  it('should format medium durations in seconds', () => {
    const event: LogEvent = { ...baseEvent, duration_ms: 5000 };
    const formatted = formatEvent(event);

    expect(formatted).toContain('5.0s');
  });

  it('should format long durations in minutes and seconds', () => {
    const event: LogEvent = { ...baseEvent, duration_ms: 125000 }; // 2m 5s
    const formatted = formatEvent(event);

    expect(formatted).toContain('2m 5s');
  });

  describe('colorization', () => {
    it('should not colorize by default', () => {
      const formatted = formatEvent(baseEvent);

      expect(formatted).not.toContain('\x1b[');
    });

    it('should colorize when colorize is true', () => {
      const formatted = formatEvent(baseEvent, { colorize: true });

      // ANSI color codes should be present
      expect(formatted).toContain('\x1b[');
    });

    it('should use correct colors for each level', () => {
      const levels: Array<{ level: LogLevel; color: string }> = [
        { level: 'debug', color: '\x1b[36m' }, // cyan
        { level: 'info', color: '\x1b[32m' },  // green
        { level: 'warn', color: '\x1b[33m' },  // yellow
        { level: 'error', color: '\x1b[31m' }, // red
      ];

      for (const { level, color } of levels) {
        const event: LogEvent = { ...baseEvent, level };
        const formatted = formatEvent(event, { colorize: true });

        expect(formatted).toContain(color);
      }
    });
  });
});
