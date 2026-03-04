/**
 * NEEDLE-FABRIC Integration Test
 *
 * Verifies FABRIC can correctly parse NEEDLE logs in production format.
 * Uses real log samples from ~/.needle/logs/ to ensure compatibility.
 */

import { describe, it, expect } from 'vitest';
import { parseLogLine, parseLogLines } from './parser.js';
import { LogEvent } from './types.js';

describe('NEEDLE-FABRIC Integration', () => {
  describe('worker.started events', () => {
    it('should parse worker.started with object worker format', () => {
      const log = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'worker.started',
        session: 'needle-claude-anthropic-sonnet-test12',
        worker: {
          runner: 'claude',
          provider: 'anthropic',
          model: 'sonnet',
          identifier: 'test12',
        },
        data: {
          pid: 1929276,
          workspace: '/home/coder/NEEDLE',
          agent: 'claude-anthropic-sonnet',
        },
      });

      const result = parseLogLine(log);

      expect(result).not.toBeNull();
      expect(result?.ts).toBe(new Date('2026-03-04T16:17:34.008Z').getTime());
      expect(result?.worker).toBe('claude-test12');
      expect(result?.level).toBe('info');
      expect(result?.msg).toBe('worker.started');
      expect(result?.session).toBe('needle-claude-anthropic-sonnet-test12');
      expect(result?.provider).toBe('anthropic');
      expect(result?.model).toBe('sonnet');
      expect(result?.pid).toBe(1929276);
      expect(result?.workspace).toBe('/home/coder/NEEDLE');
      expect(result?.agent).toBe('claude-anthropic-sonnet');
    });

    it('should parse worker.started with string worker format', () => {
      const log = JSON.stringify({
        ts: '2026-03-04T16:17:34.051Z',
        event: 'worker.started',
        session: 'test-session',
        worker: 'claude-code-sonnet-worker1',
        data: {
          workspace: '/home/coder/NEEDLE',
          agent: 'claude-anthropic-sonnet',
          timestamp: '2026-03-04T16:17:34Z',
        },
      });

      const result = parseLogLine(log);

      expect(result).not.toBeNull();
      expect(result?.worker).toBe('claude-code-sonnet-worker1');
      expect(result?.msg).toBe('worker.started');
      expect(result?.level).toBe('info');
      expect(result?.workspace).toBe('/home/coder/NEEDLE');
    });
  });

  describe('bead lifecycle events', () => {
    it('should parse bead.claimed event with bead_id extraction', () => {
      const log = JSON.stringify({
        ts: '2026-03-04T19:31:34.851Z',
        event: 'bead.claimed',
        session: 'forge-glm-test',
        worker: {
          runner: 'claude',
          provider: 'code',
          model: 'glm-4.7',
          identifier: 'test',
        },
        data: {
          bead_id: 'bd-2ok0',
          actor: 'forge-glm-test',
          attempt: 1,
          workspace: '/home/coder/forge',
        },
      });

      const result = parseLogLine(log);

      expect(result).not.toBeNull();
      expect(result?.bead).toBe('bd-2ok0');
      expect(result?.msg).toBe('bead.claimed');
      expect(result?.level).toBe('info');
      expect(result?.actor).toBe('forge-glm-test');
      expect(result?.attempt).toBe(1);
    });

    it('should parse bead.completed event with duration', () => {
      const log = JSON.stringify({
        ts: '2026-03-04T19:37:19.590Z',
        event: 'bead.completed',
        session: 'forge-glm-test',
        worker: {
          runner: 'claude',
          provider: 'code',
          model: 'glm-4.7',
          identifier: 'test',
        },
        data: {
          bead_id: 'bd-2ok0',
          duration_ms: 28854,
          output_file: '/tmp/needle-dispatch-bd-2ok0-FHwgcG7A.log',
        },
      });

      const result = parseLogLine(log);

      expect(result).not.toBeNull();
      expect(result?.bead).toBe('bd-2ok0');
      expect(result?.msg).toBe('bead.completed');
      expect(result?.level).toBe('info');
      expect(result?.duration_ms).toBe(28854);
      expect(result?.output_file).toBe('/tmp/needle-dispatch-bd-2ok0-FHwgcG7A.log');
    });

    it('should parse bead.agent_started event', () => {
      const log = JSON.stringify({
        ts: '2026-03-04T19:31:35.516Z',
        event: 'bead.agent_started',
        session: 'forge-glm-test',
        worker: {
          runner: 'claude',
          provider: 'code',
          model: 'glm-4.7',
          identifier: 'test',
        },
        data: {
          bead_id: 'bd-2ok0',
          agent: 'claude-code-glm-4.7',
          workspace: '/home/coder/forge',
        },
      });

      const result = parseLogLine(log);

      expect(result).not.toBeNull();
      expect(result?.bead).toBe('bd-2ok0');
      expect(result?.msg).toBe('bead.agent_started');
      expect(result?.level).toBe('info');
      expect(result?.agent).toBe('claude-code-glm-4.7');
    });

    it('should parse bead.claim_retry event with warn level', () => {
      const log = JSON.stringify({
        ts: '2026-03-04T19:37:22.192Z',
        event: 'bead.claim_retry',
        session: 'forge-glm-test',
        worker: {
          runner: 'claude',
          provider: 'code',
          model: 'glm-4.7',
          identifier: 'test',
        },
        data: {
          bead_id: 'bd-e6jq',
          attempt: 1,
          max_retries: 5,
          actor: 'forge-glm-test',
        },
      });

      const result = parseLogLine(log);

      expect(result).not.toBeNull();
      expect(result?.bead).toBe('bd-e6jq');
      expect(result?.msg).toBe('bead.claim_retry');
      expect(result?.level).toBe('warn');
      expect(result?.attempt).toBe(1);
      expect(result?.max_retries).toBe(5);
    });

    it('should parse bead.prompt_built event', () => {
      const log = JSON.stringify({
        ts: '2026-03-04T19:31:35.501Z',
        event: 'bead.prompt_built',
        session: 'forge-glm-test',
        worker: {
          runner: 'claude',
          provider: 'code',
          model: 'glm-4.7',
          identifier: 'test',
        },
        data: {
          bead_id: 'bd-2ok0',
          workspace: '/home/coder/forge',
          prompt_length: 1541,
        },
      });

      const result = parseLogLine(log);

      expect(result).not.toBeNull();
      expect(result?.bead).toBe('bd-2ok0');
      expect(result?.msg).toBe('bead.prompt_built');
      expect(result?.prompt_length).toBe(1541);
    });
  });

  describe('worker state events', () => {
    it('should parse worker.idle event with consecutive counts', () => {
      const log = JSON.stringify({
        ts: '2026-03-04T16:17:36.243Z',
        event: 'worker.idle',
        session: 'needle-claude-anthropic-sonnet-test12',
        worker: {
          runner: 'claude',
          provider: 'anthropic',
          model: 'sonnet',
          identifier: 'test12',
        },
        data: {
          consecutive_empty: 1,
          idle_seconds: 0,
          workspace: '/home/coder/NEEDLE',
          agent: 'claude-anthropic-sonnet',
        },
      });

      const result = parseLogLine(log);

      expect(result).not.toBeNull();
      expect(result?.msg).toBe('worker.idle');
      expect(result?.level).toBe('info');
      expect(result?.consecutive_empty).toBe(1);
      expect(result?.idle_seconds).toBe(0);
    });

    it('should parse worker.draining event', () => {
      const log = JSON.stringify({
        ts: '2026-03-04T16:17:43.261Z',
        event: 'worker.draining',
        session: 'needle-claude-anthropic-sonnet-test12',
        worker: {
          runner: 'claude',
          provider: 'anthropic',
          model: 'sonnet',
          identifier: 'test12',
        },
        data: {},
      });

      const result = parseLogLine(log);

      expect(result).not.toBeNull();
      expect(result?.msg).toBe('worker.draining');
      expect(result?.level).toBe('info');
    });

    it('should parse worker.shutdown_initiated event', () => {
      const log = JSON.stringify({
        ts: '2026-03-04T16:17:43.269Z',
        event: 'worker.shutdown_initiated',
        session: 'needle-claude-anthropic-sonnet-test12',
        worker: {
          runner: 'claude',
          provider: 'anthropic',
          model: 'sonnet',
          identifier: 'test12',
        },
        data: {
          signal: 'TERM',
          session: 'needle-claude-anthropic-sonnet-test12',
          timestamp: '2026-03-04T16:17:43Z',
        },
      });

      const result = parseLogLine(log);

      expect(result).not.toBeNull();
      expect(result?.msg).toBe('worker.shutdown_initiated');
      expect(result?.level).toBe('info');
      expect(result?.signal).toBe('TERM');
    });
  });

  describe('effort tracking events', () => {
    it('should parse effort.recorded event', () => {
      const log = JSON.stringify({
        ts: '2026-03-04T19:37:19.616Z',
        event: 'effort.recorded',
        session: 'forge-glm-test',
        worker: {
          runner: 'claude',
          provider: 'code',
          model: 'glm-4.7',
          identifier: 'test',
        },
        data: {
          bead_id: 'bd-2ok0',
          duration_ms: 28854,
        },
      });

      const result = parseLogLine(log);

      expect(result).not.toBeNull();
      expect(result?.bead).toBe('bd-2ok0');
      expect(result?.msg).toBe('effort.recorded');
      expect(result?.duration_ms).toBe(28854);
    });
  });

  describe('error events', () => {
    it('should infer error level for events with "error" in name', () => {
      const log = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'bead.error',
        session: 'test-session',
        worker: {
          runner: 'claude',
          provider: 'code',
          model: 'sonnet',
          identifier: 'test',
        },
        data: {
          bead_id: 'bd-abc',
          error: 'Failed to process bead',
        },
      });

      const result = parseLogLine(log);

      expect(result).not.toBeNull();
      expect(result?.level).toBe('error');
      expect(result?.msg).toBe('bead.error');
      expect(result?.error).toBe('Failed to process bead');
    });

    it('should infer error level for events with "fail" in name', () => {
      const log = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'bead.failed',
        session: 'test-session',
        worker: 'claude-test',
        data: {
          bead_id: 'bd-xyz',
        },
      });

      const result = parseLogLine(log);

      expect(result).not.toBeNull();
      expect(result?.level).toBe('error');
      expect(result?.msg).toBe('bead.failed');
    });

    it('should infer error level for queue.exhausted events', () => {
      const log = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'queue.exhausted',
        session: 'test-session',
        worker: 'claude-test',
        data: {},
      });

      const result = parseLogLine(log);

      expect(result).not.toBeNull();
      expect(result?.level).toBe('error');
      expect(result?.msg).toBe('queue.exhausted');
    });
  });

  describe('multi-line log parsing', () => {
    it('should parse complete worker session from multiple log lines', () => {
      const logs = [
        '{"ts":"2026-03-04T16:17:34.008Z","event":"worker.started","session":"test","worker":{"runner":"claude","provider":"code","model":"sonnet","identifier":"w1"},"data":{"pid":123}}',
        '{"ts":"2026-03-04T16:17:35.000Z","event":"bead.claimed","session":"test","worker":{"runner":"claude","provider":"code","model":"sonnet","identifier":"w1"},"data":{"bead_id":"bd-abc"}}',
        '{"ts":"2026-03-04T16:17:40.000Z","event":"bead.completed","session":"test","worker":{"runner":"claude","provider":"code","model":"sonnet","identifier":"w1"},"data":{"bead_id":"bd-abc","duration_ms":5000}}',
        '{"ts":"2026-03-04T16:17:41.000Z","event":"worker.idle","session":"test","worker":{"runner":"claude","provider":"code","model":"sonnet","identifier":"w1"},"data":{"consecutive_empty":1}}',
      ].join('\n');

      const results = parseLogLines(logs);

      expect(results).toHaveLength(4);

      // Verify first event
      expect(results[0].msg).toBe('worker.started');
      expect(results[0].worker).toBe('claude-w1');
      expect(results[0].pid).toBe(123);

      // Verify second event
      expect(results[1].msg).toBe('bead.claimed');
      expect(results[1].bead).toBe('bd-abc');

      // Verify third event
      expect(results[2].msg).toBe('bead.completed');
      expect(results[2].bead).toBe('bd-abc');
      expect(results[2].duration_ms).toBe(5000);

      // Verify fourth event
      expect(results[3].msg).toBe('worker.idle');
      expect(results[3].consecutive_empty).toBe(1);

      // All events should have same worker
      expect(results.every((r) => r.worker === 'claude-w1')).toBe(true);

      // All events should have same session
      expect(results.every((r) => r.session === 'test')).toBe(true);
    });

    it('should handle mixed NEEDLE and legacy format logs', () => {
      const logs = [
        '{"ts":"2026-03-04T16:17:34.008Z","event":"worker.started","session":"test","worker":"claude-w1","data":{}}',
        '{"ts":1709569054008,"worker":"legacy-w2","level":"info","msg":"Legacy message"}',
        '{"ts":"2026-03-04T16:17:36.000Z","event":"bead.claimed","session":"test","worker":"claude-w1","data":{"bead_id":"bd-xyz"}}',
      ].join('\n');

      const results = parseLogLines(logs);

      expect(results).toHaveLength(3);

      // First NEEDLE event
      expect(results[0].worker).toBe('claude-w1');
      expect(results[0].msg).toBe('worker.started');
      expect(results[0].level).toBe('info');

      // Legacy event
      expect(results[1].worker).toBe('legacy-w2');
      expect(results[1].msg).toBe('Legacy message');
      expect(results[1].level).toBe('info');

      // Second NEEDLE event
      expect(results[2].worker).toBe('claude-w1');
      expect(results[2].msg).toBe('bead.claimed');
      expect(results[2].bead).toBe('bd-xyz');
    });

    it('should skip invalid lines and continue parsing', () => {
      const logs = [
        '{"ts":"2026-03-04T16:17:34.008Z","event":"worker.started","session":"test","worker":"claude-w1","data":{}}',
        'not valid json',
        '',
        '{"ts":"2026-03-04T16:17:35.000Z","event":"bead.claimed","session":"test","worker":"claude-w1","data":{"bead_id":"bd-abc"}}',
        '{"invalid":"structure"}',
        '{"ts":"2026-03-04T16:17:36.000Z","event":"bead.completed","session":"test","worker":"claude-w1","data":{"bead_id":"bd-abc"}}',
      ].join('\n');

      const results = parseLogLines(logs);

      expect(results).toHaveLength(3);
      expect(results[0].msg).toBe('worker.started');
      expect(results[1].msg).toBe('bead.claimed');
      expect(results[2].msg).toBe('bead.completed');
    });
  });

  describe('timestamp conversion', () => {
    it('should correctly convert ISO timestamps to Unix milliseconds', () => {
      const isoTimestamp = '2026-03-04T19:31:34.851Z';
      const expectedUnixMs = new Date(isoTimestamp).getTime();

      const log = JSON.stringify({
        ts: isoTimestamp,
        event: 'test.event',
        session: 'test',
        worker: 'test-worker',
        data: {},
      });

      const result = parseLogLine(log);

      expect(result).not.toBeNull();
      expect(result?.ts).toBe(expectedUnixMs);
      // Verify it's a valid timestamp in the future (2026)
      expect(result?.ts).toBeGreaterThan(1700000000000); // > Nov 2023
    });

    it('should handle different ISO timestamp formats', () => {
      const timestamps = [
        '2026-03-04T16:17:34.008Z',
        '2026-03-04T16:17:34Z',
        '2026-03-04T16:17:34.123456Z',
      ];

      timestamps.forEach((ts) => {
        const log = JSON.stringify({
          ts,
          event: 'test.event',
          session: 'test',
          worker: 'test-worker',
          data: {},
        });

        const result = parseLogLine(log);
        expect(result).not.toBeNull();
        expect(result?.ts).toBe(new Date(ts).getTime());
      });
    });
  });

  describe('field extraction from data payload', () => {
    it('should extract all common fields from data', () => {
      const log = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'test.event',
        session: 'test-session',
        worker: 'test-worker',
        data: {
          bead_id: 'bd-123',
          duration_ms: 1000,
          error: 'test error',
          tool: 'Read',
          path: '/test/path.ts',
          custom_field: 'custom_value',
        },
      });

      const result = parseLogLine(log);

      expect(result).not.toBeNull();
      expect(result?.bead).toBe('bd-123');
      expect(result?.duration_ms).toBe(1000);
      expect(result?.error).toBe('test error');
      expect(result?.tool).toBe('Read');
      expect(result?.path).toBe('/test/path.ts');
      expect(result?.custom_field).toBe('custom_value');
    });

    it('should preserve NEEDLE-specific fields', () => {
      const log = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'worker.started',
        session: 'test-session',
        worker: {
          runner: 'claude',
          provider: 'anthropic',
          model: 'sonnet',
          identifier: 'test',
        },
        data: {
          workspace: '/home/coder/NEEDLE',
          agent: 'claude-anthropic-sonnet',
        },
      });

      const result = parseLogLine(log);

      expect(result).not.toBeNull();
      expect(result?.session).toBe('test-session');
      expect(result?.provider).toBe('anthropic');
      expect(result?.model).toBe('sonnet');
      expect(result?.workspace).toBe('/home/coder/NEEDLE');
      expect(result?.agent).toBe('claude-anthropic-sonnet');
    });
  });

  describe('complete real-world log sequence', () => {
    it('should parse complete bead lifecycle from real NEEDLE logs', () => {
      // This simulates a real bead execution from start to finish
      const realLogs = `{"ts":"2026-03-04T19:31:34.851Z","event":"bead.claimed","session":"forge-glm-test","worker":{"runner":"claude","provider":"code","model":"glm-4.7","identifier":"test"},"data":{"bead_id":"bd-2ok0","actor":"forge-glm-test","attempt":1,"workspace":"/home/coder/forge"}}
{"ts":"2026-03-04T19:31:34.978Z","event":"bead.claimed","session":"forge-glm-test","worker":{"runner":"claude","provider":"code","model":"glm-4.7","identifier":"test"},"data":{"bead_id":"bd-2ok0","workspace":"/home/coder/forge","agent":"claude-code-glm-4.7","title":"Add model alias mapping for opencode (sonnet -> provider/model)"}}
{"ts":"2026-03-04T19:31:34.997Z","event":"bead.mitosis.check","session":"forge-glm-test","worker":{"runner":"claude","provider":"code","model":"glm-4.7","identifier":"test"},"data":{"bead_id":"bd-2ok0"}}
{"ts":"2026-03-04T19:31:35.501Z","event":"bead.prompt_built","session":"forge-glm-test","worker":{"runner":"claude","provider":"code","model":"glm-4.7","identifier":"test"},"data":{"bead_id":"bd-2ok0","workspace":"/home/coder/forge","prompt_length":1541}}
{"ts":"2026-03-04T19:31:35.516Z","event":"bead.agent_started","session":"forge-glm-test","worker":{"runner":"claude","provider":"code","model":"glm-4.7","identifier":"test"},"data":{"bead_id":"bd-2ok0","agent":"claude-code-glm-4.7","workspace":"/home/coder/forge"}}
{"ts":"2026-03-04T19:37:19.590Z","event":"bead.completed","session":"forge-glm-test","worker":{"runner":"claude","provider":"code","model":"glm-4.7","identifier":"test"},"data":{"bead_id":"bd-2ok0","duration_ms":28854,"output_file":"/tmp/needle-dispatch-bd-2ok0-FHwgcG7A.log"}}
{"ts":"2026-03-04T19:37:19.616Z","event":"effort.recorded","session":"forge-glm-test","worker":{"runner":"claude","provider":"code","model":"glm-4.7","identifier":"test"},"data":{"bead_id":"bd-2ok0","duration_ms":28854}}`;

      const events = parseLogLines(realLogs);

      expect(events).toHaveLength(7);

      // Verify all events have correct worker
      expect(events.every((e) => e.worker === 'claude-test')).toBe(true);

      // Verify all events have correct session
      expect(events.every((e) => e.session === 'forge-glm-test')).toBe(true);

      // Verify all events have correct bead_id (except first claim)
      expect(events.slice(0).every((e) => e.bead === 'bd-2ok0')).toBe(true);

      // Verify event sequence
      expect(events[0].msg).toBe('bead.claimed');
      expect(events[1].msg).toBe('bead.claimed');
      expect(events[2].msg).toBe('bead.mitosis.check');
      expect(events[3].msg).toBe('bead.prompt_built');
      expect(events[4].msg).toBe('bead.agent_started');
      expect(events[5].msg).toBe('bead.completed');
      expect(events[6].msg).toBe('effort.recorded');

      // Verify specific fields
      expect(events[3].prompt_length).toBe(1541);
      expect(events[5].duration_ms).toBe(28854);
      expect(events[5].output_file).toBe('/tmp/needle-dispatch-bd-2ok0-FHwgcG7A.log');
      expect(events[6].duration_ms).toBe(28854);
    });
  });
});
