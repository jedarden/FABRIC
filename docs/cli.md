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

The TUI is a view state machine: exactly one view is active at a time — the
`default` view plus the twelve overlay views listed below. View-entry keys
work from any view, `Escape` always steps back, and the in-app help overlay
(`?`) mirrors this reference.

#### Global keys (active in every view)

| Key | Action |
|-----|--------|
| `q` / `Ctrl+C` | Quit FABRIC |
| `?` | Toggle the help overlay |
| `Tab` / `Shift+Tab` | Move panel focus to the next / previous panel |
| `Enter` | Open the detail overlay for the worker selected in the worker grid (`Escape` closes it first) |
| `Escape` | Close the worker detail overlay if it is open; otherwise return to the default view (no-op if already there) |
| `Ctrl+K` | Command palette (see below) |
| `Ctrl+T` | Toggle dark / light theme |
| `r` | Re-render the screen — note this key also toggles session replay (see *Binding conflicts*) |

#### Views — entry and exit

| View | Header | Enter with |
|------|--------|------------|
| Default (worker grid + activity stream) | `FABRIC - Worker Activity Monitor` | startup, `Escape`, or toggling a view off |
| File heatmap | `FABRIC - File Heatmap` | `H` or `h` |
| Task dependency DAG | `FABRIC - Task Dependency DAG` | `D` or `d` |
| Session replay | `FABRIC - Session Replay` | `R` or `r` |
| Error groups | `FABRIC - Error Groups` | `E` or `e` |
| Session digest | `FABRIC - Session Digest` | `G` or `g` |
| Collision alerts | `FABRIC - Collision Alerts` | `C` or `c` |
| Git integration | `FABRIC - Git Integration` | `I` |
| Semantic narrative | `FABRIC - Semantic Narrative` | `N` |
| Worker analytics | `FABRIC - Worker Analytics` | `A` |
| Conversation transcript | `FABRIC - Conversation Transcript` | `T` |
| Cross references | `FABRIC - Cross References` | `X` |
| Budget dashboard | `FABRIC - Budget Dashboard` | `B` |

Semantics:

- **Entry** hides the default worker grid and activity stream, closes the
  file-context split if it is open, moves keyboard focus to the view,
  refreshes its data, and rewrites the header and footer to the view's hints.
- **Views are mutually exclusive.** Pressing another view's key while a view
  is open switches directly to that view.
- **Exit** = press the view's key again (every view key is a toggle), press
  `Escape`, or press a different view's key.

#### Per-view keys

Per-view keys act on the focused view element; the view takes focus on entry.

**Default view** (worker grid + activity stream):

| Key | Action |
|-----|--------|
| `↑`/`↓` or `j`/`k` | Select previous / next worker (worker grid focused) |
| `g` / `G` | Jump to first / last worker (also toggles the digest view — see *Binding conflicts*) |
| `Enter` | Worker detail overlay |
| `p` / `P` | Pin/unpin the selected worker / its current bead |
| `F` | Toggle focus mode: unpinned activity is muted, footer shows a `FOCUS MODE` badge with the pinned ids |
| `[` / `]` | Save the current pins as a focus preset / cycle saved presets |
| `Ctrl+F` | Toggle the file-context split panel; `{` / `}` shrink / grow the pane |
| `p` (activity stream focused) | Pause / resume the activity stream |

All default-view focus keys (`F`, `p`, `P`, `[`, `]`, `Ctrl+F`, `{`, `}`) are
no-ops outside the default view.

**Filtering** in the default view runs through the command palette (`Ctrl+K`):
`filter:worker:<id>`, `filter:level:<debug|info|warn|error>`,
`filter:last:<duration>` (e.g. `5m`, `1h`), and `clear` to reset. Filters set
at startup with `--worker` / `--level` show as a `FILTER:` badge in the
header. There is no global `/` or `f` filter key — `/` searches only inside
the conversation transcript, and the footer's `/` Search hint is not
currently bound in the default view.

