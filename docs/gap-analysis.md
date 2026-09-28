# FABRIC Gap Analysis

**Generated:** 2026-03-07 (original analysis, bead `bd-muv`)
**Last refreshed:** 2026-09-28 (bead `fabric-9ca2871c`; work session 2026-09-27→28 UTC)
**Analysis bead lineage:** `bd-muv` → `fabric-0c9aeb03` ("Gap analysis: Compare implementation against plan.md and create beads for missing features", closed) → `fabric-bd06ee99` (2026-09-26 refresh, closed) → `fabric-9ca2871c` (this refresh)

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

### Phase 1: Core Infrastructure ✅ COMPLETE (one open defect, one open contract cluster)
| Feature | File | Status |
|---------|------|--------|
| Log Tailer (single file) | src/tailer.ts | ✅ |
| Directory Tailer (canonical source for `~/.needle/logs/`, hot-add) | src/directoryTailer.ts | ✅ implemented — **open bug:** `fabric tui --source <dir>` startup replay busy-loops (root-caused, fix pending → owner `fabric-931136a0`) |
| JSON Parser | src/parser.ts | ✅ |
| Event Store (in-memory + SQLite event persistence) | src/store.ts | ✅ implemented — maxEvents cap + liveness guard live (src/web/server.ts:342/379/2137); contract pins open → `fabric-13164cdc` |
| Type Definitions | src/types.ts | ✅ |

### Phase 2: TUI Display ✅ COMPLETE (open P1 defect + coverage gaps — see Current Gaps)
| Feature | File | Status |
|---------|------|--------|
| Worker Grid | src/tui/components/WorkerGrid.ts | ✅ |
| Activity Stream | src/tui/components/ActivityStream.ts | ✅ (per-line render amplification is half of the busy-loop bug → `fabric-931136a0`) |
| Worker Detail | src/tui/components/WorkerDetail.ts | ✅ |
| Command Palette | src/tui/components/CommandPalette.ts | ✅ |
| Keyboard Navigation | src/tui/utils/keyboard.ts | ✅ (r/R deconfliction landed b1e8567; `fabric-de6a9f72` closed) |
| Focus Mode | src/tui/app.ts | ✅ (remaining view-machine coverage open → `fabric-becb1ab0`; `fabric-6dafdf52` closed 2026-09-27) |

### Phase 3: Web Display ✅ COMPLETE (2026-07→09 outage resolved; alert-dedup policy enforced)
| Feature | File | Status |
|---------|------|--------|
| HTTP Server | src/web/server.ts | ✅ |
| WebSocket Streaming | src/web/server.ts | ✅ |
| React Frontend | src/web/frontend/src/App.tsx | ✅ |
| Worker Cards | src/web/frontend/src/components/WorkerGrid.tsx | ✅ |
| Activity Feed | src/web/frontend/src/components/ActivityStream.tsx | ✅ |
| Fleet Summary Bar (Phase 9) | src/web/frontend/src/components/FleetSummaryBar.tsx | ✅ |
| Focus Mode | src/web/frontend/src/App.tsx | ✅ |

The live-service outage tracked by `fabric-166beca4` (dashboard dark since
2026-07-09; root cause of the long darkness was the hetzner-ex44 → codinghome
host migration, which no fabric systemd units survived) **closed 2026-09-14**.
Live check 2026-09-28 (~03:40 UTC re-check): `fabric-web.service` active,
`/api/health` → `status:"ok"` on :3000, OTLP :4318 listening, 113 files watched
(fleet re-activated; 129 at the 2026-09-27 check, 19 during the overnight
quiescent window). The alerting-pipeline item is resolved too:
documented AlertManager deduplication is now enforced end to end —
`fabric-c0e278ee` closed 2026-09-28 with `2b27660` (GET /api/alerts inventory +
store-path policy tests). No open web-display items remain.

### Phase 4: Intelligence Features (Core) ✅ COMPLETE
| Feature | File | Status |
|---------|------|--------|
| Cross-Reference Hyperlinking | src/crossReferenceManager.ts, src/tui/components/CrossReferencePanel.ts | ✅ |
| Inline Diff View | src/tui/components/DiffView.ts | ✅ |
| File Activity Heatmap | src/fileHeatmap.ts, src/tui/components/FileHeatmap.ts | ✅ implemented — documented behavior contracts pinned (`0f8363b` batch + `fabric-aa4751af`; remainder closed via `fabric-c0413489` / `fabric-2f9fd906`, 2026-09-28) |
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

