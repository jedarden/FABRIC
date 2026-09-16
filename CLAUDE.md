# FABRIC

## What This Is

FABRIC is a live dashboard for NEEDLE worker activity — TUI and web modes.

- **Repo**: `/home/coding/FABRIC`
- **Stack**: TypeScript + Node.js, Express, WebSocket, React frontend (Vite), blessed TUI
- **Log source**: `~/.needle/logs/` (per-worker JSONL files, hot-added via DirectoryTailer)

## Running Service

Host: **`codinghome`** (replaces `hetzner-ex44`, decommissioned 2026-08-30).

```bash
systemctl --user status fabric-web.service   # check status
systemctl --user restart fabric-web.service  # restart
```

The service runs as `node dist/cli.js web --port 3000 --source ~/.needle/logs --otlp-http :4318`
(unit template: `scripts/fabric-web.service`; installed at `~/.config/systemd/user/fabric-web.service`).
Auth token is loaded from `~/.config/fabric/secrets.env` (`FABRIC_AUTH_TOKEN`, mode 600).

## Remote Access

| URL | Notes |
|-----|-------|
| `http://localhost:3000` | Local only |
| `https://codinghome.tail1b1987.ts.net/` | Tailscale tailnet, TLS, **no public internet** |

The Tailscale HTTPS proxy is configured via `tailscale serve --bg --https=443 http://localhost:3000`.
To re-apply after a reset: `./scripts/setup-tailscale-serve.sh`.

**Status note (2026-09-16):** the serve config change requires operator rights
(`sudo tailscale set --operator=$USER`); the `coding` user on codinghome currently
has no working sudo, so the 443 handler is **not yet active** — the only handler
is `:8443`, which belongs to jedarden-preview-web (127.0.0.1:45129) and must not
be repurposed. Local service is verified healthy; the remote URL works once an
operator runs the serve command above.

## Auth Model

- `FABRIC_AUTH_TOKEN` in `~/.config/fabric/secrets.env` protects all POST endpoints
- GET endpoints (dashboard UI, workers, events read) are open — read-only, no secret data
- Tailscale provides network-level access control (tailnet membership required)

## NEEDLE OTLP Wiring

FABRIC listens on port **4318** for OTLP/HTTP telemetry (enabled via `--otlp-http :4318` in the systemd unit).

To wire NEEDLE workers to push OTLP telemetry to the running FABRIC instance:

```yaml
# ~/.config/needle/config.yaml
telemetry:
  otlp_sink:
    enabled: true   # pushes to http://localhost:4318 by default
    headers:
      - "Authorization: Bearer ${FABRIC_AUTH_TOKEN}"  # all POSTs incl. OTLP require auth

fabric:
  enabled: true
  endpoint: http://localhost:3000
```

**Key points:**
- FABRIC's OTLP receiver runs on `http://localhost:4318` (OTLP/HTTP protocol)
- NEEDLE uses the standard `OTEL_EXPORTER_OTLP_ENDPOINT` env var (defaults to `http://localhost:4318`) — no explicit endpoint key needed in config
- With OTLP enabled, `/api/summary` workers_active updates in near real-time vs log-file polling
- The `fabric.endpoint` setting pushes to FABRIC's native API (POST `/api/events` or heartbeat endpoint)
- Full topology, remote-host endpoints, and verification: `docs/otlp-config.md` (renamed from `docs/ex44-config.md`)
- Reference config template: `configs/needle-otlp-config.yaml` (renamed from `configs/ex44-needle-config.yaml`)
- Note: codinghome's live NEEDLE config points `otlp_sink` at the separate fleet
  collector (`needle-otel-...apexalgo-iad...:4318`) — local FABRIC visibility comes
  from JSONL tailing; do not repoint the fleet collector at FABRIC.

## Log Retention Policy

FABRIC automatically manages NEEDLE log file retention to prevent unbounded growth.

### Policy

