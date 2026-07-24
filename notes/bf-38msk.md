# bf-38msk: Wire fabric-health-check.sh into watchdog timer

## Task Summary

Verify that `scripts/fabric-health-check.sh` is properly wired into a systemd watchdog timer and that it validates FABRIC-specific fields to prevent false positives from impostor services.

## What Was Verified

### 1. Health Check Script Validation (Already Complete)
The `scripts/fabric-health-check.sh` already includes identity verification:
- Checks for HTTP 200 on `/api/health`
- **Validates FABRIC-specific field**: `tailer_files_watched` in JSON response
- Rejects responses missing this field (prevents vista impostor false positives)
- Retries 3 times with 1-second intervals
- Restarts `fabric-web.service` if all retries fail

### 2. Systemd Watchdog Units (Already Installed)
The following units were already created and installed:
- `scripts/fabric-watchdog.service` - Runs the health check script
- `scripts/fabric-watchdog.timer` - Triggers the service every 60 seconds

### 3. Watchdog Configuration
Timer (`fabric-watchdog.timer`):
- Runs every 60 seconds via `OnCalendar=*:0/1`
- Has 5-second random delay to avoid exact alignment
- Persistent (runs immediately on resume from suspend)
- Enabled and active

Service (`fabric-watchdog.service`):
- Type: oneshot
- ExecStart: `/home/coding/FABRIC/scripts/fabric-health-check.sh`
- Environment: Loads PATH and secrets from `EnvironmentFile`
- Requires: `fabric-web.service`

### 4. Verification Testing

**Test 1: Watchdog runs successfully**
```bash
systemctl --user status fabric-watchdog.service
# Status: inactive (dead) - exited with status=0/SUCCESS
```

**Test 2: Health check rejects non-FABRIC responses**
```bash
# Simulated vista impostor response: {"status": "ok", "version": "1.0.0"}
# Result: CORRECTLY REJECTED - missing tailer_files_watched field
```

**Test 3: FABRIC health endpoint works**
```bash
curl http://localhost:3000/api/health
# Returns: {"status": "ok", "tailer_files_watched": 200, ...}
```

## Current Status

✅ **COMPLETE** - The watchdog is fully functional:
- Timer is active and triggering every minute
- Health check script validates FABRIC-specific identity
- Impostor services are correctly rejected
- Auto-restart on failure is configured

## Files Verified

- `scripts/fabric-health-check.sh` - Identity verification already in place
- `scripts/fabric-watchdog.service` - Service unit already installed
- `scripts/fabric-watchdog.timer` - Timer unit already installed
- Installed units match repo files exactly

## Relates To

- ADR-1 in `docs/plan.md`
- bf-4grhf (ongoing outage that this would have caught)
