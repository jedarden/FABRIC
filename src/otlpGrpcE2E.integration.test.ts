/**
 * E2E OTLP/gRPC Integration Test
 *
 * The gRPC counterpart of otlpE2E.integration.test.ts (which only exercises
 * the OTLP/HTTP listener). Mirrors the `fabric web --otlp-grpc :4317` wiring
 * from cli.ts: a real gRPC client sends all three supported OTLP signals
 * (logs, traces, metrics) to an OtlpGrpcReceiver whose events flow through
 * the shared deduplicator into the InMemoryEventStore and the web server,
 * and the resulting worker state is asserted through the HTTP API.
 *
 * Also covers receiver shutdown behavior (stop is graceful, idempotent, and
 * refuses further exports; a stopped receiver can be restarted) and the
 * Bearer-token auth contract — the gRPC mirror of the web server's POST
 * auth middleware, which already guards the OTLP/HTTP receiver.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as grpc from '@grpc/grpc-js';
import { createWebServer } from './web/server.js';
import { InMemoryEventStore } from './store.js';
import { EventDeduplicator } from './normalizer.js';
import { OtlpGrpcReceiver, loadProtoRoot } from './otlpGrpcReceiver.js';
import { LogEvent } from './types.js';
import * as protobuf from 'protobufjs';

// ── gRPC service paths ────────────────────────────────────────

const LOGS_PATH = '/opentelemetry.proto.collector.logs.v1.LogsService/Export';
const TRACE_PATH = '/opentelemetry.proto.collector.trace.v1.TraceService/Export';
const METRICS_PATH = '/opentelemetry.proto.collector.metrics.v1.MetricsService/Export';

const LOGS_REQUEST = 'opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest';
const LOGS_RESPONSE = 'opentelemetry.proto.collector.logs.v1.ExportLogsServiceResponse';
const TRACE_REQUEST = 'opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest';
const TRACE_RESPONSE = 'opentelemetry.proto.collector.trace.v1.ExportTraceServiceResponse';
const METRICS_REQUEST = 'opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest';
const METRICS_RESPONSE = 'opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceResponse';

// ── Payload helpers ───────────────────────────────────────────

const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });
const intAttr = (key: string, value: number) => ({ key, value: { intValue: value } });

function stateTransitionRecord(workerId: string, sessionId: string, seq: number, from: string, to: string) {
  return {
    timeUnixNano: String(Date.now() * 1_000_000),
    attributes: [
      attr('event_type', 'worker.state_transition'),
      attr('needle.worker.id', workerId),
      attr('needle.session.id', sessionId),
      intAttr('needle.sequence', seq),
      attr('from', from),
      attr('to', to),
    ],
  };
}

function logRecordWith(attrs: Array<Record<string, unknown>>) {
  return {
    timeUnixNano: String(Date.now() * 1_000_000),
    attributes: attrs,
  };
}

// ── gRPC client helpers ───────────────────────────────────────

let protoRoot: protobuf.Root;

interface ExportResult {
  error: grpc.ServiceError | null;
  response: Record<string, unknown> | null;
}

function makeClient(port: number): grpc.Client {
  return new grpc.Client(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
}

/** One unary Export call; resolves with the error (if any) instead of throwing. */
async function exportCall(
  client: grpc.Client,
  methodPath: string,
  requestFqn: string,
  responseFqn: string,
  payload: Record<string, unknown>,
  metadata?: grpc.Metadata,
): Promise<ExportResult> {
  const reqType = protoRoot.lookupType(requestFqn);
  const resType = protoRoot.lookupType(responseFqn);

  return new Promise<ExportResult>((resolve) => {
    client.makeUnaryRequest(
      methodPath,
      (msg: any) => Buffer.from(reqType.encode(reqType.create(msg)).finish()),
      (buf: Buffer) =>
        resType.toObject(resType.decode(new Uint8Array(buf)), {
          longs: String,
          defaults: true,
        }) as Record<string, unknown>,
      payload,
      metadata ?? new grpc.Metadata(),
      (err: grpc.ServiceError | null, resp: Record<string, unknown> | undefined) => {
        resolve({ error: err, response: resp ?? null });
      },
    );
  });
}

