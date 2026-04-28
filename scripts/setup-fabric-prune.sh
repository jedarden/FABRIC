#!/bin/bash
# Setup FABRIC log pruning systemd timer
# Run: ./scripts/setup-fabric-prune.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

echo "==> Installing fabric-prune systemd timer..."

# Create symlinks in ~/.config/systemd/user/
mkdir -p ~/.config/systemd/user
ln -sf "$REPO_ROOT/scripts/fabric-prune.service" ~/.config/systemd/user/fabric-prune.service
ln -sf "$REPO_ROOT/scripts/fabric-prune.timer" ~/.config/systemd/user/fabric-prune.timer

# Reload systemd daemon
systemctl --user daemon-reload

# Enable and start the timer
systemctl --user enable fabric-prune.timer
systemctl --user start fabric-prune.timer

echo "==> Timer installed and enabled!"
echo "    Check status: systemctl --user status fabric-prune.timer"
echo "    View logs: journalctl --user -u fabric-prune.service"
echo "    Next run: systemctl --user list-timers fabric-prune.timer"
