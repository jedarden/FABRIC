# Memory API Reference

Complete reference for FABRIC's `/api/memory/*` endpoints: the memory profiler
(live process-memory tracking) and the heap snapshot analysis family (on-disk
V8 heap snapshots, diff, trend). These endpoints back the leak-hunt workflow
described in `docs/memory-audit-bd-ch6.7.md` and `docs/heap-snapshot-retention.md`.

Implemented in `src/web/server.ts` (routes), `src/memoryProfiler.ts`
(profiler), and `src/heapDiff.ts` (on-disk snapshot analysis). Endpoint
contract tests: `src/web/server.heap.test.ts`; auth sweep:
`src/web/server.authRoutes.test.ts`.

## Endpoint inventory

| # | Method | Path | Auth | Purpose |
|---|--------|------|------|---------|
| 1 | GET | `/api/memory/stats` | open | Current process memory + trend summary |
| 2 | POST | `/api/memory/capture` | Bearer | Capture a profiler snapshot (in-memory ring) |
| 3 | GET | `/api/memory/diff` | open | Diff current profiler state against baseline |
| 4 | POST | `/api/memory/baseline` | Bearer | Set the baseline used by #3 |
| 5 | POST | `/api/memory/heap-snapshot` | Bearer | Write a V8 `.heapsnapshot` to disk |
| 6 | GET | `/api/memory/snapshots` | open | List recent profiler snapshots (in-memory ring) |
| 7 | GET | `/api/memory/diff-analysis` | open | Diff two on-disk heap snapshots |
| 8 | GET | `/api/memory/trend` | open | Trend analysis across all on-disk heap snapshots |
| 9 | GET | `/api/memory/trend.md` | open | Same analysis as a markdown report |
| 10 | POST | `/api/memory/trend/save` | Bearer | Write the markdown report to disk |

## Authentication

Enforced by the single global middleware in `src/web/server.ts` (full policy:
`docs/api-auth.md`):

