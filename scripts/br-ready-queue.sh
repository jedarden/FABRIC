#!/bin/bash
# br-ready-queue.sh
# ALT-004: Ready Queue File - pre-computed work queue
#
# This alternative maintains a ready-queue.json file that workers can read
# directly without any br commands. A background process or cron refreshes it.
#
# Usage:
#   ./scripts/br-ready-queue.sh refresh    # Refresh the queue file
#   ./scripts/br-ready-queue.sh read       # Read current queue (for workers)
#   ./scripts/br-ready-queue.sh watch      # Watch mode (refresh every 60s)
#
# Queue file location: .beads/ready-queue.json
#
# Workers can simply:
#   cat .beads/ready-queue.json | jq '.[0]'  # Get first available bead

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
QUEUE_FILE="$PROJECT_ROOT/.beads/ready-queue.json"
JSONL_FILE="$PROJECT_ROOT/.beads/issues.jsonl"

refresh_queue() {
    if [[ ! -f "$JSONL_FILE" ]]; then
        echo "[]" > "$QUEUE_FILE"
        return 1
    fi

    jq -c -s '
        map(select(.status == "open"))
        | map(select(.issue_type != "human" and .issue_type != "phase" and .issue_type != "epic"))
        | sort_by(.priority, .id)
        | [{id, title, priority, issue_type, labels, dependencies, updated_at: (now | todate)}]
    ' "$JSONL_FILE" > "$QUEUE_FILE" 2>/dev/null

    echo "Queue refreshed: $(jq 'length' "$QUEUE_FILE") beads available"
}

read_queue() {
    if [[ ! -f "$QUEUE_FILE" ]]; then
        echo "[]" >&2
        return 1
    fi
    cat "$QUEUE_FILE"
}

watch_queue() {
    echo "Starting watch mode (refresh every 60s)..."
    while true; do
        refresh_queue
        sleep 60
    done
}

case "${1:-read}" in
    refresh)
        refresh_queue
        ;;
    read)
        read_queue
        ;;
    watch)
        watch_queue
        ;;
    *)
        echo "Usage: $0 {refresh|read|watch}"
        exit 1
        ;;
esac
