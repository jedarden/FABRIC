/**
 * Multi-host Prometheus metrics contract tests.
 *
 * docs/metrics.md ("Multi-Host Metrics" + "Host Label Resolution") promises:
 *   1. The host label is resolved in priority order
 *      needle.host → service.instance.id → local hostname, with needle.host
 *      honored at every OTLP placement — the resource block, log records,
 *      spans (/v1/traces), and metric data points (/v1/metrics) — and
 *      resource-level attributes promoted onto every record (without
 *      clobbering a record-level value of the same key).
 *   2. needle.host beats service.instance.id in every placement combination
 *      (resource × record level); the losing attribute never becomes a
 *      series in any host-labeled metric family.
 *   3. Legacy JSONL sources (no host attributes at all) are attributed to the
 *      local hostname.
 *   4. Per-host metrics (event_count, ingest_rate_per_second, active_workers)
 *      keep hosts separate — events from different machines never merge.
 *
 * normalizerHostExtraction.test.ts pins the pure extraction functions and
 * server.metrics.test.ts pins the exposition shape; this file pins the
 * contract end-to-end over the real ingest surfaces (OTLP/HTTP receiver,
 * POST /api/events, DirectoryTailer → recordEvent wiring) into GET /api/metrics,
 * including label escaping for hostile host strings.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createWebServer, WebServer } from './web/server.js';
import { InMemoryEventStore } from './store.js';
import { ServerMetrics } from './serverMetrics.js';
import { DirectoryTailer } from './directoryTailer.js';
import { resetCrossReferenceManager } from './crossReferenceManager.js';
import { getLocalHostname } from './hostname.js';
import type { LogEvent } from './types.js';

// ─── Prometheus text format parsing (escape-aware) ──────────────────────────

interface ParsedSample {
  labels: Record<string, string>;
  value: number;
}

interface ParseResult {
  metrics: Map<string, ParsedMetric>;
  /** Sample lines that did not parse — must be empty for a valid exposition. */
  unparsed: string[];
  raw: string;
}

interface ParsedMetric {
  samples: ParsedSample[];
}

/** Reverse of the Prometheus label-value escaping rules (\\ \" \n). */
function unescapeLabelValue(v: string): string {
  return v.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c));
}

function parsePrometheus(text: string): ParseResult {
  const metrics = new Map<string, ParsedMetric>();
  const unparsed: string[] = [];
  let current: ParsedMetric | undefined;

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    if (line.startsWith('#')) {
      const help = line.match(/^# HELP (\S+)/);
      if (help) {
        current = { samples: [] };
        metrics.set(help[1], current);
        continue;
      }
      continue;
    }

    const sample = line.match(
      /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/
    );
    if (!sample || !current) {
      unparsed.push(line);
      continue;
    }
    const labels: Record<string, string> = {};
    if (sample[2]) {
      // (?:[^"\\]|\\.)* — escaped quotes stay inside the value
      for (const m of sample[2].matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g)) {
        labels[m[1]] = unescapeLabelValue(m[2]);
      }
    }
    current.samples.push({ labels, value: parseFloat(sample[3]) });
  }

  return { metrics, unparsed, raw: text };
}

/** Value of the sample of a metric carrying a given host label (throws if absent). */
function sampleValue(metrics: Map<string, ParsedMetric>, name: string, host: string): number {
  const sample = metrics.get(name)?.samples.find(s => s.labels.host === host);
  expect(sample, `${name}{host="${host}"} must be emitted`).toBeDefined();
  return sample!.value;
}

/** Sample value or undefined — for polling and absence checks. */
function findHostSample(metrics: Map<string, ParsedMetric>, name: string, host: string): ParsedSample | undefined {
  return metrics.get(name)?.samples.find(s => s.labels.host === host);
}

/**
 * The losing attribute of a precedence contest must never become a series:
 * absent from every host-labeled metric family in the exposition
 * (fabric_tailer_files_watched is excluded — docs/metrics.md scopes it to
 * the local host unconditionally), and absent from the raw exposition text
 * entirely — it must not resurface as a label of any other family either.
 */
function expectHostAbsentEverywhere(metrics: Map<string, ParsedMetric>, raw: string, host: string): void {
  for (const name of ['fabric_event_count', 'fabric_ingest_rate_per_second', 'fabric_active_workers']) {
    expect(findHostSample(metrics, name, host),
      `${name}{host="${host}"} must not exist — the losing attribute never becomes a series`).toBeUndefined();
  }
  expect(raw.includes(host), `"${host}" must not appear anywhere in the exposition`).toBe(false);
}

// ─── Server harness ─────────────────────────────────────────────────────────

const NONEXISTENT_LOG_DIR = path.join(os.tmpdir(), 'fabric-multihost-metrics-nonexistent');

