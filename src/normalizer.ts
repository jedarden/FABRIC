/**
 * FABRIC Normalizer
 *
 * Normalizes raw events from multiple ingestion sources into the canonical
 * NeedleEvent shape. Each source (JSONL, OTLP) has its own parsing path,
 * but all produce the same output type so the downstream event bus sees
 * a uniform stream.
 */

import * as os from 'os';
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

// ── Event deduplication ───────────────────────────────────────

/**
 * LRU dedup set keyed on (session_id, worker_id, sequence).
 *
 * When FABRIC ingests events from both JSONL and OTLP sources,
 * the same logical event can arrive twice. The deduplicator keeps
 * the first arrival and silently drops duplicates, incrementing
 * `droppedCount` for observability.
 *
 * Events with `sequence < 0` (legacy formats without sequence) are
 * always passed through — they cannot be deduped.
 */
export class EventDeduplicator {
  private readonly seen: Map<string, true> = new Map();
  private readonly maxSize: number;
  droppedCount = 0;

  constructor(maxSize = 10_000) {
    this.maxSize = maxSize;
  }

  /**
   * Returns `true` if this is the first occurrence (keep the event),
   * `false` if it is a duplicate (drop it).
   */
  check(event: NeedleEvent): boolean {
    if (event.sequence < 0) return true;

    const key = `${event.session_id}\0${event.worker_id}\0${event.sequence}`;
    if (this.seen.has(key)) {
      this.droppedCount++;
      return false;
    }

    this.seen.set(key, true);

    // Evict oldest entries when over capacity
    if (this.seen.size > this.maxSize) {
      const excess = this.seen.size - this.maxSize;
      let count = 0;
      for (const k of this.seen.keys()) {
        if (count >= excess) break;
        this.seen.delete(k);
        count++;
      }
    }

    return true;
  }

  reset(): void {
    this.seen.clear();
    this.droppedCount = 0;
  }

  get size(): number {
    return this.seen.size;
  }
}

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
 *
 * When a `deduplicator` is provided, the NeedleEvent is checked against it
 * before conversion. Duplicates return null (caller should skip).
 */
