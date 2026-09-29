# FABRIC Gap Analysis

**Generated:** 2026-03-07 (original analysis, bead `bd-muv`)
**Last refreshed:** 2026-09-28 (bead `fabric-14247d59`; live-checkpoint reconciliation)
**Analysis bead lineage:** `bd-muv` → `fabric-0c9aeb03` ("Gap analysis: Compare implementation against plan.md and create beads for missing features", closed) → `fabric-bd06ee99` (2026-09-26 refresh, closed) → `fabric-9ca2871c` (2026-09-27/28 refresh, closed) → `fabric-301ad288` (live-inventory reconciliation draft; closed as superseded by `fabric-cb4e1df8`) → `fabric-cb4e1df8` (status reconciliation + repeatable refresh check, closed) → `fabric-14247d59` (live-checkpoint reconciliation)

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

### Phase 3: Web Display — IMPLEMENTED; PRODUCTION READINESS PENDING
| Feature | File | Status |
|---------|------|--------|
| HTTP Server | src/web/server.ts | ✅ |
| WebSocket Streaming | src/web/server.ts | ✅ |
| React Frontend | src/web/frontend/src/App.tsx | ✅ |
| Worker Cards | src/web/frontend/src/components/WorkerGrid.tsx | ✅ |
| Activity Feed | src/web/frontend/src/components/ActivityStream.tsx | ✅ |
| Fleet Summary Bar (Phase 9) | src/web/frontend/src/components/FleetSummaryBar.tsx | ✅ |
| Focus Mode | src/web/frontend/src/App.tsx | ✅ |

The web implementation and the historical outage remediation are complete:
`fabric-166beca4` (dashboard dark since 2026-07-09 after the
hetzner-ex44 → codinghome migration) closed 2026-09-14, and the AlertManager
deduplication work in `fabric-c0e278ee` shipped in `2b27660`. That is an
implementation/liveness result, not a production-readiness attestation.

The live check on 2026-09-28 found `fabric-web.service` active,
`/api/health` returning HTTP 200 with `status:"ok"`, :3000 and OTLP/HTTP :4318
listening, and both native and OTLP unauthenticated POSTs rejected with 401.
The readiness gate still returned **BLOCKED**: the prune timer was disabled,
`GET /api/retention` reported 218,385 files (3.16 GB), an indefinite policy,
and no `lastPrune` record. The open inventory also retains the pruning and
OTLP/metrics contract owners listed in the gate section below. The dashboard
therefore has no open web-display implementation item, but Phase 3 must not be
called production-ready until the live gate passes.

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

plan.md's feature checklists for Phases 1–9 are implemented, but the Phase 3
production claim is now gated by the live check in §0a. The checkpoint snapshot
used for this refresh holds **93 open + 1 in_progress of 455 beads** (checkpoint
sequence 5435, created 2026-09-29 00:01 UTC, machine-read by
`scripts/gap-inventory-check.mjs`; the authoritative live list is the generated
inventory block below), dominated by
verification/coverage hardening plus the operational readiness items called out
in §0a. This refresh reclassifies the frontier — the 2026-09-26 edition mixed
bugs, missing features, and already-landed work under one "gaps" heading. Every
outstanding item below is linked to **exactly one owning bead**.

Classification legend: **bug** = code defect on main · **feature** = documented
behavior not yet built · **verification** = behavior exists, tests/docs must pin
it · **bookkeeping** = work landed, bead must close on existing evidence ·
**resolved** = fixed or recovered, kept for the record.

### 0. Status refresh convention (repeatable check)

Earlier editions of this document drifted: beads whose implementation the same
document called complete (the original gap-analysis bead, the native events API,
batch ingestion, and authentication work among them) stayed in the open-gap list
because counts and statuses were hand-maintained. The inventory block below is no
longer hand-maintained. It is **generated** from the bead checkpoint by
`scripts/gap-inventory-check.mjs`, which is the repeatable status-refresh/check
for this document:

- `node scripts/gap-inventory-check.mjs --check` — bidirectional comparison
  against the store: every open/in_progress bead must appear in the inventory
  (no understated gaps) and every inventory bead must still be open or
  in_progress (no overstated, already-finished work). Also lints every
  `fabric-*` id cited anywhere in this document against the store. Exit 0 in
  sync · 1 drift · 2 structural · 3 no store source.
