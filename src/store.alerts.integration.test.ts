/**
 * Store-level AlertManager contract tests.
 *
 * These tests deliberately enter through InMemoryEventStore.add(), the same
 * path used by JSONL and OTLP ingestion, to pin the documented event mapping.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ALERT_COOLDOWN_MS } from './alertManager.js';
import { InMemoryEventStore } from './store.js';
import { LogEvent } from './types.js';

const BASE = 1_900_000_000_000;
const MINUTE = 60_000;

describe('InMemoryEventStore alert event mapping', () => {
  let store: InMemoryEventStore;

  beforeEach(() => {
    store = new InMemoryEventStore();
  });

  afterEach(() => {
    vi.useRealTimers();
    store.clear();
  });

  function add(
    worker: string,
    msg: string,
    ts: number,
    fields: Partial<LogEvent> = {},
  ): void {
    store.add({
      ts,
      worker,
      level: 'info',
      msg,
      ...fields,
    } as LogEvent);
  }

  function expectOneActivePerIdentity(...identities: string[]): void {
    const active = store.getActiveAlerts();
    const activeIdentities = active.map((alert) => alert.identity).sort();

    expect(new Set(activeIdentities).size).toBe(active.length);
    expect(activeIdentities).toEqual([...identities].sort());
  }

  it('maps queue-empty and exhausted signals to one folded no-work alert', () => {
    add('w-alpha', 'worker.queue_empty', BASE);
    const first = store.getActiveAlerts()[0];

    add('w-alpha', 'worker.exhausted', BASE + MINUTE);
    add('w-alpha', 'worker.queue_empty', BASE + 2 * MINUTE);
    add('w-alpha', 'worker.exhausted', BASE + 3 * MINUTE);
    const active = store.getActiveAlerts();

    expectOneActivePerIdentity('no-work:w-alpha');
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(first.id);
    expect(active[0].identity).toBe('no-work:w-alpha');
    expect(active[0].occurrences).toBe(4);
    expect(active[0].lastReason).toBe('worker.exhausted');
  });

  it('suppresses repeated store observations during cooldown and escalates the same alert after it', () => {
    add('w-alpha', 'worker.queue_empty', BASE);
    const first = store.getActiveAlerts()[0];

    for (const offset of [1, 10, 29]) {
      add('w-alpha', 'worker.queue_empty', BASE + offset * MINUTE);
    }
    expectOneActivePerIdentity('no-work:w-alpha');
    expect(store.getActiveAlerts()[0]).toMatchObject({
      id: first.id,
      occurrences: 4,
      notifications: 1,
    });

    add('w-alpha', 'worker.exhausted', BASE + DEFAULT_ALERT_COOLDOWN_MS);
    expectOneActivePerIdentity('no-work:w-alpha');
    expect(store.getActiveAlerts()[0]).toMatchObject({
      id: first.id,
      occurrences: 5,
      notifications: 2,
    });
    expect(store.getAlertHistory()).toHaveLength(1);
  });

  it('keeps each worker identity independent while folding its own repeated signals', () => {
    add('w-alpha', 'worker.queue_empty', BASE);
    add('w-alpha', 'worker.exhausted', BASE + MINUTE);
    add('w-bravo', 'worker.exhausted', BASE);
    add('w-bravo', 'worker.queue_empty', BASE + MINUTE);

    expectOneActivePerIdentity('no-work:w-alpha', 'no-work:w-bravo');
    expect(store.getActiveAlerts()).toEqual(expect.arrayContaining([
      expect.objectContaining({ identity: 'no-work:w-alpha', occurrences: 2 }),
      expect.objectContaining({ identity: 'no-work:w-bravo', occurrences: 2 }),
    ]));

    add('w-alpha', 'bead.claim.succeeded', BASE + 2 * MINUTE, { bead: 'fabric-alpha' });
    expectOneActivePerIdentity('no-work:w-bravo');
  });

  it('maps bead.claim.succeeded to idempotent resolution and preserves recurrence epochs', () => {
    add('w-alpha', 'worker.queue_empty', BASE);
    add('w-alpha', 'worker.queue_empty', BASE + MINUTE);
    const first = store.getAlertHistory()[0];

    add('w-alpha', 'bead.claim.succeeded', BASE + 2 * MINUTE, { bead: 'fabric-abc' });
    add('w-alpha', 'bead.claim.succeeded', BASE + 3 * MINUTE, { bead: 'fabric-abc' });

    expectOneActivePerIdentity();
    expect(store.getActiveAlerts()).toEqual([]);
    expect(store.getAlertHistory()).toHaveLength(1);
    expect(store.getAlertHistory()[0]).toMatchObject({
      id: first.id,
      status: 'resolved',
      occurrences: 2,
      resolvedAt: BASE + 2 * MINUTE,
      resolutionNote: 'worker claimed a bead',
    });

    add('w-alpha', 'worker.exhausted', BASE + 4 * MINUTE);
    const recurrence = store.getActiveAlerts()[0];
    expectOneActivePerIdentity('no-work:w-alpha');
    expect(recurrence).toMatchObject({
      identity: 'no-work:w-alpha',
      epoch: 2,
      occurrences: 1,
      status: 'active',
    });
    expect(recurrence.id).not.toBe(first.id);
    expect(store.getAlertHistory()[0].status).toBe('resolved');
  });

  it('maps stuck-worker detection to observe, resume to resolve, and relapse to a new epoch', () => {
    vi.useFakeTimers({ now: BASE });

    for (let i = 0; i < 100; i++) {
      add('w-stuck', 'tool.call', Date.now(), {
        tool: 'Read',
        path: '/src/auth.ts',
      });
    }
    const firstDetection = store.getActiveAlerts().filter((alert) => alert.kind === 'stuck');
    expect(firstDetection).toHaveLength(1);
    expect(firstDetection[0]).toMatchObject({
      identity: 'stuck:w-stuck',
      epoch: 1,
      occurrences: 1,
      status: 'active',
    });
    expectOneActivePerIdentity('stuck:w-stuck');

    // The 100-event throttle re-checks the same condition and folds it.
    for (let i = 0; i < 100; i++) {
      add('w-stuck', 'tool.call', Date.now(), {
        tool: 'Read',
        path: '/src/auth.ts',
      });
    }
    expect(store.getActiveAlerts().filter((alert) => alert.kind === 'stuck')).toMatchObject([
      { id: firstDetection[0].id, occurrences: 2 },
    ]);

    // Varied completed work removes the repeated-tool/no-progress pattern.
    vi.setSystemTime(BASE + 6 * MINUTE);
    for (let i = 0; i < 100; i++) {
      add('w-stuck', 'bead.completed', Date.now(), {
        tool: `Tool-${i}`,
      });
    }
    expect(store.getActiveAlerts().filter((alert) => alert.kind === 'stuck')).toEqual([]);
    expectOneActivePerIdentity();
    const resolved = store.getAlertHistory().find((alert) => alert.kind === 'stuck');
    expect(resolved).toMatchObject({
      id: firstDetection[0].id,
      status: 'resolved',
      resolutionNote: 'worker resumed progress',
    });

    // A later repeated-tool pattern is a real recurrence, not a resurrection.
    vi.setSystemTime(BASE + 8 * MINUTE);
    for (let i = 0; i < 100; i++) {
      add('w-stuck', 'tool.call', Date.now(), {
        tool: 'Grep',
        path: '/src/auth.ts',
      });
    }
    const recurrence = store.getActiveAlerts().filter((alert) => alert.kind === 'stuck');
    expectOneActivePerIdentity('stuck:w-stuck');
    expect(recurrence).toMatchObject([
      {
        identity: 'stuck:w-stuck',
        epoch: 2,
        occurrences: 1,
        status: 'active',
      },
    ]);
    expect(recurrence[0].id).not.toBe(firstDetection[0].id);
    expect(resolved?.status).toBe('resolved');
  });
});
