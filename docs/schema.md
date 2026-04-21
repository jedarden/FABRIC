# NeedleEvent Schema

**schema-version: 1** — shared contract between NEEDLE and FABRIC.

Both projects must agree on this version. NEEDLE emits `schema_version` in its
output; FABRIC asserts compatibility during parse via `NEEDLE_EVENT_SCHEMA_VERSION`
in `src/types.ts`. If the values diverge, `parseNeedleEvent` throws.

## Wire Format

Every event emitted by NEEDLE — over JSONL and OTLP logs — conforms to this
shape:

```json
{
  "schema_version": 1,
  "timestamp": "2026-04-21T11:20:19.962811515Z",
  "event_type": "worker.started",
  "worker_id": "tcb-alpha",
  "session_id": "d7261357",
  "sequence": 1,
  "bead_id": "bd-abc123",
  "data": {}
}
```

## Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schema_version` | `number` | recommended | Protocol version. Present in newer NEEDLE output; FABRIC asserts it when present. |
| `timestamp` | `string` | **yes** | RFC3339 timestamp. Display only — **not** authoritative for ordering. |
| `event_type` | `string` | **yes** | Taxonomy string from the event taxonomy table below. |
| `worker_id` | `string` | **yes** | Worker identifier (e.g. `"tcb-alpha"`). |
| `session_id` | `string` | **yes** | Groups a worker's lifetime events into a single session. |
| `sequence` | `number` | **yes** | Per-worker monotonic counter. Authoritative for ordering within a worker. |
| `bead_id` | `string` | no | Present when the event pertains to a specific bead. |
| `data` | `object` | **yes** | Event-specific payload (see taxonomy table for notable fields). May be empty `{}`. |

## Ordering Contract

Sort events by **`(worker_id, sequence)`**, not by `timestamp`.

Wall clocks skew across hosts. `sequence` is the worker's own monotonic counter
and is the only reliable basis for replay and timeline reconstruction within a
single worker. To interleave events from multiple workers, merge-sort on
`sequence` within each `worker_id` partition, then order across partitions by
`timestamp` as a tiebreaker.

## Event Taxonomy

Format: `category.action`. Categories group related lifecycle phases.

### Worker Lifecycle

| `event_type` | Description | Notable `data` fields |
|---|---|---|
| `worker.started` | Worker boot | `version`, `worker_name` |
| `worker.idle` | Worker is idle, waiting for work | — |
| `worker.stopped` | Worker exit | `reason` |
| `worker.draining` | Worker is draining before shutdown | — |

### Bead Lifecycle

| `event_type` | Description | Notable `data` fields |
|---|---|---|
| `bead.claimed` | Bead claim succeeded | `bead_id` |
| `bead.prompt_built` | Prompt constructed for agent | `bead_id` |
| `bead.agent_started` | Agent began working on bead | `bead_id` |
| `bead.agent_completed` | Agent finished working on bead | `bead_id`, `duration_ms` |
| `bead.completed` | Bead work fully completed | `bead_id`, `duration_ms` |
| `bead.failed` | Bead work failed | `bead_id`, `error` |
| `bead.released` | Bead released back to queue | `bead_id` |
| `bead.claim_retry` | Claim attempt will be retried | `bead_id`, `attempt` |
| `bead.claim_exhausted` | All claim retries exhausted | `bead_id` |

### Bead Mitosis

| `event_type` | Description | Notable `data` fields |
|---|---|---|
| `bead.mitosis.check` | Checking if bead should split | `bead_id` |
| `bead.mitosis.started` | Mitosis began | `bead_id` |
| `bead.mitosis.child_created` | Child bead created | `bead_id`, `child_id` |
| `bead.mitosis.complete` | Mitosis finished | `bead_id` |
| `bead.mitosis.failed` | Mitosis failed | `bead_id`, `error` |
| `bead.mitosis.skipped` | Mitosis skipped (not needed) | `bead_id` |

### Strand Lifecycle

| `event_type` | Description | Notable `data` fields |
|---|---|---|
| `strand.started` | Strand execution began | `strand` |
| `strand.completed` | Strand execution finished | `strand`, `duration_ms` |
| `strand.fallthrough` | Strand found no work | `strand` |
| `strand.skipped` | Strand was skipped | `strand`, `reason` |

### Hook Lifecycle

| `event_type` | Description | Notable `data` fields |
|---|---|---|
| `hook.started` | Hook execution began | `hook` |
| `hook.completed` | Hook execution finished | `hook`, `duration_ms` |
| `hook.failed` | Hook execution failed | `hook`, `error` |

### Heartbeat

| `event_type` | Description | Notable `data` fields |
|---|---|---|
| `heartbeat.emitted` | Periodic heartbeat | `status` |
| `heartbeat.stuck_detected` | Worker appears stuck | `worker_id`, `since` |
| `heartbeat.recovery` | Worker recovered from stuck state | `worker_id` |

### Mend (Maintenance)

| `event_type` | Description | Notable `data` fields |
|---|---|---|
| `mend.orphan_released` | Orphaned bead released | `bead_id` |
| `mend.heartbeat_cleaned` | Stale heartbeat cleaned | `worker_id` |
| `mend.logs_pruned` | Old logs pruned | `bytes_freed` |
| `mend.completed` | Mend cycle finished | `duration_ms` |

### Unravel (Alternatives)

