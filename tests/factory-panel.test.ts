/**
 * Factory panel acceptance tests (bead fabric-9bcccd53)
 *
 * Covers:
 *  1. Fixture events yield the expected verified-closure yields and costs,
 *     per adapter and per workspace, over a rolling window.
 *  2. A simulated restart restores the panel from the on-disk store
 *     (SQLite via HistoricalStore) rather than zeroing it.
 *  3. Fixture rows — worker ids ending in `-test-worker`, and the synthetic
 *     workspace `.` — are excluded from every figure.
 *
 * ADR-030 accounting: `decomposed` attempts and `costed=false` attempts are
 * reported but leave the yield and spend math respectively.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { LogEvent } from '../src/types.js';
import { HistoricalStore } from '../src/historicalStore.js';
import {
  FactoryPanelAggregator,
  isFixtureRow,
  parseWindowLabel,
} from '../src/factoryPanel.js';
import { parseLogLine } from '../src/parser.js';

// ── Fixture plumbing ─────────────────────────────────────────

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Base for fixture timestamps: 1 hour before the test runs. */
const BASE = Date.now() - HOUR;
/** Fixture event times, one per minute from BASE. */
const t = (minute: number) => BASE + minute * MIN;

type EventOverrides = Record<string, unknown> & { worker?: string; ts?: number };

function factoryEvent(msg: string, overrides: EventOverrides = {}): LogEvent {
  const { worker, ts, ...fields } = overrides;
  return {
    ts: ts ?? 0,
    worker: worker ?? 'claude-code-glm-5.3-flash-roam-1',
    level: 'info',
    msg,
    ...fields,
  } as LogEvent;
}

function attempt(overrides: EventOverrides = {}): LogEvent {
  return factoryEvent('attempt.resolved', {
    ts: t(1),
    adapter: 'glm-5.3-flash',
    model: 'glm-5.3',
    provider: 'zhipu',
    workspace: 'FABRIC',
    outcome: 'unverified',
    costed: true,
    estimated_cost_usd: 0,
    tokens: 0,
    ...overrides,
  });
}

/**
 * The full fixture ledger. Times are strictly increasing so the restart
 * replay (ordered by ts) reproduces routing recency and provider state.
 */
function fixtureEvents(): LogEvent[] {
  return [
    // glm-5.3-flash / FABRIC: 2 verified, 1 failed, 1 decomposed
    attempt({ ts: t(1), outcome: 'verified', estimated_cost_usd: 0.1, tokens: 100, bead: 'fabric-aaaa',
      gate_results: [{ name: 'tests', passed: true }] }),
    attempt({ ts: t(2), outcome: 'verified', estimated_cost_usd: 0.3, tokens: 200, bead: 'fabric-bbbb',
      gate_results: { tests: true, build: true } }),
    attempt({ ts: t(3), outcome: 'failed', estimated_cost_usd: 0.6, tokens: 300, bead: 'fabric-cccc',
      gate_results: [{ name: 'tests', passed: false }] }),
    attempt({ ts: t(4), outcome: 'decomposed', estimated_cost_usd: 0.25, tokens: 50, bead: 'fabric-dddd' }),
    // claude-opus-5 / NEEDLE: 1 verified, 1 uncosted
    attempt({ ts: t(5), adapter: 'claude-opus-5', model: 'opus', provider: 'anthropic',
      workspace: 'NEEDLE', outcome: 'verified', estimated_cost_usd: 1.0, tokens: 1000, bead: 'needle-aaaa' }),
    attempt({ ts: t(6), adapter: 'claude-opus-5', model: 'opus', provider: 'anthropic',
      workspace: 'NEEDLE', outcome: 'unverified', costed: false, tokens: 400, bead: 'needle-bbbb' }),
    // evidence routing — the later one wins as "latest"
    factoryEvent('agent.evidence_routing', { ts: t(7), decision: 'full_context', scope: 'bead' }),
    factoryEvent('agent.evidence_routing', { ts: t(8), decision: 'compact_digest', scope: 'session', workspace: 'FABRIC' }),
    // provider health — anthropic degrades then restores; google-vertex stays degraded
    factoryEvent('provider.degraded', { ts: t(9), provider: 'anthropic', reason: '5xx spike' }),
    factoryEvent('provider.restored', { ts: t(10), provider: 'anthropic' }),
    factoryEvent('provider.degraded', { ts: t(11), provider: 'google-vertex', reason: 'quota exhausted' }),
    // experiment lifecycle
    factoryEvent('experiment.stopped', { ts: t(12), experiment: 'routing-a-b', scope: 'fleet' }),
    // fixture rows — must never reach the aggregates
    attempt({ ts: t(13), worker: 'w-fixture-test-worker', outcome: 'verified', estimated_cost_usd: 999, tokens: 9 }),
    attempt({ ts: t(14), worker: 'w-real', workspace: '.', outcome: 'verified', estimated_cost_usd: 999, tokens: 9 }),
  ];
}

