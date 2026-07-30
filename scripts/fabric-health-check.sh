#!/usr/bin/env bash
# FABRIC systemd health check script
# Called by fabric-watchdog.service to verify the health endpoint.
# Exits non-zero if the health endpoint reports unhealthy or returns invalid FABRIC response.
# If health check fails, restarts fabric-web.service.

# Defense in depth (bf-5trl9 item 2): re-exec this whole script under a hard
# wall-clock ceiling so that if some future change reintroduces an unbounded
# call anywhere in check_fabric_health, this script still cannot wedge
# fabric-watchdog.service (Type=oneshot) forever. The curl-level timeouts
# below are the primary fix; this is just a backstop.
if [ -z "${FABRIC_HEALTHCHECK_GUARDED:-}" ] && command -v timeout >/dev/null 2>&1; then
  export FABRIC_HEALTHCHECK_GUARDED=1
  exec timeout 30 "$0" "$@"
fi

PORT="${FABRIC_PORT:-3000}"
MAX_RETRIES=3
RETRY_INTERVAL=1
# Bound how long a single curl call may take. Without these, a fabric-web
# that accepts the TCP connection but never writes a response (e.g. its
# event loop is starved) leaves curl -sf waiting forever, which wedges this
# script -- and because fabric-watchdog.service is Type=oneshot, systemd
# won't start a new run until this one exits, silently disabling the entire
# watchdog exactly when it's needed most. See bf-5trl9.
CURL_CONNECT_TIMEOUT="${FABRIC_HEALTHCHECK_CONNECT_TIMEOUT:-3}"
CURL_MAX_TIME="${FABRIC_HEALTHCHECK_MAX_TIME:-5}"

check_fabric_health() {
  local response
  local status

  # Get both HTTP status and JSON response
  response=$(curl -sf --connect-timeout "$CURL_CONNECT_TIMEOUT" --max-time "$CURL_MAX_TIME" "http://localhost:${PORT}/api/health" 2>/dev/null)
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
