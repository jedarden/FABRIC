import { NEEDLE_EVENT_SCHEMA_VERSION, NeedleEvent } from '../types.js';

/**
 * Event types accepted by POST /event/normalized.
 *
 * This is deliberately a runtime allow-list.  The rest of FABRIC accepts
 * forward-compatible event names while this boundary is intended for callers
 * that have opted into a stable request contract.
 */
export const SUPPORTED_NORMALIZED_EVENT_TYPES = [
  'worker.booting',
  'worker.started',
  'worker.stopped',
  'worker.errored',
  'worker.exhausted',
  'worker.idle',
  'worker.heartbeat',
  'worker.idle_sleep_completed',
  'worker.idle_sleep_entered',
  'worker.state_transition',
  'worker.queue_empty',
  'worker.boot.timeout',
  'worker.handling.timeout',
  'worker.upgrade.detected',
  'worker.upgrade.completed',
  'init.step.started',
  'init.step.completed',
  'strand.evaluated',
  'strand.skipped',
  'bead.claimed',
  'bead.claim.attempted',
  'bead.claim.succeeded',
  'bead.claim.race_lost',
  'bead.claim.race_lost_skipped',
  'bead.claim.failed',
  'bead.released',
  'bead.release.failed',
  'bead.completed',
  'bead.failed',
  'bead.orphaned',
  'bead.prompt_built',
  'bead.agent_started',
  'bead.agent_completed',
  'bead.mitosis.evaluated',
  'bead.mitosis.split',
  'bead.mitosis.skipped',
  'bead.unravel.analyzed',
  'bead.unravel.skipped',
  'agent.dispatched',
  'agent.completed',
  'agent.transform.spawned',
  'agent.transform.exited',
  'agent.transform.skipped',
  'build.timeout',
  'build.heartbeat',
  'outcome.classified',
  'outcome.handled',
  'heartbeat.emitted',
  'heartbeat.stuck_detected',
  'heartbeat.recovery',
  'peer.stale',
  'peer.crashed',
  'health.check',
  'effort.recorded',
  'budget.warning',
  'budget.stop',
  'rate_limit.wait',
  'rate_limit.allowed',
  'verification.failed',
  'verification.passed',
  'rollback.completed',
  'canary.started',
  'canary.suite_completed',
  'canary.promoted',
  'canary.rejected',
  'transform.started',
  'transform.completed',
  'transform.failed',
  'transform.skipped',
  'telemetry.sink_error',
  'telemetry.otlp.dropped',
  'telemetry.otlp.shutdown_timeout',
] as const;

export type SupportedNormalizedEventType = typeof SUPPORTED_NORMALIZED_EVENT_TYPES[number];

const supportedTypes = new Set<string>(SUPPORTED_NORMALIZED_EVENT_TYPES);

type JsonObject = Record<string, unknown>;

export interface NormalizedEventRequest extends NeedleEvent {
  event_type: SupportedNormalizedEventType;
}

export interface NormalizedEventValidationError {
  field: string;
  message: string;
}

export type NormalizedEventValidationResult =
  | { ok: true; event: NormalizedEventRequest }
  | { ok: false; error: NormalizedEventValidationError };

type FieldRule = (value: unknown) => string | undefined;

const nonEmptyString: FieldRule = (value) =>
  typeof value === 'string' && value.trim().length > 0
    ? undefined
    : 'must be a non-empty string';

const nonNegativeNumber: FieldRule = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? undefined
    : 'must be a finite number greater than or equal to 0';

const positiveInteger: FieldRule = (value) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
    ? undefined
    : 'must be a positive integer';

const finiteInteger: FieldRule = (value) =>
  typeof value === 'number' && Number.isSafeInteger(value)
    ? undefined
    : 'must be a safe integer';

const nonNegativeInteger: FieldRule = (value) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? undefined
    : 'must be a non-negative safe integer';

