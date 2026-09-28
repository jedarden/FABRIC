/**
 * Tests for alert deduplication (docs/alert-policy.md)
 *
 * Acceptance contract: repeated no-work / stuck observations maintain ONE
 * active alert instance ("one active bead"), while a resolved condition can
 * produce a NEW alert.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  alertIdentity,
  AlertManager,
  AlertRecord,
  AlertStatus,
  DEFAULT_ALERT_COOLDOWN_MS,
  reconcileLegacyAlerts,
} from './alertManager.js';
import { InMemoryEventStore } from './store.js';
import { LogEvent } from './types.js';

/** Fixed clock: each call advances 1s so identical timestamps are opt-in. */
function makeClock(start = 1_000_000) {
  let t = start;
  return () => (t += 1000);
}

describe('alert identity', () => {
  it('is a pure function of kind and scope', () => {
    expect(alertIdentity('no-work', 'w-alpha')).toBe('no-work:w-alpha');
    expect(alertIdentity('no-work', 'w-alpha')).toBe(alertIdentity('no-work', 'w-alpha'));
  });

  it('separates kinds and scopes', () => {
    expect(alertIdentity('no-work', 'w-alpha')).not.toBe(alertIdentity('stuck', 'w-alpha'));
    expect(alertIdentity('stuck', 'w-alpha')).not.toBe(alertIdentity('stuck', 'w-bravo'));
  });

  it('does not depend on the observation reason', () => {
    const mgr = new AlertManager({ now: makeClock() });
    const first = mgr.observe('stuck', 'w-alpha', { reason: 'No activity for 3m' });
    mgr.resolve('stuck', 'w-alpha');
    // A different reason text for the same condition must not fork identity:
    // the new epoch is epoch 2 of the same identity, not a new identity.
    const second = mgr.observe('stuck', 'w-alpha', { reason: 'Repeated tool calls on src/auth.ts' });
    expect(second.alert.identity).toBe(first.alert.identity);
    expect(second.alert.id).not.toBe(first.alert.id);
  });
});

describe('repeated observations maintain one active alert', () => {
  it('opens exactly one active instance for repeated observations', () => {
    const clock = makeClock();
    const mgr = new AlertManager({ now: clock });

    const first = mgr.observe('no-work', 'w-alpha');
    expect(first.outcome).toBe('created');
    for (let i = 0; i < 10; i++) {
      const result = mgr.observe('no-work', 'w-alpha');
      expect(result.outcome).toBe('deduplicated');
      expect(result.alert.id).toBe(first.alert.id);
    }

    expect(mgr.activeAlerts()).toHaveLength(1);
    expect(mgr.activeAlerts()[0].id).toBe(first.alert.id);
    expect(mgr.activeAlerts()[0].occurrences).toBe(11);
  });

  it('folds repeated observations into the same stuck alert and tracks evidence', () => {
    const clock = makeClock();
    const mgr = new AlertManager({ now: clock });

    const first = mgr.observe('stuck', 'w-alpha', { reason: 'No activity for 3m' });
    const second = mgr.observe('stuck', 'w-alpha', { reason: 'No activity for 6m' });

    expect(second.outcome).toBe('deduplicated');
    expect(second.alert.id).toBe(first.alert.id);
    expect(second.alert.occurrences).toBe(2);
    expect(second.alert.lastReason).toBe('No activity for 6m');
    expect(second.alert.firstObservedAt).toBe(first.alert.firstObservedAt);
  });

  it('suppresses re-notification within the cooldown window', () => {
    let t = 1_000_000;
    const mgr = new AlertManager({ now: () => t });

    mgr.observe('no-work', 'w-alpha');
    t += DEFAULT_ALERT_COOLDOWN_MS - 1;
    const stillCooling = mgr.observe('no-work', 'w-alpha');
    expect(stillCooling.outcome).toBe('deduplicated');
    expect(stillCooling.alert.notifications).toBe(1);
  });

  it('escalates an ongoing condition after cooldown without creating a new alert', () => {
    let t = 1_000_000;
    const mgr = new AlertManager({ now: () => t });

    const first = mgr.observe('stuck', 'w-alpha');
    t += DEFAULT_ALERT_COOLDOWN_MS;
    const escalated = mgr.observe('stuck', 'w-alpha');

    expect(escalated.outcome).toBe('escalated');
    expect(escalated.alert.id).toBe(first.alert.id);
    expect(escalated.alert.notifications).toBe(2);
    expect(mgr.activeAlerts()).toHaveLength(1);
  });

  it('keeps conditions independent across kinds and workers', () => {
    const clock = makeClock();
    const mgr = new AlertManager({ now: clock });

    const noWork = mgr.observe('no-work', 'w-alpha');
    const stuck = mgr.observe('stuck', 'w-alpha');
    const otherWorker = mgr.observe('no-work', 'w-bravo');

    expect(noWork.outcome).toBe('created');
    expect(stuck.outcome).toBe('created');
    expect(otherWorker.outcome).toBe('created');
    expect(mgr.activeAlerts()).toHaveLength(3);
    expect(new Set(mgr.activeAlerts().map((a) => a.id)).size).toBe(3);
  });
});

