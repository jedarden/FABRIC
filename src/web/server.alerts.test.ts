/**
 * GET /api/alerts — the deduplicated alert inventory (docs/alert-policy.md)
 *
 * Pins the store→alert-bead path as seen from the HTTP surface: the
 * inventory reports ONE active instance per kind:scope identity no matter
 * how many observations arrived, moves the instance to history when the
 * condition clears, and hands recurrence a fresh epoch without mutating
 * the resolved record. Dedup itself is enforced upstream in the store's
 * observation path (pinned in src/alertManager.test.ts); this suite pins
 * that the API inherits it rather than re-deriving anything.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createWebServer, WebServer } from './server.js';
import { InMemoryEventStore } from '../store.js';
import { resetCrossReferenceManager } from '../crossReferenceManager.js';
import { AlertRecord } from '../alertManager.js';
import { LogEvent } from '../types.js';

// Same isolation as the other server suites: keep any disk-resolving
// constant away from the real home before the module graph loads.
const { ISOLATED_SNAPSHOT_DIR } = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/fabric-alerts-test-${process.pid}-${Date.now()}`;
  process.env.FABRIC_SNAPSHOT_DIR = dir;
  return { ISOLATED_SNAPSHOT_DIR: dir };
});

afterAll(() => {
  fs.rmSync(ISOLATED_SNAPSHOT_DIR, { recursive: true, force: true });
});

const BASE = 1_750_000_000_000;
const AUTH_TOKEN = 'test-token';

describe('GET /api/alerts reports the deduplicated alert inventory', () => {
  let store: InMemoryEventStore;
  let server: WebServer;
  let port: number;
  let logDir: string;

  beforeEach(async () => {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-alerts-logs-'));
    store = new InMemoryEventStore();
    resetCrossReferenceManager();
    server = createWebServer({ port: 0, logPath: logDir, store, authToken: AUTH_TOKEN });
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

  async function getInventory(): Promise<{ active: AlertRecord[]; history: AlertRecord[] }> {
    const res = await fetch(`http://localhost:${port}/api/alerts`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { active: AlertRecord[]; history: AlertRecord[] };
    // The response is exactly the two inventory views — no per-observation rows.
    expect(Object.keys(body).sort()).toEqual(['active', 'history']);
    return body;
  }

  async function postNeedleEvent(
    worker: string,
    event: string,
    ts: number,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    const res = await fetch(`http://localhost:${port}/api/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ts: new Date(ts).toISOString(),
        event,
        session: 'alert-e2e-session',
        worker,
        data,
      }),
    });
    expect(res.status).toBe(201);
  }

  it('folds a burst of repeated observations into one active instance per worker', async () => {
    for (let i = 0; i < 5; i++) {
      add('w-alpha', { ts: BASE + i, msg: 'worker.queue_empty' });
    }
    for (let i = 0; i < 3; i++) {
      add('w-bravo', { ts: BASE + i, msg: 'worker.exhausted' });
    }

    const body = await getInventory();
    // `history` is every instance, active included (docs/alert-policy.md) —
    // nothing has resolved, so it is exactly the two active instances.
    expect(body.history).toHaveLength(2);
    expect(body.history.every((a) => a.status === 'active')).toBe(true);
    expect(body.active).toHaveLength(2);

    const alpha = body.active.find((a) => a.scope === 'w-alpha');
    expect(alpha).toMatchObject({
      identity: 'no-work:w-alpha',
      kind: 'no-work',
      epoch: 1,
      status: 'active',
      occurrences: 5,
      notifications: 1,
    });
    const bravo = body.active.find((a) => a.scope === 'w-bravo');
    expect(bravo).toMatchObject({ identity: 'no-work:w-bravo', occurrences: 3 });
  });

  it('moves the instance to history on resolution and opens epoch 2 on recurrence', async () => {
    add('w-alpha', { ts: BASE, msg: 'worker.queue_empty' });
    add('w-alpha', { ts: BASE + 1, msg: 'worker.queue_empty' });
    add('w-alpha', { ts: BASE + 2, msg: 'bead.claim.succeeded', bead: 'fabric-abc' });

    const resolved = await getInventory();
    expect(resolved.active).toHaveLength(0);
    expect(resolved.history).toHaveLength(1);
    const epoch1 = resolved.history[0];
    expect(epoch1).toMatchObject({ status: 'resolved', epoch: 1, occurrences: 2 });

    // The condition recurs → a fresh instance, the resolved one untouched.
    add('w-alpha', { ts: BASE + 3, msg: 'worker.exhausted' });
    const recurred = await getInventory();
    expect(recurred.active).toHaveLength(1);
    expect(recurred.active[0]).toMatchObject({ epoch: 2, status: 'active' });
    expect(recurred.active[0].id).not.toBe(epoch1.id);

    expect(recurred.history).toHaveLength(2);
    const still = recurred.history.find((a) => a.id === epoch1.id);
    expect(still).toMatchObject({
      status: 'resolved',
      resolvedAt: epoch1.resolvedAt,
      resolutionNote: 'worker claimed a bead',
      occurrences: 2,
    });
  });

  it('reports an empty inventory for a quiet store', async () => {
    const body = await getInventory();
    expect(body.active).toEqual([]);
    expect(body.history).toEqual([]);
  });

  it('enforces deduplication through POST /api/events and the filed-bead API', async () => {
    const worker = 'w-http-alert';
    const first = BASE;

    // Different no-work signals for the same worker are one condition. The
    // fourth observation is outside the cooldown, so it escalates the same
    // instance instead of creating another one.
    await postNeedleEvent(worker, 'worker.queue_empty', first);
    await postNeedleEvent(worker, 'worker.exhausted', first + 5 * 60_000);
    await postNeedleEvent(worker, 'worker.queue_empty', first + 10 * 60_000);
    await postNeedleEvent(worker, 'worker.exhausted', first + 31 * 60_000);

    const ongoing = await getInventory();
    expect(ongoing.active).toHaveLength(1);
    expect(ongoing.history).toHaveLength(1);
    expect(ongoing.active[0]).toMatchObject({
      id: 'no-work:w-http-alert#1',
      identity: 'no-work:w-http-alert',
      occurrences: 4,
      notifications: 2,
      status: 'active',
    });

    const beadResponse = await fetch(`http://localhost:${port}/api/alerts/beads`);
    expect(beadResponse.status).toBe(200);
    const ongoingBeads = (await beadResponse.json()) as {
      open: Array<Record<string, unknown>>;
      closed: Array<Record<string, unknown>>;
    };
    expect(ongoingBeads.open).toHaveLength(1);
    expect(ongoingBeads.open[0]).toMatchObject({
      id: 'no-work:w-http-alert#1',
      occurrences: 4,
      notifications: 2,
      status: 'open',
    });

    // Resolution is idempotent at the live ingest boundary: the first claim
    // closes the one open bead, and a duplicate claim does nothing.
    await postNeedleEvent(worker, 'bead.claim.succeeded', first + 32 * 60_000, {
      bead_id: 'fabric-http-claim',
    });
    await postNeedleEvent(worker, 'bead.claim.succeeded', first + 33 * 60_000, {
      bead_id: 'fabric-http-claim',
    });

    const resolved = await getInventory();
    expect(resolved.active).toEqual([]);
    expect(resolved.history).toHaveLength(1);
    expect(resolved.history[0]).toMatchObject({
      id: 'no-work:w-http-alert#1',
      status: 'resolved',
      occurrences: 4,
      resolutionNote: 'worker claimed a bead',
    });

    // A later no-work observation is a real recurrence: it opens epoch 2 and
    // leaves epoch 1 immutable history.
    await postNeedleEvent(worker, 'worker.queue_empty', first + 34 * 60_000);
    const recurred = await getInventory();
    expect(recurred.active).toHaveLength(1);
    expect(recurred.active[0]).toMatchObject({
      id: 'no-work:w-http-alert#2',
      epoch: 2,
      occurrences: 1,
      notifications: 1,
      status: 'active',
    });
    expect(recurred.history.find((alert) => alert.id === 'no-work:w-http-alert#1')).toMatchObject({
      status: 'resolved',
      occurrences: 4,
      resolutionNote: 'worker claimed a bead',
    });

    const finalBeadResponse = await fetch(`http://localhost:${port}/api/alerts/beads`);
    const finalBeads = (await finalBeadResponse.json()) as {
      open: Array<Record<string, unknown>>;
      closed: Array<Record<string, unknown>>;
    };
    expect(finalBeads.open).toHaveLength(1);
    expect(finalBeads.open[0]).toMatchObject({ id: 'no-work:w-http-alert#2', status: 'open' });
    expect(finalBeads.closed).toHaveLength(1);
    expect(finalBeads.closed[0]).toMatchObject({
      id: 'no-work:w-http-alert#1',
      status: 'closed',
      occurrences: 4,
      closeNote: 'worker claimed a bead',
    });
  });
});