async function exportLogs(
  client: grpc.Client,
  logRecords: Array<Record<string, unknown>>,
  metadata?: grpc.Metadata,
): Promise<ExportResult> {
  return exportCall(client, LOGS_PATH, LOGS_REQUEST, LOGS_RESPONSE, {
    resourceLogs: [{ scopeLogs: [{ logRecords }] }],
  }, metadata);
}

async function exportTrace(
  client: grpc.Client,
  span: Record<string, unknown>,
  metadata?: grpc.Metadata,
): Promise<ExportResult> {
  return exportCall(client, TRACE_PATH, TRACE_REQUEST, TRACE_RESPONSE, {
    resourceSpans: [{ scopeSpans: [{ spans: [span] }] }],
  }, metadata);
}

async function exportMetrics(
  client: grpc.Client,
  metric: Record<string, unknown>,
  metadata?: grpc.Metadata,
): Promise<ExportResult> {
  return exportCall(client, METRICS_PATH, METRICS_REQUEST, METRICS_RESPONSE, {
    resourceMetrics: [{ scopeMetrics: [{ metrics: [metric] }] }],
  }, metadata);
}

/** Poll until probe returns a truthy value, for API-state assertions. */
async function waitFor<T>(
  probe: () => T | undefined | null | Promise<T | undefined | null>,
  timeoutMs = 4000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await probe();
    if (v) return v as T;
    if (Date.now() > deadline) throw new Error('waitFor: condition not met within timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
}

// ── API response types ────────────────────────────────────────

interface Worker {
  id: string;
  needleState: string;
  status: string;
  [key: string]: unknown;
}

interface HealthResponse {
  dedup_dropped: number;
  [key: string]: unknown;
}

// ── Signal coverage: gRPC → receiver → store → web API ───────

describe('OTLP/gRPC E2E: receiver feeds the web API', () => {
  let server: ReturnType<typeof createWebServer>;
  let store: InMemoryEventStore;
  let deduplicator: EventDeduplicator;
  let receiver: OtlpGrpcReceiver;
  let grpcPort: number;
  let baseUrl: string;

  beforeAll(async () => {
    protoRoot = await loadProtoRoot();
    store = new InMemoryEventStore();
    deduplicator = new EventDeduplicator();

    server = createWebServer({
      port: 0,
      logPath: '/tmp/fabric-grpc-e2e-logs',
      store,
      deduplicator,
    });
    await server.start();
    baseUrl = `http://127.0.0.1:${server.getPort()}`;

    // Same wiring as cli.ts `web --otlp-grpc`: receiver events go into the
    // store, the per-host series, and the WebSocket broadcast.
    receiver = new OtlpGrpcReceiver({ address: '127.0.0.1:0', deduplicator });
    receiver.on('event', (event: LogEvent) => {
      store.add(event);
      server.recordEvent(event.host, event.worker);
      server.broadcast(event);
    });
    const boundAddr = await receiver.start();
    grpcPort = parseInt(boundAddr.split(':')[1], 10);
    expect(grpcPort).toBeGreaterThan(0);
  });

  afterAll(async () => {
    await receiver.stop();
    await new Promise<void>((resolve) => {
      server.on('stop', () => resolve());
      server.stop();
    });
  });

  it('LogsService/Export: worker.state_transition + worker.started create a worker in the API', async () => {
    const workerId = `grpc-e2e-logs-${Date.now()}`;
    const sessionId = `grpc-e2e-sess-logs-${Date.now()}`;
    const client = makeClient(grpcPort);

    const t1 = await exportLogs(client, [
      stateTransitionRecord(workerId, sessionId, 1, 'BOOTING', 'SELECTING'),
    ]);
    expect(t1.error).toBeNull();

    const t2 = await exportLogs(client, [
      logRecordWith([
        attr('event_type', 'worker.started'),
        attr('needle.worker.id', workerId),
        attr('needle.session.id', sessionId),
        intAttr('needle.sequence', 2),
        attr('provider', 'anthropic'),
        attr('model', 'claude-opus-4-8'),
      ]),
    ]);
    expect(t2.error).toBeNull();
    client.close();

    const worker = await waitFor(async () => {
      const res = await fetch(`${baseUrl}/api/workers`);
      expect(res.status).toBe(200);
      const workers = (await res.json()) as Worker[];
      return workers.find((w) => w.id === workerId);
    });
    expect(worker.needleState).toBeDefined();
    expect(worker.needleState).not.toBe('STOPPED');
  });

  it('TraceService/Export: bead_execution span marks the worker active and emits start+end events', async () => {
    const workerId = `grpc-e2e-span-${Date.now()}`;
    const sessionId = `grpc-e2e-sess-span-${Date.now()}`;
    const beadId = `fabric-grpc-e2e-${Date.now()}`;
    const client = makeClient(grpcPort);

    // Receiver contract: a span with startTimeUnixNano produces both a
    // span-end and a span-start event.
    const spanEvents: LogEvent[] = [];
    const listener = (event: LogEvent) => spanEvents.push(event);
    receiver.on('event', listener);

    // Establish the worker first (same sequence as the HTTP E2E).
    const t0 = await exportLogs(client, [
      stateTransitionRecord(workerId, sessionId, 1, 'BOOTING', 'WORKING'),
    ]);
    expect(t0.error).toBeNull();

    const span = {
      traceId: 'grpc-e2e-trace-1',
      spanId: 'grpc-e2e-span-1',
      name: 'bead_execution',
      startTimeUnixNano: String((Date.now() - 500) * 1_000_000),
      endTimeUnixNano: String(Date.now() * 1_000_000),
      attributes: [
        attr('needle.worker.id', workerId),
        attr('needle.session.id', sessionId),
        intAttr('needle.sequence', 2),
        attr('needle.bead.id', beadId),
      ],
    };
    const t1 = await exportTrace(client, span);
    expect(t1.error).toBeNull();
    client.close();

    // Both span events reached the event bus, attributed to the worker.
    await waitFor(() => (spanEvents.length >= 2 ? spanEvents : undefined));
    expect(spanEvents.every((e) => e.worker === workerId)).toBe(true);

    const worker = await waitFor(async () => {
      const res = await fetch(`${baseUrl}/api/workers`);
      expect(res.status).toBe(200);
      const workers = (await res.json()) as Worker[];
      return workers.find((w) => w.id === workerId);
    });
    expect(worker.needleState).not.toBe('STOPPED');
    expect(worker.status).toBe('active');
  });

  it('MetricsService/Export: tokens.used gauge is accepted and the worker stays present', async () => {
    const workerId = `grpc-e2e-metric-${Date.now()}`;
    const sessionId = `grpc-e2e-sess-metric-${Date.now()}`;
    const client = makeClient(grpcPort);

    const t0 = await exportLogs(client, [
      stateTransitionRecord(workerId, sessionId, 1, 'BOOTING', 'WORKING'),
    ]);
    expect(t0.error).toBeNull();

    const t1 = await exportMetrics(client, {
      name: 'tokens.used',
      gauge: {
        dataPoints: [
          {
            timeUnixNano: String(Date.now() * 1_000_000),
            asDouble: 12345.0,
            attributes: [
              attr('needle.worker.id', workerId),
              attr('needle.session.id', sessionId),
              attr('provider', 'anthropic'),
              attr('model', 'claude-opus-4-8'),
            ],
          },
        ],
      },
    });
    expect(t1.error).toBeNull();
    client.close();

    const worker = await waitFor(async () => {
      const res = await fetch(`${baseUrl}/api/workers`);
      expect(res.status).toBe(200);
      const workers = (await res.json()) as Worker[];
      return workers.find((w) => w.id === workerId);
    });
    expect(worker.needleState).not.toBe('STOPPED');
  });

  it('All three signals through the shared deduplicator keep /api/health reporting dedup_dropped', async () => {
    const workerId = `grpc-e2e-dedup-${Date.now()}`;
    const sessionId = `grpc-e2e-sess-dedup-${Date.now()}`;
    const client = makeClient(grpcPort);

    const beforeRes = await fetch(`${baseUrl}/api/health`);
    const before = (await beforeRes.json()) as HealthResponse;
    expect(typeof before.dedup_dropped).toBe('number');

    // Same record twice — the second must be dropped by the deduplicator
    // shared between the receiver and the web server (cli.ts wiring).
    const duplicate = stateTransitionRecord(workerId, sessionId, 7, 'BOOTING', 'SELECTING');
    const t1 = await exportLogs(client, [duplicate]);
    expect(t1.error).toBeNull();
    const t2 = await exportLogs(client, [duplicate]);
    expect(t2.error).toBeNull();
    client.close();

    await waitFor(async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      const health = (await res.json()) as HealthResponse;
      return health.dedup_dropped > before.dedup_dropped ? health : undefined;
    });
  });
});

