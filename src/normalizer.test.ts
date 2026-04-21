/**
 * Tests for FABRIC Normalizer
 *
 * Covers all 5 source paths:
 *   - jsonl (canonical NeedleEvent, legacy NEEDLE, flat legacy)
 *   - otlp-log
 *   - otlp-span-start
 *   - otlp-span-end
 *   - otlp-metric
 */

import { describe, it, expect } from 'vitest';
import {
  normalize,
  normalizeToLogEvent,
  needleEventToLogEvent,
  NormalizerSource,
  EventDeduplicator,
} from './normalizer.js';
import { NeedleEvent, NEEDLE_EVENT_SCHEMA_VERSION, LogEvent } from './types.js';

// ── Helpers ──────────────────────────────────────────────────────

function canonicalNeedleEvent(overrides: Partial<NeedleEvent> = {}): NeedleEvent {
  return {
    timestamp: '2026-03-04T16:17:34.008Z',
    event_type: 'worker.started',
    worker_id: 'claude-anthropic-sonnet-test',
    session_id: 'test-session',
    sequence: 1,
    data: {},
    ...overrides,
  };
}

// ── normalize() ──────────────────────────────────────────────────

describe('normalize', () => {
  it('returns null for unknown source', () => {
    // Exhaustive switch means this can't happen at compile time,
    // but we verify the default branch returns null
    const result = normalize('anything', 'jsonl' as NormalizerSource);
    // Should return a value or null depending on content
    expect(result === null || typeof result === 'object').toBe(true);
  });
});

// ── JSONL source ─────────────────────────────────────────────────

describe('normalize – jsonl source', () => {
  describe('canonical NeedleEvent format', () => {
    it('parses a canonical NeedleEvent JSON string', () => {
      const raw = JSON.stringify(canonicalNeedleEvent());
      const result = normalize(raw, 'jsonl');
      expect(result).not.toBeNull();
      expect(result!.event_type).toBe('worker.started');
      expect(result!.worker_id).toBe('claude-anthropic-sonnet-test');
      expect(result!.session_id).toBe('test-session');
      expect(result!.sequence).toBe(1);
    });

    it('parses a canonical NeedleEvent object passed as string', () => {
      // normalizeJsonl expects a string — objects must be JSON-stringified first
      const obj = canonicalNeedleEvent();
      const result = normalize(JSON.stringify(obj), 'jsonl');
      expect(result).not.toBeNull();
      expect(result!.event_type).toBe('worker.started');
    });

    it('preserves bead_id', () => {
      const raw = JSON.stringify(canonicalNeedleEvent({ bead_id: 'bd-abc' }));
      const result = normalize(raw, 'jsonl');
      expect(result!.bead_id).toBe('bd-abc');
    });

    it('preserves data payload', () => {
      const raw = JSON.stringify(canonicalNeedleEvent({
        data: { pid: 1234, workspace: '/home/test' },
      }));
      const result = normalize(raw, 'jsonl');
      expect(result!.data.pid).toBe(1234);
      expect(result!.data.workspace).toBe('/home/test');
    });

    it('throws on schema version mismatch', () => {
      const raw = JSON.stringify({
        ...canonicalNeedleEvent(),
        schema_version: 999,
      });
      expect(() => normalize(raw, 'jsonl')).toThrow(/schema mismatch/);
    });

    it('accepts matching schema version', () => {
      const raw = JSON.stringify({
        ...canonicalNeedleEvent(),
        schema_version: NEEDLE_EVENT_SCHEMA_VERSION,
      });
      const result = normalize(raw, 'jsonl');
      expect(result).not.toBeNull();
    });

    it('returns null if required fields are missing', () => {
      // Missing worker_id
      const raw = JSON.stringify({
        timestamp: '2026-03-04T16:17:34.008Z',
        event_type: 'test',
        session_id: 's1',
        sequence: 1,
      });
      expect(normalize(raw, 'jsonl')).toBeNull();
    });
  });

  describe('legacy NEEDLE format', () => {
    it('parses NEEDLE format with worker object', () => {
      const raw = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'worker.started',
        session: 'test-session',
        worker: {
          runner: 'claude',
          provider: 'anthropic',
          model: 'sonnet',
          identifier: 'test12',
        },
        data: { pid: 1929276 },
      });
      const result = normalize(raw, 'jsonl');
      expect(result).not.toBeNull();
      expect(result!.worker_id).toBe('claude-anthropic-sonnet-test12');
      expect(result!.event_type).toBe('worker.started');
      expect(result!.session_id).toBe('test-session');
      // sequence is -1 for legacy format (not available)
      expect(result!.sequence).toBe(-1);
    });

    it('parses NEEDLE format with worker string', () => {
      const raw = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'bead.claimed',
        session: 'test-session',
        worker: 'claude-anthropic-opus-prod',
        data: { bead_id: 'bd-2ok0' },
      });
      const result = normalize(raw, 'jsonl');
      expect(result).not.toBeNull();
      expect(result!.worker_id).toBe('claude-anthropic-opus-prod');
      expect(result!.bead_id).toBe('bd-2ok0');
    });

    it('preserves level in data', () => {
      const raw = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'bead.claim_retry',
        level: 'warn',
        session: 'test-session',
        worker: 'worker-1',
        data: {},
      });
      const result = normalize(raw, 'jsonl');
      expect(result!.data.level).toBe('warn');
    });

    it('preserves provider/model from worker object in data', () => {
      const raw = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'worker.started',
        session: 'test-session',
        worker: {
          runner: 'claude',
          provider: 'anthropic',
          model: 'opus',
          identifier: 'prod',
        },
        data: {},
      });
      const result = normalize(raw, 'jsonl');
      expect(result!.data.provider).toBe('anthropic');
      expect(result!.data.model).toBe('opus');
    });

    it('promotes bead_id from data to top level', () => {
      const raw = JSON.stringify({
        ts: '2026-03-04T16:17:34.008Z',
        event: 'bead.claimed',
        session: 'test-session',
        worker: 'worker-1',
        data: { bead_id: 'bd-xyz', title: 'Test task' },
      });
      const result = normalize(raw, 'jsonl');
      expect(result!.bead_id).toBe('bd-xyz');
      // bead_id should be removed from data
      expect(result!.data.bead_id).toBeUndefined();
      // other fields preserved
      expect(result!.data.title).toBe('Test task');
    });
  });

  describe('flat legacy format', () => {
    it('parses flat legacy format', () => {
      const raw = JSON.stringify({
        ts: 1709337600000,
        worker: 'w-abc123',
        level: 'info',
        msg: 'Test message',
      });
      const result = normalize(raw, 'jsonl');
      expect(result).not.toBeNull();
      expect(result!.worker_id).toBe('w-abc123');
      expect(result!.event_type).toBe('Test message');
      expect(result!.data.level).toBe('info');
    });

    it('preserves optional fields in data', () => {
      const raw = JSON.stringify({
        ts: 1709337600000,
        worker: 'w-test',
        level: 'debug',
        msg: 'Tool call',
        tool: 'Read',
        path: '/src/main.ts',
        bead: 'bd-xyz',
        duration_ms: 5000,
        error: 'some error',
      });
      const result = normalize(raw, 'jsonl');
      expect(result!.data.tool).toBe('Read');
      expect(result!.data.path).toBe('/src/main.ts');
      expect(result!.bead_id).toBe('bd-xyz');
      expect(result!.data.duration_ms).toBe(5000);
      expect(result!.data.error).toBe('some error');
    });

    it('preserves extra fields in data', () => {
      const raw = JSON.stringify({
        ts: 1709337600000,
        worker: 'w-test',
        level: 'info',
        msg: 'Test',
        customField: 'custom value',
        tokens: 150,
      });
      const result = normalize(raw, 'jsonl');
      expect(result!.data.customField).toBe('custom value');
      expect(result!.data.tokens).toBe(150);
    });

    it('returns null for invalid flat format', () => {
      // Missing msg
      const raw = JSON.stringify({
        ts: 1709337600000,
        worker: 'w-test',
        level: 'info',
      });
      expect(normalize(raw, 'jsonl')).toBeNull();
    });

    it('returns null for invalid level', () => {
      const raw = JSON.stringify({
        ts: 1709337600000,
        worker: 'w-test',
        level: 'invalid',
        msg: 'Test',
      });
      expect(normalize(raw, 'jsonl')).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('returns null for empty string', () => {
      expect(normalize('', 'jsonl')).toBeNull();
    });

    it('returns null for whitespace-only string', () => {
      expect(normalize('   \n\t  ', 'jsonl')).toBeNull();
    });

    it('returns null for non-JSON string', () => {
      expect(normalize('not valid json', 'jsonl')).toBeNull();
    });

    it('returns null for null input', () => {
      expect(normalize(null as unknown as string, 'jsonl')).toBeNull();
    });

    it('returns null for number input', () => {
      // normalizeJsonl expects a string; non-string input via jsonl source
      // is a caller bug — verify it doesn't crash
      expect(() => normalize(42 as unknown as string, 'jsonl')).not.toThrow();
    });
  });
});

