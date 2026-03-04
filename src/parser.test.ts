/**
 * Tests for FABRIC Log Parser
 */

import { describe, it, expect } from 'vitest';
import {
  parseLogLine,
  parseLogLines,
  formatEvent,
  isConversationEvent,
  parseConversationEvent,
  parseConversationEvents,
  parseConversationLine,
  parseConversationContent,
  formatConversationEvent,
} from './parser.js';
import { LogEvent, LogLevel, ConversationEvent } from './types.js';

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

  describe('NEEDLE format', () => {
    it('should parse NEEDLE format with ISO timestamp', () => {
      const line = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'worker.started',
        session: 'forge-glm-test',
        worker: {
          runner: 'claude',
          provider: 'code',
          model: 'glm-4.7',
          identifier: 'test',
        },
        data: {
          pid: 2789549,
          workspace: '/home/coder/forge',
          agent: 'claude-code-glm-4.7',
        },
      });

      const result = parseLogLine(line);

      expect(result).not.toBeNull();
      expect(result?.ts).toBe(1772641054008); // Unix ms from '2026-03-04T16:17:34.008Z'
      expect(result?.worker).toBe('claude-test');
      expect(result?.msg).toBe('worker.started');
      expect(result?.level).toBe('info');
      expect(result?.session).toBe('forge-glm-test');
      expect(result?.provider).toBe('code');
      expect(result?.model).toBe('glm-4.7');
    });

    it('should extract bead_id from data payload', () => {
      const line = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'bead.claimed',
        session: 'test-session',
        worker: {
          runner: 'claude',
          provider: 'code',
          model: 'sonnet',
          identifier: 'worker1',
        },
        data: {
          bead_id: 'bd-2ok0',
          title: 'Test task',
          workspace: '/home/coder/forge',
        },
      });

      const result = parseLogLine(line);

      expect(result).not.toBeNull();
      expect(result?.bead).toBe('bd-2ok0');
    });

    it('should extract duration_ms from data payload', () => {
      const line = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'bead.completed',
        session: 'test-session',
        worker: {
          runner: 'claude',
          provider: 'anthropic',
          model: 'sonnet',
          identifier: 'test',
        },
        data: {
          bead_id: 'bd-xyz',
          duration_ms: 10076,
          output_file: '/tmp/output.log',
        },
      });

      const result = parseLogLine(line);

      expect(result).not.toBeNull();
      expect(result?.duration_ms).toBe(10076);
      expect(result?.bead).toBe('bd-xyz');
    });

    it('should infer error level from event name', () => {
      const errorEvents = [
        'bead.error',
        'worker.failed',
        'bead.claim_exhausted',
      ];

      for (const eventName of errorEvents) {
        const line = JSON.stringify({
          ts: '2026-03-04T16:17:34.008Z',
          event: eventName,
          session: 'test',
          worker: {
            runner: 'claude',
            provider: 'code',
            model: 'test',
            identifier: 'test',
          },
          data: {},
        });

        const result = parseLogLine(line);
        expect(result?.level).toBe('error');
      }
    });

    it('should infer warn level from event name', () => {
      const warnEvents = ['bead.claim_retry', 'worker.warning'];

      for (const eventName of warnEvents) {
        const line = JSON.stringify({
          ts: '2026-03-04T16:17:34.008Z',
          event: eventName,
          session: 'test',
          worker: {
            runner: 'claude',
            provider: 'code',
            model: 'test',
            identifier: 'test',
          },
          data: {},
        });

        const result = parseLogLine(line);
        expect(result?.level).toBe('warn');
      }
    });

    it('should infer debug level from event name', () => {
      const line = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'worker.debug',
        session: 'test',
        worker: {
          runner: 'claude',
          provider: 'code',
          model: 'test',
          identifier: 'test',
        },
        data: {},
      });

      const result = parseLogLine(line);
      expect(result?.level).toBe('debug');
    });

    it('should default to info level for normal events', () => {
      const infoEvents = [
        'worker.started',
        'worker.idle',
        'bead.claimed',
        'bead.completed',
        'effort.recorded',
      ];

      for (const eventName of infoEvents) {
        const line = JSON.stringify({
          ts: '2026-03-04T16:17:34.008Z',
          event: eventName,
          session: 'test',
          worker: {
            runner: 'claude',
            provider: 'code',
            model: 'test',
            identifier: 'test',
          },
          data: {},
        });

        const result = parseLogLine(line);
        expect(result?.level).toBe('info');
      }
    });

    it('should preserve additional data fields', () => {
      const line = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'bead.claimed',
        session: 'test',
        worker: {
          runner: 'claude',
          provider: 'code',
          model: 'test',
          identifier: 'test',
        },
        data: {
          bead_id: 'bd-123',
          title: 'Custom title',
          attempt: 3,
          workspace: '/home/coder/test',
        },
      });

      const result = parseLogLine(line);

      expect(result).not.toBeNull();
      expect(result?.title).toBe('Custom title');
      expect(result?.attempt).toBe(3);
      expect(result?.workspace).toBe('/home/coder/test');
    });

    it('should flatten worker to runner-identifier format', () => {
      const line = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'worker.started',
        session: 'test',
        worker: {
          runner: 'needle',
          provider: 'anthropic',
          model: 'opus',
          identifier: 'prod-worker-1',
        },
        data: {},
      });

      const result = parseLogLine(line);

      expect(result?.worker).toBe('needle-prod-worker-1');
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

