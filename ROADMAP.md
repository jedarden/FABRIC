# FABRIC Implementation Roadmap

## Overview

This roadmap outlines the implementation plan for FABRIC (Flow Analysis & Bead Reporting Interface Console). Features are organized into phases with clear priorities.

## Current Status (Updated: 2026-03-05)

| Metric | Count |
|--------|-------|
| **Open beads** | 17 |
| **Closed beads** | 165 |
| **Completion** | ~91% (Phase 5 in progress) |

### Completion by Priority
| Priority | Open | Description |
|----------|------|-------------|
| P0 | 1 | TUI color verification |
| P1 | 15 | Frankentui migration tasks |
| P2 | 1 | Epic tracking |

**Completed:**
- Phase 1: Core Infrastructure ✅ COMPLETE
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

- Phase 3: Web Dashboard ✅ COMPLETE (2026-03-03)
  - P1: Express HTTP server with static file serving (src/web/server.ts)
  - P1: WebSocket server for real-time updates
  - P1: React frontend scaffold with Vite (src/web/frontend/)
  - P1: WorkerGrid component for web
  - P1: ActivityStream component for web
  - P1: Web command added to CLI
  - Dark theme styling

- Phase 3.5: Intelligence Features ✅ COMPLETE
  - ✅ DependencyDag TUI component
  - ✅ GitIntegration TUI panel
  - ✅ SessionDigest TUI component
  - ✅ CollisionAlert integration
  - ✅ Semantic narrative summarization
  - ✅ Conversation parsing
  - ✅ Git status and diff parsing

**In Progress:**
- Phase 5: Frankentui Migration (Rust Rewrite) 🔄 IN PROGRESS
  - Epic: bd-2gy - Migrate FABRIC TUI from blessed.js to frankentui
  - P0: bd-2b3 - Verify TUI renders colors correctly in tmux session
  - P1: bd-3a1 - Set up Rust workspace for fabric-tui crate
  - P1: bd-1h9 - Define FABRIC data types in Rust
  - P1: bd-21r - Implement log parser in Rust (NEEDLE JSON format)
  - P1: bd-2dr - Create WorkerGrid widget using frankentui
  - P1: bd-2kq - Create ActivityStream widget using frankentui
  - P1: bd-3p3 - Create WorkerDetail panel using frankentui
  - P1: bd-1q7 - Implement keyboard navigation
  - P1: bd-2xf - Add file tailing with async log ingestion
  - P1: bd-2zy - Build and package fabric-tui binary
  - E2E Tests: bd-129, bd-1j9, bd-29t, bd-2wk, bd-2x9, bd-v4r, bd-3rf

**Remaining (Untracked):**
- Phase 4+ Intelligence Features are nice-to-have and not tracked as beads

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

## Phase 3: Web Dashboard ✅ COMPLETE

| Priority | Feature | Description | Status |
|----------|---------|-------------|--------|
| P1 | **HTTP Server** | Express server with static file serving | ✅ Done |
| P1 | **WebSocket** | Real-time updates via ws | ✅ Done |
| P1 | **React Frontend** | Browser UI with Vite build | ✅ Done |
| P1 | **Worker Grid** | Worker cards with status | ✅ Done |
| P1 | **Activity Stream** | Real-time event feed | ✅ Done |
| P1 | **CLI Web Command** | `fabric web` starts server | ✅ Done |

**Implementation Files:**
- `src/web/server.ts` - Express + WebSocket server
- `src/web/frontend/src/App.tsx` - Main React app with WebSocket
- `src/web/frontend/src/components/WorkerGrid.tsx` - Worker cards
- `src/web/frontend/src/components/ActivityStream.tsx` - Event stream
- `src/web/frontend/src/index.css` - Dark theme styling
- `vite.config.ts` - Build configuration

## Phase 3.5: Web Frontend Parity ✅ COMPLETE

| Priority | Feature | Description | Bead | Status |
|----------|---------|-------------|------|--------|
| P2 | Parser Tests | Unit tests for parser.ts | bd-1a2 | ✅ Closed |
| P2 | Store Tests | Unit tests for store.ts | bd-2en | ✅ Closed |
| P2 | Worker Overview Cards | Enhanced worker cards component | bd-31n | ✅ Closed |
| P2 | Activity Feed Filtering | Filter activity feed by worker/type | bd-1wo | ✅ Closed |

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
