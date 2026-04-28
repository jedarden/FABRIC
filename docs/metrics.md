# FABRIC Metrics Export

FABRIC exposes Prometheus-compatible metrics at `/api/metrics for monitoring integration with Prometheus, Grafana, or other observability platforms.

## Endpoint

```
GET /api/metrics
```

**Response Format:** `text/plain` (Prometheus text exposition format)

**Authentication:** None (GET endpoints are open)

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
| `fabric_event_count` | gauge | Total events currently in the in-memory store |
| `fabric_ingest_rate_per_second` | gauge | Events ingested per second (60-second rolling window) |
| `fabric_dedup_dropped_total` | counter | Total duplicate events dropped by deduplicator |

### Connections

| Metric | Type | Description |
|--------|------|-------------|
| `fabric_websocket_clients` | gauge | Number of currently connected WebSocket clients |
| `fabric_tailer_files_watched` | gauge | Number of log files being watched by DirectoryTailer |

### Memory

| Metric | Type | Description |
|--------|------|-------------|
| `fabric_process_resident_memory_bytes` | gauge | Process RSS (resident set size) in bytes |

## Example Output

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

# HELP fabric_event_count Total events in store
# TYPE fabric_event_count gauge
fabric_event_count 15234

# HELP fabric_ingest_rate_per_second Events ingested per second (60s window)
# TYPE fabric_ingest_rate_per_second gauge
fabric_ingest_rate_per_second 4.23

# HELP fabric_websocket_clients Connected WebSocket clients
# TYPE fabric_websocket_clients gauge
fabric_websocket_clients 3

# HELP fabric_tailer_files_watched Log files being watched
# TYPE fabric_tailer_files_watched gauge
fabric_tailer_files_watched 5

# HELP fabric_dedup_dropped_total Total duplicate events dropped
# TYPE fabric_dedup_dropped_total counter
fabric_dedup_dropped_total 127

# HELP fabric_process_resident_memory_bytes Process RSS in bytes
# TYPE fabric_process_resident_memory_bytes gauge
fabric_process_resident_memory_bytes 245366784
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
   - `rate(fabric_event_count[5m])` - Time series graph
   - `fabric_ingest_rate_per_second` - Gauge panel

3. **Connections**
   - `fabric_websocket_clients` - Gauge panel
   - `fabric_tailer_files_watched` - Gauge panel

4. **Memory Usage**
   - `fabric_process_resident_memory_bytes` - Time series graph
   - Use unit conversion to MB/GB

5. **Data Quality**
   - `rate(fabric_dedup_dropped_total[5m])` - Time series graph

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

These would require additional instrumentation in the event store and analytics modules.