// ============================================
// Conversation Event Parsing Tests
// ============================================

describe('isConversationEvent', () => {
  it('should return true for events with conversation_role field', () => {
    const event: LogEvent = {
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: 'Test',
      conversation_role: 'user',
    };
    expect(isConversationEvent(event)).toBe(true);
  });

  it('should return true for events with conversation_type field', () => {
    const event: LogEvent = {
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: 'Test',
      conversation_type: 'prompt',
    };
    expect(isConversationEvent(event)).toBe(true);
  });

  it('should return true for events with prompt field', () => {
    const event: LogEvent = {
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: 'Test',
      prompt: 'What is the weather?',
    };
    expect(isConversationEvent(event)).toBe(true);
  });

  it('should return true for events with response field', () => {
    const event: LogEvent = {
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: 'Test',
      response: 'The weather is sunny.',
    };
    expect(isConversationEvent(event)).toBe(true);
  });

  it('should return true for events with thinking field', () => {
    const event: LogEvent = {
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: 'Test',
      thinking: 'Let me think about this...',
    };
    expect(isConversationEvent(event)).toBe(true);
  });

  it('should return true for events with tool and tool_args', () => {
    const event: LogEvent = {
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: 'Tool call',
      tool: 'Read',
      tool_args: { file_path: '/src/main.ts' },
    };
    expect(isConversationEvent(event)).toBe(true);
  });

  it('should return true for events with content field', () => {
    const event: LogEvent = {
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: 'Test',
      content: 'Some content',
    };
    expect(isConversationEvent(event)).toBe(true);
  });

  it('should return false for regular log events', () => {
    const event: LogEvent = {
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: 'Starting task',
    };
    expect(isConversationEvent(event)).toBe(false);
  });

  it('should return true for message patterns containing "user prompt"', () => {
    const event: LogEvent = {
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: 'Received user prompt',
    };
    expect(isConversationEvent(event)).toBe(true);
  });
});

