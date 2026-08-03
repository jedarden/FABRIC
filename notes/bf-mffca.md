# Multi-Host Aggregation Implementation Notes

## Task: Add host label to NeedleEvent schema and Prometheus metrics for multi-host aggregation

**Bead ID:** bf-mffca  
**Status:** ✅ Already implemented - Documentation updated  
**Date:** 2026-08-03

## Summary

This task was to add multi-host support for FABRIC when multiple NEEDLE hosts push events to a centralized FABRIC instance via OTLP. Upon investigation, **the implementation was already complete** - only the metrics documentation needed updating.

## Implementation Status

### ✅ Already Implemented

1. **Schema (docs/schema.md)**
   - `host` field already documented in NeedleEvent schema
   - Marked as optional field for multi-host aggregation

2. **Normalizer (src/normalizer.ts)**
   - `extractHostFromAttributes()` function extracts host from OTLP resource attributes
   - Priority order: `needle.host` → `service.instance.id` → `getLocalHostname()`
   - Applied to all normalization paths: `normalizeOtlpLog()`, `normalizeOtlpSpanStart()`, `normalizeOtlpSpanEnd()`, `normalizeOtlpMetric()`
   - Legacy JSONL sources default to local hostname via `getLocalHostname()`

3. **Store (src/store.ts)**
   - WorkerInfo already includes `host` field (line 640)
   - Events tracked with host (lines 548, 662, 846)
   - Historical storage includes host (lines 387, 548)

4. **ServerMetrics (src/serverMetrics.ts)**
   - Per-host tracking with `eventsPerHost`, `eventTimestampsPerHost`, `workersPerHost` maps
   - `toPrometheus()` method emits metrics with `host` labels:
     - `fabric_event_count{host="..."}`
     - `fabric_ingest_rate_per_second{host="..."}`
     - `fabric_active_workers{host="..."}`
     - `fabric_tailer_files_watched{host="..."}` (local host only)

5. **Hostname Utility (src/hostname.ts)**
   - `getLocalHostname()` function with proper environment variable fallback
   - Priority: `HOSTNAME` env → `HOST` env → `os.hostname()`

6. **TUI WorkerGrid (src/tui/components/WorkerGrid.ts)**
   - Host displayed in worker list: `[${host.slice(0, 8)}]` (line 172)
   - Falls back to 'localhost' when host not specified

7. **Web UI WorkerGrid (src/web/frontend/src/components/WorkerGrid.tsx)**
   - Host badge displayed: `@{worker.host}` (lines 145-149)
   - Only shows when host is present

8. **Web UI ActivityStream (src/web/frontend/src/components/ActivityStream.tsx)**
   - Host displayed in event stream: `@{event.host.slice(0, 8)}` (lines 206-210)

### 📝 Documentation Updated

**docs/metrics.md** - Updated to reflect multi-host support:
- Added "Multi-Host Metrics" section explaining the `host` label
- Updated metric descriptions to include `host` label
- Added multi-host example output
- Added Grafana dashboard queries for multi-host monitoring
- Documented host label resolution priority order

## Testing

All existing tests pass (2646 passed, 2 skipped):
- `src/web/server.test.ts` includes tests for multi-host metrics with `host` labels
- Test expectations: `fabric_event_count{host="test-host-1"} 2`

## OTLP Host Attribute Priority

The `host` label is populated from OTLP resource attributes in this priority order:

1. **`needle.host`** - Custom NEEDLE attribute (highest priority)
2. **`service.instance.id`** - Standard OpenTelemetry attribute
3. **Local hostname** - For legacy JSONL sources or when attributes are missing

## Example Multi-Host Metrics Output

```
# HELP fabric_event_count Total events in store by host
# TYPE fabric_event_count gauge
fabric_event_count{host="ex44"} 15234
fabric_event_count{host="lab"} 8432
fabric_event_count{host="prod-worker-1"} 45621

# HELP fabric_ingest_rate_per_second Events ingested per second by host (60s window)
# TYPE fabric_ingest_rate_per_second gauge
fabric_ingest_rate_per_second{host="ex44"} 4.23
fabric_ingest_rate_per_second{host="lab"} 2.15
fabric_ingest_rate_per_second{host="prod-worker-1"} 8.92

# HELP fabric_active_workers Active workers by host
# TYPE fabric_active_workers gauge
fabric_active_workers{host="ex44"} 5
fabric_active_workers{host="lab"} 3
fabric_active_workers{host="prod-worker-1"} 12
```

## Grafana Dashboard Queries

For fleet-wide monitoring with multiple NEEDLE hosts:

**Event throughput by host:**
```
sum by (host) (rate(fabric_event_count[5m]))
```

**Active workers by host:**
```
fabric_active_workers
```

**Total events across all hosts:**
```
sum(fabric_event_count)
```

## Conclusion

The multi-host aggregation feature was already fully implemented in FABRIC. This task only required updating the metrics documentation to reflect the existing functionality. The implementation properly handles host identification from OTLP attributes and exposes it through Prometheus metrics and both TUI and web UI components.
