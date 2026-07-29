/**
 * Unit tests for host extraction from OTLP resource attributes
 *
 * Tests the extractHostFromAttributes function and verifies that OTLP
 * normalization functions correctly extract host from both needle.host
 * and service.instance.id resource attributes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NeedleEvent } from './types.js';

// Mock the hostname module before importing the normalizer
vi.mock('./hostname.js', () => ({
  getLocalHostname: vi.fn(() => 'localhost'),
}));

import { extractHostFromAttributes, normalize } from './normalizer.js';
import { getLocalHostname } from './hostname.js';

describe('extractHostFromAttributes', () => {
  beforeEach(() => {
    // Mock getLocalHostname to return 'localhost' for consistent testing
    vi.mocked(getLocalHostname).mockReturnValue('localhost');
    // Ensure no hostname environment variables are set
    delete process.env.HOSTNAME;
    delete process.env.HOST;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
  it('extracts host from needle.host attribute', () => {
    const attrs = new Map<string, unknown>([
      ['needle.host', 'custom-host.example.com'],
      ['service.instance.id', 'should-not-use-this'],
    ]);
    const host = extractHostFromAttributes(attrs);
    expect(host).toBe('custom-host.example.com');
  });

  it('extracts host from service.instance.id when needle.host is absent', () => {
    const attrs = new Map<string, unknown>([
      ['service.instance.id', 'instance-12345'],
      ['other.attr', 'value'],
    ]);
    const host = extractHostFromAttributes(attrs);
    expect(host).toBe('instance-12345');
  });

  it('falls back to localhost when neither attribute is present', () => {
    const attrs = new Map<string, unknown>([
      ['worker_id', 'test-worker'],
      ['session_id', 'test-session'],
    ]);
    const host = extractHostFromAttributes(attrs);
    expect(host).toBe('localhost');
  });

  it('handles empty string values correctly', () => {
    const attrs = new Map<string, unknown>([
      ['needle.host', ''],
      ['service.instance.id', ''],
    ]);
    const host = extractHostFromAttributes(attrs);
    expect(host).toBe('localhost');
  });

  it('prioritizes needle.host over service.instance.id', () => {
    const attrs = new Map<string, unknown>([
      ['needle.host', 'priority-host'],
      ['service.instance.id', 'fallback-host'],
    ]);
    const host = extractHostFromAttributes(attrs);
    expect(host).toBe('priority-host');
  });
});

describe('OTLP log normalization with host extraction', () => {
  beforeEach(() => {
    // Mock getLocalHostname to return 'localhost' for consistent testing
    vi.mocked(getLocalHostname).mockReturnValue('localhost');
    delete process.env.HOSTNAME;
    delete process.env.HOST;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts host from needle.host in resource attributes', () => {
    const record = {
      timeUnixNano: '1709150400000000000',
      attributes: [
        { key: 'event_type', value: { stringValue: 'worker.started' } },
        { key: 'worker_id', value: { stringValue: 'worker-1' } },
        { key: 'session_id', value: { stringValue: 'session-1' } },
        { key: 'sequence', value: { intValue: 1 } },
        { key: 'needle.host', value: { stringValue: 'host-1.example.com' } },
      ],
    };

    const event = normalize(record, 'otlp-log') as NeedleEvent;
    expect(event).not.toBeNull();
    expect(event!.host).toBe('host-1.example.com');
  });

  it('extracts host from service.instance.id when needle.host absent', () => {
    const record = {
      timeUnixNano: '1709150400000000000',
      attributes: [
        { key: 'event_type', value: { stringValue: 'worker.started' } },
        { key: 'worker_id', value: { stringValue: 'worker-2' } },
        { key: 'session_id', value: { stringValue: 'session-2' } },
        { key: 'sequence', value: { intValue: 1 } },
        { key: 'service.instance.id', value: { stringValue: 'instance-abc123' } },
      ],
    };

    const event = normalize(record, 'otlp-log') as NeedleEvent;
    expect(event).not.toBeNull();
    expect(event!.host).toBe('instance-abc123');
  });

  it('falls back to localhost when no host attributes present', () => {
    const record = {
      timeUnixNano: '1709150400000000000',
      attributes: [
        { key: 'event_type', value: { stringValue: 'worker.started' } },
        { key: 'worker_id', value: { stringValue: 'worker-3' } },
        { key: 'session_id', value: { stringValue: 'session-3' } },
        { key: 'sequence', value: { intValue: 1 } },
      ],
    };

    const event = normalize(record, 'otlp-log') as NeedleEvent;
    expect(event).not.toBeNull();
    expect(event!.host).toBe('localhost');
  });
});

describe('OTLP span normalization with host extraction', () => {
  beforeEach(() => {
    // Mock getLocalHostname to return 'localhost' for consistent testing
    vi.mocked(getLocalHostname).mockReturnValue('localhost');
    delete process.env.HOSTNAME;
    delete process.env.HOST;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts host from needle.host in span start events', () => {
    const span = {
      name: 'test-operation',
      spanId: 'span-123',
      traceId: 'trace-456',
      startTimeUnixNano: '1709150400000000000',
      attributes: [
        { key: 'worker_id', value: { stringValue: 'worker-span' } },
        { key: 'session_id', value: { stringValue: 'session-span' } },
        { key: 'sequence', value: { intValue: 1 } },
        { key: 'needle.host', value: { stringValue: 'span-host.example.com' } },
      ],
    };

    const event = normalize(span, 'otlp-span-start') as NeedleEvent;
    expect(event).not.toBeNull();
    expect(event!.host).toBe('span-host.example.com');
  });

  it('extracts host from service.instance.id in span end events', () => {
    const span = {
      name: 'test-operation',
      spanId: 'span-789',
      traceId: 'trace-101',
      startTimeUnixNano: '1709150400000000000',
      endTimeUnixNano: '1709150401000000000',
      status: { code: 'OK' },
      attributes: [
        { key: 'worker_id', value: { stringValue: 'worker-span-2' } },
        { key: 'session_id', value: { stringValue: 'session-span-2' } },
        { key: 'sequence', value: { intValue: 1 } },
        { key: 'service.instance.id', value: { stringValue: 'span-instance-456' } },
      ],
    };

    const event = normalize(span, 'otlp-span-end') as NeedleEvent;
    expect(event).not.toBeNull();
    expect(event!.host).toBe('span-instance-456');
  });
});

describe('OTLP metric normalization with host extraction', () => {
  beforeEach(() => {
    // Mock getLocalHostname to return 'localhost' for consistent testing
    vi.mocked(getLocalHostname).mockReturnValue('localhost');
    delete process.env.HOSTNAME;
    delete process.env.HOST;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts host from needle.host in metric data points', () => {
    const metricPoint = {
      name: 'test.metric',
      timeUnixNano: '1709150400000000000',
      asDouble: 123.45,
      attributes: [
        { key: 'worker_id', value: { stringValue: 'worker-metric' } },
        { key: 'session_id', value: { stringValue: 'session-metric' } },
        { key: 'needle.host', value: { stringValue: 'metric-host.example.com' } },
      ],
    };

    const event = normalize(metricPoint, 'otlp-metric') as NeedleEvent;
    expect(event).not.toBeNull();
    expect(event!.host).toBe('metric-host.example.com');
  });

  it('extracts host from service.instance.id in metric data points', () => {
    const metricPoint = {
      name: 'another.metric',
      timeUnixNano: '1709150400000000000',
      asInt: '999',
      attributes: [
        { key: 'worker_id', value: { stringValue: 'worker-metric-2' } },
        { key: 'session_id', value: { stringValue: 'session-metric-2' } },
        { key: 'service.instance.id', value: { stringValue: 'metric-instance-789' } },
      ],
    };

    const event = normalize(metricPoint, 'otlp-metric') as NeedleEvent;
    expect(event).not.toBeNull();
    expect(event!.host).toBe('metric-instance-789');
  });
});

describe('Host extraction priority order', () => {
  it('uses needle.host even when service.instance.id is present', () => {
    const record = {
      timeUnixNano: '1709150400000000000',
      attributes: [
        { key: 'event_type', value: { stringValue: 'test.event' } },
        { key: 'worker_id', value: { stringValue: 'worker-test' } },
        { key: 'session_id', value: { stringValue: 'session-test' } },
        { key: 'sequence', value: { intValue: 1 } },
        { key: 'needle.host', value: { stringValue: 'priority-host.test' } },
        { key: 'service.instance.id', value: { stringValue: 'fallback-host.test' } },
      ],
    };

    const event = normalize(record, 'otlp-log') as NeedleEvent;
    expect(event).not.toBeNull();
    expect(event!.host).toBe('priority-host.test');
  });

  it('uses service.instance.id when needle.host is missing', () => {
    const record = {
      timeUnixNano: '1709150400000000000',
      attributes: [
        { key: 'event_type', value: { stringValue: 'test.event' } },
        { key: 'worker_id', value: { stringValue: 'worker-test' } },
        { key: 'session_id', value: { stringValue: 'session-test' } },
        { key: 'sequence', value: { intValue: 1 } },
        { key: 'service.instance.id', value: { stringValue: 'fallback-host.test' } },
      ],
    };

    const event = normalize(record, 'otlp-log') as NeedleEvent;
    expect(event).not.toBeNull();
    expect(event!.host).toBe('fallback-host.test');
  });

  it('uses localhost when both attributes are missing', () => {
    const record = {
      timeUnixNano: '1709150400000000000',
      attributes: [
        { key: 'event_type', value: { stringValue: 'test.event' } },
        { key: 'worker_id', value: { stringValue: 'worker-test' } },
        { key: 'session_id', value: { stringValue: 'session-test' } },
        { key: 'sequence', value: { intValue: 1 } },
      ],
    };

    const event = normalize(record, 'otlp-log') as NeedleEvent;
    expect(event).not.toBeNull();
    expect(event!.host).toBe('localhost');
  });
});