describe('parseConversationEvent', () => {
  const baseLogEvent: LogEvent = {
    ts: 1709337600000,
    worker: 'w-test',
    level: 'info',
    msg: 'Test',
  };

  describe('prompt events', () => {
    it('should parse a prompt event with prompt field', () => {
      const event: LogEvent = {
        ...baseLogEvent,
        prompt: 'What is the weather today?',
      };

      const result = parseConversationEvent(event, 0);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('prompt');
      expect(result?.role).toBe('user');
      expect((result as any)?.content).toBe('What is the weather today?');
    });

    it('should parse a prompt event with conversation_role=user', () => {
      const event: LogEvent = {
        ...baseLogEvent,
        conversation_role: 'user',
        content: 'Hello world',
      };

      const result = parseConversationEvent(event, 1);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('prompt');
      expect(result?.role).toBe('user');
      expect((result as any)?.content).toBe('Hello world');
      expect(result?.sequence).toBe(1);
    });

    it('should include bead and tokens in prompt event', () => {
      const event: LogEvent = {
        ...baseLogEvent,
        prompt: 'Test prompt',
        bead: 'bd-abc',
        tokens: 100,
      };

      const result = parseConversationEvent(event, 0);

      expect(result?.bead).toBe('bd-abc');
      expect(result?.tokens).toBe(100);
    });
  });

  describe('response events', () => {
    it('should parse a response event with response field', () => {
      const event: LogEvent = {
        ...baseLogEvent,
        response: 'The weather is sunny today.',
      };

      const result = parseConversationEvent(event, 0);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('response');
      expect(result?.role).toBe('assistant');
      expect((result as any)?.content).toBe('The weather is sunny today.');
    });

    it('should parse response with model and stop reason', () => {
      const event: LogEvent = {
        ...baseLogEvent,
        response: 'Response text',
        model: 'claude-3-opus',
        stop_reason: 'end_turn',
      };

      const result = parseConversationEvent(event, 0);

      expect((result as any)?.model).toBe('claude-3-opus');
      expect((result as any)?.stopReason).toBe('end_turn');
    });

    it('should mark truncated content', () => {
      const longContent = 'A'.repeat(15000);
      const event: LogEvent = {
        ...baseLogEvent,
        response: longContent,
      };

      const result = parseConversationEvent(event, 0, { maxContentLength: 10000 });

      expect((result as any)?.isTruncated).toBe(true);
      expect((result as any)?.content.length).toBeLessThan(longContent.length);
    });
  });

  describe('thinking events', () => {
    it('should parse a thinking event with thinking field', () => {
      const event: LogEvent = {
        ...baseLogEvent,
        thinking: 'Let me analyze this problem...',
      };

      const result = parseConversationEvent(event, 0);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('thinking');
      expect(result?.role).toBe('assistant');
      expect((result as any)?.content).toBe('Let me analyze this problem...');
    });

    it('should include thinking duration', () => {
      const event: LogEvent = {
        ...baseLogEvent,
        thinking: 'Thinking...',
        thinking_duration_ms: 5000,
      };

      const result = parseConversationEvent(event, 0);

      expect((result as any)?.durationMs).toBe(5000);
    });

    it('should parse thinking from message pattern', () => {
      const event: LogEvent = {
        ...baseLogEvent,
        msg: 'Processing thinking block',
        content: 'My thoughts...',
      };

      const result = parseConversationEvent(event, 0);

      expect(result?.type).toBe('thinking');
    });
  });

  describe('tool call events', () => {
    it('should parse a tool call event', () => {
      const event: LogEvent = {
        ...baseLogEvent,
        tool: 'Read',
        tool_args: { file_path: '/src/main.ts' },
      };

      const result = parseConversationEvent(event, 0);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('tool_call');
      expect(result?.role).toBe('assistant');
      expect((result as any)?.tool).toBe('Read');
      expect((result as any)?.args).toEqual({ file_path: '/src/main.ts' });
    });

    it('should generate summary for tool call', () => {
      const event: LogEvent = {
        ...baseLogEvent,
        tool: 'Read',
        tool_args: { file_path: '/src/test.ts' },
      };

      const result = parseConversationEvent(event, 0);

      expect((result as any)?.summary).toBe('Read /src/test.ts');
    });

    it('should generate summary for Bash tool', () => {
      const event: LogEvent = {
        ...baseLogEvent,
        tool: 'Bash',
        tool_args: { command: 'npm test -- --coverage' },
      };

      const result = parseConversationEvent(event, 0);

      expect((result as any)?.summary).toContain('Run:');
      expect((result as any)?.summary).toContain('npm test');
    });

    it('should include tool call ID', () => {
      const event: LogEvent = {
        ...baseLogEvent,
        tool: 'Read',
        tool_args: {},
        tool_call_id: 'call-123',
      };

      const result = parseConversationEvent(event, 0);

      expect((result as any)?.toolCallId).toBe('call-123');
    });

    it('should normalize tool_args from various field names', () => {
      const event1: LogEvent = {
        ...baseLogEvent,
        tool: 'Write',
        tool_input: { file_path: '/a.ts' },
      };
      const event2: LogEvent = {
        ...baseLogEvent,
        tool: 'Write',
        args: { file_path: '/b.ts' },
      };

      const result1 = parseConversationEvent(event1, 0);
      const result2 = parseConversationEvent(event2, 0);

      expect((result1 as any)?.args).toEqual({ file_path: '/a.ts' });
      expect((result2 as any)?.args).toEqual({ file_path: '/b.ts' });
    });
  });

  describe('tool result events', () => {
    it('should parse a successful tool result', () => {
      const event: LogEvent = {
        ...baseLogEvent,
        tool: 'Read',
        result: 'File contents here',
      };

      const result = parseConversationEvent(event, 0);

      expect(result).not.toBeNull();
      expect(result?.type).toBe('tool_result');
      expect(result?.role).toBe('tool');
      expect((result as any)?.tool).toBe('Read');
      expect((result as any)?.content).toBe('File contents here');
      expect((result as any)?.success).toBe(true);
    });

    it('should parse a failed tool result', () => {
      const event: LogEvent = {
        ...baseLogEvent,
        tool: 'Read',
        result: 'Error reading file',
        error: 'File not found',
      };

      const result = parseConversationEvent(event, 0);

      expect((result as any)?.success).toBe(false);
      expect((result as any)?.error).toBe('File not found');
    });

    it('should include duration in tool result', () => {
      const event: LogEvent = {
        ...baseLogEvent,
        tool: 'Bash',
        result: 'Command output',
        duration_ms: 1500,
      };

      const result = parseConversationEvent(event, 0);

      expect((result as any)?.durationMs).toBe(1500);
    });
  });

  describe('explicit conversation_type', () => {
    it('should parse by conversation_type=prompt', () => {
      const event: LogEvent = {
        ...baseLogEvent,
        conversation_type: 'prompt',
        content: 'User prompt',
      };

      const result = parseConversationEvent(event, 0);
      expect(result?.type).toBe('prompt');
    });

    it('should parse by conversation_type=response', () => {
      const event: LogEvent = {
        ...baseLogEvent,
        conversation_type: 'response',
        content: 'Assistant response',
      };

      const result = parseConversationEvent(event, 0);
      expect(result?.type).toBe('response');
    });

    it('should parse by conversation_type=thinking', () => {
      const event: LogEvent = {
        ...baseLogEvent,
        conversation_type: 'thinking',
        content: 'Thinking...',
      };

      const result = parseConversationEvent(event, 0);
      expect(result?.type).toBe('thinking');
    });

    it('should parse by conversation_type=tool_call', () => {
      const event: LogEvent = {
        ...baseLogEvent,
        conversation_type: 'tool_call',
        tool: 'Read',
        tool_args: {},
      };

      const result = parseConversationEvent(event, 0);
      expect(result?.type).toBe('tool_call');
    });

    it('should parse by conversation_type=tool_result', () => {
      const event: LogEvent = {
        ...baseLogEvent,
        conversation_type: 'tool_result',
        tool: 'Read',
        result: 'content',
      };

      const result = parseConversationEvent(event, 0);
      expect(result?.type).toBe('tool_result');
    });
  });

  describe('return null cases', () => {
    it('should return null for non-conversation events', () => {
      const event: LogEvent = {
        ...baseLogEvent,
        msg: 'Starting task',
      };

      const result = parseConversationEvent(event, 0);
      expect(result).toBeNull();
    });

    it('should return null for tool call without tool name', () => {
      const event: LogEvent = {
        ...baseLogEvent,
        tool_args: { file_path: '/test.ts' },
      };

      const result = parseConversationEvent(event, 0);
      expect(result).toBeNull();
    });
  });
});

