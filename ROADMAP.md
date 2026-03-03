# FABRIC Implementation Roadmap

## Overview

This roadmap outlines the implementation plan for FABRIC (Flow Analysis & Bead Reporting Interface Console). Features are organized into phases with clear priorities.

## Current Status

**Completed:**
- Phase 1: Core Infrastructure
  - types.ts - Core type definitions
  - parser.ts - Log line parsing
  - store.ts - In-memory event store
  - tailer.ts - Log file tailing
  - cli.ts - Command-line interface
  - index.ts - Main exports
  - Basic test coverage

- Phase 2: TUI Implementation ✅ COMPLETE
  - P0: Setup blessed TUI framework
  - P1: Worker Grid Panel
  - P1: Activity Stream Panel
  - P2: Worker Detail View
  - P2: Keyboard Navigation
  - P3: Stuck Detection (src/tui/utils/stuckDetection.ts)
  - P3: Inline Diff View (src/tui/components/DiffView.ts)
  - P4: Command Palette
  - P4: Cost Tracking (src/tui/utils/costTracking.ts)

**In Progress:**
- Phase 3: Web Dashboard

## Phase 2: TUI Implementation

### Priority Order

| Priority | Feature | Description | Effort |
|----------|---------|-------------|--------|
| P0 | **Setup blessed** | Add blessed library for TUI framework | Low |
| P1 | **Worker Grid Panel** | Display all active workers with status | Medium |
| P1 | **Activity Stream Panel** | Scrolling log output with filtering | Medium |
| P2 | **Worker Detail View** | Detailed view for single worker | Medium |
| P2 | **Keyboard Navigation** | j/k scroll, / search, Tab switch, q quit | Low |
| P3 | **Stuck Detection** | Detect workers spinning their wheels | Medium |
| P3 | **Inline Diff View** | Show diffs in Edit tool calls | Medium |
| P4 | **Command Palette** | Ctrl+K universal search | Medium |
| P4 | **Cost Tracking** | Token usage and budget alerts | Medium |

### Implementation Approach

1. Use [blessed](https://github.com/chjj2000/blessed) for terminal UI
2. Create modular components in `src/tui/` directory
3. Each feature gets its own file
4. Shared state management via store

### TUI Architecture

```
src/
├── tui/
│   ├── index.ts          # TUI entry point
│   ├── app.ts            # Main application class
│   ├── components/
│   │   ├── WorkerGrid.ts     # Worker status grid
│   │   ├── ActivityStream.ts # Log stream panel
│   │   ├── WorkerDetail.ts  # Worker detail view
│   │   ├── CommandPalette.ts # Ctrl+K search
│   │   └── DiffView.ts      # Inline diff display
│   ├── screens/
│   │   ├── MainScreen.ts    # Main dashboard view
│   │   └── DetailScreen.ts  # Worker detail screen
│   └── utils/
│       ├── colors.ts        # Color scheme
│       └── keyboard.ts      # Key bindings
└── ...
```

## Phase 3: Web Dashboard

After Phase 2 is complete:

| Priority | Feature | Description |
|----------|---------|-------------|
| P1 | **HTTP Server** | Express/Fastify server |
| P1 | **WebSocket** | Real-time updates |
| P1 | **React Frontend** | Browser UI components |
| P2 | **Timeline Viz** | Worker activity timeline |

## Intelligence Features (Phase 4+)

These can be added incrementally after core UI is working:

- Cross-Reference Hyperlinking
- Worker Collision Detection
- Session Replay
- Smart Error Grouping
- Task Dependency DAG
- File Heatmap
- Recovery Playbook

## Quick Start for Workers

1. Start with P0: Setup blessed
2. Then P1: Worker Grid Panel
3. Then P1: Activity Stream Panel
4. Continue through priority order

## Testing Strategy

- Unit tests for each component
- Integration tests for TUI workflows
- Visual testing with sample log files
