# NEEDLE Exporter Wiring Guide

How to configure NEEDLE workers to export telemetry to FABRIC over OTLP.

## Overview

FABRIC accepts telemetry from NEEDLE via three channels:

| Channel | Protocol | Default Port | Data Types |
|---------|----------|-------------|------------|
| JSONL file tailing | filesystem | `~/.needle/logs/` | all events |
| OTLP/HTTP | HTTP+JSON/protobuf | `:4318` | logs, traces, metrics |
| OTLP/gRPC | gRPC (protobuf) | `:4317` | logs, traces, metrics |

JSONL file tailing is the default and requires no configuration. OTLP receivers
are opt-in via CLI flags.

## OTLP/HTTP Metrics (Recommended)

NEEDLE has a built-in `OtlpMetricSink` that aggregates `effort.recorded`,
`bead.completed`, `bead.failed`, and `outcome.classified` events into
cumulative OTLP metric instruments and pushes them via OTLP/HTTP.

### NEEDLE Configuration

In `needle.yaml` (or your config file):

```yaml
telemetry:
  otlp_metric_sink:
    enabled: true
    endpoint: "http://localhost:4318/v1/metrics"
```

### FABRIC Startup

```bash
# Start FABRIC with OTLP/HTTP receiver on the default port (4318)
fabric tui --otlp-http :4318

# Or for the web dashboard
fabric web --otlp-http :4318

# Or for raw tail mode
fabric tail --otlp-http :4318
```

### What Gets Exported

NEEDLE's `OtlpMetricSink` exports these instruments:

| Instrument Name | Type | Description |
|---|---|---|
| `needle.worker.tokens.in` | Sum | Cumulative input tokens |
| `needle.worker.tokens.out` | Sum | Cumulative output tokens |
| `needle.worker.cost.usd` | Sum | Cumulative cost in USD |
| `needle.worker.beads.completed` | Sum | Beads completed count |
| `needle.worker.beads.failed` | Sum | Beads failed count |
| `needle.worker.errors` | Sum | Error count |
| `needle.bead.duration` | Histogram | Bead duration samples (ms) |

Each data point carries `worker_id` and `session_id` attributes so FABRIC can
correlate metrics with the JSONL event stream.

### Alias Resolution

NEEDLE emits `needle.worker.beads.completed` and `needle.worker.beads.failed`
(plural). FABRIC resolves these to the canonical `needle.bead.completed` and
`needle.bead.failed` (singular) via the `INSTRUMENT_ALIASES` map in
`src/workerAnalytics.ts`. No action required.

### Flush Behavior

NEEDLE flushes metrics to the endpoint when either:
- 50 events have accumulated since the last push, OR
- 5 seconds have elapsed since the last push

The flush resets the counters, so each push is a delta since the previous one.

## OTLP/gRPC (Advanced)

For environments where gRPC is preferred over HTTP:

```bash
# Start FABRIC with OTLP/gRPC receiver
fabric tui --otlp-grpc :4317

# Both protocols can run simultaneously
fabric tui --otlp-grpc :4317 --otlp-http :4318
```

NEEDLE does not currently ship an OTLP/gRPC exporter. To use gRPC, configure
an OpenTelemetry Collector as a sidecar:

```yaml
# otel-collector-config.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317

exporters:
  otlp:
    endpoint: "localhost:4317"
    tls:
      insecure: true

service:
  pipelines:
    metrics:
      receivers: [otlp]
      exporters: [otlp]
```

## Dual Ingestion and Deduplication

When both JSONL tailing and OTLP are active, the same logical event may arrive
via both channels. FABRIC deduplicates on `(session_id, worker_id, sequence)`:

1. First arrival wins
2. Subsequent duplicates are silently dropped
3. `EventDeduplicator.droppedCount` tracks how many duplicates were suppressed

Events without a valid `sequence` (legacy formats with `sequence: -1`) are
always passed through, since they cannot be deduplicated.

## Source Priority

When FABRIC writes to the analytics database (`fabric.db`), it prefers
OTLP-sourced values over log-derived estimates:

| Priority | Source | Use Case |
|----------|--------|----------|
| 1 (highest) | `otlp-metric` | Direct instrument values from `OtlpMetricSink` |
| 2 | `otlp-span` | Duration derived from span start/end times |
| 3 (lowest) | `log-derived` | Estimated from JSONL log message parsing |

The `metrics_source` column on `sessions` and `session_worker_summaries`
records which source was used for each row.

## Testing the Pipeline

### Verify OTLP/HTTP connectivity

```bash
# Send a test metric payload
curl -X POST http://localhost:4318/v1/metrics \
  -H "Content-Type: application/json" \
  -d '{
    "resourceMetrics": [{
      "resource": {
        "attributes": [
          {"key": "service.name", "value": {"stringValue": "needle"}}
        ]
      },
      "scopeMetrics": [{
        "scope": {"name": "needle"},
        "metrics": [{
          "name": "needle.worker.tokens.in",
          "sum": {
            "dataPoints": [{
              "asDouble": 1500,
              "timeUnixNano": "1713693600000000000",
              "attributes": [
                {"key": "worker_id", "value": {"stringValue": "test-worker"}},
                {"key": "session_id", "value": {"stringValue": "abcd1234"}}
              ]
            }]
          }
        }]
      }]
    }]
  }'
```

A successful response is `{}` (empty JSON object).

### Verify in FABRIC

Start FABRIC with OTLP enabled and check that the test metric appears:

```bash
fabric tail --otlp-http :4318 --json
```

## Architecture Diagram

```
NEEDLE Worker
├── TelemetryEvent → FileSink → ~/.needle/logs/ → FABRIC tailer
└── TelemetryEvent → OtlpMetricSink → HTTP POST :4318/v1/metrics → FABRIC
                                                                      ↓
                                                              Normalizer
                                                              Deduplicator
                                                              EventStore
                                                              MetricAccumulator
                                                              → fabric.db (SQLite)
```
