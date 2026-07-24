# ex44 NEEDLE OTLP Configuration

## Background

Per ADR-1, ex44's NEEDLE workers must send OTLP telemetry to the centralized FABRIC instance on `lab` instead of the non-existent localhost:3000 endpoint.

## Current State (ex44)

- `~/.needle/config.yaml` has `fabric.enabled: true` with `endpoint: http://localhost:3000/api/events`
- Nothing listens on `ex44:3000` (fabric is not installed on ex44)
- Every event POST from ex44 NEEDLE workers has been silently failing (2s timeout)

## Required Configuration

### Option 1: Config file (recommended)

Edit `~/.needle/config.yaml` on ex44:

```yaml
telemetry:
  otlp_sink:
    enabled: true
    endpoint: http://100.81.129.38:4318
    protocol: http/protobuf
    timeout_secs: 10
    compression: gzip
    tls: none
    headers: []
    resource_attributes: []
    metrics_interval_secs: 10
    service_namespace: needle-fleet

fabric:
  enabled: false  # Disable HTTP POST, use OTLP instead
  # endpoint: http://localhost:3000  # Remove or comment out
  # timeout: 2
  # batching: false
```

### Option 2: Environment variables

Set these environment variables for NEEDLE workers on ex44:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://100.81.129.38:4318
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

Or add to `~/.needle/config.yaml`:

```yaml
telemetry:
  otlp_sink:
    enabled: true
    # endpoint and protocol will use OTEL_* env vars if not set
```

## Verification

After applying the configuration, start a NEEDLE worker on ex44 and verify its events appear in the lab FABRIC dashboard:

```bash
# On ex44:
needle worker start

# On lab (or via browser):
curl http://localhost:3000/api/summary
# Should show ex44 worker activity
```

## Network

- Lab FABRIC OTLP endpoint: `http://100.81.129.38:4318`
- Exposed via Tailscale mesh network
- OTLP/HTTP protocol (protobuf encoding)

## References

- ADR-1: `docs/plan.md` (section "ADR-1: 2026-07-20 — Centralize FABRIC as a Multi-Host OTLP Collector")
- FABRIC README: "Option 2: OTLP (recommended for multi-host or production)"
