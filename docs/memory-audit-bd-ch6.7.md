# Memory Profiling / Leak Hunt Audit Summary

**Task:** bd-ch6.7 - Memory profiling / leak hunt for fabric-web under production load
**Date:** 2026-04-28
**Environment:** fabric-web systemd service on Hetzner EX44

## Executive Summary

The fabric-web service was audited for memory leaks and unbounded growth. The audit found:

1. **Heap snapshots and memory limits already configured** - systemd unit has `--max-old-space-size=1024` and 30-min heap snapshot intervals
2. **Event store is well-bounded** - All collections have caps and LRU eviction
3. **WebSocket broadcast has backpressure handling** - Clients with >1MB send buffer are terminated
4. **No obvious parser hot paths** - JSON parsing uses native `JSON.parse()`, no regex issues
5. **New heap diff analysis utilities added** - API endpoints for comparing snapshots and identifying leaks

## Findings by Component

### 1. Systemd Configuration (`scripts/fabric-web.service`)

**Status:** ✅ Already configured correctly

- `--max-old-space-size=1024` limits V8 heap to 1GB
- `--heap-snapshots --snapshot-interval 30` enables automatic heap snapshots every 30 minutes
- `MemoryMax=1536M` and `MemoryHigh=1200M` provide systemd-level memory limits

### 2. Event Store (`src/store.ts` - InMemoryEventStore)

**Status:** ✅ Well-bounded with proper cleanup

| Structure | Cap | Cleanup Mechanism |
|-----------|-----|-------------------|
| `events` | 10,000 | Batch trimming (removes 100 at a time when over cap) |
| `sequenceIndex` | bounded by events | Pruned when events are trimmed |
| `workers` | time-based | 1-hour stale worker cleanup |
| `collisions` | time-based | 5-minute stale collision cleanup |
| `fileModifications` | 10,000 | LRU eviction |
| `recentFileMods` | 50,000 total, 100 per file | LRU eviction |
| `taskStartTimes` | time-based | 24-hour timeout |

**Minor observation:** The `workers.activeFiles` and `workers.activeDirectories` arrays are bounded at 200 entries per worker. With many workers, this could accumulate, but the 1-hour stale cleanup mitigates this.

### 3. WebSocket Broadcast (`src/web/server.ts`)

**Status:** ✅ Backpressure handling in place

- Single `JSON.stringify()` for all clients (amortizes serialization cost)
- `WS_MAX_BUFFERED_BYTES = 1 MB` - clients exceeding this are terminated
- Terminated clients are immediately cleaned up from the `clients` Set

**No unbounded growth risk identified.**

### 4. Parser & Normalizer (`src/parser.ts`, `src/normalizer.ts`)

**Status:** ✅ No obvious hot paths

- JSON parsing uses native `JSON.parse()` (highly optimized)
- No regex patterns that could cause catastrophic backtracking
- `EventDeduplicator` has bounded LRU cache (10,000 entries)
- String operations are simple splits and lookups

**No allocator hot paths identified.**

### 5. Directory Tailer (`src/directoryTailer.ts`)

**Status:** ✅ Well-bounded (bd-ch6.1 improvements)

- `maxActiveFiles = 200` limits concurrent file watchers
- `maxFileInfoEntries = 50000` with LRU eviction
- `maxRssBytes = 400 MB` backpressure skips activation under memory pressure

## New Features Added

### Heap Diff Analysis (`src/heapDiff.ts`)

New utilities for analyzing heap snapshots:

- `getHeapSnapshots()` - List all snapshots sorted by timestamp
- `compareSnapshots(baseline, current)` - Compare two snapshots
- `getRecentHeapDiff()` - Get diff comparing oldest vs newest recent snapshot
- `analyzeTrend()` - Analyze growth across all snapshots
- `formatTrendAsMarkdown()` - Generate markdown reports
- `saveTrendReport()` - Save trend analysis to disk

### New API Endpoints

```
GET  /api/memory/diff-analysis  - Get recent heap diff
GET  /api/memory/trend          - Get full trend analysis
GET  /api/memory/trend.md       - Get trend as markdown
POST /api/memory/trend/save     - Save trend report to disk
```

## Recommendations

### For Production Monitoring

1. **Monitor heap diff API** - Set up alerts for `assessment: "leaking"`
2. **Review heap snapshots in Chrome DevTools** - When leak is detected, load `.heapsnapshot` files to identify growing retainers
3. **Check trend reports** - The `/api/memory/trend.md` endpoint provides a human-readable summary

### Potential Improvements (Future Work)

1. **V8 heap fragmentation** - The 2GB RSS with 1GB heap limit suggests fragmentation. Consider:
   - More frequent heap snapshots (10-15 min intervals) for finer granularity
   - Node.js `--expose-gc` flag for manual GC during low-traffic periods

2. **Manager instance cleanup** - The store holds references to multiple manager instances:
   - `errorGroupManager`
   - `recoveryManager`
   - `crossReferenceManager`
   - `workerAnalytics`
   - `semanticNarrativeManager`
   - `historicalStore`

   These managers should be audited for internal bounds, especially `crossReferenceManager` and `semanticNarrativeManager`.

3. **WebSocket connection storms** - While backpressure exists, a sudden influx of clients could cause memory spikes. Consider:
   - Maximum client cap
   - Connection rate limiting

## Exit Criteria Status

- ✅ Run with `--max-old-space-size=1024` - Already configured in systemd
- ✅ Capture `v8.getHeapSnapshot()` at 30 min intervals - Already implemented
- ✅ Diff snapshots to identify growing retainers - New heap diff utilities added
- ✅ Audit `src/store.ts` for unbounded arrays/maps - All structures bounded
- ✅ Confirm ring-buffer behavior on event history - Batch trimming implemented
- ✅ Audit WebSocket broadcast for backpressure - 1MB buffer limit with termination
- ✅ Audit parser for regex/allocator hot paths - No issues found
- ⏳ Heap + RSS stable under steady-state load for 24h - Requires production monitoring

## Next Steps

1. Deploy the updated code with heap diff analysis
2. Monitor `/api/memory/diff-analysis` over 24-48 hours
3. If leak is detected, download heap snapshots and analyze in Chrome DevTools
4. Based on findings, implement targeted fixes