describe('parseConversationEvents', () => {
  it('should parse multiple conversation events', () => {
    const events: LogEvent[] = [
      { ts: 1, worker: 'w1', level: 'info', msg: 'Test', prompt: 'Hello' },
      { ts: 2, worker: 'w1', level: 'info', msg: 'Test', response: 'Hi there' },
      { ts: 3, worker: 'w1', level: 'info', msg: 'Test', tool: 'Read', tool_args: { file_path: '/a.ts' } },
    ];

    const results = parseConversationEvents(events);

    expect(results).toHaveLength(3);
    expect(results[0].type).toBe('prompt');
    expect(results[1].type).toBe('response');
    expect(results[2].type).toBe('tool_call');
  });

  it('should filter out thinking events when disabled', () => {
    const events: LogEvent[] = [
      { ts: 1, worker: 'w1', level: 'info', msg: 'Test', prompt: 'Hello' },
      { ts: 2, worker: 'w1', level: 'info', msg: 'Test', thinking: 'Let me think...' },
      { ts: 3, worker: 'w1', level: 'info', msg: 'Test', response: 'Response' },
    ];

    const results = parseConversationEvents(events, { includeThinking: false });

    expect(results).toHaveLength(2);
    expect(results[0].type).toBe('prompt');
    expect(results[1].type).toBe('response');
  });

  it('should filter out tool results when disabled', () => {
    const events: LogEvent[] = [
      { ts: 1, worker: 'w1', level: 'info', msg: 'Test', tool: 'Read', tool_args: {} },
      { ts: 2, worker: 'w1', level: 'info', msg: 'Test', tool: 'Read', result: 'content' },
    ];

    const results = parseConversationEvents(events, { includeToolResults: false });

    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('tool_call');
  });

  it('should assign sequential sequence numbers', () => {
    const events: LogEvent[] = [
      { ts: 1, worker: 'w1', level: 'info', msg: 'Test', prompt: 'A' },
      { ts: 2, worker: 'w1', level: 'info', msg: 'Test', prompt: 'B' },
      { ts: 3, worker: 'w1', level: 'info', msg: 'Test', prompt: 'C' },
    ];

    const results = parseConversationEvents(events);

    expect(results[0].sequence).toBe(0);
    expect(results[1].sequence).toBe(1);
    expect(results[2].sequence).toBe(2);
  });
});

describe('parseConversationLine', () => {
  it('should parse a conversation event from a log line', () => {
    const line = JSON.stringify({
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: 'Test',
      prompt: 'What is this?',
    });

    const result = parseConversationLine(line);

    expect(result).not.toBeNull();
    expect(result?.type).toBe('prompt');
  });

  it('should return null for invalid JSON', () => {
    const result = parseConversationLine('not json');
    expect(result).toBeNull();
  });

  it('should return null for non-conversation log line', () => {
    const line = JSON.stringify({
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: 'Starting task',
    });

    const result = parseConversationLine(line);
    expect(result).toBeNull();
  });
});

