/**
 * Alert bead filing lifecycle (docs/alert-policy.md §Bead emission)
 *
 * Pins the emission layer between the deduplicating alert registry and the
 * open-bead inventory: repeated observations and cooldown escalations fold
 * into the SAME open bead (never a second one), resolution closes the bead,
 * recurrence files the next epoch as a new bead, and reconciliation folds a
 * duplicate-laden inventory back to one open bead per active instance.
 * Covered at three altitudes — manager→filer units, the store's observation
 * sites (add()), and the HTTP surface (/api/alerts/beads).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  AlertManager,
  AlertRecord,
  DEFAULT_ALERT_COOLDOWN_MS,
} from './alertManager.js';
import {
  AlertBead,
  AlertBeadFiler,
  InMemoryAlertBeadSink,
} from './alertBeadFiler.js';
import { InMemoryEventStore } from './store.js';
import { resetCrossReferenceManager } from './crossReferenceManager.js';
import { LogEvent } from './types.js';
import { createWebServer, WebServer } from './web/server.js';

const MIN = 60_000;
const BASE = 1_750_000_000_000;

/** A registry-shaped record for seeding snapshots. */
function record(
  kind: AlertRecord['kind'],
  scope: string,
  at: number,
  overrides: Partial<AlertRecord> = {}
): AlertRecord {
  const identity = `${kind}:${scope}`;
  return {
    id: `${identity}#1`,
    identity,
    kind,
    scope,
    epoch: 1,
    status: 'active',
    createdAt: at,
    firstObservedAt: at,
    lastObservedAt: at,
    resolvedAt: null,
    occurrences: 1,
    notifications: 1,
    lastNotifiedAt: at,
    lastReason: null,
    resolutionNote: null,
    ...overrides,
  };
}

/** Seed the sink with a bare open bead (a pre-policy / foreign writer row). */
function seedOpenBead(
  sink: InMemoryAlertBeadSink,
  id: string,
  identity: string,
  at: number,
  overrides: Partial<AlertBead> = {}
): void {
  const [kind, scope] = identity.split(':') as [AlertBead['kind'], string];
  sink.fileBead({
    id,
    identity,
    kind,
    scope,
    epoch: 1,
    status: 'open',
    filedAt: at,
    occurrences: 1,
    notifications: 1,
    lastObservedAt: at,
    lastReason: null,
    lastEscalatedAt: null,
    closedAt: null,
    closeNote: null,
    ...overrides,
  });
}

// ─── Manager → filer lifecycle ──────────────────────────────────────────────