## Current Gaps (2026-09-28)

plan.md marks Phases 1–9 complete. The bead store holds **95 open + 1 in_progress
of 430 beads** (2026-09-28 UTC; 97 before the FileHeatmap contract pair closed),
dominated by verification/coverage hardening, not missing
features. This refresh reclassifies the frontier — the 2026-09-26 edition mixed
bugs, missing features, and already-landed work under one "gaps" heading. Every
outstanding item below is linked to **exactly one owning bead**.

Classification legend: **bug** = code defect on main · **feature** = documented
behavior not yet built · **verification** = behavior exists, tests/docs must pin
it · **bookkeeping** = work landed, bead must close on existing evidence ·
**resolved** = fixed or recovered, kept for the record.

### 1. Open bugs (code defects on main)

| Owning bead | Class | Defect | State |
|------|-------|--------|-------|
| `fabric-931136a0` (P1) | **bug** | `fabric tui --source <dir>` pins a core at ~100% and never paints on realistic directories | **Root-caused** — docs/notes/tui-directory-source-busy-loop.md (re-verified 2026-09-19 at `5bdb723`): full-history synchronous replay of every recently-modified file × O(100×) blessed render amplification per line (~44–54 ms/line), sequenced *before* the first paint. Diagnosis child `fabric-0386d35e` is complete in substance; fix child `fabric-de6275b2` is open (a prior attempt left `.beads/traces/fabric-931136a0/wip-01a0b114-*.patch`, 91 KB, review before rewriting); regression gate `fabric-6d914c4c` blocks close. Open audit children around the diagnosis: `fabric-675ead93` / `fabric-cdbc3e3a` / `fabric-d541b07d` (note audit), plus the repro-script chain `fabric-ac34599b` + `fabric-b58f7e44`. |

### 2. Missing features (documented, not built)

| Owning bead | Class | Feature | Note |
|------|-------|---------|------|
| `fabric-92a4b7cb` (P1) | **feature** | Collapse `heartbeat.emitted` events into a per-worker liveness indicator in the TUI | 20 of the last 22 feed lines were heartbeats in a measured frame — the live view is unreadable without this. Split-child of `fabric-931136a0`; mechanically independent of the busy-loop fix. |

No other missing features were identified against plan.md Phases 1–9. The
single-file source bug class from the 2026-09-26 edition is **closed as a code
matter** (see §3/§4): the last open member was the digest source, which landed.

### 3. Resolved since the 2026-09-26 refresh (kept for the record)

| Owning bead | Was | Resolution |
|------|-----|------------|
| `fabric-166beca4` (closed 2026-09-14) | **bug/ops** — live web dashboard dark since 2026-07-09, OPS-GATED | Root cause of the two-month darkness: the hetzner-ex44 → codinghome migration never reinstalled the fabric systemd units (the `Restart=on-failure` watchdog died with the old host). Code fixes shipped in `14e96e0` (ESM heap-snapshot writer, memory-pressure trigger, retention size cap). Service reinstalled on codinghome and verified live 2026-09-27: `fabric-web.service` active, `/api/health` `status:"ok"` (:3000), OTLP :4318 listening, 129 files watched. |
| `fabric-de6a9f72` (closed) | **bug** — TUI `r`/`R` shortcut conflict | b1e8567 deconflicted the bindings (`r` re-renders, `R` alone toggles replay, DAG force-refresh → `C-r`); a707ec86 pinned the help-overlay text. |
| `fabric-32fe329b` + children (still open) | **feature** — `fabric digest` hardcoded to a single-file `workers.log` source, no `--source` directory support | **Landed on main** — the code claim is no longer true. Evidence: digest declares `--source` (src/cli.ts:778), routes through the shared resolver (`resolveFromOptions` src/cli.ts:96, default `{kind:'directory', path:'~/.needle/logs'}`), and constructs `DirectoryTailer` for directory sources (src/cli.ts:826). Landed via `52640c8` (replay directory source), `35b44b5` (`-s` short flag), `fd6c1de` (docs). What remains is bookkeeping (§4), not a feature gap. |
| `fabric-c0e278ee` (closed 2026-09-28) | **bug** (policy not enforced) — AlertManager dedup not applied to alert-bead creation | Shipped in `2b27660`: `GET /api/alerts` exposes the deduplicated inventory (one active instance per kind/scope identity + immutable resolved history), and store-path integration tests in src/alertManager.test.ts pin the policy clauses (duplicate observations fold into one active instance, reason changes keep one identity, cooldown suppresses then escalates, resolution is idempotent). |
| `fabric-6dafdf52` (closed 2026-09-27) | **verification** — complete TUI view-state/overlay contract tests | Closed at epoch 5 after its contract batch landed; the committed full-suite baseline (3397 passed / 99 files, `a06b818` era) includes it. Remaining documented view-machine coverage continues under `fabric-becb1ab0`. |
| `fabric-2fd06cd1` + `fabric-f05a227a`, `fabric-b7b48295` (all closed) | **verification** — clean-install smoke workflow + release-gate suite | Smoke workflow landed 2026-09-26; the release-gate suite landed in `0044710` (2026-09-27, owner bead `fabric-2fd06cd1`). |