// ── Temp-store lifecycle ─────────────────────────────────────

const tempDirs: string[] = [];
const stores: HistoricalStore[] = [];

function makeStore(): HistoricalStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-factory-'));
  tempDirs.push(dir);
  const store = new HistoricalStore(path.join(dir, 'factory-test.db'));
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function ingestAll(aggregator: FactoryPanelAggregator, events: LogEvent[]): void {
  for (const e of events) aggregator.processEvent(e);
}

// ── 1. Yields and costs from fixture events ──────────────────

describe('factory panel — yields and costs from fixture events', () => {
  it('computes fleet totals over a rolling 24h window', () => {
    const aggregator = new FactoryPanelAggregator({ historicalStore: makeStore(), persistence: 'on' });
    ingestAll(aggregator, fixtureEvents());

    const snap = aggregator.getSnapshot({ windowMs: 24 * HOUR });
    const totals = snap.totals;

    expect(totals.attempts).toBe(6);
    expect(totals.verified).toBe(3);
    expect(totals.decomposed).toBe(1);
    expect(totals.uncosted).toBe(1);
    expect(totals.eligibleAttempts).toBe(5); // attempts minus decomposed

    // verified-closure yield per attempt = 3 / 5
    expect(totals.yieldPerAttempt).toBeCloseTo(0.6, 6);

    // spend: 0.10 + 0.30 + 0.60 + 0.25 + 1.00 = 2.25; decomposed 0.25 → eligible 2.00
    expect(totals.costTotal).toBeCloseTo(2.25, 6);
    expect(totals.decomposedSpend).toBeCloseTo(0.25, 6);
    expect(totals.eligibleSpend).toBeCloseTo(2.0, 6);

    // verified closures per dollar = 3 / 2.00 = 1.5
    expect(totals.yieldPerDollar).toBeCloseTo(1.5, 6);
    // cost per verified closure = 2.00 / 3
    expect(totals.costPerVerifiedClosure).toBeCloseTo(2 / 3, 6);

    // unverified spend = eligible spend minus verified spend (1.40) = 0.60
    expect(totals.unverifiedSpend).toBeCloseTo(0.6, 6);
    expect(totals.unverifiedSpendShare).toBeCloseTo(0.6 / 2.25, 6);

    expect(totals.tokens).toBe(2050);
    expect(totals.lastAttemptTs).toBe(t(6));
  });

  it('breaks the same figures out per adapter', () => {
    const aggregator = new FactoryPanelAggregator({ historicalStore: makeStore(), persistence: 'on' });
    ingestAll(aggregator, fixtureEvents());

    const snap = aggregator.getSnapshot({ windowMs: 24 * HOUR });
    expect(snap.adapters.map((g) => g.key).sort()).toEqual(['claude-opus-5', 'glm-5.3-flash']);

    const glm = snap.adapters.find((g) => g.key === 'glm-5.3-flash')!;
    expect(glm.attempts).toBe(4);
    expect(glm.verified).toBe(2);
    expect(glm.decomposed).toBe(1); // decomposed shown separately (ADR-030)
    expect(glm.eligibleAttempts).toBe(3);
    expect(glm.yieldPerAttempt).toBeCloseTo(2 / 3, 6);
    expect(glm.costTotal).toBeCloseTo(1.25, 6);
    expect(glm.decomposedSpend).toBeCloseTo(0.25, 6);
    expect(glm.eligibleSpend).toBeCloseTo(1.0, 6);
    expect(glm.yieldPerDollar).toBeCloseTo(2.0, 6);
    expect(glm.costPerVerifiedClosure).toBeCloseTo(0.5, 6);
    expect(glm.unverifiedSpend).toBeCloseTo(0.6, 6);
    expect(glm.unverifiedSpendShare).toBeCloseTo(0.48, 6);
    expect(glm.tokens).toBe(650);

    const opus = snap.adapters.find((g) => g.key === 'claude-opus-5')!;
    expect(opus.attempts).toBe(2);
    expect(opus.verified).toBe(1);
    expect(opus.uncosted).toBe(1); // costed=false shown separately (ADR-030)
    expect(opus.costTotal).toBeCloseTo(1.0, 6); // uncosted attempt leaves the spend math
    expect(opus.yieldPerAttempt).toBeCloseTo(0.5, 6);
    expect(opus.yieldPerDollar).toBeCloseTo(1.0, 6);
    expect(opus.costPerVerifiedClosure).toBeCloseTo(1.0, 6);
    expect(opus.unverifiedSpend).toBe(0);
  });

  it('breaks the same figures out per workspace', () => {
    const aggregator = new FactoryPanelAggregator({ historicalStore: makeStore(), persistence: 'on' });
    ingestAll(aggregator, fixtureEvents());

    const snap = aggregator.getSnapshot({ windowMs: 24 * HOUR });
    expect(snap.workspaces.map((g) => g.key).sort()).toEqual(['FABRIC', 'NEEDLE']);

    const fabric = snap.workspaces.find((g) => g.key === 'FABRIC')!;
    expect(fabric.attempts).toBe(4);
    expect(fabric.verified).toBe(2);
    expect(fabric.yieldPerAttempt).toBeCloseTo(2 / 3, 6);
    expect(fabric.yieldPerDollar).toBeCloseTo(2.0, 6);

    const needle = snap.workspaces.find((g) => g.key === 'NEEDLE')!;
    expect(needle.attempts).toBe(2);
    expect(needle.verified).toBe(1);
    expect(needle.uncosted).toBe(1);
    expect(needle.costTotal).toBeCloseTo(1.0, 6);
  });

  it('excludes an attempt that falls outside the rolling window', () => {
    const aggregator = new FactoryPanelAggregator({ historicalStore: makeStore(), persistence: 'on' });
    ingestAll(aggregator, fixtureEvents());
    // 3 days old — inside the 7d retention, outside a 24h window
    ingestAll(aggregator, [
      attempt({ ts: Date.now() - 3 * DAY, outcome: 'verified', estimated_cost_usd: 5, workspace: 'FABRIC' }),
    ]);

    expect(aggregator.getSnapshot({ windowMs: 24 * HOUR }).totals.attempts).toBe(6);
    const week = aggregator.getSnapshot({ windowMs: 7 * DAY });
    expect(week.totals.attempts).toBe(7);
    expect(week.totals.verified).toBe(4);
  });

  it('surfaces the latest routing decision with its scope, degraded providers, and experiment stops', () => {
    const aggregator = new FactoryPanelAggregator({ historicalStore: makeStore(), persistence: 'on' });
    ingestAll(aggregator, fixtureEvents());

    const snap = aggregator.getSnapshot({ windowMs: 24 * HOUR });

    expect(snap.latestRouting).not.toBeNull();
    expect(snap.latestRouting!.decision).toBe('compact_digest');
    expect(snap.latestRouting!.scope).toBe('session');
    expect(snap.latestRouting!.ts).toBe(t(8));
    expect(snap.recentRoutings.map((r) => r.decision)).toEqual(['compact_digest', 'full_context']);

    // anthropic degraded then restored → only google-vertex is currently degraded
    expect(snap.degradedProviders).toEqual([
      { provider: 'google-vertex', sinceTs: t(11), reason: 'quota exhausted' },
    ]);

    expect(snap.lastExperimentStops).toEqual([
      { experiment: 'routing-a-b', scope: 'fleet', ts: t(12) },
    ]);
  });

  it('ingests the same figures from the JSONL tail path', () => {
    const aggregator = new FactoryPanelAggregator({ historicalStore: makeStore(), persistence: 'on' });

    // A canonical NeedleEvent line as NEEDLE writes it to a per-worker JSONL.
    const line = JSON.stringify({
      timestamp: new Date(t(20)).toISOString(),
      event_type: 'attempt.resolved',
      worker_id: 'claude-code-glm-5.3-flash-roam-21',
      session_id: 'roam-21',
      sequence: 41,
      bead_id: 'fabric-eeee',
      data: {
        adapter: 'glm-5.3-flash',
        model: 'glm-5.3',
        provider: 'zhipu',
        workspace: 'FABRIC',
        outcome: 'verified',
        gate_results: [{ name: 'tests', passed: true }],
        tokens: 150,
        estimated_cost_usd: 0.2,
        costed: true,
      },
    });
    const event = parseLogLine(line);
    expect(event).not.toBeNull();
    aggregator.processEvent(event!);

    const totals = aggregator.getSnapshot({ windowMs: 24 * HOUR }).totals;
    expect(totals.attempts).toBe(1);
    expect(totals.verified).toBe(1);
    expect(totals.yieldPerAttempt).toBe(1);
    expect(totals.costTotal).toBeCloseTo(0.2, 6);
    expect(totals.yieldPerDollar).toBeCloseTo(1 / 0.2, 6);
    expect(totals.costPerVerifiedClosure).toBeCloseTo(0.2, 6);
    expect(totals.unverifiedSpendShare).toBe(0);
  });
});

