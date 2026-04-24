#!/usr/bin/env bash
# FABRIC systemd health check script
# Called by systemd's WatchdogSec mechanism.
# Exits non-zero if the health endpoint reports unhealthy.

PORT="${FABRIC_PORT:-3000}"
MAX_RETRIES=3
RETRY_INTERVAL=1

for i in $(seq 1 $MAX_RETRIES); do
  STATUS=$(curl -sf -o /dev/null -w '%{http_code}' "http://localhost:${PORT}/api/health" 2>/dev/null)
  if [ "$STATUS" = "200" ]; then
    exit 0
  fi
  if [ "$i" -lt "$MAX_RETRIES" ]; then
    sleep $RETRY_INTERVAL
  fi
done

echo "FABRIC health check failed: HTTP $STATUS after $MAX_RETRIES attempts" >&2
exit 1