const timestamp: FieldRule = (value) => {
  if (typeof value !== 'string' || !RFC3339.test(value) || !Number.isFinite(Date.parse(value))) {
    return 'must be a valid RFC3339 timestamp';
  }
  return undefined;
};

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const EVENT_FIELD_RULES: Partial<Record<SupportedNormalizedEventType, Record<string, FieldRule>>> = {
  'worker.stopped': { reason: nonEmptyString },
  'worker.errored': { error: nonEmptyString },
  'worker.exhausted': { reason: nonEmptyString },
  'worker.heartbeat': { status: nonEmptyString },
  'worker.state_transition': { state: nonEmptyString },
  'bead.claimed': { bead_id: nonEmptyString },
  'bead.claim.attempted': { bead_id: nonEmptyString, attempt: positiveInteger },
  'bead.claim.succeeded': { bead_id: nonEmptyString },
  'bead.claim.race_lost': { bead_id: nonEmptyString },
  'bead.claim.race_lost_skipped': { bead_id: nonEmptyString },
  'bead.claim.failed': { bead_id: nonEmptyString, error: nonEmptyString },
  'bead.released': { bead_id: nonEmptyString },
  'bead.release.failed': { bead_id: nonEmptyString, error: nonEmptyString },
  'bead.completed': { bead_id: nonEmptyString },
  'bead.failed': { bead_id: nonEmptyString, error: nonEmptyString },
  'bead.orphaned': { bead_id: nonEmptyString },
  'bead.prompt_built': { bead_id: nonEmptyString },
  'bead.agent_started': { bead_id: nonEmptyString },
  'bead.agent_completed': { bead_id: nonEmptyString },
  'bead.mitosis.evaluated': { bead_id: nonEmptyString },
  'bead.mitosis.split': { bead_id: nonEmptyString },
  'bead.mitosis.skipped': { bead_id: nonEmptyString },
  'bead.unravel.analyzed': { bead_id: nonEmptyString },
  'bead.unravel.skipped': { bead_id: nonEmptyString },
  'agent.dispatched': { bead_id: nonEmptyString },
  'agent.completed': { bead_id: nonEmptyString },
  'outcome.classified': { outcome: nonEmptyString },
  'outcome.handled': { outcome: nonEmptyString },
  'heartbeat.emitted': { status: nonEmptyString },
  'heartbeat.stuck_detected': { since: timestamp },
  'heartbeat.recovery': { since: timestamp },
  'effort.recorded': { bead_id: nonEmptyString, tokens: nonNegativeNumber, cost: nonNegativeNumber },
  'budget.warning': { used: nonNegativeNumber, limit: nonNegativeNumber, percentage: nonNegativeNumber },
  'budget.stop': { used: nonNegativeNumber, limit: nonNegativeNumber },
  'verification.failed': { error: nonEmptyString },
  'verification.passed': { check: nonEmptyString },
  'transform.failed': { error: nonEmptyString },
};

const OPTIONAL_FIELD_RULES: Record<string, FieldRule> = {
  bead_id: nonEmptyString,
  error: nonEmptyString,
  reason: nonEmptyString,
  status: nonEmptyString,
  outcome: nonEmptyString,
  duration_ms: nonNegativeNumber,
  attempt: positiveInteger,
  count: nonNegativeNumber,
  tokens: nonNegativeNumber,
  cost: nonNegativeNumber,
  used: nonNegativeNumber,
  limit: nonNegativeNumber,
  percentage: nonNegativeNumber,
  exit_code: finiteInteger,
  bytes_freed: nonNegativeNumber,
  issues_found: nonNegativeNumber,
  check: nonEmptyString,
  state: nonEmptyString,
  from: nonEmptyString,
  to: nonEmptyString,
  since: timestamp,
};

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined);
}

function fail(field: string, message: string): NormalizedEventValidationResult {
  return { ok: false, error: { field, message } };
}

function validateField(
  field: string,
  value: unknown,
  rule: FieldRule,
  required: boolean,
): NormalizedEventValidationResult | undefined {
  if (value === undefined) {
    return required ? fail(field, 'is required') : undefined;
  }
  const problem = rule(value);
  return problem ? fail(field, problem) : undefined;
}