- `node scripts/gap-inventory-check.mjs --fix` — regenerate the inventory block
  in place from the store. Run after any bead listed here closes or a new gap
  bead opens; re-run `--check` afterwards, and commit the document and the
  checkpoint churn together so the committed inventory and committed store stay
  mutually consistent.
- `node scripts/gap-inventory-check.mjs --lint-doc` — structural only: block
  parses and every cited id exists. No status comparison, so it is safe to run
  continuously; `tests/gapInventoryCheck.test.ts` pins the tool's behavior on
  fixtures and runs this lint against the real document in the suite.

The checkpoint (`.beads/checkpoint/current.json` → `active_root`) is the data
source; bead-rs republishes it after every mutation, so the check never needs a
token or the live CLI (the CLI is a fallback, nothing more).

### 0a. Production-readiness gate (live, fail-closed)

The implementation checklist is not the production gate. Run the live check
from this checkout before changing the Phase 3 status:

```bash
npm run readiness:check
# Machine-readable evidence:
node scripts/production-readiness-check.mjs --json
```

The gate requires all of the following at the same time: `fabric-web.service`
active; the pruning timer enabled and active; `/api/health` returning a FABRIC
`status:"ok"` response; an open TCP listener on OTLP/HTTP :4318; 401/403
rejection for unauthenticated native and OTLP POSTs; an explicit positive
retention policy with a successful prune within 36 hours; and no open or
in-progress readiness owner in the checkpoint. A non-zero exit is the required
status: Phase 3 remains **implemented but not production-ready**.

The owner links currently surfaced by the checkpoint are:

| Owner | Unresolved scope |
|---|---|
| `fabric-0a4e421b` | Retention-pruning rules and evidence; this does not prove the live timer or last run is healthy. |
| `fabric-37c4b812`, `fabric-45dc56ba` | OTLP host fallback and label escaping contracts. |
| `fabric-86bfc356`, `fabric-96975906`, `fabric-f0f1c757` | OTLP host attribution and per-host metrics contracts. |

The prior production-readiness reconciliation bead (`fabric-ff926483`) is now
closed and is not part of the open inventory. This documentation reconciliation
(`fabric-14247d59`) is in progress while this refresh is finalized, but it is
not a production-readiness owner and does not waive any live check. Auth
implementation owners `fabric-0538da5f` and
`fabric-9c04e80b` are closed, but the live 401/403 probes remain mandatory.
Remote producer wiring is still separately unverified in
[`docs/otlp-config.md`](otlp-config.md), so a local listener alone cannot
close the production-readiness claim.

