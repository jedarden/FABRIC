# Alert Deduplication Policy — repeated NEEDLE no-work and stuck observations

**Status:** Active (2026-09-27, bead fabric-17d442e5)
**Implementation:** `src/alertManager.ts` (`AlertManager`)

## Problem

NEEDLE emits the same degraded-condition observations repeatedly: a worker with
an empty queue produces `worker.queue_empty` / `worker.exhausted` events on
every selection pass, and a stuck worker keeps failing `isWorkerStuck`
re-checks. Treating every observation as its own alert bead spawns a pile of
duplicates for what is *one ongoing problem* — and burying the signal is worse
than no alert at all. This document defines the dedup policy that sits between
raw observations and alert beads.

## Policy

### 1. Identity is idempotent

An alert's identity is a pure function of the condition:

```
identity = "<kind>:<scope>"        e.g. "no-work:w-alpha", "stuck:w-bravo"
```

- `kind` — `no-work` (worker observes no available work) or `stuck` (worker
  detected stuck by `src/tui/utils/stuckDetection.ts`).
- `scope` — the condition's subject, normally the worker id. A fleet-wide
  condition may use a fixed pseudo-scope (e.g. `fleet`).

Evidence — reason text, occurrence counts, timestamps, severity — is **never**
part of identity. A stuck worker whose drifts between "no activity for 3m" and
"repeated tool calls on `src/auth.ts`" still maps to the same identity. A
changing reason must not fork the alert.

### 2. One active alert per identity

While a condition holds, every observation folds into the condition's **single
active instance**: `occurrences` and `lastObservedAt` advance, `lastReason`
refreshes. No new instance is created. This is the invariant that keeps one
ongoing problem = one open alert bead.

### 3. Cooldown

An active instance re-notifies at most once per cooldown window
(`DEFAULT_ALERT_COOLDOWN_MS` = 30 minutes; configurable via `cooldownMs`).
Within the window, observations are deduplicated silently. After the window,
an *ongoing* condition escalates — `notifications` increments and
`lastNotifiedAt` advances — but it is **still the same instance**. Escalation
re-surfaces; it never duplicates.

### 4. Resolution

`resolve(kind, scope)` closes the active instance: `status` becomes
`resolved`, `resolvedAt` is stamped, and an optional note records *why* the
condition cleared. Resolution is idempotent — resolving a condition with no
active instance is a no-op returning `null`. A resolved instance is immutable
history; it is never mutated or resurrected.

### 5. Recurrence opens a new alert

The first observation of an identity **after** its active instance resolved
opens a new instance: the next `epoch` for the same identity, with a fresh
`id` (`<identity>#<epoch>`), fresh occurrence counts, and `outcome:
'new-epoch'`. This is the second half of the acceptance contract: a resolved
condition can produce a new alert.

## Observation → alert mapping

| NEEDLE signal | FABRIC observation point | Alert action |
|---|---|---|
| `worker.queue_empty`, `worker.exhausted` events | store (`addEvent`) | `observe('no-work', worker)` |
| `bead.claim.succeeded` | store (`addEvent`) | `resolve('no-work', worker)` — work arrived |
| `isWorkerStuck` re-check flips false→true (or stays true) | store, throttled every 100 events/worker | `observe('stuck', worker, reason)` |
| `isWorkerStuck` re-check flips true→false | store, same site | `resolve('stuck', worker)` |

Observation times come from the event timestamp; resolution notes name the
clearing signal (`worker claimed a bead`, `worker resumed progress`).

## API

```typescript
import { AlertManager, alertIdentity } from './alertManager.js';

const alerts = new AlertManager({ cooldownMs: 30 * 60 * 1000 });

alerts.observe('no-work', 'w-alpha', { at: ts, reason: 'worker.exhausted' });
// → { outcome: 'created' | 'deduplicated' | 'escalated' | 'new-epoch', alert, previous? }

alerts.resolve('no-work', 'w-alpha', { at: ts, note: 'worker claimed a bead' });
// → AlertRecord | null (null when nothing active — idempotent)

alerts.active('no-work', 'w-alpha');  // active instance or null
alerts.activeAlerts();                // all active instances
alerts.history();                     // every instance, resolved included
```

The event store owns one `AlertManager` (`InMemoryEventStore.getActiveAlerts()`
/ `getAlertHistory()`), reset by `clear()` alongside the rest of the store —
after `clear()` snapshots the inventory to SQLite when the store owns the
durable inventory (§Durability).

