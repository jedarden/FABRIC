/**
 * FABRIC OTLP/gRPC Receiver
 *
 * Accepts OTLP/gRPC streams on a configurable address (default 0.0.0.0:4317),
 * decodes protobuf payloads, and feeds decoded records into the normalizer
 * pipeline so they appear alongside JSONL-sourced events.
 *
 * Terminates all three OTLP collector services:
 *   - LogsService/Export
 *   - TraceService/Export
 *   - MetricsService/Export
 */

import * as grpc from '@grpc/grpc-js';
import * as protobuf from 'protobufjs';
import { fileURLToPath } from 'url';
import * as path from 'path';
import { normalizeToLogEvent, NormalizerSource, EventDeduplicator } from './normalizer.js';
import { LogEvent } from './types.js';
import { EventEmitter } from 'events';

// ── Proto loading ─────────────────────────────────────────────

let protoRoot: protobuf.Root | null = null;

export async function loadProtoRoot(): Promise<protobuf.Root> {
  if (protoRoot) return protoRoot;

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // dist/ in production, src/ during dev — both have the same relative layout
  const protoBase = path.resolve(__dirname, '..', 'protos');

  const root = new protobuf.Root();
  // Proto import paths like "opentelemetry/proto/logs/v1/logs.proto" need to
  // resolve from the protos/ root, not relative to the importing file.
  root.resolvePath = function (originPath, importPath) {
    if (importPath.startsWith('opentelemetry/')) {
      return path.join(protoBase, importPath);
    }
    return protobuf.util.path.resolve(originPath, importPath);
  };

  await protobuf.load(
    path.join(protoBase, 'opentelemetry', 'proto', 'collector', 'logs', 'v1', 'logs_service.proto'),
    root,
  );
  await protobuf.load(
    path.join(protoBase, 'opentelemetry', 'proto', 'collector', 'trace', 'v1', 'trace_service.proto'),
    root,
  );
  await protobuf.load(
    path.join(protoBase, 'opentelemetry', 'proto', 'collector', 'metrics', 'v1', 'metrics_service.proto'),
    root,
  );

  protoRoot = root;

  return protoRoot;
}

// ── Helpers ───────────────────────────────────────────────────

function lookupType(root: protobuf.Root, fqn: string): protobuf.Type {
  const t = root.lookupType(fqn);
  if (!t) throw new Error(`protobuf type not found: ${fqn}`);
  return t;
}

/** proto-loader-style plain-object conversion (camelCase, longs→String) */
const DECODE_OPTS: protobuf.IConversionOptions = {
  longs: String,
  enums: String,
  bytes: String,
  defaults: true,
  oneofs: true,
};

/** Build a grpc.MethodDefinition for a single unary Export RPC. */
function makeMethod(
  root: protobuf.Root,
  servicePath: string,
  requestFqn: string,
  responseFqn: string,
): grpc.MethodDefinition<any, any> {
  const reqType = lookupType(root, requestFqn);
  const resType = lookupType(root, responseFqn);
  return {
    path: servicePath,
    requestStream: false,
    responseStream: false,
    requestSerialize: (msg: any) =>
      Buffer.from(reqType.encode(reqType.create(msg)).finish()),
    requestDeserialize: (buf: Buffer) =>
      reqType.toObject(reqType.decode(new Uint8Array(buf)), DECODE_OPTS) as any,
    responseSerialize: (msg: any) =>
      Buffer.from(resType.encode(resType.create(msg)).finish()),
    responseDeserialize: (buf: Buffer) =>
      resType.toObject(resType.decode(new Uint8Array(buf)), DECODE_OPTS) as any,
  };
}

// ── Receiver class ────────────────────────────────────────────

export interface OtlpGrpcReceiverOptions {
  /** Bind address, e.g. "0.0.0.0:4317" or ":4317". Default ":4317". */
  address?: string;

  /** Shared deduplicator for cross-source dedup (JSONL + OTLP). */
  deduplicator?: EventDeduplicator;
}

export class OtlpGrpcReceiver extends EventEmitter {
  private address: string;
  private deduplicator?: EventDeduplicator;
  private server: grpc.Server | null = null;

  constructor(options: OtlpGrpcReceiverOptions = {}) {
    super();
    this.address = options.address || ':4317';
    this.deduplicator = options.deduplicator;
  }

