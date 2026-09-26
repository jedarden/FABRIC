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
| `oom-risk` | Out-of-memory risk detected | When OOM risk is high (risk reported by `GET /api/alerts/oom`; see the note in "Automatic triggers and cooldowns" below) |
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

The trigger machinery itself is pinned by deterministic tests (fake timers,
spied writes, and pressure simulated by mocking `process.memoryUsage()` — no
test allocates real heap pressure or runs the real 30-minute cadence):

| Documented behavior | Test |
|---|---|
| Every automatic capture still applies retention: a scheduled `periodic` write seeded at the 50-file cap prunes the oldest snapshot | `the scheduled periodic write prunes past the 50-file cap` (`src/memoryProfiler.test.ts`) |
| Every automatic capture still applies retention: the monitor's `memory-pressure` write, end-to-end through the 30s server check | `the monitor memory-pressure write prunes past the 50-file cap` (`src/web/server.heap.test.ts`) |
| Every automatic capture still applies retention: an `oom-risk` capture via the API route | `should apply retention after an oom-risk capture` (`src/web/server.heap.test.ts`) |
| Pressure enablement: no capture under sustained pressure with snapshots disabled | `never captures under sustained pressure when snapshot writing is disabled` |
| Periodic enablement: writes require both `--heap-snapshots` and the auto-snapshot gate | `never writes snapshots unless both enablement flags are set` |
| Explicit API captures are their own enablement (flags gate automatic paths only) | `should write an explicit capture even when automatic enablement is off` |
| 30-minute pressure cooldown holds end-to-end across server checks, then re-arms | `holds the documented 30-minute cooldown while pressure persists, then re-captures` |
| Duplicate-capture prevention (scheduler): a redundant start never stacks a second interval | `ignores a redundant start so ticks stay single` |
| Duplicate-capture prevention (pressure): checks during an in-flight write stay gated by the decision-time stamp | `does not schedule a second capture while the previous write is in flight` |
| Configurable interval: the scheduler honors `snapshotIntervalMs`, not more often | `captures in memory on the configured interval, not more often` |
| Default interval is the documented 30 minutes | `pins the documented 30-minute default snapshot interval` (`src/memoryProfiler.test.ts`) |

The `oomRisk` classification that feeds `GET /api/alerts/oom` (none / low /
medium / high / critical at 80/90/95/98% of the cgroup limit, plus the
OOM-kill detection edge) is pinned in `src/systemCgroupMonitor.test.ts`.

> **Note:** the `oom-risk` row above describes when this trigger is *intended*
> to fire, but automatic capture at high OOM risk is not wired in code today:
> the monitor only reports the risk level (`GET /api/alerts/oom`), and
> `oom-risk` captures are issued by POSTing `/api/memory/heap-snapshot` with
> `{"trigger": "oom-risk"}`. Wiring the automatic path is future work; its
> capture semantics (retention applied, trigger named on disk) are already
> pinned by the tests above.

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
3. **Trigger Monitoring:** `memory-pressure` captures fire automatically when snapshots are enabled; for `oom-risk`, poll `GET /api/alerts/oom` and POST the capture (see the note in "Automatic triggers and cooldowns")
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
