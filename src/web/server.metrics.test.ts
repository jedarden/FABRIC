/**
 * Contract tests for GET /api/metrics (Prometheus text exposition format).
 *
 * docs/metrics.md is the contract: every metric documented there must be
 * emitted with the documented type, the help text shown in the doc's example
 * output, and values that behave as documented — 60s rolling ingest window,
 * per-host series, conditional log-retention metrics. The doc-derived tests
 * pin both drift directions: a metric documented without an implementation,
 * or emitted without documentation, fails here.
 *
 * Host-label resolution: the OTLP attribute precedence (needle.host →
 * service.instance.id → local) is covered by normalizerHostExtraction.test.ts.
 * The metrics-layer fallback — the local hostname used when an event carries
 * no host — and its own precedence (HOSTNAME → HOST → os.hostname()) are
 * pinned here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createWebServer, WebServer } from './server.js';
import { InMemoryEventStore } from '../store.js';
import { ServerMetrics } from '../serverMetrics.js';
import { getLocalHostname } from '../hostname.js';
import { VERSION } from '../index.js';
import { resetCrossReferenceManager } from '../crossReferenceManager.js';
import type { LogEvent } from '../types.js';

// ─── The pinned contract ────────────────────────────────────────────────────
// Metric name suffixes with their Prometheus type and exact HELP text. The
// help strings mirror docs/metrics.md "Example Output", which is the rendered
// form of the contract (the doc's table descriptions are longer prose and are
// not what the endpoint emits).

const CONTRACT: Record<string, { type: string; help: string }> = {
  status: { type: 'gauge', help: 'Server status (1=ok)' },
  uptime_seconds: { type: 'gauge', help: 'Server uptime in seconds' },
  info: { type: 'gauge', help: 'Build info' },
  websocket_clients: { type: 'gauge', help: 'Connected WebSocket clients' },
  dedup_dropped_total: { type: 'counter', help: 'Total duplicate events dropped' },
  process_resident_memory_bytes: { type: 'gauge', help: 'Process RSS in bytes' },
  event_count: { type: 'gauge', help: 'Total events in store by host' },
  ingest_rate_per_second: { type: 'gauge', help: 'Events ingested per second by host (60s window)' },
  active_workers: { type: 'gauge', help: 'Active workers by host' },
  tailer_files_watched: { type: 'gauge', help: 'Log files being watched by host' },
  prune_last_run_timestamp_seconds: { type: 'gauge', help: 'Last prune run attempt (Unix timestamp)' },
  prune_last_success_timestamp_seconds: { type: 'gauge', help: 'Last successful prune run (Unix timestamp)' },
  logs_dir_bytes: { type: 'gauge', help: 'Size of watched logs directory in bytes' },
};

const metricName = (suffix: string): string => `fabric_${suffix}`;

// Emitted only after the corresponding state exists: a prune run stamps the
// timestamps, and a computable logs-directory size sets the byte count. A
// fresh server that has never pruned must not emit them.
const CONDITIONAL_METRICS = [
  'prune_last_run_timestamp_seconds',
  'prune_last_success_timestamp_seconds',
  'logs_dir_bytes',
];

// ─── Prometheus text format parser ──────────────────────────────────────────

interface ParsedSample {
  labels: Record<string, string>;
  value: number;
}

interface ParsedMetric {
  help: string;
  type: string;
  samples: ParsedSample[];
}

interface ParseResult {
  metrics: Map<string, ParsedMetric>;
  /** Sample lines that did not parse — must be empty for a valid exposition. */
  unparsed: string[];
}

function parsePrometheus(text: string): ParseResult {
  const metrics = new Map<string, ParsedMetric>();
  const unparsed: string[] = [];
  let current: ParsedMetric | undefined;

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;

    if (line.startsWith('#')) {
      const help = line.match(/^# HELP (\S+) (.+)$/);
      if (help) {
        current = { help: help[2], type: '', samples: [] };
        metrics.set(help[1], current);
        continue;
      }
      const type = line.match(/^# TYPE (\S+) (\S+)$/);
      if (type) {
        const metric = metrics.get(type[1]);
        if (metric) metric.type = type[2];
        continue;
      }
      continue; // other comments are legal in the exposition format
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
      for (const m of sample[2].matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="([^"]*)"/g)) {
        labels[m[1]] = m[2];
      }
    }
    current.samples.push({ labels, value: parseFloat(sample[3]) });
  }

  return { metrics, unparsed };
}

