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
| **In-Memory Snapshots** | 100 snapshots | Recent snapshots kept in memory for fast access |

## Trigger Reasons

| Trigger | Description | When Used |
|---------|-------------|-----------|
| `manual` | User-initiated snapshot | Via API endpoint `POST /api/memory/heap-snapshot` |
| `memory-pressure` | High heap usage threshold | When heap usage exceeds 80% of limit |
| `periodic` | Scheduled automatic capture | Every 30 minutes (configurable via `--snapshot-interval`) |
| `oom-risk` | Out-of-memory risk detected | When OOM risk is high |
| `test` | Test/verification capture | During automated testing |

## Automatic Cleanup

The retention policy is applied automatically after each snapshot write:

1. **Count-based cleanup:** Remove oldest snapshots beyond 50 file limit
2. **Age-based cleanup:** Remove snapshots older than 30 days
3. **Execution:** `applyRetentionPolicy()` runs after `writeHeapSnapshot()`

## API Access

### Manual Capture
```bash
curl -X POST http://localhost:3000/api/memory/heap-snapshot \
  -H "Authorization: Bearer $FABRIC_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"trigger": "manual"}'
```

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
3. **Trigger Monitoring:** Use `memory-pressure` and `oom-risk` triggers for automatic detection
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
- Adjust limits: Modify `MAX_DISK_SNAPSHOTS` and `MAX_SNAPSHOT_AGE_DAYS` in code

### Analysis Not Working
- Ensure minimum 2 snapshots exist for comparison
- Check snapshot file integrity (file size > 1KB)
- Review trigger metadata in filenames
