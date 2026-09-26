# Heap Snapshot Retention Policy

## Overview

FABRIC automatically captures and retains V8 heap snapshots for memory leak detection and performance analysis. Snapshots are written to `~/.needle/snapshots/` and include metadata about the capture trigger reason.

## Storage Location

- **Directory:** `~/.needle/snapshots/`
- **Filename Format:** `heap-{timestamp}-{trigger}.heapsnapshot`
  - `timestamp`: Unix timestamp in milliseconds
  - `trigger`: Capture reason (`manual`, `memory-pressure`, `periodic`, `oom-risk`, `test`)

## Retention Limits

| Policy | Limit | Description |
|--------|-------|-------------|
| **Max Disk Snapshots** | 50 files | Maximum number of snapshot files retained on disk |
| **Max Age** | 30 days | Snapshots older than 30 days are automatically deleted |
| **Max Total Size** | 10 GiB | Oldest snapshots pruned when total on-disk size is exceeded (override with `FABRIC_SNAPSHOT_MAX_TOTAL_BYTES`; the just-written snapshot is never pruned by this pass) |
| **In-Memory Snapshots** | 100 snapshots | Recent snapshots kept in memory for fast access |

## Trigger Reasons

| Trigger | Description | When Used |
|---------|-------------|-----------|
| `manual` | User-initiated snapshot | Via API endpoint `POST /api/memory/heap-snapshot` |
| `memory-pressure` | High heap usage threshold | When heap usage exceeds 80% of limit (checked every 30s; at most one capture per 30-minute cooldown while pressure persists). Requires snapshots enabled (`--heap-snapshots` or `NODE_ENV=production`) |
| `periodic` | Scheduled automatic capture | Every 30 minutes (configurable via `--snapshot-interval`) |
| `oom-risk` | Out-of-memory risk detected | When the cgroup monitor's risk is `high` or `critical` (>= 95% / >= 98% of the cgroup limit; checked every 30s, own 30-minute cooldown). Requires snapshots enabled |
| `test` | Test/verification capture | During automated testing |

## Automatic Cleanup

The retention policy is applied automatically after each snapshot write:

1. **Count-based cleanup:** Remove oldest snapshots beyond the 50-file limit
2. **Age-based cleanup:** Remove snapshots older than 30 days
3. **Size-based cleanup:** When total on-disk snapshot size exceeds 10 GiB, prune oldest-first until under the cap (override the cap with `FABRIC_SNAPSHOT_MAX_TOTAL_BYTES`; the just-written snapshot is never pruned by this pass)
4. **Execution:** `applyRetentionPolicy()` runs after `writeHeapSnapshot()`

### Verified test coverage

Every limit and cleanup rule above is pinned by deterministic tests in
[`src/memoryProfiler.test.ts`](../src/memoryProfiler.test.ts)
(`describe('Retention Policy')`, run with `npx vitest run`). The retention tests
seed the snapshot directory with sparse placeholder files (controlled size and
mtime), so the matrix proves the policy without paying for real heap-sized
writes:

| Documented behavior | Test |
|---|---|
| Limits are exactly 50 files / 30 days / 10 GiB / 100 in memory | `should pin the documented retention limits: 50 files, 30 days, 10 GiB, 100 in memory` |
| Retention runs after every snapshot write | `should apply retention policy after writing snapshot` |
| 50-file cap prunes the oldest first (by mtime, not filename) | `should enforce the 50-file on-disk limit, pruning the oldest first` |
| 30-day age cap deletes old files and keeps newer ones | `should delete snapshots older than 30 days while keeping newer ones` |
| Count and age passes combine in one retention run | `should apply the count and age passes together in one retention run` |
| Total-size cap enforced with no override (the default 10 GiB itself), pruning only until under it | `should enforce the default 10 GiB cap with no override, pruning only until under it` |
| Size-cap pruning is oldest-first | `should prune oldest snapshots when total size cap is exceeded` |
| The just-written snapshot is never pruned, even when it alone exceeds the cap | `should never prune the just-written snapshot even when it alone exceeds the size cap` |
| `FABRIC_SNAPSHOT_MAX_TOTAL_BYTES` override applies at retention time | `should apply a valid FABRIC_SNAPSHOT_MAX_TOTAL_BYTES cap at retention time` |
| Invalid override (unparseable, `0`, negative) falls back to the 10 GiB default — never a disabled cap | `should fall back to the 10 GiB default cap when FABRIC_SNAPSHOT_MAX_TOTAL_BYTES is invalid`, `should treat an invalid FABRIC_SNAPSHOT_MAX_TOTAL_BYTES as the 10 GiB default, not as a disabled cap` |
| Cleanup considers only `*.heapsnapshot` entries (co-located reports untouched) | `should count and prune only .heapsnapshot files, leaving other directory entries alone` |

