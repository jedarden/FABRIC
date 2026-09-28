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
/ `getAlertHistory()`), reset by `clear()` alongside the rest of the store.

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

## Invariants (test-pinned)

Pinned in `src/alertManager.test.ts` — the manager invariants directly, and
the `event store alert policy end to end` block for each clause as it
behaves through `InMemoryEventStore.add()` (duplicate observations, drifting
reasons, cooldown escalation, idempotent resolution, recurrence, and the
full stuck detect→resume→relapse cycle). The HTTP contract is pinned in
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

## Verification results

**Last verified 2026-09-28 (UTC)** on `main` — contract coverage shipped by
`fabric-17d442e5` (`629f3f2`, manager + unit pins) and `fabric-c0e278ee`
(`2b27660`, store-path integration + HTTP pins); verification recorded by
bead `fabric-d1e3d354`. Runs from the repo root:

```
npx vitest run src/alertManager.test.ts src/web/server.alerts.test.ts
#   → 2 files, 29 tests passed
npx tsc --noEmit
#   → exit 0
npx vitest run
#   → 103 files, 3571 passed / 2 skipped / 0 failed
```

`src/alertManager.test.ts` owns 26 of those tests — 15 direct manager units
(`alert identity`, `repeated observations maintain one active alert`,
`resolution workflow`, `registry housekeeping`, `record shape`) and 11 through
the store path (`event store alert wiring`, `event store alert policy end to
end`); `src/web/server.alerts.test.ts` owns the 3 HTTP-contract tests.

Contract → test ownership:

| Policy clause | Manager unit | Store path (`add()`) | HTTP `/api/alerts` |
|---|---|---|---|
| §1 Identity idempotent | `alert identity` (deterministic, kinds/scopes never collide, reason never changes identity) | `keeps one alert when the observation reason drifts` | inherits upstream |
| §2 One active instance — no-work | `opens exactly one active instance for repeated observations` | `folds repeated no-work observations of any signal into one active alert` | `folds a burst of repeated observations into one active instance per worker` |
| §2 One active instance — stuck | `folds repeated observations into the same stuck alert and tracks evidence` | `drives the full stuck cycle — detection, resume, and relapse as a new epoch` | — |
| §3 Cooldown suppress / escalate | `suppresses re-notification within the cooldown window` + `escalates an ongoing condition after cooldown without creating a new alert` | `suppresses re-notification within the cooldown and escalates after it on the same instance` | — |
| §4 Resolution idempotent | `resolves the active instance exactly once` + `is idempotent — resolving with no active instance is a no-op` | `resolves exactly once when work arrives, and repeat claims are no-ops` + `claiming without a prior alert resolves nothing and files nothing` | `moves the instance to history on resolution and opens epoch 2 on recurrence` |
| §5 Recurrence epoch | `a resolved condition can produce a new alert` + `supports repeated resolve/recurrence cycles with monotonic epochs` | `opens a fresh epoch per recurrence and never touches resolved history` | same test, epoch-2 assertions |
| Scope/kind isolation | `keeps conditions independent across kinds and workers` | `keeps workers independent — one claim only clears its own worker` | per-worker instances in the burst test |
| Store reset | `reports full history across identities and clears cleanly` | `event store alert wiring: clear() resets alert state` | — |

Re-run the two alert files after any change to `src/alertManager.ts`, the
store's observation sites (`addEvent`/claim/stuck paths in `src/store.ts`),
or `GET /api/alerts`; the full suite is the release gate.

## Future work

The alert inventory is exposed over HTTP (`GET /api/alerts`, above). Not
wired yet: rendering it in the TUI/web dashboards, and filing/closing the
corresponding beads in a bead workspace. Both should key on
`AlertRecord.identity` (dedup) and `AlertRecord.id` (the specific open/closed
bead) so the UI inherits this policy rather than re-implementing it.
