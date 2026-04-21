/**
 * FABRIC Normalizer
 *
 * Normalizes raw events from multiple ingestion sources into the canonical
 * NeedleEvent shape. Each source (JSONL, OTLP) has its own parsing path,
 * but all produce the same output type so the downstream event bus sees
 * a uniform stream.
 */

import {
  LogEvent,
  LogLevel,
  NeedleEvent,
  NEEDLE_EVENT_SCHEMA_VERSION,
} from './types.js';

// ── Source types ──────────────────────────────────────────────

export type NormalizerSource =
  | 'jsonl'
  | 'otlp-log'
  | 'otlp-span-start'
  | 'otlp-span-end'
  | 'otlp-metric';

// ── Internal interfaces for legacy formats ────────────────────

interface NeedleWorkerObject {
  runner: string;
  provider: string;
  model: string;
  identifier: string;
}

interface NeedleLogEntry {
  ts: string;
  event: string;
  level?: string;
  session: string;
  worker: string | NeedleWorkerObject;
  data: Record<string, unknown>;
}

// ── Main entry point ──────────────────────────────────────────

/**
 * Normalize a raw input into the canonical NeedleEvent shape.
 *
 * @param raw   Raw payload (string for JSONL, object for OTLP)
 * @param source Which ingestion source produced this input
 * @returns Normalized NeedleEvent, or null if the input is invalid/unrecognized
 */
export function normalize(
  raw: string | unknown,
  source: NormalizerSource,
): NeedleEvent | null {
  switch (source) {
    case 'jsonl':
      return normalizeJsonl(raw as string);
    case 'otlp-log':
      return normalizeOtlpLog(raw);
    case 'otlp-span-start':
      return normalizeOtlpSpanStart(raw);
    case 'otlp-span-end':
      return normalizeOtlpSpanEnd(raw);
    case 'otlp-metric':
      return normalizeOtlpMetric(raw);
    default:
      return null;
  }
}

/**
 * Convenience: normalize and then convert to the legacy LogEvent shape
 * used by the existing store / TUI / web consumers.
 */
export function normalizeToLogEvent(
  raw: string | unknown,
  source: NormalizerSource,
): LogEvent | null {
  const ne = normalize(raw, source);
  return ne ? needleEventToLogEvent(ne) : null;
}

// ── JSONL source ──────────────────────────────────────────────

function normalizeJsonl(raw: string | unknown): NeedleEvent | null {
  // Accept pre-parsed objects directly
  let parsed: unknown;
  if (typeof raw === 'string') {
    if (!raw || !raw.trim()) return null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  } else {
    parsed = raw;
  }

  // 1) Canonical NeedleEvent wire format (has timestamp, event_type, worker_id, …)
  const canonical = parseCanonicalNeedleEvent(parsed);
  if (canonical) return canonical;

  // 2) Legacy NEEDLE JSONL format (ts: string ISO, event: string, worker: obj|string)
  if (isNeedleLogEntry(parsed)) {
    return normalizeNeedleLogEntry(parsed);
  }

  // 3) Legacy flat format (ts: number, worker: string, level, msg)
  return normalizeLegacyLogEntry(parsed);
}

/**
 * Parse a raw object already matching the canonical NeedleEvent schema.
 * Returns null (no throw) on structural mismatch; throws on version mismatch.
 */
function parseCanonicalNeedleEvent(raw: unknown): NeedleEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.timestamp !== 'string') return null;
  if (typeof obj.event_type !== 'string') return null;
  if (typeof obj.worker_id !== 'string') return null;
  if (typeof obj.session_id !== 'string') return null;
  if (typeof obj.sequence !== 'number') return null;

  if (obj.schema_version !== undefined && obj.schema_version !== NEEDLE_EVENT_SCHEMA_VERSION) {
    throw new Error(
      `NeedleEvent schema mismatch: got ${obj.schema_version}, expected ${NEEDLE_EVENT_SCHEMA_VERSION}`,
    );
  }

  const event: NeedleEvent = {
    timestamp: obj.timestamp,
    event_type: obj.event_type,
    worker_id: obj.worker_id,
    session_id: obj.session_id,
    sequence: obj.sequence,
    data: typeof obj.data === 'object' && obj.data !== null
      ? obj.data as Record<string, unknown>
      : {},
  };

  if (typeof obj.bead_id === 'string') {
    event.bead_id = obj.bead_id;
  }

  return event;
}

