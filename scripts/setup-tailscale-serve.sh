#!/usr/bin/env bash
# Configure Tailscale Serve to expose FABRIC dashboard over Tailscale with TLS.
# Tailnet-only (not public internet). Run once; config persists across reboots.
#
# Prerequisites:
#   - tailscale connected to tail1b1987.ts.net
#   - Current user is set as Tailscale operator (handled below)
#   - fabric-web.service running (fabric web on :3000)
#
# After setup: https://hetzner-ex44.tail1b1987.ts.net/

set -euo pipefail

# Grant operator access so future serve commands don't need sudo
sudo tailscale set --operator="$USER"

# Configure HTTPS serve (tailnet-only, not Funnel)
tailscale serve --bg http://localhost:3000

echo ""
echo "Tailscale Serve configured."
tailscale serve status
echo ""
echo "Dashboard: https://hetzner-ex44.tail1b1987.ts.net/"
echo "To remove:  tailscale serve --https=443 off"