Every NEEDLE observation enters through `InMemoryEventStore.add()`, so the
store's observation sites are the single enforcement point of this policy:
there is no path to an alert bead that bypasses the manager, and the HTTP
surface below can only report what the policy produced.

## HTTP surface

```
GET /api/alerts   →  { "active": AlertRecord[], "history": AlertRecord[] }
```

`active` is the open-bead inventory — at most one instance per
`kind:scope` identity, no matter how many observations arrived. `history`
is every instance including resolved epochs. Read-only, like every GET
endpoint (docs/api-auth.md).

## Bead emission

The store emits each alert-manager lifecycle result through
`src/alertBeadFiler.ts`. The filer keys the in-memory filed-bead inventory by
the stable `AlertRecord.id` (`<kind>:<scope>#<epoch>`):

- `created` and `new-epoch` file one open bead for that instance;
- `deduplicated` and `escalated` fold evidence into that same open bead, so a
  cooldown notification never creates a second bead;
- resolution closes the instance bead with its resolution note; and
- recurrence files the next epoch while leaving the closed epoch immutable.

The filer also enforces the identity at the creation boundary. If a repeated
or concurrent producer arrives with a different instance id while an open row
already exists for the same `kind:scope`, the existing row is used as the
canonical bead and any other open rows for that identity are closed after their
evidence is folded into it. A resolution applies the same identity-level rule,
including legacy rows that do not carry the current stable instance id. This
makes the normal ingest path safe even when an explicit reconciliation pass
has not run yet.

`GET /api/alerts/beads` exposes the open and closed filed-bead inventory.
`POST /api/alerts/beads/reconcile` (authenticated) folds a legacy duplicate
inventory down to one open bead per active instance, preserves the canonical
evidence, and closes duplicate or orphaned rows with an explanatory note.
The web service runs the same reconciliation after restoring the durable alert
registry and before starting event ingestion, so boot replay cannot re-file a
condition as a duplicate.

## Legacy reconciliation

Inventories written **before** this policy — or imported from any
non-deduplicating source — hold one record *per observation*: many active
alerts for the same worker, exactly the pile §2 forbids. Reconciliation is
the audit-and-fold step that brings such an inventory to the policy's shape
without losing its history:

```typescript
import { reconcileLegacyAlerts } from './alertManager.js';

// Pure: audits a legacy snapshot, never mutates it.
const { inventory, report } = reconcileLegacyAlerts(legacyRecords, { at: now });
// report: { recordsAudited, identitiesAudited, duplicatesClosed,
//           activeInstancesAfter, reconciled: [{ identity, kind, scope,
//           canonicalId, closedIds }] }

// Registry ingest: replace live state with a reconciled snapshot.
alertManager.restore(legacyRecords);          // → report
alertManager.reconcileLegacyDuplicates();     // audit live state in place

// Store passthroughs (the store owns the manager):
store.restoreAlertRecords(legacyRecords);
store.reconcileLegacyAlerts();
```

Rules:

- **Audit** — records group by `identity` (derived via `alertIdentity(kind,
  scope)` when a pre-policy row has none) and order by epoch, then createdAt
  (epoch derived from creation order when a row lacks one; derived numbers
  are audit labels — ids stay the keys, and `observe()` counts epochs
  positionally, so derivation never changes which instance is active).
- **Canonical** — of an identity's active records, the **earliest-created**
  survives: the longest-standing record keeps its id, createdAt, and epoch.
- **Duplicates closed with documented reasons** — every other active record
  becomes resolved history: `resolvedAt` stamped and `resolutionNote` set to
  `legacy duplicate of <canonicalId> — closed by inventory reconciliation
  (one active alert per identity; docs/alert-policy.md §2)`. Its evidence
  folds into the canonical record (occurrence/notification totals summed,
  first/lastObservedAt min/max, `lastReason` from the most recent), so
  closing a duplicate loses no audit signal.
- **Resolved history is untouched** — reconciliation closes duplicate
  *actives* only; it never rewrites or resurrects an already-resolved epoch.
- **Future observations deduplicate** — the reconciled inventory orders each
  identity's records resolved-epochs-first with the canonical ACTIVE
  instance last, the exact position `observe()` reads, so the next
  observation folds into the survivor instead of opening a new epoch.
- **Idempotent** — reconciling an inventory (or its own output) that already
  conforms closes zero duplicates and changes nothing.

This is also the durable-restore path: persisted alert state (§Durability
below) loads through `restore()` / `restoreAlertRecords()` so a restored
snapshot is policy-conformant before the first live observation lands.