describe('resolution workflow', () => {
  it('resolves the active instance exactly once', () => {
    const clock = makeClock();
    const mgr = new AlertManager({ now: clock });

    mgr.observe('no-work', 'w-alpha');
    const resolved = mgr.resolve('no-work', 'w-alpha', { note: 'work available again' });

    expect(resolved).not.toBeNull();
    expect(resolved!.status).toBe('resolved');
    expect(resolved!.resolvedAt).not.toBeNull();
    expect(resolved!.resolutionNote).toBe('work available again');
    // Active surface is empty once resolved; the record remains as history.
    expect(mgr.activeAlerts()).toHaveLength(0);
    expect(mgr.active('no-work', 'w-alpha')).toBeNull();
    expect(mgr.history()).toHaveLength(1);
    expect(mgr.history()[0].id).toBe(resolved!.id);
  });

  it('is idempotent — resolving with no active instance is a no-op', () => {
    const mgr = new AlertManager({ now: makeClock() });
    expect(mgr.resolve('no-work', 'w-alpha')).toBeNull();

    mgr.observe('stuck', 'w-alpha');
    mgr.resolve('stuck', 'w-alpha');
    expect(mgr.resolve('stuck', 'w-alpha')).toBeNull();
  });

  it('a resolved condition can produce a new alert', () => {
    const clock = makeClock();
    const mgr = new AlertManager({ now: clock });

    const first = mgr.observe('no-work', 'w-alpha');
    mgr.observe('no-work', 'w-alpha'); // dedup
    mgr.resolve('no-work', 'w-alpha');

    const recurred = mgr.observe('no-work', 'w-alpha');
    expect(recurred.outcome).toBe('new-epoch');
    expect(recurred.alert.epoch).toBe(2);
    expect(recurred.alert.id).not.toBe(first.alert.id);
    expect(recurred.alert.status).toBe('active');
    expect(recurred.alert.occurrences).toBe(1);
    expect(recurred.previous?.id).toBe(first.alert.id);

    // Exactly one ACTIVE alert for the condition, and the resolved record is
    // untouched history.
    expect(mgr.active('no-work', 'w-alpha')?.id).toBe(recurred.alert.id);
    expect(first.alert.status).toBe('resolved');
    expect(first.alert.occurrences).toBe(2);
    expect(first.alert.resolvedAt).not.toBeNull();
  });

  it('supports repeated resolve/recurrence cycles with monotonic epochs', () => {
    const clock = makeClock();
    const mgr = new AlertManager({ now: clock });

    const ids: string[] = [];
    for (let cycle = 1; cycle <= 3; cycle++) {
      const observed = mgr.observe('stuck', 'w-alpha');
      expect(observed.outcome).toBe(cycle === 1 ? 'created' : 'new-epoch');
      ids.push(observed.alert.id);
      mgr.resolve('stuck', 'w-alpha');
    }

    expect(new Set(ids).size).toBe(3);
    const epochs = mgr.history().map((r) => r.epoch);
    expect(epochs).toEqual([1, 2, 3]);
    expect(mgr.active('stuck', 'w-alpha')).toBeNull();
    expect(mgr.history().every((r) => r.status === 'resolved')).toBe(true);
  });
});

describe('registry housekeeping', () => {
  it('reports full history across identities and clears cleanly', () => {
    const clock = makeClock();
    const mgr = new AlertManager({ now: clock });

    mgr.observe('no-work', 'w-alpha');
    mgr.observe('stuck', 'w-bravo');
    mgr.resolve('no-work', 'w-alpha');

    expect(mgr.history()).toHaveLength(2);
    mgr.clear();
    expect(mgr.history()).toHaveLength(0);
    expect(mgr.activeAlerts()).toHaveLength(0);
  });

  it('defaults the clock to Date.now', () => {
    const mgr = new AlertManager();
    const before = Date.now();
    const result = mgr.observe('no-work', 'w-alpha');
    expect(result.alert.createdAt).toBeGreaterThanOrEqual(before);
  });
});

