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
  DEFAULT_ALERT_COOLDOWN_MS,
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
