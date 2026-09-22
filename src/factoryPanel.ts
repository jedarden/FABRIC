/**
 * FABRIC Factory Panel — verified-closure yield and routing telemetry
 *
 * Computes, per adapter and per workspace over rolling windows, the numbers
 * NEEDLE plan §10 (rev 34, sections 4.9–4.10) defines from the ledger events
 * NEEDLE now emits:
 *
 *   - attempt.resolved        (adapter, model, provider, outcome, gate_results,
 *                             tokens, estimated_cost_usd, costed)
 *   - agent.evidence_routing  (decision, scope, …)
 *   - provider.degraded / provider.restored
 *   - experiment.stopped
 *
 * Metrics (ADR-030 semantics):
 *   - verified-closure yield per attempt  = verified / eligibleAttempts
 *   - verified-closure yield per dollar   = verified / eligibleSpend
 *   - cost per verified closure           = eligibleSpend / verified
 *   - unverified spend share              = unverifiedSpend / costTotal
 *   - decomposed attempts are shown separately — they are neither a verified
 *     closure nor a failed attempt, so they leave both the numerator and the
 *     denominator of the yield ratios and their spend is reported on its own.
 *   - costed=false attempts carry no reliable cost estimate — they leave every
 *     spend figure and are counted (and listed) separately.
 *
 * Every ingested row is persisted to the on-disk store (HistoricalStore,
 * `factory_ledger_events` table) and replayed on startup, so a restart
 * restores the panel instead of zeroing it.
 *
 * Fixture hygiene: events from worker ids ending in `-test-worker` and events
 * whose `workspace` is `.` (NEEDLE's synthetic-fixture marker) never enter the
 * aggregates.
 */

import { LogEvent } from './types.js';
import { HistoricalStore, getHistoricalStore } from './historicalStore.js';

// ── Event kinds ───────────────────────────────────────────────

/** NEEDLE ledger event types this panel consumes (matched on LogEvent.msg). */
export const FACTORY_EVENT_TYPES = {
  attemptResolved: 'attempt.resolved',
  evidenceRouting: 'agent.evidence_routing',
  providerDegraded: 'provider.degraded',
  providerRestored: 'provider.restored',
  experimentStopped: 'experiment.stopped',
} as const;

/** outcome values with dedicated accounting (everything else is unverified). */
export const OUTCOME_VERIFIED = 'verified';
export const OUTCOME_DECOMPOSED = 'decomposed';

/** Worker-id suffix marking NEEDLE test/fixture workers — never aggregated. */
export const TEST_WORKER_SUFFIX = '-test-worker';

// ── Record shapes ─────────────────────────────────────────────

export interface FactoryAttemptRecord {
  kind: 'attempt_resolved';
  ts: number;
  worker: string;
  adapter: string;
  model?: string;
  provider?: string;
  outcome: string;
  verified: boolean;
  decomposed: boolean;
  gateSummary: string;
  tokens: number;
  estimatedCostUsd: number | null;
  costed: boolean;
  workspace: string;
  bead?: string;
}

export interface FactoryRoutingRecord {
  kind: 'evidence_routing';
  ts: number;
  worker: string;
  decision: string;
  scope: string;
  workspace?: string;
  adapter?: string;
  reason?: string;
}

export interface FactoryProviderRecord {
  kind: 'provider_degraded' | 'provider_restored';
  ts: number;
  worker: string;
  provider: string;
  reason?: string;
}

export interface FactoryExperimentRecord {
  kind: 'experiment_stopped';
  ts: number;
  worker: string;
  experiment: string;
  scope?: string;
}

export type FactoryRecord =
  | FactoryAttemptRecord
  | FactoryRoutingRecord
  | FactoryProviderRecord
  | FactoryExperimentRecord;

// ── Snapshot shapes ───────────────────────────────────────────

export interface FactoryGroupStats {
  key: string;
  attempts: number;
  verified: number;
  decomposed: number;
  /** costed=false attempts — excluded from all spend math (ADR-030). */
  uncosted: number;
  /** attempts minus decomposed — the yield denominator. */
  eligibleAttempts: number;
  yieldPerAttempt: number;
  /** Sum of estimated_cost_usd over costed attempts. */
  costTotal: number;
  /** Spend on decomposed attempts — reported separately, not in yield math. */
  decomposedSpend: number;
  /** costTotal minus decomposedSpend — the per-dollar denominator. */
  eligibleSpend: number;
  costPerVerifiedClosure: number;
  yieldPerDollar: number;
  /** Spend on eligible attempts that did not verify. */
  unverifiedSpend: number;
  unverifiedSpendShare: number;
  tokens: number;
  lastAttemptTs: number | null;
}

