# FABRIC Event Ingestion API

Canonical reference for FABRIC's native JSON event-ingestion endpoints:
`POST /api/events` (single event) and `POST /api/events/batch` (batched
events). Payload, validation, limits, responses, and side effects for both.

These are the endpoints NEEDLE's `fabric.endpoint` setting pushes to. They
are the *native JSON* ingestion path — the OTLP/HTTP receiver
(`POST /v1/logs`, `/v1/traces`, `/v1/metrics` on the `--otlp-http` listener)
is a separate protobuf path documented in `docs/otlp-config.md`. Both paths
normalize into the same `NeedleEvent` wire format (`docs/schema.md`) and land
in the same store.

Implementation: `src/web/server.ts` (route handlers), `src/normalizer.ts`
(`normalizeToLogEvent` with the `jsonl` source). The endpoints are pinned by
the `POST /api/events` and `POST /api/events/batch` describes in
`src/web/server.test.ts`.

## Authentication

Both routes are `POST`, so both sit under the global auth policy
(`docs/api-auth.md`): with a token configured, every request must carry
`Authorization: Bearer <FABRIC_AUTH_TOKEN>`. There is no per-route variation.

| Situation | Status | Body |
|---|---|---|
| No `Authorization` header | `401` | `{"error": "Missing authorization", "message": "Authorization header required"}` |
| Header is not `Bearer <token>`, or token is wrong | `403` | `{"error": "Forbidden", "message": "Invalid or expired token"}` |
| No token configured (unset-token mode) | — | Accepted without authentication |

The middleware is registered before the JSON body parser, so a rejected
request is answered **before the body is read or any handler runs** — an
unauthorized submission never ingests an event or touches metrics.

## Transport limits (both routes)

- Bodies are parsed by `express.json({ limit: "65536" })` — **64 KiB per
  request**, for the single route and the batch route alike.
- A body larger than the cap is rejected by body-parser with `413` before
  the handler runs.
- Malformed JSON is rejected by body-parser with `400`, also before the
  handler runs. (Both pinned for `/api/*` by `src/web/server.authRoutes.test.ts`.)
- `Content-Type: application/json` is required; without a parseable body the
  handler sees no body and answers `400` (see validation below).

## `POST /api/events` — single event

### Payload

One JSON object. Two fields are required and checked before normalization:

| Field | Type | Required | Notes |
|---|---|---|---|
| `ts` | string (RFC3339) **or** number (epoch ms) | **yes** (truthy) | Which shape selects the wire format, below |
| `event` | string | **yes** (truthy) | Event taxonomy string, e.g. `"worker.started"` |

Everything else depends on which of the normalizer's accepted wire shapes the
body matches (`src/normalizer.ts`, `jsonl` source):

1. **NEEDLE JSONL log entry** — `ts` is an RFC3339 string, `event` a string,
   `worker` either a string or an object
   `{runner, provider, model, identifier}` (composed into
   `runner-provider-model-identifier`). Optional: `level`, `session`,
   `data` (object), `bead_id` inside `data` (promoted to the event's bead).
2. **Legacy flat entry** — `ts` is an epoch-milliseconds number, `worker` a
   string, `level` one of `debug|info|warn|error`, `msg` a string. Any other
   top-level fields are carried through as event data.
3. **Canonical NeedleEvent** (`docs/schema.md` wire format) is parseable by
   the same normalizer, but the required `ts`/`event` pair gates it: a
   canonical-only body (with `timestamp`/`event_type` but no `ts`/`event`)
   is rejected `400` at the pre-check. A body carrying *both* the
   `ts`/`event` pair and the full canonical fields is parsed as canonical —
   the canonical fields win and the `ts`/`event` pair is ignored.

`host` defaults to the collector's own hostname for shapes 1 and 2 (FABRIC
tags the event with where *it* runs); only a canonical body (shape 3)
carries an explicit `host`, which is how multi-host fleets keep events
distinguishable.

### Validation and error responses

Checked in order; the first failure answers and the handler stops:

| Status | Body | Cause |
|---|---|---|
| `400` | `{"error": "Invalid request body", "message": "Expected JSON object"}` | Body missing or not a JSON object (no/unknown `Content-Type`, JSON `null`) |
| `400` | `{"error": "Missing required field", "message": "Field \"ts\" is required"}` | `ts` absent or falsy (an array body fails here) |
| `400` | `{"error": "Missing required field", "message": "Field \"event\" is required"}` | `event` absent or falsy |
| `400` | `{"error": "Invalid event format", "message": "Failed to parse event object"}` | Body has `ts` + `event` but matches no accepted wire shape (e.g. numeric `ts` with object `worker`, or an invalid `level` in the flat shape) |
| `500` | `{"error": "Internal server error", "message": "…"}` | Catch-all. Reachable from ingestion via a canonical-shaped body with a `schema_version` other than `1` — the normalizer throws on version mismatch (`docs/schema.md`) |

