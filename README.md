# FABRIC

**Flow Analysis & Bead Reporting Interface Console**

A live display for NEEDLE worker activity, available as TUI or web dashboard.

NEEDLE is an AI agent fleet orchestrator that dispatches parallel Claude Code workers to complete software tasks. FABRIC is NEEDLE's observability layer.

## Purpose

FABRIC tails NEEDLE's logging output and renders it in real-time. It answers:

- What is each worker doing right now?
- What events are happening across all workers?
- Which workers are active, idle, or erroring?
- Is any worker stuck or looping?
- Are workers colliding on the same files?
- How much is this costing?

## Display Modes

### TUI (`fabric tui`)

Live terminal dashboard:
- Worker status grid
- Scrolling log stream
- Worker detail panel
- Keyboard navigation and filtering

### Web (`fabric web`)

Live browser dashboard at `localhost:3000`:
- Worker overview cards
- Real-time activity feed
- Timeline visualization
- WebSocket-powered updates

## Installation

```bash
# Install from npm
npm install -g @needle/fabric

# Or clone and build from source (canonical repository — see below)
git clone https://git.ardenone.com/jedarden/FABRIC.git
cd FABRIC
npm install
npm run build
npm run build:web
```

### Source repository

The canonical repository is **Forgejo**: `https://git.ardenone.com/jedarden/FABRIC`. Clone from it, and push to it — `origin` points there, and all development commits land on `main`.

The GitHub repository (`github.com/jedarden/FABRIC`) is a **read-only mirror**, kept in sync automatically by Forgejo's server-side push mirror on every commit. The canonical workflow:

- Clone and push against Forgejo (`origin`); never set up client-side dual-push to GitHub — the mirror is updated server-side.
- Never force-push (`--force` / `--force-with-lease`). If Forgejo and the mirror ever diverge, reconcile with a merge commit.
- GitHub issues/PRs are accepted as a convenience, but changes themselves are made on Forgejo.

### Verifying the installation (smoke test)

`npm run smoke:clean-install` (or `scripts/smoke-clean-install.sh`) validates both
documented installation paths end-to-end in a clean room — a fresh `git archive`
of `HEAD`, an empty install directory, and a sandboxed `$HOME` with no
`~/.needle/`:

1. **Source build** — the README clone-and-build commands (`npm install`,
   `npm run build`, `npm run build:web`) and checks the generated artifacts
   (`dist/cli.js` with its shebang, `dist/web/public/` hashed bundles).
2. **npm install** — `npm pack` (the package ships `dist/` via the `files`
   whitelist and rebuilds it via `prepack`), then installs the tarball into an
   empty project, approximating `npm install -g @needle/fabric` without
   touching the global prefix. Checks the `fabric` bin link plus the
   `--version` / `--help` contract.
3. **Runtime smoke** — every command `fabric --help` documents, exercised
   against the repo's JSONL fixtures inside a sandboxed `$HOME` (nothing
   touches a real `~/.needle/logs`):
   - `fabric logs` and `fabric tail` — both documented spellings: single-file
     parse, directory hot-add, graceful SIGINT, and identical `--help` output
     (the CLI reference documents `logs` as an alias of `tail`)
   - `fabric web` — `/api/health`, SPA assets served from the installed
     package, graceful SIGINT
   - `fabric tui` — startup on a pty via `script`, graceful SIGINT
   - `fabric replay` — pty startup over the fixture logs, graceful SIGINT
   - `fabric prune` — dry run reports an aged fixture without touching it,
     then a real run archives it and the tarball is verified
   - `fabric digest` — deterministic digest over the fixture directory on
     stdout, and the single-file `--output` workflow
   - `fabric config` — show, `theme` set/readback/persistence, invalid-theme
     rejection, `presets list`, `clear --all`

The sandboxed `$HOME` also keeps the runtime smoke away from real NEEDLE
workers on a fleet host. Requires `git`, `curl`, `tar`, and `script`
(util-linux); takes a few minutes (two full `npm install`s by design). The
source tree is packaged from `HEAD`, so commit before relying on it. Set
`SMOKE_KEEP_WORKDIR=1` to keep the temp workdir for inspection.

## Quick Start

```bash
# Terminal dashboard
fabric tui

# Web dashboard
fabric web

# Stream parsed events to stdout
fabric logs

# With OTLP live telemetry
fabric tui --otlp-grpc :4317
```

