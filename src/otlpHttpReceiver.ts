/**
 * FABRIC OTLP/HTTP Receiver
 *
 * Exports an Express Router that accepts OTLP/HTTP payloads at
 * /v1/logs, /v1/traces, /v1/metrics, decoding both application/x-protobuf
 * and application/json content types.  Reuses the same proto loading,
 * enrichment, and normalizer pipeline as the gRPC receiver so all OTLP
 * traffic follows an identical code path.
 *
 * Mount on any Express app — the web server creates a second HTTP listener
 * on port 4318 so the OTLP endpoints are reachable at the standard address
 * without a separate process.
 */

import { Router, Request, Response } from 'express';
import { loadProtoRoot, enrichRecord, extractDataPoints } from './otlpGrpcReceiver.js';
import { normalizeToLogEvent, NormalizerSource, EventDeduplicator } from './normalizer.js';
import { LogEvent } from './types.js';

const DECODE_OPTS = { longs: String, enums: String, bytes: String, defaults: true, oneofs: true };

// ── Body helpers ──────────────────────────────────────────────

function readRawBody(req: Request): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function decodeBody(
  body: Buffer,
  contentType: string | undefined,
  requestFqn: string,
): Promise<any> {
  const ct = (contentType || '').toLowerCase();

  if (ct.includes('application/json')) {
    return JSON.parse(body.toString('utf8'));
  }

  if (ct.includes('application/x-protobuf') || ct.includes('application/octet-stream')) {
    const root = await loadProtoRoot();
    const type = root.lookupType(requestFqn);
    if (!type) throw new Error(`protobuf type not found: ${requestFqn}`);
    const msg = type.decode(new Uint8Array(body));
    return type.toObject(msg, DECODE_OPTS);
  }

  // Unknown content type — try JSON first, fall back to protobuf.
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    const root = await loadProtoRoot();
    const type = root.lookupType(requestFqn);
    if (!type) throw new Error(`protobuf type not found: ${requestFqn}`);
    const msg = type.decode(new Uint8Array(body));
    return type.toObject(msg, DECODE_OPTS);
  }
}

// ── Router factory ────────────────────────────────────────────

export interface OtlpHttpOptions {
  /** Callback invoked for every normalised LogEvent. */
  onEvent: (event: LogEvent) => void;
  /** Max raw body size in bytes (default 5 MB). */
  maxBodyBytes?: number;
  /** Shared deduplicator for cross-source dedup (JSONL + OTLP). */
  deduplicator?: EventDeduplicator;
}

export function createOtlpHttpRouter(options: OtlpHttpOptions): Router {
  const { onEvent, maxBodyBytes = 5 * 1024 * 1024, deduplicator } = options;
  const router = Router();

  function pushNormalized(record: unknown, source: NormalizerSource): void {
    const event = normalizeToLogEvent(record, source, deduplicator);
    if (event) onEvent(event);
  }

  // ── POST /v1/logs ─────────────────────────────────────────

  router.post('/v1/logs', async (req: Request, res: Response) => {
    try {
      const body = await readRawBody(req);
      if (body.length > maxBodyBytes) {
        res.status(413).json({ error: 'payload too large' });
        return;
      }

      const reqObj = await decodeBody(
        body,
        req.headers['content-type'],
        'opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest',
      );
      if (!reqObj) {
        res.status(400).json({ error: 'failed to decode payload' });
        return;
      }

      for (const rl of reqObj.resourceLogs ?? []) {
        for (const sl of rl.scopeLogs ?? []) {
          for (const lr of sl.logRecords ?? []) {
            const merged = enrichRecord(lr, sl.scope, rl.resource);
            pushNormalized(merged, 'otlp-log');
          }
        }
      }

      res.json({});
    } catch (err) {
      console.error('OTLP/HTTP logs error:', err);
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ── POST /v1/traces ───────────────────────────────────────

  router.post('/v1/traces', async (req: Request, res: Response) => {
    try {
      const body = await readRawBody(req);
      if (body.length > maxBodyBytes) {
        res.status(413).json({ error: 'payload too large' });
        return;
      }

      const reqObj = await decodeBody(
        body,
        req.headers['content-type'],
        'opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest',
      );
      if (!reqObj) {
        res.status(400).json({ error: 'failed to decode payload' });
        return;
      }

      for (const rs of reqObj.resourceSpans ?? []) {
        for (const ss of rs.scopeSpans ?? []) {
          for (const span of ss.spans ?? []) {
            const merged = enrichRecord(span, ss.scope, rs.resource);
            pushNormalized(merged, 'otlp-span-end');
            if (span.startTimeUnixNano) {
              const startRecord = { ...merged, timeUnixNano: span.startTimeUnixNano };
              pushNormalized(startRecord, 'otlp-span-start');
            }
          }
        }
      }

      res.json({});
    } catch (err) {
      console.error('OTLP/HTTP traces error:', err);
      res.status(500).json({ error: 'internal server error' });
    }
  });

  // ── POST /v1/metrics ──────────────────────────────────────

  router.post('/v1/metrics', async (req: Request, res: Response) => {
    try {
      const body = await readRawBody(req);
      if (body.length > maxBodyBytes) {
        res.status(413).json({ error: 'payload too large' });
        return;
      }

      const reqObj = await decodeBody(
        body,
        req.headers['content-type'],
        'opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest',
      );
      if (!reqObj) {
        res.status(400).json({ error: 'failed to decode payload' });
        return;
      }

      for (const rm of reqObj.resourceMetrics ?? []) {
        for (const sm of rm.scopeMetrics ?? []) {
          for (const metric of sm.metrics ?? []) {
            const dataPoints = extractDataPoints(metric);
            for (const dp of dataPoints) {
              const merged = enrichRecord({ ...dp, name: metric.name }, sm.scope, rm.resource);
              pushNormalized(merged, 'otlp-metric');
            }
          }
        }
      }

      res.json({});
    } catch (err) {
      console.error('OTLP/HTTP metrics error:', err);
      res.status(500).json({ error: 'internal server error' });
    }
  });

  return router;
}
