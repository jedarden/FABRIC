#!/bin/bash
# Configure ex44 NEEDLE to send OTLP telemetry to lab FABRIC collector
# This script should be run ON ex44 (after copying it there or accessing via SSH)
#
# Usage: ./configure-ex44-otlp.sh [--dry-run]
#
# Per ADR-1: Centralize FABRIC as a Multi-Host OTLP Collector

set -e

DRY_RUN=false
if [[ "$1" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "DRY RUN MODE - No changes will be made"
fi

LAB_FABRIC_OTLP="http://100.81.129.38:4318"
NEEDLE_CONFIG="$HOME/.needle/config.yaml"
BACKUP_SUFFIX=".pre-otlp-$(date +%Y%m%d_%H%M%S)"

echo "========================================"
echo "ex44 NEEDLE OTLP Configuration"
echo "========================================"
echo ""
echo "This will configure ex44 NEEDLE to send OTLP telemetry to:"
echo "  $LAB_FABRIC_OTLP"
echo ""

# Check if running on ex44
HOSTNAME=$(hostname)
if [[ ! "$HOSTNAME" =~ ex44 ]]; then
  echo "⚠️  Warning: This script is intended for ex44 (current: $HOSTNAME)"
  echo "    Proceeding anyway for testing purposes..."
fi

# Check if NEEDLE config exists
if [[ ! -f "$NEEDLE_CONFIG" ]]; then
  echo "❌ Error: NEEDLE config not found at $NEEDLE_CONFIG"
  echo "   Is NEEDLE installed on this host?"
  exit 1
fi

echo "📋 Current config:"
echo "   Location: $NEEDLE_CONFIG"
echo ""

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
  # Enable OTLP sink with lab endpoint
  sed -i 's|endpoint: http://localhost:4317|endpoint: '"$LAB_FABRIC_OTLP"'|g' "$NEEDLE_CONFIG"
  sed -i 's|endpoint: http://localhost:4318|endpoint: '"$LAB_FABRIC_OTLP"'|g' "$NEEDLE_CONFIG"

  # Ensure OTLP is enabled
  sed -i 's|otlp_sink:|otlp_sink:\n  enabled: true|g' "$NEEDLE_CONFIG"
  sed -i '/^[[:space:]]*enabled: false[[:space:]]*$/s|enabled: false|enabled: true|' "$NEEDLE_CONFIG"

  # Disable fabric HTTP POST (no listener on ex44)
  sed -i '/^[[:space:]]*fabric:/,/^[[:space:]]*[^[:space:]]/ {
    s/enabled: true/enabled: false/g
  }' "$NEEDLE_CONFIG"

  echo "   ✅ Configuration updated"
else
  echo "   [DRY RUN] Would update:"
  echo "   - telemetry.otlp_sink.endpoint → $LAB_FABRIC_OTLP"
  echo "   - telemetry.otlp_sink.enabled → true"
  echo "   - fabric.enabled → false"
fi

echo ""
echo "📊 Verification:"
echo "   Lab FABRIC OTLP endpoint: $LAB_FABRIC_OTLP"
echo "   Protocol: http/protobuf"
echo "   Transport: Tailscale mesh network"
echo ""

# Verify Tailscale connectivity
if command -v tailscale &> /dev/null; then
  if [[ "$DRY_RUN" == "false" ]]; then
    echo "🔍 Testing Tailscale connectivity to lab..."
    if curl -s --connect-timeout 5 "http://100.81.129.38:4318" > /dev/null 2>&1; then
      echo "   ✅ Successfully connected to lab OTLP endpoint"
    else
      echo "   ⚠️  Warning: Could not connect to lab OTLP endpoint"
      echo "      This may be due to firewall or Tailscale configuration"
    fi
  else
    echo "   [DRY RUN] Would test connectivity to $LAB_FABRIC_OTLP"
  fi
else
  echo "⚠️  Tailscale not found - ensure Tailscale mesh is configured"
fi

echo ""
echo "🔄 Next steps:"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "   1. Run without --dry-run flag to apply changes"
else
  echo "   1. Restart NEEDLE workers to pick up new config"
  echo "   2. Verify in lab FABRIC dashboard: curl http://localhost:3000/api/summary"
  echo "   3. To revert: cp ${NEEDLE_CONFIG}${BACKUP_SUFFIX} $NEEDLE_CONFIG"
fi

echo ""
echo "✨ Configuration complete!"
