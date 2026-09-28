/**
 * Alert state durability across process restarts (docs/alert-policy.md §Durability)
 *
 * Pins the durability model: the AlertManager registry persists to SQLite
 * (alert_records + alert_fold_watermarks), the boot path restores it through
 * AlertManager.restore() BEFORE the tailer replays recent log files, and the
 * per-(session, worker) fold watermarks keep the replay from re-folding
 * events a previous generation already consumed. Together these guarantee
 * the acceptance contract: a restart never creates a duplicate epoch — the
 * post-restart inventory is the pre-restart inventory continued, not
 * re-derived.
 *
 * Each test simulates two process generations ("gen1" / "gen2") sharing one
 * HistoricalStore — the same shape as the real restart: service stops
 * (flushing via clear()/SIGINT), service starts (restorePersistedAlerts),
 * DirectoryTailer replays the recent log window through store.add().
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { InMemoryEventStore } from './store.js';
import { HistoricalStore } from './historicalStore.js';
import { AlertRecord, alertIdentity } from './alertManager.js';
import { LogEvent } from './types.js';

const T0 = 1_700_000_000_000;

/** A NEEDLE event that drives the alert observation sites. */
const needleEvent = (
  worker: string,
  seq: number | undefined,
  type: 'worker.exhausted' | 'worker.queue_empty' | 'bead.claim.succeeded',
  ts: number,
  session = 'sess-a'
): LogEvent => ({
  ts,
  worker,
  level: 'info',
  msg: type,
  ...(seq !== undefined ? { sequence: seq } : {}),
  ...(session ? { session } : {}),
  ...(type === 'bead.claim.succeeded' ? { bead: 'bd-1' } : {}),
});