**Live note (2026-09-28):** the `fabric-web.service` process on codinghome
had started ~7h before the policy shipped (`629f3f2`/`2b27660`), so the
served inventory was the legacy per-observation pile — under the old build
`GET /api/alerts` did not exist yet and nothing deduplicated. Restarting the
service onto the policy-enforcing build replaced that pile: the inventory
rebuilds through `InMemoryEventStore.add()` with §2 enforced from the first
observation, and `reconcileLegacyAlerts` covers any older snapshot imported
afterward.

### Checkpoint audit (2026-09-28)

The repository checkpoint was audited after the live reconciliation. It contains
54 historical legacy alert rows: 52 `no-work` rows across five worker
identities and two `stuck` rows across two worker identities. All 54 are closed;
none remains an active legacy row. The previously closed rows retain their
original close reasons, while the policy reconciliation path records an explicit
canonical id and duplicate-close reason whenever it repairs a live inventory.

The regression is pinned at the bead-filer boundary by
`src/alertBeadFiler.test.ts`: a duplicate-laden snapshot containing both
`no-work` and `stuck` identities is reconciled to the earliest-created active
epoch, each duplicate is closed with the identity-policy reason, and repeated
post-reconciliation observations continue updating those two canonical rows
without creating another open row.

## Durability across restarts

The lifecycle sections above define transitions *within* one process. This
section defines what happens to the inventory when FABRIC restarts — which
it does routinely (systemd restarts, crash-loops, deploys).

### The model: persisted inventory + watermark-guarded replay

FABRIC's restart model re-reads recent log files from the beginning
(`DirectoryTailer.startupRereadMs`, default 4 hours) and re-feeds them
through `InMemoryEventStore.add()` to reconstruct worker state. That replay
is the hazard: a naive replay of the already-consumed window into a restored
registry would re-run a `bead.claim.succeeded` resolution and then re-open
the condition as a **spurious next epoch** — a duplicate epoch the restart
itself manufactured, not a real recurrence.

Neither pure alternative is sufficient on its own:

- **Reconstruction from replay alone** loses everything older than the
  replay window (epoch numbering restarts per process generation, occurrence
  totals and cooldown state reset — every crash-loop re-notifies a
  long-running condition), and silently rewrites the inventory each boot.
- **Persistence alone** restores the registry but still lets the replayed
  window re-fold evidence, spurious-resolve a restored active instance, and
  fork it into a duplicate epoch (above).

The implemented model is the combination:

1. **Persist** — the store that owns the durable inventory (web mode;
   `getStore({ persistAlerts: true })`) writes the full registry — every
   instance, active **and** resolved epochs — plus per-source **fold
   watermarks** to SQLite (`alert_records`, `alert_fold_watermarks` in the
   historical DB, schema v5). Writes are debounced (2 s) after any alert
   mutation and synchronous on shutdown (`clear()`, the SIGINT path, snapshots
   before the in-memory wipe).
2. **Restore before replay** — at boot, the web service calls
   `store.restorePersistedAlerts()` immediately after creating the store and
   **before any ingest path can run** (OTLP receivers, tailer replay). The
   snapshot loads through `AlertManager.restore()`, so it is reconciled into
   the exact shape `observe()` expects — one active instance per identity,
   positioned last per identity — before the first replayed observation.
3. **Guard the replay** — each alert observation/resolve site checks the
   event against the fold watermark for its `(session, worker)` source: the
   highest event `sequence` already offered to the registry in any
   generation. Events at or below the watermark are skipped — they were
   consumed; re-folding them is what would resolve-then-reopen a restored
   instance. Live events (sequence above the watermark) fold normally, and
   every fold advances the watermark.

```typescript
// Boot (src/cli.ts, web command) — order is load-bearing:
const store = getStore({ persistAlerts: true });
const report = store.restorePersistedAlerts();   // BEFORE tailer/OTLP start
tailer.start();                                   // replay folds into restored epochs
```

### Guarantees

- **G1 — Epoch continuity.** A condition active at shutdown keeps its
  instance across the restart: same `id` (`<identity>#<epoch>`), same
  `createdAt`, occurrences continue. A restart never opens a new epoch for a
  condition that was already active.
- **G2 — No duplicate epochs.** After restore + replay, the inventory equals
  what single-generation processing of the same stream would have produced:
  one instance per `(identity, epoch)`, epochs contiguous. Replaying the
  window twice (crash mid-replay) still adds nothing — only a *post-watermark*
  observation can fold, and only a real post-resolution recurrence in the
  event stream opens the next epoch.
