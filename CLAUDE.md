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
| `scripts/fabric-web.service` | systemd unit file |
| `scripts/setup-tailscale-serve.sh` | One-time Tailscale Serve setup |
| `docs/plan.md` | Full architecture and phase roadmap |