// ── 2. Simulated restart restores from the store ─────────────

describe('factory panel — restart replays from the on-disk store', () => {
  it('restores totals, groups, routing, and provider state after a restart', () => {
    const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-factory-')), 'restart.db');
    tempDirs.push(path.dirname(dbPath));

    // First process: ingest the fixture ledger and snapshot it.
    const firstStore = new HistoricalStore(dbPath);
    stores.push(firstStore);
    const firstProcess = new FactoryPanelAggregator({ historicalStore: firstStore, persistence: 'on' });
    ingestAll(firstProcess, fixtureEvents());
    const before = firstProcess.getSnapshot({ windowMs: 24 * HOUR });
    firstStore.close();
    stores.pop();

    // Second process: same database, fresh aggregator, zero new events.
    const reopenedStore = new HistoricalStore(dbPath);
    stores.push(reopenedStore);
    const restarted = new FactoryPanelAggregator({ historicalStore: reopenedStore, persistence: 'on' });
    const after = restarted.getSnapshot({ windowMs: 24 * HOUR });

    // Every non-fixture ledger row was persisted and replayed (12 of 14).
    expect(after.restoredRows).toBe(12);

    expect(after.totals).toEqual(before.totals);
    expect(after.adapters).toEqual(before.adapters);
    expect(after.workspaces).toEqual(before.workspaces);
    expect(after.recentRoutings).toEqual(before.recentRoutings);
    expect(after.latestRouting).toEqual(before.latestRouting);
    expect(after.degradedProviders).toEqual(before.degradedProviders);
    expect(after.lastExperimentStops).toEqual(before.lastExperimentStops);

    // The replayed state keeps accumulating on top of the restored rows.
    ingestAll(restarted, [attempt({ ts: t(30), outcome: 'verified', estimated_cost_usd: 0.5, tokens: 100 })]);
    const grown = restarted.getSnapshot({ windowMs: 24 * HOUR });
    expect(grown.totals.attempts).toBe(before.totals.attempts + 1);
    expect(grown.totals.verified).toBe(before.totals.verified + 1);
  });

  it('skips persistence when persistence is off but keeps the in-memory view', () => {
    const store = makeStore();
    const aggregator = new FactoryPanelAggregator({ historicalStore: store, persistence: 'off' });
    ingestAll(aggregator, [attempt({ ts: t(35), outcome: 'verified', estimated_cost_usd: 0.2 })]);

    expect(store.getFactoryEvents({})).toHaveLength(0);
    expect(aggregator.getSnapshot({ windowMs: 24 * HOUR }).totals.attempts).toBe(1);
  });

  it('starts empty when the store has no ledger rows', () => {
    const aggregator = new FactoryPanelAggregator({ historicalStore: makeStore(), persistence: 'on' });
    const snap = aggregator.getSnapshot({ windowMs: 24 * HOUR });
    expect(snap.totals.attempts).toBe(0);
    expect(snap.totals.yieldPerAttempt).toBe(0);
    expect(snap.adapters).toEqual([]);
    expect(snap.latestRouting).toBeNull();
    expect(snap.degradedProviders).toEqual([]);
  });

  it('receives events that flow through the event store (store.add wiring)', async () => {
    const { InMemoryEventStore } = await import('../src/store.js');
    const { resetFactoryPanelAggregator } = await import('../src/factoryPanel.js');

    const store = makeStore();
    const wired = new FactoryPanelAggregator({ historicalStore: store, persistence: 'on' });
    resetFactoryPanelAggregator(wired);
    try {
      const eventStore = new InMemoryEventStore();
      eventStore.add(attempt({ ts: t(40), outcome: 'verified', estimated_cost_usd: 0.75, tokens: 800 }));
      eventStore.add(factoryEvent('provider.degraded', { ts: t(41), provider: 'zhipu', reason: 'SLO' }));

      const snap = wired.getSnapshot({ windowMs: 24 * HOUR });
      expect(snap.totals.attempts).toBe(1);
      expect(snap.totals.verified).toBe(1);
      expect(snap.degradedProviders.map((p) => p.provider)).toEqual(['zhipu']);
    } finally {
      resetFactoryPanelAggregator();
    }
  });
});

