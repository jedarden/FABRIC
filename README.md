# FABRIC

**Flow Analysis & Bead Reporting Interface Console**

A live display for NEEDLE worker activity, available as TUI or web dashboard.

## Purpose

FABRIC tails NEEDLE's logging output and renders it in real-time. It answers:

- What is each worker doing right now?
- What events are happening across all workers?
- Which workers are active, idle, or erroring?
- Is any worker stuck or looping?
- Are workers colliding on the same files?
- How much is this costing?

## Display Modes

### TUI (`fabric tui`)

Live terminal dashboard:
- Worker status grid
- Scrolling log stream
- Worker detail panel
- Keyboard navigation and filtering

### Web (`fabric web`)

Live browser dashboard at `localhost:3000`:
- Worker overview cards
- Real-time activity feed
- Timeline visualization
- WebSocket-powered updates

## Quick Start

```bash
# Terminal dashboard
fabric tui

# Web dashboard
fabric web

# Stream parsed events to stdout
fabric logs

# With OTLP live telemetry
fabric tui --otlp-grpc :4317
```

FABRIC watches `~/.needle/logs/` by default, tailing every `*.jsonl` file in
the directory and hot-adding new worker logs as they appear.

## Intelligence Features

Beyond simple log display, FABRIC provides:

| Feature | Description |
|---------|-------------|
| **Stuck & Loop Detection** | Automatic alerts when workers spin their wheels |
| **Inline Diff View** | See actual code changes, not just "Edit was called" |
| **Cross-Reference Links** | Click any bead, file, or worker to navigate |
| **Collision Detection** | Know when workers edit the same files |
| **Session Replay** | Scrub through past sessions like a video |
| **Smart Error Grouping** | Errors with context, not scattered through logs |
| **Command Palette** | Ctrl+K for universal search and commands |
| **Cost Tracking** | Real-time token usage and budget alerts |
| **Task Dependency DAG** | Visual graph of task relationships |
| **File Heatmap** | See where all the action is at a glance |
| **Conversation Transcript** | See the full Claude conversation, not just tool calls |
| **Semantic Narrative** | Natural language summary of what workers are doing |
| **AI Session Digest** | Auto-generated session summaries for stakeholders |
| **File Context Panel** | See file contents alongside activity stream |
| **Git Integration** | Live git status, diff preview, conflict detection |
| **Worker Analytics** | Compare worker performance over time |
| **Recovery Playbook** | Suggestions based on similar past errors |
| **Focus Mode** | Pin workers/tasks, hide everything else |

## Relationship to NEEDLE

```
NEEDLE (orchestrates workers) → logs → FABRIC (displays + analyzes)
```

NEEDLE does the work. FABRIC shows you what's happening and helps you understand it.

## Wiring NEEDLE → FABRIC

There are two ways to send NEEDLE telemetry to FABRIC: config-based HTTP POST (simpler) or OTLP (lower latency, more features).

### Option 1: Config-based HTTP POST (recommended for local dev)

Set `fabric.enabled: true` in `~/.needle/config.yaml`:

```yaml
fabric:
  enabled: true
  endpoint: http://localhost:3000/api/events
  timeout: 2
  batching: false
  auth_token: your-secret-token   # must match FABRIC_AUTH_TOKEN on the server
```

Start FABRIC web server with an auth token, then start NEEDLE workers — events flow automatically:

```bash
FABRIC_AUTH_TOKEN=your-secret-token fabric web   # starts on http://localhost:3000
needle run ...                                    # workers POST to /api/events with Bearer token
```

#### Authentication

All POST endpoints (`/api/events`, `/api/events/batch`) require a `Bearer` token when the server is started with an auth token:

```bash
# Start with auth token (env var or flag)
FABRIC_AUTH_TOKEN=secret fabric web
fabric web --auth-token secret

# Manual POST (e.g. for testing)
curl -X POST http://localhost:3000/api/events \
  -H 'Authorization: Bearer secret' \
  -H 'Content-Type: application/json' \
  -d '{"ts":"2026-04-23T00:00:00Z","event":"worker.started","worker":"w-test"}'
```

If no auth token is configured, all POST requests are accepted without authentication (suitable for local-only use).

### Option 2: OTLP (recommended for multi-host or production)

NEEDLE ships with an `otlp` feature (enabled by default in `Cargo.toml`) that exports telemetry over the standard OpenTelemetry OTLP protocol. No rebuild or extra flags are needed — just set two environment variables before launching workers:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://fabric-host:4317
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
needle run ...
```

| Variable | Default | Notes |
|----------|---------|-------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | FABRIC's OTLP listener address |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `grpc` | `grpc` (port **4317**) or `http/protobuf` (port **4318**) |

### Starting the FABRIC receiver

FABRIC must be started with an OTLP listener for live telemetry to flow. The `--otlp-grpc` and `--otlp-http` flags enable the receiver:

```bash
# gRPC receiver (recommended — lower latency, NEEDLE default)
fabric tui --otlp-grpc 0.0.0.0:4317

# HTTP receiver (alternative)
fabric web --otlp-http 0.0.0.0:4318

# Both sources merged (JSONL tail + OTLP live)
fabric tui --source ~/.needle/logs/ --otlp-grpc :4317

# Tail with OTLP and event-type filtering
fabric tail --otlp-grpc :4317 --event-type "bead.*"

# Stream logs to stdout with filtering (logs is an alias for tail)
fabric logs --event-type "bead.*"
fabric logs --worker tcb-a --otlp-grpc :4317
```

| Receiver flag | Default port | Protocol |
|---------------|-------------|----------|
| `--otlp-grpc` | `4317` | OTLP/gRPC ( tonic) |
| `--otlp-http` | `4318` | OTLP/HTTP (protobuf + JSON) |

Everything stays on your machine — FABRIC is a local collector, not a third-party service. Telemetry is read-only: FABRIC ingests spans/logs/metrics for display but never writes back to NEEDLE or modifies worker state.

## Production Deployment

FABRIC runs as a user-level systemd service (`fabric-web.service`) with OTLP/HTTP enabled:

```bash
# Service status
systemctl --user status fabric-web.service

# Verify OTLP listener
ss -tlnp | grep 4318
```

| Component | Port | Purpose |
|-----------|------|---------|
| Web dashboard | `:3000` | Browser UI + REST API |
| OTLP/HTTP | `:4318` | NEEDLE metric ingestion |

NEEDLE's `otlp_metric_sink` is enabled in `~/.needle/config.yaml`, pushing aggregated token/cost/bead metrics to `http://localhost:4318/v1/metrics`. FABRIC deduplicates these against JSONL-tailed events and writes them to `~/.needle/fabric.db` with `metrics_source='otlp-metric'`.

🚧 **In Development** - See [docs/plan.md](docs/plan.md) for implementation roadmap.

## Documentation

- [NeedleEvent Schema](docs/schema.md) — canonical wire format shared with NEEDLE
- [Implementation Plan](docs/plan.md)
