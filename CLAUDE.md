# FABRIC

## What This Is

FABRIC is a live dashboard for NEEDLE worker activity — TUI and web modes.

- **Repo**: `/home/coding/FABRIC`
- **Stack**: TypeScript + Node.js, Express, WebSocket, React frontend (Vite), blessed TUI
- **Log source**: `~/.needle/logs/` (per-worker JSONL files, hot-added via DirectoryTailer)

## Running Service

```bash
systemctl --user status fabric-web.service   # check status
systemctl --user restart fabric-web.service  # restart
```

The service runs as `fabric web --port 3000 --source ~/.needle/logs --otlp-http :4318`.
Auth token is loaded from `~/.config/fabric/secrets.env` (`FABRIC_AUTH_TOKEN`).

## Remote Access

| URL | Notes |
|-----|-------|
| `http://localhost:3000` | Local only |
| `https://hetzner-ex44.tail1b1987.ts.net/` | Tailscale tailnet, TLS, **no public internet** |

The Tailscale HTTPS proxy is configured via `tailscale serve --bg http://localhost:3000`.
To re-apply after a reset: `./scripts/setup-tailscale-serve.sh`.

## Auth Model

- `FABRIC_AUTH_TOKEN` in `~/.config/fabric/secrets.env` protects all POST endpoints
- GET endpoints (dashboard UI, workers, events read) are open — read-only, no secret data
- Tailscale provides network-level access control (tailnet membership required)

## Log Retention Policy

FABRIC automatically manages NEEDLE log file retention to prevent unbounded growth.

### Policy

| Setting | Default | Description |
|---------|---------|-------------|
| `archiveAfterDays` | 3 | Files older than this are archived to `~/.needle/logs/archive/` |
| `maxAgeDays` | 7 | Files older than this are deleted (even if not archived) |
| `archiveRetentionDays` | 30 | Archive tarballs older than this are deleted |

### Automatic Execution

A systemd timer runs pruning daily at 03:00 UTC:

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
