# FABRIC Gap Analysis

**Generated:** 2026-03-07
**Original Bead:** bd-muv

This document compares the FABRIC implementation against docs/plan.md to identify missing features.

## Implementation Status Summary

### Phase 1: Core Infrastructure ✅ COMPLETE
| Feature | File | Status |
|---------|------|--------|
| Log Tailer | src/tailer.ts | ✅ |
| JSON Parser | src/parser.ts | ✅ |
| Event Store | src/store.ts | ✅ |
| Type Definitions | src/types.ts | ✅ |

### Phase 2: TUI Display ✅ COMPLETE
| Feature | File | Status |
|---------|------|--------|
| Worker Grid | src/tui/components/WorkerGrid.ts | ✅ |
| Activity Stream | src/tui/components/ActivityStream.ts | ✅ |
| Worker Detail | src/tui/components/WorkerDetail.ts | ✅ |
| Command Palette | src/tui/components/CommandPalette.ts | ✅ |
| Keyboard Navigation | src/tui/utils/keyboard.ts | ✅ |
| Focus Mode | src/tui/app.ts | ✅ |

### Phase 3: Web Display ✅ COMPLETE
| Feature | File | Status |
|---------|------|--------|
| HTTP Server | src/web/server.ts | ✅ |
| WebSocket Streaming | src/web/server.ts | ✅ |
| React Frontend | src/web/frontend/src/App.tsx | ✅ |
| Worker Cards | src/web/frontend/src/components/WorkerGrid.tsx | ✅ |
| Activity Feed | src/web/frontend/src/components/ActivityStream.tsx | ✅ |
| Focus Mode | src/web/frontend/src/App.tsx | ✅ |

### Phase 4: Intelligence Features (Core) ✅ COMPLETE
| Feature | File | Status |
|---------|------|--------|
| Cross-Reference Hyperlinking | src/tui/components/CrossReferencePanel.ts | ✅ |
| Inline Diff View | src/tui/components/DiffView.ts | ✅ |
| File Activity Heatmap | src/tui/components/FileHeatmap.ts | ✅ |
| Cost & Token Tracking | src/tui/utils/costTracking.ts | ✅ |
| Conversation Transcript | src/tui/components/ConversationTranscript.ts | ✅ |

### Phase 5: Intelligence Features (Detection) ✅ COMPLETE
| Feature | File | Status |
|---------|------|--------|
| Stuck Detection | src/tui/utils/stuckDetection.ts | ✅ |
| Loop Detection | src/tui/utils/stuckDetection.ts | ✅ |
| Worker Collision Detection | src/tui/components/CollisionAlert.ts | ✅ |
| Smart Error Grouping | src/tui/components/ErrorGroupPanel.ts | ✅ |
| Semantic Narrative | src/tui/components/SemanticNarrativePanel.ts | ✅ |

### Phase 6: Context & Integration ✅ COMPLETE
| Feature | File | Status |
|---------|------|--------|
| Git Integration | src/tui/components/GitIntegration.ts | ✅ |
| Session Digest | src/tui/components/SessionDigest.ts | ✅ |
| Worker Analytics | src/tui/components/WorkerAnalyticsPanel.ts | ✅ |

### Phase 7: Advanced Features ✅ COMPLETE
| Feature | File | Status |
|---------|------|--------|
| Session Replay | src/tui/components/SessionReplay.ts | ✅ |
| Task Dependency DAG | src/tui/components/DependencyDag.ts | ✅ |
| Recovery Playbook | src/tui/components/RecoveryPanel.ts | ✅ |

---

## Identified Gaps

The following features from plan.md are missing or incomplete:

### P1 - Critical

| Bead ID | Feature | Description |
|---------|---------|-------------|
| bd-art | SQLite Historical Analytics | Persistent storage for worker metrics and error history |
| bd-hn5 | Budget Alerts & Projections | Real-time budget alerts at 80%/95% thresholds |
| bd-257 | Web Auto-Reconnect | Robust WebSocket reconnection with exponential backoff |

### P2 - High Priority

| Bead ID | Feature | Description |
|---------|---------|-------------|
| bd-40a | Web Timeline Visualization | Horizontal timeline showing worker activity over time |
| bd-iyz | Anomaly Detection | Detect unexpected file activity patterns |
| bd-1o0 | Command Palette Fuzzy Search | Fuzzy matching with recent commands history |
| bd-3o4 | Git PR Preview | Generate PR title/description preview from commits |
| bd-2u6 | File Context Panel | Split view showing file contents alongside activity |

### P3 - Nice to Have

| Bead ID | Feature | Description |
|---------|---------|-------------|
| bd-2r0 | Focus Mode Presets | Save/load pin configurations |
| bd-2ot | Theme Support | Dark/light theme switching |
| bd-1dq | Export Session Replay | Export replay as shareable link or file |

---

## Cross-Repo Dependencies

None identified. All FABRIC features are self-contained within this workspace.

---

## Dependency Graph

```
bd-muv (Gap Analysis - Original Task)
├── bd-40a (Web Timeline Visualization)
├── bd-hn5 (Budget Alerts & Projections)
├── bd-iyz (Anomaly Detection)
├── bd-257 (Web Auto-Reconnect)
├── bd-2r0 (Focus Mode Presets)
├── bd-1o0 (Command Palette Fuzzy Search)
├── bd-2ot (Theme Support)
├── bd-1dq (Export Session Replay)
├── bd-3o4 (Git PR Preview)
├── bd-art (SQLite Historical Analytics)
└── bd-2u6 (File Context Panel)
```

---

## Recommendations

1. **Priority Order:** Implement P1 items first (SQLite, Budget Alerts, Auto-Reconnect) as they are foundational for other features.

2. **SQLite First:** The SQLite storage (bd-art) is a blocker for:
   - Historical worker analytics comparisons
   - Recovery playbook pattern matching
   - Budget projections over time

3. **Web Parity:** The web frontend is missing several TUI features:
   - Timeline visualization (bd-40a)
   - File context panel (bd-2u6)
   - PR preview (bd-3o4)

4. **User Experience:** Fuzzy search (bd-1o0) and presets (bd-2r0) significantly improve daily usage.

---

## Files Reviewed

- docs/plan.md (1435 lines)
- src/types.ts (core types)
- src/cli.ts (commands)
- src/tui/app.ts (TUI main)
- src/web/server.ts (web backend)
- src/web/frontend/src/App.tsx (web frontend)
- src/tui/utils/stuckDetection.ts
- src/tui/utils/recoveryPlaybook.ts
- src/web/frontend/src/components/RecoveryPanel.tsx

---

## Conclusion

FABRIC is approximately **90% complete** against the plan.md specification. The core architecture and most intelligence features are fully implemented. The main gaps are:

1. **Persistence layer** - SQLite for historical analytics
2. **Alerting system** - Budget alerts and anomaly detection
3. **Web UX polish** - Timeline, auto-reconnect, file context panel
4. **Convenience features** - Presets, themes, fuzzy search

All identified gaps have corresponding beads created and linked to this analysis via dependencies.
