#!/bin/bash
#
# FABRIC Web Server Startup Script
#
# Usage:
#   fabric-web.sh start    - Start FABRIC web server in tmux session
#   fabric-web.sh stop     - Stop FABRIC web server
#   fabric-web.sh restart  - Restart FABRIC web server
#   fabric-web.sh status   - Check if FABRIC web server is running
#   fabric-web.sh logs     - Attach to FABRIC web server logs
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FABRIC_DIR="$(dirname "$SCRIPT_DIR")"
SESSION_NAME="fabric-web"
PORT="${FABRIC_PORT:-3000}"
LOG_PATH="${FABRIC_LOG_PATH:-$HOME/.needle/logs/workers.log}"
PID_FILE="$HOME/.fabric-web.pid"

start() {
    if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
        echo "FABRIC web server already running in tmux session '$SESSION_NAME'"
        return 1
    fi

    echo "Starting FABRIC web server on port $PORT..."
    echo "Log path: $LOG_PATH"

    # Create logs directory if needed
    mkdir -p "$HOME/.fabric/logs"

    # Start tmux session with FABRIC web server
    tmux new-session -d -s "$SESSION_NAME" -c "$FABRIC_DIR" \
        "node dist/cli.js web -p $PORT -f $LOG_PATH 2>&1 | tee -a $HOME/.fabric/logs/web.log"

    # Save PID for reference
    tmux list-panes -t "$SESSION_NAME" -F '#{pane_pid}' > "$PID_FILE" 2>/dev/null || true

    sleep 1

    if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
        echo "FABRIC web server started successfully"
        echo "  Dashboard: http://localhost:$PORT"
        echo "  Health:    http://localhost:$PORT/api/health"
        echo "  Logs:      $HOME/.fabric/logs/web.log"
        echo "  Tmux:      tmux attach -t $SESSION_NAME"
        return 0
    else
        echo "Failed to start FABRIC web server"
        return 1
    fi
}

stop() {
    if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
        echo "FABRIC web server is not running"
        rm -f "$PID_FILE"
        return 0
    fi

    echo "Stopping FABRIC web server..."
    tmux kill-session -t "$SESSION_NAME"
    rm -f "$PID_FILE"
    echo "FABRIC web server stopped"
}

restart() {
    stop
    sleep 1
    start
}

status() {
    if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
        echo "FABRIC web server is RUNNING (tmux session: $SESSION_NAME)"
        echo ""
        tmux list-sessions | grep "$SESSION_NAME"

        # Check health endpoint
        if command -v curl &>/dev/null; then
            echo ""
            echo "Health check:"
            curl -s "http://localhost:$PORT/api/health" 2>/dev/null || echo "  (unable to reach health endpoint)"
        fi
        return 0
    else
        echo "FABRIC web server is NOT RUNNING"
        return 1
    fi
}

logs() {
    if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
        echo "FABRIC web server is not running"
        return 1
    fi

    echo "Attaching to FABRIC web server logs (Ctrl+B D to detach)..."
    tmux attach -t "$SESSION_NAME"
}

case "${1:-}" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    status)
        status
        ;;
    logs)
        logs
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs}"
        echo ""
        echo "Environment variables:"
        echo "  FABRIC_PORT     - Port to listen on (default: 3000)"
        echo "  FABRIC_LOG_PATH - Log file to tail (default: ~/.needle/logs/workers.log)"
        exit 1
        ;;
esac