describe('event store alert wiring', () => {
  let store: InMemoryEventStore;

  beforeEach(() => {
    store = new InMemoryEventStore();
  });

  function addEvent(overrides: Partial<LogEvent>): void {
    store.add({
      ts: Date.now(),
      worker: 'w-alpha',
      level: 'info',
      msg: '',
      ...overrides,
    } as LogEvent);
  }

  it('repeated queue-empty observations maintain one active no-work alert', () => {
    for (let i = 0; i < 5; i++) {
      addEvent({ msg: 'worker.queue_empty' });
    }

    const active = store.getActiveAlerts();
    expect(active).toHaveLength(1);
    expect(active[0].kind).toBe('no-work');
    expect(active[0].scope).toBe('w-alpha');
    expect(active[0].occurrences).toBe(5);
  });

  it('a claimed bead resolves the no-work alert and a later dry spell opens a new one', () => {
    addEvent({ msg: 'worker.queue_empty' });
    addEvent({ msg: 'worker.queue_empty' });
    addEvent({ msg: 'bead.claim.succeeded', bead: 'fabric-abc' });

    expect(store.getActiveAlerts()).toHaveLength(0);
    const history = store.getAlertHistory();
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('resolved');
    expect(history[0].resolutionNote).toBe('worker claimed a bead');

    // Condition recurred → NEW alert, resolved record untouched.
    addEvent({ msg: 'worker.exhausted' });
    const active = store.getActiveAlerts();
    expect(active).toHaveLength(1);
    expect(active[0].id).not.toBe(history[0].id);
    expect(active[0].epoch).toBe(2);
    expect(history[0].status).toBe('resolved');
  });

  it('clear() resets alert state', () => {
    addEvent({ msg: 'worker.queue_empty' });
    expect(store.getActiveAlerts()).toHaveLength(1);

    store.clear();
    expect(store.getActiveAlerts()).toHaveLength(0);
    expect(store.getAlertHistory()).toHaveLength(0);
  });

  it('restoreAlertRecords reconciles legacy state and add() deduplicates into the survivor', () => {
    // A pre-policy snapshot: two active no-work records for the same worker.
    const canonical = legacy('no-work', 'w-alpha', RB, {
      epoch: 1,
      occurrences: 3,
      lastNotifiedAt: RB,
    });
    const report = store.restoreAlertRecords([
      canonical,
      legacy('no-work', 'w-alpha', RB + MIN, { epoch: 2 }),
    ]);
    expect(report.duplicatesClosed).toBe(1);
    expect(store.getActiveAlerts()).toHaveLength(1);
    expect(store.getActiveAlerts()[0].id).toBe(canonical.id);

    // The next live observation enters through add() — the single
    // enforcement point — and folds into the survivor: the inventory stays
    // one-active-per-identity from restore onward.
    store.add({
      ts: RB + 2 * MIN,
      worker: 'w-alpha',
      level: 'info',
      msg: 'worker.queue_empty',
    } as LogEvent);
    const active = store.getActiveAlerts();
    expect(active).toHaveLength(1);
    expect(active[0].occurrences).toBe(5); // 3 + 1 duplicate fold + 1 live
    expect(store.getAlertHistory()).toHaveLength(2); // closed duplicate + survivor

    // Reconciling the now-conforming inventory is a documented no-op.
    const noop = store.reconcileLegacyAlerts();
    expect(noop.duplicatesClosed).toBe(0);
    expect(store.getActiveAlerts()).toHaveLength(1);
  });
});