export interface FactoryRoutingView {
  decision: string;
  scope: string;
  ts: number;
  workspace?: string;
  adapter?: string;
  reason?: string;
}

export interface FactoryDegradedProviderView {
  provider: string;
  sinceTs: number;
  reason?: string;
}

export interface FactoryExperimentStopView {
  experiment: string;
  scope?: string;
  ts: number;
}

export interface FactoryPanelSnapshot {
  windowMs: number;
  generatedAt: number;
  totals: FactoryGroupStats;
  adapters: FactoryGroupStats[];
  workspaces: FactoryGroupStats[];
  latestRouting: FactoryRoutingView | null;
  recentRoutings: FactoryRoutingView[];
  degradedProviders: FactoryDegradedProviderView[];
  lastExperimentStops: FactoryExperimentStopView[];
  /** Fixture rows seen and excluded (test workers / workspace '.'). */
  excludedFixtureEvents: number;
  /** Rows replayed from the on-disk store at startup. */
  restoredRows: number;
}

// ── Options ───────────────────────────────────────────────────

export interface FactoryPanelOptions {
  /** Persistent store for replay-across-restart. Defaults to the global HistoricalStore. */
  historicalStore?: HistoricalStore;
  /** Default rolling window for snapshots. Default 24h. */
  defaultWindowMs?: number;
  /** Oldest event age kept in memory. Default 7d (mirrors NEEDLE log retention). */
  maxWindowMs?: number;
  /** Max attempt rows retained in memory. */
  maxAttempts?: number;
  /** Max routing/provider/experiment records retained in memory. */
  maxSignalRecords?: number;
  /**
   * 'on' | 'off' persist unconditionally; 'auto' (default) persists unless
   * FABRIC_FACTORY_PERSISTENCE=off — which vitest.config.ts sets so test
   * fixtures never leak into the live on-disk store. Pass 'on' explicitly
   * when wiring a test to its own throwaway HistoricalStore.
   */
  persistence?: 'on' | 'off' | 'auto';
}

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 50_000;
const MAX_SIGNAL_RECORDS = 500;

