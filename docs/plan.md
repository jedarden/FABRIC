# FABRIC Implementation Plan

**Flow Analysis & Bead Reporting Interface Console**

## Overview

FABRIC parses NEEDLE worker output and renders it as TUI or HTML visualizations. No storage layer - it reads logs directly and renders on demand.

## Goals

1. **Parse**: Read and understand NEEDLE's logging/telemetry output format
2. **Render TUI**: Terminal dashboard for real-time monitoring
3. **Render HTML**: Browser-viewable reports for review and sharing

## Data Flow

```
NEEDLE Workers → stdout/log files → FABRIC Parser → TUI or HTML Renderer
```

FABRIC is stateless - it reads, parses, and renders. That's it.

## Input: NEEDLE Output Format

FABRIC expects structured log lines from NEEDLE workers:

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

## Output: Visualizations

### TUI Mode (`fabric tui`)

Terminal dashboard showing:
- **Worker List**: Active workers with current status
- **Log Stream**: Live scrolling log output
- **Detail View**: Focus on single worker's activity

Features:
- Filter by worker, log level, or search term
- Keyboard navigation (j/k scroll, / search, q quit)
- Color-coded log levels

### HTML Mode (`fabric html`)

Static HTML file containing:
- **Timeline**: Visual representation of worker activity over time
- **Log Viewer**: Formatted, syntax-highlighted logs
- **Summary**: Worker count, error count, duration

Features:
- Self-contained (embedded CSS/JS, no external dependencies)
- Works offline
- Shareable as single file

## CLI Interface

```bash
# TUI - live terminal dashboard
fabric tui                              # Read from ~/.needle/logs/
fabric tui --source /path/to/logs/      # Read from specific path
fabric tui --worker w-abc123            # Filter to one worker

# HTML - generate static report
fabric html                             # Output to stdout
fabric html --output report.html        # Output to file
fabric html --source ~/.needle/logs/    # Explicit source path

# Simple log viewing (parsed + formatted)
fabric logs                             # Pretty-print parsed logs
fabric logs --level error               # Filter by level
fabric logs --worker w-abc123           # Filter by worker
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

The exact log file format within `logs/` will be determined by NEEDLE's output behavior.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                      FABRIC                         │
├─────────────────────────────────────────────────────┤
│  ┌─────────┐    ┌─────────┐    ┌─────────────────┐ │
│  │  Input  │───▶│ Parser  │───▶│    Renderer     │ │
│  │ Reader  │    │         │    │  (TUI or HTML)  │ │
│  └─────────┘    └─────────┘    └─────────────────┘ │
│       │                               │            │
│   stdin or                        stdout or        │
│   log files                       HTML file        │
└─────────────────────────────────────────────────────┘
```

### Components

1. **Input Reader**: Read from stdin, file, or directory of log files
2. **Parser**: Parse JSON log lines into structured events
3. **Renderer**: Output as TUI dashboard or HTML document

## Implementation Phases

### Phase 1: Core Parser
- [ ] Parse NEEDLE JSON log format
- [ ] Handle malformed lines gracefully
- [ ] Group events by worker

### Phase 2: TUI Renderer
- [ ] Basic worker list display
- [ ] Log streaming view
- [ ] Filtering and search
- [ ] Keyboard controls

### Phase 3: HTML Renderer
- [ ] Generate self-contained HTML
- [ ] Timeline visualization
- [ ] Formatted log display
- [ ] Summary statistics (computed on render, not stored)

## Technology Options

### Parser
- Node.js with streaming JSON line parser
- Go with bufio scanner

### TUI
- **blessed** (Node.js) - Full-featured terminal UI
- **ink** (Node.js) - React for CLIs
- **bubbletea** (Go) - Elegant TUI framework

### HTML
- Template literals or simple templating
- Inline CSS/JS for self-contained output
- SVG for timeline visualization

## Example Usage

```bash
# Run from workspace with .needle/ folder
cd /path/to/workspace
fabric tui

# Pipe NEEDLE output directly
needle run task.md | fabric tui

# Generate HTML report from .needle/ artifacts
fabric html --output report.html

# Quick log review
fabric logs --level error

# Review specific worker
fabric logs --worker w-abc123
```

## Non-Goals

- ❌ Storing metrics or historical data
- ❌ Database or persistence layer
- ❌ Real-time alerting
- ❌ Multi-instance aggregation
- ❌ Web server (HTML is static file output)

FABRIC is a parser and renderer. NEEDLE handles orchestration and logging; FABRIC makes that output human-readable.

---

**Status**: Planning phase
**Last Updated**: 2026-03-02