FABRIC watches `~/.needle/logs/` by default, tailing every `*.jsonl` file in
the directory and hot-adding new worker logs as they appear.

## Intelligence Features

Beyond simple log display, FABRIC provides:

| Feature | Description |
|---------|-------------|
| **Stuck & Loop Detection** | Automatic alerts when workers spin their wheels |
| **Inline Diff View** | See actual code changes, not just "Edit was called" |
| **Cross-Reference Links** | Click any bead, file, or worker to navigate |
| **Collision Detection** | Know when workers edit the same files |
| **Session Replay** | Scrub through past sessions like a video |
| **Smart Error Grouping** | Errors with context, not scattered through logs |
| **Command Palette** | Ctrl+K for universal search and commands |
| **Cost Tracking** | Real-time token usage and budget alerts |
| **Task Dependency DAG** | Visual graph of task relationships |
| **File Heatmap** | See where all the action is at a glance |
| **Conversation Transcript** | See the full Claude conversation, not just tool calls |
| **Semantic Narrative** | Natural language summary of what workers are doing |
| **AI Session Digest** | Opt-in AI narrative for the session digest (`fabric digest --ai`) — one Anthropic API call; see below for data handling |
| **File Context Panel** | See file contents alongside activity stream |
| **Git Integration** | Live git status, diff preview, conflict detection |
| **Worker Analytics** | Compare worker performance over time |
| **Recovery Playbook** | Suggestions based on similar past errors |
| **Focus Mode** | Pin workers/tasks, hide everything else |

### AI Session Digest (`fabric digest --ai`) — opt-in, data handling

`fabric digest` alone is fully deterministic: it reads local NEEDLE logs and
renders Markdown tables, with **no network call**. The opt-in `--ai` flag adds
a stakeholder-facing narrative section by making one call to the **Anthropic
Messages API** (official `@anthropic-ai/sdk`), default model
**`claude-opus-5`** — override with `--ai-model` or `FABRIC_DIGEST_AI_MODEL`.
Nothing leaves the machine unless you pass `--ai`.

**What is sent externally:** only the digest's already-extracted summary data
— the session window and aggregate counts, per-worker summaries (top 20),
completed bead IDs with worker and duration (top 20), most-modified file paths
with counts and tools (top 15), and recent error messages flattened to one
line each (top 10). Raw log lines, file contents, and environment variables
are never sent.

**Prompt bounds:** those caps (20 workers / 20 beads / 15 files / 10 errors)
keep the single request small and its cost predictable. Overflow is described
to the model only as an "… and N more" line; the aggregate stats always
reflect the full session.

**Configuration** (environment variables):

| Variable | Default | Purpose |
|----------|---------|---------|
| `FABRIC_DIGEST_AI_API_KEY` | — | API key (preferred); falls back to `ANTHROPIC_API_KEY` |
| `FABRIC_DIGEST_AI_MODEL` | `claude-opus-5` | Model id (`--ai-model` wins) |
| `FABRIC_DIGEST_AI_MAX_TOKENS` | `4096` | Response token cap |
| `FABRIC_DIGEST_AI_TIMEOUT_MS` | `60000` | Request timeout |
| `FABRIC_DIGEST_AI_MAX_RETRIES` | `1` | Transport retries |

Invalid numeric values silently fall back to the defaults.

**Timeout, refusal, and error fallback:** the AI layer never throws and never
loses your digest. A missing key; an auth, rate-limit, or network failure; an
elapsed `FABRIC_DIGEST_AI_TIMEOUT_MS` timeout; a malformed or empty response;
or a model refusal (`stop_reason=refusal`) each print the reason to **stderr**
and emit the deterministic digest unchanged. The command still exits **0**.

**Secret-safe:** the API key is used only to authenticate the request — it is
never logged, never rendered into the digest output, and never included in
the prompt. Provider errors are reported by property (HTTP status, message),
not by echoing request material.