The HTTP-facing pieces of the same policy (trigger validation, `400 Invalid
trigger`) are pinned in `src/web/server.heap.test.ts`; the uniform POST auth
policy in `src/web/server.authRoutes.test.ts`. The complete `/api/memory/*`
reference lives in [docs/memory-api.md](memory-api.md).

### Automatic triggers and cooldowns

Three triggers capture automatically; all three write through the same
`writeHeapSnapshot()`, so the retention policy runs after every one of them.
`manual`/`test` captures are never automatic.

| | `periodic` | `memory-pressure` | `oom-risk` |
|---|---|---|---|
| Signal | wall clock | `heapUsed` vs V8 `heap_size_limit` (process heap) | cgroup `memory.current` vs `memory.max` (system-wide) |
| Checked | every `--snapshot-interval` (default 30 min) | every 30 s by the server's monitor tick | every 30 s by the same monitor tick |
| Arming condition | always (when enabled) | usage > 80% of the heap limit | risk `high` or `critical` (>= 95% / >= 98% of the cgroup limit) |
| Minimum spacing | the configured interval | 30-minute cooldown | 30-minute cooldown — its own stamp, independent of the pressure cooldown |
| Repeated signal | steady cadence | cooldown is wall-clock from the last capture: pressure that clears and returns inside the cooldown still waits; sustained pressure re-captures every 30 min | same wall-clock semantics while risk persists |
| Write failure | caught and logged; the cadence continues and the next tick retries | caught and logged; the decision-time cooldown stamp prevents a tight retry loop — the retry waits out the full cooldown | identical to pressure |
| Cooldown bookkeeping | the scheduler itself | `lastPressureSnapshot` in server.ts | `lastOomRiskSnapshot` in server.ts — the stamps are independent, so one trigger firing never consumes the other's re-arm |

Enablement: `--heap-snapshots` (default `true` in production via
`NODE_ENV=production`) gates all three automatic paths; an explicit API
capture is its own enablement. A cgroup without a `memory.max` limit
classifies as `none`, so the oom-risk trigger never arms where risk cannot
be computed.

The trigger machinery is pinned by deterministic tests (fake timers, spied
writes, pressure simulated by mocking `process.memoryUsage()`, and the
cgroup classification mocked to a controllable level — no test allocates
real heap pressure, runs the real 30-minute cadence, or reads live
`/sys/fs/cgroup` state):