- **G3 — Cooldown continuity.** `lastNotifiedAt` persists, so a condition
  notified minutes before a crash-loop restart does not re-notify immediately
  after boot.
- **G4 — Id stability.** Because ids survive restarts, downstream consumers
  (the future bead-filer, dashboards) can key on `AlertRecord.id` without an
  restart re-filing or re-numbering their alerts.
- **G5 — Conformant restore.** A snapshot — including one written by a
  foreign, non-deduplicating writer — loads through §Legacy reconciliation,
  so a legacy pile imported from disk collapses to one active instance per
  identity before the first live observation.

### What persists vs. what reconstructs

| State | Across a restart |
|---|---|
| Alert registry (all epochs, occurrence/notification counts, cooldown, resolution notes) | **Persisted** (`alert_records`) |
| Fold watermarks per `(session, worker)` | **Persisted** (`alert_fold_watermarks`) |
| Worker state, analytics, collisions, conversations | Reconstructed from the replayed window (unchanged pre-durability behavior) |
| Events themselves | Never persisted by FABRIC — the NEEDLE JSONL logs are the source of truth |

### Scope and limitations

- **Only the web service owns the durable inventory.** Ephemeral CLI views
  (`tui`, `logs`, `digest`) reconstruct from their replay window only and
  never persist or restore — they are read-only views, and an offline run
  must not write the live service's inventory.
- **Legacy sequence-less events** (pre-sequence NEEDLE formats; the
  normalizer emits `sequence: -1`) cannot be watermarked and always fold.
  Replaying them after a restore may re-fold evidence (occurrence counts can
  inflate); epoch discipline holds because the fold goes into the restored
  instance rather than forking. Modern NEEDLE emits a monotonic `sequence` on
  every event, so the fleet's live streams are fully guarded.
- **Missing/corrupt persistence** falls back to the pre-durability behavior:
  `restorePersistedAlerts()` returns zero records, the registry starts
  empty, and replay re-derives what the window covers. Alert durability is
  additive — it can degrade to replay-only, never block ingest.
- **Resolved epochs are not pruned** yet; they accumulate in `alert_records`
  (small — one row per instance). If that ever needs bounding, prune resolved
  epochs older than a window; never prune an active instance's history.

### Invariants pinned

`src/alertDurability.test.ts` simulates two process generations sharing one
SQLite store — restore + full replay of the consumed window — and pins:
epoch continuation without forking (G1), the replayed-claim
cannot-resolve-then-reopen case (G2), continuation folds of post-watermark
observations, exactly-once recurrence across a double replay (G2), cooldown
continuity (G3), immutable resolved history + §5 recurrence across restarts,
session-scoped and per-worker watermark independence, the legacy
sequence-less limitation, `clear()` snapshots before the wipe, and the
empty-database no-op boot.

## Invariants (test-pinned)

The dedicated contract matrix in `src/alertManager.contract.test.ts` pins the
public manager outcomes (`created`, `deduplicated`, `escalated`, and
`new-epoch`) plus identity folding, cooldown, idempotent resolution,
recurrence, and scope/kind isolation. Store integration coverage in
`src/store.alerts.integration.test.ts` enters through `InMemoryEventStore.add()`
and pins the event mappings for `worker.queue_empty`, `worker.exhausted`,
`bead.claim.succeeded`, and stuck-worker detect→resume→relapse transitions.
The broader regression coverage remains in `src/alertManager.test.ts`, which
also exercises the policy through the store. The HTTP contract is pinned in
`src/web/server.alerts.test.ts`:

1. `alertIdentity(kind, scope)` is deterministic; kinds and scopes never
   collide; the reason text never changes identity.
2. N repeated observations of one condition → exactly **one** active instance,
   `occurrences === N`.
3. Observations within the cooldown window are `deduplicated` and do not
   re-notify; past the window an ongoing condition `escalates` on the same
   instance.
4. `resolve` runs exactly once per instance; repeat resolves are no-ops.
5. An observation after resolution yields a **new** epoch (`new-epoch`), a new
   id, and leaves the resolved record untouched.
6. Distinct kinds and distinct workers never share an instance.

The restart-durability guarantees (G1–G5, §Durability) are pinned in
`src/alertDurability.test.ts` — two simulated process generations over one
SQLite store, proving restore + full replay of the consumed window never
opens a duplicate epoch.

## Verification results