function isNeedleLogEntry(parsed: unknown): parsed is NeedleLogEntry {
  if (typeof parsed !== 'object' || parsed === null) return false;
  const obj = parsed as Record<string, unknown>;
  return (
    typeof obj.ts === 'string' &&
    typeof obj.event === 'string' &&
    (typeof obj.worker === 'object' || typeof obj.worker === 'string')
  );
}

function normalizeNeedleLogEntry(entry: NeedleLogEntry): NeedleEvent {
  const workerId = typeof entry.worker === 'string'
    ? entry.worker
    : `${entry.worker.runner}-${entry.worker.provider}-${entry.worker.model}-${entry.worker.identifier}`;

  const data = entry.data || {};

  const ne: NeedleEvent = {
    timestamp: entry.ts,
    event_type: entry.event,
    worker_id: workerId,
    session_id: entry.session,
    sequence: -1, // not available in legacy NEEDLE JSONL
    data: { ...data },
  };

  // Preserve level in data for downstream conversion
  if (entry.level) ne.data.level = entry.level;

  // Flatten worker object fields into data when available
  if (typeof entry.worker === 'object') {
    ne.data.provider = entry.worker.provider;
    ne.data.model = entry.worker.model;
  }

  // Promote bead_id if present in data
  if (typeof data.bead_id === 'string') {
    ne.bead_id = data.bead_id;
    delete ne.data.bead_id;
  }

  return ne;
}

function normalizeLegacyLogEntry(parsed: unknown): NeedleEvent | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.ts !== 'number') return null;
  if (typeof obj.worker !== 'string') return null;
  if (!isValidLogLevel(obj.level)) return null;
  if (typeof obj.msg !== 'string') return null;

  // Collect extra fields into data
  const standardFields = new Set([
    'ts', 'worker', 'level', 'msg', 'tool', 'path', 'bead', 'duration_ms', 'error',
    'session', 'provider', 'model',
  ]);
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (!standardFields.has(key)) {
      data[key] = obj[key];
    }
  }

  const ne: NeedleEvent = {
    timestamp: new Date(obj.ts).toISOString(),
    event_type: obj.msg,
    worker_id: obj.worker,
    session_id: '',
    sequence: -1,
    data: {
      ...data,
      level: obj.level,
    },
  };

  if (typeof obj.tool === 'string') ne.data.tool = obj.tool;
  if (typeof obj.path === 'string') ne.data.path = obj.path;
  if (typeof obj.bead === 'string') ne.bead_id = obj.bead;
  if (typeof obj.duration_ms === 'number') ne.data.duration_ms = obj.duration_ms;
  if (typeof obj.error === 'string') ne.data.error = obj.error;

  return ne;
}

// ── OTLP source stubs ─────────────────────────────────────────

/**
 * Normalize an OTLP LogRecord into NeedleEvent.
 *
 * Expected input shape (already JSON-parsed from the OTLP/HTTP JSON export
 * or decoded from OTLP/gRPC protobuf):
 *
 *   {
 *     timeUnixNano: string,
 *     body: { stringValue: string },
 *     attributes: [
 *       { key: "event_type", value: { stringValue: "worker.started" } },
 *       { key: "worker_id",  value: { stringValue: "tcb-alpha" } },
 *       …
 *     ]
 *   }
 */
function normalizeOtlpLog(raw: unknown): NeedleEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const attrs = otlpAttrs(record);

  const event_type = attrs.get('event_type');
  const worker_id = attrs.get('worker_id');
  const session_id = attrs.get('session_id');
  const sequence = attrs.get('sequence');

  if (!event_type || !worker_id) return null;

  const timestamp = record.timeUnixNano
    ? otlpNanoToISO(record.timeUnixNano as string | number)
    : new Date().toISOString();

  const data: Record<string, unknown> = {};
  for (const [k, v] of attrs) {
    if (k !== 'event_type' && k !== 'worker_id' && k !== 'session_id' && k !== 'sequence' && k !== 'bead_id') {
      data[k] = v;
    }
  }

  const ne: NeedleEvent = {
    timestamp,
    event_type: String(event_type),
    worker_id: String(worker_id),
    session_id: session_id ? String(session_id) : '',
    sequence: typeof sequence === 'number' ? sequence : -1,
    data,
  };

  const bead_id = attrs.get('bead_id');
  if (bead_id) ne.bead_id = String(bead_id);

  return ne;
}

