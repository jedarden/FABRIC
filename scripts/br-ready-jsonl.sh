#!/bin/bash
# br-ready-jsonl.sh
# ALT-003: JSON/br list parsing - uses br list --format json which works
#
# This alternative uses br list --format json which doesn't have the schema bug
# that affects br ready. It then filters for available work using jq.
#
# Advantages:
#   - Uses working br list command (no schema bug)
#   - Works with just jq (portable)
#   - Can be used as drop-in replacement for br ready
#
# Usage:
#   ./scripts/br-ready-jsonl.sh           # List available beads
#   ./scripts/br-ready-jsonl.sh --json    # JSON output
#   ./scripts/br-ready-jsonl.sh --priority 1  # P1 only
#
# Exit codes:
#   0 - Found available work
#   1 - No available work found
#   2 - Error (jq not installed, br list fails, etc.)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

JSON_OUTPUT=false
PRIORITY_FILTER=""
LIMIT=20

while [[ $# -gt 0 ]]; do
    case $1 in
        --json|-j)
            JSON_OUTPUT=true
            shift
            ;;
        --priority|-p)
            PRIORITY_FILTER="$2"
            shift 2
            ;;
        --limit|-l)
            LIMIT="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [--json] [--priority N] [--limit N]"
            echo "Find available work using br list (avoids br ready schema bug)"
            echo ""
            echo "Options:"
            echo "  --json, -j       Output as JSON array"
            echo "  --priority, -p N Filter by priority (0-4)"
            echo "  --limit, -l N    Max results (default: 20)"
            echo "  --help, -h       Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 2
            ;;
    esac
done

cd "$PROJECT_ROOT"

# Check dependencies
if ! command -v jq &>/dev/null; then
    echo "Error: jq is required but not installed" >&2
    exit 2
fi

# Use br list --format json which works (unlike br ready)
# Filter for:
#   - status == "open"
#   - issue_type NOT IN ("human", "phase", "epic")
#   - (optional) priority == PRIORITY_FILTER
if $JSON_OUTPUT; then
    # Output as JSON array
    result=$(br list --all --format json 2>/dev/null | jq -c --arg prio "$PRIORITY_FILTER" --argjson limit "$LIMIT" '
        [.[]
        | select(.status == "open")
        | select(.issue_type != "human" and .issue_type != "phase" and .issue_type != "epic")
        | select(.issue_type == "task" or .issue_type == "blocker")
        | if $prio != "" then select(.priority == ($prio | tonumber)) else . end
        | {id, title, priority, issue_type}]
        | sort_by(.priority, .id)
        | .[:$limit]
    ')

    if [[ "$result" == "[]" ]]; then
        echo "[]"
        exit 1
    fi
    echo "$result"
else
    # Output as table
    echo "ID      PRI  TYPE     TITLE"
    echo "------  ---  -------  --------------------------------------------------"

    count=$(br list --all --format json 2>/dev/null | jq -r --arg prio "$PRIORITY_FILTER" '
        .[]
        | select(.status == "open")
        | select(.issue_type != "human" and .issue_type != "phase" and .issue_type != "epic")
        | select(.issue_type == "task" or .issue_type == "blocker")
        | if $prio != "" then select(.priority == ($prio | tonumber)) else . end
        | "\(.id)\t\(.priority)\t\(.issue_type)\t\(.title)"
    ' | sort -t$'\t' -k2,2n -k1,1 | head -$LIMIT | column -t -s $'\t' | tee /dev/stderr | wc -l)

    if [[ $count -eq 0 ]]; then
        echo ""
        echo "No available work found"
        exit 1
    fi

    echo ""
    echo "To claim: br update <bead-id> --status in_progress"
fi