describe('AlertBeadFiler lifecycle', () => {
  let sink: InMemoryAlertBeadSink;
  let filer: AlertBeadFiler;
  let mgr: AlertManager;
  let now: number;

  beforeEach(() => {
    sink = new InMemoryAlertBeadSink();
    filer = new AlertBeadFiler(sink);
    now = BASE;
    mgr = new AlertManager({ cooldownMs: DEFAULT_ALERT_COOLDOWN_MS, now: () => now });
  });

  const open = (): AlertBead[] => sink.listBeads().filter((b) => b.status === 'open');

  it('files exactly one open bead for repeated observations and folds evidence into it', () => {
    for (const reason of ['worker.queue_empty', 'worker.exhausted', 'worker.queue_empty']) {
      now += MIN;
      const result = mgr.observe('no-work', 'w-alpha', { at: now, reason });
      filer.emitObservation(result, now);
    }

    expect(sink.listBeads()).toHaveLength(1);
    const bead = open()[0];
    expect(bead).toMatchObject({
      id: 'no-work:w-alpha#1',
      identity: 'no-work:w-alpha',
      kind: 'no-work',
      scope: 'w-alpha',
      epoch: 1,
      status: 'open',
      occurrences: 3,
      notifications: 1,
      lastReason: 'worker.queue_empty',
    });
    expect(bead.lastEscalatedAt).toBeNull();
  });

  it('folds a cooldown escalation into the same open bead — never a second bead', () => {
    const created = mgr.observe('no-work', 'w-alpha', { at: now });
    filer.emitObservation(created, now);

    now += 5 * MIN;
    const deduped = mgr.observe('no-work', 'w-alpha', { at: now });
    expect(deduped.outcome).toBe('deduplicated');
    filer.emitObservation(deduped, now);

    now += 26 * MIN; // 31m since the last notification — past the cooldown
    const escalated = mgr.observe('no-work', 'w-alpha', { at: now });
    expect(escalated.outcome).toBe('escalated');
    const emission = filer.emitObservation(escalated, now);

    expect(emission.action).toBe('updated');
    expect(sink.listBeads()).toHaveLength(1);
    expect(open()).toHaveLength(1);
    const bead = open()[0];
    expect(bead.id).toBe('no-work:w-alpha#1');
    expect(bead.notifications).toBe(2);
    expect(bead.occurrences).toBe(3);
    expect(bead.lastEscalatedAt).toBe(now);
    expect(bead.lastObservedAt).toBe(now);
  });

  it('closes the bead on resolution with the note, and repeat resolutions are no-ops', () => {
    const created = mgr.observe('stuck', 'w-bravo', { at: now });
    filer.emitObservation(created, now);

    now += MIN;
    const resolved = mgr.resolve('stuck', 'w-bravo', { at: now, note: 'worker resumed progress' });
    const emission = filer.emitResolution(resolved, now);
    expect(emission.action).toBe('closed');
    expect(emission.bead).toMatchObject({
      status: 'closed',
      closedAt: now,
      closeNote: 'worker resumed progress',
    });

    // Resolution is idempotent upstream (null) and downstream (no-op).
    expect(mgr.resolve('stuck', 'w-bravo')).toBeNull();
    expect(filer.emitResolution(null, now).action).toBe('ignored');
    expect(filer.emitResolution(resolved, now).action).toBe('ignored');
    expect(sink.listBeads()).toHaveLength(1);
    expect(open()).toHaveLength(0);
  });

  it('files recurrence as a NEW bead and never touches the closed epoch', () => {
    const first = mgr.observe('no-work', 'w-alpha', { at: now });
    filer.emitObservation(first, now);
    now += MIN;
    filer.emitResolution(mgr.resolve('no-work', 'w-alpha', { at: now, note: 'worker claimed a bead' }), now);

    now += 10 * MIN;
    const recurred = mgr.observe('no-work', 'w-alpha', { at: now });
    expect(recurred.outcome).toBe('new-epoch');
    const emission = filer.emitObservation(recurred, now);
    expect(emission.action).toBe('filed');

    const beads = sink.listBeads();
    expect(beads).toHaveLength(2);
    const epoch1 = beads.find((b) => b.epoch === 1)!;
    const epoch2 = beads.find((b) => b.epoch === 2)!;
    expect(epoch2).toMatchObject({ id: 'no-work:w-alpha#2', status: 'open', occurrences: 1 });
    expect(epoch1).toMatchObject({
      id: 'no-work:w-alpha#1',
      status: 'closed',
      closedAt: BASE + MIN,
      closeNote: 'worker claimed a bead',
      occurrences: 1,
    });
  });

  it('re-delivering an at-least-once emission updates instead of filing twice', () => {
    const created = mgr.observe('no-work', 'w-alpha', { at: now });
    filer.emitObservation(created, now);
    // The same result delivered again (retry, replayed queue, …) must not
    // file a second bead for the instance id.
    const again = filer.emitObservation(created, now);
    expect(again.action).toBe('updated');
    expect(sink.listBeads()).toHaveLength(1);
    expect(open()[0].occurrences).toBe(1);
  });

  it('enforces identity uniqueness while filing into a legacy duplicate inventory', () => {
    seedOpenBead(sink, 'legacy-1', 'no-work:w-alpha', BASE);
    seedOpenBead(sink, 'legacy-2', 'no-work:w-alpha', BASE + MIN, {
      occurrences: 2,
      lastObservedAt: BASE + MIN,
    });

    const observed = mgr.observe('no-work', 'w-alpha', { at: BASE + 2 * MIN });
    const emission = filer.emitObservation(observed, BASE + 2 * MIN);

    expect(emission.action).toBe('updated');
    expect(open()).toHaveLength(1);
    expect(sink.getBead('legacy-1')).toMatchObject({
      status: 'open',
      occurrences: 4,
      lastObservedAt: BASE + 2 * MIN,
    });
    expect(sink.getBead('legacy-2')).toMatchObject({
      status: 'closed',
      closeNote: expect.stringContaining('bead-creation boundary'),
    });
  });

  it('keeps concurrent producers at one open bead for one identity', async () => {
    const leftSink = sink;
    const rightFiler = new AlertBeadFiler(leftSink);
    const rightManager = new AlertManager({ now: () => now });
    const leftObservation = mgr.observe('no-work', 'w-alpha', { at: now });
    const rightObservation = rightManager.observe('no-work', 'w-alpha', { at: now });

    await Promise.all([
      Promise.resolve().then(() => filer.emitObservation(leftObservation, now)),
      Promise.resolve().then(() => rightFiler.emitObservation(rightObservation, now)),
    ]);

    expect(open()).toHaveLength(1);
    expect(sink.listBeads().filter((bead) => bead.identity === 'no-work:w-alpha'))
      .toHaveLength(1);
  });

  it('ignores an observation naming a closed bead — no resurrection', () => {
    const first = mgr.observe('no-work', 'w-alpha', { at: now });
    filer.emitObservation(first, now);
    now += MIN;
    filer.emitResolution(mgr.resolve('no-work', 'w-alpha', { at: now, note: 'cleared' }), now);

    const emission = filer.emitObservation(first, now);
    expect(emission.action).toBe('ignored');
    const bead = sink.listBeads()[0];
    expect(bead.status).toBe('closed');
    expect(bead.closeNote).toBe('cleared');
  });
});