/**
 * Normalize an OTLP Span start event into NeedleEvent.
 *
 * A span start maps to a bead.claimed or worker.started event depending on
 * the span's attributes.
 */
function normalizeOtlpSpanStart(raw: unknown): NeedleEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const span = raw as Record<string, unknown>;

  const attrs = otlpAttrs(span);
  const event_type = attrs.get('event_type') || 'bead.claimed';
  const worker_id = attrs.get('worker_id');
  if (!worker_id) return null;

  const startTime = span.startTimeUnixNano || span.start_time_unix_nano;
  const timestamp = startTime
    ? otlpNanoToISO(startTime as string | number)
    : new Date().toISOString();

  const data: Record<string, unknown> = {};
  for (const [k, v] of attrs) {
    if (k !== 'event_type' && k !== 'worker_id' && k !== 'session_id' && k !== 'sequence' && k !== 'bead_id') {
      data[k] = v;
    }
  }

  const ne: NeedleEvent = {
    timestamp,
    event_type: String(event_type),
    worker_id: String(worker_id),
    session_id: attrs.get('session_id') ? String(attrs.get('session_id')) : '',
    sequence: typeof attrs.get('sequence') === 'number' ? attrs.get('sequence') as number : -1,
    data,
  };

  const bead_id = attrs.get('bead_id');
  if (bead_id) ne.bead_id = String(bead_id);

  return ne;
}

/**
 * Normalize an OTLP Span end event into NeedleEvent.
 *
 * A span end maps to a bead.completed or bead.failed event depending on
 * the span's status.
 */
function normalizeOtlpSpanEnd(raw: unknown): NeedleEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const span = raw as Record<string, unknown>;

  const attrs = otlpAttrs(span);

  // Determine event_type from span status
  const status = span.status as Record<string, unknown> | undefined;
  const code = status?.code;
  const spanEventType = attrs.get('event_type');
  const event_type = spanEventType
    ? String(spanEventType)
    : (code === 'ERROR' || code === 2) ? 'bead.failed' : 'bead.completed';

  const worker_id = attrs.get('worker_id');
  if (!worker_id) return null;

  const endTime = span.endTimeUnixNano || span.end_time_unix_nano;
  const timestamp = endTime
    ? otlpNanoToISO(endTime as string | number)
    : new Date().toISOString();

  const data: Record<string, unknown> = {};
  for (const [k, v] of attrs) {
    if (k !== 'event_type' && k !== 'worker_id' && k !== 'session_id' && k !== 'sequence' && k !== 'bead_id') {
      data[k] = v;
    }
  }

  // Include duration if both start and end times are available
  const startTime = span.startTimeUnixNano || span.start_time_unix_nano;
  if (startTime && endTime) {
    const startNs = Number(startTime);
    const endNs = Number(endTime);
    data.duration_ms = Math.round((endNs - startNs) / 1_000_000);
  }

  // Include error message from status
  if (status?.message) {
    data.error = status.message;
  }

  const ne: NeedleEvent = {
    timestamp,
    event_type,
    worker_id: String(worker_id),
    session_id: attrs.get('session_id') ? String(attrs.get('session_id')) : '',
    sequence: typeof attrs.get('sequence') === 'number' ? attrs.get('sequence') as number : -1,
    data,
  };

  const bead_id = attrs.get('bead_id');
  if (bead_id) ne.bead_id = String(bead_id);

  return ne;
}

/**
 * Normalize an OTLP Metric data point into NeedleEvent.
 *
 * Maps OTLP gauge/sum/histogram data points with NEEDLE attributes
 * into the canonical event stream.
 */