describe('record shape', () => {
  it('exposes the fields a bead-filing integration keys on', () => {
    const clock = makeClock();
    const mgr = new AlertManager({ now: clock });
    const result = mgr.observe('stuck', 'w-alpha', { reason: 'state gap' });
    const record: AlertRecord = result.alert;

    expect(record.id).toBe('stuck:w-alpha#1');
    expect(record.identity).toBe('stuck:w-alpha');
    expect(record.kind).toBe('stuck');
    expect(record.scope).toBe('w-alpha');
    expect(record.epoch).toBe(1);
    expect(record.status).toBe('active');
    expect(record.notifications).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Store → alert-bead path, end to end (docs/alert-policy.md)
//
// The unit pins above exercise the manager directly; these exercise the
// whole path the live dashboard takes — every NEEDLE observation enters
// through InMemoryEventStore.add() and the store's observation sites own
// the observe/resolve calls. Each policy clause is pinned as it behaves
// through that path: duplicate observations, drifting evidence, cooldown
// escalation, idempotent resolution, and recurrence.
// ─────────────────────────────────────────────────────────────────────────
describe('event store alert policy end to end', () => {
  const BASE = 1_750_000_000_000;
  const MIN = 60_000;

  let store: InMemoryEventStore;

  beforeEach(() => {
    store = new InMemoryEventStore();
  });

  afterEach(() => {
    store.clear();
  });

  function add(worker: string, overrides: Partial<LogEvent>): void {
    store.add({ ts: BASE, worker, level: 'info', msg: '', ...overrides } as LogEvent);
  }

  it('folds repeated no-work observations of any signal into one active alert', () => {
    add('w-alpha', { ts: BASE, msg: 'worker.queue_empty' });
    add('w-alpha', { ts: BASE + MIN, msg: 'worker.exhausted' });
    add('w-alpha', { ts: BASE + 2 * MIN, msg: 'worker.queue_empty' });
    add('w-alpha', { ts: BASE + 3 * MIN, msg: 'worker.exhausted' });

    const active = store.getActiveAlerts();
    expect(active).toHaveLength(1);
    expect(active[0].identity).toBe('no-work:w-alpha');
    expect(active[0].occurrences).toBe(4);
    expect(active[0].notifications).toBe(1);
    expect(active[0].lastObservedAt).toBe(BASE + 3 * MIN);
    expect(store.getAlertHistory()).toHaveLength(1);
  });

  it('keeps one alert when the observation reason drifts', () => {
    add('w-alpha', { ts: BASE, msg: 'worker.queue_empty' });
    const id = store.getActiveAlerts()[0].id;

    add('w-alpha', { ts: BASE + MIN, msg: 'worker.exhausted' });
    add('w-alpha', { ts: BASE + 2 * MIN, msg: 'worker.queue_empty' });

    const active = store.getActiveAlerts();
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(id);
    expect(active[0].occurrences).toBe(3);
    expect(active[0].lastReason).toBe('worker.queue_empty');
    expect(store.getAlertHistory()).toHaveLength(1);
  });

  it('suppresses re-notification within the cooldown and escalates after it on the same instance', () => {
    add('w-alpha', { ts: BASE, msg: 'worker.queue_empty' });

    // The dry spell keeps being observed, but the condition already surfaced.
    for (const offset of [1, 10, 29]) {
      add('w-alpha', { ts: BASE + offset * MIN, msg: 'worker.queue_empty' });
    }
    let alert = store.getActiveAlerts()[0];
    expect(alert.notifications).toBe(1);

    // DEFAULT_ALERT_COOLDOWN_MS after the open, the ongoing condition
    // re-surfaces — as an escalation of the SAME instance, never a new bead.
    add('w-alpha', { ts: BASE + 30 * MIN, msg: 'worker.queue_empty' });
    alert = store.getActiveAlerts()[0];
    expect(alert.notifications).toBe(2);
    expect(alert.occurrences).toBe(5);
    expect(store.getAlertHistory()).toHaveLength(1);

    add('w-alpha', { ts: BASE + 59 * MIN, msg: 'worker.exhausted' });
    expect(store.getActiveAlerts()[0].notifications).toBe(2);
    add('w-alpha', { ts: BASE + 60 * MIN, msg: 'worker.queue_empty' });
    alert = store.getActiveAlerts()[0];
    expect(alert.notifications).toBe(3);
    expect(store.getAlertHistory().map((a) => a.id)).toEqual([alert.id]);
  });

  it('resolves exactly once when work arrives, and repeat claims are no-ops', () => {
    add('w-alpha', { ts: BASE, msg: 'worker.queue_empty' });
    add('w-alpha', { ts: BASE + MIN, msg: 'worker.queue_empty' });

    add('w-alpha', { ts: BASE + 2 * MIN, msg: 'bead.claim.succeeded', bead: 'fabric-abc' });
    add('w-alpha', { ts: BASE + 3 * MIN, msg: 'bead.claim.succeeded', bead: 'fabric-abc' });

    expect(store.getActiveAlerts()).toHaveLength(0);
    const history = store.getAlertHistory();
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('resolved');
    expect(history[0].resolutionNote).toBe('worker claimed a bead');
    expect(history[0].occurrences).toBe(2);
  });

  it('claiming without a prior alert resolves nothing and files nothing', () => {
    add('w-alpha', { ts: BASE, msg: 'bead.claim.succeeded', bead: 'fabric-abc' });
    expect(store.getActiveAlerts()).toHaveLength(0);
    expect(store.getAlertHistory()).toHaveLength(0);
  });

  it('opens a fresh epoch per recurrence and never touches resolved history', () => {
    const dry = (ts: number) => add('w-alpha', { ts, msg: 'worker.queue_empty' });
    const claim = (ts: number) => add('w-alpha', { ts, msg: 'bead.claim.succeeded', bead: 'fabric-abc' });

    dry(BASE);
    claim(BASE + 1);
    dry(BASE + 2);
    claim(BASE + 3);
    dry(BASE + 4);

    const history = store.getAlertHistory();
    expect(history.map((a) => a.epoch)).toEqual([1, 2, 3]);
    expect(new Set(history.map((a) => a.id)).size).toBe(3);
    expect(store.getActiveAlerts()).toEqual([history[2]]);
    expect(history[0].status).toBe('resolved');
    expect(history[0].resolvedAt).toBe(BASE + 1);
    expect(history[1].status).toBe('resolved');
    expect(history[1].resolvedAt).toBe(BASE + 3);
    expect(history[2].status).toBe('active');
  });

  it('keeps workers independent — one claim only clears its own worker', () => {
    add('w-alpha', { ts: BASE, msg: 'worker.queue_empty' });
    add('w-bravo', { ts: BASE, msg: 'worker.queue_empty' });

    expect(store.getActiveAlerts().map((a) => a.identity).sort()).toEqual([
      'no-work:w-alpha',
      'no-work:w-bravo',
    ]);

    add('w-alpha', { ts: BASE + MIN, msg: 'bead.claim.succeeded', bead: 'fabric-abc' });
    const active = store.getActiveAlerts();
    expect(active).toHaveLength(1);
    expect(active[0].scope).toBe('w-bravo');
  });

  it('drives the full stuck cycle — detection, resume, and relapse as a new epoch', () => {
    vi.useFakeTimers({ now: BASE });
    try {
      // The store re-checks isWorkerStuck on every 100th event of a worker;
      // 100 events repeating one tool call flag repeated_tool → observe.
      for (let i = 0; i < 100; i++) {
        add('w-gamma', { ts: Date.now(), msg: 'tool.call', tool: 'Read', path: '/src/auth.ts' });
      }
      let stuck = store.getActiveAlerts().filter((a) => a.kind === 'stuck');
      expect(stuck).toHaveLength(1);
      expect(stuck[0].identity).toBe('stuck:w-gamma');
      expect(stuck[0].lastReason).toContain('Read');

      // The no-work kind stays independent for the same worker.
      add('w-gamma', { ts: Date.now(), msg: 'worker.queue_empty' });
      expect(store.getActiveAlerts()).toHaveLength(2);

      // Six minutes later the reads are out of the 5-minute detection window
      // and the worker shows varied activity with completions → resolve.
      vi.setSystemTime(BASE + 6 * MIN);
      for (let i = 0; i < 100; i++) {
        add('w-gamma', { ts: Date.now(), msg: 'bead completed', tool: `Tool-${i}` });
      }
      expect(store.getActiveAlerts()).toHaveLength(1);
      const resolved = store.getAlertHistory().filter((a) => a.kind === 'stuck');
      expect(resolved).toHaveLength(1);
      expect(resolved[0].status).toBe('resolved');
      expect(resolved[0].resolutionNote).toBe('worker resumed progress');

      // Relapse after resolution → a NEW stuck epoch, resolved record untouched.
      vi.setSystemTime(BASE + 8 * MIN);
      for (let i = 0; i < 99; i++) {
        add('w-gamma', { ts: Date.now(), msg: 'tool.call', tool: 'Grep', path: '/src/auth.ts' });
      }
      stuck = store.getActiveAlerts().filter((a) => a.kind === 'stuck');
      expect(stuck).toHaveLength(1);
      expect(stuck[0].epoch).toBe(2);
      expect(stuck[0].id).not.toBe(resolved[0].id);
      expect(resolved[0].status).toBe('resolved');
      expect(resolved[0].resolutionNote).toBe('worker resumed progress');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Legacy inventory reconciliation (docs/alert-policy.md)
//
// Inventories written before the dedup policy hold one record PER
// OBSERVATION — many active alerts for the same worker. Reconciliation
// audits such an inventory by identity and epoch, preserves the canonical
// active record, closes duplicates as resolved history with a documented
// reason, and leaves the inventory in the exact shape observe() expects so
// every future observation deduplicates.
// ─────────────────────────────────────────────────────────────────────────

const RB = 1_800_000_000_000; // reconciliation-test base timestamp
const MIN = 60_000;

/** A legacy inventory row: identity/epoch optional (pre-policy rows lack them). */
function legacy(
  kind: AlertRecord['kind'],
  scope: string,
  createdAt: number,
  overrides: Partial<AlertRecord> = {}
): AlertRecord {
  const status: AlertStatus = overrides.status ?? 'active';
  return {
    id: overrides.id ?? `${kind}:${scope}#${createdAt}`,
    identity: overrides.identity ?? alertIdentity(kind, scope),
    kind,
    scope,
    epoch: overrides.epoch ?? 0,
    status,
    createdAt,
    firstObservedAt: overrides.firstObservedAt ?? createdAt,
    lastObservedAt: overrides.lastObservedAt ?? createdAt,
    resolvedAt: overrides.resolvedAt ?? (status === 'resolved' ? createdAt : null),
    occurrences: overrides.occurrences ?? 1,
    notifications: overrides.notifications ?? 1,
    lastNotifiedAt: overrides.lastNotifiedAt ?? createdAt,
    lastReason: overrides.lastReason ?? null,
    resolutionNote: overrides.resolutionNote ?? (status === 'resolved' ? 'cleared' : null),
  };
}

describe('legacy inventory reconciliation', () => {
  it('audits a duplicate-laden inventory down to one active record per identity', () => {
    // w-alpha's no-work condition was observed three times → three active
    // "beads"; its stuck condition twice; w-bravo's old alert already resolved.
    const alphaEarliest = legacy('no-work', 'w-alpha', RB, { epoch: 1, occurrences: 4 });
    const alphaMiddle = legacy('no-work', 'w-alpha', RB + MIN, { epoch: 2 });
    const alphaLatest = legacy('no-work', 'w-alpha', RB + 2 * MIN, {
      epoch: 3,
      lastObservedAt: RB + 2 * MIN,
      lastReason: 'worker.exhausted',
    });
    const stuckEarliest = legacy('stuck', 'w-alpha', RB + 3 * MIN, { epoch: 1 });
    const stuckLatest = legacy('stuck', 'w-alpha', RB + 4 * MIN, { epoch: 2 });
    const bravoResolved = legacy('no-work', 'w-bravo', RB, { status: 'resolved' });

    const { inventory, report } = reconcileLegacyAlerts([
      alphaLatest,
      alphaEarliest,
      stuckLatest,
      bravoResolved,
      alphaMiddle,
      stuckEarliest,
    ]);

    expect(report.recordsAudited).toBe(6);
    expect(report.identitiesAudited).toBe(3);
    expect(report.duplicatesClosed).toBe(3);
    expect(report.activeInstancesAfter).toBe(2);

    // The canonical active record per identity is the EARLIEST-CREATED one —
    // the longest-standing record keeps its id.
    const byId = new Map(inventory.map((r) => [r.id, r]));
    expect(byId.get(alphaEarliest.id)?.status).toBe('active');
    expect(byId.get(stuckEarliest.id)?.status).toBe('active');
    expect(byId.get(bravoResolved.id)?.status).toBe('resolved');
    expect(inventory.filter((r) => r.status === 'active').map((r) => r.id)).toEqual([
      alphaEarliest.id,
      stuckEarliest.id,
    ]);

    // The reconciliation report documents exactly what was folded where.
    expect(report.reconciled).toContainEqual({
      identity: 'no-work:w-alpha',
      kind: 'no-work',
      scope: 'w-alpha',
      canonicalId: alphaEarliest.id,
      closedIds: [alphaMiddle.id, alphaLatest.id],
    });
    expect(report.reconciled).toContainEqual({
      identity: 'stuck:w-alpha',
      kind: 'stuck',
      scope: 'w-alpha',
      canonicalId: stuckEarliest.id,
      closedIds: [stuckLatest.id],
    });

    // Each closed duplicate carries a documented reason naming its canonical
    // record — the audit trail a reader sees in the resolved history.
    for (const dup of [alphaMiddle, alphaLatest, stuckLatest]) {
      const closed = byId.get(dup.id)!;
      expect(closed.status).toBe('resolved');
      expect(closed.resolvedAt).toBeGreaterThan(0);
      expect(closed.resolutionNote).toContain(`legacy duplicate of ${dup.kind}:${dup.scope}`);
      expect(closed.resolutionNote).toContain('docs/alert-policy.md');
    }
  });

  it('folds duplicate evidence into the canonical record', () => {
    const earliest = legacy('no-work', 'w-alpha', RB, {
      occurrences: 4,
      notifications: 1,
      firstObservedAt: RB,
      lastObservedAt: RB + MIN,
      lastReason: 'worker.queue_empty',
    });
    const middle = legacy('no-work', 'w-alpha', RB + MIN, { occurrences: 2 });
    const latest = legacy('no-work', 'w-alpha', RB + 2 * MIN, {
      occurrences: 1,
      lastObservedAt: RB + 5 * MIN,
      lastReason: 'worker.exhausted',
    });

    const { inventory, report } = reconcileLegacyAlerts([latest, earliest, middle]);
    expect(report.duplicatesClosed).toBe(2);

    const canonical = inventory.find((r) => r.status === 'active')!;
    expect(canonical.id).toBe(earliest.id);
    expect(canonical.createdAt).toBe(RB);
    // Audit signal survives the fold: totals summed, window widened, evidence
    // taken from the most recently observed duplicate.
    expect(canonical.occurrences).toBe(7);
    expect(canonical.notifications).toBe(3);
    expect(canonical.firstObservedAt).toBe(RB);
    expect(canonical.lastObservedAt).toBe(RB + 5 * MIN);
    expect(canonical.lastReason).toBe('worker.exhausted');
  });

  it('never touches resolved history — only duplicate actives are closed', () => {
    const resolved = legacy('stuck', 'w-alpha', RB, {
      status: 'resolved',
      epoch: 1,
      resolutionNote: 'worker resumed progress',
    });
    const dupA = legacy('stuck', 'w-alpha', RB + MIN, { epoch: 2 });
    const dupB = legacy('stuck', 'w-alpha', RB + 2 * MIN, { epoch: 3 });

    const { inventory } = reconcileLegacyAlerts([dupB, dupA, resolved]);

    const kept = inventory.find((r) => r.id === resolved.id)!;
    expect(kept).toEqual(resolved); // byte-for-byte untouched
    expect(inventory.filter((r) => r.resolutionNote === 'worker resumed progress')).toHaveLength(1);
  });

  it('is idempotent — reconciling its own output closes nothing', () => {
    const legacyInventory = [
      legacy('no-work', 'w-alpha', RB, { occurrences: 3 }),
      legacy('no-work', 'w-alpha', RB + MIN, { occurrences: 2 }),
      legacy('stuck', 'w-bravo', RB + 2 * MIN),
    ];

    const first = reconcileLegacyAlerts(legacyInventory, { at: RB + 9 * MIN });
    const second = reconcileLegacyAlerts(first.inventory, { at: RB + 10 * MIN });

    expect(second.report.duplicatesClosed).toBe(0);
    expect(second.report.reconciled).toEqual([]);
    expect(second.inventory).toEqual(first.inventory);
  });

  it('derives identity and epoch for pre-policy rows that lack them', () => {
    // Rows from before the policy: no identity, no epoch — audit still groups
    // them by (kind, scope) and derives epochs in creation order.
    const rows = [
      legacy('no-work', 'w-gamma', RB + 2 * MIN, { identity: '' }),
      legacy('no-work', 'w-gamma', RB, { identity: '' }),
      legacy('no-work', 'w-gamma', RB + MIN, { identity: '' }),
    ];

    const { inventory, report } = reconcileLegacyAlerts(rows);

    expect(report.identitiesAudited).toBe(1);
    expect(report.duplicatesClosed).toBe(2);
    const canonical = inventory.find((r) => r.status === 'active')!;
    expect(canonical.identity).toBe('no-work:w-gamma');
    expect(canonical.createdAt).toBe(RB);
    expect(canonical.epoch).toBe(1);
    // Derived epochs are audit labels: creation order ranks them 1..3.
    expect(inventory.map((r) => r.epoch)).toEqual([2, 3, 1]);
  });

  it('positions the canonical active record last so observe() folds into it', () => {
    // Legacy epochs out of order, resolved row carrying the HIGHEST epoch.
    const resolvedHighEpoch = legacy('no-work', 'w-alpha', RB, {
      status: 'resolved',
      epoch: 9,
    });
    const activeEarly = legacy('no-work', 'w-alpha', RB + MIN, { epoch: 1 });
    const activeLate = legacy('no-work', 'w-alpha', RB + 2 * MIN, { epoch: 2 });

    const { inventory } = reconcileLegacyAlerts([activeLate, resolvedHighEpoch, activeEarly]);

    // Resolved history first (ascending), the active canonical LAST — the
    // registry contract observe() relies on. Three records in, two resolved
    // (the untouched epoch-9 history row and the closed duplicate), one live.
    expect(inventory.map((r) => r.status)).toEqual(['resolved', 'resolved', 'active']);
    expect(inventory[inventory.length - 1].id).toBe(activeEarly.id);
  });
});

describe('AlertManager legacy restore and live reconciliation', () => {
  it('restore() reconciles a legacy snapshot and future observations deduplicate into the survivor', () => {
    const clock = makeClock();
    const mgr = new AlertManager({ now: clock });

    const alphaEarliest = legacy('no-work', 'w-alpha', RB, {
      epoch: 1,
      occurrences: 5,
      lastNotifiedAt: RB,
    });
    const bravoActive = legacy('stuck', 'w-bravo', RB + 3 * MIN, { epoch: 1 });
    const legacyInventory = [
      alphaEarliest,
      legacy('no-work', 'w-alpha', RB + MIN, { epoch: 2 }),
      legacy('no-work', 'w-alpha', RB + 2 * MIN, { epoch: 3 }),
      bravoActive,
    ];
    const report = mgr.restore(legacyInventory);

    expect(report.duplicatesClosed).toBe(2);
    expect(mgr.activeAlerts().map((r) => r.id)).toEqual([
      alphaEarliest.id,
      bravoActive.id,
    ]);
    // Evidence folded: 5 + 1 + 1 duplicate observations survive as 7.
    expect(mgr.activeAlerts()[0].occurrences).toBe(7);

    // The point of the reconciliation: the next observation of the same
    // condition folds into the CANONICAL record — no new epoch, no new bead.
    const folded = mgr.observe('no-work', 'w-alpha', { at: RB + 3 * MIN });
    expect(folded.outcome).toBe('deduplicated');
    expect(folded.alert.id).toBe(alphaEarliest.id);
    expect(folded.alert.occurrences).toBe(8);
    expect(folded.alert.epoch).toBe(1);
    expect(mgr.activeAlerts()).toHaveLength(2);
    expect(mgr.history()).toHaveLength(4); // 2 closed dups + 2 active survivors
  });

  it('restore() preserves recurrence semantics — a resolved tail reopens on observe', () => {
    const mgr = new AlertManager({ now: makeClock() });

    // Snapshot where the newest record is RESOLVED: the worker had recovered
    // when the snapshot was taken. The first observation afterwards must
    // open a NEW epoch, never resurrect the resolved record.
    const resolved = legacy('no-work', 'w-alpha', RB, {
      status: 'resolved',
      epoch: 1,
      resolutionNote: 'worker claimed a bead',
    });
    mgr.restore([resolved]);

    const recurred = mgr.observe('no-work', 'w-alpha', { at: RB + MIN });
    expect(recurred.outcome).toBe('new-epoch');
    expect(recurred.alert.epoch).toBe(2);
    expect(recurred.alert.id).not.toBe(resolved.id);
    expect(recurred.previous?.id).toBe(resolved.id);
    // Resolved history is untouched by the restore or the recurrence.
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolutionNote).toBe('worker claimed a bead');
    expect(mgr.history().filter((r) => r.status === 'resolved')).toHaveLength(1);
  });

  it('reconcileLegacyDuplicates() leaves a conforming registry untouched', () => {
    const clock = makeClock();
    const mgr = new AlertManager({ now: clock });
    const live = mgr.observe('no-work', 'w-alpha');
    mgr.observe('no-work', 'w-alpha');
    const stuck = mgr.observe('stuck', 'w-bravo');

    const report = mgr.reconcileLegacyDuplicates();

    expect(report.duplicatesClosed).toBe(0);
    expect(report.reconciled).toEqual([]);
    expect(mgr.activeAlerts().map((r) => r.id)).toEqual([live.alert.id, stuck.alert.id]);

    // The registry keeps working normally after a no-op reconciliation.
    const again = mgr.observe('no-work', 'w-alpha');
    expect(again.outcome).toBe('deduplicated');
    expect(again.alert.id).toBe(live.alert.id);
  });
});
