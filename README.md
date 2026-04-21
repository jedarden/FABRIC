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
```

FABRIC reads from `~/.needle/logs/` by default.

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
```

| Receiver flag | Default port | Protocol |
|---------------|-------------|----------|
| `--otlp-grpc` | `4317` | OTLP/gRPC ( tonic) |
| `--otlp-http` | `4318` | OTLP/HTTP (protobuf + JSON) |

Everything stays on your machine — FABRIC is a local collector, not a third-party service. Telemetry is read-only: FABRIC ingests spans/logs/metrics for display but never writes back to NEEDLE or modifies worker state.

🚧 **In Development** - See [docs/plan.md](docs/plan.md) for implementation roadmap.

## Documentation

- [Implementation Plan](docs/plan.md)
