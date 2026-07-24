#!/usr/bin/env bash
# FABRIC systemd health check script
# Called by fabric-watchdog.service to verify the health endpoint.
# Exits non-zero if the health endpoint reports unhealthy or returns invalid FABRIC response.
# If health check fails, restarts fabric-web.service.

PORT="${FABRIC_PORT:-3000}"
MAX_RETRIES=3
RETRY_INTERVAL=1

check_fabric_health() {
  local response
  local status

  # Get both HTTP status and JSON response
  response=$(curl -sf "http://localhost:${PORT}/api/health" 2>/dev/null)
  status=$?

  if [ $status -ne 0 ]; then
    echo "curl failed with exit code $status" >&2
    return 1
  fi

  # Check for FABRIC-specific field: tailer_files_watched
  # This prevents false positives from other services squatting port 3000
  if ! echo "$response" | jq -e '.tailer_files_watched' >/dev/null 2>&1; then
    echo "Invalid FABRIC health response: missing tailer_files_watched field" >&2
    echo "Response was: $response" >&2
    return 1
  fi

  return 0
}

for i in $(seq 1 $MAX_RETRIES); do
  if check_fabric_health; then
    exit 0
  fi
  if [ "$i" -lt "$MAX_RETRIES" ]; then
    sleep $RETRY_INTERVAL
  fi
done

echo "FABRIC health check failed after $MAX_RETRIES attempts" >&2
echo "Restarting fabric-web.service..." >&2
systemctl --user restart fabric-web.service
exit 1
