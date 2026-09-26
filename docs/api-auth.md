# FABRIC API Authorization Policy

Single source of truth for which FABRIC HTTP endpoints require authentication.
For the event-ingestion endpoints specifically, the canonical payload,
validation, batching, and limits reference is `docs/events-api.md`.

## The policy

One rule, applied uniformly — there are no per-route exceptions:

> **Every `POST` endpoint requires `Authorization: Bearer <FABRIC_AUTH_TOKEN>`
> when a token is configured. Every `GET` endpoint is open — read-only, no
> secret data.**

This includes every memory-mutation route. `POST /api/memory/trend/save` is
authenticated exactly like `POST /api/memory/heap-snapshot`; nothing about the
memory endpoints is special.

## Enforcement

Enforcement lives in exactly one place: the global auth middleware in
`createWebServer()` (`src/web/server.ts`), registered **before** every route —
including the OTLP/HTTP receiver (`/v1/logs`, `/v1/traces`, `/v1/metrics`) —
and both HTTP listeners (the main port and the optional `--otlp-http` port)
wrap the same Express app, so the middleware applies to both.

Consequences of this design:

- **No route implements its own auth check.** An earlier duplicate inline
  check on `POST /api/retention/prune` was removed for exactly this reason —
  it answered `401` where the policy answers `403` for a wrong token.
- **New POST routes are protected by default** the moment they are
  registered. There is no opt-in step to forget.
- **Rejection happens before body parsing and before any handler runs**, so
  an unauthorized request has no side effects: no heap snapshot written, no
  theme persisted, no events ingested, no baseline captured.

The invariant is pinned by route-discovery contract tests, not a
hand-maintained list: `WebServer.getPostRoutePatterns()` (in
`src/web/server.ts`) walks the live Express router — including the mounted
OTLP receiver — and the suites sweep exactly that inventory.
`src/web/server.authRoutes.test.ts` is the full contract: every discovered
POST route on **both HTTP listeners**, for 401 (no header), 403 (wrong
token), valid-token pass-through, **unset-token mode** (no token configured
→ every POST passes on both listeners and handlers really run), and
**malformed bodies** (a valid token + malformed JSON dies at the parse layer
— `400` from body-parser on `/api/*`, the receiver's decode failure on
`/v1/*` — with no handler side effect), plus rejection-before-side-effects
(no events or OTLP records ingested, no theme persisted, no prune attempt
recorded). The `Auth policy consistency` describe in `src/web/server.test.ts`
re-sweeps the discovered routes for 401/403. If you add a POST route it is
covered automatically the moment it is registered — there is no list to
update. The table below is descriptive documentation only; the router is the
source of truth.

## OTLP/gRPC receiver (`--otlp-grpc`)

The gRPC transport carries the same policy, expressed in gRPC terms
(`src/otlpGrpcReceiver.ts`). When a token is configured, every Export call —
`LogsService/Export`, `TraceService/Export`, `MetricsService/Export` — must
present `authorization: Bearer <FABRIC_AUTH_TOKEN>` **metadata**; anything
else is rejected with gRPC status `UNAUTHENTICATED` (16) before any record is
decoded or ingested, so an unauthorized call has no side effects. NEEDLE's
`telemetry.otlp_sink.headers` already sends this header for OTLP/HTTP and the
same header works as gRPC metadata.

Two scope notes:

- The token is wired for `fabric web` only — it is the one command with an
  auth model (`--auth-token` / `FABRIC_AUTH_TOKEN`). The `tui` and `tail`/
  `logs` commands have no token concept, and their `--otlp-grpc` receiver —
  like their standalone OTLP/HTTP listener — stays open.
- With no token configured the gRPC receiver accepts unauthenticated calls,
  exactly mirroring unset-token mode on the HTTP side.

The contract is pinned end-to-end by `src/otlpGrpcE2E.integration.test.ts`:
missing metadata, wrong token, and correct token per service, plus
rejection-before-ingestion and open-receiver back-compat.

## Token configuration

| Source | How |
|--------|-----|
| Environment variable | `FABRIC_AUTH_TOKEN=<token> fabric web` |
| CLI flag | `fabric web --auth-token <token>` |
| systemd unit | `EnvironmentFile=` entry in `~/.config/fabric/secrets.env` (`FABRIC_AUTH_TOKEN`, mode 600) |

**When no token is configured, all POST requests are accepted without
authentication.** That mode is intended for local-only use; anything bound to
an interface beyond localhost should run with a token (Tailscale gates *who
can connect*, the token gates *what they may mutate* — the two are not
substitutes).

## Status codes

| Situation | Status | Body |
|---|---|---|
| No `Authorization` header | `401` | `{"error": "Missing authorization", "message": "Authorization header required"}` |
| Header is not `Bearer <token>`, or token is wrong | `403` | `{"error": "Forbidden", "message": "Invalid or expired token"}` |
| Valid token | — | Request proceeds to the handler |

## Route inventory (descriptive, as of 2026-09)

Every `POST` route `src/web/server.ts` currently registers — derived from
`getPostRoutePatterns()`, so the test sweeps track this table automatically:

| Route | What it mutates |
|---|---|
| `POST /api/events` | Ingests a NEEDLE event into the store — payload, validation, batching, and limits documented in `docs/events-api.md` |
| `POST /api/events/batch` | Ingests a batch of NEEDLE events (same contract, array body; `docs/events-api.md`) |
| `POST /api/retention/prune` | Archives/deletes NEEDLE log files (unless `dryRun: true`) |
| `POST /api/retention/controls` | Appends a pre-signed tombstone or legal-hold record |
| `POST /api/retention/tombstones` | Appends a pre-signed occurrence tombstone |
| `POST /api/retention/holds` | Appends a pre-signed legal-hold record |
| `POST /api/theme` | Persists the dashboard theme to `~/.fabric/theme.json` |
| `POST /api/memory/capture` | Records a memory snapshot (profiler state) |
| `POST /api/memory/baseline` | Sets the memory baseline used by `GET /api/memory/diff` |
| `POST /api/memory/heap-snapshot` | Writes a V8 heap snapshot to `~/.needle/snapshots/` |
| `POST /api/memory/trend/save` | Writes a trend report to `~/.needle/snapshots/reports/` |
| `POST /api/cost/alerts/:id/acknowledge` | Marks a cost alert acknowledged |
| `POST /v1/logs`, `POST /v1/traces`, `POST /v1/metrics` | OTLP/HTTP ingestion |

All other routes are `GET` and intentionally open. The memory endpoints are
also documented, with their auth, in `docs/heap-snapshot-retention.md`.

Retention controls are append-only and stored outside the raw log directory.
They must already be signed by the tenant authority; the raw `POST /api/events`
ingestion path cannot create or delete a control record. FABRIC intentionally
does not expose a `DELETE` event or control route. An active legal hold wins
over both a tombstone and any age-based prune policy. With no explicit prune
window, retention is indefinite.

## Verifying

```bash
export FABRIC_AUTH_TOKEN=...   # e.g. source ~/.config/fabric/secrets.env

# 401 — no header
curl -i -X POST http://localhost:3000/api/memory/trend/save

# 403 — wrong token (literal placeholder, not a credential — gitleaks:allow)
curl -i -X POST http://localhost:3000/api/memory/trend/save \
  -H 'Authorization: Bearer wrong-token' # gitleaks:allow

# 200 — valid token
curl -i -X POST http://localhost:3000/api/memory/trend/save \
  -H "Authorization: Bearer $FABRIC_AUTH_TOKEN"

# GETs are open
curl -i http://localhost:3000/api/memory/trend
```
