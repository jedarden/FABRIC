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

describe('parseLogLine - edge cases with optional fields', () => {
  it('should reject log when tool is not a string', () => {
    const line = JSON.stringify({
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: 'Test',
      tool: 123, // Should be string
    });

    // Parser should accept this since tool is optional and validated
    const result = parseLogLine(line);

    // Optional fields with wrong types should be ignored
    expect(result).not.toBeNull();
    expect(result?.tool).toBeUndefined();
  });

  it('should reject log when path is not a string', () => {
    const line = JSON.stringify({
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: 'Test',
      path: { file: 'test.ts' }, // Should be string
    });

    const result = parseLogLine(line);

    expect(result).not.toBeNull();
    expect(result?.path).toBeUndefined();
  });

  it('should reject log when bead is not a string', () => {
    const line = JSON.stringify({
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: 'Test',
      bead: ['bd-123'], // Should be string
    });

    const result = parseLogLine(line);

    expect(result).not.toBeNull();
    expect(result?.bead).toBeUndefined();
  });

  it('should reject log when duration_ms is not a number', () => {
    const line = JSON.stringify({
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: 'Test',
      duration_ms: '5000', // Should be number
    });

    const result = parseLogLine(line);

    expect(result).not.toBeNull();
    expect(result?.duration_ms).toBeUndefined();
  });

  it('should reject log when error is not a string', () => {
    const line = JSON.stringify({
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: 'Test',
      error: { message: 'error' }, // Should be string
    });

    const result = parseLogLine(line);

    expect(result).not.toBeNull();
    expect(result?.error).toBeUndefined();
  });

  it('should accept zero duration_ms', () => {
    const line = JSON.stringify({
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: 'Test',
      duration_ms: 0,
    });

    const result = parseLogLine(line);

    expect(result?.duration_ms).toBe(0);
  });

  it('should accept negative duration_ms', () => {
    const line = JSON.stringify({
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: 'Test',
      duration_ms: -100,
    });

    const result = parseLogLine(line);

    expect(result?.duration_ms).toBe(-100);
  });

  it('should accept empty strings for optional fields', () => {
    const line = JSON.stringify({
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: 'Test',
      tool: '',
      path: '',
      bead: '',
      error: '',
    });

    const result = parseLogLine(line);

    expect(result).not.toBeNull();
    expect(result?.tool).toBe('');
    expect(result?.path).toBe('');
    expect(result?.bead).toBe('');
    expect(result?.error).toBe('');
  });

  it('should handle unicode and special characters in message', () => {
    const line = JSON.stringify({
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: '🚀 Testing with émojis and spëcial çharacters: 你好世界',
    });

    const result = parseLogLine(line);

    expect(result?.msg).toBe('🚀 Testing with émojis and spëcial çharacters: 你好世界');
  });

  it('should handle very long message strings', () => {
    const longMsg = 'A'.repeat(10000);
    const line = JSON.stringify({
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: longMsg,
    });

    const result = parseLogLine(line);

    expect(result?.msg).toBe(longMsg);
    expect(result?.msg.length).toBe(10000);
  });

  it('should handle very large timestamps', () => {
    const line = JSON.stringify({
      ts: 9999999999999, // Year 2286
      worker: 'w-test',
      level: 'info',
      msg: 'Test',
    });

    const result = parseLogLine(line);

    expect(result?.ts).toBe(9999999999999);
  });

  it('should handle negative timestamps', () => {
    const line = JSON.stringify({
      ts: -1000, // Before Unix epoch
      worker: 'w-test',
      level: 'info',
      msg: 'Test',
    });

    const result = parseLogLine(line);

    expect(result?.ts).toBe(-1000);
  });

  it('should preserve custom fields with various types', () => {
    const line = JSON.stringify({
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: 'Test',
      stringField: 'value',
      numberField: 42,
      booleanField: true,
      nullField: null,
      arrayField: [1, 2, 3],
      objectField: { nested: 'value' },
    });

    const result = parseLogLine(line);

    expect(result).toMatchObject({
      stringField: 'value',
      numberField: 42,
      booleanField: true,
      nullField: null,
      arrayField: [1, 2, 3],
      objectField: { nested: 'value' },
    });
  });

  it('should handle deeply nested custom objects', () => {
    const line = JSON.stringify({
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: 'Test',
      metadata: {
        level1: {
          level2: {
            level3: {
              value: 'deep',
            },
          },
        },
      },
    });

    const result = parseLogLine(line);

    expect(result?.metadata).toEqual({
      level1: {
        level2: {
          level3: {
            value: 'deep',
          },
        },
      },
    });
  });
});