interface ServerHandle {
  store: InMemoryEventStore;
  otlpUrl: string;
  fetchText: (p: string) => Promise<string>;
  fetchJson: (p: string, init?: RequestInit) => Promise<{ status: number; body: any }>;
  metrics: () => Promise<ParseResult>;
  /** Ingest stamp, matching src/cli.ts's tailer wiring. */
  recordEvent: (host?: string, workerId?: string) => void;
  stop: () => Promise<void>;
}

async function startServer(): Promise<ServerHandle> {
  const store = new InMemoryEventStore();
  resetCrossReferenceManager();

  const server = createWebServer({
    port: 0,
    logPath: NONEXISTENT_LOG_DIR,
    store,
    otlpHttpPort: 0,
  });

  await server.start();
  const port = server.getPort();
  const otlpPort = server.getOtlpPort();
  expect(otlpPort).toBeGreaterThan(0);

  const base = `http://127.0.0.1:${port}`;
  return {
    store,
    otlpUrl: `http://127.0.0.1:${otlpPort}`,
    fetchText: async (p) => await (await fetch(`${base}${p}`)).text(),
    fetchJson: async (p, init) => {
      const res = await fetch(`${base}${p}`, init);
      return { status: res.status, body: await res.json() };
    },
    metrics: async () => parsePrometheus(await (await fetch(`${base}/api/metrics`)).text()),
    recordEvent: (host?: string, workerId?: string) => server.recordEvent(host, workerId),
    stop: async () => {
      await new Promise<void>((resolve) => {
        server.on('stop', () => resolve());
        server.stop();
      });
      store.clear();
      resetCrossReferenceManager();
    },
  };
}

// ─── OTLP payload builders ──────────────────────────────────────────────────

type Attrs = Record<string, string>;

const kvAttrs = (attrs: Attrs) =>
  Object.entries(attrs).map(([key, v]) => ({ key, value: { stringValue: v } }));

function otlpLogsPayload(
  resourceAttrs: Attrs,
  records: { attrs: Attrs; workerId: string }[],
  event = 'worker.started',
) {
  return {
    resourceLogs: [{
      resource: { attributes: kvAttrs(resourceAttrs) },
      scopeLogs: [{
        logRecords: records.map((r, i) => ({
          timeUnixNano: String((Date.now() - 1000 + i) * 1_000_000),
          attributes: kvAttrs({
            event_type: event,
            'needle.worker.id': r.workerId,
            'needle.session.id': `sess-${r.workerId}`,
            'needle.sequence': String(i + 1),
            ...r.attrs,
          }),
        })),
      }],
    }],
  };
}

function otlpSpansPayload(resourceAttrs: Attrs, spans: { workerId: string; attrs?: Attrs }[]) {
  const nowNs = String(Date.now() * 1_000_000);
  return {
    resourceSpans: [{
      resource: { attributes: kvAttrs(resourceAttrs) },
      scopeSpans: [{
        spans: spans.map((s, i) => ({
          traceId: `trace-${s.workerId}`,
          spanId: `span-${s.workerId}`,
          name: 'bead_execution',
          startTimeUnixNano: String(Date.now() * 1_000_000 - 500_000_000),
          endTimeUnixNano: nowNs,
          status: { code: 'OK' },
          attributes: kvAttrs({
            'needle.worker.id': s.workerId,
            'needle.session.id': `sess-${s.workerId}`,
            'needle.sequence': String(i + 1),
            ...s.attrs,
          }),
        })),
      }],
    }],
  };
}

function otlpSpanPayload(resourceAttrs: Attrs, workerId: string, extraAttrs: Attrs = {}) {
  return otlpSpansPayload(resourceAttrs, [{ workerId, attrs: extraAttrs }]);
}

function otlpMetricsPayload(resourceAttrs: Attrs, dataPoints: { workerId: string; attrs?: Attrs }[]) {
  return {
    resourceMetrics: [{
      resource: { attributes: kvAttrs(resourceAttrs) },
      scopeMetrics: [{
        metrics: [{
          name: 'tokens.used',
          gauge: {
            dataPoints: dataPoints.map((dp) => ({
              timeUnixNano: String(Date.now() * 1_000_000),
              asDouble: 42.0,
              attributes: kvAttrs({
                'needle.worker.id': dp.workerId,
                'needle.session.id': `sess-${dp.workerId}`,
                ...dp.attrs,
              }),
            })),
          },
        }],
      }],
    }],
  };
}

function otlpMetricPayload(resourceAttrs: Attrs, workerId: string, extraAttrs: Attrs = {}) {
  return otlpMetricsPayload(resourceAttrs, [{ workerId, attrs: extraAttrs }]);
}