### Success response — `201`

```json
{
  "success": true,
  "event": {
    "ts": 1773035639517,
    "worker": "claude-code-test",
    "level": "info",
    "msg": "bead.claimed",
    "session": "needle-claude-test",
    "bead": "bd-123",
    "host": "codinghome"
  }
}
```

`event` is the normalized `LogEvent` (see `docs/schema.md` for the full
field set): `msg` is the event type; `level` is the explicit level when
valid, otherwise inferred from the event name (`error.*` → `error`,
`*.failed`/`*.retry` → `warn`, `debug.*` → `debug`, else `info`); `sequence`
is present only for canonical bodies (JSONL/flat entries have none).

### Side effects (201 only)

- `store.add` — in-memory store + SQLite persistence; feeds `/api/workers`,
  `/api/summary`, analytics, and every connected dashboard.
- `metrics.recordEvent` — event count, ingest rate, per-host counters.
- Broadcast to all connected WebSocket clients.
- **No deduplication on this route** — the deduplicator exists on the
  log-tailing path only; every accepted POST is stored.

## `POST /api/events/batch` — batched events

### Payload

A JSON **array** of event objects, each validated by the same rules as the
single route.

### Batch-level limits

| Status | Body | Cause |
|---|---|---|
| `400` | `{"error": "Invalid request body", "message": "Expected JSON array of events"}` | Body is not an array (an object body, a bare number, `null`) |
| `400` | `{"error": "Empty batch", "message": "Batch must contain at least one event"}` | `[]` |
| `400` | `{"error": "Batch too large", "message": "Batch exceeds maximum size of 100 events (received N)"}` | More than `MAX_BATCH_SIZE` (100) events |

The 64 KiB body cap applies to the whole array. With 100 events permitted,
an average event must stay under roughly 650 bytes — send more batches
rather than larger ones.

### Partial success — invalid events don't sink the batch

Unlike the single route, per-event validation failures are **collected, not
fatal**: valid events are ingested, and each rejected one contributes an
`{index, error}` entry (0-based position in the submitted array). Rejection
strings: `Invalid event object`, `Missing required field "ts"`,
`Missing required field "event"`, `Failed to parse event object`.

### Success response — `201`

```json
{
  "success": true,
  "ingested": 2,
  "total": 3,
  "errors": [
    {"index": 1, "error": "Missing required field \"ts\""}
  ]
}
```

`errors` is omitted when every event was accepted. Even a batch whose every
event failed answers `201` (with `ingested: 0` and the errors listed) — the
request itself was well-formed; only the responses above are batch-level
failures. Ingested events are stored, counted, and broadcast exactly as in
the single route, with broadcasts flushed after the loop.

## Error-response summary

| Status | When | Which route |
|---|---|---|
| `401` / `403` | Missing / wrong bearer token (both routes, before body parse) | both |
| `400` | Malformed JSON (body-parser) | both |
| `413` | Body over 64 KiB (body-parser) | both |
| `400` | Batch-level / field-level validation failures (tables above) | both |
| `201` | Accepted — fully (`ingested == total`) or partially | both |
| `500` | Handler exception, incl. `schema_version` mismatch on a canonical body | both |

## Append-only by design

There is intentionally no event-deletion API:
`DELETE /api/events` (and any `DELETE` under `/api/events`) answers
`405 {"error": "Event deletion is not supported"}`. Raw ingestion cannot
create or remove retention controls either — that is the separate signed
control plane described in `docs/api-auth.md`.

## Reading events back

`GET /api/events` is open (read-only, no auth) and returns the most recent
events, oldest first, tail-limited:

| Query param | Default | Meaning |
|---|---|---|
| `limit` | `100` | Return at most this many (tail of the matching set) |
| `worker` | — | Filter to one worker id |
| `level` | — | Filter to `debug`/`info`/`warn`/`error` |

Live consumers get the same events pushed over WebSocket instead of polling.

## Examples

```bash
export FABRIC_AUTH_TOKEN=...   # e.g. source ~/.config/fabric/secrets.env

# Single event (NEEDLE JSONL shape)
curl -i -X POST http://localhost:3000/api/events \
  -H "Authorization: Bearer $FABRIC_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ts":"2026-09-26T12:00:00.000Z","event":"worker.started","worker":"w-alpha"}'

# Batch
curl -i -X POST http://localhost:3000/api/events/batch \
  -H "Authorization: Bearer $FABRIC_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[{"ts":"2026-09-26T12:00:01.000Z","event":"bead.claimed","worker":"w-alpha","data":{"bead_id":"bd-1847"}},
       {"ts":1773035639517,"worker":"w-bravo","level":"info","msg":"Task complete"}]'

# Read back (open)
curl -s 'http://localhost:3000/api/events?limit=10&level=error'
```