describe('alert state durability across restarts', () => {
  let dbDir: string;
  let dbPath: string;
  let historicalStore: HistoricalStore;

  beforeEach(() => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-alert-durability-'));
    dbPath = path.join(dbDir, 'fabric.db');
    historicalStore = new HistoricalStore(dbPath);
  });

  afterEach(() => {
    historicalStore.close();
    fs.rmSync(dbDir, { recursive: true, force: true });
  });

  const newGen = () =>
    new InMemoryEventStore(10000, { persistAlerts: true, historicalStore });

  /** The inventory as the durable view sees it (what the next boot would load). */
  const persisted = () => historicalStore.loadAlertState();

  describe('persistence layer', () => {
    it('round-trips records and watermarks through saveAlertState/loadAlertState', () => {
      const record: AlertRecord = {
        id: 'no-work:w-alpha#2',
        identity: 'no-work:w-alpha',
        kind: 'no-work',
        scope: 'w-alpha',
        epoch: 2,
        status: 'resolved',
        createdAt: T0,
        firstObservedAt: T0,
        lastObservedAt: T0 + 5_000,
        resolvedAt: T0 + 6_000,
        occurrences: 7,
        notifications: 2,
        lastNotifiedAt: T0 + 4_000,
        lastReason: 'worker.exhausted',
        resolutionNote: 'worker claimed a bead',
      };
      historicalStore.saveAlertState([record], new Map([['sess-a\u0000w-alpha', 41]]));

      const { records, watermarks } = historicalStore.loadAlertState();
      expect(records).toHaveLength(1);
      expect(records[0]).toEqual(record);
      expect(watermarks.get('sess-a\u0000w-alpha')).toBe(41);
    });

    it('a fresh database loads empty — boot with no prior state falls back to replay-only', () => {
      const { records, watermarks } = historicalStore.loadAlertState();
      expect(records).toEqual([]);
      expect(watermarks.size).toBe(0);
    });

    it('loadAlertState drops malformed rows instead of failing the restore', () => {
      historicalStore.saveAlertState(
        [
          {
            id: 'no-work:w-ok#1',
            identity: 'no-work:w-ok',
            kind: 'no-work',
            scope: 'w-ok',
            epoch: 1,
            status: 'active',
            createdAt: T0,
            firstObservedAt: T0,
            lastObservedAt: T0,
            resolvedAt: null,
            occurrences: 1,
            notifications: 1,
            lastNotifiedAt: T0,
            lastReason: null,
            resolutionNote: null,
          },
        ],
        new Map()
      );
      // A foreign writer leaves a row with an unknown kind.
      const db = (historicalStore as unknown as { db: { prepare: Function } }).db;
      db.prepare(
        `INSERT INTO alert_records (
           id, identity, kind, scope, epoch, status, created_at,
           first_observed_at, last_observed_at, resolved_at,
           occurrences, notifications, last_notified_at, last_reason, resolution_note
         ) VALUES ('junk#1', 'junk:x', 'bogus-kind', 'x', 1, 'active', 0, 0, 0, NULL, 1, 1, 0, NULL, NULL)`
      ).run();

      const { records } = historicalStore.loadAlertState();
      expect(records.map((r) => r.id)).toEqual(['no-work:w-ok#1']);
    });
  });

  describe('store persistence wiring', () => {
    it('alert mutations persist inventory + watermarks on flushAlertState', () => {
      const store = newGen();
      store.add(needleEvent('w-alpha', 1, 'worker.exhausted', T0));
      store.add(needleEvent('w-alpha', 2, 'worker.exhausted', T0 + 1_000));
      store.flushAlertState();

      const { records, watermarks } = persisted();
      expect(records).toHaveLength(1);
      expect(records[0].identity).toBe('no-work:w-alpha');
      expect(records[0].occurrences).toBe(2);
      expect(watermarks.get('sess-a\u0000w-alpha')).toBe(2);
      store.clear();
    });

    it('persistence is off by default — mutations write nothing durable', () => {
      const store = new InMemoryEventStore(10000, { historicalStore });
      store.add(needleEvent('w-alpha', 1, 'worker.exhausted', T0));
      store.flushAlertState();

      const { records, watermarks } = persisted();
      expect(records).toEqual([]);
      expect(watermarks.size).toBe(0);
      // Live registry still deduplicates exactly as before.
      expect(store.getActiveAlerts()).toHaveLength(1);
      store.clear();
    });

    it('clear() snapshots the inventory before the in-memory wipe (SIGINT shutdown path)', () => {
      const store = newGen();
      store.add(needleEvent('w-alpha', 1, 'worker.exhausted', T0));
      expect(store.getActiveAlerts()).toHaveLength(1);

      store.clear(); // what SIGINT runs
      expect(store.getActiveAlerts()).toHaveLength(0); // memory wiped...

      const { records } = persisted();
      expect(records).toHaveLength(1); // ...durable snapshot survives
      expect(records[0].status).toBe('active');
    });
  });

  describe('restart + replay — no duplicate epochs', () => {
    it('replaying the same events after restore continues the active epoch (no fork)', () => {
      const gen1 = newGen();
      for (let i = 1; i <= 3; i++) {
        gen1.add(needleEvent('w-alpha', i, 'worker.exhausted', T0 + i * 1_000));
      }
      gen1.flushAlertState();
      const before = persisted().records;
      expect(before).toHaveLength(1);
      expect(before[0].epoch).toBe(1);

      // ── restart ──
      const gen2 = newGen();
      const report = gen2.restorePersistedAlerts();
      expect(report.recordsRestored).toBe(1);
      expect(report.duplicatesClosed).toBe(0); // conformant snapshot: nothing to fold

      // The tailer replays the same log window the previous generation read.
      for (let i = 1; i <= 3; i++) {
        gen2.add(needleEvent('w-alpha', i, 'worker.exhausted', T0 + i * 1_000));
      }

      const active = gen2.getActiveAlerts();
      expect(active).toHaveLength(1);
      // The SAME instance — same id and creation instant, counts continued
      // rather than re-derived from zero.
      expect(active[0].id).toBe(before[0].id);
      expect(active[0].createdAt).toBe(before[0].createdAt);
      expect(active[0].occurrences).toBe(3);
      expect(active[0].epoch).toBe(1);
      expect(gen2.getAlertHistory()).toHaveLength(1); // no duplicate epoch opened
      gen1.clear();
      gen2.clear();
    });

    it('a replayed claim cannot resolve-then-reopen a restored instance into a spurious epoch', () => {
      const gen1 = newGen();
      gen1.add(needleEvent('w-alpha', 1, 'worker.exhausted', T0 + 1_000));
      gen1.add(needleEvent('w-alpha', 2, 'bead.claim.succeeded', T0 + 2_000));
      gen1.add(needleEvent('w-alpha', 3, 'worker.exhausted', T0 + 3_000));
      gen1.flushAlertState();

      const before = persisted().records;
      expect(before.map((r) => r.epoch)).toEqual([1, 2]);
      expect(before[0].status).toBe('resolved');
      expect(before[1].status).toBe('active');

      // ── restart: restore, then the tailer replays all three events ──
      const gen2 = newGen();
      gen2.restorePersistedAlerts();
      gen2.add(needleEvent('w-alpha', 1, 'worker.exhausted', T0 + 1_000));
      gen2.add(needleEvent('w-alpha', 2, 'bead.claim.succeeded', T0 + 2_000));
      gen2.add(needleEvent('w-alpha', 3, 'worker.exhausted', T0 + 3_000));

      const history = gen2.getAlertHistory();
      // Without the fold watermark this replay resolves the restored epoch 2
      // (the replayed claim) and re-opens it as epoch 3 — a duplicate epoch
      // the restart itself manufactured. The watermark skips all three.
      expect(history.map((r) => r.epoch)).toEqual([1, 2]);
      expect(history[1].status).toBe('active');
      expect(history[1].occurrences).toBe(1);
      expect(history[1].createdAt).toBe(before[1].createdAt);
      gen1.clear();
      gen2.clear();
    });

    it('live observations after restore fold into the restored epoch — continuation, not forking', () => {
      const gen1 = newGen();
      gen1.add(needleEvent('w-alpha', 1, 'worker.exhausted', T0 + 1_000));
      gen1.flushAlertState();

      const gen2 = newGen();
      gen2.restorePersistedAlerts();
      // A genuinely new observation (sequence past the watermark).
      gen2.add(needleEvent('w-alpha', 4, 'worker.exhausted', T0 + 60_000));

      const active = gen2.getActiveAlerts();
      expect(active).toHaveLength(1);
      expect(active[0].epoch).toBe(1);
      expect(active[0].occurrences).toBe(2); // gen1's 1 + this one
      gen1.clear();
      gen2.clear();
    });

    it('true recurrence after a restart opens the next epoch exactly once — replays add nothing', () => {
      const gen1 = newGen();
      gen1.add(needleEvent('w-alpha', 1, 'worker.exhausted', T0 + 1_000));
      gen1.add(needleEvent('w-alpha', 2, 'bead.claim.succeeded', T0 + 2_000));
      gen1.add(needleEvent('w-alpha', 3, 'worker.exhausted', T0 + 3_000));
      gen1.flushAlertState();

      const gen2 = newGen();
      gen2.restorePersistedAlerts();

      // Live: the condition truly recurred (new claim resolves epoch 2, then
      // a fresh dry spell opens epoch 3).
      gen2.add(needleEvent('w-alpha', 4, 'bead.claim.succeeded', T0 + 60_000));
      gen2.add(needleEvent('w-alpha', 5, 'worker.exhausted', T0 + 61_000));
      expect(gen2.getActiveAlerts()[0].epoch).toBe(3);

      // The tailer replays the old window again (crash mid-replay + re-replay):
      // still exactly three epochs — no epoch 4, no duplicated instance.
      gen2.add(needleEvent('w-alpha', 1, 'worker.exhausted', T0 + 1_000));
      gen2.add(needleEvent('w-alpha', 2, 'bead.claim.succeeded', T0 + 2_000));
      gen2.add(needleEvent('w-alpha', 3, 'worker.exhausted', T0 + 3_000));
      expect(gen2.getAlertHistory().map((r) => r.epoch)).toEqual([1, 2, 3]);
      expect(gen2.getActiveAlerts()).toHaveLength(1);
      gen1.clear();
      gen2.clear();
    });

    it('cooldown state survives the restart — a restored alert does not re-notify early', () => {
      const gen1 = newGen();
      gen1.add(needleEvent('w-alpha', 1, 'worker.exhausted', T0));
      gen1.flushAlertState();
      const before = persisted().records[0];

      const gen2 = newGen();
      gen2.restorePersistedAlerts();
      // One minute later — well inside the 30-minute cooldown.
      gen2.add(needleEvent('w-alpha', 2, 'worker.exhausted', T0 + 60_000));

      const active = gen2.getActiveAlerts()[0];
      expect(active.epoch).toBe(1);
      expect(active.notifications).toBe(1); // not re-notified
      expect(active.lastNotifiedAt).toBe(before.lastNotifiedAt);
      gen1.clear();
      gen2.clear();
    });

    it('resolved history survives the restart immutable, and recurrence opens the next epoch', () => {
      const gen1 = newGen();
      gen1.add(needleEvent('w-alpha', 1, 'worker.exhausted', T0 + 1_000));
      gen1.add(needleEvent('w-alpha', 2, 'bead.claim.succeeded', T0 + 2_000));
      gen1.flushAlertState();
      const resolvedBefore = persisted().records[0];
      expect(resolvedBefore.status).toBe('resolved');

      const gen2 = newGen();
      gen2.restorePersistedAlerts();
      const resolvedAfter = gen2.getAlertHistory()[0];
      // Policy §4: a resolved instance is immutable history — byte-identical
      // across the restart, including why it cleared.
      expect(resolvedAfter).toEqual(resolvedBefore);

      // Policy §5 still holds across restarts: a new observation after the
      // resolution opens epoch 2 — it must not resurrect epoch 1.
      gen2.add(needleEvent('w-alpha', 3, 'worker.exhausted', T0 + 60_000));
      const history = gen2.getAlertHistory();
      expect(history.map((r) => r.epoch)).toEqual([1, 2]);
      expect(history[0].status).toBe('resolved');
      expect(history[0].resolvedAt).toBe(resolvedBefore.resolvedAt);
      expect(gen2.getActiveAlerts()[0].epoch).toBe(2);
      gen1.clear();
      gen2.clear();
    });

    it('fold watermarks are per (session, worker) — a new session restarts the watermark', () => {
      const gen1 = newGen();
      gen1.add(needleEvent('w-alpha', 5, 'worker.exhausted', T0 + 1_000, 'sess-1'));
      gen1.flushAlertState();
      expect(persisted().watermarks.get('sess-1\u0000w-alpha')).toBe(5);

      const gen2 = newGen();
      gen2.restorePersistedAlerts();
      // The worker rebooted into a new NEEDLE session; its sequence counter
      // restarted. Session-scoped watermarks must not suppress it.
      gen2.add(needleEvent('w-alpha', 0, 'worker.exhausted', T0 + 60_000, 'sess-2'));

      const active = gen2.getActiveAlerts();
      expect(active).toHaveLength(1);
      expect(active[0].occurrences).toBe(2);
      gen1.clear();
      gen2.clear();
    });

    it('workers are watermarked independently — one worker\'s claim never guards another', () => {
      const gen1 = newGen();
      gen1.add(needleEvent('w-alpha', 9, 'bead.claim.succeeded', T0 + 1_000));
      gen1.flushAlertState();

      const gen2 = newGen();
      gen2.restorePersistedAlerts();
      // w-bravo was silent during gen1; its first observation has a LOW
      // sequence but its own (empty) watermark — it must fold.
      gen2.add(needleEvent('w-bravo', 1, 'worker.exhausted', T0 + 60_000));
      expect(gen2.getActiveAlerts()[0].scope).toBe('w-bravo');
      gen1.clear();
      gen2.clear();
    });

    it('sequence-less legacy events bypass the watermark and still fold (documented limitation)', () => {
      const gen1 = newGen();
      gen1.add(needleEvent('w-alpha', undefined, 'worker.exhausted', T0 + 1_000));
      gen1.flushAlertState();
      expect(persisted().watermarks.size).toBe(0); // nothing watermarked

      const gen2 = newGen();
      gen2.restorePersistedAlerts();
      // Replay of a legacy (pre-sequence) stream: the event re-folds into the
      // restored instance. Occurrence evidence may inflate; the epoch
      // discipline holds because the instance keeps folding rather than
      // forking.
      gen2.add(needleEvent('w-alpha', undefined, 'worker.exhausted', T0 + 1_000));
      const active = gen2.getActiveAlerts();
      expect(active).toHaveLength(1);
      expect(active[0].epoch).toBe(1);
      expect(active[0].occurrences).toBe(2);
      gen1.clear();
      gen2.clear();
    });
  });

  describe('restore path', () => {
    it('restorePersistedAlerts on an empty database is a no-op', () => {
      const store = newGen();
      const report = store.restorePersistedAlerts();
      expect(report.recordsRestored).toBe(0);
      expect(report.watermarksRestored).toBe(0);
      expect(report.activeInstancesAfter).toBe(0);
      expect(store.getActiveAlerts()).toEqual([]);
      store.clear();
    });

    it('restores a multi-identity, multi-epoch inventory with independent states', () => {
      const gen1 = newGen();
      // no-work:w-alpha — active epoch 1
      gen1.add(needleEvent('w-alpha', 1, 'worker.exhausted', T0 + 1_000));
      // no-work:w-bravo — resolved epoch 1, active epoch 2
      gen1.add(needleEvent('w-bravo', 1, 'worker.exhausted', T0 + 2_000));
      gen1.add(needleEvent('w-bravo', 2, 'bead.claim.succeeded', T0 + 3_000));
      gen1.add(needleEvent('w-bravo', 3, 'worker.exhausted', T0 + 4_000));
      gen1.flushAlertState();

      const gen2 = newGen();
      gen2.restorePersistedAlerts();

      const active = gen2.getActiveAlerts().sort((a, b) => a.scope.localeCompare(b.scope));
      expect(active.map((a) => [a.identity, a.epoch, a.status])).toEqual([
        [alertIdentity('no-work', 'w-alpha'), 1, 'active'],
        [alertIdentity('no-work', 'w-bravo'), 2, 'active'],
      ]);
      // w-bravo's resolved epoch 1 rode along in history.
      expect(gen2.getAlertHistory().filter((r) => r.scope === 'w-bravo')).toHaveLength(2);
      gen1.clear();
      gen2.clear();
    });
  });
});