async function postOtlp(handle: ServerHandle, route: string, payload: unknown): Promise<number> {
  const res = await fetch(`${handle.otlpUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  expect(res.status, `POST ${route}`).toBe(200);
  // give the receiver's onEvent a beat to land in the store/metrics
  await new Promise(resolve => setTimeout(resolve, 50));
  return res.status;
}

/** Poll until `probe` returns true (fs.watch and receiver pipelines are async). */
async function waitFor(probe: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

const NO_HOST: Attrs = {};

// ─── OTLP ingest → per-host metrics ─────────────────────────────────────────

describe('multi-host metrics — OTLP ingest (end-to-end)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('attributes log and span events to the needle.host they carry', async () => {
    vi.stubEnv('HOSTNAME', 'ingest-local');
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/logs', otlpLogsPayload(
        { 'needle.host': 'otlp-host-a' },
        [{ attrs: NO_HOST, workerId: 'w-a1' }, { attrs: NO_HOST, workerId: 'w-a2' }],
      ));
      // A span normalizes to a started + a finished event, both carrying host.
      await postOtlp(server, '/v1/traces', otlpSpanPayload({ 'needle.host': 'otlp-host-a' }, 'w-a3'));

      const { metrics } = await server.metrics();

      // 2 log records + 2 span events → 4 events on otlp-host-a.
      expect(sampleValue(metrics, 'fabric_event_count', 'otlp-host-a')).toBe(4);
      expect(sampleValue(metrics, 'fabric_active_workers', 'otlp-host-a')).toBe(3);
      // A rate series exists for the remote host (value is window-dependent).
      expect(findHostSample(metrics, 'fabric_ingest_rate_per_second', 'otlp-host-a')).toBeDefined();

      // Nothing leaked to the local host: no local series was created.
      expect(findHostSample(metrics, 'fabric_event_count', getLocalHostname())).toBeUndefined();
    } finally {
      await server.stop();
    }
  });

  it('carries host from OTLP metric data points into the metrics', async () => {
    vi.stubEnv('HOSTNAME', 'ingest-local');
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/metrics', otlpMetricPayload({ 'needle.host': 'otlp-host-m' }, 'w-m1'));

      const { metrics } = await server.metrics();
      expect(sampleValue(metrics, 'fabric_event_count', 'otlp-host-m')).toBe(1);
      expect(sampleValue(metrics, 'fabric_active_workers', 'otlp-host-m')).toBe(1);
    } finally {
      await server.stop();
    }
  });

  it('resolves resource-level host attributes placed on the OTLP resource, not the record', async () => {
    // docs/metrics.md says "populated from OTLP resource attributes" — the
    // canonical placement is the resource block, which enrichRecord promotes
    // onto every record.
    vi.stubEnv('HOSTNAME', 'ingest-local');
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/logs', otlpLogsPayload(
        { 'needle.host': 'resource-host' },
        [{ attrs: NO_HOST, workerId: 'w-r1' }],
      ));

      const { metrics } = await server.metrics();
      expect(sampleValue(metrics, 'fabric_event_count', 'resource-host')).toBe(1);
      expect(findHostSample(metrics, 'fabric_event_count', getLocalHostname())).toBeUndefined();
    } finally {
      await server.stop();
    }
  });
});

// ─── Record-level host extraction on log records, spans, and data points ────

describe('multi-host metrics — record-level host extraction on log records, spans, and metric data points (end-to-end)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('carries a log-record-level needle.host through /v1/logs into the host label', async () => {
    // docs/metrics.md: "needle.host at every OTLP placement — the resource
    // block, log records, spans (/v1/traces), and metric data points
    // (/v1/metrics) — becomes the host label." The log-record placement,
    // standing alone: no contest, no resource host.
    vi.stubEnv('HOSTNAME', 'ingest-local');
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/logs', otlpLogsPayload(
        NO_HOST,
        [{ attrs: { 'needle.host': 'log-record-host' }, workerId: 'w-log-rec' }],
      ));

      const { metrics } = await server.metrics();
      expect(sampleValue(metrics, 'fabric_event_count', 'log-record-host')).toBe(1);
      expect(sampleValue(metrics, 'fabric_active_workers', 'log-record-host')).toBe(1);
      // The empty resource must not have routed anything to the local host.
      expect(findHostSample(metrics, 'fabric_event_count', 'ingest-local')).toBeUndefined();
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });

  it('carries a span-level needle.host through /v1/traces into the host label', async () => {
    // docs/metrics.md: "needle.host on OTLP log records, spans, and metric
    // data points becomes the host label" — the span (record) placement, not
    // just the resource block.
    vi.stubEnv('HOSTNAME', 'ingest-local');
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/traces', otlpSpanPayload(
        NO_HOST,
        'w-span-rec',
        { 'needle.host': 'span-record-host' },
      ));

      const { metrics } = await server.metrics();
      // A span normalizes to a started + a finished event, both on the host.
      expect(sampleValue(metrics, 'fabric_event_count', 'span-record-host')).toBe(2);
      expect(sampleValue(metrics, 'fabric_active_workers', 'span-record-host')).toBe(1);
      expect(findHostSample(metrics, 'fabric_ingest_rate_per_second', 'span-record-host')).toBeDefined();
      // The empty resource must not have routed anything to the local host.
      expect(findHostSample(metrics, 'fabric_event_count', 'ingest-local')).toBeUndefined();
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });

  it('carries a data-point-level needle.host through /v1/metrics into the host label', async () => {
    vi.stubEnv('HOSTNAME', 'ingest-local');
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/metrics', otlpMetricPayload(
        NO_HOST,
        'w-dp-rec',
        { 'needle.host': 'datapoint-record-host' },
      ));

      const { metrics } = await server.metrics();
      expect(sampleValue(metrics, 'fabric_event_count', 'datapoint-record-host')).toBe(1);
      expect(sampleValue(metrics, 'fabric_active_workers', 'datapoint-record-host')).toBe(1);
      expect(findHostSample(metrics, 'fabric_event_count', 'ingest-local')).toBeUndefined();
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });
});

// ─── Host-label precedence (end-to-end) ─────────────────────────────────────

describe('multi-host metrics — host-label precedence (end-to-end)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('needle.host wins over service.instance.id; the loser never becomes a series', async () => {
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/logs', otlpLogsPayload(
        { 'needle.host': 'needled-host', 'service.instance.id': 'instance-host' },
        [{ attrs: NO_HOST, workerId: 'w-p1' }],
      ));

      const { metrics, raw } = await server.metrics();
      expect(sampleValue(metrics, 'fabric_event_count', 'needled-host')).toBe(1);
      expectHostAbsentEverywhere(metrics, raw, 'instance-host');
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });

  it('service.instance.id is used when needle.host is absent', async () => {
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/logs', otlpLogsPayload(
        { 'service.instance.id': 'instance-only-host' },
        [{ attrs: NO_HOST, workerId: 'w-p2' }],
      ));

      const { metrics } = await server.metrics();
      expect(sampleValue(metrics, 'fabric_event_count', 'instance-only-host')).toBe(1);
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });

  it('a record-level needle.host overrides a resource-level service.instance.id', async () => {
    // Realistic mixed placement: the SDK stamps service.instance.id on the
    // resource while NEEDLE tags each record with needle.host.
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/logs', otlpLogsPayload(
        { 'service.instance.id': 'resource-instance' },
        [{ attrs: { 'needle.host': 'record-host' }, workerId: 'w-p3' }],
      ));

      const { metrics, raw } = await server.metrics();
      expect(sampleValue(metrics, 'fabric_event_count', 'record-host')).toBe(1);
      expectHostAbsentEverywhere(metrics, raw, 'resource-instance');
    } finally {
      await server.stop();
    }
  });

  it('events from different precedence tiers land in separate series', async () => {
    vi.stubEnv('HOSTNAME', 'ingest-local');
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/logs', otlpLogsPayload(
        { 'needle.host': 'tier-needle' },
        [{ attrs: NO_HOST, workerId: 'w-t1' }],
      ));
      await postOtlp(server, '/v1/logs', otlpLogsPayload(
        { 'service.instance.id': 'tier-instance' },
        [{ attrs: NO_HOST, workerId: 'w-t2' }],
      ));
      await postOtlp(server, '/v1/logs', otlpLogsPayload(
        NO_HOST,
        [{ attrs: NO_HOST, workerId: 'w-t3' }],
      ));

      const { metrics } = await server.metrics();
      expect(sampleValue(metrics, 'fabric_event_count', 'tier-needle')).toBe(1);
      expect(sampleValue(metrics, 'fabric_event_count', 'tier-instance')).toBe(1);
      expect(sampleValue(metrics, 'fabric_event_count', 'ingest-local')).toBe(1);
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(3);
    } finally {
      await server.stop();
    }
  });
});

// ─── Label-precedence matrix: every resource × record placement ─────────────

describe('multi-host metrics — label-precedence matrix, every resource × record placement (end-to-end)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('record-level needle.host beats a record-level service.instance.id (logs)', async () => {
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/logs', otlpLogsPayload(
        NO_HOST,
        [{ attrs: { 'needle.host': 'rec-needle', 'service.instance.id': 'rec-instance' }, workerId: 'w-x1' }],
      ));

      const { metrics, raw } = await server.metrics();
      expect(sampleValue(metrics, 'fabric_event_count', 'rec-needle')).toBe(1);
      expectHostAbsentEverywhere(metrics, raw, 'rec-instance');
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });

  it('resource-level needle.host beats a record-level service.instance.id (logs)', async () => {
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/logs', otlpLogsPayload(
        { 'needle.host': 'res-needle' },
        [{ attrs: { 'service.instance.id': 'rec-instance' }, workerId: 'w-x2' }],
      ));

      const { metrics, raw } = await server.metrics();
      expect(sampleValue(metrics, 'fabric_event_count', 'res-needle')).toBe(1);
      expectHostAbsentEverywhere(metrics, raw, 'rec-instance');
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });

  it('record-level service.instance.id is the host when needle.host is absent at record level (logs)', async () => {
    vi.stubEnv('HOSTNAME', 'ingest-local');
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/logs', otlpLogsPayload(
        NO_HOST,
        [{ attrs: { 'service.instance.id': 'rec-instance-only' }, workerId: 'w-x3' }],
      ));

      const { metrics } = await server.metrics();
      expect(sampleValue(metrics, 'fabric_event_count', 'rec-instance-only')).toBe(1);
      expect(sampleValue(metrics, 'fabric_active_workers', 'rec-instance-only')).toBe(1);
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });

  it('a record-level needle.host survives resource-level promotion carrying the same key (logs)', async () => {
    // enrichRecord prepends resource attributes onto every record; promotion
    // must not clobber the more specific record-level needle.host.
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/logs', otlpLogsPayload(
        { 'needle.host': 'dup-resource-host' },
        [{ attrs: { 'needle.host': 'dup-record-host' }, workerId: 'w-x4' }],
      ));

      const { metrics, raw } = await server.metrics();
      expect(sampleValue(metrics, 'fabric_event_count', 'dup-record-host')).toBe(1);
      expectHostAbsentEverywhere(metrics, raw, 'dup-resource-host');
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });

  it('a record-level needle.host beats the service.instance.id promoted from the span resource (traces)', async () => {
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/traces', otlpSpanPayload(
        { 'service.instance.id': 'span-resource-instance' },
        'w-x5',
        { 'needle.host': 'span-record-needle' },
      ));

      const { metrics, raw } = await server.metrics();
      // Started + finished events, both attributed to the span-level host.
      expect(sampleValue(metrics, 'fabric_event_count', 'span-record-needle')).toBe(2);
      expect(sampleValue(metrics, 'fabric_active_workers', 'span-record-needle')).toBe(1);
      expectHostAbsentEverywhere(metrics, raw, 'span-resource-instance');
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });

  it('a record-level needle.host beats the service.instance.id promoted from the metric resource (metrics)', async () => {
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/metrics', otlpMetricPayload(
        { 'service.instance.id': 'dp-resource-instance' },
        'w-x6',
        { 'needle.host': 'dp-record-needle' },
      ));

      const { metrics, raw } = await server.metrics();
      expect(sampleValue(metrics, 'fabric_event_count', 'dp-record-needle')).toBe(1);
      expect(sampleValue(metrics, 'fabric_active_workers', 'dp-record-needle')).toBe(1);
      expectHostAbsentEverywhere(metrics, raw, 'dp-resource-instance');
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });

  // The remaining resource × record combinations on the other two OTLP
  // signal endpoints — docs/metrics.md: "needle.host beats service.instance.id
  // in every placement combination", pinned as the full matrix on all three
  // signals (a span normalizes to started + finished, so its counts are 2).

  it('resource-level needle.host beats resource-level service.instance.id (traces)', async () => {
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/traces', otlpSpanPayload(
        { 'needle.host': 'tr-res-needle', 'service.instance.id': 'tr-res-instance' },
        'w-x7',
      ));

      const { metrics, raw } = await server.metrics();
      expect(sampleValue(metrics, 'fabric_event_count', 'tr-res-needle')).toBe(2);
      expect(sampleValue(metrics, 'fabric_active_workers', 'tr-res-needle')).toBe(1);
      expectHostAbsentEverywhere(metrics, raw, 'tr-res-instance');
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });

  it('resource-level needle.host beats a record-level service.instance.id (traces)', async () => {
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/traces', otlpSpanPayload(
        { 'needle.host': 'tr-res-needle-2' },
        'w-x8',
        { 'service.instance.id': 'tr-rec-instance-2' },
      ));

      const { metrics, raw } = await server.metrics();
      expect(sampleValue(metrics, 'fabric_event_count', 'tr-res-needle-2')).toBe(2);
      expectHostAbsentEverywhere(metrics, raw, 'tr-rec-instance-2');
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });

  it('a record-level needle.host beats a record-level service.instance.id (traces)', async () => {
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/traces', otlpSpanPayload(
        NO_HOST,
        'w-x9',
        { 'needle.host': 'tr-rec-needle-3', 'service.instance.id': 'tr-rec-instance-3' },
      ));

      const { metrics, raw } = await server.metrics();
      expect(sampleValue(metrics, 'fabric_event_count', 'tr-rec-needle-3')).toBe(2);
      expectHostAbsentEverywhere(metrics, raw, 'tr-rec-instance-3');
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });

  it('resource-level needle.host beats resource-level service.instance.id (metrics)', async () => {
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/metrics', otlpMetricPayload(
        { 'needle.host': 'dp-res-needle', 'service.instance.id': 'dp-res-instance' },
        'w-x10',
      ));

      const { metrics, raw } = await server.metrics();
      expect(sampleValue(metrics, 'fabric_event_count', 'dp-res-needle')).toBe(1);
      expect(sampleValue(metrics, 'fabric_active_workers', 'dp-res-needle')).toBe(1);
      expectHostAbsentEverywhere(metrics, raw, 'dp-res-instance');
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });

  it('resource-level needle.host beats a record-level service.instance.id (metrics)', async () => {
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/metrics', otlpMetricPayload(
        { 'needle.host': 'dp-res-needle-2' },
        'w-x11',
        { 'service.instance.id': 'dp-rec-instance-2' },
      ));

      const { metrics, raw } = await server.metrics();
      expect(sampleValue(metrics, 'fabric_event_count', 'dp-res-needle-2')).toBe(1);
      expectHostAbsentEverywhere(metrics, raw, 'dp-rec-instance-2');
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });

  it('a record-level needle.host beats a record-level service.instance.id (metrics)', async () => {
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/metrics', otlpMetricPayload(
        NO_HOST,
        'w-x12',
        { 'needle.host': 'dp-rec-needle-3', 'service.instance.id': 'dp-rec-instance-3' },
      ));

      const { metrics, raw } = await server.metrics();
      expect(sampleValue(metrics, 'fabric_event_count', 'dp-rec-needle-3')).toBe(1);
      expectHostAbsentEverywhere(metrics, raw, 'dp-rec-instance-3');
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });
});

// ─── Resource attributes promoted onto every record ─────────────────────────

describe('multi-host metrics — OTLP resource attributes promoted onto every record (end-to-end)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('promotes the resource needle.host onto every log record in one payload (/v1/logs)', async () => {
    vi.stubEnv('HOSTNAME', 'ingest-local');
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/logs', otlpLogsPayload(
        { 'needle.host': 'promo-logs-host' },
        [
          { attrs: NO_HOST, workerId: 'w-promo-1' },
          { attrs: NO_HOST, workerId: 'w-promo-2' },
          { attrs: NO_HOST, workerId: 'w-promo-3' },
        ],
      ));

      const { metrics } = await server.metrics();
      // All three records landed on the resource host — promotion is
      // per-record, not first-record-only — and nothing fell through to
      // the local hostname.
      expect(sampleValue(metrics, 'fabric_event_count', 'promo-logs-host')).toBe(3);
      expect(sampleValue(metrics, 'fabric_active_workers', 'promo-logs-host')).toBe(3);
      expect(findHostSample(metrics, 'fabric_event_count', 'ingest-local')).toBeUndefined();
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });

  it('promotes the resource needle.host onto every span in one payload (/v1/traces)', async () => {
    vi.stubEnv('HOSTNAME', 'ingest-local');
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/traces', otlpSpansPayload(
        { 'needle.host': 'promo-spans-host' },
        [{ workerId: 'w-promo-s1' }, { workerId: 'w-promo-s2' }],
      ));

      const { metrics } = await server.metrics();
      // Two spans normalize to started + finished each → 4 events, all on
      // the resource host.
      expect(sampleValue(metrics, 'fabric_event_count', 'promo-spans-host')).toBe(4);
      expect(sampleValue(metrics, 'fabric_active_workers', 'promo-spans-host')).toBe(2);
      expect(findHostSample(metrics, 'fabric_event_count', 'ingest-local')).toBeUndefined();
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });

  it('promotes the resource needle.host onto every metric data point in one payload (/v1/metrics)', async () => {
    vi.stubEnv('HOSTNAME', 'ingest-local');
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/metrics', otlpMetricsPayload(
        { 'needle.host': 'promo-dps-host' },
        [{ workerId: 'w-promo-d1' }, { workerId: 'w-promo-d2' }],
      ));

      const { metrics } = await server.metrics();
      expect(sampleValue(metrics, 'fabric_event_count', 'promo-dps-host')).toBe(2);
      expect(sampleValue(metrics, 'fabric_active_workers', 'promo-dps-host')).toBe(2);
      expect(findHostSample(metrics, 'fabric_event_count', 'ingest-local')).toBeUndefined();
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });
});

// ─── Missing host attributes → local hostname fallback ──────────────────────

describe('multi-host metrics — missing attributes and legacy JSONL sources', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('OTLP events without any host attribute are attributed to the local hostname', async () => {
    vi.stubEnv('HOSTNAME', 'ingest-local');
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/logs', otlpLogsPayload(NO_HOST, [{ attrs: NO_HOST, workerId: 'w-f1' }]));

      const { metrics } = await server.metrics();
      expect(sampleValue(metrics, 'fabric_event_count', 'ingest-local')).toBe(1);
      expect(sampleValue(metrics, 'fabric_active_workers', 'ingest-local')).toBe(1);
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });

  it('legacy NEEDLE JSONL events over POST /api/events carry the local hostname', async () => {
    vi.stubEnv('HOSTNAME', 'ingest-local');
    const server = await startServer();
    try {
      // Modern NEEDLE per-worker JSONL shape (ts: ISO string, event, worker, data)
      const legacyRes = await server.fetchJson('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ts: new Date().toISOString(),
          event: 'bead.claimed',
          worker: 'w-jsonl-1',
          session: 'sess-jsonl-1',
          data: { bead_id: 'bd-legacy' },
        }),
      });
      expect(legacyRes.status).toBe(201);
      expect(legacyRes.body.event.host).toBe('ingest-local');

      // Older flat shape (ts: epoch millis, worker, level, msg)
      const flatRes = await server.fetchJson('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ts: Date.now(),
          event: 'Task step',
          worker: 'w-jsonl-2',
          level: 'info',
          msg: 'Task step',
        }),
      });
      expect(flatRes.status).toBe(201);
      expect(flatRes.body.event.host).toBe('ingest-local');

      const { metrics } = await server.metrics();
      expect(sampleValue(metrics, 'fabric_event_count', 'ingest-local')).toBe(2);
      expect(sampleValue(metrics, 'fabric_active_workers', 'ingest-local')).toBe(2);
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(1);
    } finally {
      await server.stop();
    }
  });

  it('JSONL files tailed from disk are attributed to the local hostname', async () => {
    // The production wiring: DirectoryTailer → store.add + recordEvent()
    // (src/cli.ts). Legacy file sources carry no host, so their series must
    // be the local hostname.
    vi.stubEnv('HOSTNAME', 'ingest-local');
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-multihost-tailer-'));
    const rawServer = await startServer();
    let tailer: DirectoryTailer | undefined;
    try {
      // Exactly the wiring cli.ts uses for tailer events.
      tailer = new DirectoryTailer({ directory: logDir });
      tailer.on('event', (event: LogEvent) => {
        rawServer.store.add(event);
        rawServer.recordEvent(event.host, event.worker);
      });
      tailer.start();
      await new Promise(resolve => setTimeout(resolve, 150));

      fs.writeFileSync(
        path.join(logDir, 'w-tailed-local.jsonl'),
        JSON.stringify({
          ts: new Date().toISOString(),
          event: 'worker.started',
          worker: 'w-tailed',
          session: 'sess-tailed',
          data: {},
        }) + '\n',
      );

      await waitFor(async () => {
        const { metrics } = await rawServer.metrics();
        // The fresh server already emits a zero-valued local series, so the
        // probe must check the count arrived, not merely that the series exists.
        return (findHostSample(metrics, 'fabric_event_count', 'ingest-local')?.value ?? 0) >= 1;
      }, 'tailed JSONL event to be attributed to the local hostname');

      const { metrics } = await rawServer.metrics();
      expect(sampleValue(metrics, 'fabric_event_count', 'ingest-local')).toBeGreaterThanOrEqual(1);
      expect(sampleValue(metrics, 'fabric_active_workers', 'ingest-local')).toBe(1);
    } finally {
      tailer?.stop();
      await rawServer.stop();
      fs.rmSync(logDir, { recursive: true, force: true });
    }
  });
});

// ─── Label escaping ─────────────────────────────────────────────────────────

describe('multi-host metrics — label escaping', () => {
  const HOSTILE_HOSTS = ['quote"host', 'back\\slash', 'new\nline-host'];

  it('renders hostile host strings as valid, round-trippable label values', () => {
    const metrics = new ServerMetrics();
    for (const host of HOSTILE_HOSTS) metrics.recordEvent(host, 'w-escape');

    const { unparsed, raw } = parsePrometheus(metrics.toPrometheus(metrics.snapshot()));

    // The exposition must stay parseable — an escaped quote or newline in a
    // label must not terminate the sample line early.
    expect(unparsed).toEqual([]);

    const eventCountLines = raw.split('\n').filter(l => l.startsWith('fabric_event_count{'));
    expect(eventCountLines.map(l => l.replace(/ \d+$/, '')).sort()).toEqual([
      'fabric_event_count{host="back\\\\slash"}',
      'fabric_event_count{host="new\\nline-host"}',
      'fabric_event_count{host="quote\\"host"}',
    ]);

    // And the parsed label values round-trip to the original host strings.
    const parsed = parsePrometheus(metrics.toPrometheus(metrics.snapshot())).metrics;
    for (const host of HOSTILE_HOSTS) {
      expect(sampleValue(parsed, 'fabric_event_count', host)).toBe(1);
      expect(sampleValue(parsed, 'fabric_active_workers', host)).toBe(1);
    }
  });

  it('survives the full OTLP → /api/metrics round trip', async () => {
    const server = await startServer();
    try {
      await postOtlp(server, '/v1/logs', otlpLogsPayload(
        { 'needle.host': 'quote"host' },
        [{ attrs: NO_HOST, workerId: 'w-q1' }],
      ));
      await postOtlp(server, '/v1/logs', otlpLogsPayload(
        { 'needle.host': 'back\\slash' },
        [{ attrs: NO_HOST, workerId: 'w-q2' }],
      ));

      const { unparsed, metrics } = await server.metrics();
      expect(unparsed).toEqual([]);
      expect(sampleValue(metrics, 'fabric_event_count', 'quote"host')).toBe(1);
      expect(sampleValue(metrics, 'fabric_event_count', 'back\\slash')).toBe(1);
      // Each hostile host kept its own series — no merging, no line-breakage.
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(2);
    } finally {
      await server.stop();
    }
  });
});

// ─── Per-host separation ────────────────────────────────────────────────────

describe('multi-host metrics — per-host separation (end-to-end)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps identical worker ids and aggregates separate across three ingest sources', async () => {
    vi.stubEnv('HOSTNAME', 'ingest-local');
    const server = await startServer();
    try {
      // host-a via OTLP: 2 events, 1 worker
      await postOtlp(server, '/v1/logs', otlpLogsPayload(
        { 'needle.host': 'sep-host-a' },
        [{ attrs: NO_HOST, workerId: 'w-shared' }, { attrs: NO_HOST, workerId: 'w-shared' }],
      ));
      // host-b via OTLP: 1 event, the SAME worker id — must not merge with host-a
      await postOtlp(server, '/v1/logs', otlpLogsPayload(
        { 'needle.host': 'sep-host-b' },
        [{ attrs: NO_HOST, workerId: 'w-shared' }],
      ));
      // local via legacy JSONL: 2 events, 2 workers
      for (const worker of ['w-l1', 'w-l2']) {
        const res = await server.fetchJson('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ts: new Date().toISOString(),
            event: 'worker.started',
            worker,
            session: `sess-${worker}`,
            data: {},
          }),
        });
        expect(res.status).toBe(201);
      }

      const { metrics } = await server.metrics();

      // Three series each, with exact per-host values.
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(3);
      expect(sampleValue(metrics, 'fabric_event_count', 'sep-host-a')).toBe(2);
      expect(sampleValue(metrics, 'fabric_event_count', 'sep-host-b')).toBe(1);
      expect(sampleValue(metrics, 'fabric_event_count', 'ingest-local')).toBe(2);

      // Identical worker id on two hosts → one worker per host, not 2 on one.
      expect(sampleValue(metrics, 'fabric_active_workers', 'sep-host-a')).toBe(1);
      expect(sampleValue(metrics, 'fabric_active_workers', 'sep-host-b')).toBe(1);
      expect(sampleValue(metrics, 'fabric_active_workers', 'ingest-local')).toBe(2);

      // Rate series exist for every host, and nowhere else.
      for (const host of ['sep-host-a', 'sep-host-b', 'ingest-local']) {
        expect(findHostSample(metrics, 'fabric_ingest_rate_per_second', host)).toBeDefined();
      }

      // Hostless metrics stay unlabeled and single-sample.
      for (const name of ['fabric_status', 'fabric_uptime_seconds', 'fabric_websocket_clients',
        'fabric_dedup_dropped_total', 'fabric_process_resident_memory_bytes']) {
        const samples = metrics.get(name)!.samples;
        expect(samples, name).toHaveLength(1);
        expect(samples[0].labels, name).toEqual({});
      }

      // The local tailer gauge is labeled with the local host only.
      const tailer = metrics.get('fabric_tailer_files_watched')!;
      expect(tailer.samples).toHaveLength(1);
      expect(tailer.samples[0].labels).toEqual({ host: 'ingest-local' });
    } finally {
      await server.stop();
    }
  });
});