| Documented behavior | Test |
|---|---|
| **Enablement — periodic:** writes require both `--heap-snapshots` and the auto-snapshot gate | `never writes snapshots unless both enablement flags are set` (`src/memoryProfiler.test.ts`) |
| **Enablement — pressure:** no capture under sustained pressure with snapshots disabled | `never captures under sustained pressure when snapshot writing is disabled` (`src/web/server.heap.test.ts`) |
| **Enablement — oom-risk:** no capture at critical risk with snapshots disabled | `never captures at critical risk when snapshot writing is disabled` (`src/web/server.heap.test.ts`) |
| **Enablement — explicit API captures are their own enablement** (flags gate automatic paths only) | `should write an explicit capture even when automatic enablement is off` (`src/web/server.heap.test.ts`) |
| **Interval — periodic:** the scheduler honors `snapshotIntervalMs`, not more often | `captures in memory on the configured interval, not more often` (`src/memoryProfiler.test.ts`) |
| **Interval — periodic:** the default is the documented 30 minutes | `pins the documented 30-minute default snapshot interval` (`src/memoryProfiler.test.ts`) |
| **Threshold — pressure:** 80%-of-heap-limit threshold and 30-minute default cooldown pinned, `>=` boundary included | `should pin the documented 80% threshold and 30-minute default cooldown` and `should not capture below the pressure threshold` (`src/memoryProfiler.test.ts`) |
| **Threshold — pressure end-to-end:** the monitor captures on the first pressured check | `captures a memory-pressure snapshot on the first pressured check` (`src/web/server.heap.test.ts`) |
| **Threshold — oom-risk:** exactly `high`/`critical` arm the trigger; `none`/`low`/`medium` never do | `pins the documented trigger levels and 30-minute default cooldown` and `does not capture at none, low, or medium — only >= 95% arms the trigger` (`src/memoryProfiler.test.ts`) |
| **Threshold — oom-risk end-to-end:** sustained `medium` never captures through the server tick | `never captures at medium risk even when sustained — only >= 95% arms the trigger` (`src/web/server.heap.test.ts`) |
| **Threshold — oom-risk end-to-end:** `high` and `critical` each capture on the first check | `captures an oom-risk snapshot on the first high-risk check when snapshots are enabled`, `captures at critical risk too, on the same enablement` (`src/web/server.heap.test.ts`) |
| **Cooldown — pressure:** 30-minute cooldown holds end-to-end across server checks, then re-arms | `holds the documented 30-minute cooldown while pressure persists, then re-captures` (`src/web/server.heap.test.ts`) |
| **Cooldown — oom-risk:** its own 30-minute cooldown holds end-to-end, then re-arms | `holds the documented 30-minute cooldown while critical risk persists, then re-captures` (`src/web/server.heap.test.ts`) |
| **Cooldown — oom-risk (pure policy):** spacing enforced, `>=` boundary exact, custom override honored | `respects its own cooldown between oom-risk snapshots`, `honors a custom cooldown override` (`src/memoryProfiler.test.ts`) |
| **Repeated pressure:** a second episode inside the cooldown neither resets nor bypasses it (wall-clock, not per-episode) | `pressure that clears and returns inside the cooldown still waits for the original cooldown` (`src/web/server.heap.test.ts`) |
| **Independent stamps:** a pressure capture never consumes the oom-risk re-arm, and vice versa | `a pressure capture does not consume the oom-risk cooldown (independent stamps)` (`src/web/server.heap.test.ts`) |
| **Failure — periodic:** a rejected write is caught and logged; the cadence continues and the next tick retries | `keeps the cadence when a scheduled write fails` (`src/memoryProfiler.test.ts`) |
| **Failure — pressure:** a rejected write is caught, logged, and still holds the cooldown (no tight retry loop) | `a failed pressure write is caught, logged, and still holds the cooldown` (`src/web/server.heap.test.ts`) |
| **Failure — oom-risk:** identical semantics to pressure | `a failed oom-risk write is caught, logged, and still holds the cooldown` (`src/web/server.heap.test.ts`) |
| **Failure — explicit API capture:** a rejected write surfaces as a structured 500, never a crash or a false 200 | `should return 500 when the snapshot write fails` (`src/web/server.heap.test.ts`) |
| **Duplicate-capture prevention (scheduler):** a redundant start never stacks a second interval | `ignores a redundant start so ticks stay single` (`src/memoryProfiler.test.ts`) |
| **Duplicate-capture prevention (pressure):** checks during an in-flight write stay gated by the decision-time stamp | `does not schedule a second capture while the previous write is in flight` (`src/web/server.heap.test.ts`) |
| **Retention interaction — periodic:** a scheduled write seeded at the 50-file cap prunes the oldest snapshot | `the scheduled periodic write prunes past the 50-file cap` (`src/memoryProfiler.test.ts`) |
| **Retention interaction — pressure:** the monitor's write, end-to-end through the 30s check, prunes past the cap | `the monitor memory-pressure write prunes past the 50-file cap` (`src/web/server.heap.test.ts`) |
| **Retention interaction — oom-risk:** the monitor's write, end-to-end through the 30s check, prunes past the cap | `the monitor oom-risk write prunes past the 50-file cap` (`src/web/server.heap.test.ts`) |
| **Retention interaction — oom-risk via API route:** an explicit `oom-risk` capture applies retention | `should apply retention after an oom-risk capture` (`src/web/server.heap.test.ts`) |

The `oomRisk` classification that feeds both `GET /api/alerts/oom` and the
automatic oom-risk trigger (none / low / medium / high / critical at
80/90/95/98% of the cgroup limit, plus the OOM-kill detection edge) is
pinned in `src/systemCgroupMonitor.test.ts`.

## API Access

**Authentication:** every memory-mutating `POST` below — `heap-snapshot`,
`capture`, `baseline`, and `trend/save` — requires
`Authorization: Bearer $FABRIC_AUTH_TOKEN` (same as every POST endpoint in
FABRIC; see `docs/api-auth.md`). All `GET`s here are open and read-only — the
memory profiler's one-time in-memory initialization on a first stats read
(`docs/memory-api.md`) is the sole, memory-only exception.

