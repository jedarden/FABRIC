#!/bin/bash
# br-ready-wrapper.sh
# Drop-in replacement for "br ready" that works around the schema bug.
#
# This script outputs the same format as "br ready" so it can be used as a
# direct replacement in worker scripts.
#
# Usage:
#   ./scripts/br-ready-wrapper.sh           # Equivalent to "br ready"
#   ./scripts/br-ready-wrapper.sh --json    # JSON output format
#
# To use as a permanent replacement:
#   alias br-ready='./scripts/br-ready-wrapper.sh'
#   # Or add to ~/.bashrc:
#   export PATH="$HOME/FABRIC/scripts:$PATH"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

JSON_OUTPUT=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --json|-j)
            JSON_OUTPUT=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--json]"
            echo "Drop-in replacement for 'br ready' command"
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

cd "$PROJECT_ROOT"

if $JSON_OUTPUT; then
    # Output as JSON array (same format as br ready --json)
    br list --all --format json 2>/dev/null | jq -c '
        [.[]
        | select(.status == "open")
        | select(.issue_type != "human" and .issue_type != "phase" and .issue_type != "epic")
        | {id, title, priority, issue_type, labels, dependencies}]
    '
else
    # Output in tabular format (similar to br ready)
    echo "ID      PRI  TYPE    TITLE"
    echo "------  ---  ------  --------------------------------------------------"
    br list --all --format json 2>/dev/null | jq -r '
        .[]
        | select(.status == "open")
        | select(.issue_type != "human" and .issue_type != "phase" and .issue_type != "epic")
        | "\(.id)\t\(.priority)\t\(.issue_type)\t\(.title)"
    ' | sort -t$'\t' -k2,2n -k1,1 | head -20 | while IFS=$'\t' read -r id pri type title; do
        printf "%-7s P%-3d %-7s %s\n" "$id" "$pri" "$type" "$title"
    done
    echo ""
    echo "To claim: br update <bead-id> --status in_progress"
fi
