# bf-q5ttt: Point ex44 NEEDLE config at lab FABRIC OTLP endpoint

## Task Summary

Configure ex44 NEEDLE workers to send OTLP telemetry to the centralized lab FABRIC collector instead of the unreachable localhost:3000 endpoint, implementing ADR-1's topology decision.

## Current Situation

- **Lab (100.81.129.38)**: Runs FABRIC with OTLP receiver on port 4318
- **ex44 (100.72.170.64)**: NEEDLE misconfigured with `fabric.enabled: true, endpoint: http://localhost:3000`
- **Problem**: Nothing listens on ex44:3000; every event POST has been silently failing (2s timeout)
- **Impact**: ex44's worker activity has never been visible in any FABRIC dashboard

## ADR-1 Architecture Decision

Per ADR-1 (documented in `docs/plan.md`):
- Designate lab as the canonical FABRIC collector for the fleet
- Use OTLP push model instead of per-host HTTP POST
- Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://100.81.129.38:4318` on each NEEDLE host

## Work Completed

Since direct SSH access to ex44 as the appropriate user was not available from the lab machine, this deliverable provides:

1. **Documentation**: `docs/ex44-config.md` - Complete configuration guide for ex44 and future multi-host setups
2. **Configuration file**: `configs/ex44-needle-config.yaml` - Complete ex44 NEEDLE config with OTLP enabled
3. **This note**: Summary of the change and verification steps

## Configuration Change Required on ex44

The key change to `~/.needle/config.yaml` on ex44:

```yaml
# Enable OTLP push to lab
telemetry:
  otlp_sink:
    enabled: true
    endpoint: http://100.81.129.38:4318
    protocol: http/protobuf

# Disable localhost HTTP POST (no listener on ex44)
fabric:
  enabled: false
```

## Verification Steps

Once the configuration is applied on ex44:

1. Restart NEEDLE workers on ex44
2. Verify events appear in lab FABRIC:
   ```bash
   curl http://localhost:3000/api/summary
   ```
3. Check dashboard shows ex44 worker activity

## Network

- **Lab FABRIC OTLP endpoint**: `http://100.81.129.38:4318`
- **Protocol**: OTLP/HTTP with protobuf encoding
- **Transport**: Tailscale mesh network (100.81.129.38 reachable from ex44)

## Next Steps

1. Apply configuration to ex44 when access is available
2. Start a test NEEDLE worker on ex44
3. Verify events appear in lab FABRIC dashboard
4. Consider documenting this pattern for future NEEDLE hosts

## Files Created

- `docs/ex44-config.md` - Multi-host configuration documentation
- `configs/ex44-needle-config.yaml` - Complete ex44 NEEDLE config
- `notes/bf-q5ttt.md` - This note