// ─── Reconciliation ─────────────────────────────────────────────────────────

describe('AlertBeadFiler.reconcileWithRegistry', () => {
  let sink: InMemoryAlertBeadSink;
  let filer: AlertBeadFiler;
  const AT = BASE + 60 * MIN;

  beforeEach(() => {
    sink = new InMemoryAlertBeadSink();
    filer = new AlertBeadFiler(sink);
  });

  it('closes duplicate open beads into the canonical instance bead, folding their evidence', () => {
    const mgr = new AlertManager();
    mgr.restore([record('no-work', 'w-alpha', BASE)]); // active: no-work:w-alpha#1

    // A pre-policy inventory: three open beads for the same identity.
    seedOpenBead(sink, 'no-work:w-alpha#1', 'no-work:w-alpha', BASE);
    seedOpenBead(sink, 'legacy-2', 'no-work:w-alpha', BASE + MIN, { occurrences: 4, notifications: 2 });
    seedOpenBead(sink, 'legacy-3', 'no-work:w-alpha', BASE + 2 * MIN, {
      occurrences: 2,
      lastObservedAt: BASE + 9 * MIN,
      lastReason: 'worker.exhausted',
    });

    const report = filer.reconcileWithRegistry(mgr.history(), { at: AT });
    expect(report.beadsAudited).toBe(3);
    expect(report.filed).toBe(0);
    expect(report.duplicatesClosed).toBe(2);
    expect(report.orphansClosed).toBe(0);
    expect(report.openBeadsAfter).toBe(1);
    expect(report.reconciled).toEqual([
      {
        identity: 'no-work:w-alpha',
        kind: 'no-work',
        scope: 'w-alpha',
        canonicalId: 'no-work:w-alpha#1',
        closedIds: expect.arrayContaining(['legacy-2', 'legacy-3']),
      },
    ]);

    // The survivor keeps its id and absorbs the duplicates' audit signal.
    const canonical = sink.getBead('no-work:w-alpha#1')!;
    expect(canonical.status).toBe('open');
    expect(canonical.occurrences).toBe(1 + 4 + 2);
    expect(canonical.notifications).toBe(1 + 1 + 2);
    expect(canonical.lastObservedAt).toBe(BASE + 9 * MIN);
    expect(canonical.lastReason).toBe('worker.exhausted');

    // Duplicates are closed history with a documented reason.
    for (const dupId of ['legacy-2', 'legacy-3']) {
      const dup = sink.getBead(dupId)!;
      expect(dup.status).toBe('closed');
      expect(dup.closedAt).toBe(AT);
      expect(dup.closeNote).toContain(`duplicate of no-work:w-alpha#1`);
      expect(dup.closeNote).toContain('docs/alert-policy.md');
    }

    // Future observations deduplicate into the survivor — no new bead.
    const next = mgr.observe('no-work', 'w-alpha', { at: AT + MIN });
    filer.emitObservation(next, AT + MIN);
    expect(sink.listBeads().filter((b) => b.status === 'open')).toHaveLength(1);
    expect(sink.getBead('no-work:w-alpha#1')!.occurrences).toBe(8);
  });

  it('does not recreate duplicate active beads after no-work and stuck reconciliation', () => {
    let now = BASE;
    const mgr = new AlertManager({ now: () => now });

    const noWorkCanonical = record('no-work', 'w-alpha', BASE);
    const stuckCanonical = record('stuck', 'w-alpha', BASE + MIN);
    mgr.restore([
      noWorkCanonical,
      record('no-work', 'w-alpha', BASE + 2 * MIN, {
        id: 'legacy-no-work-2',
        epoch: 2,
      }),
      record('no-work', 'w-alpha', BASE + 3 * MIN, {
        id: 'legacy-no-work-3',
        epoch: 3,
      }),
      stuckCanonical,
      record('stuck', 'w-alpha', BASE + 4 * MIN, {
        id: 'legacy-stuck-2',
        epoch: 2,
      }),
    ]);

    seedOpenBead(sink, noWorkCanonical.id, noWorkCanonical.identity, BASE);
    seedOpenBead(sink, 'legacy-no-work-2', noWorkCanonical.identity, BASE + 2 * MIN);
    seedOpenBead(sink, 'legacy-no-work-3', noWorkCanonical.identity, BASE + 3 * MIN);
    seedOpenBead(sink, stuckCanonical.id, stuckCanonical.identity, BASE + MIN);
    seedOpenBead(sink, 'legacy-stuck-2', stuckCanonical.identity, BASE + 4 * MIN);

    const report = filer.reconcileWithRegistry(mgr.history(), { at: BASE + 5 * MIN });
    expect(report.duplicatesClosed).toBe(3);
    expect(
      sink
        .listBeads()
        .filter((bead) => bead.status === 'open')
        .map((bead) => bead.id)
        .sort()
    ).toEqual([noWorkCanonical.id, stuckCanonical.id].sort());

    for (const duplicateId of ['legacy-no-work-2', 'legacy-no-work-3', 'legacy-stuck-2']) {
      expect(sink.getBead(duplicateId)).toMatchObject({
        status: 'closed',
        closeNote: expect.stringContaining('one open bead per active alert instance'),
      });
    }

    // Repeated observations for either identity must fold into the canonical
    // rows. This guards against the legacy pile returning on the next ingest
    // pass after reconciliation.
    for (let i = 0; i < 3; i++) {
      now += MIN;
      filer.emitObservation(mgr.observe('no-work', 'w-alpha', { at: now }), now);
      filer.emitObservation(mgr.observe('stuck', 'w-alpha', { at: now }), now);
    }

    const open = sink.listBeads().filter((bead) => bead.status === 'open');
    expect(open).toHaveLength(2);
    expect(open.map((bead) => bead.id).sort()).toEqual(
      [noWorkCanonical.id, stuckCanonical.id].sort()
    );
    expect(sink.listBeads()).toHaveLength(5);
  });

  it('closes orphaned open beads whose identity has no active instance', () => {
    seedOpenBead(sink, 'no-work:w-gone#1', 'no-work:w-gone', BASE, { occurrences: 7 });
    seedOpenBead(sink, 'stuck:w-old#3', 'stuck:w-old', BASE);
    // Already-closed history of another identity must be untouched.
    sink.fileBead({
      id: 'no-work:w-done#1',
      identity: 'no-work:w-done',
      kind: 'no-work',
      scope: 'w-done',
      epoch: 1,
      status: 'closed',
      filedAt: BASE,
      occurrences: 2,
      notifications: 1,
      lastObservedAt: BASE,
      lastReason: null,
      lastEscalatedAt: null,
      closedAt: BASE + MIN,
      closeNote: 'worker claimed a bead',
    });

    const report = filer.reconcileWithRegistry([], { at: AT });
    expect(report.orphansClosed).toBe(2);
    expect(report.openBeadsAfter).toBe(0);
    expect(sink.getBead('no-work:w-gone#1')).toMatchObject({
      status: 'closed',
      closeNote: expect.stringContaining('no active alert instance for no-work:w-gone'),
    });
    // Closed history is never rewritten.
    expect(sink.getBead('no-work:w-done#1')).toMatchObject({
      status: 'closed',
      closedAt: BASE + MIN,
      closeNote: 'worker claimed a bead',
    });
  });

  it('files beads for active instances the inventory lacks (boot catch-up)', () => {
    const mgr = new AlertManager();
    mgr.restore([
      record('no-work', 'w-alpha', BASE),
      record('stuck', 'w-bravo', BASE + MIN, { id: 'stuck:w-bravo#2', epoch: 2 }),
    ]);

    const report = filer.reconcileWithRegistry(mgr.history(), { at: AT });
    expect(report.filed).toBe(2);
    expect(report.openBeadsAfter).toBe(2);
    expect(sink.getBead('no-work:w-alpha#1')).toMatchObject({ status: 'open', occurrences: 1 });
    expect(sink.getBead('stuck:w-bravo#2')).toMatchObject({ status: 'open', epoch: 2 });
  });

  it('is idempotent — reconciling a conforming inventory changes nothing', () => {
    const mgr = new AlertManager();
    mgr.restore([record('no-work', 'w-alpha', BASE)]);
    const first = filer.reconcileWithRegistry(mgr.history(), { at: AT });
    expect(first.filed).toBe(1);

    const second = filer.reconcileWithRegistry(mgr.history(), { at: AT + MIN });
    expect(second).toMatchObject({
      beadsAudited: 1,
      filed: 0,
      duplicatesClosed: 0,
      orphansClosed: 0,
      openBeadsAfter: 1,
      reconciled: [],
    });
    expect(sink.listBeads()).toHaveLength(1);
  });
});