| Setting | Default | Description |
|---------|---------|-------------|
| `archiveAfterDays` | 3 | Files older than this are archived to `~/.needle/logs/archive/` |
| `maxAgeDays` | 7 | Files older than this are deleted (even if not archived) |
| `archiveRetentionDays` | 30 | Archive tarballs older than this are deleted |

### Automatic Execution

Optional: a systemd timer can run pruning daily at 03:00 UTC. **Not currently
enabled on codinghome** — templates exist in `scripts/`; to enable, install
`scripts/fabric-prune.{service,timer}` to `~/.config/systemd/user/` and run
`systemctl --user enable --now fabric-prune.timer`:

```bash
systemctl --user status fabric-prune.timer   # check timer status
systemctl --user start fabric-prune.timer    # enable automatic pruning
journalctl --user -u fabric-prune.service    # view prune logs
```

### Manual Pruning

```bash
# CLI
fabric prune --dry-run                    # preview what would be pruned
fabric prune --archive-after 7            # customize policy

# API (requires auth)
curl -X POST http://localhost:3000/api/retention/prune \
  -H "Authorization: Bearer $FABRIC_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'
```

### Retention State API

```bash
curl http://localhost:3000/api/retention
```

Returns current file count, archive size, and last prune results.

## Build & Test

```bash
npm run build           # compile TypeScript + Vite frontend
npm test                # vitest unit tests
npm run test:e2e        # Playwright E2E tests
npx tsc --noEmit        # type-check without emitting
```

## Key Files

| Path | Purpose |
|------|---------|
| `src/cli.ts` | Entry point; all CLI commands |
| `src/web/server.ts` | Express HTTP server + WebSocket + auth middleware |
| `src/web/frontend/` | React SPA (Vite build) |
| `src/directoryTailer.ts` | Watches `~/.needle/logs/`, hot-adds new JSONL files |
| `src/store.ts` | In-memory event store + SQLite persistence |
| `src/logPruner.ts` | Log retention policy implementation |
| `scripts/fabric-web.service` | systemd unit file for web dashboard |
| `scripts/fabric-prune.service` | systemd unit file for log pruning |
| `scripts/fabric-prune.timer` | systemd timer for daily log pruning |
| `scripts/setup-tailscale-serve.sh` | One-time Tailscale Serve setup |
| `docs/otlp-config.md` | NEEDLE → FABRIC OTLP configuration guide (fleet topology) |
| `docs/plan.md` | Full architecture and phase roadmap |

## CI — Argo Workflows on iad-ci only. GitHub Actions are disabled.

**GitHub Actions are disabled across all repos in this environment. Never re-enable them, never add new workflows, never propose them.**

At the start of every work iteration, delete any `.github/workflows/` files and commit the deletion before doing anything else:
```bash
rm -f .github/workflows/*.yml .github/workflows/*.yaml
git add -A && git commit -m "ci: remove GitHub Actions (Argo Workflows on iad-ci only)"
```

There are two legacy workflow files (`ci.yml`, `release.yml`) that are inert but must not be revived or used as templates.

All CI runs on Argo Workflows in the `iad-ci` cluster:

- **WorkflowTemplate:** `fabric-ci` — lives in `jedarden/declarative-config → k8s/iad-ci/argo-workflows/fabric-ci-workflowtemplate.yml`
- Runs: `npm ci` → `npm run typecheck` → `npm test` → `npm run build` → `npm run build:web`

To trigger a CI run manually:
```bash
kubectl --kubeconfig=/home/coding/.kube/iad-ci.kubeconfig create -f - <<YAML
apiVersion: argoproj.io/v1alpha1
kind: Workflow
metadata:
  generateName: fabric-ci-manual-
  namespace: argo-workflows
spec:
  workflowTemplateRef:
    name: fabric-ci
YAML
```

ArgoCD on ardenone-manager syncs declarative-config automatically on push. Never `kubectl apply` directly against any cluster.