// ── Shutdown behavior ─────────────────────────────────────────

describe('OTLP/gRPC receiver shutdown behavior', () => {
  it('stop() is graceful, refuses further exports, is idempotent, and the receiver can restart', async () => {
    protoRoot = await loadProtoRoot();
    const events: LogEvent[] = [];
    const receiver = new OtlpGrpcReceiver({ address: '127.0.0.1:0' });
    receiver.on('event', (event: LogEvent) => events.push(event));

    // stop() before start() resolves without throwing.
    await expect(receiver.stop()).resolves.toBeUndefined();

    const boundAddr = await receiver.start();
    const port = parseInt(boundAddr.split(':')[1], 10);
    expect(port).toBeGreaterThan(0);

    const client = makeClient(port);
    const alive = await exportLogs(client, [
      logRecordWith([
        attr('event_type', 'worker.started'),
        attr('needle.worker.id', 'grpc-shutdown-probe'),
        attr('needle.session.id', 'grpc-shutdown-sess'),
        intAttr('needle.sequence', 1),
      ]),
    ]);
    expect(alive.error).toBeNull();
    await waitFor(() => (events.length >= 1 ? events : undefined));

    // Graceful stop while a client is still connected.
    await expect(receiver.stop()).resolves.toBeUndefined();

    // The same port no longer accepts exports.
    const afterStop = await exportLogs(client, [
      logRecordWith([attr('event_type', 'worker.started'), attr('needle.worker.id', 'grpc-after-stop')]),
    ]);
    client.close();
    expect(afterStop.error).not.toBeNull();
    expect(afterStop.error!.code).toBe(grpc.status.UNAVAILABLE);
    expect(events.every((e) => e.worker !== 'grpc-after-stop')).toBe(true);

    // Idempotent: a second stop() resolves.
    await expect(receiver.stop()).resolves.toBeUndefined();

    // A stopped receiver can be started again and serve exports.
    const rebound = await receiver.start();
    const newPort = parseInt(rebound.split(':')[1], 10);
    expect(newPort).toBeGreaterThan(0);
    const client2 = makeClient(newPort);
    const afterRestart = await exportLogs(client2, [
      logRecordWith([
        attr('event_type', 'worker.started'),
        attr('needle.worker.id', 'grpc-after-restart'),
        attr('needle.session.id', 'grpc-restart-sess'),
        intAttr('needle.sequence', 1),
      ]),
    ]);
    expect(afterRestart.error).toBeNull();
    await waitFor(() => (events.some((e) => e.worker === 'grpc-after-restart') ? true : undefined));
    client2.close();
    await receiver.stop();
  });
});