### 4. Implemented in code, tracking beads still open (bookkeeping + coverage)

| Owning bead | Cluster | What actually remains |
|------|---------|----------------------|
| `fabric-32fe329b` (+ ~15 children: `fabric-01a5f18a`, `fabric-1913db1c`, `fabric-37cdb6da`, `fabric-ec0f6c7e`, `fabric-76cb8c06`, `fabric-b52c383e`, …) | digest `--source` | Feature is live (§3); children are test/documentation verifications — close them on the landed code, don't reimplement. |
| `fabric-e91edf0c`, owner `fabric-f511a390` | Digest AI narrative | src/digestAi.ts landed 2026-09-16 (plan.md §AI Session Digest; `66ee920`); close on the documented fallback contract. Four `[Unravel]` proposals (`fabric-28421d4d`, `fabric-fdafee52`, `fabric-51d76530`, `fabric-6ef5794a`) target the *escalation-counter* dispatch infra (needle-e62f940a), not FABRIC code. |

### 5. Verification & coverage hardening (largest cluster, ~63 beads)

Contract/coverage work pinning documented behavior in tests — each bead small, the
aggregate large. **The maxEvents enforcement named by this cluster is implemented,
not missing:** `--max-events` parses (src/cli.ts:351) and propagates into the web
server (`maxEventCount`, src/web/server.ts:123/166), the liveness endpoints report
503 when the store exceeds the cap (src/web/server.ts:342/379), and the memory-bomb
guard exits after 3 consecutive over-max checks (src/web/server.ts:2137-2143).
What is open is *pinning those contracts in tests*:

- **CLI operational-option contracts** — owner `fabric-13164cdc`, children `fabric-7666ce28` (help surface), `fabric-83cc1dea` (`--max-events` propagation + overload liveness), `fabric-2c20fd74` (3-strike guard exit + streak reset), `fabric-c7fab6aa` (snapshot options). An implementation already exists on main (commit `890f3ae`, src/cliOperationalOptions.test.ts) — children verify, then close.
- **Coverage baseline artifacts** (`fabric-e166b9dd`, `fabric-fe89fbe4`, `fabric-f04ff738` + ~20 children): establish and document `artifacts/coverage-baseline/`. Several chains have degenerated into meta-verification (beads verifying that a README exists and is git-tracked: `fabric-77e760ed`, `fabric-7a492467`, `fabric-b888494b`, `fabric-e961550d`, `fabric-e45eb76d`, `fabric-0e134708`, …) — most are quarantined or deferred; batch-reconcile rather than dispatching one per epoch.
- **Memory / heap-snapshot contracts** (`fabric-c05c7990`, `fabric-d7bd9360`, `fabric-6734f908`, `fabric-b764daff`, `fabric-b8b13850`): retention, diff analysis, API endpoints, trigger/cooldown pins.
- **Metrics & OTLP host-label contracts** (`fabric-0b557baa`, owner `fabric-96975906`, children `fabric-37c4b812`, `fabric-45dc56ba`, `fabric-f0f1c757`, `fabric-86bfc356`): `/api/metrics` types/help text, per-host separation, label escaping.
- **Component behavior contracts**: FileHeatmap documented behaviors are now fully
  pinned — the `fabric-aa4751af` batch (`0f8363b`) plus `fabric-c0413489` and
  `fabric-2f9fd906`, both **closed 2026-09-28** after their failure-count:3
  escalations resolved as infra-only (declined splits; contract batches landed).
  Remaining open: TUI view machine (`fabric-becb1ab0`; `fabric-6dafdf52` closed
  2026-09-27, its batch is in the committed baseline).
