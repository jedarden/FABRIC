# NEEDLE → FABRIC OTLP Configuration

> **Renamed from `docs/ex44-config.md`.** The previous version of this guide was
> written for `ex44` (decommissioned 2026-08-30) pushing to the `lab` collector
> at `100.81.129.38:4318` — both of which no longer exist as documented. Following
> those instructions verbatim silently dropped all telemetry. This version
> describes the current deployment.

## Current Topology (verified 2026-09-16)

The canonical FABRIC collector runs on **`codinghome`** (this host, tailnet IP
`100.69.121.34`), managed as a systemd user service:

| Component | Where | Notes |
|---|---|---|
| Web dashboard | `codinghome:3000` | `fabric-web.service` (user unit) |
| OTLP/HTTP receiver | `codinghome:4318` | enabled via `--otlp-http :4318` |
| Remote access | `https://codinghome.tail1b1987.ts.net/` | Tailscale Serve (tailnet only) |
| Primary event source | `~/.needle/logs/*.jsonl` | DirectoryTailer, local workers |
| Auth token | `~/.config/fabric/secrets.env` | `FABRIC_AUTH_TOKEN`, mode 600 |

**Important:** codinghome's own NEEDLE workers currently push OTLP *metrics* to
the separate fleet collector (`needle-otel-ex44-apexalgo-iad-ts.ardenone.com:4318`,
restored 2026-09-07). Do not repoint that at FABRIC — FABRIC's visibility into
local workers comes from JSONL tailing, which needs no configuration.

## Authentication

FABRIC's auth middleware guards **every POST route, including both OTLP
receivers** (`src/web/server.ts`):

- Missing `Authorization` header → `401`
- Wrong token → `403`
- Correct: `Authorization: Bearer <FABRIC_AUTH_TOKEN>`

NEEDLE's `otlp_sink.headers` is a list of `"Name: value"` strings with `${ENV}`
interpolation, so a NEEDLE host can carry the token without writing it into the
config file:

```yaml
telemetry:
  otlp_sink:
    enabled: true
    headers:
      - "Authorization: Bearer ${FABRIC_AUTH_TOKEN}"
```

## Pointing a NEEDLE Host at FABRIC

### On codinghome (localhost)

```yaml
telemetry:
  otlp_sink:
    enabled: true
    endpoint: http://localhost:4318
    protocol: http/protobuf
    timeout_secs: 10
    compression: gzip
    tls: none
    headers:
      - "Authorization: Bearer ${FABRIC_AUTH_TOKEN}"
    metrics_interval_secs: 10
    service_namespace: needle-fleet
```

Or via environment variables:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

### From a remote NEEDLE host

Point `endpoint` at `http://codinghome.tail1b1987.ts.net:4318` (or
`http://100.69.121.34:4318`) instead of localhost.

> **Unverified:** inbound tailnet reachability of port 4318 on codinghome has
> not been confirmed from a second host — it depends on the tailnet ACL and the
> node firewall. If a remote host cannot connect, that is the first thing to
> check. The Tailscale Serve URL (443) only proxies HTTPS to the web dashboard,
> not raw OTLP.

A complete reference config lives at `configs/needle-otlp-config.yaml`.
`scripts/configure-otlp.sh` applies the localhost variant to an existing
`~/.needle/config.yaml` (with backup; `--dry-run` to preview).

## Verification

```bash
# Collector is up (GET — no auth required)
curl http://localhost:3000/api/health

# OTLP listener responds (POST without token → 401 proves auth + listener)
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:4318/v1/logs

# Auth is enforced on event ingest
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/events

# After starting a worker with OTLP pointed here, its events appear in:
curl http://localhost:3000/api/summary
```

## References

- ADR-1: `docs/plan.md` (section "ADR-1: 2026-07-20 — Centralize FABRIC as a
  Multi-Host OTLP Collector") — the topology decision; note its `lab`/`ex44`
  host references are historical, see the status note at the top of that section
- FABRIC README: "Option 2: OTLP (recommended for multi-host or production)"
- Historical bead: `fabric-afa62cf6` ("Point ex44 NEEDLE config at lab FABRIC
  OTLP endpoint") — closed; moot since both ex44 and the lab collector it
  targeted are gone. Superseded by this document.