**File heatmap** (`H`): `s` cycle sort mode · `c` filter to files with
collisions · `a` show anomalies only · `↑`/`↓`/`j`/`k` navigate · `g`/`G`
jump to first/last.

**Task dependency DAG** (`D`): `t` tree · `b` top blockers · `r` ready tasks
· `s` statistics · `f` cycle filters · `R` force refresh · `↑`/`↓`/`j`/`k`
navigate · `g`/`G` jump to first/last.

**Session replay** (`R`): `Space` play/pause · `←`/`→` (or `b`/`n`) step
backward/forward · `↑`/`↓` speed down/up · `1`–`5` set 0.5x / 1x / 2x / 5x /
10x · `Home`/`End` jump to start/end · `e`/`m` export (file / Markdown) ·
`i` import. The footer shows the live transport state
(`READY`/`PLAYING`/`PAUSED`/`ENDED`) and current speed. Use `Home` to rewind
while staying in the view — `r` resets but also toggles the view closed
(*Binding conflicts*).

**Error groups** (`E`): `↑`/`↓`/`j`/`k` navigate groups · `Enter` expand /
collapse detail.

**Session digest** (`G`): `1`–`5` switch tabs (Summary / Beads / Files /
Errors / Workers) · `e` export JSON · `m` export Markdown · `t` export text ·
`j`/`k` scroll.

**Collision alerts** (`C`): `↑`/`↓`/`j`/`k` navigate alerts · `Enter`
acknowledge the selected alert · `a` acknowledge all.

**Git integration** (`I`): `s` status · `d` diff · `p` PR preview · `r`
refresh · `c` clear history.

**Semantic narrative** (`N`): `↑`/`↓`/`j`/`k` navigate segments · `Enter`
toggle detail · `f` full narrative · `r` refresh.

**Worker analytics** (`A`): `↑`/`↓`/`j`/`k` navigate workers · `←`/`→`
(`h`/`l`) pick comparison workers · `Enter` toggle detail · `a` aggregated
view · `c` comparison mode · `s` cycle sort mode · `r` refresh.

**Conversation transcript** (`T`): `/` search · `n`/`N` next/previous match ·
`t` toggle nearest tool call · `c` collapse all tool calls · `e` expand all ·
`x` export Markdown · `j`/`k` scroll.

**Cross references** (`X`): `↑`/`↓`/`j`/`k` navigate · `Enter` follow the
selected reference · `s` toggle stats · `l` toggle links · `r` refresh.

**Budget dashboard** (`B`): `a` acknowledge alert · `r` refresh cost data ·
`s` budget settings.

#### Command palette (`Ctrl+K`)

Fuzzy-searchable commands: view entry (`heatmap`, `dag`, `replay`, `errors`,
`digest`, `collisions`, `git`, `narrative`, `analytics`, `budget`,
`transcript`, `xref`), filters (`filter:worker:…`, `filter:level:…`,
`filter:last:…`, `clear`), theme (`theme`, `theme:dark`, `theme:light`),
focus presets (`preset:save`, `preset:list`, `preset:load:<name>`,
`preset:delete:<name>`), exports (`export`, `export:link`, `export:import`),
jumps (`worker:<id>`, `bead:<id>`, `file:<pattern>`, `goto:<timestamp>`), and
`help`, `pause`, `refresh`, `quit`. `Escape` closes the palette.

#### Binding conflicts (known quirks)

Several lowercase keys are registered both as a global view toggle and as an
in-view action. Blessed dispatches a key to **all** matching handlers, so
both fire — the local action runs and the global toggle switches views:

| Key | Global effect | Local effect (focused view) |
|-----|---------------|------------------------------|
| `r` | Toggles session replay (plus a legacy re-render) | Refresh/reset in replay, DAG, git, narrative, analytics, xref, budget — the refresh runs, then the view switches to replay |
| `g` / `G` | Toggles session digest | Jump to top/bottom in worker grid, heatmap, DAG |
| `h` | Enters the heatmap | Move comparison selection in worker analytics |
| `d` | Enters the DAG | Diff sub-view in git integration |
| `e` | Enters error groups | Export in digest/replay, expand-all in transcript |
| `c` | Enters collision alerts | Collisions-only filter in heatmap, comparison mode in analytics, collapse-all in transcript, clear history in git |
| `p` | Pin selected worker (default view only) | Pause activity stream, play/pause replay, PR preview in git |
| `N` | Enters semantic narrative | Previous search match in transcript |

