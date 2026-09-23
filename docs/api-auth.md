# FABRIC API Authorization Policy

Single source of truth for which FABRIC HTTP endpoints require authentication.

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

The invariant is pinned by the sweep test in `src/web/server.test.ts`
(`describe('Auth policy consistency: every POST endpoint is gated')`), which
asserts every route in the inventory below answers `401` without a header and
`403` with a wrong token. If you add a POST route, add it to that sweep's
`postRoutes` list.

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

## Route inventory (complete, as of 2026-09)

Every `POST` route registered by `src/web/server.ts`:

| Route | What it mutates |
|---|---|
| `POST /api/events` | Ingests a NEEDLE event into the store |
| `POST /api/events/batch` | Ingests a batch of NEEDLE events |
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
