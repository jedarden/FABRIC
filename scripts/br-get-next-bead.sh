#!/bin/bash
# br-get-next-bead.sh
# ALT-006: Direct ready-queue.json reader
#
# This is an ALTERNATIVE to br ready that reads the pre-computed
# ready-queue.json file instead of querying the database.
#
# Usage:
#   ./scripts/br-get-next-bead.sh           # Get highest priority bead
#   ./scripts/br-get-next-bead.sh --claim   # Get and claim the bead
#   ./scripts/br-get-next-bead.sh --json    # Output as JSON
#
# For HUMAN bead bd-3sh - Worker starvation alternative solution

set -euo pipefail

READY_QUEUE="/home/coder/FABRIC/.beads/ready-queue.json"
CLAIM_MODE=false
JSON_OUTPUT=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --claim|-c)
            CLAIM_MODE=true
            shift
            ;;
        --json|-j)
            JSON_OUTPUT=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [--claim] [--json]"
            echo ""
            echo "Options:"
            echo "  --claim, -c    Claim the bead (set status to in_progress)"
            echo "  --json, -j     Output as JSON"
            echo "  --help, -h     Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Check if ready-queue exists
if [[ ! -f "$READY_QUEUE" ]]; then
    echo "ERROR: ready-queue.json not found at $READY_QUEUE" >&2
    echo "Run the queue generator first or use br-ready-workaround.sh" >&2
    exit 1
fi

# Get the first available bead (highest priority)
NEXT_BEAD=$(jq -c '.beads[0]' "$READY_QUEUE" 2>/dev/null)

if [[ -z "$NEXT_BEAD" || "$NEXT_BEAD" == "null" ]]; then
    echo "ERROR: No beads available in ready-queue.json" >&2
    exit 1
fi

BEAD_ID=$(echo "$NEXT_BEAD" | jq -r '.id')
BEAD_TITLE=$(echo "$NEXT_BEAD" | jq -r '.title')
BEAD_PRIORITY=$(echo "$NEXT_BEAD" | jq -r '.priority')

if [[ "$JSON_OUTPUT" == "true" ]]; then
    echo "$NEXT_BEAD"
else
    echo "Next available bead:"
    echo "  ID: $BEAD_ID"
    echo "  Priority: P$BEAD_PRIORITY"
    echo "  Title: $BEAD_TITLE"
fi

# Claim the bead if requested
if [[ "$CLAIM_MODE" == "true" ]]; then
    echo ""
    echo "Claiming bead $BEAD_ID..."
    br update "$BEAD_ID" --status in_progress
    echo "Bead claimed! Start working on: $BEAD_TITLE"
fi
