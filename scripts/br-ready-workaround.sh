#!/bin/bash
# br-ready-workaround.sh
# Workaround for "br ready" schema bug (Invalid column type Text at index: 14, name: created_by)
#
# Usage:
#   ./br-ready-workaround.sh [--priority N] [--type TYPE]
#
# This script replicates br ready functionality using br list --all --format json
# until the schema bug is fixed.

set -euo pipefail

PRIORITY_FILTER=""
TYPE_FILTER=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --priority|-p)
            PRIORITY_FILTER="$2"
            shift 2
            ;;
        --type|-t)
            TYPE_FILTER="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Get all beads as JSON and filter with jq
br list --all --format json 2>/dev/null | jq -c --arg prio "$PRIORITY_FILTER" --arg type "$TYPE_FILTER" '
    .[]
    | select(.status == "open")
    | select(.issue_type != "human" and .issue_type != "phase" and .issue_type != "epic")
    | if $prio != "" then select(.priority == ($prio | tonumber)) else . end
    | if $type != "" then select(.issue_type == $type) else . end
    | {id, title, priority, issue_type, labels}
    | [.id, "P\(.priority)", .issue_type, .title]
    | @tsv
' -r | head -20 | column -t -s $'\t'

echo ""
echo "To work on a bead, use: br update <bead-id> --status in_progress"