In practice: `r` always ends in (or leaves) the replay view, and `d`/`e`/`c`/`h`
inside the git/digest/transcript/heatmap/analytics views will also switch you
away — expect the view change and re-enter with the view's uppercase key.
Keys unique to a single view (`s`, `a`, `f`, `t`, `b`, `n`, `l`, `m`, `x`,
`i`, `1`–`5`, `Home`/`End`) have no global collision.

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
- Remote (via Tailscale): `https://codinghome.tail1b1987.ts.net/` (requires the
  `tailscale serve` handler — see `scripts/setup-tailscale-serve.sh`)

### Authentication

Every `POST` endpoint requires `Authorization: Bearer <token>` when an auth token is configured — event ingestion, retention pruning, theme, the memory-mutation routes (`/api/memory/capture`, `/api/memory/baseline`, `/api/memory/heap-snapshot`, `/api/memory/trend/save`), cost-alert acknowledgement, and the OTLP/HTTP receiver. A missing header answers `401`; a wrong token answers `403`. GET endpoints are open. Full policy: `docs/api-auth.md`.

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
| `--source <path>` | — | `~/.needle/logs` | Log source (file or directory) |
| `-o, --output <path>` | — | — | Output file (default: stdout) |
| `-w, --worker <ids>` | — | — | Filter by worker IDs (comma-separated) |
| `--since <timestamp>` | — | — | Start time (Unix timestamp in ms) |
| `--until <timestamp>` | — | — | End time (Unix timestamp in ms) |
| `--max-files <number>` | — | `50` | Maximum files to list |
| `--max-errors <number>` | — | `20` | Maximum errors to list |
| `--ai` | — | off | Add an AI-generated narrative section (see below) |
| `--ai-model <model>` | — | `claude-opus-5` | Claude model for `--ai` |
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

# Add an AI narrative for stakeholders
fabric digest --ai --output standup.md
```

### AI narrative (`--ai`)

By default `fabric digest` is fully deterministic: it extracts bead completions,
file modifications, errors, per-worker summaries, and cost from the log events
and renders them as Markdown tables. No network call is made.

`--ai` adds an **AI Narrative** section on top: the deterministic digest's
already-extracted data is sent to the Anthropic Messages API (via the official
`@anthropic-ai/sdk`), which writes the stakeholder-facing overview, highlights,
and observations. The model sees only the extracted summary data — never raw
log files and never your API key.

**Configuration** (environment variables):

| Variable | Default | Description |
|----------|---------|-------------|
| `FABRIC_DIGEST_AI_API_KEY` | — | API key (preferred). Falls back to `ANTHROPIC_API_KEY` |
| `FABRIC_DIGEST_AI_MODEL` | `claude-opus-5` | Model id |
| `FABRIC_DIGEST_AI_MAX_TOKENS` | `4096` | Response token cap |
| `FABRIC_DIGEST_AI_TIMEOUT_MS` | `60000` | Request timeout |
| `FABRIC_DIGEST_AI_MAX_RETRIES` | `1` | Transport retries |

**Fallback behavior:** the deterministic digest is always produced and is the
backbone of the output. If `--ai` is set but no API key is configured, or the
provider call fails (auth error, rate limit, timeout, malformed response, or a
model refusal), FABRIC prints the reason to **stderr** and emits the
deterministic digest unchanged. The command still exits **0** — an AI outage
never loses the digest. The API key is never logged or rendered into output.

**Cost note:** `--ai` makes one API request per digest run, charged to the
account owning the API key. Prompt lists are capped (20 workers / 20 beads /
15 files / 10 errors) to bound cost; the aggregate stats in the prompt always
reflect the full session.

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