- **Every POST** — #2, #4, #5, #10 — requires `Authorization: Bearer
  $FABRIC_AUTH_TOKEN` when the server was started with a token
  (`--auth-token` / `FABRIC_AUTH_TOKEN`). Missing header → `401`; wrong
  token → `403`. Rejection happens before body parsing, so an unauthorized
  request has no side effects (no snapshot is written, no baseline changes).
- **Every GET** in this family is open (read-only, no secret data). Note #1
  and #6 have a benign read-path side effect documented below (an in-memory
  capture when the ring is empty) — they never touch disk and never mutate
  the baseline.
- If the server runs **without** a configured token, POSTs are open and the
  process logs a startup warning. `production` deployments should always set
  `FABRIC_AUTH_TOKEN`.

Error bodies (identical for every POST route in FABRIC):

```json
// 401 — no Authorization header
{"error": "Missing authorization", "message": "Authorization header required"}
// 403 — wrong token
{"error": "Forbidden", "message": "Invalid or expired token"}
```

## Two snapshot families — do not confuse them

The word "snapshot" appears in two unrelated stores:

| | **Profiler snapshots** (#1, #2, #3, #4, #6) | **Heap snapshots** (#5, #7, #8, #9, #10) |
|---|---|---|
| What | `process.memoryUsage()` counters | Full V8 heap dump (`.heapsnapshot`) |
| Where | In-memory ring inside the process (last 100) | Disk: `~/.needle/snapshots/` |
| Size | ~100 bytes each | ≈ heap size each (~150–200 MB observed; stop-the-world while serializing) |
| Persisted? | No — lost on restart | Yes — subject to the retention policy below |
| `external`/`arrayBuffers` fields | Yes | n/a (file-level stats only) |

`GET /api/memory/diff` compares **profiler** snapshots against a baseline you
set. `GET /api/memory/diff-analysis` compares **on-disk heap snapshot files**
against each other. There is no endpoint that mixes the two.

---

## 1. `GET /api/memory/stats`

Current memory usage with trend summary over the in-memory ring.

**Response `200`:**

```json
{
  "current": {
    "timestamp": 1790339837775,
    "rss": 1229283328,
    "heapUsed": 136129264,
    "heapTotal": 156098560,
    "external": 4602262,
    "arrayBuffers": 694370
  },
  "trend": "falling",
  "avgRss": 1220572323.84,
  "maxRss": 1300824064,
  "minRss": 1119072256
}
```

- `timestamp` — epoch milliseconds.
- All memory fields — bytes.
- `trend` — `"rising" | "falling" | "stable" | "unknown"`. `"unknown"` until
  at least 3 profiler snapshots exist. With ≥ 3, the last 10 snapshots are
  split in half and the two half-averages of `heapUsed` are compared: change
  > +5% → `rising`, < −5% → `falling`, else `stable`.
- Side effect: if the ring is empty (fresh process, first call), one snapshot
  is captured first so the response always has data.

## 2. `POST /api/memory/capture`

Capture a profiler snapshot now. Appends to the in-memory ring (oldest
trimmed beyond 100). **No disk write** — for a disk artifact use #5.

**Request:** no body required.

**Response `200`:**

```json
{
  "timestamp": 1790339837775,
  "rss": 1229283328,
  "heapUsed": 136129264,
  "heapTotal": 156098560,
  "formatted": "RSS=1.14GB, Heap=129.83MB/148.88MB, External=4.39MB"
}
```

(`formatted` is the same string the server logs on its 5-minute memory line.)

**Errors:** `401`/`403` (auth) only.

## 3. `GET /api/memory/diff`

Diff the newest profiler snapshot against the baseline set by #4.

**Response `404`** — no baseline set since process start:

```json
{"error": "No baseline set"}
```

**Response `200`:**

```json
{
  "baseline":   { "timestamp": ..., "rss": ..., "heapUsed": ..., "heapTotal": ..., "external": ..., "arrayBuffers": ... },
  "current":    { "timestamp": ..., "rss": ..., "heapUsed": ..., "heapTotal": ..., "external": ..., "arrayBuffers": ... },
  "durationMs": 60000,
  "rssDelta": 13926400,
  "heapUsedDelta": 5240832,
  "heapTotalDelta": 15700000,
  "externalDelta": 212992,
  "arrayBuffersDelta": 4096,
  "percentChange": { "rss": 1.13, "heapUsed": 3.85, "heapTotal": 10.0 }
}
```

- Deltas are `current − baseline` in bytes; `percentChange` values are
  percentages relative to the baseline (0 when the baseline field is 0).
- The baseline is **in-memory only**: restarting FABRIC clears it (and #3
  returns `404` again until #4 is re-run).

## 4. `POST /api/memory/baseline`

Set "now" as the comparison baseline. Internally performs a capture (so this
also appends to the ring and advances the 30-second monitor's cadence).

**Request:** no body required.

**Response `200`:**

```json
{
  "timestamp": 1790339900000,
  "formatted": "RSS=1.14GB, Heap=130.02MB/149.10MB, External=4.39MB"
}
```

**Errors:** `401`/`403` (auth) only.

## 5. `POST /api/memory/heap-snapshot`

Write a full V8 heap snapshot to disk. Each write is roughly heap-sized and
stops the world while serializing; the retention policy (below) is applied
**before** the response returns.

**Request body (optional):**

```json
{ "trigger": "manual" }
```

| Field | Type | Default | Constraints |
|---|---|---|---|
| `trigger` | string | `"manual"` | Must be one of `manual`, `memory-pressure`, `periodic`, `oom-risk`, `test` |

The trigger is embedded in the on-disk filename, so it is **validated, never
interpolated**: anything outside the set — including path-shaped strings like
`../../evil`, non-strings, and the empty string — is rejected with `400`
before anything touches disk.

**Response `200`:**

```json
{
  "success": true,
  "filepath": "/home/coding/.needle/snapshots/heap-1790338903206-manual.heapsnapshot",
  "trigger": "manual",
  "message": "Heap snapshot written to /home/coding/.needle/snapshots/heap-1790338903206-manual.heapsnapshot"
}
```

**Errors:**

| Status | Body | Cause |
|---|---|---|
| 400 | `{"error": "Invalid trigger", "message": "trigger must be one of: manual, memory-pressure, periodic, oom-risk, test"}` | `trigger` present but not in the allowed set |
| 500 | `{"error": "Failed to write heap snapshot", "message": "<errno message>"}` | Directory creation or snapshot write failed (permissions, ENOSPC) |
| 401/403 | see [Authentication](#authentication) | missing/wrong token |

```bash
curl -X POST http://localhost:3000/api/memory/heap-snapshot \
  -H "Authorization: Bearer $FABRIC_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"trigger": "manual"}'
