# FABRIC Metrics Export

FABRIC exposes Prometheus-compatible metrics at `/api/metrics for monitoring integration with Prometheus, Grafana, or other observability platforms.

## Endpoint

```
GET /api/metrics
```

**Response Format:** `text/plain` (Prometheus text exposition format)

**Authentication:** None (GET endpoints are open)

## Multi-Host Metrics

FABRIC supports multi-host aggregation for fleet-wide monitoring. When multiple NEEDLE hosts (e.g., `ex44`, `lab`, production clusters) push events to a centralized FABRIC instance via OTLP, the following metrics include a `host` label to distinguish data from different physical machines:

**Metrics with `host` label:**
- `fabric_event_count{host="..."}`
- `fabric_ingest_rate_per_second{host="..."}`
- `fabric_active_workers{host="..."}`
- `fabric_tailer_files_watched{host="..."}` (only for local host)

**Host Label Resolution:**
The `host` label is populated from OTLP resource attributes in the following priority order:
1. `needle.host` - Custom NEEDLE attribute (highest priority)
2. `service.instance.id` - Standard OpenTelemetry attribute
3. Local hostname (for legacy JSONL sources or when attributes are missing)

This allows a fleet-wide dashboard to query metrics by host and avoid silently merging or misattributing data from different machines.

## Available Metrics

All metrics are prefixed with `fabric_` to avoid naming conflicts.

### Server Status

| Metric | Type | Description |
|--------|------|-------------|
| `fabric_status` | gauge | Server status (1=ok, 0=overloaded/error) |
| `fabric_uptime_seconds` | gauge | Server uptime in seconds since start |
| `fabric_info{version="X.Y.Z"}` | gauge | Build information (always 1, version as label) |

### Event Processing

| Metric | Type | Description |
|--------|------|-------------|
| `fabric_event_count{host="..."}` | gauge | Total events currently in the in-memory store, per host |
| `fabric_ingest_rate_per_second{host="..."}` | gauge | Events ingested per second (60-second rolling window), per host |
| `fabric_dedup_dropped_total` | counter | Total duplicate events dropped by deduplicator |

### Connections

| Metric | Type | Description |
|--------|------|-------------|
| `fabric_websocket_clients` | gauge | Number of currently connected WebSocket clients |
| `fabric_active_workers{host="..."}` | gauge | Number of active workers, per host |
| `fabric_tailer_files_watched{host="..."}` | gauge | Number of log files being watched by DirectoryTailer, per host |

### Memory

| Metric | Type | Description |
|--------|------|-------------|
| `fabric_process_resident_memory_bytes` | gauge | Process RSS (resident set size) in bytes |

### Log Retention

| Metric | Type | Description |
|--------|------|-------------|
| `fabric_prune_last_run_timestamp_seconds` | gauge | Unix timestamp of last prune run attempt (regardless of outcome) |
| `fabric_prune_last_success_timestamp_seconds` | gauge | Unix timestamp of last successful prune run |
| `fabric_logs_dir_bytes` | gauge | Total size of watched logs directory in bytes (refreshed every 5 minutes) |

## Example Output

**Single-host setup:**
```
# HELP fabric_status Server status (1=ok)
# TYPE fabric_status gauge
fabric_status 1

# HELP fabric_uptime_seconds Server uptime in seconds
# TYPE fabric_uptime_seconds gauge
fabric_uptime_seconds 3600

# HELP fabric_info Build info
# TYPE fabric_info gauge
fabric_info{version="0.8.0"} 1

# HELP fabric_event_count Total events in store by host
# TYPE fabric_event_count gauge
fabric_event_count{host="localhost"} 15234

# HELP fabric_ingest_rate_per_second Events ingested per second by host (60s window)
# TYPE fabric_ingest_rate_per_second gauge
fabric_ingest_rate_per_second{host="localhost"} 4.23

# HELP fabric_active_workers Active workers by host
# TYPE fabric_active_workers gauge
fabric_active_workers{host="localhost"} 5

# HELP fabric_websocket_clients Connected WebSocket clients
# TYPE fabric_websocket_clients gauge
fabric_websocket_clients 3

# HELP fabric_tailer_files_watched Log files being watched by host
# TYPE fabric_tailer_files_watched gauge
fabric_tailer_files_watched{host="localhost"} 5

# HELP fabric_dedup_dropped_total Total duplicate events dropped
# TYPE fabric_dedup_dropped_total counter
fabric_dedup_dropped_total 127

# HELP fabric_process_resident_memory_bytes Process RSS in bytes
# TYPE fabric_process_resident_memory_bytes gauge
fabric_process_resident_memory_bytes 245366784

# HELP fabric_prune_last_run_timestamp_seconds Last prune run attempt (Unix timestamp)
# TYPE fabric_prune_last_run_timestamp_seconds gauge
fabric_prune_last_run_timestamp_seconds 1720123456

# HELP fabric_prune_last_success_timestamp_seconds Last successful prune run (Unix timestamp)
# TYPE fabric_prune_last_success_timestamp_seconds gauge
fabric_prune_last_success_timestamp_seconds 1720123456