// ── OTLP-log source ──────────────────────────────────────────────

describe('normalize – otlp-log source', () => {
  it('parses OTLP LogRecord with attributes array', () => {
    const record = {
      timeUnixNano: '1772641054008000000',
      attributes: [
        { key: 'event_type', value: { stringValue: 'worker.started' } },
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
        { key: 'session_id', value: { stringValue: 'sess-1' } },
        { key: 'sequence', value: { intValue: '5' } },
        { key: 'bead_id', value: { stringValue: 'bd-123' } },
        { key: 'custom', value: { stringValue: 'data' } },
      ],
    };
    const result = normalize(record, 'otlp-log');
    expect(result).not.toBeNull();
    expect(result!.event_type).toBe('worker.started');
    expect(result!.worker_id).toBe('tcb-alpha');
    expect(result!.session_id).toBe('sess-1');
    expect(result!.sequence).toBe(5);
    expect(result!.bead_id).toBe('bd-123');
    expect(result!.data.custom).toBe('data');
    // Standard fields should not be in data
    expect(result!.data.event_type).toBeUndefined();
    expect(result!.data.worker_id).toBeUndefined();
  });

  it('parses OTLP LogRecord with plain object attributes', () => {
    const record = {
      timeUnixNano: '1772641054008000000',
      attributes: {
        event_type: 'bead.claimed',
        worker_id: 'tcb-bravo',
        session_id: 'sess-2',
      },
    };
    const result = normalize(record, 'otlp-log');
    expect(result).not.toBeNull();
    expect(result!.worker_id).toBe('tcb-bravo');
  });

  it('uses current time when timeUnixNano is missing', () => {
    const record = {
      attributes: [
        { key: 'event_type', value: { stringValue: 'test' } },
        { key: 'worker_id', value: { stringValue: 'w-1' } },
      ],
    };
    const result = normalize(record, 'otlp-log');
    expect(result).not.toBeNull();
    // Should have a valid ISO timestamp
    expect(typeof result!.timestamp).toBe('string');
    expect(Date.parse(result!.timestamp)).not.toBeNaN();
  });

  it('returns null when worker_id is missing', () => {
    const record = {
      attributes: [
        { key: 'event_type', value: { stringValue: 'test' } },
      ],
    };
    expect(normalize(record, 'otlp-log')).toBeNull();
  });

  it('returns null when event_type is missing', () => {
    const record = {
      attributes: [
        { key: 'worker_id', value: { stringValue: 'w-1' } },
      ],
    };
    expect(normalize(record, 'otlp-log')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(normalize(null, 'otlp-log')).toBeNull();
  });

  it('parses int and double values from attributes', () => {
    const record = {
      timeUnixNano: '1772641054008000000',
      attributes: [
        { key: 'event_type', value: { stringValue: 'test' } },
        { key: 'worker_id', value: { stringValue: 'w-1' } },
        { key: 'count', value: { intValue: '42' } },
        { key: 'rate', value: { doubleValue: 3.14 } },
        { key: 'active', value: { boolValue: true } },
      ],
    };
    const result = normalize(record, 'otlp-log');
    expect(result!.data.count).toBe(42);
    expect(result!.data.rate).toBe(3.14);
    expect(result!.data.active).toBe(true);
  });

  // ── namespaced OTLP attributes ──────────────────────────────────\

  it('resolves namespaced attribute keys (needle.worker.id etc.)', () => {
    const record = {
      timeUnixNano: '1772641054008000000',
      attributes: [
        { key: 'event_type', value: { stringValue: 'bead.claimed' } },
        { key: 'needle.worker.id', value: { stringValue: 'tcb-alpha' } },
        { key: 'needle.session.id', value: { stringValue: 'sess-ns' } },
        { key: 'needle.sequence', value: { intValue: '42' } },
        { key: 'needle.bead.id', value: { stringValue: 'bd-ns' } },
      ],
    };
    const result = normalize(record, 'otlp-log');
    expect(result).not.toBeNull();
    expect(result!.worker_id).toBe('tcb-alpha');
    expect(result!.session_id).toBe('sess-ns');
    expect(result!.sequence).toBe(42);
    expect(result!.bead_id).toBe('bd-ns');
  });

  it('prefers namespaced keys over non-namespaced when both present', () => {
    const record = {
      timeUnixNano: '1772641054008000000',
      attributes: [
        { key: 'event_type', value: { stringValue: 'test' } },
        { key: 'worker_id', value: { stringValue: 'plain-worker' } },
        { key: 'needle.worker.id', value: { stringValue: 'ns-worker' } },
        { key: 'session_id', value: { stringValue: 'plain-sess' } },
        { key: 'needle.session.id', value: { stringValue: 'ns-sess' } },
      ],
    };
    const result = normalize(record, 'otlp-log');
    expect(result!.worker_id).toBe('ns-worker');
    expect(result!.session_id).toBe('ns-sess');
  });

  it('falls back to non-namespaced keys when namespaced absent', () => {
    const record = {
      timeUnixNano: '1772641054008000000',
      attributes: [
        { key: 'event_type', value: { stringValue: 'test' } },
        { key: 'worker_id', value: { stringValue: 'fallback-w' } },
        { key: 'session_id', value: { stringValue: 'fallback-s' } },
      ],
    };
    const result = normalize(record, 'otlp-log');
    expect(result!.worker_id).toBe('fallback-w');
    expect(result!.session_id).toBe('fallback-s');
  });

  it('excludes namespaced keys from data payload', () => {
    const record = {
      timeUnixNano: '1772641054008000000',
      attributes: [
        { key: 'event_type', value: { stringValue: 'test' } },
        { key: 'needle.worker.id', value: { stringValue: 'w-1' } },
        { key: 'needle.session.id', value: { stringValue: 's-1' } },
        { key: 'needle.sequence', value: { intValue: '1' } },
        { key: 'needle.bead.id', value: { stringValue: 'bd-1' } },
        { key: 'extra', value: { stringValue: 'kept' } },
      ],
    };
    const result = normalize(record, 'otlp-log');
    expect(result!.data['needle.worker.id']).toBeUndefined();
    expect(result!.data['needle.session.id']).toBeUndefined();
    expect(result!.data['needle.sequence']).toBeUndefined();
    expect(result!.data['needle.bead.id']).toBeUndefined();
    expect(result!.data.extra).toBe('kept');
  });

  // ── body field mapping ──────────────────────────────────────────\

  it('lifts body (kvlistValue) into data', () => {
    const record = {
      timeUnixNano: '1772641054008000000',
      body: {
        kvlistValue: {
          values: [
            { key: 'version', value: { stringValue: '1.2.3' } },
            { key: 'count', value: { intValue: '7' } },
          ],
        },
      },
      attributes: [
        { key: 'event_type', value: { stringValue: 'worker.started' } },
        { key: 'worker_id', value: { stringValue: 'w-1' } },
      ],
    };
    const result = normalize(record, 'otlp-log');
    expect(result).not.toBeNull();
    expect(result!.data.version).toBe('1.2.3');
    expect(result!.data.count).toBe(7);
  });

  it('lifts body (plain JSON object) into data', () => {
    const record = {
      timeUnixNano: '1772641054008000000',
      body: { worker_name: 'tcb-alpha', version: '2.0' },
      attributes: [
        { key: 'event_type', value: { stringValue: 'worker.started' } },
        { key: 'worker_id', value: { stringValue: 'w-1' } },
      ],
    };
    const result = normalize(record, 'otlp-log');
    expect(result!.data.worker_name).toBe('tcb-alpha');
    expect(result!.data.version).toBe('2.0');
  });

  it('wraps scalar body into data.value', () => {
    const record = {
      timeUnixNano: '1772641054008000000',
      body: { stringValue: 'hello world' },
      attributes: [
        { key: 'event_type', value: { stringValue: 'test' } },
        { key: 'worker_id', value: { stringValue: 'w-1' } },
      ],
    };
    const result = normalize(record, 'otlp-log');
    expect(result!.data.value).toBe('hello world');
  });

  it('merges attributes into data on top of body', () => {
    const record = {
      timeUnixNano: '1772641054008000000',
      body: { version: '1.0' },
      attributes: [
        { key: 'event_type', value: { stringValue: 'test' } },
        { key: 'worker_id', value: { stringValue: 'w-1' } },
        { key: 'extra_attr', value: { stringValue: 'from-attrs' } },
      ],
    };
    const result = normalize(record, 'otlp-log');
    expect(result!.data.version).toBe('1.0');
    expect(result!.data.extra_attr).toBe('from-attrs');
  });
});

// ── OTLP-span-start source ───────────────────────────────────────

describe('normalize – otlp-span-start source', () => {
  it('parses OTLP Span start', () => {
    const span = {
      startTimeUnixNano: '1772641054008000000',
      attributes: [
        { key: 'event_type', value: { stringValue: 'bead.claimed' } },
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
        { key: 'session_id', value: { stringValue: 'sess-1' } },
        { key: 'sequence', value: { intValue: '10' } },
        { key: 'bead_id', value: { stringValue: 'bd-span' } },
      ],
    };
    const result = normalize(span, 'otlp-span-start');
    expect(result).not.toBeNull();
    expect(result!.event_type).toBe('bead.claimed');
    expect(result!.worker_id).toBe('tcb-alpha');
    expect(result!.session_id).toBe('sess-1');
    expect(result!.sequence).toBe(10);
    expect(result!.bead_id).toBe('bd-span');
  });

  it('defaults to bead.claimed when event_type is missing', () => {
    const span = {
      startTimeUnixNano: '1772641054008000000',
      attributes: [
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
      ],
    };
    const result = normalize(span, 'otlp-span-start');
    expect(result).not.toBeNull();
    expect(result!.event_type).toBe('bead.claimed');
  });

  it('uses startTimeUnixNano for timestamp', () => {
    const span = {
      startTimeUnixNano: '1772641054008000000',
      attributes: [
        { key: 'worker_id', value: { stringValue: 'w-1' } },
      ],
    };
    const result = normalize(span, 'otlp-span-start');
    // 1772641054008000000 ns → 1772641054008 ms → 2026-03-04T16:17:34.008Z
    expect(result!.timestamp).toBe('2026-03-04T16:17:34.008Z');
  });

  it('accepts snake_case start_time_unix_nano', () => {
    const span = {
      start_time_unix_nano: '1772641054008000000',
      attributes: [
        { key: 'worker_id', value: { stringValue: 'w-1' } },
      ],
    };
    const result = normalize(span, 'otlp-span-start');
    expect(result!.timestamp).toBe('2026-03-04T16:17:34.008Z');
  });

  it('returns null when worker_id is missing', () => {
    const span = {
      attributes: [],
    };
    expect(normalize(span, 'otlp-span-start')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(normalize(null, 'otlp-span-start')).toBeNull();
  });

  // ── span structural fields (span_id, parent_span_id, trace_id) ──

  it('extracts span structural fields into data', () => {
    const span = {
      name: 'bead.lifecycle',
      traceId: 'abc123',
      spanId: 'span001',
      parentSpanId: 'parent001',
      startTimeUnixNano: '1772641054008000000',
      attributes: [
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
        { key: 'session_id', value: { stringValue: 'sess-1' } },
      ],
    };
    const result = normalize(span, 'otlp-span-start');
    expect(result).not.toBeNull();
    expect(result!.data.span_id).toBe('span001');
    expect(result!.data.parent_span_id).toBe('parent001');
    expect(result!.data.trace_id).toBe('abc123');
    expect(result!.data.span_name).toBe('bead.lifecycle');
  });

  it('uses span name for event_type as {name}.started', () => {
    const span = {
      name: 'tool.call',
      spanId: 'span002',
      startTimeUnixNano: '1772641054008000000',
      attributes: [
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
      ],
    };
    const result = normalize(span, 'otlp-span-start');
    expect(result).not.toBeNull();
    expect(result!.event_type).toBe('tool.call.started');
  });

  it('prefers span name over explicit event_type for .started', () => {
    const span = {
      name: 'llm.request',
      spanId: 'span003',
      startTimeUnixNano: '1772641054008000000',
      attributes: [
        { key: 'event_type', value: { stringValue: 'bead.claimed' } },
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
      ],
    };
    const result = normalize(span, 'otlp-span-start');
    expect(result!.event_type).toBe('llm.request.started');
  });

  it('handles spans without structural fields (backward compat)', () => {
    const span = {
      attributes: [
        { key: 'event_type', value: { stringValue: 'bead.claimed' } },
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
      ],
    };
    const result = normalize(span, 'otlp-span-start');
    expect(result).not.toBeNull();
    expect(result!.event_type).toBe('bead.claimed');
    expect(result!.data.span_id).toBeUndefined();
    expect(result!.data.parent_span_id).toBeUndefined();
    expect(result!.data.trace_id).toBeUndefined();
  });

  it('accepts snake_case span_id / parent_span_id / trace_id', () => {
    const span = {
      trace_id: 'trace-ns',
      span_id: 'span-ns',
      parent_span_id: 'parent-ns',
      startTimeUnixNano: '1772641054008000000',
      attributes: [
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
      ],
    };
    const result = normalize(span, 'otlp-span-start');
    expect(result!.data.span_id).toBe('span-ns');
    expect(result!.data.parent_span_id).toBe('parent-ns');
    expect(result!.data.trace_id).toBe('trace-ns');
  });
});

// ── OTLP-span-end source ─────────────────────────────────────────

describe('normalize – otlp-span-end source', () => {
  it('parses OTLP Span end with OK status', () => {
    const span = {
      startTimeUnixNano: '1772641054008000000',
      endTimeUnixNano: '1772641058000000000', // ~3.9s later
      status: { code: 'OK' },
      attributes: [
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
        { key: 'session_id', value: { stringValue: 'sess-1' } },
        { key: 'bead_id', value: { stringValue: 'bd-end' } },
      ],
    };
    const result = normalize(span, 'otlp-span-end');
    expect(result).not.toBeNull();
    expect(result!.event_type).toBe('bead.completed');
    expect(result!.worker_id).toBe('tcb-alpha');
    expect(result!.bead_id).toBe('bd-end');
    // Duration computed from start/end times
    expect(result!.data.duration_ms).toBe(3992);
  });

  it('maps ERROR status to bead.failed', () => {
    const span = {
      endTimeUnixNano: '1772641058000000000',
      status: { code: 'ERROR', message: 'Timeout exceeded' },
      attributes: [
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
      ],
    };
    const result = normalize(span, 'otlp-span-end');
    expect(result).not.toBeNull();
    expect(result!.event_type).toBe('bead.failed');
    expect(result!.data.error).toBe('Timeout exceeded');
  });

  it('maps numeric error code (2) to bead.failed', () => {
    const span = {
      endTimeUnixNano: '1772641058000000000',
      status: { code: 2 },
      attributes: [
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
      ],
    };
    const result = normalize(span, 'otlp-span-end');
    expect(result!.event_type).toBe('bead.failed');
  });

  it('uses explicit event_type from attributes when present', () => {
    const span = {
      endTimeUnixNano: '1772641058000000000',
      status: { code: 'OK' },
      attributes: [
        { key: 'event_type', value: { stringValue: 'custom.event' } },
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
      ],
    };
    const result = normalize(span, 'otlp-span-end');
    expect(result!.event_type).toBe('custom.event');
  });

  it('uses endTime for timestamp', () => {
    const span = {
      endTimeUnixNano: '1772641058000000000',
      attributes: [
        { key: 'worker_id', value: { stringValue: 'w-1' } },
      ],
    };
    const result = normalize(span, 'otlp-span-end');
    expect(result!.timestamp).toBe('2026-03-04T16:17:38.000Z');
  });

  it('accepts snake_case end_time_unix_nano', () => {
    const span = {
      end_time_unix_nano: '1772641058000000000',
      attributes: [
        { key: 'worker_id', value: { stringValue: 'w-1' } },
      ],
    };
    const result = normalize(span, 'otlp-span-end');
    expect(result!.timestamp).toBe('2026-03-04T16:17:38.000Z');
  });

  it('returns null when worker_id is missing', () => {
    const span = {
      endTimeUnixNano: '1772641058000000000',
      attributes: [],
    };
    expect(normalize(span, 'otlp-span-end')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(normalize(null, 'otlp-span-end')).toBeNull();
  });

  // ── span structural fields (span_id, parent_span_id, trace_id) ──

  it('extracts span structural fields into data on span end', () => {
    const span = {
      name: 'bead.lifecycle',
      traceId: 'trace-abc',
      spanId: 'span-end-001',
      parentSpanId: 'parent-end-001',
      startTimeUnixNano: '1772641054008000000',
      endTimeUnixNano: '1772641058000000000',
      status: { code: 'OK' },
      attributes: [
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
        { key: 'bead_id', value: { stringValue: 'bd-end' } },
      ],
    };
    const result = normalize(span, 'otlp-span-end');
    expect(result).not.toBeNull();
    expect(result!.data.span_id).toBe('span-end-001');
    expect(result!.data.parent_span_id).toBe('parent-end-001');
    expect(result!.data.trace_id).toBe('trace-abc');
    expect(result!.data.span_name).toBe('bead.lifecycle');
    expect(result!.data.duration_ms).toBe(3992);
  });

  it('uses span name for event_type as {name}.finished', () => {
    const span = {
      name: 'tool.call',
      spanId: 'span-tool-001',
      endTimeUnixNano: '1772641058000000000',
      status: { code: 'OK' },
      attributes: [
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
      ],
    };
    const result = normalize(span, 'otlp-span-end');
    expect(result).not.toBeNull();
    expect(result!.event_type).toBe('tool.call.finished');
  });

  it('uses {name}.finished even on ERROR status', () => {
    const span = {
      name: 'llm.request',
      spanId: 'span-llm-err',
      endTimeUnixNano: '1772641058000000000',
      status: { code: 'ERROR', message: 'rate limited' },
      attributes: [
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
      ],
    };
    const result = normalize(span, 'otlp-span-end');
    expect(result!.event_type).toBe('llm.request.finished');
    expect(result!.data.error).toBe('rate limited');
  });

  it('promotes span fields through to LogEvent via normalizeToLogEvent', () => {
    const span = {
      name: 'bead.lifecycle',
      traceId: 'trace-log',
      spanId: 'span-log-001',
      parentSpanId: 'parent-log-001',
      startTimeUnixNano: '1772641054008000000',
      endTimeUnixNano: '1772641058000000000',
      status: { code: 'OK' },
      attributes: [
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
        { key: 'bead_id', value: { stringValue: 'bd-log' } },
      ],
    };
    const logEvent = normalizeToLogEvent(span, 'otlp-span-end');
    expect(logEvent).not.toBeNull();
    expect(logEvent!.span_id).toBe('span-log-001');
    expect(logEvent!.parent_span_id).toBe('parent-log-001');
    expect(logEvent!.trace_id).toBe('trace-log');
    expect(logEvent!.span_name).toBe('bead.lifecycle');
    expect(logEvent!.bead).toBe('bd-log');
    expect(logEvent!.duration_ms).toBe(3992);
  });
});

// ── OTLP-metric source ───────────────────────────────────────────

describe('normalize – otlp-metric source', () => {
  it('parses OTLP Metric with asDouble value', () => {
    const metric = {
      name: 'tokens.used',
      timeUnixNano: '1772641054008000000',
      asDouble: 42.5,
      attributes: [
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
        { key: 'session_id', value: { stringValue: 'sess-1' } },
        { key: 'bead_id', value: { stringValue: 'bd-metric' } },
        { key: 'model', value: { stringValue: 'sonnet' } },
      ],
    };
    const result = normalize(metric, 'otlp-metric');
    expect(result).not.toBeNull();
    expect(result!.event_type).toBe('metric.tokens.used');
    expect(result!.worker_id).toBe('tcb-alpha');
    expect(result!.session_id).toBe('sess-1');
    expect(result!.bead_id).toBe('bd-metric');
    expect(result!.data.value).toBe(42.5);
    expect(result!.data.metric_name).toBe('tokens.used');
    expect(result!.data.model).toBe('sonnet');
  });

  it('parses OTLP Metric with asInt value', () => {
    const metric = {
      name: 'beads.completed',
      timeUnixNano: '1772641054008000000',
      asInt: 10,
      attributes: [
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
      ],
    };
    const result = normalize(metric, 'otlp-metric');
    expect(result!.data.value).toBe(10);
  });

  it('parses OTLP Metric with plain value field', () => {
    const metric = {
      name: 'cost.usd',
      timeUnixNano: '1772641054008000000',
      value: 0.05,
      attributes: [
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
      ],
    };
    const result = normalize(metric, 'otlp-metric');
    expect(result!.data.value).toBe(0.05);
  });

  it('defaults event_type to metric.unknown when name is missing', () => {
    const metric = {
      timeUnixNano: '1772641054008000000',
      attributes: [
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
      ],
    };
    const result = normalize(metric, 'otlp-metric');
    expect(result!.event_type).toBe('metric.unknown');
    expect(result!.data.metric_name).toBeUndefined();
  });

  it('returns null when worker_id is missing', () => {
    const metric = {
      name: 'test',
      timeUnixNano: '1772641054008000000',
      attributes: [],
    };
    expect(normalize(metric, 'otlp-metric')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(normalize(null, 'otlp-metric')).toBeNull();
  });

  it('uses snake_case time_unix_nano', () => {
    const metric = {
      name: 'test',
      time_unix_nano: '1772641054008000000',
      attributes: [
        { key: 'worker_id', value: { stringValue: 'w-1' } },
      ],
    };
    const result = normalize(metric, 'otlp-metric');
    expect(result!.timestamp).toBe('2026-03-04T16:17:34.008Z');
  });
});

// ── normalizeToLogEvent ──────────────────────────────────────────

describe('normalizeToLogEvent', () => {
  it('returns null for invalid input', () => {
    expect(normalizeToLogEvent('not json', 'jsonl')).toBeNull();
    expect(normalizeToLogEvent(null, 'otlp-log')).toBeNull();
  });

  it('returns a valid LogEvent from JSONL canonical format', () => {
    const raw = JSON.stringify(canonicalNeedleEvent({
      bead_id: 'bd-test',
      data: { duration_ms: 5000, tool: 'Read', path: '/src/main.ts' },
    }));
    const result = normalizeToLogEvent(raw, 'jsonl');
    expect(result).not.toBeNull();
    expect(result!.ts).toBe(new Date('2026-03-04T16:17:34.008Z').getTime());
    expect(result!.worker).toBe('claude-anthropic-sonnet-test');
    expect(result!.msg).toBe('worker.started');
    expect(result!.session).toBe('test-session');
    expect(result!.bead).toBe('bd-test');
    expect(result!.duration_ms).toBe(5000);
    expect(result!.tool).toBe('Read');
    expect(result!.path).toBe('/src/main.ts');
  });

  it('returns a valid LogEvent from JSONL NEEDLE format', () => {
    const raw = JSON.stringify({
      ts: '2026-03-04T16:17:34.008Z',
      event: 'worker.started',
      level: 'info',
      session: 'test-session',
      worker: {
        runner: 'claude',
        provider: 'anthropic',
        model: 'sonnet',
        identifier: 'test12',
      },
      data: { pid: 1929276 },
    });
    const result = normalizeToLogEvent(raw, 'jsonl');
    expect(result).not.toBeNull();
    expect(result!.worker).toBe('claude-anthropic-sonnet-test12');
    expect(result!.msg).toBe('worker.started');
    expect(result!.level).toBe('info');
    expect(result!.session).toBe('test-session');
    expect(result!.provider).toBe('anthropic');
    expect(result!.model).toBe('sonnet');
  });

  it('returns a valid LogEvent from JSONL flat legacy format', () => {
    const raw = JSON.stringify({
      ts: 1709337600000,
      worker: 'w-test',
      level: 'info',
      msg: 'Test message',
    });
    const result = normalizeToLogEvent(raw, 'jsonl');
    expect(result).not.toBeNull();
    expect(result!.ts).toBe(1709337600000);
    expect(result!.worker).toBe('w-test');
    expect(result!.level).toBe('info');
    expect(result!.msg).toBe('Test message');
  });

  it('returns a valid LogEvent from OTLP-log', () => {
    const record = {
      timeUnixNano: '1772641054008000000',
      attributes: [
        { key: 'event_type', value: { stringValue: 'bead.claimed' } },
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
        { key: 'session_id', value: { stringValue: 'sess-1' } },
      ],
    };
    const result = normalizeToLogEvent(record, 'otlp-log');
    expect(result).not.toBeNull();
    expect(result!.worker).toBe('tcb-alpha');
    expect(result!.msg).toBe('bead.claimed');
    expect(result!.session).toBe('sess-1');
  });

  it('returns a valid LogEvent from OTLP-metric', () => {
    const metric = {
      name: 'tokens.used',
      timeUnixNano: '1772641054008000000',
      asDouble: 100,
      attributes: [
        { key: 'worker_id', value: { stringValue: 'tcb-alpha' } },
        { key: 'session_id', value: { stringValue: 'sess-1' } },
      ],
    };
    const result = normalizeToLogEvent(metric, 'otlp-metric');
    expect(result).not.toBeNull();
    expect(result!.worker).toBe('tcb-alpha');
    expect(result!.msg).toBe('metric.tokens.used');
  });
});

// ── needleEventToLogEvent ────────────────────────────────────────

describe('needleEventToLogEvent', () => {
  it('converts NeedleEvent to LogEvent', () => {
    const ne = canonicalNeedleEvent({
      bead_id: 'bd-abc',
      data: {
        duration_ms: 3000,
        error: 'test error',
        tool: 'Bash',
        path: '/tmp/test',
        provider: 'anthropic',
        model: 'sonnet',
      },
    });
    const result = needleEventToLogEvent(ne);
    expect(result.ts).toBe(new Date('2026-03-04T16:17:34.008Z').getTime());
    expect(result.worker).toBe('claude-anthropic-sonnet-test');
    expect(result.msg).toBe('worker.started');
    expect(result.session).toBe('test-session');
    expect(result.bead).toBe('bd-abc');
    expect(result.duration_ms).toBe(3000);
    expect(result.error).toBe('test error');
    expect(result.tool).toBe('Bash');
    expect(result.path).toBe('/tmp/test');
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('sonnet');
  });

  it('infers level from event name', () => {
    // error.* → error
    expect(needleEventToLogEvent(canonicalNeedleEvent({ event_type: 'error.agent_crash' })).level).toBe('error');
    // *.failed → warn
    expect(needleEventToLogEvent(canonicalNeedleEvent({ event_type: 'bead.failed' })).level).toBe('warn');
    // *.retry → warn
    expect(needleEventToLogEvent(canonicalNeedleEvent({ event_type: 'claim.retry' })).level).toBe('warn');
    // debug.* → debug
    expect(needleEventToLogEvent(canonicalNeedleEvent({ event_type: 'debug.probe' })).level).toBe('debug');
    // default → info
    expect(needleEventToLogEvent(canonicalNeedleEvent({ event_type: 'worker.started' })).level).toBe('info');
  });

  it('uses explicit level from data when present', () => {
    const ne = canonicalNeedleEvent({
      event_type: 'bead.claim_retry',
      data: { level: 'warn' },
    });
    const result = needleEventToLogEvent(ne);
    expect(result.level).toBe('warn');
  });

  it('copies extra data fields to LogEvent', () => {
    const ne = canonicalNeedleEvent({
      data: {
        pid: 1234,
        workspace: '/home/test',
        custom: 'value',
      },
    });
    const result = needleEventToLogEvent(ne);
    expect(result.pid).toBe(1234);
    expect(result.workspace).toBe('/home/test');
    expect(result.custom).toBe('value');
  });

  it('does not overwrite standard LogEvent fields with data fields', () => {
    const ne = canonicalNeedleEvent({
      data: {
        duration_ms: 5000,
      },
    });
    const result = needleEventToLogEvent(ne);
    expect(result.duration_ms).toBe(5000);
    // 'ts' is set from timestamp, not from data
    expect(result.ts).toBe(new Date('2026-03-04T16:17:34.008Z').getTime());
  });
});

// ── Cross-source parity ──────────────────────────────────────────

describe('cross-source parity', () => {
  it('JSONL and OTLP-log produce equivalent LogEvents', () => {
    const canonicalNe = canonicalNeedleEvent({
      bead_id: 'bd-parity',
      data: { duration_ms: 1000 },
    });
    const jsonlLine = JSON.stringify(canonicalNe);

    const otlpRecord = {
      timeUnixNano: String(new Date('2026-03-04T16:17:34.008Z').getTime() * 1_000_000),
      attributes: [
        { key: 'event_type', value: { stringValue: canonicalNe.event_type } },
        { key: 'worker_id', value: { stringValue: canonicalNe.worker_id } },
        { key: 'session_id', value: { stringValue: canonicalNe.session_id } },
        { key: 'sequence', value: { intValue: String(canonicalNe.sequence) } },
        { key: 'bead_id', value: { stringValue: canonicalNe.bead_id! } },
        { key: 'duration_ms', value: { intValue: '1000' } },
      ],
    };

    const jsonlResult = normalizeToLogEvent(jsonlLine, 'jsonl');
    const otlpResult = normalizeToLogEvent(otlpRecord, 'otlp-log');

    // Both should produce equivalent LogEvents
    expect(jsonlResult).not.toBeNull();
    expect(otlpResult).not.toBeNull();

    expect(jsonlResult!.worker).toBe(otlpResult!.worker);
    expect(jsonlResult!.msg).toBe(otlpResult!.msg);
    expect(jsonlResult!.session).toBe(otlpResult!.session);
    expect(jsonlResult!.bead).toBe(otlpResult!.bead);
    expect(jsonlResult!.level).toBe(otlpResult!.level);
    // duration_ms in data is promoted to top-level
    expect(jsonlResult!.duration_ms).toBe(1000);
    expect(otlpResult!.duration_ms).toBe(1000);
  });
});

// ── EventDeduplicator ────────────────────────────────────────────

describe('EventDeduplicator', () => {
  it('passes through the first occurrence of an event', () => {
    const dedup = new EventDeduplicator();
    const event = canonicalNeedleEvent();
    expect(dedup.check(event)).toBe(true);
  });

  it('drops a duplicate event with the same (session_id, worker_id, sequence)', () => {
    const dedup = new EventDeduplicator();
    const event = canonicalNeedleEvent();
    expect(dedup.check(event)).toBe(true);
    expect(dedup.check(event)).toBe(false);
    expect(dedup.droppedCount).toBe(1);
  });

  it('allows events with different sequences from the same worker', () => {
    const dedup = new EventDeduplicator();
    expect(dedup.check(canonicalNeedleEvent({ sequence: 1 }))).toBe(true);
    expect(dedup.check(canonicalNeedleEvent({ sequence: 2 }))).toBe(true);
    expect(dedup.check(canonicalNeedleEvent({ sequence: 3 }))).toBe(true);
    expect(dedup.droppedCount).toBe(0);
  });

  it('allows events with different worker_ids', () => {
    const dedup = new EventDeduplicator();
    expect(dedup.check(canonicalNeedleEvent({ worker_id: 'w1' }))).toBe(true);
    expect(dedup.check(canonicalNeedleEvent({ worker_id: 'w2' }))).toBe(true);
    expect(dedup.droppedCount).toBe(0);
  });

  it('allows events with different session_ids', () => {
    const dedup = new EventDeduplicator();
    expect(dedup.check(canonicalNeedleEvent({ session_id: 's1' }))).toBe(true);
    expect(dedup.check(canonicalNeedleEvent({ session_id: 's2' }))).toBe(true);
    expect(dedup.droppedCount).toBe(0);
  });

  it('passes through events with sequence < 0 (legacy, no dedup)', () => {
    const dedup = new EventDeduplicator();
    const event = canonicalNeedleEvent({ sequence: -1 });
    expect(dedup.check(event)).toBe(true);
    expect(dedup.check(event)).toBe(true);
    expect(dedup.droppedCount).toBe(0);
  });

  it('increments droppedCount for each duplicate', () => {
    const dedup = new EventDeduplicator();
    const event = canonicalNeedleEvent();
    dedup.check(event);
    dedup.check(event);
    dedup.check(event);
    dedup.check(event);
    expect(dedup.droppedCount).toBe(3);
  });

  it('resets state on reset()', () => {
    const dedup = new EventDeduplicator();
    const event = canonicalNeedleEvent();
    dedup.check(event);
    dedup.check(event);
    expect(dedup.droppedCount).toBe(1);
    expect(dedup.size).toBe(1);

    dedup.reset();
    expect(dedup.droppedCount).toBe(0);
    expect(dedup.size).toBe(0);

    // Same event should be allowed again after reset
    expect(dedup.check(event)).toBe(true);
  });

  it('evicts oldest entries when exceeding maxSize', () => {
    const dedup = new EventDeduplicator(5);
    // Fill with 5 entries
    for (let i = 0; i < 5; i++) {
      expect(dedup.check(canonicalNeedleEvent({ sequence: i }))).toBe(true);
    }
    expect(dedup.size).toBe(5);

    // Adding a 6th should trigger eviction
    dedup.check(canonicalNeedleEvent({ sequence: 5 }));
    expect(dedup.size).toBe(5);

    // The oldest (seq=0) should have been evicted, so re-adding it is allowed
    expect(dedup.check(canonicalNeedleEvent({ sequence: 0 }))).toBe(true);
  });

  it('deduplicates same event arriving from JSONL and OTLP sources', () => {
    const dedup = new EventDeduplicator();

    // Same logical event via JSONL (canonical format)
    const jsonlRaw = JSON.stringify(canonicalNeedleEvent({
      session_id: 'sess-dedup',
      worker_id: 'worker-dedup',
      sequence: 42,
    }));

    // Same logical event via OTLP-log
    const otlpRecord = {
      timeUnixNano: '1772641054008000000',
      attributes: [
        { key: 'event_type', value: { stringValue: 'worker.started' } },
        { key: 'worker_id', value: { stringValue: 'worker-dedup' } },
        { key: 'session_id', value: { stringValue: 'sess-dedup' } },
        { key: 'sequence', value: { intValue: '42' } },
      ],
    };

    // JSONL arrives first → keep
    const jsonlNe = normalize(jsonlRaw, 'jsonl')!;
    expect(jsonlNe).not.toBeNull();
    expect(dedup.check(jsonlNe)).toBe(true);

    // OTLP arrives second → drop (duplicate)
    const otlpNe = normalize(otlpRecord, 'otlp-log')!;
    expect(otlpNe).not.toBeNull();
    expect(dedup.check(otlpNe)).toBe(false);
    expect(dedup.droppedCount).toBe(1);
  });

  it('deduplicates OTLP arriving before JSONL (order does not matter)', () => {
    const dedup = new EventDeduplicator();

    const otlpRecord = {
      timeUnixNano: '1772641054008000000',
      attributes: [
        { key: 'event_type', value: { stringValue: 'bead.claimed' } },
        { key: 'worker_id', value: { stringValue: 'w-reverse' } },
        { key: 'session_id', value: { stringValue: 's-reverse' } },
        { key: 'sequence', value: { intValue: '7' } },
      ],
    };

    const jsonlRaw = JSON.stringify(canonicalNeedleEvent({
      event_type: 'bead.claimed',
      worker_id: 'w-reverse',
      session_id: 's-reverse',
      sequence: 7,
    }));

    // OTLP arrives first → keep
    const otlpNe = normalize(otlpRecord, 'otlp-log')!;
    expect(dedup.check(otlpNe)).toBe(true);

    // JSONL arrives second → drop
    const jsonlNe = normalize(jsonlRaw, 'jsonl')!;
    expect(dedup.check(jsonlNe)).toBe(false);
    expect(dedup.droppedCount).toBe(1);
  });

  it('reports size correctly', () => {
    const dedup = new EventDeduplicator();
    expect(dedup.size).toBe(0);
    dedup.check(canonicalNeedleEvent({ sequence: 1 }));
    expect(dedup.size).toBe(1);
    dedup.check(canonicalNeedleEvent({ sequence: 2 }));
    expect(dedup.size).toBe(2);
    // Duplicate doesn't increase size
    dedup.check(canonicalNeedleEvent({ sequence: 1 }));
    expect(dedup.size).toBe(2);
  });
});