| `event_type` | Description | Notable `data` fields |
|---|---|---|
| `unravel.alternatives_created` | Alternative beads created | `parent_bead_id`, `count` |
| `unravel.alternative_created` | Single alternative bead created | `parent_bead_id`, `child_bead_id` |
| `unravel.analysis_started` | Alternatives analysis began | `bead_id` |
| `unravel.analysis_completed` | Alternatives analysis finished | `bead_id`, `duration_ms` |

### Weave (Documentation Gaps)

| `event_type` | Description | Notable `data` fields |
|---|---|---|
| `weave.bead_created` | Documentation gap bead created | `bead_id`, `file`, `line` |
| `weave.analysis_started` | Documentation analysis began | — |
| `weave.analysis_completed` | Documentation analysis finished | `gaps_found`, `duration_ms` |

### Pulse (Health Monitoring)

| `event_type` | Description | Notable `data` fields |
|---|---|---|
| `pulse.bead_created` | Health issue bead created | `bead_id`, `detector` |
| `pulse.scan_started` | Health scan began | — |
| `pulse.scan_completed` | Health scan finished | `issues_found`, `duration_ms` |
| `pulse.issue_detected` | Specific issue found | `detector`, `severity` |
| `pulse.detector_started` | Individual detector started | `detector` |
| `pulse.detector_completed` | Individual detector finished | `detector`, `duration_ms` |

### Error Events

| `event_type` | Description | Notable `data` fields |
|---|---|---|
| `error.claim_failed` | Bead claim failed | `bead_id`, `error` |
| `error.agent_crash` | Agent process crashed | `bead_id`, `error`, `exit_code` |
| `error.timeout` | Operation timed out | `bead_id`, `duration_ms` |
| `error.release_failed` | Bead release failed | `bead_id`, `error` |

### Effort & Budget

| `event_type` | Description | Notable `data` fields |
|---|---|---|
| `effort.recorded` | Effort measurement recorded | `bead_id`, `tokens`, `cost` |
| `budget.warning` | Budget approaching limit | `used`, `limit`, `percentage` |
| `budget.exceeded` | Budget exceeded | `used`, `limit` |
| `budget.per_bead_exceeded` | Per-bead budget exceeded | `bead_id`, `used`, `limit` |

### File Locks

| `event_type` | Description | Notable `data` fields |
|---|---|---|
| `file.checkout` | File checked out for editing | `path` |
| `file.conflict` | File conflict detected | `path`, `workers` |
| `file.release` | File lock released | `path` |
| `file.stale` | Stale file lock detected | `path` |
| `lock.priority_bump` | Lock priority bumped | `path`, `worker_id` |
| `lock.priority_bump_received` | Received priority bump notification | `path`, `from_worker` |
| `lock.expired` | Lock expired | `path` |

## OTLP Metric Instruments

When NEEDLE workers emit OTLP **Metric** payloads (Sum, Histogram, Gauge), FABRIC
normalizes each data point into a `metric.{name}` event (see normalizer). The
canonical instrument names below define the mapping to analytics DB columns in
`fabric.db`.

FABRIC's Analytics Writer **prefers** OTLP metric values over log-derived
estimates when both are present for the same worker + session.

### Token & Cost Instruments

| Instrument Name | Type | Unit | DB Column(s) |
|---|---|---|---|
| `needle.worker.tokens.in` | Sum | tokens | `task_metrics.tokens_in`, `session_worker_summaries.tokens_in` |
| `needle.worker.tokens.out` | Sum | tokens | `task_metrics.tokens_out`, `session_worker_summaries.tokens_out` |
| `needle.worker.cost.usd` | Sum | USD | `task_metrics.cost`, `session_worker_summaries.cost_usd` |

### Duration Instruments

| Instrument Name | Type | Unit | DB Column(s) |
|---|---|---|---|
| `needle.bead.duration` | Histogram | ms | `task_metrics.duration_ms` |
| `needle.worker.uptime` | Gauge | ms | — (informational) |

### Counting Instruments

| Instrument Name | Type | Unit | DB Column(s) |
|---|---|---|---|
| `needle.bead.completed` | Sum | count | `session_worker_summaries.beads_completed` |
| `needle.bead.failed` | Sum | count | `session_worker_summaries.beads_failed` |
| `needle.worker.errors` | Sum | count | `session_worker_summaries.errors` |

### Attribute Requirements

Every metric data point **must** carry these OTLP attributes (namespaced form
preferred, plain form accepted as fallback):

| Attribute | Required | Purpose |
|---|---|---|
| `needle.worker.id` / `worker_id` | yes | Worker identity |
| `needle.session.id` / `session_id` | yes | Session grouping |
| `needle.bead.id` / `bead_id` | for bead-scoped metrics | Task correlation |

### Resolution Order

When querying `fabric.db`, FABRIC resolves conflicting values in this order:

1. **`otlp-metric`** — row sourced from an OTLP metric instrument (authoritative)
2. **`otlp-span`** — duration derived from span start/end times
3. **`log-derived`** — estimated from log message parsing (fallback)

The `metrics_source` column on `sessions` and `session_worker_summaries` records
which source was used.

## TypeScript Reference

The canonical TypeScript definitions live in `src/types.ts`:

- `NeedleEvent` — the wire-schema interface
- `NeedleEventType` — union of all known `event_type` strings
- `NEEDLE_EVENT_SCHEMA_VERSION` — the current protocol version constant

The parser in `src/parser.ts` validates incoming events against the schema and
throws on version mismatch. Legacy `LogEvent` is retained as an adapter for
backward compatibility with existing UI consumers.