**Last verified 2026-09-28 (UTC)** on `main` — contract coverage shipped by
`fabric-17d442e5` (`629f3f2`, manager + unit pins) and `fabric-c0e278ee`
(`2b27660`, store-path integration + HTTP pins); legacy-reconciliation
coverage added by `fabric-ade0e71c`; restart-durability coverage added by
`fabric-8402deda` (`src/alertDurability.test.ts`, §Durability pins). Runs
from the repo root:

```
npx vitest run src/alertManager.test.ts src/web/server.alerts.test.ts src/alertDurability.test.ts
#   → 3 files, 56 tests passed
npx tsc --noEmit
#   → exit 0
npx vitest run
#   → 104 files, 3603 passed / 2 skipped / 0 failed
```

`src/alertManager.test.ts` owns 36 of those tests — 15 direct manager units
(`alert identity`, `repeated observations maintain one active alert`,
`resolution workflow`, `registry housekeeping`, `record shape`), 10 legacy
reconciliation units (`legacy inventory reconciliation`, `AlertManager
legacy restore and live reconciliation`), and 11 through the store path
(`event store alert wiring`, `event store alert policy end to end`);
`src/web/server.alerts.test.ts` owns the 4 HTTP-contract tests, including the
authenticated `POST /api/events` → `GET /api/alerts` + `GET /api/alerts/beads`
end-to-end lifecycle test.

Contract → test ownership:

| Policy clause | Manager unit | Store path (`add()`) | HTTP `/api/alerts` |
|---|---|---|---|
| §1 Identity idempotent | `alert identity` (deterministic, kinds/scopes never collide, reason never changes identity) | `keeps one alert when the observation reason drifts` | inherits upstream |
| §2 One active instance — no-work | `opens exactly one active instance for repeated observations` | `folds repeated no-work observations of any signal into one active alert` | `folds a burst of repeated observations into one active instance per worker` |
| §2 One active instance — stuck | `folds repeated observations into the same stuck alert and tracks evidence` | `drives the full stuck cycle — detection, resume, and relapse as a new epoch` | — |
| §2 Legacy inventory reconciliation | `audits a duplicate-laden inventory down to one active record per identity` + `folds duplicate evidence into the canonical record` + `never touches resolved history` + `is idempotent` + `derives identity and epoch for pre-policy rows` + `positions the canonical active record last` | `restoreAlertRecords reconciles legacy state and add() deduplicates into the survivor` | inherits upstream (reconciliation happens before the surface) |
| §2 Reconciled registry dedup | `restore() reconciles a legacy snapshot and future observations deduplicate into the survivor` + `restore() preserves recurrence semantics` + `reconcileLegacyDuplicates() leaves a conforming registry untouched` | same store test, via `reconcileLegacyAlerts()` no-op | — |
| §3 Cooldown suppress / escalate | `suppresses re-notification within the cooldown window` + `escalates an ongoing condition after cooldown without creating a new alert` | `suppresses re-notification within the cooldown and escalates after it on the same instance` | authenticated `POST /api/events` lifecycle test proves the filed bead remains one open row |
| §4 Resolution idempotent | `resolves the active instance exactly once` + `is idempotent — resolving with no active instance is a no-op` | `resolves exactly once when work arrives, and repeat claims are no-ops` + `claiming without a prior alert resolves nothing and files nothing` | authenticated `POST /api/events` lifecycle test closes the one bead and ignores a duplicate claim |
| §5 Recurrence epoch | `a resolved condition can produce a new alert` + `supports repeated resolve/recurrence cycles with monotonic epochs` | `opens a fresh epoch per recurrence and never touches resolved history` | authenticated `POST /api/events` lifecycle test files epoch 2 while preserving closed epoch 1 |
| Scope/kind isolation | `keeps conditions independent across kinds and workers` | `keeps workers independent — one claim only clears its own worker` | per-worker instances in the burst test |
| Store reset | `reports full history across identities and clears cleanly` | `event store alert wiring: clear() resets alert state` + `clear() resets fold watermarks when a store is reused` | — |

Re-run the two alert files after any change to `src/alertManager.ts`, the
store's observation sites (`addEvent`/claim/stuck paths in `src/store.ts`),
the reconciliation functions, or `GET /api/alerts`; the full suite is the
release gate.

## Future work

The alert and filed-bead inventories are exposed over HTTP but are not yet
rendered as a dedicated TUI/web dashboard panel. Any future UI should key on
`AlertRecord.identity` (the condition) and `AlertRecord.id` (the specific
open/closed instance) so it inherits this policy rather than re-implementing
deduplication. Since §Durability, registry ids are stable across restarts;
the web service re-files active instances into its process-local bead view at
boot and reconciles it before ingest resumes.