export function normalizeToLogEvent(
  raw: string | unknown,
  source: NormalizerSource,
  deduplicator?: EventDeduplicator,
): LogEvent | null {
  const ne = normalize(raw, source);
  if (!ne) return null;
  if (deduplicator && !deduplicator.check(ne)) return null;
  return needleEventToLogEvent(ne);
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

  if (typeof obj.host === 'string') {
    event.host = obj.host;
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
    host: getLocalHostname(), // Default to local hostname for legacy JSONL
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
    host: getLocalHostname(), // Default to local hostname for legacy format
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
 * Supports both namespaced OTLP semantic-convention keys and the
 * non-namespaced keys that NEEDLE currently emits.  Namespaced keys
 * take priority when present.
 *
 *   Namespaced:  needle.worker.id, needle.session.id,
 *                needle.sequence,   needle.bead.id
 *   Fallback:    worker_id, session_id, sequence, bead_id
 *   Shared:      event_type  (never namespaced)
 *
 * The OTLP `body` field (AnyValue) is lifted to `data`.  Any remaining
 * attributes that are not structural fields are merged into `data`.
 *
 * Expected input shape (JSON-parsed from OTLP/HTTP or decoded from gRPC):
 *
 *   {
 *     timeUnixNano: string,
 *     body: { kvlistValue: { values: [{key, value}] } }
 *           | { stringValue: "..." }
 *           | { ...plain JSON object in HTTP mode },
 *     attributes: [
 *       { key: "event_type",       value: { stringValue: "worker.started" } },
 *       { key: "needle.worker.id", value: { stringValue: "tcb-alpha" } },
 *       …
 *     ]
 *   }
 */

/** Namespaced → canonical field mapping
 *
 * NEEDLE emits a mix of dot-separated and underscore attribute names.
 * Both forms are supported here, with underscore forms taking priority
 * (checked first in resolveAttr) since they match NEEDLE's actual telemetry.
 */
const OTLP_ATTR_ALIASES: ReadonlyMap<string, string> = new Map([
  // Underscore forms (actual NEEDLE telemetry output)
  ['needle.worker_id',  'worker_id'],
  ['needle.session_id', 'session_id'],
  ['needle.sequence',   'sequence'],
  ['needle.bead.id',    'bead_id'],
  ['needle.host',       'host'],
  // Dot-separated forms (for compatibility with some exporters)
  ['needle.worker.id',  'worker_id'],
  ['needle.session.id', 'session_id'],
  ['needle.host',       'host'],
  // Standard OpenTelemetry resource attributes
  ['service.instance.id', 'host'],
]);

/** All attribute keys that map to structural NeedleEvent fields */
const STRUCTURAL_ATTR_KEYS = new Set([
  'event_type', 'worker_id', 'session_id', 'sequence', 'bead_id', 'host',
  ...OTLP_ATTR_ALIASES.keys(),
]);

function normalizeOtlpLog(raw: unknown): NeedleEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;

  const attrs = otlpAttrs(record);

  // Resolve structural fields, preferring namespaced keys
  const event_type = attrs.get('event_type');
  const worker_id  = resolveAttr(attrs, 'worker_id');
  const session_id = resolveAttr(attrs, 'session_id');
  const sequence   = resolveAttr(attrs, 'sequence');
  const bead_id    = resolveAttr(attrs, 'bead_id');

  if (!event_type || !worker_id) return null;

  const timestamp = record.timeUnixNano
    ? otlpNanoToISO(record.timeUnixNano as string | number)
    : new Date().toISOString();

  // Start data from body (if present), then merge non-structural attributes
  const data = extractBody(record);
  for (const [k, v] of attrs) {
    if (!STRUCTURAL_ATTR_KEYS.has(k)) {
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
    host: extractHostFromAttributes(attrs),
  };

  if (bead_id) ne.bead_id = String(bead_id);

  return ne;
}

/**
 * Extract host from resource attributes with proper priority.
 *
 * Priority order:
 * 1. needle.host (custom NEEDLE attribute - highest priority)
 * 2. service.instance.id (standard OpenTelemetry attribute - fallback)
 * 3. getLocalHostname() (last resort)
 *
 * @param attrs - OTLP attributes map from resource or record
 * @returns Host identifier string
 */
export function extractHostFromAttributes(attrs: Map<string, unknown>): string {
  // First check for custom needle.host attribute
  const needleHost = attrs.get('needle.host');
  if (typeof needleHost === 'string' && needleHost) {
    return needleHost;
  }

  // Fallback to standard OpenTelemetry service.instance.id
  const serviceInstanceId = attrs.get('service.instance.id');
  if (typeof serviceInstanceId === 'string' && serviceInstanceId) {
    return serviceInstanceId;
  }

  // Final fallback to local hostname
  return getLocalHostname();
}

/** Resolve an attribute by trying the namespaced alias first, then the plain key. */
function resolveAttr(attrs: Map<string, unknown>, canonicalKey: string): unknown {
  for (const [ns, plain] of OTLP_ATTR_ALIASES) {
    if (plain === canonicalKey) {
      const v = attrs.get(ns);
      if (v !== undefined) return v;
    }
  }
  return attrs.get(canonicalKey);
}

/** Extract the OTLP `body` AnyValue into a plain object for `data`. */
function extractBody(record: Record<string, unknown>): Record<string, unknown> {
  const body = record.body;
  if (body == null || typeof body !== 'object') return {};

  // Array-format (protobuf JSON): { kvlistValue: { values: [{key, value}] } }
  const b = body as Record<string, unknown>;
  if (Array.isArray((b.kvlistValue as Record<string, unknown> | undefined)?.values)) {
    const out: Record<string, unknown> = {};
    for (const kv of (b.kvlistValue as { values: Array<{ key: string; value: Record<string, unknown> }> }).values) {
      out[kv.key] = unwrapAnyValue(kv.value);
    }
    return out;
  }

  // Protobuf JSON scalar wrappers: { stringValue: "…" }, { intValue: 5 }, etc.
  if ('stringValue' in b || 'intValue' in b || 'doubleValue' in b || 'boolValue' in b) {
    return { value: unwrapAnyValue(b) };
  }

  // Plain JSON object (OTLP/HTTP JSON mode)
  return { ...(b as Record<string, unknown>) };
}

/** Unwrap an OTLP AnyValue to a JS primitive / object. */
function unwrapAnyValue(v: Record<string, unknown>): unknown {
  if ('stringValue' in v) return v.stringValue;
  if ('intValue'    in v) return Number(v.intValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('boolValue'   in v) return v.boolValue;
  if ('arrayValue'  in v && Array.isArray((v.arrayValue as Record<string, unknown>)?.values)) {
    return ((v.arrayValue as { values: Array<Record<string, unknown>> }).values)
      .map(item => unwrapAnyValue(item));
  }
  if ('kvlistValue' in v && Array.isArray((v.kvlistValue as Record<string, unknown>)?.values)) {
    const out: Record<string, unknown> = {};
    for (const kv of ((v.kvlistValue as { values: Array<{ key: string; value: Record<string, unknown> }> }).values)) {
      out[kv.key] = unwrapAnyValue(kv.value);
    }
    return out;
  }
  // Plain object (HTTP JSON mode)
  return v;
}

/**
 * Normalize an OTLP Span start event into NeedleEvent.
 *
 * When the span carries a `name` field, the event_type becomes `{name}.started`.
 * Otherwise falls back to explicit `event_type` attribute or `bead.claimed`.
 *
 * OTLP span structural fields (spanId, parentSpanId, traceId) are promoted
 * into `data` as `span_id`, `parent_span_id`, `trace_id` so downstream
 * consumers (DAG view, cost-per-task) can reconstruct hierarchy without
 * re-parsing logs.
 */
function normalizeOtlpSpanStart(raw: unknown): NeedleEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const span = raw as Record<string, unknown>;

  const attrs = otlpAttrs(span);
  const spanName = (span.name || span.span_name) as string | undefined;
  const explicitEventType = attrs.get('event_type');
  const event_type = spanName
    ? `${spanName}.started`
    : explicitEventType
      ? String(explicitEventType)
      : 'bead.claimed';

  const worker_id  = resolveAttr(attrs, 'worker_id');
  if (!worker_id) return null;

  const startTime = span.startTimeUnixNano || span.start_time_unix_nano;
  const timestamp = startTime
    ? otlpNanoToISO(startTime as string | number)
    : new Date().toISOString();

  const session_id = resolveAttr(attrs, 'session_id');
  const sequence   = resolveAttr(attrs, 'sequence');
  const bead_id    = resolveAttr(attrs, 'bead_id');

  // OTLP span structural fields → data for DAG linkage
  const spanId = (span.spanId || span.span_id) as string | undefined;
  const parentSpanId = (span.parentSpanId || span.parent_span_id) as string | undefined;
  const traceId = (span.traceId || span.trace_id) as string | undefined;

  const data: Record<string, unknown> = {};
  for (const [k, v] of attrs) {
    if (!STRUCTURAL_ATTR_KEYS.has(k)) {
      data[k] = v;
    }
  }

  if (spanId) data.span_id = spanId;
  if (parentSpanId) data.parent_span_id = parentSpanId;
  if (traceId) data.trace_id = traceId;
  if (spanName) data.span_name = spanName;

  const ne: NeedleEvent = {
    timestamp,
    event_type: String(event_type),
    worker_id: String(worker_id),
    session_id: session_id ? String(session_id) : '',
    sequence: typeof sequence === 'number' ? sequence : -1,
    data,
    host: extractHostFromAttributes(attrs),
  };

  if (bead_id) ne.bead_id = String(bead_id);

  return ne;
}

/**
 * Normalize an OTLP Span end event into NeedleEvent.
 *
 * When the span carries a `name` field, the event_type becomes `{name}.finished`.
 * Otherwise falls back to explicit `event_type` attribute or status-based
 * inference (bead.completed / bead.failed).
 *
 * OTLP span structural fields (spanId, parentSpanId, traceId) are promoted
 * into `data` as `span_id`, `parent_span_id`, `trace_id`.
 */
function normalizeOtlpSpanEnd(raw: unknown): NeedleEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const span = raw as Record<string, unknown>;

  const attrs = otlpAttrs(span);

  // Determine event_type: prefer {name}.finished, then explicit attribute, then status
  const spanName = (span.name || span.span_name) as string | undefined;
  const explicitEventType = attrs.get('event_type');
  const status = span.status as Record<string, unknown> | undefined;
  const code = status?.code;
  const event_type = spanName
    ? `${spanName}.finished`
    : explicitEventType
      ? String(explicitEventType)
      : (code === 'ERROR' || code === 2) ? 'bead.failed' : 'bead.completed';

  const worker_id  = resolveAttr(attrs, 'worker_id');
  if (!worker_id) return null;

  const session_id = resolveAttr(attrs, 'session_id');
  const sequence   = resolveAttr(attrs, 'sequence');
  const bead_id    = resolveAttr(attrs, 'bead_id');

  const endTime = span.endTimeUnixNano || span.end_time_unix_nano;
  const timestamp = endTime
    ? otlpNanoToISO(endTime as string | number)
    : new Date().toISOString();

  // OTLP span structural fields → data for DAG linkage
  const spanId = (span.spanId || span.span_id) as string | undefined;
  const parentSpanId = (span.parentSpanId || span.parent_span_id) as string | undefined;
  const traceId = (span.traceId || span.trace_id) as string | undefined;

  const data: Record<string, unknown> = {};
  for (const [k, v] of attrs) {
    if (!STRUCTURAL_ATTR_KEYS.has(k)) {
      data[k] = v;
    }
  }

  if (spanId) data.span_id = spanId;
  if (parentSpanId) data.parent_span_id = parentSpanId;
  if (traceId) data.trace_id = traceId;
  if (spanName) data.span_name = spanName;

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
    session_id: session_id ? String(session_id) : '',
    sequence: typeof sequence === 'number' ? sequence : -1,
    data,
    host: extractHostFromAttributes(attrs),
  };

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
  const worker_id  = resolveAttr(attrs, 'worker_id');
  if (!worker_id) return null;

  const session_id = resolveAttr(attrs, 'session_id');
  const bead_id    = resolveAttr(attrs, 'bead_id');

  const timeUnixNano = metricPoint.timeUnixNano || metricPoint.time_unix_nano;
  const timestamp = timeUnixNano
    ? otlpNanoToISO(timeUnixNano as string | number)
    : new Date().toISOString();

  const data: Record<string, unknown> = {};
  for (const [k, v] of attrs) {
    if (!STRUCTURAL_ATTR_KEYS.has(k)) {
      data[k] = v;
    }
  }
  if (metricName) data.metric_name = metricName;

  // Extract value depending on metric type
  if (metricPoint.asDouble !== undefined) data.value = metricPoint.asDouble;
  else if (metricPoint.asInt !== undefined) data.value = metricPoint.asInt;
  else if (typeof metricPoint.value === 'number') data.value = metricPoint.value;
  // Histogram data points carry sum/count instead of asDouble/asInt
  else if (typeof metricPoint.sum === 'number') data.value = metricPoint.sum;

  const ne: NeedleEvent = {
    timestamp,
    event_type: `metric.${metricName || 'unknown'}`,
    worker_id: String(worker_id),
    session_id: session_id ? String(session_id) : '',
    sequence: -1,
    data,
    host: extractHostFromAttributes(attrs),
  };

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
    sequence: ne.sequence >= 0 ? ne.sequence : undefined,
  };

  if (ne.session_id) event.session = ne.session_id;
  if (ne.bead_id !== undefined) event.bead = ne.bead_id;
  if (ne.host !== undefined) event.host = ne.host;

  const data = ne.data;
  if (typeof data.duration_ms === 'number') event.duration_ms = data.duration_ms;
  if (typeof data.error === 'string') event.error = data.error;
  if (typeof data.tool === 'string') event.tool = data.tool;
  if (typeof data.path === 'string') event.path = data.path;
  if (typeof data.provider === 'string') event.provider = data.provider;
  if (typeof data.model === 'string') event.model = data.model;
  if (typeof data.span_id === 'string') event.span_id = data.span_id;
  if (typeof data.parent_span_id === 'string') event.parent_span_id = data.parent_span_id;
  if (typeof data.trace_id === 'string') event.trace_id = data.trace_id;
  if (typeof data.span_name === 'string') event.span_name = data.span_name;

  const reserved = new Set([
    'duration_ms', 'error', 'tool', 'path', 'provider', 'model', 'level',
    'bead_id', 'span_id', 'parent_span_id', 'trace_id', 'span_name',
  ]);
  for (const key of Object.keys(data)) {
    if (!reserved.has(key) && !(key in event)) {
      event[key] = data[key];
    }
  }

  return event;
}

// ── Shared helpers ────────────────────────────────────────────

/**
 * Get the local hostname for events without an explicit host field.
 * Used for legacy JSONL sources and local log tailing.
 */
function getLocalHostname(): string {
  // Prefer environment variables if set (container/pod context)
  if (typeof process !== 'undefined' && process.env.HOSTNAME) {
    return process.env.HOSTNAME;
  }
  if (typeof process !== 'undefined' && process.env.HOST) {
    return process.env.HOST;
  }
  // Use system hostname as default
  return os.hostname();
}

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
