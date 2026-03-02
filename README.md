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

## Relationship to NEEDLE

```
NEEDLE (orchestrates workers) → logs → FABRIC (displays + analyzes)
```

NEEDLE does the work. FABRIC shows you what's happening and helps you understand it.

## Status

🚧 **In Development** - See [docs/plan.md](docs/plan.md) for implementation roadmap.

## Documentation

- [Implementation Plan](docs/plan.md)