// ─── Store path: the observation sites emit the inventory ───────────────────

describe('event store alert bead emission', () => {
  let store: InMemoryEventStore;

  beforeEach(() => {
    store = new InMemoryEventStore();
  });

  afterEach(() => {
    store.clear();
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

  it('a no-work burst files ONE open bead with the folded evidence', () => {
    for (let i = 0; i < 5; i) {
      i += 1;
      addEvent({ ts: BASE + i, msg: 'worker.queue_empty' });
    }

    const beads = store.getAlertBeads();
    expect(beads).toHaveLength(1);
    expect(beads[0]).toMatchObject({
      id: 'no-work:w-alpha#1',
      identity: 'no-work:w-alpha',
      status: 'open',
      occurrences: 5,
      notifications: 1,
    });
  });

  it('keeps an event-loop-concurrent no-work burst at one open bead', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        Promise.resolve().then(() =>
          addEvent({ ts: BASE + i, msg: i % 2 === 0 ? 'worker.queue_empty' : 'worker.exhausted' })
        )
      )
    );

    const open = store.getAlertBeads().filter((bead) => bead.status === 'open');
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      identity: 'no-work:w-alpha',
      occurrences: 20,
    });
  });

  it('a claim closes the bead, and recurrence files the next epoch as a new bead', () => {
    addEvent({ ts: BASE, msg: 'worker.queue_empty' });
    addEvent({ ts: BASE + 1, msg: 'worker.exhausted' });
    addEvent({ ts: BASE + 2, msg: 'bead.claim.succeeded', bead: 'fabric-abc' });

    const closed = store.getAlertBeads();
    expect(closed).toHaveLength(1);
    expect(closed[0]).toMatchObject({
      id: 'no-work:w-alpha#1',
      status: 'closed',
      closeNote: 'worker claimed a bead',
      occurrences: 2,
    });

    // Recurrence → a new bead; the closed epoch is untouched history.
    addEvent({ ts: BASE + 3, msg: 'worker.queue_empty' });
    const beads = store.getAlertBeads();
    expect(beads).toHaveLength(2);
    expect(beads.find((b) => b.epoch === 2)).toMatchObject({ status: 'open', occurrences: 1 });
    expect(beads.find((b) => b.epoch === 1)).toMatchObject({
      status: 'closed',
      closedAt: BASE + 2,
      occurrences: 2,
    });
  });

  it('a cooldown escalation updates the same open bead at the store level', () => {
    vi.useFakeTimers({ now: BASE });
    try {
      addEvent({ msg: 'worker.queue_empty' });
      vi.setSystemTime(BASE + 5 * MIN);
      addEvent({ msg: 'worker.queue_empty' });
      vi.setSystemTime(BASE + 31 * MIN);
      addEvent({ msg: 'worker.queue_empty' });

      const beads = store.getAlertBeads();
      expect(beads).toHaveLength(1);
      expect(beads[0]).toMatchObject({
        status: 'open',
        occurrences: 3,
        notifications: 2,
        lastEscalatedAt: BASE + 31 * MIN,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('drives the stuck cycle through the bead inventory — open, resolve, new epoch', () => {
    vi.useFakeTimers({ now: BASE });
    try {
      // 100 events repeating one tool call flag repeated_tool → stuck bead.
      for (let i = 0; i < 100; i++) {
        addEvent({ msg: 'tool.call', tool: 'Read', path: '/src/auth.ts' });
      }
      let stuck = store.getAlertBeads().filter((b) => b.kind === 'stuck');
      expect(stuck).toHaveLength(1);
      expect(stuck[0]).toMatchObject({ id: 'stuck:w-alpha#1', status: 'open' });

      // Varied activity out of the detection window → resolved bead.
      vi.setSystemTime(BASE + 6 * MIN);
      for (let i = 0; i < 100; i++) {
        addEvent({ msg: 'bead completed', tool: `Tool-${i}` });
      }
      const resolved = store.getAlertBead('stuck:w-alpha#1');
      expect(resolved).toMatchObject({
        status: 'closed',
        closeNote: 'worker resumed progress',
      });

      // Relapse → epoch 2 open bead; epoch 1 stays closed.
      vi.setSystemTime(BASE + 8 * MIN);
      for (let i = 0; i < 100; i++) {
        addEvent({ msg: 'tool.call', tool: 'Grep', path: '/src/auth.ts' });
      }
      const beads = store.getAlertBeads().filter((b) => b.kind === 'stuck');
      expect(beads).toHaveLength(2);
      expect(beads.find((b) => b.epoch === 2)).toMatchObject({ status: 'open' });
      expect(beads.find((b) => b.epoch === 1)).toMatchObject({
        status: 'closed',
        closeNote: 'worker resumed progress',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('clear() resets the bead inventory with the registry', () => {
    addEvent({ msg: 'worker.queue_empty' });
    expect(store.getAlertBeads()).toHaveLength(1);

    store.clear();
    expect(store.getAlertBeads()).toEqual([]);
  });

  it('reconcileAlertBeads files restored instances and future observations fold into them', () => {
    store.restoreAlertRecords([record('no-work', 'w-alpha', BASE)]);
    // The registry holds the instance; the process-local bead inventory does
    // not (beads are not persisted).
    expect(store.getAlertBeads()).toEqual([]);

    const report = store.reconcileAlertBeads();
    expect(report.filed).toBe(1);
    expect(report.openBeadsAfter).toBe(1);

    // The restored instance's observations fold into the filed bead.
    addEvent({ ts: BASE + 1, msg: 'worker.queue_empty' });
    const beads = store.getAlertBeads();
    expect(beads).toHaveLength(1);
    expect(beads[0]).toMatchObject({ id: 'no-work:w-alpha#1', occurrences: 2 });
  });
});

// ─── HTTP surface ───────────────────────────────────────────────────────────

describe('GET /api/alerts/beads reports the filed bead inventory', () => {
  let store: InMemoryEventStore;
  let server: WebServer;
  let port: number;
  let logDir: string;

  beforeEach(async () => {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-beads-logs-'));
    store = new InMemoryEventStore();
    resetCrossReferenceManager();
    server = createWebServer({ port: 0, logPath: logDir, store, authToken: 'test-token' });
    await new Promise<void>((resolve) => {
      server.on('start', () => resolve());
      server.start();
    });
    port = server.getPort();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.on('stop', () => resolve());
      server.stop();
    });
    store.clear();
    resetCrossReferenceManager();
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  function add(worker: string, overrides: Partial<LogEvent>): void {
    store.add({ ts: BASE, worker, level: 'info', msg: '', ...overrides } as LogEvent);
  }

  async function getBeads(): Promise<{ open: AlertBead[]; closed: AlertBead[] }> {
    const res = await fetch(`http://localhost:${port}/api/alerts/beads`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { open: AlertBead[]; closed: AlertBead[] };
    expect(Object.keys(body).sort()).toEqual(['closed', 'open']);
    return body;
  }

  it('shows one open bead per active instance, then closed + new epoch on recurrence', async () => {
    for (let i = 0; i < 3; i++) {
      add('w-alpha', { ts: BASE + i, msg: 'worker.queue_empty' });
    }
    add('w-bravo', { ts: BASE, msg: 'worker.exhausted' });

    const burst = await getBeads();
    expect(burst.open).toHaveLength(2);
    expect(burst.closed).toHaveLength(0);
    const alpha = burst.open.find((b) => b.scope === 'w-alpha');
    expect(alpha).toMatchObject({ id: 'no-work:w-alpha#1', occurrences: 3, status: 'open' });

    // Resolution + recurrence: the epoch-1 bead moves to closed, epoch 2 opens.
    add('w-alpha', { ts: BASE + 4, msg: 'bead.claim.succeeded', bead: 'fabric-abc' });
    add('w-alpha', { ts: BASE + 5, msg: 'worker.queue_empty' });
    const after = await getBeads();
    expect(after.open).toHaveLength(2);
    expect(after.open.find((b) => b.identity === 'no-work:w-alpha')).toMatchObject({
      id: 'no-work:w-alpha#2',
      epoch: 2,
    });
    expect(after.closed).toHaveLength(1);
    expect(after.closed[0]).toMatchObject({
      id: 'no-work:w-alpha#1',
      closeNote: 'worker claimed a bead',
    });
  });

  it('reports an empty inventory for a quiet store', async () => {
    const body = await getBeads();
    expect(body.open).toEqual([]);
    expect(body.closed).toEqual([]);
  });

  it('POST /api/alerts/beads/reconcile is auth-gated and idempotent on a conforming inventory', async () => {
    add('w-alpha', { msg: 'worker.queue_empty' });

    const unauth = await fetch(`http://localhost:${port}/api/alerts/beads/reconcile`, {
      method: 'POST',
    });
    expect(unauth.status).toBe(401);

    const res = await fetch(`http://localhost:${port}/api/alerts/beads/reconcile`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(200);
    const report = (await res.json()) as { filed: number; duplicatesClosed: number; openBeadsAfter: number };
    expect(report).toMatchObject({ filed: 0, duplicatesClosed: 0, openBeadsAfter: 1 });

    const body = await getBeads();
    expect(body.open).toHaveLength(1);
  });
});