<!-- gap-inventory:begin (generated by scripts/gap-inventory-check.mjs — do not hand-edit; refresh: node scripts/gap-inventory-check.mjs --fix)
bead_id	status	priority	title
fabric-0386d35e	open	1	Diagnose the fabric tui directory-source busy-loop and add a repro script
fabric-675ead93	open	1	Audit the busy-loop note for complete answers to the four diagnostic questions
fabric-6d914c4c	open	1	Add regression coverage for the fabric tui directory-source CPU behavior
fabric-92a4b7cb	open	1	Collapse heartbeat events into a per-worker liveness indicator in the fabric tui
fabric-931136a0	open	1	fabric tui --source busy-loops a CPU core and never renders on a realistic log directory
fabric-ac34599b	open	1	Verify and harden the synthetic-log repro script (gen-synthetic-logs.sh)
fabric-cdbc3e3a	open	1	Sharpen the recommended fix shape as input to the fix child
fabric-d541b07d	open	1	Re-confirm the busy-loop root-cause note file:line references against current main
fabric-de6275b2	open	1	Fix the fabric tui directory watcher to be event- or interval-driven
fabric-01a5f18a	open	2	Add --source option to digest command CLI
fabric-06fb6dc0	open	2	Document view-specific TUI navigation shortcuts
fabric-0a01d556	open	2	Derive store-stage unguarded field consumption from src/store.ts add()
fabric-0a4e421b	open	2	Audit retention pruning tests against documented count, age, and size rules
fabric-0b557baa	open	2	Add Prometheus metrics contract tests
fabric-0e134708	open	2	Record git ls-files listing for artifacts/coverage-baseline/
fabric-13164cdc	open	2	Add CLI contract tests for operational options
fabric-14247d59	in_progress	2	Reconcile documentation status with the live bead inventory
fabric-1779a715	open	2	Record README verification evidence on parent fabric-77e760ed
fabric-18cd12b8	open	2	Catalog normalizeLegacyLogEntry field handling in src/normalizer.ts
fabric-1913db1c	open	2	Route digest command through resolveFromOptions/resolveSource
fabric-2696154d	open	2	Create integration test for complete --source file workflow
fabric-28421d4d	open	2	[Unravel] Implement AI digest provider module with env config and fallback contract — Land the escalation-counter fix: verified_success supersedes infra-failure and declined-SPLIT outcomes
fabric-2c20fd74	open	2	Add liveness-guard exit and streak-reset contract tests for --max-events
fabric-33f892ca	open	2	Document baseline coverage metrics in artifact directory
fabric-37c4b812	open	2	Add missing-host-attribute and legacy-source fallback contract tests
fabric-37cdb6da	open	2	Set default digest source to ~/.needle/logs/ directory
fabric-37ea598a	open	2	Add test for digest output includes events from file
fabric-397a2384	open	2	Run final test validation
fabric-3b8cdb99	open	2	[Pulse] [test] [22m[39mFailed to delete aged snapshot heap-9050007-test.heapsnapshot: Error: ENOENT: no such f...
fabric-3c57d26f	open	2	Test digest --source option with file path
fabric-3e4e93b3	open	2	Validate and reconcile the complete TUI shortcut reference
fabric-41b29204	open	2	Validate all file path resolution tests
fabric-45dc56ba	open	2	Add host-label escaping exposition contract tests
fabric-4693fa4a	open	2	Extend README.md to close any purpose or refresh-convention gaps
fabric-46cd7121	open	2	Confirm README.md documents the baseline refresh convention
fabric-503cb151	open	2	Trace normalize() dispatch branch selection in src/normalizer.ts
fabric-51d76530	open	2	[Unravel] Verify documented-metric contract for /api/metrics (types, values, help text) — Settle fabric-b9488730 by mechanical rule: journal-first re-verify, reconcile stale escalation labels, close
fabric-5a449ea7	open	2	Document global TUI navigation and view lifecycle
fabric-5d5f2c18	open	2	Verify coverage baseline directory is fully committed and pushed on main
fabric-6361cc78	open	2	Complete TUI keyboard shortcut documentation
fabric-63eef07d	open	2	Verify baseline artifacts are saved and readable
fabric-6734f908	open	2	Cover the heap-diff analysis layer: listing, diff, trend, and report saving
fabric-6ef5794a	open	2	[Unravel] Verify documented-metric contract for /api/metrics (types, values, help text) — Fix escalation-counter conflation in NEEDLE dispatch (infra failures and declined splits are not content failures), then settle this bead in one clean epoch
fabric-6fba739d	open	2	[Pulse] [test] Failed to delete aged snapshot heap-9050008-test.heapsnapshot: Error: ENOENT: no such file or dir...
fabric-7666ce28	open	2	Add CLI help-surface contract tests for --max-events, --heap-snapshots, and --snapshot-interval
fabric-76cb8c06	open	2	Test digest --source option with directory path
fabric-77e760ed	open	2	Verify coverage baseline README documents purpose and refresh convention
fabric-7a492467	open	2	Verify artifacts/coverage-baseline/README.md exists and is git-tracked
fabric-7b653e87	open	2	Validate ingest fields on every generated line and remove the generated temp dirs
fabric-7c18134c	open	2	Confirm the README purpose statement paragraph is present
fabric-83cc1dea	open	2	Add --max-events propagation and overload-liveness contract tests
fabric-86bfc356	open	2	Add OTLP host extraction and label-precedence contract tests
fabric-8abad6e9	open	2	Validate synthetic JSONL lines against the ingest schema
fabric-910bb7b4	open	2	Generate a fresh synthetic batch with scripts/gen-synthetic-logs.sh and validate every line parses as JSON
fabric-9616f7cf	open	2	Record explicit PRESENT/ABSENT git-tracking verdict for artifacts/coverage-baseline/README.md
fabric-96975906	open	2	Add multi-host Prometheus metrics contract tests
fabric-9a1dfd6d	open	2	Save digest-command-baseline coverage report artifact
fabric-9b571d17	open	2	Check on-disk presence and ignore-rule status for artifacts/coverage-baseline/README.md
fabric-a90a6ab0	open	2	Document TUI filtering and sorting controls
fabric-a9a3b37f	open	2	Document digest command coverage metrics
fabric-aa86d7ab	open	2	Cross-check on-disk state of artifacts/coverage-baseline/README.md against git tracking
fabric-aeb827b6	open	2	Verify test coverage for digest command
fabric-b2e6b65d	open	2	Add test for digest command processing file input
fabric-b30fd05e	open	2	Document baseline percentage and key metrics in summary file
fabric-b52c383e	open	2	Verify digest backward compatibility with -f/--file option
fabric-b58f7e44	open	2	Record the repro-script verification note in the diagnosis doc
fabric-b764daff	open	2	Test the memory-analysis HTTP API endpoints and cross-check doc coverage
fabric-b888494b	open	2	Read artifacts/coverage-baseline/README.md and confirm purpose statement
fabric-b8b13850	open	2	Pin trigger metadata and pressure-cooldown behavior in tests
fabric-becb1ab0	open	2	Complete regression coverage for the documented TUI view machine
fabric-c05c7990	open	2	Add heap snapshot retention and memory API tests
fabric-c3b1c691	open	2	Derive normalizer-stage required fields from src/normalizer.ts normalizeJsonl and legacy-flat branches
fabric-c6cc4144	open	2	Confirm the README artifact table covers all four baseline artifacts
fabric-c7fab6aa	open	2	Add --heap-snapshots and --snapshot-interval default and propagation contract tests
fabric-c93fc9aa	open	2	Consolidate the derived ingest required-field list and cross-check against fabric-8abad6e9 notes
fabric-ca34b94f	open	2	Record remaining tracked files and any gap for artifacts/coverage-baseline/
fabric-cebcb414	open	2	Catalog normalizeJsonl required-field checks in src/normalizer.ts
fabric-cf4c222c	open	2	Add test for file path resolution in --source option
fabric-d71f6139	open	2	Analyze schema_version throw and route flat synthetic line shape
fabric-d7bd9360	open	2	Add heap snapshot retention and analysis API tests
fabric-e166b9dd	open	2	Run baseline coverage analysis for digest command
fabric-e45eb76d	open	2	Record explicit README.md tracked verdict for artifacts/coverage-baseline/README.md
fabric-e71a89b7	open	2	Add tests for uncovered digest scenarios
fabric-e7e45d38	open	2	Harden gen-synthetic-logs.sh path handling and check CLI hygiene
fabric-e961550d	open	2	Confirm README.md is git-tracked in the recorded coverage-baseline listing
fabric-ec0f6c7e	open	2	Add test coverage for digest command with directory sources
fabric-efd75e24	open	2	Reconcile README.md tracking verdict against the 2026-09-19 baseline
fabric-f04ff738	open	2	Create coverage baseline directory in artifacts folder
fabric-f0f1c757	open	2	Add per-host metric separation contract tests
fabric-f3cd12fb	open	2	Confirm the README gitignore note for raw coverage reports
fabric-f88573e2	open	2	Derive the ingest required-field list from src/tailer.ts, src/normalizer.ts and src/store.ts
fabric-fdafee52	open	2	[Unravel] Implement AI digest provider module with env config and fallback contract — Re-verify fabric-2a444e51 against a mechanical evidence checklist and close it
fabric-fe89fbe4	open	2	Identify uncovered digest command code paths
fabric-f511a390	open	3	Own: Digest AI narrative (--ai) feature — implementation, docs, dependency, data-egress contract, verification
gap-inventory:end -->

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
| `fabric-08706085` (closed 2026-09-28) | **verification** — help-overlay semantics | TUI help-overlay behavior is pinned by the landed test batch. |
| `fabric-dddac75c` (closed 2026-09-28) | **verification** — alert deduplication through the live pipeline | The alert-to-bead path is covered by the deduplication contract and integration tests. |
| `fabric-e1f86a53` (closed 2026-09-28) | **verification** — FileHeatmap behavior and live refresh | FileHeatmap behavior and refresh contracts are covered by the landed test batch. |
| `fabric-dd0432e9` (closed 2026-09-28) | **verification** — documented npm release workflow | The release workflow's documented maintenance gate is tracked and verified. |
| `fabric-32fe329b` (closed 2026-09-28) + children | **feature** — `fabric digest` hardcoded to a single-file `workers.log` source, no `--source` directory support | **Landed on main and parent closed** — digest declares `--source` (src/cli.ts:778), routes through the shared resolver (`resolveFromOptions` src/cli.ts:96, default `{kind:'directory', path:'~/.needle/logs'}`), and constructs `DirectoryTailer` for directory sources (src/cli.ts:826). Landed via `52640c8`, `35b44b5`, and `fd6c1de`; remaining children are verification/documentation work. |
| `fabric-c0e278ee` (closed 2026-09-28) | **bug** (policy not enforced) — AlertManager dedup not applied to alert-bead creation | Shipped in `2b27660`: `GET /api/alerts` exposes the deduplicated inventory (one active instance per kind/scope identity + immutable resolved history), and store-path integration tests in src/alertManager.test.ts pin the policy clauses (duplicate observations fold into one active instance, reason changes keep one identity, cooldown suppresses then escalates, resolution is idempotent). |
| `fabric-6dafdf52` (closed 2026-09-27) | **verification** — complete TUI view-state/overlay contract tests | Closed at epoch 5 after its contract batch landed; the committed full-suite baseline (3397 passed / 99 files, `a06b818` era) includes it. Remaining documented view-machine coverage continues under `fabric-becb1ab0`. |
| `fabric-2fd06cd1` + `fabric-f05a227a`, `fabric-b7b48295` (all closed) | **verification** — clean-install smoke workflow + release-gate suite | Smoke workflow landed 2026-09-26; the release-gate suite landed in `0044710` (2026-09-27, owner bead `fabric-2fd06cd1`). |

### 3a. Lineage status verification (2026-09-28, machine-checked against the store)

The 2026-09-26/28 editions listed beads as open in their inventory while the same
editions' prose recorded those lineages as complete or closed. Every named
lineage is re-statused directly against the bead store here; none of these is a
live gap, and none appears in the generated inventory:

| Bead | Was listed as open for | Store status (2026-09-28) |
|------|------------------------|---------------------------|
| `fabric-0c9aeb03` | The original gap-analysis bead itself | **closed** |
| `fabric-85212f76` | Native events ingestion (`POST /api/events`) | **closed** |
| `fabric-14554e53` | Batch ingestion (`POST /api/events/batch`) | **closed** |
| `fabric-0538da5f` | Authentication/authorization on the ingestion endpoint | **closed** |
| `fabric-9c04e80b` | `FABRIC_AUTH_TOKEN` end-to-end wiring in deployed config | **closed** |
| `fabric-e593b9ce` | Production-readiness epic (retention, OTLP, auth, ingress, self-observability) | **closed** |
| `fabric-9ca2871c` | Prior gap-analysis refresh | **closed** |
| `fabric-8ffe1cb9` | Duplicate alert-dedup implementation bead | **closed** — shipped-work gate confirmed the implementation landed; the canonical policy record is `fabric-c0e278ee` |
| `fabric-cb4e1df8` | Prior live-inventory reconciliation | **closed** |
| `fabric-ac301879`, `fabric-8402deda`, `fabric-ade0e71c`, `fabric-d1e3d354` | 2026-09-28T03:38 alert/web-smoke weave batch (all four members) | **all closed** |

This table is itself checked: `--lint-doc`/`--check` verify every id cited in
this document exists in the store, and the generated inventory block is
bidirectionally compared against the store's open set, so a bead in this table
reverting to open would surface as an understated gap on the next `--check`.

### 4. Implemented in code, tracking beads still open (bookkeeping + coverage)

| Owning bead | Cluster | What actually remains |
|------|---------|----------------------|
| `fabric-32fe329b` children (+ ~15: `fabric-01a5f18a`, `fabric-1913db1c`, `fabric-37cdb6da`, `fabric-ec0f6c7e`, `fabric-76cb8c06`, `fabric-b52c383e`, …) | digest `--source` | Parent is closed because the feature is live (§3). The three named implementation children are stale bookkeeping records and should close against the landed code; the remaining children are test/documentation verifications — close them on the landed code, don't reimplement. |
| `fabric-f511a390` | Digest AI narrative maintenance owner | `fabric-e91edf0c` is closed because the implementation is verified. This standing owner remains open for regressions, SDK upgrades, documentation drift, or deliberate egress-contract changes. Four `[Unravel]` proposals (`fabric-28421d4d`, `fabric-fdafee52`, `fabric-51d76530`, `fabric-6ef5794a`) target the *escalation-counter* dispatch infra (needle-e62f940a), not FABRIC code. |

### 5. Verification & coverage hardening (largest cluster, ~64 beads)

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
- **Alert-domain + web-smoke batch** (2026-09-28T03:38 weave generation): fully
  reconciled 2026-09-28 — `fabric-ac301879` (Agentation mount verification in
  web smoke tests), `fabric-8402deda` (alert state durability across process
  restarts), `fabric-ade0e71c` (legacy duplicate alert beads), and sibling
  `fabric-d1e3d354` (alert dedup/lifecycle contract tests) are **all closed in
  the store**; none remains a live gap (see §3a).

### 6. Operational noise (P4)

- `fabric-3b8cdb99`, `fabric-6fba739d` — `[Pulse]` ENOENT when tests delete aged heap snapshots; symptom of the heap-snapshot test cluster above.

### Known future work recorded in plan.md (no bead)

- Wiring the `>digest` command-palette trigger and the periodic/session-end triggers to the AI digest layer (they stay deterministic by design today; plan.md §AI Session Digest).

### Verification results recorded by this refresh (2026-09-28 UTC, `fabric-14247d59` pass)

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | exit 0 — no type errors (src and tests configs both clean) |
| `npx vitest run` | **3692 passed / 2 skipped / 0 failed, 112 files**, exit 0 — includes the gap-inventory and production-readiness checker cases |
| `npm test` | exit 0 — pretest TypeScript build plus the same **3692 passed / 2 skipped / 0 failed** Vitest suite |
| `gap-inventory-check --check` | exit 0 — inventory in sync: 94 open/in_progress beads match the generated block; all cited ids verified |
| `gap-inventory-check --lint-doc` | exit 0 — 94 inventory rows parse; all cited ids exist in the store (run in the suite via `tests/gapInventoryCheck.test.ts`) |
| `npm run build` | exit 0 — TypeScript production build |
| `npm run build:web` | exit 0 — Vite production frontend build |
| `npm run readiness:check` | exit 1 — expected block: prune timer disabled, no explicit policy/last prune, and six unresolved readiness owners; service/listener/auth probes pass on the stable rerun |
| Live service | `fabric-web.service` active after restart; `/api/health` → `status:"ok"`, 2,616 events, **200** tailer files watched; :3000 + :4318 listening; native and OTLP unauthenticated POSTs → 401 |

This pass updates the document's prose and generated inventory from the live
checkpoint, removes four already-closed beads from the inventory, and records
the stale digest implementation children separately from genuine test and
readiness gaps. The non-zero readiness result is retained as evidence that the
phase is not yet operationally complete.

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
fabric-9ca2871c (2026-09-27/28 refresh) — CLOSED 2026-09-28 (epoch-3/4 refresh landed 659bff3)
fabric-301ad288 (live-inventory reconciliation draft) — CLOSED as superseded by fabric-cb4e1df8 (same scope; work landed once)
fabric-cb4e1df8 (status reconciliation + repeatable refresh check) — CLOSED
fabric-14247d59 (live-checkpoint reconciliation — this pass) — IN_PROGRESS while closure is pending
fabric-ff926483 (production-readiness reconciliation) — CLOSED
├── fabric-931136a0 (tui --source busy-loop) — open BUG, root-caused (failure-count:4)
│   ├── fabric-0386d35e (diagnosis umbrella — substance complete, close on the note)
│   │   ├── fabric-675ead93 / fabric-cdbc3e3a / fabric-d541b07d (note-audit children) — open
│   │   └── fabric-ac34599b (repro-script hardening) + fabric-b58f7e44 (repro note) — open
│   ├── fabric-de6275b2 (watcher fix) — open
│   ├── fabric-6d914c4c (regression gate) — open
│   └── fabric-92a4b7cb (heartbeat liveness) — open FEATURE
├── fabric-c0e278ee (AlertManager dedup enforcement) — CLOSED 2026-09-28 (2b27660)
├── fabric-32fe329b (digest --source) — CLOSED 2026-09-28 (code landed: 52640c8, 35b44b5, fd6c1de; children remain for verification)
├── fabric-e91edf0c (digest AI implementation) — CLOSED 2026-09-28 (code landed: 66ee920); fabric-f511a390 remains the maintenance owner
├── fabric-166beca4 (web outage) — CLOSED 2026-09-14 (service live, re-verified 2026-09-28)
├── fabric-de6a9f72 (r/R conflict) — CLOSED (b1e8567, a707ec86)
├── fabric-6dafdf52 (TUI view-state contracts) — CLOSED 2026-09-27 (batch in committed baseline)
└── verification & coverage hardening cluster (~64 beads) — open
    ├── fabric-13164cdc (CLI operational options incl. --max-events contracts)
    ├── fabric-c0413489 / fabric-2f9fd906 (FileHeatmap behavior contracts) — CLOSED 2026-09-28
    ├── fabric-becb1ab0 (documented TUI view machine — completion)
    ├── fabric-ac301879 / fabric-8402deda / fabric-ade0e71c / fabric-d1e3d354 (alert/smoke weave batch) — ALL CLOSED 2026-09-28
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

2. **Keep landed implementation beads out of the feature-gap count.**
   `fabric-32fe329b` and `fabric-e91edf0c` are now closed with verification
   evidence; their remaining children are coverage/documentation work, while
   `fabric-f511a390` remains the narrowly scoped maintenance owner. No replacement
   implementation ownership should be created.

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
- scripts/gap-inventory-check.mjs — repeatable status-refresh/check (§0), landed in the closed `fabric-cb4e1df8` pass
- tests/gapInventoryCheck.test.ts — fixture coverage for the checker and structural lint of this document
- scripts/production-readiness-check.mjs — fail-closed live service, listener, auth, retention, and owner gate
- tests/productionReadinessCheck.test.ts — isolated passing/blocking gate scenarios
- Bead store checkpoint: **93 open + 1 in_progress of 455** as of 2026-09-29 00:01 UTC, machine-read by `scripts/gap-inventory-check.mjs`; lineage beads `fabric-0c9aeb03`, `fabric-bd06ee99`, `fabric-166beca4`, `fabric-de6a9f72`, `fabric-aa4751af`, `fabric-6dafdf52`, `fabric-c0e278ee`, `fabric-c0413489`, `fabric-2f9fd906`, `fabric-2fd06cd1`/`fabric-f05a227a`/`fabric-b7b48295`, `fabric-9ca2871c`, `fabric-85212f76`, `fabric-14554e53`, `fabric-0538da5f`, `fabric-9c04e80b`, `fabric-e593b9ce`, `fabric-8ffe1cb9`, `fabric-cb4e1df8`, `fabric-ff926483`, `fabric-ac301879`, `fabric-8402deda`, `fabric-ade0e71c`, `fabric-d1e3d354`, `fabric-08706085`, `fabric-dddac75c`, `fabric-e1f86a53`, `fabric-dd0432e9`, `fabric-32fe329b`, `fabric-e91edf0c` confirmed closed
- Doc-vs-store status sweep: now **mechanical** — scripts/gap-inventory-check.mjs `--check` compares the generated inventory block against the store in both directions and lints every `fabric-*` id cited in this document; exit 0 at this refresh
- Code/commit claims re-verified: src/cli.ts digest `--source` declaration (:778), `resolveFromOptions` (:96), `DirectoryTailer` construction (:826); src/web/server.ts overload responses (:342/:379) and 3-strike liveness guard (:2137-2143); src/digestAi.ts present; busy-loop WIP patch (91,645 bytes); all 10 cited commits resolve (`52640c8`, `35b44b5`, `fd6c1de`, `66ee920`, `890f3ae`, `0f8363b`, `14e96e0`, `2b27660`, `0044710`, `b1e8567`)
- Live service: `systemctl --user is-active fabric-web.service` (active after required restart), `GET /api/health` (`status:"ok"`, 2,616 events, 200 tailer files watched), `ss -tlnp` (:3000, :4318); native and OTLP unauthenticated POST probes both returned 401
- Verification: `npx tsc --noEmit` (exit 0), `npx vitest run` (exit 0), `npm test` (exit 0), `npm run build` (exit 0), `npm run build:web` (exit 0), `node scripts/gap-inventory-check.mjs --check` (exit 0), `node scripts/gap-inventory-check.mjs --lint-doc` (exit 0), and `npm run readiness:check` (exit 1, expected live gate block) — results recorded above for this pass

---

## Conclusion

FABRIC is **feature-complete against plan.md Phases 1–9** and the ADR-1 multi-host
collector architecture. The 2026-03-07 implementation gap list is **fully
resolved: 12/12 gaps closed**, each traceable to a closed `fabric-*` successor
bead and a verified implementation file on `main`. This does not make the web
display production-ready: the live gate in §0a must pass separately.

Reconciled against the open bead store on 2026-09-28 under `fabric-14247d59`
(following the closed `fabric-cb4e1df8` pass and its superseded duplicate
`fabric-301ad288`), what actually
remains is:

1. **One open product bug:** the TUI directory-source busy-loop
   (`fabric-931136a0`) — root-caused, fix + regression gate pending.
2. **One small missing feature:** heartbeat liveness collapse (`fabric-92a4b7cb`).
3. **A large verification/coverage hardening frontier** (~64 small contract-test
   beads) — including the maxEvents contracts, whose enforcement itself is
   already implemented. (The 2026-09-28T03:38 alert/smoke weave batch that this
   section previously counted as open is fully closed — §3a.)
4. **Bookkeeping closures** (digest `--source` and digest-AI beads whose code
   already landed).
5. **Resolved and on record:** the web dashboard outage remediation
   (`fabric-166beca4`, closed 2026-09-14; service liveness re-verified live
   2026-09-28), the `r`/`R` shortcut conflict
   (`fabric-de6a9f72`), the alert-dedup policy gap (`fabric-c0e278ee`, closed
   2026-09-28 via `2b27660`), the TUI view-state contract batch
   (`fabric-6dafdf52`, closed 2026-09-27), the FileHeatmap behavior-contract pair
   (`fabric-c0413489` / `fabric-2f9fd906`, closed 2026-09-28), the
   clean-install smoke / release-gate cluster (`fabric-2fd06cd1` + children,
   closed), the original gap-analysis bead and the events / batch-ingestion /
   authentication lineages (`fabric-0c9aeb03`, `fabric-85212f76`,
   `fabric-14554e53`, `fabric-0538da5f`, `fabric-9c04e80b`, `fabric-e593b9ce` —
   all store-verified closed, §3a), and this document's own refresh lineage
   (`fabric-9ca2871c` and `fabric-cb4e1df8` closed; `fabric-301ad288` closed as
   superseded by `fabric-cb4e1df8`).

Unlike earlier editions, this reconciliation is not a hand-asserted snapshot:
`scripts/gap-inventory-check.mjs` (§0) re-verifies the inventory against the
bead store on every run, and `tests/gapInventoryCheck.test.ts` keeps the tool —
and this document's structural honesty — pinned in the test suite. Every
outstanding item above is linked to exactly one owning bead, and the
2026-09-26 edition's last stale claim — digest lacking directory-tail support —
is corrected: the resolver layer now backs `tui`, `web`, `tail`, `replay`, and
`digest` alike. The separate production gate is intentionally still blocking on
retention/pruning evidence and unresolved OTLP owner work, so this document does
not declare Phase 3 operationally complete.
