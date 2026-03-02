# FABRIC

**Flow Analysis & Bead Reporting Interface Console**

A live display for NEEDLE worker activity, available as TUI or web dashboard.

## Purpose

FABRIC tails NEEDLE's logging output and renders it in real-time. It answers:

- What is each worker doing right now?
- What events are happening across all workers?
- Which workers are active, idle, or erroring?

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

## Relationship to NEEDLE

```
NEEDLE (orchestrates workers) → logs → FABRIC (displays activity)
```

NEEDLE does the work. FABRIC shows you what's happening.

## Status

🚧 **In Development** - See [docs/plan.md](docs/plan.md) for implementation roadmap.

## Documentation

- [Implementation Plan](docs/plan.md)