  /**
   * Start the gRPC server. Resolves with the bound address string
   * (useful when binding to port 0).
   */
  async start(): Promise<string> {
    const root = await loadProtoRoot();

    // ── Build service definitions ──

    const logsExport = makeMethod(
      root,
      '/opentelemetry.proto.collector.logs.v1.LogsService/Export',
      'opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest',
      'opentelemetry.proto.collector.logs.v1.ExportLogsServiceResponse',
    );
    const traceExport = makeMethod(
      root,
      '/opentelemetry.proto.collector.trace.v1.TraceService/Export',
      'opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest',
      'opentelemetry.proto.collector.trace.v1.ExportTraceServiceResponse',
    );
    const metricsExport = makeMethod(
      root,
      '/opentelemetry.proto.collector.metrics.v1.MetricsService/Export',
      'opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest',
      'opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceResponse',
    );

    // ── Handlers ──

    const handleLogs: grpc.handleUnaryCall<any, any> = (call, callback) => {
      try {
        const req = call.request;
        for (const rl of req.resourceLogs ?? []) {
          for (const sl of rl.scopeLogs ?? []) {
            for (const lr of sl.logRecords ?? []) {
              // Merge scope/resource attrs into the record so the
              // normalizer can find worker_id / session_id etc.
              const merged = enrichRecord(lr, sl.scope, rl.resource);
              this.pushNormalized(merged, 'otlp-log');
            }
          }
        }
        callback(null, {});
      } catch (err) {
        callback(err as Error, null);
      }
    };

    const handleTraces: grpc.handleUnaryCall<any, any> = (call, callback) => {
      try {
        const req = call.request;
        for (const rs of req.resourceSpans ?? []) {
          for (const ss of rs.scopeSpans ?? []) {
            for (const span of ss.spans ?? []) {
              const merged = enrichRecord(span, ss.scope, rs.resource);
              this.pushNormalized(merged, 'otlp-span-end');
              // Also emit a span-start event so the timeline shows both
              if (span.startTimeUnixNano) {
                const startRecord = { ...merged, timeUnixNano: span.startTimeUnixNano };
                this.pushNormalized(startRecord, 'otlp-span-start');
              }
            }
          }
        }
        callback(null, {});
      } catch (err) {
        callback(err as Error, null);
      }
    };

    const handleMetrics: grpc.handleUnaryCall<any, any> = (call, callback) => {
      try {
        const req = call.request;
        for (const rm of req.resourceMetrics ?? []) {
          for (const sm of rm.scopeMetrics ?? []) {
            for (const metric of sm.metrics ?? []) {
              const dataPoints = extractDataPoints(metric);
              for (const dp of dataPoints) {
                const merged = enrichRecord(
                  { ...dp, name: metric.name },
                  sm.scope,
                  rm.resource,
                );
                this.pushNormalized(merged, 'otlp-metric');
              }
            }
          }
        }
        callback(null, {});
      } catch (err) {
        callback(err as Error, null);
      }
    };

    // ── Register services ──

    const server = new grpc.Server();
    server.addService({ Export: logsExport }, { Export: handleLogs });
    server.addService({ Export: traceExport }, { Export: handleTraces });
    server.addService({ Export: metricsExport }, { Export: handleMetrics });

    this.server = server;

    return new Promise((resolve, reject) => {
      server.bindAsync(this.address, grpc.ServerCredentials.createInsecure(), (err, port) => {
        if (err) {
          this.server = null;
          reject(err);
          return;
        }
        server.start();
        const boundAddr = `0.0.0.0:${port}`;
        this.emit('listening', boundAddr);
        resolve(boundAddr);
      });
    });
  }

  /** Stop the gRPC server. */
  async stop(): Promise<void> {
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    return new Promise((resolve, reject) => {
      srv.tryShutdown((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  // ── Private helpers ──

  private pushNormalized(record: unknown, source: NormalizerSource): void {
    const event = normalizeToLogEvent(record, source, this.deduplicator);
    if (event) {
      this.emit('event', event);
    }
  }
}

// ── Pure functions (exported for testing) ─────────────────────

/**
 * Merge scope and resource attributes into a record so the normalizer
 * can find worker_id, session_id, etc. regardless of which level they
 * appear at in the OTLP hierarchy.
 */
export function enrichRecord(
  record: Record<string, unknown>,
  scope?: Record<string, unknown>,
  resource?: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...record };

  // Promote scope attributes into the record's attributes
  const scopeAttrs = scope?.attributes;
  if (Array.isArray(scopeAttrs) && !merged.attributes) {
    merged.attributes = scopeAttrs;
  }

  // Promote resource attributes into the record's attributes
  const resAttrs = resource?.attributes;
  if (Array.isArray(resAttrs)) {
    const existing = merged.attributes;
    if (Array.isArray(existing)) {
      merged.attributes = [...resAttrs, ...existing];
    } else {
      merged.attributes = resAttrs;
    }
  }

  return merged;
}

/**
 * Extract flat data-point objects from an OTLP Metric message.
 * Handles gauge, sum, and histogram metric types.
 */
export function extractDataPoints(
  metric: Record<string, unknown>,
): Record<string, unknown>[] {
  const points: Record<string, unknown>[] = [];

  for (const key of ['gauge', 'sum', 'histogram'] as const) {
    const container = metric[key] as Record<string, unknown> | undefined;
    if (!container) continue;
    const dps = container.dataPoints as Record<string, unknown>[] | undefined;
    if (!Array.isArray(dps)) continue;
    for (const dp of dps) {
      points.push({ ...dp });
    }
  }

  return points;
}

/**
 * Create and start an OTLP gRPC receiver, wiring its events to the
 * given callbacks. Returns the receiver instance.
 */
export async function startOtlpGrpcReceiver(
  address: string,
  onEvent: (event: LogEvent) => void,
): Promise<OtlpGrpcReceiver> {
  const receiver = new OtlpGrpcReceiver({ address });
  receiver.on('event', onEvent);
  await receiver.start();
  return receiver;
}