describe('parseLogLines - performance and batch processing', () => {
  it('should handle large batches efficiently (1000 lines)', () => {
    const lines = Array.from({ length: 1000 }, (_, i) =>
      JSON.stringify({
        ts: 1709337600000 + i,
        worker: `w-${i % 10}`,
        level: ['debug', 'info', 'warn', 'error'][i % 4] as LogLevel,
        msg: `Message ${i}`,
      })
    ).join('\n');

    const start = Date.now();
    const results = parseLogLines(lines);
    const duration = Date.now() - start;

    expect(results).toHaveLength(1000);
    expect(duration).toBeLessThan(1000); // Should parse 1000 lines in under 1s

    // Verify first and last entries
    expect(results[0].msg).toBe('Message 0');
    expect(results[999].msg).toBe('Message 999');
  });

  it('should handle large batches with some invalid lines (10000 lines)', () => {
    const lines = Array.from({ length: 10000 }, (_, i) => {
      // Every 10th line is invalid
      if (i % 10 === 0) {
        return 'invalid json line';
      }
      return JSON.stringify({
        ts: 1709337600000 + i,
        worker: `w-${i % 10}`,
        level: ['debug', 'info', 'warn', 'error'][i % 4] as LogLevel,
        msg: `Message ${i}`,
      });
    }).join('\n');

    const start = Date.now();
    const results = parseLogLines(lines);
    const duration = Date.now() - start;

    // Should have 9000 valid lines (10000 - 1000 invalid)
    expect(results).toHaveLength(9000);
    expect(duration).toBeLessThan(5000); // Should parse 10000 lines in under 5s
  });

  it('should handle batches with mixed valid and malformed JSON', () => {
    const lines = [
      JSON.stringify({ ts: 1, worker: 'w1', level: 'info', msg: 'Valid 1' }),
      '{"ts": 2, "worker": "w2", "level": "info", "msg": "Valid 2"',  // Unclosed
      JSON.stringify({ ts: 3, worker: 'w3', level: 'info', msg: 'Valid 3' }),
      '{"ts": 4}',  // Missing required fields
      JSON.stringify({ ts: 5, worker: 'w5', level: 'info', msg: 'Valid 5' }),
      'plain text not json',
      JSON.stringify({ ts: 6, worker: 'w6', level: 'info', msg: 'Valid 6' }),
    ].join('\n');

    const results = parseLogLines(lines);

    expect(results).toHaveLength(4); // Only 4 valid lines
    expect(results.map(r => r.msg)).toEqual([
      'Valid 1',
      'Valid 3',
      'Valid 5',
      'Valid 6',
    ]);
  });

  it('should maintain correct order with large batches', () => {
    const lines = Array.from({ length: 5000 }, (_, i) =>
      JSON.stringify({
        ts: 1709337600000 + i,
        worker: 'w-test',
        level: 'info',
        msg: `Message ${i}`,
      })
    ).join('\n');

    const results = parseLogLines(lines);

    // Verify order is maintained
    for (let i = 0; i < results.length; i++) {
      expect(results[i].msg).toBe(`Message ${i}`);
      expect(results[i].ts).toBe(1709337600000 + i);
    }
  });

  it('should handle batches with very long lines', () => {
    const longMsg = 'A'.repeat(100000); // 100KB message
    const lines = Array.from({ length: 100 }, (_, i) =>
      JSON.stringify({
        ts: 1709337600000 + i,
        worker: `w-${i}`,
        level: 'info',
        msg: `${i}: ${longMsg}`,
      })
    ).join('\n');

    const start = Date.now();
    const results = parseLogLines(lines);
    const duration = Date.now() - start;

    expect(results).toHaveLength(100);
    expect(duration).toBeLessThan(5000); // Should handle large lines reasonably
    expect(results[0].msg).toContain('0:');
    expect(results[0].msg.length).toBeGreaterThan(100000);
  });

  it('should handle empty lines interspersed with valid lines', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => {
      // Every 3rd line is empty or whitespace
      if (i % 3 === 0) {
        return i % 6 === 0 ? '' : '   ';
      }
      return JSON.stringify({
        ts: 1709337600000 + i,
        worker: 'w-test',
        level: 'info',
        msg: `Message ${i}`,
      });
    }).join('\n');

    const results = parseLogLines(lines);

    // Should have ~667 valid lines (1000 - ~333 empty)
    expect(results.length).toBeGreaterThan(600);
    expect(results.length).toBeLessThan(700);
  });
});