/**
 * Validate and canonicalize the request accepted by POST /event/normalized.
 *
 * `payload` is accepted as a compatibility alias for `data`; envelope fields
 * may be supplied at the top level or inside that payload.  The returned
 * value always has the canonical NeedleEvent shape, so dispatch has exactly
 * one input form.
 */
export function validateNormalizedEventRequest(input: unknown): NormalizedEventValidationResult {
  if (!isJsonObject(input)) {
    return fail('body', 'must be a JSON object');
  }

  const body = input;
  if (body.payload !== undefined && !isJsonObject(body.payload)) {
    return fail('payload', 'must be a JSON object');
  }
  const payload = isJsonObject(body.payload) ? body.payload : undefined;
  const explicitData = body.data;
  if (explicitData !== undefined && !isJsonObject(explicitData)) {
    return fail('data', 'must be a JSON object');
  }
  const dataSource = isJsonObject(explicitData) ? explicitData : payload ?? {};

  const type = body.type;
  if (typeof type !== 'string' || type.trim().length === 0) {
    return fail('type', 'is required and must be a non-empty string');
  }
  if (!supportedTypes.has(type)) {
    return fail('type', `unknown event type "${type}"`);
  }
  if (explicitData === undefined && payload === undefined) {
    return fail('data', 'is required');
  }

  const eventType = type as SupportedNormalizedEventType;
  const timestampValue = firstDefined(body.timestamp, payload?.timestamp);
  const workerIdValue = firstDefined(body.worker_id, payload?.worker_id);
  const sessionIdValue = firstDefined(body.session_id, payload?.session_id);
  const sequenceValue = firstDefined(body.sequence, payload?.sequence);

  for (const [field, value, rule] of [
    ['timestamp', timestampValue, timestamp],
    ['worker_id', workerIdValue, nonEmptyString],
    ['session_id', sessionIdValue, nonEmptyString],
    ['sequence', sequenceValue, nonNegativeInteger],
  ] as const) {
    const problem = validateField(field, value, rule, true);
    if (problem) return problem;
  }

  if (body.schema_version !== undefined && body.schema_version !== NEEDLE_EVENT_SCHEMA_VERSION) {
    return fail('schema_version', `must be ${NEEDLE_EVENT_SCHEMA_VERSION}`);
  }

  const beadIdValue = firstDefined(body.bead_id, payload?.bead_id, dataSource.bead_id);
  const hostValue = firstDefined(body.host, payload?.host);
  const typeRules = EVENT_FIELD_RULES[eventType] ?? {};

  for (const [field, rule] of Object.entries(typeRules)) {
    const value = firstDefined(body[field], payload?.[field], dataSource[field], field === 'bead_id' ? beadIdValue : undefined);
    const problem = validateField(field, value, rule, true);
    if (problem) return problem;
  }

  for (const [field, rule] of Object.entries(OPTIONAL_FIELD_RULES)) {
    const value = firstDefined(body[field], payload?.[field], dataSource[field]);
    const problem = validateField(field, value, rule, false);
    if (problem) return problem;
  }

  if (hostValue !== undefined) {
    const problem = nonEmptyString(hostValue);
    if (problem) return fail('host', problem);
  }

  const canonicalData: JsonObject = { ...dataSource };
  for (const field of Object.keys({ ...OPTIONAL_FIELD_RULES, ...typeRules })) {
    const value = firstDefined(body[field], payload?.[field]);
    if (value !== undefined && canonicalData[field] === undefined) {
      canonicalData[field] = value;
    }
  }
  delete canonicalData.worker_id;
  delete canonicalData.session_id;
  delete canonicalData.timestamp;
  delete canonicalData.sequence;
  delete canonicalData.type;
  delete canonicalData.payload;
  if (beadIdValue !== undefined) delete canonicalData.bead_id;

  const event: NormalizedEventRequest = {
    timestamp: timestampValue as string,
    event_type: eventType,
    worker_id: workerIdValue as string,
    session_id: sessionIdValue as string,
    sequence: sequenceValue as number,
    data: canonicalData,
  };

  if (beadIdValue !== undefined) event.bead_id = beadIdValue as string;
  if (hostValue !== undefined) event.host = hostValue as string;

  return { ok: true, event };
}