describe('parseConversationContent', () => {
  it('should parse conversation events from multi-line content', () => {
    const content = [
      JSON.stringify({ ts: 1, worker: 'w1', level: 'info', msg: 'Test', prompt: 'Q1' }),
      JSON.stringify({ ts: 2, worker: 'w1', level: 'info', msg: 'Test', response: 'A1' }),
      JSON.stringify({ ts: 3, worker: 'w1', level: 'info', msg: 'Test', prompt: 'Q2' }),
    ].join('\n');

    const results = parseConversationContent(content);

    expect(results).toHaveLength(3);
  });

  it('should handle empty content', () => {
    const results = parseConversationContent('');
    expect(results).toEqual([]);
  });
});

describe('formatConversationEvent', () => {
  const baseTime = 1709337600000;

  it('should format a prompt event', () => {
    const event: ConversationEvent = {
      id: 'ce-1',
      type: 'prompt',
      role: 'user',
      ts: baseTime,
      worker: 'w-test',
      sequence: 0,
      content: 'Hello world',
    };

    const formatted = formatConversationEvent(event);

    expect(formatted).toContain('[user]');
    expect(formatted).toContain('Hello world');
  });

  it('should format a response event', () => {
    const event: ConversationEvent = {
      id: 'ce-2',
      type: 'response',
      role: 'assistant',
      ts: baseTime,
      worker: 'w-test',
      sequence: 1,
      content: 'Response text',
    };

    const formatted = formatConversationEvent(event);

    expect(formatted).toContain('[assistant]');
    expect(formatted).toContain('Response text');
  });

  it('should format a thinking event', () => {
    const event: ConversationEvent = {
      id: 'ce-3',
      type: 'thinking',
      role: 'assistant',
      ts: baseTime,
      worker: 'w-test',
      sequence: 2,
      content: 'My thoughts...',
    };

    const formatted = formatConversationEvent(event);

    expect(formatted).toContain('[assistant]');
    expect(formatted).toContain('<thinking>');
    expect(formatted).toContain('My thoughts...');
  });

  it('should format a tool call event', () => {
    const event: ConversationEvent = {
      id: 'ce-4',
      type: 'tool_call',
      role: 'assistant',
      ts: baseTime,
      worker: 'w-test',
      sequence: 3,
      tool: 'Read',
      args: { file_path: '/test.ts' },
      summary: 'Read /test.ts',
    };

    const formatted = formatConversationEvent(event);

    expect(formatted).toContain('Tool:');
    expect(formatted).toContain('Read /test.ts');
  });

  it('should format a successful tool result', () => {
    const event: ConversationEvent = {
      id: 'ce-5',
      type: 'tool_result',
      role: 'tool',
      ts: baseTime,
      worker: 'w-test',
      sequence: 4,
      tool: 'Read',
      content: 'file contents',
      success: true,
      durationMs: 500,
    };

    const formatted = formatConversationEvent(event);

    expect(formatted).toContain('Tool result:');
    expect(formatted).toContain('Read');
    expect(formatted).toContain('✓');
    expect(formatted).toContain('500ms');
  });

  it('should format a failed tool result', () => {
    const event: ConversationEvent = {
      id: 'ce-6',
      type: 'tool_result',
      role: 'tool',
      ts: baseTime,
      worker: 'w-test',
      sequence: 5,
      tool: 'Read',
      content: '',
      success: false,
      error: 'File not found',
    };

    const formatted = formatConversationEvent(event);

    expect(formatted).toContain('✗');
  });

  it('should indicate truncated content', () => {
    const event: ConversationEvent = {
      id: 'ce-7',
      type: 'response',
      role: 'assistant',
      ts: baseTime,
      worker: 'w-test',
      sequence: 6,
      content: 'Long text...',
      isTruncated: true,
    };

    const formatted = formatConversationEvent(event);

    expect(formatted).toContain('[truncated]');
  });
});

// ============================================
// NEEDLE Log Format Tests
// ============================================

/**
 * Tests for NEEDLE structured log format parsing.
 *
 * NEEDLE format structure:
 * {
 *   ts: ISO 8601 string,
 *   event: string (e.g., "worker.started", "bead.claimed"),
 *   session: string,
 *   worker: { runner, provider, model, identifier },
 *   data: { ...event-specific payload }
 * }
 *
 * Sample log lines from ~/.needle/logs/
 */
