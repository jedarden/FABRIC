# FABRIC Implementation Plan

**Flow Analysis & Bead Reporting Interface Console**

## Overview

FABRIC is a live display for NEEDLE worker activity. It parses NEEDLE's logging output and renders it in real-time as either a TUI (terminal) or web dashboard.

## Goals

1. **Live Display**: Real-time visualization of NEEDLE worker activity
2. **Dual Interface**: TUI for terminal users, web app for browser users
3. **Stateless**: Reads and displays - no storage or persistence

## Data Flow

```
NEEDLE Workers → ~/.needle/logs/ → FABRIC → Live TUI or Web Dashboard
```

FABRIC continuously tails NEEDLE's output and updates the display in real-time.

## Input: NEEDLE Log Format

FABRIC expects structured JSON log lines from NEEDLE:

```json
{"ts":1709337600,"worker":"w-abc123","level":"info","msg":"Starting task","task":"bd-xyz"}
{"ts":1709337601,"worker":"w-abc123","level":"debug","msg":"Tool call","tool":"Read","path":"/src/main.ts"}
{"ts":1709337605,"worker":"w-abc123","level":"info","msg":"Task complete","duration_ms":5000}
```

### Parsed Structure
```typescript
interface LogEvent {
  ts: number;
  worker: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  [key: string]: any;  // Additional fields
}
```

## Default Source

FABRIC reads from `~/.needle/logs/` by default. NEEDLE's folder structure:

```
~/.needle/
├── config.yaml    # NEEDLE configuration
├── logs/          # Worker log output (FABRIC reads this)
├── state/         # Runtime state
├── cache/         # Cached data
└── README.md
```

## Output: Live Displays

### TUI Mode (`fabric tui`)

Live terminal dashboard that continuously updates:

- **Worker Grid**: Real-time status of all active workers
- **Log Stream**: Scrolling log output as events arrive
- **Detail Panel**: Focus on a specific worker's activity

Features:
- Auto-updates as new log events arrive
- Filter by worker, log level, or search term
- Keyboard navigation (j/k scroll, / search, Tab switch panels, q quit)
- Color-coded log levels

### Web Mode (`fabric web`)

Live browser dashboard served on localhost:

- **Worker Overview**: Cards showing each worker's current state
- **Activity Feed**: Real-time log stream
- **Timeline**: Visual representation of worker activity

Features:
- WebSocket-powered real-time updates
- Filter and search controls
- Responsive layout
- Auto-reconnect on connection loss

## CLI Interface

```bash
# TUI - live terminal dashboard
fabric tui                              # Read from ~/.needle/logs/
fabric tui --source /path/to/logs/      # Read from specific path
fabric tui --worker w-abc123            # Filter to one worker

# Web - live browser dashboard
fabric web                              # Serve on http://localhost:3000
fabric web --port 8080                  # Custom port
fabric web --source /path/to/logs/      # Read from specific path

# Simple log streaming (parsed + formatted, also live)
fabric logs                             # Stream parsed logs to stdout
fabric logs --level error               # Filter by level
fabric logs --worker w-abc123           # Filter by worker
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         FABRIC                              │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐    ┌─────────┐    ┌───────────────────────┐  │
│  │   Log    │───▶│ Parser  │───▶│   Display Renderer    │  │
│  │  Tailer  │    │         │    │   (TUI or Web)        │  │
│  └──────────┘    └─────────┘    └───────────────────────┘  │
│       │                                    │                │
│   ~/.needle/logs/                    Terminal or           │
│   (tail -f style)                    localhost:3000        │
└─────────────────────────────────────────────────────────────┘
```

### Components

1. **Log Tailer**: Continuously read new lines from log files (like `tail -f`)
2. **Parser**: Parse JSON log lines into structured events
3. **Display Renderer**: Update TUI or push to WebSocket clients

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Log tailer that watches `~/.needle/logs/`
- [ ] JSON line parser
- [ ] Event emitter for parsed events

### Phase 2: TUI Display
- [ ] Worker list panel
- [ ] Live log stream panel
- [ ] Worker detail panel
- [ ] Keyboard controls and filtering

### Phase 3: Web Display
- [ ] HTTP server with WebSocket support
- [ ] Real-time event streaming to browser
- [ ] React/Svelte dashboard UI
- [ ] Worker cards and activity feed

## Technology Options

### Log Tailer
- Node.js `fs.watch` + readline
- Go `fsnotify` + bufio
- `tail` module (Node.js)

### TUI
- **blessed** (Node.js) - Full-featured terminal UI
- **ink** (Node.js) - React for CLIs
- **bubbletea** (Go) - Elegant TUI framework

### Web
- **Express + ws** (Node.js) - Simple HTTP + WebSocket
- **Fastify** (Node.js) - Fast HTTP server
- **Fiber** (Go) - Express-style for Go
- **React/Svelte** - Frontend framework

## Example Usage

```bash
# Start TUI dashboard
fabric tui

# Start web dashboard
fabric web
# Then open http://localhost:3000 in browser

# Stream logs to terminal (simple mode)
fabric logs --follow
```

## Non-Goals

- ❌ Static report generation
- ❌ Storing metrics or historical data
- ❌ Database or persistence layer
- ❌ Alerting system

FABRIC is a live display. It shows what NEEDLE is doing right now.

---

**Status**: Planning phase
**Last Updated**: 2026-03-02