/** Value of the (single) sample of a metric, optionally matching a host label. */
function sampleValue(metrics: Map<string, ParsedMetric>, name: string, host?: string): number {
  const metric = metrics.get(name);
  expect(metric, `${name} must be emitted`).toBeDefined();
  const sample = metric!.samples.find(s =>
    host === undefined ? Object.keys(s.labels).length === 0 : s.labels.host === host
  );
  expect(sample, `${name} sample ${host !== undefined ? `{host="${host}"}` : '(unlabeled)'}`).toBeDefined();
  return sample!.value;
}

// ─── docs/metrics.md parsers (the doc side of the contract) ────────────────

interface DocMetric {
  name: string;
  type: string;
}

/** (name, type) pairs from the tables under "## Available Metrics". */
function documentedMetrics(): DocMetric[] {
  const doc = fs.readFileSync(new URL('../../docs/metrics.md', import.meta.url), 'utf-8');
  const section = doc.split('## Available Metrics')[1] ?? '';
  const body = section.split('## Example Output')[0] ?? '';
  const metrics: DocMetric[] = [];
  for (const match of body.matchAll(/^\| `([a-z_]+)(?:\{[^}]*\})?` \| (gauge|counter) \|/gm)) {
    metrics.push({ name: match[1], type: match[2] });
  }
  return metrics;
}