> Complete request/response schemas, error tables, enablement behavior, and
> retention overrides for every `/api/memory/*` endpoint:
> **[docs/memory-api.md](memory-api.md)**.

### Manual Capture
```bash
curl -X POST http://localhost:3000/api/memory/heap-snapshot \
  -H "Authorization: Bearer $FABRIC_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"trigger": "manual"}'
```

Requires authentication (like every POST). Omitting `trigger` defaults to `manual`;
a `trigger` outside the documented set is rejected with `400 Invalid trigger`
(the value becomes part of the on-disk filename, so it is never passed through raw).

### List Snapshots
```bash
curl http://localhost:3000/api/memory/snapshots?count=10
```

### Trend Analysis
```bash
curl http://localhost:3000/api/memory/trend
```

## Configuration

### CLI Options
```bash
fabric web --heap-snapshots --snapshot-interval 30
```

- `--heap-snapshots`: Enable automatic capture (default: `true` in production)
- `--snapshot-interval <minutes>`: Set interval between periodic captures (default: `30`)

### Environment Variables
- `NODE_ENV=production`: Enables automatic heap snapshots
- `FABRIC_AUTH_TOKEN`: Required for POST endpoints
- `FABRIC_SNAPSHOT_MAX_TOTAL_BYTES`: Overrides the total on-disk snapshot size cap (default: 10 GiB)

## Analysis Tools

### getHeapSnapshots()
Reads all snapshots from disk with metadata:
```typescript
import { getHeapSnapshots } from './heapDiff.js';

const snapshots = getHeapSnapshots();
// Returns: Array<{filename, filepath, timestamp, sizeBytes, sizeMb, trigger}>
```

### compareSnapshots(baseline, current)
Compares two snapshots for memory growth:
```typescript
import { compareSnapshots } from './heapDiff.js';

const diff = compareSnapshots(snapshots[0], snapshots[1]);
// Returns: {durationMs, sizeGrowthBytes, growthRateMbPerHour, assessment, recommendations}
```

### analyzeTrend()
Analyzes trends across all snapshots:
```typescript
import { analyzeTrend } from './heapDiff.js';

const trend = analyzeTrend();
// Returns: {snapshots, diffs, overallAssessment, avgGrowthRateMbPerHour, projectedGrowth24hMb}
```

## Monitoring

### Retention Status
Check current snapshot count and retention state:
```bash
ls -la ~/.needle/snapshots/ | wc -l  # Count snapshots
du -sh ~/.needle/snapshots/           # Check disk usage
```

### Trend Reports
Generate and save trend analysis:
```bash
curl -X POST http://localhost:3000/api/memory/trend/save \
  -H "Authorization: Bearer $FABRIC_AUTH_TOKEN"
# Saves to: ~/.needle/snapshots/reports/trend-report-{timestamp}.md
```

## Best Practices

1. **Regular Reviews:** Check trend analysis weekly for memory growth patterns
2. **Manual Captures:** Capture snapshots before/after suspected memory leaks
3. **Trigger Monitoring:** `memory-pressure` and `oom-risk` captures fire automatically when snapshots are enabled; poll `GET /api/alerts/oom` to see the risk level the oom-risk trigger acts on
4. **Disk Space:** Monitor `~/.needle/snapshots/` size - retention policy prevents unbounded growth
5. **Backup Important Snapshots:** Copy critical snapshots elsewhere before retention cleanup

## Integration with NEEDLE Workers

FABRIC's heap snapshot system integrates with NEEDLE worker telemetry:
- Worker PIDs are tracked via `memorySampler.ts`
- Per-worker memory statistics complement heap snapshots
- OTLP metrics provide additional memory pressure signals

## Troubleshooting

### Snapshots Not Created
- Check directory exists: `ls -la ~/.needle/snapshots/`
- Verify write permissions: `touch ~/.needle/snapshots/test`
- Review logs: `journalctl --user -u fabric-web.service`

### High Disk Usage
- Verify retention policy: Check file count and ages
- Manual cleanup: `rm ~/.needle/snapshots/heap-*.heapsnapshot`
- Adjust limits: Modify `MAX_DISK_SNAPSHOTS` and `MAX_SNAPSHOT_AGE_DAYS` in code, or set `FABRIC_SNAPSHOT_MAX_TOTAL_BYTES` to change the size cap without a code change

### Analysis Not Working
- Ensure minimum 2 snapshots exist for comparison
- Check snapshot file integrity (file size > 1KB)
- Review trigger metadata in filenames
