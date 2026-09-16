#!/bin/bash
# Configure NEEDLE to send OTLP telemetry to the FABRIC collector
# (renamed from configure-ex44-otlp.sh — ex44 was decommissioned 2026-08-30)
#
# Default target is the FABRIC collector on codinghome (localhost:4318).
# Override with FABRIC_OTLP_ENDPOINT when running on a remote host, e.g.:
#   FABRIC_OTLP_ENDPOINT=http://codinghome.tail1b1987.ts.net:4318 ./configure-otlp.sh
#
# Usage: ./configure-otlp.sh [--dry-run]
#
# Per ADR-1: Centralize FABRIC as a Multi-Host OTLP Collector
# See docs/otlp-config.md for the current topology.

set -e

DRY_RUN=false
if [[ "$1" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "DRY RUN MODE - No changes will be made"
fi

FABRIC_OTLP="${FABRIC_OTLP_ENDPOINT:-http://localhost:4318}"
NEEDLE_CONFIG="$HOME/.needle/config.yaml"
BACKUP_SUFFIX=".pre-otlp-$(date +%Y%m%d_%H%M%S)"

echo "========================================"
echo "NEEDLE OTLP Configuration (FABRIC collector)"
echo "========================================"
echo ""
echo "This will configure NEEDLE on '$(hostname)' to send OTLP telemetry to:"
echo "  $FABRIC_OTLP"
echo ""

# Check if NEEDLE config exists
if [[ ! -f "$NEEDLE_CONFIG" ]]; then
  echo "❌ Error: NEEDLE config not found at $NEEDLE_CONFIG"
  echo "   Is NEEDLE installed on this host?"
  exit 1
fi

echo "📋 Current config:"
echo "   Location: $NEEDLE_CONFIG"
echo ""

# Refuse to silently clobber a config already pointing at a different live
# collector (e.g. codinghome's fleet collector) — changing that is a
# deliberate operator decision, not something to do in passing.
if grep -q "otlp_sink:" "$NEEDLE_CONFIG" && \
   grep -E "^\s*endpoint:" "$NEEDLE_CONFIG" | grep -qv "localhost:4318\|$FABRIC_OTLP"; then
  echo "⚠️  This config already has an otlp_sink endpoint pointing somewhere else:"
  grep -E "^\s*endpoint:" "$NEEDLE_CONFIG" || true
  echo "   Repointing it affects live fleet telemetry. Review before proceeding."
  if [[ "$DRY_RUN" == "false" ]]; then
    echo "   Set FORCE_OTLP_RECONFIG=1 to proceed anyway."
    [[ "${FORCE_OTLP_RECONFIG:-}" == "1" ]] || exit 1
  fi
fi

# Backup existing config
if [[ "$DRY_RUN" == "false" ]]; then
  echo "💾 Backing up current config..."
  cp "$NEEDLE_CONFIG" "${NEEDLE_CONFIG}${BACKUP_SUFFIX}"
  echo "   Backup: ${NEEDLE_CONFIG}${BACKUP_SUFFIX}"
else
  echo "💾 [DRY RUN] Would backup config to: ${NEEDLE_CONFIG}${BACKUP_SUFFIX}"
fi

echo ""
echo "🔧 Applying OTLP configuration..."

# Modify the config using sed
if [[ "$DRY_RUN" == "false" ]]; then
  # Point the OTLP sink at the FABRIC collector
  sed -i 's|endpoint: http://localhost:4317|endpoint: '"$FABRIC_OTLP"'|g' "$NEEDLE_CONFIG"
  sed -i 's|endpoint: http://localhost:4318|endpoint: '"$FABRIC_OTLP"'|g' "$NEEDLE_CONFIG"

  # Ensure OTLP is enabled
  sed -i 's|otlp_sink:|otlp_sink:\n  enabled: true|g' "$NEEDLE_CONFIG"
  sed -i '/^[[:space:]]*enabled: false[[:space:]]*$/s|enabled: false|enabled: true|' "$NEEDLE_CONFIG"

  # Disable fabric HTTP POST — OTLP is the canonical path (ADR-1)
  sed -i '/^[[:space:]]*fabric:/,/^[[:space:]]*[^[:space:]]/ {
    s/enabled: true/enabled: false/g
  }' "$NEEDLE_CONFIG"

  echo "   ✅ Configuration updated"
else
  echo "   [DRY RUN] Would update:"
  echo "   - telemetry.otlp_sink.endpoint → $FABRIC_OTLP"
  echo "   - telemetry.otlp_sink.enabled → true"
  echo "   - fabric.enabled → false"
fi

echo ""
echo "📊 Verification:"
echo "   FABRIC OTLP endpoint: $FABRIC_OTLP"
echo "   Protocol: http/protobuf"
echo ""

# Verify connectivity to the collector
echo "🔍 Testing connectivity to the collector..."
if curl -s --connect-timeout 5 -o /dev/null "http://localhost:3000/api/health" 2>/dev/null \
   || curl -s --connect-timeout 5 -o /dev/null "$FABRIC_OTLP" 2>/dev/null; then
  echo "   ✅ Collector is reachable"
else
  echo "   ⚠️  Warning: could not reach the FABRIC collector"
  echo "      Check that fabric-web.service is running (systemctl --user status fabric-web.service)"
fi

echo ""
echo "🔄 Next steps:"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "   1. Run without --dry-run flag to apply changes"
else
  echo "   1. Restart NEEDLE workers to pick up new config"
  echo "   2. Verify events appear: curl http://localhost:3000/api/summary"
  echo "   3. To revert: cp ${NEEDLE_CONFIG}${BACKUP_SUFFIX} $NEEDLE_CONFIG"
fi

echo ""
echo "✨ Configuration complete!"
