#!/usr/bin/env bash
# Configure Tailscale Serve to expose FABRIC dashboard over Tailscale with TLS.
# Tailnet-only (not public internet). Run once; config persists across reboots.
#
# Prerequisites:
#   - tailscale connected to tail1b1987.ts.net
#   - Current user is set as Tailscale operator (handled below)
#   - fabric-web.service running (fabric web on :3000)
#
# After setup: https://codinghome.tail1b1987.ts.net/
#
# NOTE: codinghome's serve config also carries an https://...:8443 handler
# (jedarden-preview-web → 127.0.0.1:45129). The command below only sets the
# 443 handler and leaves that one untouched — do not run `tailscale serve reset`
# or `tailscale serve --https=8443 off` for FABRIC work.

set -euo pipefail

# Grant operator access so future serve commands don't need sudo
sudo tailscale set --operator="$USER"

# Configure HTTPS serve on 443 (tailnet-only, not Funnel)
tailscale serve --bg --https=443 http://localhost:3000

echo ""
echo "Tailscale Serve configured."
tailscale serve status
echo ""
echo "Dashboard: https://codinghome.tail1b1987.ts.net/"
echo "To remove:  tailscale serve --https=443 off"