/** HELP/TYPE pairs from the doc's single-host example output block. */
function docExampleContract(): Map<string, { help: string; type: string }> {
  const doc = fs.readFileSync(new URL('../../docs/metrics.md', import.meta.url), 'utf-8');
  const anchor = doc.indexOf('**Single-host setup:**');
  const fenceStart = doc.indexOf('```', anchor);
  const fenceEnd = doc.indexOf('```', fenceStart + 3);
  const block = doc.slice(fenceStart + 3, fenceEnd);

  const out = new Map<string, { help: string; type: string }>();
  for (const line of block.split('\n')) {
    const help = line.match(/^# HELP (\S+) (.+)$/);
    if (help) {
      out.set(help[1], { help: help[2], type: '' });
      continue;
    }
    const type = line.match(/^# TYPE (\S+) (\S+)$/);
    if (type) {
      const entry = out.get(type[1]);
      if (entry) entry.type = type[2];
    }
  }
  return out;
}

// ─── Server harness ─────────────────────────────────────────────────────────

const NONEXISTENT_LOG_DIR = path.join(os.tmpdir(), 'fabric-metrics-contract-nonexistent');

interface ServerHandle {
  server: WebServer;
  store: InMemoryEventStore;
  fetchText: (path: string) => Promise<string>;
  fetchApi: (path: string, init?: RequestInit) => Promise<Response>;
  stop: () => Promise<void>;
}

async function startServer(options: { authToken?: string; logDir?: string } = {}): Promise<ServerHandle> {
  const store = new InMemoryEventStore();
  resetCrossReferenceManager();

  const server = createWebServer({
    port: 0, // OS-assigned ephemeral port — a fixed port races parallel workers
    logPath: options.logDir ?? NONEXISTENT_LOG_DIR,
    store,
    ...(options.authToken ? { authToken: options.authToken } : {}),
  });

  await new Promise<void>((resolve) => {
    server.on('start', () => resolve());
    server.start();
  });
  const port = server.getPort();

  return {
    server,
    store,
    fetchApi: (p, init) => fetch(`http://localhost:${port}${p}`, init),
    fetchText: async (p) => await (await fetch(`http://localhost:${port}${p}`)).text(),
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

const createEvent = (overrides: Partial<LogEvent> = {}): LogEvent => ({
  ts: Date.now(),
  worker: 'w-test',
  level: 'info',
  msg: 'Test message',
  ...overrides,
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('GET /api/metrics — documented metric contract', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  const fetchMetrics = async (): Promise<ParseResult> => {
    const server = await startServer();
    try {
      return parsePrometheus(await server.fetchText('/api/metrics'));
    } finally {
      await server.stop();
    }
  };

  it('emits every always-on metric with the pinned type and help text', async () => {
    const { metrics, unparsed } = await fetchMetrics();

    expect(unparsed).toEqual([]);

    for (const [suffix, spec] of Object.entries(CONTRACT)) {
      if (CONDITIONAL_METRICS.includes(suffix)) continue; // fresh server never pruned
      const metric = metrics.get(metricName(suffix));
      expect(metric, `${metricName(suffix)} must be emitted`).toBeDefined();
      expect(metric!.type, `${metricName(suffix)} TYPE`).toBe(spec.type);
      expect(metric!.help, `${metricName(suffix)} HELP`).toBe(spec.help);
      expect(metric!.samples.length, `${metricName(suffix)} sample count`).toBeGreaterThan(0);
    }
  });

  it('omits the retention metrics from a server that has never pruned', async () => {
    const { metrics } = await fetchMetrics();
    for (const suffix of CONDITIONAL_METRICS) {
      expect(metrics.has(metricName(suffix)), `${metricName(suffix)} must be absent`).toBe(false);
    }
  });

  it('emits zero-valued local-host series on a fresh server', async () => {
    const { metrics } = await fetchMetrics();
    const local = getLocalHostname();

    expect(sampleValue(metrics, 'fabric_event_count', local)).toBe(0);
    expect(sampleValue(metrics, 'fabric_active_workers', local)).toBe(0);
    expect(sampleValue(metrics, 'fabric_ingest_rate_per_second', local)).toBe(0);
    expect(sampleValue(metrics, 'fabric_tailer_files_watched', local)).toBe(0);
  });

  it('reports healthy-server values', async () => {
    const { metrics } = await fetchMetrics();

    expect(sampleValue(metrics, 'fabric_status')).toBe(1); // (overloaded → 0 is pinned in server.test.ts)
    expect(sampleValue(metrics, 'fabric_uptime_seconds')).toBeGreaterThanOrEqual(0);
    expect(sampleValue(metrics, 'fabric_websocket_clients')).toBe(0);
    expect(sampleValue(metrics, 'fabric_dedup_dropped_total')).toBe(0);
    expect(sampleValue(metrics, 'fabric_process_resident_memory_bytes')).toBeGreaterThan(0);

    const info = metrics.get('fabric_info')!;
    expect(info.samples).toHaveLength(1);
    expect(info.samples[0].labels).toEqual({ version: VERSION });
    expect(info.samples[0].value).toBe(1);
  });

  it('emits a well-formed exposition: every sample line parses, every metric has HELP+TYPE', async () => {
    const server = await startServer();
    try {
      const text = await server.fetchText('/api/metrics');
      expect(text.endsWith('\n')).toBe(true);

      const { metrics, unparsed } = parsePrometheus(text);
      expect(unparsed).toEqual([]);
      expect(metrics.size).toBeGreaterThan(0);

      for (const [name, metric] of metrics) {
        expect(name.startsWith('fabric_'), name).toBe(true);
        expect(metric.help, `${name} HELP`).toBeTruthy();
        expect(['gauge', 'counter']).toContain(metric.type);
        expect(metric.samples.length, `${name} sample count`).toBeGreaterThan(0);
      }
    } finally {
      await server.stop();
    }
  });
});

describe('docs/metrics.md conformance', () => {
  it('documentation table agrees with the pinned contract (types)', () => {
    const documented = new Map(documentedMetrics().map(d => [d.name, d.type]));
    expect(documented.size).toBeGreaterThan(0);

    for (const [suffix, spec] of Object.entries(CONTRACT)) {
      expect(documented.get(metricName(suffix)), `${metricName(suffix)} in docs/metrics.md`).toBe(spec.type);
    }
    // Both directions: the doc lists exactly what the contract pins.
    expect(documented.size).toBe(Object.keys(CONTRACT).length);
  });

  it('emitted metric set exactly matches docs/metrics.md, with doc types and example help text', async () => {
    const docMetrics = documentedMetrics();
    const example = docExampleContract();
    expect(docMetrics.length).toBeGreaterThan(0);

    // Warm the server so the conditional retention metrics appear: a real
    // logs dir (for logs_dir_bytes) and one prune run (for the timestamps).
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-metrics-contract-'));
    fs.writeFileSync(path.join(logDir, 'w-1.jsonl'), 'x'.repeat(100));

    const server = await startServer({ authToken: 'metrics-contract-token', logDir });
    try {
      const event = createEvent({ host: 'warm-host', worker: 'w-warm' });
      server.store.add(event);
      server.server.recordEvent(event.host, event.worker);

      const pruneRes = await server.fetchApi('/api/retention/prune', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer metrics-contract-token' },
        body: JSON.stringify({ dryRun: true }),
      });
      expect(pruneRes.status).toBe(200);

      const { metrics } = parsePrometheus(await server.fetchText('/api/metrics'));
      const emitted = new Set(metrics.keys());
      const documented = new Set(docMetrics.map(d => d.name));

      // No undocumented emission, no unimplemented documentation.
      expect([...emitted].filter(name => !documented.has(name))).toEqual([]);
      expect([...documented].filter(name => !emitted.has(name))).toEqual([]);

      for (const d of docMetrics) {
        expect(metrics.get(d.name)!.type, `${d.name} TYPE vs doc table`).toBe(d.type);
      }

      // HELP text matches the doc's rendered example output.
      expect(example.size).toBeGreaterThan(0);
      for (const [name, spec] of example) {
        expect(metrics.get(name)?.help, `${name} HELP vs doc example`).toBe(spec.help);
        expect(metrics.get(name)?.type, `${name} TYPE vs doc example`).toBe(spec.type);
      }
    } finally {
      await server.stop();
      fs.rmSync(logDir, { recursive: true, force: true });
    }
  });
});

describe('host labels (multi-host)', () => {
  it('splits event/worker/rate series per host and keeps hostless metrics unlabeled', async () => {
    const server = await startServer();
    try {
      for (const overrides of [
        { host: 'host-a', worker: 'w-a1' },
        { host: 'host-a', worker: 'w-a2' },
        { host: 'host-b', worker: 'w-b1' },
      ]) {
        const event = createEvent(overrides);
        server.store.add(event);
        server.server.recordEvent(event.host, event.worker);
      }

      const { metrics } = parsePrometheus(await server.fetchText('/api/metrics'));

      // Two series each, exact per-host values.
      expect(metrics.get('fabric_event_count')!.samples).toHaveLength(2);
      expect(sampleValue(metrics, 'fabric_event_count', 'host-a')).toBe(2);
      expect(sampleValue(metrics, 'fabric_event_count', 'host-b')).toBe(1);

      // Active workers = distinct worker ids observed per host.
      expect(metrics.get('fabric_active_workers')!.samples).toHaveLength(2);
      expect(sampleValue(metrics, 'fabric_active_workers', 'host-a')).toBe(2);
      expect(sampleValue(metrics, 'fabric_active_workers', 'host-b')).toBe(1);

      // Ingest-rate series exist for both hosts (values are window-dependent).
      for (const host of ['host-a', 'host-b']) {
        const metric = metrics.get('fabric_ingest_rate_per_second')!;
        expect(metric.samples.find(s => s.labels.host === host), `ingest rate for ${host}`).toBeDefined();
      }

      // Hostless metrics stay unlabeled — the multi-host labels must not leak.
      for (const name of ['fabric_status', 'fabric_uptime_seconds', 'fabric_websocket_clients',
        'fabric_dedup_dropped_total', 'fabric_process_resident_memory_bytes']) {
        const samples = metrics.get(name)!.samples;
        expect(samples, name).toHaveLength(1);
        expect(samples[0].labels, name).toEqual({});
      }
    } finally {
      await server.stop();
    }
  });

  it('keeps tailer_files_watched visible (local host only) when all traffic is remote', async () => {
    // docs/metrics.md multi-host example: a fleet collector whose series all
    // carry remote host labels must still expose the local tailer gauge.
    const server = await startServer();
    try {
      const event = createEvent({ host: 'remote-host', worker: 'w-remote' });
      server.store.add(event);
      server.server.recordEvent(event.host, event.worker);

      const { metrics } = parsePrometheus(await server.fetchText('/api/metrics'));

      // The local host has ingested nothing: no local event_count series.
      expect(metrics.get('fabric_event_count')!.samples.find(s => s.labels.host === getLocalHostname())).toBeUndefined();

      const tailer = metrics.get('fabric_tailer_files_watched')!;
      expect(tailer.samples).toHaveLength(1);
      expect(tailer.samples[0].labels).toEqual({ host: getLocalHostname() });
      expect(tailer.samples[0].value).toBe(0);
    } finally {
      await server.stop();
    }
  });
});

describe('local host resolution precedence', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolves HOSTNAME, then HOST, then os.hostname()', () => {
    vi.stubEnv('HOSTNAME', 'metrics-hostname-env');
    vi.stubEnv('HOST', 'metrics-host-env');
    expect(getLocalHostname()).toBe('metrics-hostname-env');

    vi.stubEnv('HOSTNAME', undefined);
    expect(getLocalHostname()).toBe('metrics-host-env');

    vi.stubEnv('HOST', undefined);
    expect(getLocalHostname()).toBe(os.hostname());
  });

  it('attributes hostless events to the resolved local hostname; an explicit host wins', () => {
    vi.stubEnv('HOSTNAME', 'metrics-local-host');
    const metrics = new ServerMetrics();
    metrics.recordEvent(undefined, 'w-local-1');
    metrics.recordEvent(undefined, 'w-local-2');
    metrics.recordEvent('remote-host', 'w-remote');

    const { metrics: parsed } = parsePrometheus(metrics.toPrometheus(metrics.snapshot()));

    expect(sampleValue(parsed, 'fabric_event_count', 'metrics-local-host')).toBe(2);
    expect(sampleValue(parsed, 'fabric_event_count', 'remote-host')).toBe(1);
    expect(sampleValue(parsed, 'fabric_active_workers', 'metrics-local-host')).toBe(2);
    // The tailer gauge is always labeled with the *current* local hostname.
    expect(sampleValue(parsed, 'fabric_tailer_files_watched', 'metrics-local-host')).toBe(0);
  });
});

describe('ingest rate (60-second rolling window)', () => {
  const T0 = 1_700_000_000_000;

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('is 0 with no events and with a single event (needs ≥2 samples)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const metrics = new ServerMetrics();

    expect(metrics.snapshot().ingest_rate_per_sec).toBe(0);

    metrics.recordEvent('h', 'w');
    expect(metrics.snapshot().ingest_rate_per_sec).toBe(0);
  });

  it('divides sample count by elapsed span, rounded to 2 decimals', () => {
    vi.useFakeTimers();
    const metrics = new ServerMetrics();

    // 10 events at 1s intervals; snapshot right after the last one.
    for (let i = 0; i < 10; i++) {
      vi.setSystemTime(T0 + i * 1000);
      metrics.recordEvent('h', 'w');
    }
    // span = 9s, count = 10 → 1.111… → 1.11
    expect(metrics.snapshot().ingest_rate_per_sec).toBe(1.11);
  });

  it('drops events older than 60s from the window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const metrics = new ServerMetrics();

    vi.setSystemTime(T0);
    metrics.recordEvent('h', 'w');
    vi.setSystemTime(T0 + 1_000);
    metrics.recordEvent('h', 'w');
    vi.setSystemTime(T0 + 30_000);
    metrics.recordEvent('h', 'w');
    metrics.recordEvent('h', 'w');
    // 4 samples over a 30s span → 0.1333… → 0.13
    expect(metrics.snapshot().ingest_rate_per_sec).toBe(0.13);

    // At +61s the cutoff is +1s: the first event sits exactly on the cutoff
    // and stays; 3 samples over a 60s span → 0.05
    vi.setSystemTime(T0 + 61_000);
    expect(metrics.snapshot().ingest_rate_per_sec).toBe(0.05);

    // At +90s every sample is older than 60s → 0, not a division artifact
    vi.setSystemTime(T0 + 90_001);
    expect(metrics.snapshot().ingest_rate_per_sec).toBe(0);
  });

  it('computes per-host rates independently over each host’s own window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const metrics = new ServerMetrics();

    // quiet-host: 2 events at t=0/0.5s — old at snapshot time.
    vi.setSystemTime(T0);
    metrics.recordEvent('quiet-host', 'wq1');
    vi.setSystemTime(T0 + 500);
    metrics.recordEvent('quiet-host', 'wq2');
    // busy-host: 3 events clustered at t=58–59s.
    vi.setSystemTime(T0 + 58_000);
    metrics.recordEvent('busy-host', 'wb1');
    vi.setSystemTime(T0 + 58_500);
    metrics.recordEvent('busy-host', 'wb2');
    vi.setSystemTime(T0 + 59_000);
    metrics.recordEvent('busy-host', 'wb3');

    const at59s = parsePrometheus(metrics.toPrometheus(metrics.snapshot()));
    // busy-host: 3 samples over 1s → 3; quiet-host: 2 samples over 59s → 0.03
    expect(sampleValue(at59s.metrics, 'fabric_ingest_rate_per_second', 'busy-host')).toBe(3);
    expect(sampleValue(at59s.metrics, 'fabric_ingest_rate_per_second', 'quiet-host')).toBe(0.03);
    // The global rate spans all hosts: 5 samples over 59s → 0.08
    expect(metrics.snapshot().ingest_rate_per_sec).toBe(0.08);

    // Past the quiet host's window its rate is 0 while busy-host keeps counting.
    vi.setSystemTime(T0 + 61_000);
    const at61s = parsePrometheus(metrics.toPrometheus(metrics.snapshot()));
    expect(sampleValue(at61s.metrics, 'fabric_ingest_rate_per_second', 'quiet-host')).toBe(0);
    // busy-host: 3 samples over 3s → 1
    expect(sampleValue(at61s.metrics, 'fabric_ingest_rate_per_second', 'busy-host')).toBe(1);
  });
});

