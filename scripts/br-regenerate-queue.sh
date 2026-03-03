#!/bin/bash
# br-regenerate-queue.sh
# ALT-006配套: Regenerate ready-queue.json
#
# This script regenerates the ready-queue.json file by querying br list
# and filtering for available work.
#
# Should be run periodically or when new beads are created.
#
# Usage:
#   ./scripts/br-regenerate-queue.sh

set -euo pipefail

BEADS_DIR="/home/coder/FABRIC/.beads"
READY_QUEUE="$BEADS_DIR/ready-queue.json"

echo "Regenerating ready-queue.json..."

# Generate the queue using br list workaround
BEADS_JSON=$(br list --all --format json 2>/dev/null | jq -c '
    [.[]
    | select(.status == "open")
    | select(.issue_type != "human" and .issue_type != "phase" and .issue_type != "epic")
    | {id, title, priority: .priority, type: .issue_type, labels}
    ] | sort_by(.priority)
')

# Count beads
COUNT=$(echo "$BEADS_JSON" | jq 'length')

# Create the output
jq -n \
    --arg generated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg source "br-list-workaround" \
    --arg br_status "$(br ready 2>&1 | head -1 || echo 'unknown')" \
    --argjson beads "$BEADS_JSON" \
    '{
        generated_at: $generated,
        source: $source,
        br_ready_status: (if $br_status | contains("Invalid column") then "broken" else "working" end),
        total_available: ($beads | length),
        workers_should_read: "This file contains available work. Read .beads[0] to get the highest priority bead.",
        beads: $beads
    }' > "$READY_QUEUE"

echo "Done! $COUNT beads available in $READY_QUEUE"
echo ""
echo "Next bead: $(jq -r '.beads[0].id + " - " + .beads[0].title' "$READY_QUEUE")"