// ── Authentication ────────────────────────────────────────────

describe('OTLP/gRPC receiver authentication', () => {
  const TOKEN = 'grpc-e2e-secret-token';
  let receiver: OtlpGrpcReceiver;
  let grpcPort: number;
  let events: LogEvent[];

  function startAuthedReceiver(): Promise<void> {
    events = [];
    receiver = new OtlpGrpcReceiver({ address: '127.0.0.1:0', authToken: TOKEN });
    receiver.on('event', (event: LogEvent) => events.push(event));
    return receiver.start().then((boundAddr) => {
      grpcPort = parseInt(boundAddr.split(':')[1], 10);
    });
  }

  afterEach(async () => {
    await receiver?.stop();
  });

  it('rejects an export with no authorization metadata (UNAUTHENTICATED, nothing ingested)', async () => {
    await startAuthedReceiver();
    const client = makeClient(grpcPort);
    const result = await exportLogs(client, [
      logRecordWith([attr('event_type', 'worker.started'), attr('needle.worker.id', 'grpc-unauth')]),
    ]);
    client.close();

    expect(result.error).not.toBeNull();
    expect(result.error!.code).toBe(grpc.status.UNAUTHENTICATED);
    await new Promise((r) => setTimeout(r, 100));
    expect(events).toHaveLength(0);
  });

  it('rejects a wrong token (UNAUTHENTICATED, nothing ingested)', async () => {
    await startAuthedReceiver();
    const md = new grpc.Metadata();
    md.set('authorization', 'Bearer not-the-token');
    const client = makeClient(grpcPort);
    const result = await exportLogs(client, [
      logRecordWith([attr('event_type', 'worker.started'), attr('needle.worker.id', 'grpc-wrong-token')]),
    ], md);
    client.close();

    expect(result.error).not.toBeNull();
    expect(result.error!.code).toBe(grpc.status.UNAUTHENTICATED);
    await new Promise((r) => setTimeout(r, 100));
    expect(events).toHaveLength(0);
  });

  it('accepts the correct Bearer token and ingests the record', async () => {
    await startAuthedReceiver();
    const md = new grpc.Metadata();
    md.set('authorization', `Bearer ${TOKEN}`);
    const client = makeClient(grpcPort);
    const result = await exportLogs(client, [
      logRecordWith([
        attr('event_type', 'worker.started'),
        attr('needle.worker.id', 'grpc-authed-worker'),
        attr('needle.session.id', 'grpc-authed-sess'),
        intAttr('needle.sequence', 1),
      ]),
    ], md);
    client.close();

    expect(result.error).toBeNull();
    const event = await waitFor(() => events.find((e) => e.worker === 'grpc-authed-worker'));
    expect(event.msg).toBe('worker.started');
  });

  it('enforces the token on every Export service (traces and metrics too)', async () => {
    await startAuthedReceiver();
    const client = makeClient(grpcPort);

    const traceResult = await exportTrace(client, {
      traceId: 'grpc-auth-trace',
      spanId: 'grpc-auth-span',
      name: 'bead_execution',
      startTimeUnixNano: String(Date.now() * 1_000_000),
    });
    expect(traceResult.error).not.toBeNull();
    expect(traceResult.error!.code).toBe(grpc.status.UNAUTHENTICATED);

    const metricsResult = await exportMetrics(client, {
      name: 'tokens.used',
      gauge: { dataPoints: [{ timeUnixNano: String(Date.now() * 1_000_000), asDouble: 1 }] },
    });
    client.close();
    expect(metricsResult.error).not.toBeNull();
    expect(metricsResult.error!.code).toBe(grpc.status.UNAUTHENTICATED);

    await new Promise((r) => setTimeout(r, 100));
    expect(events).toHaveLength(0);
  });

  it('without a configured token the receiver stays open (tui/logs back-compat)', async () => {
    events = [];
    receiver = new OtlpGrpcReceiver({ address: '127.0.0.1:0' });
    receiver.on('event', (event: LogEvent) => events.push(event));
    const boundAddr = await receiver.start();
    grpcPort = parseInt(boundAddr.split(':')[1], 10);

    const client = makeClient(grpcPort);
    const result = await exportLogs(client, [
      logRecordWith([
        attr('event_type', 'worker.started'),
        attr('needle.worker.id', 'grpc-open-worker'),
        attr('needle.session.id', 'grpc-open-sess'),
        intAttr('needle.sequence', 1),
      ]),
    ]);
    client.close();

    expect(result.error).toBeNull();
    const event = await waitFor(() => events.find((e) => e.worker === 'grpc-open-worker'));
    expect(event.msg).toBe('worker.started');
  });
});