```

## 6. `GET /api/memory/snapshots`

List recent **profiler** snapshots (the in-memory ring — *not* the on-disk
heap snapshot files; for those see #7/#8).

**Query parameters:** `count` — how many to return, most recent last.
Default `10`; a non-numeric value also yields `10`.

**Response `200`:**

```json
{
  "count": 2,
  "snapshots": [
    { "timestamp": 1790339807775, "rss": 1215574016, "heapUsed": 130888704, "heapTotal": 140398592 },
    { "timestamp": 1790339837775, "rss": 1229283328, "heapUsed": 136129264, "heapTotal": 156098560 }
  ]
}
```

`count` (number) equals `snapshots.length` — it can be smaller than the
requested `count` early in the process life, and is capped by the ring limit
(100). Each entry carries only `timestamp`/`rss`/`heapUsed`/`heapTotal` —
`external`/`arrayBuffers` are omitted here (present in #1's `current`).

## 7. `GET /api/memory/diff-analysis`

Compares the **oldest vs newest of the last 10 on-disk** `.heapsnapshot`
files (all files on disk when fewer than 10). Answers "is the heap growing
between snapshots?"

**Response `404`** — fewer than 2 `.heapsnapshot` files on disk:

```json
{"error": "Insufficient snapshots for diff analysis"}
```

**Response `200`** (`HeapDiffResult`, verified live):

```json
{
  "baseline": {
    "filename": "heap-1790321667529-manual.heapsnapshot",
    "filepath": "/home/coding/.needle/snapshots/heap-1790321667529-manual.heapsnapshot",
    "timestamp": 1790321679025,
    "sizeBytes": 187812408,
    "sizeMb": 179.11,
    "trigger": "manual"
  },
  "current":   { "filename": "heap-1790338903206-manual.heapsnapshot", "...": "same shape" },
  "durationMs": 17227928,
  "durationMinutes": 287.13,
  "sizeGrowthBytes": -16406681,
  "sizeGrowthMb": -15.65,
  "growthRateMbPerHour": -3.27,
  "percentChange": -8.74,
  "assessment": "stable",
  "recommendations": ["Memory growth within acceptable bounds"]
}
```

Notes:

- Snapshot `timestamp` is the **file's mtime** — copying a file with a fresh
  mtime changes its position in the ordering.
- `trigger` is parsed back out of the filename (`heap-{ts}-{trigger}.heapsnapshot`);
  `undefined` for files that don't carry one.
- `growingObjects` is reserved in the schema but never populated by the
  current implementation.

**`assessment` semantics** (from `compareSnapshots()` in `src/heapDiff.ts`):

| Assessment | When |
|---|---|
| `unknown` | Snapshots less than 10 minutes apart — too short to judge |
| `stable` | `|percentChange| < 5%`, or growth not meeting the `growing`/`leaking` bars |
| `growing` | `percentChange > 20%` but growth rate ≤ 10 MB/hour |
| `leaking` | Growing **and** faster than 10 MB/hour |

`recommendations` is a plain-string list; for `leaking` it names the growth
rate and suggests Chrome DevTools review, checking `EventStore` bounds, and
verifying WebSocket client cleanup.

## 8. `GET /api/memory/trend`

Full trend analysis across **all** on-disk heap snapshots (consecutive-pair
diffs). This is also the de-facto disk listing: `snapshots[]` carries every
retained file's summary.

**Response `200`** — always 200, even with too little data:

```json
{
  "snapshots": [ { "filename": "...", "filepath": "...", "timestamp": ..., "sizeBytes": ..., "sizeMb": ..., "trigger": "..." } ],
  "diffs":     [ { "baseline": {...}, "current": {...}, "durationMs": ..., "durationMinutes": ..., "sizeGrowthBytes": ..., "sizeGrowthMb": ..., "growthRateMbPerHour": ..., "percentChange": ..., "assessment": "...", "recommendations": [...] } ],
  "overallAssessment": "stable",
  "avgGrowthRateMbPerHour": -3.52,
  "projectedGrowth24hMb": -84.49
}
```

- With fewer than 2 on-disk snapshots: `snapshots` and `diffs` are `[]`,
  both rates are `0`, and `overallAssessment` is `"insufficient-data"`
  (contrast with #7/#9, which return `404` in that situation).
- `projectedGrowth24hMb` is simply `avgGrowthRateMbPerHour × 24` — a linear
  extrapolation, meaningful only for a sustained `growing`/`leaking` trend.

**`overallAssessment` roll-up** over the consecutive diffs:

| Value | When |
|---|---|
| `insufficient-data` | fewer than 2 snapshots on disk |
| `leaking` | at least half the diffs are `leaking` |
| `growing` | `growing + leaking` diffs ≥ 70% of all diffs |
| `stable` | everything else |

## 9. `GET /api/memory/trend.md`

The same analysis as #8, rendered as a human-readable markdown report
(`Content-Type: text/markdown; charset=utf-8`). Suitable for pasting into a
bead or issue.

**Response `200`:** the markdown document (title `# Heap Trend Analysis`,
snapshot count, overall assessment, summary table, one section per
consecutive-pair diff).