- **Retention-prune audit** (`fabric-0a4e421b`): tests vs documented count/age/size rules.
- **Ingest-schema validation via synthetic logs** (`fabric-8abad6e9`, owner `fabric-f88573e2` + trace/catalog children): derive required-field lists from src/normalizer.ts and src/store.ts.
- **TUI shortcut documentation** (`fabric-6361cc78`, `fabric-5a449ea7`, `fabric-a90a6ab0`, `fabric-06fb6dc0`, `fabric-3e4e93b3`).

### 6. Operational noise (P4)

- `fabric-3b8cdb99`, `fabric-6fba739d` — `[Pulse]` ENOENT when tests delete aged heap snapshots; symptom of the heap-snapshot test cluster above.

### Known future work recorded in plan.md (no bead)

- Wiring the `>digest` command-palette trigger and the periodic/session-end triggers to the AI digest layer (they stay deterministic by design today; plan.md §AI Session Digest).

### Verification results recorded by this refresh (2026-09-28 UTC)

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | exit 0 — no type errors |
| `npx vitest run` | **3571 passed / 2 skipped / 0 failed, 103 files**, exit 0 (~104 s) |
| Committed-main baseline | superseded — the 3397/99-file reference (`a06b818` era) predates the alert-dedup suite (`2b27660`: 9 route tests + 9 store-path tests); the 3571/103 run above is the current full-suite reference |
| Live service | `fabric-web.service` active; `/api/health` → `status:"ok"`, 10,000 events, **113** tailer files watched (fleet re-activated; 129 at the 2026-09-27 check, 19 quiescent overnight), :3000 + :4318 listening |

The working tree at verification time differed from `main` only by this document
and bead-checkpoint bookkeeping — neither is compiled or executed by the suite —
so the results above are effectively committed-main results.

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

fabric-bd06ee99 (2026-09-26 refresh) — CLOSED
fabric-9ca2871c (2026-09-27/28 refresh — this document) — closes with this refresh
├── fabric-931136a0 (tui --source busy-loop) — open BUG, root-caused (failure-count:4)
│   ├── fabric-0386d35e (diagnosis umbrella — substance complete, close on the note)
│   │   ├── fabric-675ead93 / fabric-cdbc3e3a / fabric-d541b07d (note-audit children) — open
│   │   └── fabric-ac34599b (repro-script hardening) + fabric-b58f7e44 (repro note) — open
│   ├── fabric-de6275b2 (watcher fix) — open
│   ├── fabric-6d914c4c (regression gate) — open
│   └── fabric-92a4b7cb (heartbeat liveness) — open FEATURE
├── fabric-c0e278ee (AlertManager dedup enforcement) — CLOSED 2026-09-28 (2b27660)
├── fabric-32fe329b (digest --source) — open BOOKKEEPING (code landed: 52640c8, 35b44b5, fd6c1de)
├── fabric-e91edf0c / fabric-f511a390 (digest AI closure) — open BOOKKEEPING (code landed: 66ee920)
├── fabric-166beca4 (web outage) — CLOSED 2026-09-14 (service live, re-verified 2026-09-28)
├── fabric-de6a9f72 (r/R conflict) — CLOSED (b1e8567, a707ec86)
├── fabric-6dafdf52 (TUI view-state contracts) — CLOSED 2026-09-27 (batch in committed baseline)
└── verification & coverage hardening cluster (~65 beads) — open
    ├── fabric-13164cdc (CLI operational options incl. --max-events contracts)
    ├── fabric-c0413489 / fabric-2f9fd906 (FileHeatmap behavior contracts) — CLOSED 2026-09-28
    ├── fabric-becb1ab0 (documented TUI view machine — completion)
    └── … (metrics, memory, ingest-schema, retention, coverage-baseline, TUI docs)
