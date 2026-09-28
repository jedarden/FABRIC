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

## Future work

The alert inventory is exposed over HTTP (`GET /api/alerts`, above). Not
wired yet: rendering it in the TUI/web dashboards, and filing/closing the
corresponding beads in a bead workspace. Both should key on
`AlertRecord.identity` (dedup) and `AlertRecord.id` (the specific open/closed
bead) so the UI inherits this policy rather than re-implementing it.