**Response `404`** — when #8 would report `insufficient-data`:

```json
{"error": "Insufficient snapshots for trend analysis"}
```

## 10. `POST /api/memory/trend/save`

Render #9's markdown and write it to disk.

**Request:** no body required.

**Response `200`:**

```json
{
  "success": true,
  "filepath": "/home/coding/.needle/snapshots/reports/trend-report-1790339000000.md",
  "message": "Trend report saved to /home/coding/.needle/snapshots/reports/trend-report-1790339000000.md"
}
```

**Response `404`** — nothing written (fewer than 2 on-disk snapshots):

```json
{"error": "Insufficient snapshots for trend report"}
```

**Errors:** `401`/`403` (auth); no `400` — the endpoint takes no input.

```bash
curl -X POST http://localhost:3000/api/memory/trend/save \
  -H "Authorization: Bearer $FABRIC_AUTH_TOKEN"
```

---

## Enablement behavior

The 10 routes above are **always mounted** — no flag gates the endpoints
themselves. Manual use (#2, #4, #5, #10) works on any start. What the
enablement flag controls is **automatic** capture:

```bash
fabric web --heap-snapshots --snapshot-interval 30
```

| Mechanism | Enabled when | Behavior |
|---|---|---|
| Periodic profiler capture + heap snapshot write | `--heap-snapshots` passed, or `NODE_ENV=production` (the flag defaults to that) | Every `--snapshot-interval` minutes (default 30): capture a profiler snapshot, and write a `periodic` heap snapshot |
| Memory-pressure heap snapshot | same enablement condition | A 30-second monitor checks `heapUsed` against the V8 `heap_size_limit`; above **80%** it logs a warning and — if snapshots are enabled and the **30-minute cooldown** has elapsed — writes a `memory-pressure` snapshot. The cooldown exists because each snapshot is heap-sized and stop-the-world. |
| 30-second monitor itself | always (no flag) | Captures a profiler snapshot every 30 s and logs a memory line every 5 min — so #1/#6/#3 have data even without `--heap-snapshots` |

Trigger values the API accepts but no automatic path currently emits:
`oom-risk` and `test` (reserved for operators and test harnesses;
`test`-triggered snapshots are written by the test suite, never by the
production service).

The running systemd unit on codinghome (`scripts/fabric-web.service`) starts
with `--heap-snapshots --snapshot-interval 30` and
`--max-old-space-size=1024` (1 GiB V8 heap), so `periodic` and
`memory-pressure` snapshots are live in production.

## Retention policy and overrides

Applied automatically by `applyRetentionPolicy()` after **every** heap
snapshot write (#5, and both automatic paths) — never on a timer.

| Policy | Limit | Overridable? |
|---|---|---|
| On-disk file count | 50 files, oldest deleted first | code constant (`MAX_DISK_SNAPSHOTS`) |
| On-disk age | 30 days from mtime | code constant (`MAX_SNAPSHOT_AGE_DAYS`) |
| On-disk total size | 10 GiB, oldest deleted first | **env: `FABRIC_SNAPSHOT_MAX_TOTAL_BYTES`** (positive integer; invalid/≤0 → default 10 GiB; re-read at each write) |
| In-memory ring | 100 profiler snapshots | code constant (`MAX_IN_MEMORY_SNAPSHOTS`) |

Overrides and locations:

| Setting | Effect |
|---|---|
| `FABRIC_SNAPSHOT_DIR` | relocates the snapshot directory (default `~/.needle/snapshots/`) for both the writer and the analysis endpoints; read once at module load |
| `FABRIC_SNAPSHOT_MAX_TOTAL_BYTES` | total-size cap in bytes, as above |

Details that matter operationally:

- The size-cap pass **never deletes the snapshot it just wrote** — a single
  oversized snapshot cannot destroy the incident record it came to create.
  It prunes oldest-first until under the cap (possibly still over the cap if
  the newest file alone exceeds it).
- Count, age, and size passes match `*.heapsnapshot` only. **Trend reports**
  (`reports/*.md`) are not pruned by any of them and accumulate until removed
  by hand — they are small (a few KB), but delete old ones if you call #10
  on a schedule.
- These heap-snapshot policies are entirely separate from NEEDLE JSONL log
  retention (`fabric prune`, `/api/retention/*`, tombstones, legal holds).
  Retention controls do **not** apply to heap snapshots and there is no
  legal-hold mechanism for them — back up a snapshot you need before the
  next write prunes it.

## Storage locations

| Path | Written by | Retained |
|---|---|---|
| `~/.needle/snapshots/heap-{epoch-ms}-{trigger}.heapsnapshot` | #5, periodic, memory-pressure | 50 files / 30 days / size-capped (see above) |
| `~/.needle/snapshots/reports/trend-report-{epoch-ms}.md` | #10 | indefinite (prune by hand) |
| in-memory ring (process memory) | #2, #4, 30-s monitor, periodic loop | last 100 captures; lost on restart |

Disk footprint estimate: at a 1 GiB heap limit, a full 50-file window can
hold ~45 GiB — the size cap (10 GiB default) is the binding constraint in
practice; tune it with `FABRIC_SNAPSHOT_MAX_TOTAL_BYTES`.

## Monitoring recipes

```bash
# Is the process memory trending badly right now?
curl -s http://localhost:3000/api/memory/stats | jq '.trend, .current'

# Is there a leak across the retained heap snapshots?
curl -s http://localhost:3000/api/memory/diff-analysis | jq '.assessment, .growthRateMbPerHour'

# Alert fuel: overall assessment + 24h projection
curl -s http://localhost:3000/api/memory/trend | jq '.overallAssessment, .projectedGrowth24hMb'

# Human-readable report for a bead/issue
curl -s http://localhost:3000/api/memory/trend.md

# Before/after an suspected leak: baseline, exercise, diff
curl -X POST -H "Authorization: Bearer $FABRIC_AUTH_TOKEN" http://localhost:3000/api/memory/baseline
#   ... reproduce the workload ...
curl -s http://localhost:3000/api/memory/diff | jq '{rssDelta, heapUsedDelta, percentChange}'

# Retained snapshots on disk, oldest vs newest
curl -s http://localhost:3000/api/memory/trend | jq '.snapshots | length'
ls -la ~/.needle/snapshots/ | wc -l; du -sh ~/.needle/snapshots/
```

Operational thresholds used by the audit workflow
(`docs/memory-audit-bd-ch6.7.md`): alert on `assessment: "leaking"` from #7,
or `overallAssessment: "leaking"` from #8; download the `.heapsnapshot`
files named in the response and load them into Chrome DevTools to identify
growing retainers.

## Related but separate endpoints

These live outside `/api/memory/*` and are **not** covered by this document:

- `GET /api/system/memory`, `/api/system/memory/history`,
  `/api/system/memory/summary` — host/cgroup memory (cgroup limit, swap,
  FABRIC RSS) from `src/systemCgroupMonitor.ts`; power the dashboard sparkline.
- `GET /api/alerts/oom` — OOM-risk alert derived from cgroup usage.
- `GET /api/health` — includes a small `memory` block fed by #1's profiler.

## Source map

| Concern | File |
|---|---|
| Route handlers (all 10) | `src/web/server.ts` (`/api/memory/*` section) |
| Auth middleware (401/403 semantics) | `src/web/server.ts` (global POST middleware; policy in `docs/api-auth.md`) |
| Profiler: capture, baseline, ring, heap write, retention | `src/memoryProfiler.ts` |
| Disk analysis: diff, trend, markdown, report save | `src/heapDiff.ts` |
| Pressure policy (80% / 30-min cooldown) | `shouldCapturePressureSnapshot()` in `src/memoryProfiler.ts`, wired in `src/web/server.ts` |
| Endpoint contract tests | `src/web/server.heap.test.ts` |
| Auth route sweep tests | `src/web/server.authRoutes.test.ts` |
| Unit tests | `src/memoryProfiler.test.ts`, `src/heapDiff.test.ts` |
| Retention policy narrative | `docs/heap-snapshot-retention.md` |
| Leak-hunt audit context | `docs/memory-audit-bd-ch6.7.md` |