# HELP fabric_logs_dir_bytes Size of watched logs directory in bytes
# TYPE fabric_logs_dir_bytes gauge
fabric_logs_dir_bytes 52428800
```

**Multi-host setup:**
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

# HELP fabric_tailer_files_watched Log files being watched by host
# TYPE fabric_tailer_files_watched gauge
fabric_tailer_files_watched{host="ex44"} 5
```

## Prometheus Configuration

Add to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'fabric'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/api/metrics'
```

## Grafana Dashboards

### Recommended Panels

1. **Server Health**
   - `fabric_status` - Stat panel (1=green, 0=red)
   - `fabric_uptime_seconds` - Stat panel (formatted as duration)

2. **Event Throughput**
   - `fabric_ingest_rate_per_second` - Time series graph (multi-host: group by host)
   - `rate(fabric_event_count[5m])` - Time series graph (multi-host: group by host)

3. **Connections**
   - `fabric_websocket_clients` - Gauge panel
   - `fabric_tailer_files_watched` - Gauge panel
   - `fabric_active_workers` - Gauge panel (multi-host: group by host)

4. **Memory Usage**
   - `fabric_process_resident_memory_bytes` - Time series graph
   - Use unit conversion to MB/GB

5. **Data Quality**
   - `rate(fabric_dedup_dropped_total[5m])` - Time series graph

### Multi-Host Dashboard Queries

For fleet-wide monitoring with multiple NEEDLE hosts, use Grafana's `by (host)` grouping:

**Event throughput by host:**
```
sum by (host) (rate(fabric_event_count[5m]))
```

**Active workers by host:**
```
fabric_active_workers
```

**Ingest rate per host (stacked):**
```
fabric_ingest_rate_per_second
```

**Total events across all hosts:**
```
sum(fabric_event_count)
```

**Host comparison table:**
```
# Events per host
sum by (host) (fabric_event_count)

# Workers per host
sum by (host) (fabric_active_workers)

# Ingest rate per host
avg by (host) (fabric_ingest_rate_per_second)
```

## Alerting Rules

Example Prometheus alerting rules:

```yaml
groups:
  - name: fabric
    interval: 30s
    rules:
      - alert: FabricDown
        expr: fabric_status == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "FABRIC server is down or overloaded"
          description: "FABRIC status is 0 for more than 1 minute"

      - alert: FabricHighMemory
        expr: fabric_process_resident_memory_bytes > 1000000000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "FABRIC memory usage is high"
          description: "FABRIC RSS is {{ $value }} bytes (>1GB)"

      - alert: FabricNoConnections
        expr: fabric_websocket_clients == 0
        for: 10m
        labels:
          severity: info
        annotations:
          summary: "FABRIC has no WebSocket clients"
          description: "No clients connected for 10 minutes"

      - alert: FabricHighDedupRate
        expr: rate(fabric_dedup_dropped_total[5m]) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "FABRIC high duplicate event rate"
          description: "Dropping {{ $value }} duplicates/sec"

      - alert: FabricPruneStale
        expr: (time() - fabric_prune_last_success_timestamp_seconds) > 36*3600
        for: 1h
        labels:
          severity: warning
        annotations:
          summary: "FABRIC log pruning is stale"
          description: "Last successful prune run was {{ $value | humanizeDuration }} ago (>36h)"
```

## Health Endpoint vs Metrics Endpoint

| Endpoint | Format | Use Case |
|----------|--------|----------|
| `/api/health` | JSON | Programmatic health checks, load balancers |
| `/api/metrics` | Prometheus text | Time-series monitoring, alerting, dashboards |

The health endpoint includes additional memory profiler stats not exposed in metrics:
- `memory.heap_used` / `memory.heap_total`
- `memory.external`
- `memory.array_buffers`
- `memory.trend` (stable/rising/falling)

Use `/api/health` for detailed diagnostics and `/api/metrics` for trend analysis.

## Metrics Completeness

The current metrics cover the essential operational aspects of FABRIC:

- ✅ **Liveness**: `fabric_status`, `fabric_uptime_seconds`
- ✅ **Throughput**: `fabric_ingest_rate_per_second`, `fabric_event_count`
- ✅ **Connections**: `fabric_websocket_clients`, `fabric_tailer_files_watched`
- ✅ **Resource usage**: `fabric_process_resident_memory_bytes`
- ✅ **Data quality**: `fabric_dedup_dropped_total`

### Future Additions (Not Currently Implemented)

Potential metrics for future enhancement:

- Worker counts by status (`fabric_workers{status="active|idle|error"}`)
- Collision count (`fabric_active_collisions`)
- Error rate by level (`fabric_events_total{level="error|warn"}`)
- Bead completion rate (`fabric_beads_completed_total`)
- Cost tracking (`fabric_cost_usd_total`)
- OTLP receiver stats (`fabric_otlp_requests_total`)
- Detailed prune metrics (files deleted, bytes freed per run)

These would require additional instrumentation in the event store and analytics modules.
