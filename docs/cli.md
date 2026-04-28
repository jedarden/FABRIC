# FABRIC CLI Reference

Complete reference for all `fabric` commands and options.

## Installation

```bash
npm install -g @needle/fabric
# or
pnpm add -g @needle/fabric
```

The binary installs as `fabric` (or `fabric-node` if there's a naming conflict).

## Commands Overview

| Command | Description |
|---------|-------------|
| `fabric tui` | Launch terminal UI dashboard |
| `fabric web` | Launch web dashboard |
| `fabric tail` / `fabric logs` | Tail log file and display events |
| `fabric replay` | Replay worker session history |
| `fabric prune` | Prune old log files |
| `fabric digest` | Generate session digest from log file |
| `fabric config` | Manage FABRIC configuration |

---

## Global Options

```bash
fabric --help          # Show help
fabric --version       # Show version
```

---

## `fabric tui`

Launch the terminal UI dashboard with real-time worker activity.

### Usage

```bash
fabric tui [options]
```

### Options

| Option | Alias | Default | Description |
|--------|-------|---------|-------------|
| `-f, --file <path>` | — | — | Log file to tail (single-file mode) |
| `--source <path>` | — | `~/.needle/logs/` | Log source (file or directory) |
| `-w, --worker <id>` | — | — | Filter to specific worker ID |
| `-l, --level <level>` | — | — | Filter by log level (`debug`, `info`, `warn`, `error`) |
| `--otlp-grpc <addr>` | — | — | Enable OTLP/gRPC receiver (e.g. `:4317` or `0.0.0.0:4317`) |
| `--otlp-http <addr>` | — | — | Enable OTLP/HTTP receiver (e.g. `:4318` or `0.0.0.0:4318`) |

### Examples

```bash
# Basic TUI watching default log directory
fabric tui

# Watch a specific directory
fabric tui --source /var/log/needle/

# Filter to one worker
fabric tui --worker w-alpha

# Filter by log level
fabric tui --level error

# With OTLP live telemetry
fabric tui --otlp-grpc :4317

# Combine log file tailing with OTLP
fabric tui --source ~/.needle/logs/ --otlp-grpc 0.0.0.0:4317
```

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `q` | Quit |
| `Tab` | Switch panels |
| `j` / `k` | Scroll down/up |
| `/` | Search |
| `f` | Filter |
| `Ctrl+P` | Command palette |

---

## `fabric web`

Launch the web dashboard with real-time updates via WebSocket.

### Usage

```bash
fabric web [options]
```

### Options

| Option | Alias | Default | Description |
|--------|-------|---------|-------------|
| `-p, --port <number>` | — | `3000` | Port to listen on |
| `-f, --file <path>` | — | — | Log file to tail (single-file mode) |
| `--source <path>` | — | `~/.needle/logs/` | Log source (file or directory) |
| `-w, --worker <id>` | — | — | Filter to specific worker ID |
| `-l, --level <level>` | — | — | Filter by log level |
| `-a, --auth-token <token>` | — | `$FABRIC_AUTH_TOKEN` | Auth token for POST endpoints |
| `--otlp-grpc <addr>` | — | — | Enable OTLP/gRPC receiver |
| `--otlp-http <addr>` | — | — | Enable OTLP/HTTP receiver |
| `--max-events <number>` | — | — | Max events in store before liveness guard exits |
| `--heap-snapshots` | — | `true` in production | Enable automatic heap snapshot capture |
| `--snapshot-interval <minutes>` | — | `30` | Interval between heap snapshots |

### Examples

```bash
# Basic web server on default port
fabric web

# Custom port
fabric web --port 8080

# With auth token
FABRIC_AUTH_TOKEN=secret fabric web
fabric web --auth-token secret

# With OTLP/HTTP receiver
fabric web --otlp-http :4318

# With memory-bomb guard
fabric web --max-events 1000000
```

### Access

- Local: `http://localhost:3000`
- Remote (via Tailscale): `https://hetzner-ex44.tail1b1987.ts.net/`

### Authentication

POST endpoints (`/api/events`, `/api/events/batch`) require `Authorization: Bearer <token>` when an auth token is configured.

---

## `fabric tail` / `fabric logs`

Tail log file and display events. `logs` is an alias for `tail`.

### Usage

```bash
fabric tail [options]
fabric logs [options]
```

### Options

| Option | Alias | Default | Description |
|--------|-------|---------|-------------|
| `-f, --file <path>` | — | — | Log file to tail (single-file mode) |
| `--source <path>` | — | `~/.needle/logs/` | Log source (file or directory) |
| `-w, --worker <id>` | — | — | Filter by worker ID |
| `-t, --event-type <pattern>` | — | — | Filter by event type (glob, e.g. `bead.*`, `worker.started`) |
| `-l, --level <level>` | — | — | Filter by log level (deprecated: use `--event-type`) |
| `-n, --lines <number>` | — | `0` | Number of existing lines to show |
| `--no-follow` | — | — | Exit after reading existing lines |
| `--json` | — | — | Output raw JSON instead of formatted |
| `--otlp-grpc <addr>` | — | — | Enable OTLP/gRPC receiver |
| `--otlp-http <addr>` | — | — | Enable OTLP/HTTP receiver |

### Examples

```bash
# Stream events from default directory
fabric tail

# Show last 100 lines and follow
fabric tail -n 100

# Filter by worker
fabric tail --worker w-alpha

# Filter by event type
fabric tail --event-type "bead.*"

# Raw JSON output
fabric tail --json

# Exit after reading (no follow)
fabric tail --no-follow -n 50

# With OTLP
fabric tail --otlp-grpc :4317
```

---

## `fabric replay`

Replay worker session history chronologically with timeline scrubbing.

### Usage

```bash
fabric replay [options]
```

### Options

| Option | Alias | Default | Description |
|--------|-------|---------|-------------|
| `-f, --file <path>` | — | `~/.needle/logs/workers.log` | Log file to replay |
| `-w, --worker <id>` | — | — | Filter by worker ID |
| `-t, --event-type <pattern>` | — | — | Filter by event type (glob) |
| `-l, --level <level>` | — | — | Filter by log level (deprecated) |
| `-s, --speed <speed>` | — | `1` | Playback speed (`0.5`, `1`, `2`, `5`, `10`) |
| `--auto` | — | — | Start playback automatically |

### Playback Speeds

- `0.5` - Half speed
- `1` - Normal speed (default)
- `2` - 2x speed
- `5` - 5x speed
- `10` - 10x speed

### Keyboard Controls

| Key | Action |
|-----|--------|
| `q` / `C-c` | Quit |
| `Escape` | Quit |
| `Space` | Play/Pause |
| `←` / `→` | Seek backward/forward |
| `Home` / `End` | Jump to start/end |

### Examples

```bash
# Replay default log file
fabric replay

# Replay specific file
fabric replay --file /path/to/session.jsonl

# Filter by worker
fabric replay --worker w-alpha

# 2x speed, auto-start
fabric replay --speed 2 --auto
```

---

## `fabric prune`

Prune old log files (archive + delete).

### Usage

```bash
fabric prune [options]
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--source <path>` | `~/.needle/logs/` | Log directory to prune |
| `--archive-after <days>` | `3` | Archive files older than N days |
| `--archive-retain <days>` | `30` | Delete archives older than N days |
| `--max-age <days>` | `7` | Delete files older than N days regardless |
| `--dry-run` | — | Report what would happen without making changes |

### Archive Structure

Archives are created as `~/.needle/logs/archive/YYYY-MM-DD.tar.gz`.

### Examples

```bash
# Dry run to see what would happen
fabric prune --dry-run

# Run with defaults
fabric prune

# Custom retention
fabric prune --archive-after 5 --max-age 14 --archive-retain 60

# Prune different directory
fabric prune --source /var/log/needle/
```

### Cron Setup

```bash
# Daily at 03:17
17 3 * * * ~/.local/bin/fabric prune
```

---

## `fabric digest`

Generate session digest from log file.

### Usage

```bash
fabric digest [options]
```

### Options

| Option | Alias | Default | Description |
|--------|-------|---------|-------------|
| `-f, --file <path>` | — | `~/.needle/logs/workers.log` | Log file to analyze |
| `-o, --output <path>` | — | — | Output file (default: stdout) |
| `-w, --worker <ids>` | — | — | Filter by worker IDs (comma-separated) |
| `--since <timestamp>` | — | — | Start time (Unix timestamp in ms) |
| `--until <timestamp>` | — | — | End time (Unix timestamp in ms) |
| `--max-files <number>` | — | `50` | Maximum files to list |
| `--max-errors <number>` | — | `20` | Maximum errors to list |
| `--no-cost` | — | — | Exclude cost information |
| `--no-errors` | — | — | Exclude error information |

### Examples

```bash
# Generate digest to stdout
fabric digest

# Save to file
fabric digest --output session-summary.md

# Filter by workers
fabric digest --worker w-alpha,w-bravo

# Time range
fabric digest --since 1709337600000 --until 1709424000000

# Exclude cost and errors
fabric digest --no-cost --no-errors
```

---

## `fabric config`

Manage FABRIC configuration (theme, presets, recent commands, filters).

### Usage

```bash
# Show all config
fabric config

# Subcommands
fabric config theme [dark|light]
fabric config presets list
fabric config presets delete <name>
fabric config clear [options]
```

### `fabric config`

Show current configuration.

```bash
fabric config
```

Output includes:
- Theme setting
- Focus presets
- Recent commands
- Filter state

### `fabric config theme`

Show or set color theme.

```bash
# Show current theme
fabric config theme

# Set theme
fabric config theme dark
fabric config theme light
```

### `fabric config presets`

Manage focus presets.

```bash
# List all presets
fabric config presets list
fabric config presets ls

# Delete a preset
fabric config presets delete my-preset
fabric config presets rm my-preset
```

### `fabric config clear`

Clear configuration state.

```bash
# Clear all config
fabric config clear --all

# Clear specific categories
fabric config clear --theme
fabric config clear --presets
fabric config clear --commands
fabric config clear --filters
```

### Config File Locations

| Config | Path |
|--------|------|
| Theme | `~/.fabric/theme.json` |
| Presets | `~/.fabric/focus-presets.json` |
| Recent commands | `~/.fabric/recent-commands.json` |
| Filter state | `~/.fabric-filter-state.json` |

---

## OTLP Receivers

FABRIC can receive telemetry via OpenTelemetry Protocol (OTLP) from NEEDLE workers.

### `--otlp-grpc`

Enable OTLP/gRPC receiver.

```bash
fabric tui --otlp-grpc :4317
fabric web --otlp-grpc 0.0.0.0:4317
fabric tail --otlp-grpc :4317
```

| Format | Binds to |
|--------|----------|
| `:4317` | `0.0.0.0:4317` |
| `127.0.0.1:4317` | `127.0.0.1:4317` |
| `0.0.0.0:4317` | `0.0.0.0:4317` |

### `--otlp-http`

Enable OTLP/HTTP receiver.

```bash
fabric tui --otlp-http :4318
fabric web --otlp-http 0.0.0.0:4318
fabric tail --otlp-http :4318
```

### NEEDLE Configuration

Set environment variables before launching NEEDLE workers:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://fabric-host:4317
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
needle run ...
```

---

## Common Patterns

### Multiple Sources

Combine log file tailing with OTLP live telemetry:

```bash
fabric tui --source ~/.needle/logs/ --otlp-grpc :4317
```

Events from both sources are merged and deduplicated.

### Filtering

Most commands support worker and level filtering:

```bash
fabric tui --worker w-alpha --level error
fabric tail --worker w-alpha --event-type "bead.*"
fabric replay --worker w-bravo
```

### Production Service

Run as a systemd service with OTLP/HTTP:

```bash
systemctl --user start fabric-web.service
```

Service file at `scripts/fabric-web.service` runs:
```bash
fabric web --port 3000 --source ~/.needle/logs/ --otlp-http :4318
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (invalid options, file not found, runtime error) |

---

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `FABRIC_AUTH_TOKEN` | Auth token for POST endpoints (overrides `--auth-token`) |
| `NODE_ENV` | When `production`, enables heap snapshots by default |
| `WATCHDOG_USEC` | systemd watchdog timeout (enables watchdog ping) |
| `NOTIFY_SOCKET` | systemd notification socket (for watchdog) |

---

## See Also

- [Plan](plan.md) - Implementation roadmap
- [Schema](schema.md) - NeedleEvent wire format
- [Metrics](metrics.md) - Prometheus metrics export
- [README](../README.md) - Project overview