function normalizeOtlpMetric(raw: unknown): NeedleEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const metricPoint = raw as Record<string, unknown>;

  const attrs = otlpAttrs(metricPoint);

  const metricName = metricPoint.name as string | undefined;
  const worker_id = attrs.get('worker_id');
  if (!worker_id) return null;

  const timeUnixNano = metricPoint.timeUnixNano || metricPoint.time_unix_nano;
  const timestamp = timeUnixNano
    ? otlpNanoToISO(timeUnixNano as string | number)
    : new Date().toISOString();

  const data: Record<string, unknown> = {};
  for (const [k, v] of attrs) {
    if (k !== 'worker_id' && k !== 'session_id' && k !== 'bead_id') {
      data[k] = v;
    }
  }
  if (metricName) data.metric_name = metricName;

  // Extract value depending on metric type
  if (metricPoint.asDouble !== undefined) data.value = metricPoint.asDouble;
  else if (metricPoint.asInt !== undefined) data.value = metricPoint.asInt;
  else if (typeof metricPoint.value === 'number') data.value = metricPoint.value;

  const ne: NeedleEvent = {
    timestamp,
    event_type: `metric.${metricName || 'unknown'}`,
    worker_id: String(worker_id),
    session_id: attrs.get('session_id') ? String(attrs.get('session_id')) : '',
    sequence: -1,
    data,
  };

  const bead_id = attrs.get('bead_id');
  if (bead_id) ne.bead_id = String(bead_id);

  return ne;
}

// ── NeedleEvent → LogEvent conversion ─────────────────────────

/**
 * Convert a canonical NeedleEvent into the legacy LogEvent shape.
 *
 * This adapter preserves backward compatibility with existing UI consumers
 * that depend on LogEvent's flat structure.
 */
export function needleEventToLogEvent(ne: NeedleEvent): LogEvent {
  const ts = new Date(ne.timestamp).getTime();
  const level = inferLogLevel(ne.event_type, ne.data.level as string | undefined);
  const event: LogEvent = {
    ts,
    worker: ne.worker_id,
    level,
    msg: ne.event_type,
  };

  if (ne.session_id) event.session = ne.session_id;
  if (ne.bead_id !== undefined) event.bead = ne.bead_id;

  const data = ne.data;
  if (typeof data.duration_ms === 'number') event.duration_ms = data.duration_ms;
  if (typeof data.error === 'string') event.error = data.error;
  if (typeof data.tool === 'string') event.tool = data.tool;
  if (typeof data.path === 'string') event.path = data.path;
  if (typeof data.provider === 'string') event.provider = data.provider;
  if (typeof data.model === 'string') event.model = data.model;

  const reserved = new Set([
    'duration_ms', 'error', 'tool', 'path', 'provider', 'model', 'level',
    'bead_id',
  ]);
  for (const key of Object.keys(data)) {
    if (!reserved.has(key) && !(key in event)) {
      event[key] = data[key];
    }
  }

  return event;
}

// ── Shared helpers ────────────────────────────────────────────

function isValidLogLevel(level: unknown): level is LogLevel {
  return level === 'debug' || level === 'info' || level === 'warn' || level === 'error';
}

function inferLogLevel(eventName: string, explicitLevel?: string): LogLevel {
  if (isValidLogLevel(explicitLevel)) return explicitLevel;
  if (eventName.startsWith('error.')) return 'error';
  if (eventName.endsWith('.failed') || eventName.endsWith('.retry')) return 'warn';
  if (eventName.startsWith('debug.')) return 'debug';
  return 'info';
}

/**
 * Extract OTLP attributes array into a plain Map.
 *
 * Accepts either:
 *   - attributes: [{ key, value: { stringValue | intValue | doubleValue } }]
 *   - attributes as a plain object (some JSON exporters use this form)
 */
function otlpAttrs(record: Record<string, unknown>): Map<string, unknown> {
  const map = new Map<string, unknown>();
  const attrs = record.attributes;

  if (Array.isArray(attrs)) {
    for (const attr of attrs) {
      if (typeof attr !== 'object' || attr === null) continue;
      const a = attr as Record<string, unknown>;
      const key = a.key as string | undefined;
      if (!key) continue;
      const val = a.value as Record<string, unknown> | undefined;
      if (!val) continue;
      if ('stringValue' in val) map.set(key, val.stringValue);
      else if ('intValue' in val) map.set(key, Number(val.intValue));
      else if ('doubleValue' in val) map.set(key, val.doubleValue);
      else if ('boolValue' in val) map.set(key, val.boolValue);
    }
  } else if (typeof attrs === 'object' && attrs !== null) {
    for (const [key, val] of Object.entries(attrs as Record<string, unknown>)) {
      map.set(key, val);
    }
  }

  return map;
}

function otlpNanoToISO(nano: string | number): string {
  const ms = Math.round(Number(nano) / 1_000_000);
  return new Date(ms).toISOString();
}