describe('formatEvent - additional edge cases', () => {
  const baseEvent: LogEvent = {
    ts: 1709337600000,
    worker: 'w-test',
    level: 'info',
    msg: 'Test message',
  };

  it('should format zero duration', () => {
    const event: LogEvent = { ...baseEvent, duration_ms: 0 };
    const formatted = formatEvent(event);

    expect(formatted).toContain('0ms');
  });

  it('should format very small duration', () => {
    const event: LogEvent = { ...baseEvent, duration_ms: 1 };
    const formatted = formatEvent(event);

    expect(formatted).toContain('1ms');
  });

  it('should format duration at threshold (999ms)', () => {
    const event: LogEvent = { ...baseEvent, duration_ms: 999 };
    const formatted = formatEvent(event);

    expect(formatted).toContain('999ms');
  });

  it('should format duration at threshold (1000ms)', () => {
    const event: LogEvent = { ...baseEvent, duration_ms: 1000 };
    const formatted = formatEvent(event);

    expect(formatted).toContain('1.0s');
  });

  it('should format very long duration (hours)', () => {
    const event: LogEvent = { ...baseEvent, duration_ms: 7200000 }; // 2 hours
    const formatted = formatEvent(event);

    // Should be formatted as minutes
    expect(formatted).toContain('120m 0s');
  });

  it('should not include empty optional string fields', () => {
    const event: LogEvent = {
      ...baseEvent,
      tool: '',
      path: '',
      bead: '',
      error: '',
    };
    const formatted = formatEvent(event);

    // Empty strings are falsy, so they should not appear in output
    expect(formatted).not.toContain('[]');
    expect(formatted).not.toContain('bead:');
    expect(formatted).not.toContain('ERROR:');
    expect(formatted).toContain('Test message'); // Main message still present
  });

  it('should format event with all optional fields', () => {
    const event: LogEvent = {
      ...baseEvent,
      tool: 'Read',
      path: '/src/test.ts',
      bead: 'bd-xyz',
      duration_ms: 1500,
      error: 'File not found',
    };
    const formatted = formatEvent(event);

    expect(formatted).toContain('[Read]');
    expect(formatted).toContain('/src/test.ts');
    expect(formatted).toContain('bead:bd-xyz');
    expect(formatted).toContain('1.5s');
    expect(formatted).toContain('ERROR: File not found');
  });

  it('should handle unicode in worker ID', () => {
    const event: LogEvent = { ...baseEvent, worker: 'w-🚀-test' };
    const formatted = formatEvent(event);

    expect(formatted).toContain('w-🚀-test');
  });

  it('should handle very long worker ID', () => {
    const event: LogEvent = { ...baseEvent, worker: 'w-very-long-worker-id-12345' };
    const formatted = formatEvent(event);

    expect(formatted).toContain('w-very-long-worker-id-12345');
  });

  it('should handle newlines in message', () => {
    const event: LogEvent = { ...baseEvent, msg: 'Line 1\nLine 2\nLine 3' };
    const formatted = formatEvent(event);

    expect(formatted).toContain('Line 1\nLine 2\nLine 3');
  });

  it('should format with both showWorker and showLevel false', () => {
    const formatted = formatEvent(baseEvent, { showWorker: false, showLevel: false });

    expect(formatted).not.toContain('w-test');
    expect(formatted).not.toContain('INFO');
    expect(formatted).toContain('Test message');
    expect(formatted).toMatch(/\d{2}:\d{2}:\d{2}/); // Timestamp still present
  });
});