The TUI and web digest views stay deterministic by design; the AI narrative
is a CLI export feature. Full option and fallback reference:
[`docs/cli.md`](docs/cli.md#fabric-digest).

## Relationship to NEEDLE

```
NEEDLE (orchestrates workers) → logs → FABRIC (displays + analyzes)
```

NEEDLE does the work. FABRIC shows you what's happening and helps you understand it.

## Wiring NEEDLE → FABRIC

There are two ways to send NEEDLE telemetry to FABRIC: config-based HTTP POST (simpler) or OTLP (lower latency, more features).

### Option 1: Config-based HTTP POST (recommended for local dev)

Set `fabric.enabled: true` in `~/.needle/config.yaml`:

```yaml
fabric:
  enabled: true
  endpoint: http://localhost:3000/api/events
  timeout: 2
  batching: false
  auth_token: your-secret-token   # must match FABRIC_AUTH_TOKEN on the server
```

Start FABRIC web server with an auth token, then start NEEDLE workers — events flow automatically:

```bash
FABRIC_AUTH_TOKEN=your-secret-token fabric web   # starts on http://localhost:3000
needle run ...                                    # workers POST to /api/events with Bearer token
```

#### Authentication

**Every POST endpoint** requires a `Bearer` token when the server is started with an auth token — not just event ingestion: retention pruning, theme, the memory-mutation routes (`/api/memory/capture`, `/api/memory/baseline`, `/api/memory/heap-snapshot`, `/api/memory/trend/save`), cost-alert acknowledgement, and the OTLP/HTTP receiver. GET endpoints are open (read-only, no secret data). A missing `Authorization` header answers `401`; a wrong token answers `403`. Full policy, status codes, and route inventory: `docs/api-auth.md`.

```bash
# Start with auth token (env var or flag)
FABRIC_AUTH_TOKEN=secret fabric web
fabric web --auth-token secret

# Manual POST (e.g. for testing)
curl -X POST http://localhost:3000/api/events \
  -H 'Authorization: Bearer secret' \
  -H 'Content-Type: application/json' \
  -d '{"ts":"2026-04-23T00:00:00Z","event":"worker.started","worker":"w-test"}'
```

If no auth token is configured, all POST requests are accepted without authentication (suitable for local-only use).

#### Token rotation

To rotate `FABRIC_AUTH_TOKEN` with zero dropped events:

```bash
# 1. Generate a new token
NEW_TOKEN=$(openssl rand -hex 32)

# 2. Write it to the secrets file (0600 — not readable by other users)
install -m 0600 /dev/null ~/.config/fabric/secrets.env
echo "FABRIC_AUTH_TOKEN=${NEW_TOKEN}" > ~/.config/fabric/secrets.env

# 3. Update ~/.needle/config.yaml if the old token was hard-coded there
#    (if using ${FABRIC_AUTH_TOKEN} substitution, no change needed)

# 4. Restart the service so FABRIC picks up the new token
systemctl --user restart fabric-web

# 5. Confirm the service is using the new token
systemctl --user status fabric-web
curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/events \
  -X POST -H 'Content-Type: application/json' -d '{}'
# Expected: 401 (auth enforced)
```

NEEDLE workers reload their config on the next task start — no restart needed on the worker side when `auth_token: "${FABRIC_AUTH_TOKEN}"` is used.

### Option 2: OTLP (recommended for multi-host or production)

NEEDLE ships with an `otlp` feature (enabled by default in `Cargo.toml`) that exports telemetry over the standard OpenTelemetry OTLP protocol. No rebuild or extra flags are needed — just set two environment variables before launching workers:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://fabric-host:4317
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
needle run ...
```

| Variable | Default | Notes |
|----------|---------|-------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | FABRIC's OTLP listener address |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `grpc` | `grpc` (port **4317**) or `http/protobuf` (port **4318**) |

### Starting the FABRIC receiver

FABRIC must be started with an OTLP listener for live telemetry to flow. The `--otlp-grpc` and `--otlp-http` flags enable the receiver:

```bash
# gRPC receiver (recommended — lower latency, NEEDLE default)
fabric tui --otlp-grpc 0.0.0.0:4317

# HTTP receiver (alternative)
fabric web --otlp-http 0.0.0.0:4318

# Both sources merged (JSONL tail + OTLP live)
fabric tui --source ~/.needle/logs/ --otlp-grpc :4317

# Tail with OTLP and event-type filtering
fabric tail --otlp-grpc :4317 --event-type "bead.*"

# Stream logs to stdout with filtering (logs is an alias for tail)
fabric logs --event-type "bead.*"
fabric logs --worker tcb-a --otlp-grpc :4317
```

| Receiver flag | Default port | Protocol |
|---------------|-------------|----------|
| `--otlp-grpc` | `4317` | OTLP/gRPC (tonic) |
| `--otlp-http` | `4318` | OTLP/HTTP (protobuf + JSON) |

Everything stays on your machine — FABRIC is a local collector, not a third-party service. Telemetry is read-only: FABRIC ingests spans/logs/metrics for display but never writes back to NEEDLE or modifies worker state.

## Log Retention (`fabric prune`)

`~/.needle/logs/` can grow as NEEDLE workers create telemetry JSONL and stderr logs. `fabric prune` supports an explicit retention policy; omitted windows are indefinite:

```bash
# Inspect without a destructive policy (defaults are indefinite)
fabric prune --dry-run

# Dry run — see what would happen
fabric prune --dry-run

# Custom retention
fabric prune --archive-after 5 --max-age 14 --archive-retain 60

# Prune a different directory
fabric prune --source /path/to/logs
```

| Flag | Default | Description |
|------|---------|-------------|
| `--archive-after` | indefinite | Archive files older than this into `~/.needle/logs/archive/YYYY-MM-DD.tar.gz` |
| `--max-age` | indefinite | Hard delete files older than this (safety net) |
| `--archive-retain` | indefinite | Delete archive tarballs older than this |
| `--dry-run` | off | Report what would happen without making changes |

Signed occurrence tombstones and legal holds live in the separate
`~/.needle/retention-controls/` control plane. Active legal holds override
tombstones and prune windows, and raw event ingestion has no delete route.

The pruner emits `mend.logs_pruned` events to `~/.needle/logs/fabric-mend.jsonl`, visible to FABRIC's directory tailer. Run via cron for automatic retention:

```bash
# Daily at 03:17
17 3 * * * ~/.local/bin/fabric prune
```

## Remote Access via Tailscale

The web dashboard can be served over HTTPS on your Tailscale tailnet (not the public internet):

```
https://<your-machine>.tail<your-tailnet>.ts.net/
```

**Access model:**
- Available only to devices joined to your tailnet (laptop, phone, etc.)
- TLS provided by Tailscale's managed certificates — no self-signed cert warnings
- GET requests (dashboard, workers list, event feed) are unauthenticated
- POST requests — *all* of them, including the memory-mutation routes and the OTLP receiver — require `Authorization: Bearer <FABRIC_AUTH_TOKEN>` (`docs/api-auth.md`)
- Not exposed via Tailscale Funnel — no public internet access

**Setup (one-time):**

```bash
# Grant operator access + configure HTTPS proxy
./scripts/setup-tailscale-serve.sh

# Or manually
sudo tailscale set --operator=$USER
tailscale serve --bg http://localhost:3000
```

The serve config persists across reboots. To remove it:

```bash
tailscale serve --https=443 off
```

## Production Deployment

FABRIC runs as a user-level systemd service (`fabric-web.service`) with OTLP/HTTP enabled:

```bash
# Service status
systemctl --user status fabric-web.service

# Verify OTLP listener
ss -tlnp | grep 4318
```

| Component | Port/URL | Purpose |
|-----------|----------|---------|
| Web dashboard (local) | `:3000` | Browser UI + REST API |
| Web dashboard (remote) | `https://<your-machine>.tail<your-tailnet>.ts.net/` | Tailscale HTTPS (tailnet only) |
| OTLP/HTTP | `:4318` | NEEDLE metric ingestion |

NEEDLE's `otlp_metric_sink` is enabled in `~/.needle/config.yaml`, pushing aggregated token/cost/bead metrics to `http://localhost:4318/v1/metrics`. FABRIC deduplicates these against JSONL-tailed events and writes them to `~/.needle/fabric.db` with `metrics_source='otlp-metric'`.

## Documentation

- [CLI Reference](docs/cli.md) — every `fabric` command (`tui`, `web`, `logs`, `replay`, `prune`, `digest`, `config`)
- [NeedleEvent Schema](docs/schema.md) — canonical wire format shared with NEEDLE
- [Metrics Export](docs/metrics.md) — Prometheus-compatible metrics for monitoring
- [Implementation Plan](docs/plan.md)

---

Part of [jedarden.com](https://jedarden.com)

*This GitHub repo is a read-only mirror of git.ardenone.com/jedarden/FABRIC — issues and PRs are welcome here either way.*