describe('log retention metrics', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('are omitted while unset, and treat 0 as "never"', () => {
    const fresh = new ServerMetrics();
    let parsed = parsePrometheus(fresh.toPrometheus(fresh.snapshot())).metrics;
    for (const suffix of CONDITIONAL_METRICS) {
      expect(parsed.has(metricName(suffix)), `${metricName(suffix)} unset → absent`).toBe(false);
    }

    // snapshot() maps 0 → undefined: a zero stamp means "never happened".
    fresh.pruneLastRunTimestamp = 0;
    fresh.pruneLastSuccessTimestamp = 0;
    fresh.logsDirBytes = 0;
    parsed = parsePrometheus(fresh.toPrometheus(fresh.snapshot())).metrics;
    for (const suffix of CONDITIONAL_METRICS) {
      expect(parsed.has(metricName(suffix)), `${metricName(suffix)} 0 → absent`).toBe(false);
    }
  });

  it('emit exact values once set, with gauge type and pinned help', () => {
    const metrics = new ServerMetrics();
    metrics.pruneLastRunTimestamp = 1_720_123_456;
    metrics.pruneLastSuccessTimestamp = 1_720_123_999;
    metrics.logsDirBytes = 52_428_800;

    const parsed = parsePrometheus(metrics.toPrometheus(metrics.snapshot())).metrics;

    expect(sampleValue(parsed, 'fabric_prune_last_run_timestamp_seconds')).toBe(1_720_123_456);
    expect(sampleValue(parsed, 'fabric_prune_last_success_timestamp_seconds')).toBe(1_720_123_999);
    expect(sampleValue(parsed, 'fabric_logs_dir_bytes')).toBe(52_428_800);

    for (const suffix of CONDITIONAL_METRICS) {
      expect(parsed.get(metricName(suffix))!.type).toBe(CONTRACT[suffix].type);
      expect(parsed.get(metricName(suffix))!.help).toBe(CONTRACT[suffix].help);
    }
  });
});