// ── 3. Fixture-row exclusion ─────────────────────────────────

describe('factory panel — fixture rows are excluded', () => {
  it('drops test-worker rows and the synthetic workspace "." entirely', () => {
    const aggregator = new FactoryPanelAggregator({ historicalStore: makeStore(), persistence: 'on' });
    ingestAll(aggregator, fixtureEvents());

    const snap = aggregator.getSnapshot({ windowMs: 24 * HOUR });

    // The $999 verified fixture attempts never appear anywhere.
    expect(snap.excludedFixtureEvents).toBe(2);
    expect(snap.totals.costTotal).toBeCloseTo(2.25, 6);
    expect(snap.workspaces.map((g) => g.key)).not.toContain('.');
    expect(snap.workspaces.map((g) => g.key)).not.toContain('unknown');
    // adapter/workspace groups stay limited to the real ones
    expect(snap.adapters).toHaveLength(2);
    expect(snap.workspaces).toHaveLength(2);

    // and nothing fixture-shaped reached the on-disk ledger either
    const store = stores[stores.length - 1];
    const rows = store.getFactoryEvents({});
    expect(rows.every((r) => r.worker_id !== 'w-fixture-test-worker')).toBe(true);
    expect(rows.every((r) => r.workspace !== '.')).toBe(true);
  });

  it('classifies fixture rows by worker suffix and workspace marker', () => {
    expect(isFixtureRow('w-fixture-test-worker', 'FABRIC')).toBe(true);
    expect(isFixtureRow('claude-code-glm-5.3-flash-roam-21-test-worker', 'FABRIC')).toBe(true);
    expect(isFixtureRow('claude-code-glm-5.3-flash-roam-21', '.')).toBe(true);
    expect(isFixtureRow('claude-code-glm-5.3-flash-roam-21', 'FABRIC')).toBe(false);
  });
});

// ── Window parsing (API surface) ─────────────────────────────

describe('factory panel — window label parsing', () => {
  it('parses human window labels and raw milliseconds', () => {
    expect(parseWindowLabel('1h')).toBe(HOUR);
    expect(parseWindowLabel('24h')).toBe(24 * HOUR);
    expect(parseWindowLabel('7d')).toBe(7 * DAY);
    expect(parseWindowLabel('30m')).toBe(30 * MIN);
    expect(parseWindowLabel('500ms')).toBe(500);
    expect(parseWindowLabel('3600000')).toBe(HOUR);
    expect(parseWindowLabel('nonsense')).toBeNull();
  });
});
