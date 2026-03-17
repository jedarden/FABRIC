#!/usr/bin/env bash
# FABRIC web service management script
# Usage: ./scripts/service.sh [start|stop|restart|status|logs|enable|disable|build|deploy]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
UNIT="fabric-web.service"

case "${1:-status}" in
  start)
    systemctl --user start "$UNIT"
    echo "FABRIC web service started"
    ;;
  stop)
    systemctl --user stop "$UNIT"
    echo "FABRIC web service stopped"
    ;;
  restart)
    systemctl --user restart "$UNIT"
    echo "FABRIC web service restarted"
    ;;
  status)
    systemctl --user status "$UNIT"
    ;;
  logs)
    journalctl --user -u "$UNIT" -f "${2:---output=cat}"
    ;;
  enable)
    systemctl --user enable "$UNIT"
    echo "FABRIC web service enabled (will start on boot)"
    ;;
  disable)
    systemctl --user disable "$UNIT"
    echo "FABRIC web service disabled"
    ;;
  build)
    echo "Building FABRIC..."
    cd "$PROJECT_DIR"
    npm run build
    npm run build:web
    echo "Build complete"
    ;;
  deploy)
    echo "Building and deploying FABRIC..."
    cd "$PROJECT_DIR"
    npm run build
    npm run build:web
    systemctl --user restart "$UNIT"
    echo "Deploy complete. Service restarted."
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs|enable|disable|build|deploy}"
    exit 1
    ;;
esac