describe('log retention metrics over HTTP', () => {
  const TOKEN = 'metrics-contract-token';
  let logDir: string;

  beforeEach(() => {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-metrics-contract-'));
    fs.writeFileSync(path.join(logDir, 'w-1.jsonl'), 'x'.repeat(100));
  });

  afterEach(() => {
    fs.rmSync(logDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('reports the watched directory size and stamps a successful prune run', async () => {
    const server = await startServer({ authToken: TOKEN, logDir });
    try {
      const before = parsePrometheus(await server.fetchText('/api/metrics')).metrics;
      // computeDirSize sums file sizes (the archive/ subdir is excluded) —
      // exactly the one 100-byte file written above.
      expect(sampleValue(before, 'fabric_logs_dir_bytes')).toBe(100);
      expect(before.has('fabric_prune_last_run_timestamp_seconds')).toBe(false);

      const secBefore = Date.now() / 1000;
      const res = await server.fetchApi('/api/retention/prune', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ dryRun: true }),
      });
      expect(res.status).toBe(200);
      const secAfter = Date.now() / 1000;

      const after = parsePrometheus(await server.fetchText('/api/metrics')).metrics;
      const lastRun = sampleValue(after, 'fabric_prune_last_run_timestamp_seconds');
      const lastSuccess = sampleValue(after, 'fabric_prune_last_success_timestamp_seconds');
      expect(lastRun).toBeGreaterThanOrEqual(secBefore);
      expect(lastRun).toBeLessThanOrEqual(secAfter);
      // The dry run completed, so run and success carry the same stamp.
      expect(lastSuccess).toBe(lastRun);
    } finally {
      await server.stop();
    }
  });
});
