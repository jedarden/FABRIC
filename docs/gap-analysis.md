# FABRIC Gap Analysis

**Generated:** 2026-03-07 (original analysis, bead `bd-muv`)
**Last refreshed:** 2026-09-26 (bead `fabric-bd06ee99`)
**Analysis bead lineage:** `bd-muv` → `fabric-0c9aeb03` ("Gap analysis: Compare implementation against plan.md and create beads for missing features", closed) → `fabric-bd06ee99` (this refresh)

This document compares the FABRIC implementation against docs/plan.md to identify missing features.

## Bead identifier migration

This file's original bead identifiers predate the current store. The lineage:

| Era | ID prefix | CLI / tool | State |
|-----|-----------|------------|-------|
| Original (incl. 2026-03-07 analysis) | `bd-*` | `bd` | **Retired** — IDs survive only in historical prose (e.g. plan.md's Phase 8 `bd-0nd` epic) and in the mapping table below |
| Interim | `bf-*` | `bf` (bead-forge) | **Deprecated on this box since 2026-08-14**; survives in plan.md historical prose (`bf-4cqq`, `bf-2wf`, `bf-4grhf`, `bf-18ib2`) |
| Current (since 2026-08-14) | `fabric-*` | `bead` (bead-rs) | **Canonical** — the codinghome workspace guide names bead-rs's `bead` CLI as the canonical bead CLI; FABRIC's `.beads/config.json` declares prefix `fabric` |

All live tracking uses `fabric-*` IDs. Legacy `bd-*`/`bf-*` references elsewhere in the
docs are historical record and are left as written; every legacy reference in *this*
file is mapped explicitly below.

## Implementation Status Summary

### Phase 1: Core Infrastructure ✅ COMPLETE
| Feature | File | Status |
|---------|------|--------|
| Log Tailer (single file) | src/tailer.ts | ✅ |
| Directory Tailer (canonical source for `~/.needle/logs/`, hot-add) | src/directoryTailer.ts | ✅ (Phase 8 fix) |
| JSON Parser | src/parser.ts | ✅ |
| Event Store (in-memory + SQLite event persistence) | src/store.ts | ✅ |
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
| Fleet Summary Bar (Phase 9) | src/web/frontend/src/components/FleetSummaryBar.tsx | ✅ |
| Focus Mode | src/web/frontend/src/App.tsx | ✅ |

### Phase 4: Intelligence Features (Core) ✅ COMPLETE
| Feature | File | Status |
|---------|------|--------|
| Cross-Reference Hyperlinking | src/crossReferenceManager.ts, src/tui/components/CrossReferencePanel.ts | ✅ |
| Inline Diff View | src/tui/components/DiffView.ts | ✅ |
| File Activity Heatmap | src/fileHeatmap.ts, src/tui/components/FileHeatmap.ts | ✅ |
| Cost & Token Tracking | src/tui/utils/costTracking.ts, web CostDashboard.tsx | ✅ |
| Conversation Transcript | src/conversationParser.ts, src/tui/components/ConversationTranscript.ts | ✅ |

### Phase 5: Intelligence Features (Detection) ✅ COMPLETE
| Feature | File | Status |
|---------|------|--------|
| Stuck Detection | src/tui/utils/stuckDetection.ts | ✅ |
| Loop Detection | src/tui/utils/stuckDetection.ts | ✅ |
| Worker Collision Detection | src/tui/components/CollisionAlert.ts | ✅ |
| Smart Error Grouping | src/errorGrouping.ts, src/tui/components/ErrorGroupPanel.ts | ✅ |
| Semantic Narrative | src/semanticNarrative.ts, src/tui/components/SemanticNarrativePanel.ts | ✅ |

### Phase 6: Context & Integration ✅ COMPLETE
| Feature | File | Status |
|---------|------|--------|
| Git Integration | src/gitParser.ts, src/tui/components/GitIntegration.ts, web GitIntegrationPanel.tsx | ✅ |
| Session Digest (deterministic) | src/sessionDigest.ts, src/tui/components/SessionDigest.ts, web SessionDigestPanel.tsx | ✅ |
| Session Digest (AI layer, `--ai`) | src/digestAi.ts | ✅ (2026-09-16; tracking beads open — see Current Gaps) |
| Worker Analytics | src/analytics.ts, src/workerAnalytics.ts, TUI + web WorkerAnalyticsPanel | ✅ (plan.md: via `bf-4cqq`) |
| Historical Session Index | src/historicalStore.ts, web HistoricalSessionsPanel.tsx | ✅ |

### Phase 7: Advanced Features ✅ COMPLETE
| Feature | File | Status |
|---------|------|--------|
| Session Replay | src/tui/components/SessionReplay.ts, web SessionReplay.tsx | ✅ |
| Task Dependency DAG | src/dagUtils.ts, src/tui/components/DependencyDag.ts, web DependencyDag.tsx + SpanDag.tsx | ✅ |
| Budget Alerts & Projections | src/tui/components/BudgetAlertPanel.ts, web BudgetAlertPanel.tsx | ✅ (was a 2026-03-07 gap) |
| Anomaly Detection | src/tui/utils/fileAnomalyDetection.ts | ✅ (was a 2026-03-07 gap) |
| Recovery Playbook | src/tui/utils/recoveryPlaybook.ts, TUI + web RecoveryPanel | ✅ |

### Phase 9: Productivity Analytics ✅ COMPLETE (verified 2026-05-22, `bf-2wf`)
Fleet summary bar, worker-card `beadsCompleted`/`currentBead`, worker sort order,
test-worker filter, productivity panel (daily throughput + leaderboard), bead
workspace scanner (src/beadWorkspaceScanner.ts), `/api/productivity`.

### Post-plan subsystems (not in the 2026-03-07 analysis)
| Subsystem | Files | Status |
|-----------|-------|--------|
| OTLP ingestion (HTTP :4318 + gRPC) | src/otlpHttpReceiver.ts, src/otlpGrpcReceiver.ts | ✅ |
| Multi-host metrics & host labels | src/hostname.ts, src/serverMetrics.ts, src/normalizer.ts | ✅ (ADR-1) |
| Log retention / pruning | src/logPruner.ts, src/retentionControls.ts | ✅ |
| Memory profiling & heap analysis | src/memoryProfiler.ts, src/memorySampler.ts, src/heapDiff.ts, src/systemCgroupMonitor.ts | ✅ |
| Native event API (`/v1/*`, auth token matrix) | src/web/server.ts, docs/events-api.md, docs/api-auth.md | ✅ |

---

## 2026-03-07 Gaps — ALL RESOLVED

Every gap identified on 2026-03-07 is now implemented. Each legacy `bd-*` ID was
re-created in the `fabric-*` store during the 2026-08-14 bead-rs migration and has
since closed. Verification (2026-09-26) confirmed the landing files below exist on
`main`.

| Legacy ID | Successor bead(s) | Feature | Where it landed | Status |
|-----------|-------------------|---------|-----------------|--------|
| `bd-muv` | `fabric-0c9aeb03` | Gap analysis itself | this document | ✅ closed |
| `bd-art` | `fabric-c5a673e0` | SQLite Historical Analytics | src/historicalStore.ts (better-sqlite3); event persistence in src/store.ts; web HistoricalSessionsPanel.tsx | ✅ closed |
| `bd-hn5` | `fabric-b7d48375`, `fabric-26884492` | Budget Alerts & Projections | src/tui/components/BudgetAlertPanel.ts + web BudgetAlertPanel.tsx (80%/95% thresholds) | ✅ closed |
| `bd-257` | `fabric-a03e0e0a` | Web Auto-Reconnect | src/web/frontend/src/App.tsx — `useWebSocket` hook with exponential backoff and reconnect state | ✅ closed |
| `bd-40a` | `fabric-3ee9ed6c`, `fabric-100ac8ee`, `fabric-dc6db45d` | Web Timeline Visualization | src/web/frontend/src/components/TimelineView.tsx | ✅ closed |
| `bd-iyz` | `fabric-a5f1bf31` | Anomaly Detection | src/tui/utils/fileAnomalyDetection.ts | ✅ closed |
| `bd-1o0` | `fabric-363450d4`, fix `fabric-65e0687b` | Command Palette Fuzzy Search | src/tui/utils/fuzzyMatch.ts (TUI + web palettes) | ✅ closed |
| `bd-3o4` | `fabric-9dfccce7` | Git PR Preview | src/tui/utils/prPreview.ts (GitIntegration panel) | ✅ closed |
| `bd-2u6` | `fabric-d914af11`, content fix `fabric-5978a730` | File Context Panel | src/tui/components/FileContextPanel.ts + web FileContextPanel.tsx (real file content, split view) | ✅ closed |
| `bd-1dq` | `fabric-137114f0`, `fabric-3066f577`, `fabric-b283a861` | Export Session Replay | src/tui/components/SessionReplay.ts — Markdown export (`:679`) and JSON export (`:786`) | ✅ closed |
| `bd-2r0` | `fabric-9ee4e460`, `fabric-7a8aa0c9`, `fabric-520c6f11` | Focus Mode Presets | Shared core src/focusPresetCore.ts; TUI save/cycle/apply via `[`/`]` + command palette (src/tui/app.ts); web dropdown in src/web/frontend/src/App.tsx; CLI `fabric config presets` (src/config.ts); storage in the fabric config dir (`~/.fabric/focus-presets.json`) for TUI/CLI and localStorage for web | ✅ closed |
| `bd-2ot` | `fabric-abdf7fa7`, `fabric-b48bab10` | Theme Support | Shared store src/themeStore.ts persisting to `~/.fabric/theme.json`; TUI Ctrl+T + command palette (src/tui/app.ts, src/tui/utils/theme.ts); web toggle in src/web/frontend/src/App.tsx (ThemeContext) against `GET/POST /api/theme` (src/web/server.ts) with WebSocket push; CLI `fabric config theme` (src/config.ts) | ✅ closed |

The two successors that carry their legacy ID in the title (`fabric-7a8aa0c9`,
`fabric-b48bab10`) confirm the mapping is faithful.

---

## Current Gaps (2026-09-26)

plan.md marks Phases 1–9 complete. The open frontier is **~100 open beads**, dominated
by verification/coverage hardening rather than missing features. Grouped:

### 1. Feature gaps — single-file source assumptions (P2)

The Phase 8 bug class ("append `/workers.log` to any directory path") has recurred
twice in newer commands:

| Bead | Feature | Description |
|------|---------|-------------|
| `fabric-32fe329b` (+ ~15 children, incl. `fabric-1913db1c`, `fabric-01a5f18a`) | `fabric digest --source` | digest is hardcoded to a single-file `workers.log`-style source; needs directory support routed through the shared resolver (src/pathResolver.ts), plus tests |
| `fabric-931136a0` (+ `fabric-0386d35e`, `fabric-de6275b2`, `fabric-6d914c4c`) | `fabric tui --source` busy-loop | directory source busy-loops a CPU core instead of event/interval-driven watching; diagnosis + fix + regression coverage split across children |

### 2. Implemented in code, tracking beads still open (P3)

| Bead | Feature | Note |
|------|---------|------|
| `fabric-e91edf0c`, owner `fabric-f511a390` (+ Unravel children) | Digest AI narrative | src/digestAi.ts landed 2026-09-16 (plan.md §AI Session Digest); beads remain open for verification/ownership closure |
| `fabric-92a4b7cb` | TUI heartbeat liveness indicator | collapse heartbeat events per worker |
| `fabric-de6a9f72` | TUI `r`/`R` shortcut conflict | resolved — b1e8567 deconflicted the bindings (`r` re-renders, `R` alone toggles replay, DAG force-refresh moved to `C-r`); a707ec86 pinned the help-overlay text |

### 3. Verification & coverage hardening (largest cluster, ~70 beads)

Contract/coverage work pinning documented behavior in tests — each bead small, the
aggregate large:

- **Coverage baseline artifacts** (`fabric-e166b9dd`, `fabric-fe89fbe4`, `fabric-f04ff738` + ~20 children): establish and document `artifacts/coverage-baseline/`.
- **Memory / heap-snapshot contracts** (`fabric-c05c7990`, `fabric-d7bd9360`, `fabric-6734f908`, `fabric-b764daff`, `fabric-02fbe1ee`, `fabric-b8b13850`): retention, diff analysis, API endpoints, trigger/cooldown pins.
- **Metrics & OTLP host-label contracts** (`fabric-0b557baa`, `fabric-96975906`, `fabric-86bfc356` + 3 siblings): `/api/metrics` types/help text, per-host separation, label escaping.
- **CLI operational-option contracts** (`fabric-13164cdc`, `fabric-7666ce28`, `fabric-83cc1dea`, `fabric-c7fab6aa`, `fabric-2c20fd74`, `fabric-13c185d9`): `--max-events` liveness, `--heap-snapshots`/`--snapshot-interval` propagation, help-overlay keys.
- **Retention-prune audit** (`fabric-0a4e421b`): tests vs documented count/age/size rules.
- **Ingest-schema validation via synthetic logs** (`fabric-8abad6e9`, `fabric-f88573e2` + trace/catalog children): derive required-field lists from src/normalizer.ts and src/store.ts.
- **Smoke & release gate** (`fabric-f05a227a`, `fabric-b7b48295`, owner `fabric-2fd06cd1`): authenticated web/OTLP smoke coverage; clean-install smoke workflow — script (`scripts/smoke-clean-install.sh`), README promise section, and the 16-test alignment gate (`src/smoke-clean-install.test.ts`, keeping README ↔ package.json ↔ smoke script ↔ `--help` consistent) all landed 2026-09-26.
- **TUI shortcut documentation** (`fabric-6361cc78`, `fabric-5a449ea7`, `fabric-a90a6ab0`, `fabric-06fb6dc0`, `fabric-3e4e93b3`).

### 4. Operational noise (P4)

- `fabric-3b8cdb99`, `fabric-6fba739d` — `[Pulse]` ENOENT when tests delete aged heap snapshots; symptom of the heap-snapshot test cluster above.

### Known future work recorded in plan.md (no bead)

- Wiring the `>digest` command-palette trigger and the periodic/session-end triggers to the AI digest layer (they stay deterministic by design today; plan.md §AI Session Digest).

---

## Cross-Repo Dependencies

None identified. All FABRIC features are self-contained within this workspace.
(ADR-1 made FABRIC the fleet's OTLP *collector*, but that is a deployment
relationship with NEEDLE hosts, not a code dependency.)

## Dependency Graph

```
bd-muv / fabric-0c9aeb03 (2026-03-07 Gap Analysis) — CLOSED, all children resolved
├── fabric-c5a673e0 (SQLite Historical Analytics) ✅   [bd-art]
├── fabric-b7d48375 + fabric-26884492 (Budget Alerts) ✅   [bd-hn5]
├── fabric-a03e0e0a (Web Auto-Reconnect) ✅   [bd-257]
├── fabric-3ee9ed6c (Web Timeline) ✅   [bd-40a]
├── fabric-a5f1bf31 (Anomaly Detection) ✅   [bd-iyz]
├── fabric-363450d4 (Fuzzy Search) ✅   [bd-1o0]
├── fabric-9dfccce7 (Git PR Preview) ✅   [bd-3o4]
├── fabric-d914af11 (File Context Panel) ✅   [bd-2u6]
├── fabric-137114f0 (Export Replay) ✅   [bd-1dq]
├── fabric-9ee4e460 (Focus Presets) ✅   [bd-2r0]
└── fabric-abdf7fa7 (Theme Support) ✅   [bd-2ot]

fabric-bd06ee99 (2026-09-26 refresh — this document)
├── fabric-32fe329b (digest --source directory support) — open
├── fabric-931136a0 (tui --source busy-loop) — open
├── fabric-e91edf0c / fabric-f511a390 (digest AI closure) — open
├── fabric-92a4b7cb (heartbeat liveness) — open
├── fabric-de6a9f72 (r/R shortcut conflict) — resolved (b1e8567, a707ec86)
└── verification & coverage hardening cluster (~70 beads) — open
```

---

## Recommendations

1. **Fix the single-file bug class once.** `fabric digest --source` (`fabric-32fe329b`)
   and the `fabric tui --source` busy-loop (`fabric-931136a0`) are the same disease the
   Phase 8 fix (plan.md `bd-0nd` epic) cured for `fabric tui`: hand-rolled source
   resolution. Route both through the shared resolver (src/pathResolver.ts /
   `resolveSource`) — `fabric-1913db1c` already scopes this for digest — and add
   regression tests so the third recurrence is prevented, not just treated.

2. **Batch the hardening cluster by subsystem.** The ~70 verification beads are
   individually trivial but churn-prone; work them per subsystem (metrics, memory,
   CLI options, ingest schema) so shared test helpers land once. Watch the
   escalation-counter behavior on re-dispatched beads (see the `[Unravel]` beads:
   infra failures and declined splits are not content failures).

3. **Close the digest-AI tracking gap.** Code landed 2026-09-16; `fabric-e91edf0c`
   and its owner `fabric-f511a390` should close on the existing implementation plus
   the documented fallback contract (docs + src/digestAi.ts), rather than inviting
   reimplementation.

4. **TUI polish is cheap:** heartbeat liveness (`fabric-92a4b7cb`) and the `r`/`R`
   conflict (`fabric-de6a9f72`) are user-visible and small; schedule them ahead of
   the bulk hardening cluster.

5. **Keep this document honest about eras.** New beads get `fabric-*` IDs via
   `bead` (bead-rs). Legacy `bd-*`/`bf-*` IDs in prose are history — map them, don't
   revive them.

---

## Files Reviewed (2026-09-26 refresh)

- docs/plan.md (1738 lines; Phases 1–9 complete, ADR-1 multi-host collector)
- src/types.ts, src/cli.ts, src/store.ts, src/historicalStore.ts
- src/tailer.ts, src/directoryTailer.ts (source-resolution layer)
- src/tui/app.ts and src/tui/components/ (all 21 components present)
- src/tui/utils/ (costTracking, stuckDetection, fileAnomalyDetection, fuzzyMatch, prPreview, recoveryPlaybook, theme)
- src/web/server.ts, src/web/frontend/src/App.tsx, src/web/frontend/src/components/ (31 components incl. TimelineView, FileContextPanel, BudgetAlertPanel, FleetSummaryBar, HistoricalSessionsPanel)
- src/digestAi.ts, src/sessionDigest.ts
- Bead store: `bead list --json` — 418 beads, 100 open/in_progress as of 2026-09-26
- .beads/config.json (prefix `fabric`, created 2026-08-14)

---

## Conclusion

FABRIC is **feature-complete against plan.md Phases 1–9** and the ADR-1 multi-host
collector architecture. The 2026-03-07 gap list is **fully resolved: 12/12 gaps
closed**, each traceable to a closed `fabric-*` successor bead and a verified
implementation file on `main`.

What remains is not planned-feature work but:

1. **Two recurrences of the single-file source bug** (digest `--source`, TUI busy-loop)
2. **A large verification/coverage hardening frontier** (~70 small contract-test beads)
3. **Small TUI polish** (heartbeat liveness; the `r`/`R` shortcut conflict is resolved — b1e8567)
4. **Bookkeeping closures** (digest-AI tracking beads whose code already landed)

All current gaps have corresponding open `fabric-*` beads. The next refresh of this
document should confirm the single-file bug class is fixed at the resolver layer
rather than patched per command.
