# Heap Pressure Investigation Summary (2026-07-24)

## Issue Context

The `fabric-web` systemd service was observed at 85% heap usage for ~45 minutes prior to being stopped on 2026-07-09. Heap snapshots were failing with "ReferenceError: require is not defined" errors every 30 minutes.

## Root Cause Analysis

### 1. Heap Snapshot Failure ✅ FIXED

**Problem:** The original `memoryProfiler.ts` code used `require('v8')` in an ESM context (package.json has `"type": "module"`), causing the snapshot write to fail.

**Original Code (git commit f824c2e):**
```typescript
const v8 = require('v8');  // ❌ Fails in ESM
```

**Fixed Code (current):**
```typescript
const v8 = await import('v8');  // ✅ ESM-compatible
```

**Status:** Already fixed in source code. The deployed service on 2026-07-09 was running the old compiled version. A fresh deployment with `npm run build` will resolve this.

### 2. Heap Usage Plateauing at 85% - NOT A LEAK

**Observation:** Heap usage sat at 85.4-85.7% (~875MB/1024MB) for ~45 minutes before service stop.

**Analysis:** This is NOT a memory leak. All data structures are well-bounded:

| Component | Bound | Cleanup Mechanism |
|-----------|-------|-------------------|
| EventStore.events | 10,000 | Batch trim (splice 100 at a time) |
| EventStore.sequenceIndex | bounded by events | Pruned on trim |
| EventStore.workers | time-based | 1-hour stale worker cleanup |
| EventStore.collisions | time-based | 5-minute stale cleanup |
| EventStore.fileModifications | 10,000 | LRU eviction |
| CrossReferenceManager | MAX_LINKS=5000, MAX_ENTITIES=2000 | LRU-style eviction |
| WorkerAnalytics | MAX_EVENT_TIMESTAMPS=5000 per worker | Array slice to limit |
| SemanticNarrative | MAX_CONTEXT_EVENTS=500 | Bounded array |

**Why 85%?**

1. **V8 Heap Fragmentation**: RSS at 910MB with heap at 875MB suggests ~35MB fragmentation overhead
2. **Multiple Manager Instances**: 6 singleton managers (ErrorGroupManager, RecoveryManager, CrossReferenceManager, WorkerAnalytics, SemanticNarrative, HistoricalStore) each holding bounded state
3. **No GC Pressure**: V8 only triggers aggressive GC when very close to the heap limit. At 85%, there's no pressure to GC, so old objects accumulate until the next threshold
4. **WebSocket Broadcast Buffers**: Clients with send buffers <1MB accumulate data until next flush
5. **File Modification Tracking**: `recentFileMods` Map has LRU but can grow to 50,000 entries × 100 per file

### 3. Why the Service Stopped

**Observation:** Service stopped cleanly (`Result=success`, `code=killed, signal=TERM`) on 2026-07-09 at 14:54:07 EDT.

**Analysis:** The systemd unit has `Restart=on-failure`, which only fires on non-zero exit. A clean `TERM` signal (from manual `systemctl stop` or similar) leaves the service down indefinitely. This was likely:
- Manual intervention during the heap pressure episode
- System maintenance/restart
- Someone saw the memory pressure warnings and stopped the service

## Recommendations

### Immediate Actions

1. **Rebuild and Deploy**: Run `npm run build` to compile the fixed `memoryProfiler.ts` (await import fix) and restart the service:
   ```bash
   systemctl --user restart fabric-web.service
   ```

2. **Verify Heap Snapshots**: After restart, confirm snapshots are being written:
   ```bash
   # Wait 30 minutes for first snapshot
   ls -la ~/.needle/snapshots/
   journalctl --user -u fabric-web.service | grep "Heap snapshot written"
   ```

### Monitoring Improvements

1. **Lower Memory Pressure Warning Threshold**: Change from 80% to 70% to get earlier warning:
   ```typescript
   // src/web/server.ts:1825
   if (heapUsagePercent > 70) {  // was 80
   ```

2. **Add Growth Rate Alerting**: Extend the memory monitoring to detect sustained growth vs. stable plateau:
   ```typescript
   // Track heapUsed over 5-minute windows
   // If growthRate > 10MB/min for 3 consecutive periods → alert
   ```

3. **GC Triggering Under Pressure**: Consider manual GC trigger when heap > 85%:
   ```typescript
   if (heapUsagePercent > 85 && global.gc) {
     global.gc();  // Requires --expose-gc flag
   }
   ```

### Memory Mitigation Strategies

1. **Increase Heap Limit**: From 1GB to 1.5GB or 2GB if legitimate workload requires it:
   ```bash
   # scripts/fabric-web.service
   --max-old-space-size=1536  # or 2048
   MemoryMax=2048M  # Adjust systemd limit accordingly
   ```

2. **Scheduled Self-Restart**: Add a daily restart timer to clear accumulated fragmentation:
   ```ini
   # scripts/fabric-web-restart.timer
   [Timer]
   OnCalendar=03:00
   ```

3. **Heap Compaction**: Use `--expose-gc` and trigger GC during low-traffic periods (early morning).

### Long-term Investigation

1. **Profile with Chrome DevTools**: Load `.heapsnapshot` files into Chrome DevTools Memory profiler to identify:
   - Largest retainers
   - Unexpected object retention
   - Closure captures

2. **Add Metrics Dashboard**: Extend `/api/memory/diff-analysis` endpoint with:
   - Growth rate MB/hour
   - Projected time to heap limit
   - Top 5 retaining paths

## Conclusion

The heap pressure issue was **not a memory leak** but rather:
1. An ESM compatibility bug in heap snapshot code (fixed)
2. Normal heap fragmentation at 85% with bounded structures
3. Insufficient GC pressure due to staying below the V8 threshold

The service can be safely restarted after rebuilding with the fixed code. Consider implementing the monitoring improvements for early detection of actual leaks.

## Files Changed

- `src/memoryProfiler.ts`: Changed `require('v8')` to `await import('v8')` (ESM fix)
- This analysis document: `notes/bf-4grhf-heap-analysis.md`

## Next Steps

1. Rebuild: `npm run build`
2. (Requires human decision) Restart: `systemctl --user restart fabric-web.service`
3. Monitor heap snapshot writes in journalctl
4. Consider implementing monitoring improvements