// ── Helpers ───────────────────────────────────────────────────

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function strField(event: LogEvent, key: string): string | undefined {
  const v = (event as Record<string, unknown>)[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function numField(event: LogEvent, key: string): number | undefined {
  const v = (event as Record<string, unknown>)[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Normalize arbitrary NEEDLE gate_results payloads into a compact summary. */
export function summarizeGateResults(gateResults: unknown): string {
  if (gateResults == null) return '';
  if (typeof gateResults === 'string') return gateResults;
  if (Array.isArray(gateResults)) {
    const parts = gateResults.map((g) => {
      if (typeof g === 'string') return g;
      const rec = g as Record<string, unknown>;
      const name = typeof rec.name === 'string' ? rec.name : typeof rec.gate === 'string' ? rec.gate : 'gate';
      const passed = rec.passed ?? rec.pass ?? rec.ok;
      return `${name}:${passed === true || passed === 'true' || passed === 'pass' ? 'pass' : passed === false || passed === 'false' ? 'fail' : String(passed ?? 'n/a')}`;
    });
    return parts.join(',');
  }
  if (typeof gateResults === 'object') {
    const rec = gateResults as Record<string, unknown>;
    return Object.entries(rec)
      .map(([k, v]) => `${k}:${v === true ? 'pass' : v === false ? 'fail' : String(v)}`)
      .join(',');
  }
  return String(gateResults);
}

/**
 * A row is fixture data when the worker id ends in `-test-worker` or the
 * workspace is `.` (NEEDLE's synthetic-fixture marker). Such rows must never
 * contribute to the panel.
 */
export function isFixtureRow(worker: string, workspace: string | undefined): boolean {
  if (worker.endsWith(TEST_WORKER_SUFFIX)) return true;
  if (workspace === '.') return true;
  return false;
}

function emptyGroupStats(key: string): FactoryGroupStats {
  return {
    key,
    attempts: 0,
    verified: 0,
    decomposed: 0,
    uncosted: 0,
    eligibleAttempts: 0,
    yieldPerAttempt: 0,
    costTotal: 0,
    decomposedSpend: 0,
    eligibleSpend: 0,
    costPerVerifiedClosure: 0,
    yieldPerDollar: 0,
    unverifiedSpend: 0,
    unverifiedSpendShare: 0,
    tokens: 0,
    lastAttemptTs: null,
  };
}

/** Fold one attempt into a mutable accumulator, then derive the ratios. */
interface GroupAccumulator extends FactoryGroupStats {
  verifiedSpend: number;
}

function finalizeGroup(acc: GroupAccumulator): FactoryGroupStats {
  const { verifiedSpend, ...stats } = acc;
  stats.eligibleAttempts = stats.attempts - stats.decomposed;
  stats.eligibleSpend = round6(stats.costTotal - stats.decomposedSpend);
  stats.yieldPerAttempt = stats.eligibleAttempts > 0
    ? round6(stats.verified / stats.eligibleAttempts)
    : 0;
  stats.costPerVerifiedClosure = stats.verified > 0
    ? round6(stats.eligibleSpend / stats.verified)
    : 0;
  stats.yieldPerDollar = stats.eligibleSpend > 0
    ? round6(stats.verified / stats.eligibleSpend)
    : 0;
  stats.unverifiedSpend = round6(Math.max(stats.eligibleSpend - verifiedSpend, 0));
  stats.unverifiedSpendShare = stats.costTotal > 0
    ? round6(stats.unverifiedSpend / stats.costTotal)
    : 0;
  return stats;
}

// ── Aggregator ────────────────────────────────────────────────

export class FactoryPanelAggregator {
  private attempts: FactoryAttemptRecord[] = [];
  private routings: FactoryRoutingRecord[] = [];
  private providerSignals: FactoryProviderRecord[] = [];
  private experimentStops: FactoryExperimentStopRecord[] = [];
  private degraded: Map<string, FactoryDegradedProviderView> = new Map();
  private excludedFixtureEvents = 0;
  private restoredRows = 0;
  private restoreDone = false;

  private readonly historicalStore: HistoricalStore;
  private readonly defaultWindowMs: number;
  private readonly maxWindowMs: number;
  private readonly maxAttempts: number;
  private readonly maxSignalRecords: number;
  private readonly persistEnabled: boolean;

  constructor(options: FactoryPanelOptions = {}) {
    this.historicalStore = options.historicalStore ?? getHistoricalStore();
    this.defaultWindowMs = options.defaultWindowMs ?? DEFAULT_WINDOW_MS;
    this.maxWindowMs = options.maxWindowMs ?? MAX_WINDOW_MS;
    this.maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
    this.maxSignalRecords = options.maxSignalRecords ?? MAX_SIGNAL_RECORDS;
    this.persistEnabled = options.persistence === 'on'
      ? true
      : options.persistence === 'off'
        ? false
        : process.env.FABRIC_FACTORY_PERSISTENCE !== 'off';
  }

  /**
   * Replay persisted rows from the on-disk store. Called lazily before the
   * first snapshot/query so a restarted process restores rather than zeroes.
   * Idempotent; a second call is a no-op.
   */
  restore(): number {
    if (this.restoreDone) return this.restoredRows;
    this.restoreDone = true;
    try {
      const since = Date.now() - this.maxWindowMs;
      const rows = this.historicalStore.getFactoryEvents({ sinceTs: since });
      for (const row of rows) {
        const record = this.reviveRecord(row);
        if (record) this.ingest(record, { replay: true });
      }
      this.restoredRows = rows.length;
    } catch {
      // A missing/corrupt table must never take the panel down — start empty.
      this.restoredRows = 0;
    }
    return this.restoredRows;
  }

  /** Turn a persisted row back into an in-memory record. */
  private reviveRecord(row: {
    ts: number;
    kind: string;
    worker_id: string | null;
    adapter: string | null;
    workspace: string | null;
    payload: string;
  }): FactoryRecord | null {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      return null;
    }
    const worker = row.worker_id ?? '';
    switch (row.kind) {
      case 'attempt_resolved': {
        return {
          kind: 'attempt_resolved',
          ts: row.ts,
          worker,
          adapter: row.adapter ?? (payload.adapter as string) ?? 'unknown',
          model: payload.model as string | undefined,
          provider: payload.provider as string | undefined,
          outcome: String(payload.outcome ?? 'unverified'),
          verified: payload.verified === true,
          decomposed: payload.decomposed === true,
          gateSummary: typeof payload.gateSummary === 'string' ? payload.gateSummary : '',
          tokens: typeof payload.tokens === 'number' ? payload.tokens : 0,
          estimatedCostUsd: typeof payload.estimatedCostUsd === 'number' ? payload.estimatedCostUsd : null,
          costed: payload.costed === true,
          workspace: row.workspace ?? (payload.workspace as string) ?? 'unknown',
          bead: payload.bead as string | undefined,
        };
      }
      case 'evidence_routing':
        return {
          kind: 'evidence_routing',
          ts: row.ts,
          worker,
          decision: String(payload.decision ?? 'unknown'),
          scope: String(payload.scope ?? 'unknown'),
          workspace: payload.workspace as string | undefined,
          adapter: payload.adapter as string | undefined,
          reason: payload.reason as string | undefined,
        };
      case 'provider_degraded':
      case 'provider_restored':
        return {
          kind: row.kind,
          ts: row.ts,
          worker,
          provider: String(payload.provider ?? row.adapter ?? 'unknown'),
          reason: payload.reason as string | undefined,
        };
      case 'experiment_stopped':
        return {
          kind: 'experiment_stopped',
          ts: row.ts,
          worker,
          experiment: String(payload.experiment ?? 'unknown'),
          scope: payload.scope as string | undefined,
        };
      default:
        return null;
    }
  }

  /**
   * Ingest one event from the live stream (JSONL tail, POST /api/events, or
   * OTLP — all converge on the event store). Fixture rows are counted and
   * dropped; factory-relevant events are aggregated and persisted.
   */
  processEvent(event: LogEvent): void {
    this.restore();
    const msg = event.msg;
    let record: FactoryRecord | null = null;

    switch (msg) {
      case FACTORY_EVENT_TYPES.attemptResolved:
        record = this.toAttemptRecord(event);
        break;
      case FACTORY_EVENT_TYPES.evidenceRouting:
        record = this.toRoutingRecord(event);
        break;
      case FACTORY_EVENT_TYPES.providerDegraded:
      case FACTORY_EVENT_TYPES.providerRestored:
        record = this.toProviderRecord(event, msg as 'provider.degraded' | 'provider.restored');
        break;
      case FACTORY_EVENT_TYPES.experimentStopped:
        record = this.toExperimentRecord(event);
        break;
      default:
        return;
    }

    if (!record) return;

    const workspace = 'workspace' in record ? record.workspace : undefined;
    if (isFixtureRow(event.worker, workspace)) {
      this.excludedFixtureEvents++;
      return;
    }

    this.ingest(record, { replay: false });
    this.persist(record);
  }

  private toAttemptRecord(event: LogEvent): FactoryAttemptRecord | null {
    const rec = event as Record<string, unknown>;
    const rawCost = numField(event, 'estimated_cost_usd');
    const costed = rec.costed === true;
    const outcome = strField(event, 'outcome') ?? 'unverified';
    const cost = costed && rawCost !== undefined ? rawCost : null;
    return {
      kind: 'attempt_resolved',
      ts: event.ts,
      worker: event.worker,
      adapter: strField(event, 'adapter') ?? 'unknown',
      model: strField(event, 'model'),
      provider: strField(event, 'provider') ?? event.provider,
      outcome,
      verified: outcome === OUTCOME_VERIFIED,
      decomposed: outcome === OUTCOME_DECOMPOSED,
      gateSummary: summarizeGateResults(rec.gate_results),
      tokens: numField(event, 'tokens') ?? 0,
      estimatedCostUsd: cost,
      // An attempt is costed when NEEDLE says so AND the estimate is usable.
      costed: costed && cost !== null,
      workspace: strField(event, 'workspace') ?? 'unknown',
      bead: event.bead,
    };
  }

  private toRoutingRecord(event: LogEvent): FactoryRoutingRecord | null {
    const decision = strField(event, 'decision') ?? strField(event, 'route');
    if (!decision) return null;
    return {
      kind: 'evidence_routing',
      ts: event.ts,
      worker: event.worker,
      decision,
      scope: strField(event, 'scope') ?? 'unknown',
      workspace: strField(event, 'workspace'),
      adapter: strField(event, 'adapter'),
      reason: strField(event, 'reason'),
    };
  }

  private toProviderRecord(
    event: LogEvent,
    msg: 'provider.degraded' | 'provider.restored'
  ): FactoryProviderRecord | null {
    const provider = strField(event, 'provider') ?? event.provider;
    if (!provider) return null;
    return {
      kind: msg === FACTORY_EVENT_TYPES.providerDegraded ? 'provider_degraded' : 'provider_restored',
      ts: event.ts,
      worker: event.worker,
      provider,
      reason: strField(event, 'reason'),
    };
  }

  private toExperimentRecord(event: LogEvent): FactoryExperimentRecord | null {
    const experiment = strField(event, 'experiment') ?? strField(event, 'experiment_id') ?? event.bead;
    if (!experiment) return null;
    return {
      kind: 'experiment_stopped',
      ts: event.ts,
      worker: event.worker,
      experiment,
      scope: strField(event, 'scope'),
    };
  }

  /** Add a record to the in-memory state. Replayed rows are not re-persisted. */
  private ingest(record: FactoryRecord, opts: { replay: boolean }): void {
    // Prune anything that has fallen outside the max window, then add.
    const cutoff = record.ts - this.maxWindowMs;
    this.pruneOlderThan(cutoff);

    switch (record.kind) {
      case 'attempt_resolved':
        this.attempts.push(record);
        if (this.attempts.length > this.maxAttempts) {
          this.attempts.splice(0, this.attempts.length - this.maxAttempts);
        }
        break;
      case 'evidence_routing':
        this.routings.push(record);
        if (this.routings.length > this.maxSignalRecords) {
          this.routings.splice(0, this.routings.length - this.maxSignalRecords);
        }
        break;
      case 'provider_degraded':
        this.providerSignals.push(record);
        this.degraded.set(record.provider, {
          provider: record.provider,
          sinceTs: record.ts,
          reason: record.reason,
        });
        break;
      case 'provider_restored': {
        this.providerSignals.push(record);
        // Only clear the degraded state if the restore is not stale —
        // out-of-order replays must not resurrect a healthy provider view.
        const current = this.degraded.get(record.provider);
        if (!current || record.ts >= current.sinceTs) {
          this.degraded.delete(record.provider);
        }
        break;
      }
      case 'experiment_stopped':
        this.experimentStops.push(record);
        if (this.experimentStops.length > this.maxSignalRecords) {
          this.experimentStops.splice(0, this.experimentStops.length - this.maxSignalRecords);
        }
        break;
    }

    if (this.providerSignals.length > this.maxSignalRecords * 2) {
      this.providerSignals.splice(0, this.providerSignals.length - this.maxSignalRecords * 2);
    }
  }

  private pruneOlderThan(cutoff: number): void {
    if (this.attempts.length > 0 && this.attempts[0].ts < cutoff) {
      this.attempts = this.attempts.filter((a) => a.ts >= cutoff);
    }
    if (this.routings.length > 0 && this.routings[0].ts < cutoff) {
      this.routings = this.routings.filter((r) => r.ts >= cutoff);
    }
    if (this.providerSignals.length > 0 && this.providerSignals[0].ts < cutoff) {
      this.providerSignals = this.providerSignals.filter((p) => p.ts >= cutoff);
    }
    if (this.experimentStops.length > 0 && this.experimentStops[0].ts < cutoff) {
      this.experimentStops = this.experimentStops.filter((e) => e.ts >= cutoff);
    }
  }

  private persist(record: FactoryRecord): void {
    if (!this.persistEnabled) return;
    try {
      const payload: Record<string, unknown> = { ...record };
      delete (payload as Record<string, unknown>).ts;
      delete (payload as Record<string, unknown>).kind;
      const attempt = record.kind === 'attempt_resolved' ? record : undefined;
      this.historicalStore.recordFactoryEvent({
        ts: record.ts,
        kind: record.kind,
        workerId: record.worker,
        adapter: attempt?.adapter ?? ('adapter' in record ? record.adapter : undefined),
        workspace: attempt?.workspace ?? ('workspace' in record ? record.workspace : undefined),
        payload: JSON.stringify(payload),
      });
    } catch {
      // Persistence failure must not break ingestion; the panel degrades to
      // in-memory-only until the next successful write.
    }
  }

  // ── Queries ────────────────────────────────────────────────

  /**
   * Compute the panel snapshot over a rolling window ending at `now`.
   */
  getSnapshot(options: { windowMs?: number; now?: number } = {}): FactoryPanelSnapshot {
    this.restore();
    const now = options.now ?? Date.now();
    const requested = options.windowMs ?? this.defaultWindowMs;
    const windowMs = Math.min(Math.max(requested, 1), this.maxWindowMs);
    const since = now - windowMs;

    const windowAttempts = this.attempts.filter((a) => a.ts >= since && a.ts <= now);

    const totals = this.aggregate(windowAttempts, 'total');
    const adapters = this.groupBy(windowAttempts, (a) => a.adapter);
    const workspaces = this.groupBy(windowAttempts, (a) => a.workspace);

    const recentRoutings = this.routings
      .filter((r) => r.ts >= since && r.ts <= now)
      .slice(-10)
      .reverse()
      .map((r) => ({
        decision: r.decision,
        scope: r.scope,
        ts: r.ts,
        workspace: r.workspace,
        adapter: r.adapter,
        reason: r.reason,
      }));

    return {
      windowMs,
      generatedAt: now,
      totals,
      adapters,
      workspaces,
      latestRouting: recentRoutings[0] ?? null,
      recentRoutings,
      degradedProviders: [...this.degraded.values()].sort((a, b) => a.sinceTs - b.sinceTs),
      lastExperimentStops: this.experimentStops
        .filter((e) => e.ts >= since && e.ts <= now)
        .slice(-10)
        .reverse()
        .map((e) => ({ experiment: e.experiment, scope: e.scope, ts: e.ts })),
      excludedFixtureEvents: this.excludedFixtureEvents,
      restoredRows: this.restoredRows,
    };
  }

  private aggregate(attempts: FactoryAttemptRecord[], key: string): FactoryGroupStats {
    const acc = emptyGroupStats(key) as GroupAccumulator;
    acc.verifiedSpend = 0;
    for (const a of attempts) {
      acc.attempts++;
      acc.tokens += a.tokens;
      if (a.ts > (acc.lastAttemptTs ?? 0)) acc.lastAttemptTs = a.ts;
      if (a.verified) acc.verified++;
      if (a.decomposed) acc.decomposed++;
      if (!a.costed) {
        acc.uncosted++;
        continue; // no reliable cost — leaves every spend figure
      }
      const cost = a.estimatedCostUsd ?? 0;
      acc.costTotal += cost;
      if (a.decomposed) {
        acc.decomposedSpend += cost;
      } else if (a.verified) {
        acc.verifiedSpend += cost;
      }
    }
    return finalizeGroup(acc);
  }

  private groupBy(
    attempts: FactoryAttemptRecord[],
    keyFn: (a: FactoryAttemptRecord) => string
  ): FactoryGroupStats[] {
    const buckets = new Map<string, FactoryAttemptRecord[]>();
    for (const a of attempts) {
      const key = keyFn(a) || 'unknown';
      const bucket = buckets.get(key);
      if (bucket) bucket.push(a);
      else buckets.set(key, [a]);
    }
    const groups = [...buckets.entries()]
      .map(([key, rows]) => this.aggregate(rows, key))
      .sort((a, b) => b.attempts - a.attempts || a.key.localeCompare(b.key));
    return groups;
  }

  /** Direct read access for tests and advanced consumers. */
  getAttemptCount(): number {
    return this.attempts.length;
  }
}

type FactoryExperimentStopRecord = FactoryExperimentRecord;

// ── Singleton ─────────────────────────────────────────────────

let globalFactoryPanel: FactoryPanelAggregator | undefined;

export function getFactoryPanelAggregator(): FactoryPanelAggregator {
  if (!globalFactoryPanel) {
    globalFactoryPanel = new FactoryPanelAggregator();
    globalFactoryPanel.restore();
  }
  return globalFactoryPanel;
}

/** Reset the singleton (tests). Installs the given instance when provided. */
export function resetFactoryPanelAggregator(instance?: FactoryPanelAggregator): void {
  globalFactoryPanel = instance;
}

/** Parse a human window label ('1h', '24h', '7d') or raw ms into milliseconds. */
export function parseWindowLabel(value: string): number | null {
  const m = /^(\d+)(ms|s|m|h|d)?$/.exec(value.trim());
  if (!m) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const n = Number(m[1]);
  const unitMs: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return n * (unitMs[m[2] ?? 'ms']);
}