describe('parseLogLine - NEEDLE format', () => {
  describe('worker.started event', () => {
    it('should parse worker.started event with minimal fields', () => {
      // Sample from ~/.needle/logs/needle-claude-anthropic-sonnet-test12.log
      const line = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'worker.started',
        session: 'needle-claude-anthropic-sonnet-test12',
        worker: {
          runner: 'claude',
          provider: 'anthropic',
          model: 'sonnet',
          identifier: 'test12'
        },
        data: {
          pid: 1929276,
          workspace: '/home/coder/NEEDLE',
          agent: 'claude-anthropic-sonnet'
        }
      });

      const result = parseLogLine(line);

      expect(result).not.toBeNull();
      expect(result?.ts).toBe(new Date('2026-03-04T16:17:34.008Z').getTime());
      expect(result?.worker).toBe('claude-test12');
      expect(result?.level).toBe('info');
      expect(result?.msg).toBe('worker.started');
      expect(result?.session).toBe('needle-claude-anthropic-sonnet-test12');
      expect(result?.provider).toBe('anthropic');
      expect(result?.model).toBe('sonnet');
    });

    it('should parse worker.started event with full data', () => {
      // Sample from ~/.needle/logs/forge-glm-test.log
      const line = JSON.stringify({
        ts: '2026-03-04T19:31:30.245Z',
        event: 'worker.started',
        session: 'forge-glm-test',
        worker: {
          runner: 'claude',
          provider: 'code',
          model: 'glm-4.7',
          identifier: 'test'
        },
        data: {
          workspace: '/home/coder/forge',
          agent: 'claude-code-glm-4.7',
          session: 'forge-glm-test',
          timestamp: '2026-03-04T19:31:30Z'
        }
      });

      const result = parseLogLine(line);

      expect(result).not.toBeNull();
      expect(result?.worker).toBe('claude-test');
      expect(result?.provider).toBe('code');
      expect(result?.model).toBe('glm-4.7');
      expect(result?.session).toBe('forge-glm-test');
      // Additional data fields should be preserved
      expect(result?.workspace).toBe('/home/coder/forge');
      expect(result?.agent).toBe('claude-code-glm-4.7');
    });
  });

  describe('bead.claimed event', () => {
    it('should parse bead.claimed event with bead_id', () => {
      // Sample from ~/.needle/logs/forge-glm-test.log
      const line = JSON.stringify({
        ts: '2026-03-04T19:31:34.851Z',
        event: 'bead.claimed',
        session: 'forge-glm-test',
        worker: {
          runner: 'claude',
          provider: 'code',
          model: 'glm-4.7',
          identifier: 'test'
        },
        data: {
          bead_id: 'bd-2ok0',
          actor: 'forge-glm-test',
          attempt: 1,
          workspace: '/home/coder/forge'
        }
      });

      const result = parseLogLine(line);

      expect(result).not.toBeNull();
      expect(result?.msg).toBe('bead.claimed');
      expect(result?.level).toBe('info');
      expect(result?.bead).toBe('bd-2ok0');
      expect(result?.worker).toBe('claude-test');
      expect(result?.attempt).toBe(1);
      expect(result?.actor).toBe('forge-glm-test');
    });

    it('should parse bead.claimed event with title', () => {
      // Sample from ~/.needle/logs/forge-glm-test.log
      const line = JSON.stringify({
        ts: '2026-03-04T19:31:34.978Z',
        event: 'bead.claimed',
        session: 'forge-glm-test',
        worker: {
          runner: 'claude',
          provider: 'code',
          model: 'glm-4.7',
          identifier: 'test'
        },
        data: {
          bead_id: 'bd-2ok0',
          workspace: '/home/coder/forge',
          agent: 'claude-code-glm-4.7',
          title: 'Add model alias mapping for opencode'
        }
      });

      const result = parseLogLine(line);

      expect(result).not.toBeNull();
      expect(result?.bead).toBe('bd-2ok0');
      expect(result?.title).toBe('Add model alias mapping for opencode');
    });
  });

  describe('bead.completed event', () => {
    it('should parse bead.completed event with duration', () => {
      // Sample from ~/.needle/logs/forge-glm-test.log
      const line = JSON.stringify({
        ts: '2026-03-04T19:37:19.590Z',
        event: 'bead.completed',
        session: 'forge-glm-test',
        worker: {
          runner: 'claude',
          provider: 'code',
          model: 'glm-4.7',
          identifier: 'test'
        },
        data: {
          bead_id: 'bd-2ok0',
          duration_ms: 28854,
          output_file: '/tmp/needle-dispatch-bd-2ok0-FHwgcG7A.log'
        }
      });

      const result = parseLogLine(line);

      expect(result).not.toBeNull();
      expect(result?.msg).toBe('bead.completed');
      expect(result?.level).toBe('info');
      expect(result?.bead).toBe('bd-2ok0');
      expect(result?.duration_ms).toBe(28854);
      expect(result?.output_file).toBe('/tmp/needle-dispatch-bd-2ok0-FHwgcG7A.log');
    });
  });

  describe('bead.claim_retry event', () => {
    it('should parse bead.claim_retry event with warn level', () => {
      // Sample from ~/.needle/logs/forge-glm-test.log
      const line = JSON.stringify({
        ts: '2026-03-04T19:37:22.192Z',
        event: 'bead.claim_retry',
        session: 'forge-glm-test',
        worker: {
          runner: 'claude',
          provider: 'code',
          model: 'glm-4.7',
          identifier: 'test'
        },
        data: {
          bead_id: 'bd-e6jq',
          attempt: 1,
          max_retries: 5,
          actor: 'forge-glm-test'
        }
      });

      const result = parseLogLine(line);

      expect(result).not.toBeNull();
      expect(result?.msg).toBe('bead.claim_retry');
      expect(result?.level).toBe('warn'); // 'retry' in event name triggers warn level
      expect(result?.bead).toBe('bd-e6jq');
      expect(result?.attempt).toBe(1);
      expect(result?.max_retries).toBe(5);
    });

    it('should parse multiple claim_retry attempts', () => {
      const attempts = [
        { attempt: 2, bead_id: 'bd-2ee5' },
        { attempt: 3, bead_id: 'bd-e6jq' },
        { attempt: 4, bead_id: 'bd-e6jq' },
        { attempt: 5, bead_id: 'bd-e6jq' }
      ];

      for (const { attempt, bead_id } of attempts) {
        const line = JSON.stringify({
          ts: '2026-03-04T19:37:22.536Z',
          event: 'bead.claim_retry',
          session: 'forge-glm-test',
          worker: {
            runner: 'claude',
            provider: 'code',
            model: 'glm-4.7',
            identifier: 'test'
          },
          data: {
            bead_id,
            attempt,
            max_retries: 5,
            actor: 'forge-glm-test'
          }
        });

        const result = parseLogLine(line);
        expect(result).not.toBeNull();
        expect(result?.level).toBe('warn');
        expect(result?.attempt).toBe(attempt);
      }
    });
  });

  describe('bead.claim_exhausted event', () => {
    it('should parse bead.claim_exhausted event with error level', () => {
      // Sample from ~/.needle/logs/forge-glm-test.log
      const line = JSON.stringify({
        ts: '2026-03-04T19:37:23.647Z',
        event: 'bead.claim_exhausted',
        session: 'forge-glm-test',
        worker: {
          runner: 'claude',
          provider: 'code',
          model: 'glm-4.7',
          identifier: 'test'
        },
        data: {
          max_retries: 5,
          actor: 'forge-glm-test',
          workspace: '/home/coder/forge'
        }
      });

      const result = parseLogLine(line);

      expect(result).not.toBeNull();
      expect(result?.msg).toBe('bead.claim_exhausted');
      expect(result?.level).toBe('error'); // 'exhausted' in event name triggers error level
      expect(result?.max_retries).toBe(5);
    });
  });

  describe('heartbeat.emitted event', () => {
    it('should parse heartbeat.emitted event', () => {
      // Constructed based on NEEDLE format pattern
      const line = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'heartbeat.emitted',
        session: 'needle-claude-anthropic-sonnet-test12',
        worker: {
          runner: 'claude',
          provider: 'anthropic',
          model: 'sonnet',
          identifier: 'test12'
        },
        data: {
          uptime_seconds: 3600,
          beads_completed: 5,
          last_bead_id: 'bd-abc123'
        }
      });

      const result = parseLogLine(line);

      expect(result).not.toBeNull();
      expect(result?.msg).toBe('heartbeat.emitted');
      expect(result?.level).toBe('info');
      expect(result?.worker).toBe('claude-test12');
      expect(result?.session).toBe('needle-claude-anthropic-sonnet-test12');
      expect(result?.uptime_seconds).toBe(3600);
      expect(result?.beads_completed).toBe(5);
    });
  });

  describe('worker.idle event', () => {
    it('should parse worker.idle event', () => {
      // Sample from ~/.needle/logs/needle-claude-anthropic-sonnet-test12.log
      const line = JSON.stringify({
        ts: '2026-03-04T16:17:36.243Z',
        event: 'worker.idle',
        session: 'needle-claude-anthropic-sonnet-test12',
        worker: {
          runner: 'claude',
          provider: 'anthropic',
          model: 'sonnet',
          identifier: 'test12'
        },
        data: {
          consecutive_empty: 1,
          idle_seconds: 0,
          workspace: '/home/coder/NEEDLE',
          agent: 'claude-anthropic-sonnet'
        }
      });

      const result = parseLogLine(line);

      expect(result).not.toBeNull();
      expect(result?.msg).toBe('worker.idle');
      expect(result?.level).toBe('info');
      expect(result?.consecutive_empty).toBe(1);
      expect(result?.idle_seconds).toBe(0);
    });
  });

  describe('effort.recorded event', () => {
    it('should parse effort.recorded event with duration', () => {
      // Sample from ~/.needle/logs/forge-glm-test.log
      const line = JSON.stringify({
        ts: '2026-03-04T19:37:19.616Z',
        event: 'effort.recorded',
        session: 'forge-glm-test',
        worker: {
          runner: 'claude',
          provider: 'code',
          model: 'glm-4.7',
          identifier: 'test'
        },
        data: {
          bead_id: 'bd-2ok0',
          duration_ms: 28854
        }
      });

      const result = parseLogLine(line);

      expect(result).not.toBeNull();
      expect(result?.msg).toBe('effort.recorded');
      expect(result?.bead).toBe('bd-2ok0');
      expect(result?.duration_ms).toBe(28854);
    });
  });

  describe('level inference from event names', () => {
    it('should infer error level for events with "error"', () => {
      const line = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'worker.error',
        session: 'test-session',
        worker: { runner: 'claude', provider: 'code', model: 'sonnet', identifier: 'test' },
        data: {}
      });

      const result = parseLogLine(line);
      expect(result?.level).toBe('error');
    });

    it('should infer error level for events with "fail"', () => {
      const line = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'bead.failed',
        session: 'test-session',
        worker: { runner: 'claude', provider: 'code', model: 'sonnet', identifier: 'test' },
        data: {}
      });

      const result = parseLogLine(line);
      expect(result?.level).toBe('error');
    });

    it('should infer warn level for events with "retry"', () => {
      const line = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'bead.claim_retry',
        session: 'test-session',
        worker: { runner: 'claude', provider: 'code', model: 'sonnet', identifier: 'test' },
        data: {}
      });

      const result = parseLogLine(line);
      expect(result?.level).toBe('warn');
    });

    it('should infer warn level for events with "warn"', () => {
      const line = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'worker.warning',
        session: 'test-session',
        worker: { runner: 'claude', provider: 'code', model: 'sonnet', identifier: 'test' },
        data: {}
      });

      const result = parseLogLine(line);
      expect(result?.level).toBe('warn');
    });

    it('should infer debug level for events with "debug"', () => {
      const line = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'worker.debug',
        session: 'test-session',
        worker: { runner: 'claude', provider: 'code', model: 'sonnet', identifier: 'test' },
        data: {}
      });

      const result = parseLogLine(line);
      expect(result?.level).toBe('debug');
    });

    it('should default to info level for unknown events', () => {
      const line = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'custom.event',
        session: 'test-session',
        worker: { runner: 'claude', provider: 'code', model: 'sonnet', identifier: 'test' },
        data: {}
      });

      const result = parseLogLine(line);
      expect(result?.level).toBe('info');
    });
  });

  describe('timestamp conversion', () => {
    it('should convert ISO 8601 timestamp to Unix milliseconds', () => {
      const line = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'worker.started',
        session: 'test',
        worker: { runner: 'claude', provider: 'code', model: 'sonnet', identifier: 'test' },
        data: {}
      });

      const result = parseLogLine(line);

      // Verify the timestamp is correctly converted
      expect(result?.ts).toBe(1709569054008);
    });

    it('should handle timestamps with different timezone offsets', () => {
      const line = JSON.stringify({
        ts: '2026-03-04T16:17:34+00:00',
        event: 'worker.started',
        session: 'test',
        worker: { runner: 'claude', provider: 'code', model: 'sonnet', identifier: 'test' },
        data: {}
      });

      const result = parseLogLine(line);
      expect(result).not.toBeNull();
      expect(typeof result?.ts).toBe('number');
    });
  });

  describe('worker identifier flattening', () => {
    it('should flatten worker object to runner-identifier format', () => {
      const line = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'worker.started',
        session: 'test',
        worker: { runner: 'claude', provider: 'anthropic', model: 'opus', identifier: 'prod' },
        data: {}
      });

      const result = parseLogLine(line);
      expect(result?.worker).toBe('claude-prod');
    });

    it('should preserve provider and model as separate fields', () => {
      const line = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'worker.started',
        session: 'test',
        worker: { runner: 'claude', provider: 'anthropic', model: 'opus-4', identifier: 'prod' },
        data: {}
      });

      const result = parseLogLine(line);
      expect(result?.provider).toBe('anthropic');
      expect(result?.model).toBe('opus-4');
    });
  });

  describe('mixed NEEDLE and legacy format', () => {
    it('should parse NEEDLE format when mixed with legacy format', () => {
      const needleLine = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'worker.started',
        session: 'test',
        worker: { runner: 'claude', provider: 'code', model: 'sonnet', identifier: 'test' },
        data: {}
      });

      const legacyLine = JSON.stringify({
        ts: 1709569054008,
        worker: 'w-legacy',
        level: 'info',
        msg: 'Legacy message'
      });

      const needleResult = parseLogLine(needleLine);
      const legacyResult = parseLogLine(legacyLine);

      expect(needleResult?.worker).toBe('claude-test');
      expect(needleResult?.msg).toBe('worker.started');

      expect(legacyResult?.worker).toBe('w-legacy');
      expect(legacyResult?.msg).toBe('Legacy message');
    });
  });
});