```

---

## Recommendations

1. **Land the TUI busy-loop fix — the only open product bug with user-visible
   impact.** The diagnosis is done (docs/notes/tui-directory-source-busy-loop.md);
   `fabric-de6275b2` should start from the reviewed WIP patch
   (`.beads/traces/fabric-931136a0/wip-01a0b114-*.patch`) rather than from scratch,
   apply the note's P1 (coalesce renders) before P2 (yielding replay), then let
   `fabric-6d914c4c` pin the scheduling contract. The single-file source bug class
   itself is closed at the resolver layer — the Phase 8 cure now covers
   `tui`/`web`/`tail`/`digest`/`replay`; no third recurrence exists.

2. **Close the bookkeeping beads on landed code.** `fabric-32fe329b` and its
   digest-`--source` children should verify against the implemented resolver path
   and close; `fabric-e91edf0c`/`fabric-f511a390` likewise for the digest AI layer.
   Re-opening implementation work against already-landed code is how this store
   grew meta-verification chains.

3. **Batch the hardening cluster by subsystem.** The ~65 verification beads are
   individually trivial but churn-prone; work them per subsystem (metrics, memory,
   CLI options, ingest schema) so shared test helpers land once. Watch the
   escalation-counter behavior on re-dispatched beads (see the `[Unravel]` beads:
   infra failures and declined splits are not content failures). The
   coverage-baseline README chains are deep in quarantine/defer — reconcile them as
   one batch instead of per-epoch redispatches.

4. **TUI polish is cheap:** heartbeat liveness (`fabric-92a4b7cb`) is user-visible
   and small; schedule it alongside the busy-loop fix since both touch the same
   feed path.

5. **Keep this document honest about eras.** New beads get `fabric-*` IDs via
   `bead` (bead-rs). Legacy `bd-*`/`bf-*` IDs in prose are history — map them, don't
   revive them.

---

## Files Reviewed (2026-09-28 refresh)

- docs/plan.md (Phases 1–9 complete, ADR-1 multi-host collector) — unchanged this refresh
- src/cli.ts — digest `--source`/resolver path (lines 96–99, 775–830), `--max-events` parse/propagation (351, 404)
- src/web/server.ts — maxEventCount overload responses (342, 379) and 3-strike liveness guard (2137–2143)
- src/directoryTailer.ts, src/tailer.ts — startup replay path (busy-loop root-cause surface)
- docs/notes/tui-directory-source-busy-loop.md — root-cause note, re-verified 2026-09-19 at `5bdb723`
- docs/alert-policy.md — AlertManager policy (enforced end to end by closed `fabric-c0e278ee`)
- Bead store: `bead list` — 95 open + 1 in_progress of 430 as of 2026-09-28 UTC; lineage beads `fabric-0c9aeb03`, `fabric-bd06ee99`, `fabric-166beca4`, `fabric-de6a9f72`, `fabric-aa4751af`, `fabric-6dafdf52`, `fabric-c0e278ee`, `fabric-c0413489`, `fabric-2f9fd906`, `fabric-2fd06cd1`/`fabric-f05a227a`/`fabric-b7b48295` confirmed closed
- Live service: `systemctl --user is-active fabric-web.service` (active), `GET /api/health` (`status:"ok"`, 10,000 events, 113 tailer files watched), `ss -tln` (:3000, :4318)
- Verification: `npx tsc --noEmit` (exit 0), `npx vitest run` (3571 passed / 2 skipped / 0 failed, 103 files, exit 0 — table above)

---

## Conclusion

FABRIC is **feature-complete against plan.md Phases 1–9** and the ADR-1 multi-host
collector architecture. The 2026-03-07 gap list is **fully resolved: 12/12 gaps
closed**, each traceable to a closed `fabric-*` successor bead and a verified
implementation file on `main`.

Reconciled against the open bead store on 2026-09-28, what actually remains is:

1. **One open product bug:** the TUI directory-source busy-loop
   (`fabric-931136a0`) — root-caused, fix + regression gate pending.
2. **One small missing feature:** heartbeat liveness collapse (`fabric-92a4b7cb`).
3. **A large verification/coverage hardening frontier** (~63 small contract-test
   beads) — including the maxEvents contracts, whose enforcement itself is
   already implemented.
4. **Bookkeeping closures** (digest `--source` and digest-AI beads whose code
   already landed).
5. **Resolved and on record:** the web dashboard outage (`fabric-166beca4`,
   closed 2026-09-14; re-verified live 2026-09-28), the `r`/`R` shortcut conflict
   (`fabric-de6a9f72`), the alert-dedup policy gap (`fabric-c0e278ee`, closed
   2026-09-28 via `2b27660`), the TUI view-state contract batch
   (`fabric-6dafdf52`, closed 2026-09-27), the FileHeatmap behavior-contract pair
   (`fabric-c0413489` / `fabric-2f9fd906`, closed 2026-09-28), and the
   clean-install smoke / release-gate cluster (`fabric-2fd06cd1` + children, closed).

Every outstanding item above is linked to exactly one owning bead, and the
2026-09-26 edition's last stale claim — digest lacking directory-tail support —
is corrected: the resolver layer now backs `tui`, `web`, `tail`, `replay`, and
`digest` alike.
