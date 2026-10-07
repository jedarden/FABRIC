# FABRIC CLI Reference

Complete reference for all `fabric` commands and options.

## Installation

```bash
npm install -g @needle/fabric
# or
pnpm add -g @needle/fabric
```

The binary installs as `fabric` (or `fabric-node` if there's a naming conflict).

> **Publishing status:** `@needle/fabric@0.1.0` is published to the public npm
> registry. To verify a specific published artifact in an isolated temporary
> prefix, run:
>
> ```bash
> npm run smoke:registry-install -- @needle/fabric@<version>
> ```
>
> The release gate and publication workflow are documented in README's
> "Release and publication workflow" section.
>
> After publication, `npm run release:maintenance` repeats the metadata,
> release-gate, package, tarball-install, and exact-version registry checks.

## Commands Overview

| Command | Description |
|---------|-------------|
| `fabric tui` | Launch terminal UI dashboard |
| `fabric web` | Launch web dashboard |
| `fabric tail` / `fabric logs` | Tail log file and display events |
| `fabric replay` | Replay worker session history |
| `fabric prune` | Prune old log files |
| `fabric digest` | Generate session digest from a log source (directory or file) |
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
work from any view and `Escape` steps back after dismissing any floating
overlay. The `?` help overlay is *not* a view: it floats above whichever view
is active without changing it. `?` toggles it, while `Escape` dismisses it
without changing the active view; a later `Escape` can then affect the view
or another underlying overlay. The overlay is a quick summary, not an exact mirror of
this reference: its Actions list carries only genuinely global keys, and
the view-local ones are listed inside their views' own sections — including
the conversation-transcript and cross-reference views. In particular `/`
appears only under Conversation Transcript (search) and `f` only under
Dependency DAG (cycle filters) and Semantic Narrative (full narrative);
neither is bound globally.

#### Global keys (active in every view)

| Key | Action |
|-----|--------|
| `q` / `Ctrl+C` | Quit FABRIC |
| `?` | Toggle the help overlay — works in every view and does not change the active view |
| `Tab` / `Shift+Tab` | Move panel focus to the next / previous panel |
| `Enter` | Open the detail overlay for the worker selected in the worker grid (`Escape` closes it after any open help overlay) |
| `Escape` | In order: close the help overlay if it is open; otherwise close the focused command palette; otherwise close the worker or view-local detail; otherwise return to the default view (no-op if already there) |
| `Ctrl+K` | Command palette (see below) |
| `Ctrl+T` | Toggle dark / light theme |
| `r` | Re-render the screen — view-local `r` actions (refresh, reset, ready tasks) fire alongside it |
| `R` | Toggle the session replay view — uppercase only; `r` always re-renders and never switches views |

#### Views — entry and exit

| View | Header | Enter with |
|------|--------|------------|
| Default (worker grid + activity stream) | `FABRIC - Worker Activity Monitor` | startup, `Escape`, or toggling a view off |
| File heatmap | `FABRIC - File Heatmap` | `H` or `h` |
| Task dependency DAG | `FABRIC - Task Dependency DAG` | `D` or `d` |
| Session replay | `FABRIC - Session Replay` | `R` |
| Error groups | `FABRIC - Error Groups` | `E` or `e` |
| Session digest | `FABRIC - Session Digest` | `G` or `g` (anywhere but the heatmap view — see *Binding conflicts*) |
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
- **Returning to the default view** shows the worker grid and the activity
  stream again (the stream back at full width). The file-context split is
  *not* restored automatically — entry closed it — so reopen it with
  `Ctrl+F` if needed.

#### Per-view keys

Screen-level shortcuts work regardless of focus. A view's component shortcuts
go to the focused widget; entering a full-screen view focuses its main widget.
In scrollable widgets that enable Blessed's `keys` and `vi` options, arrows or
`j`/`k` move one row or line, `Ctrl+U`/`Ctrl+D` move half a page, and
`Ctrl+B`/`Ctrl+F` move a full page. On lists, those movements change the
selection; on text panels, they scroll the content. `g`/`G` move to the first
or last list item, or the top or bottom of a scrollable box, unless that view
defines its own `g`/`G` action. `PageUp`/`PageDown` are custom-bound only in
the file-context panel, where they scroll by the visible file-pane height.
`Tab`/`Shift+Tab` change the focused widget, so use them before a local action
when another panel has focus.

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

The worker grid's arrows or `j`/`k` select workers; `g`/`G` select the first
or last worker. The activity stream scrolls with arrows or `j`/`k`; while it
has focus, `p` pauses or resumes it. `p` on the worker grid instead pins the
selected worker. `Ctrl+C` is the global quit key.

**Worker detail overlay** (opened by `Enter` when a worker is selected):
`Escape` hides it after any help or command-palette overlay is dismissed. It
has no detail-specific action keys; when the detail box has focus, the shared
scroll aliases above move through its content. Opening the overlay does not
explicitly move focus to it, so use `Tab`/`Shift+Tab` if scroll keys still act
on the widget underneath.

**File-context split** (opened with `Ctrl+F`) does not take focus when it
opens. Use `Tab`/`Shift+Tab` to focus it; its local keys are `o` / `O` to open
the current file in `$EDITOR`, `↑`/`↓`/`j`/`k` to scroll a line, and
`PageUp`/`PageDown` to scroll by one visible pane height. `[` / `]` walk the
recent-files list and also save / cycle focus presets, because the global and
panel handlers both receive the key. `{` / `}` resize the pane. `Ctrl+F` also
pages down in the focused scrollable widget while the global handler toggles
the split.

**Activity-stream filtering** is available from the command palette
(`Ctrl+K`) in any view. `filter:worker:<id>` and
`filter:level:<debug|info|warn|error>` replace the current interactive filter
with that worker or level. `filter:last:<duration>` (for example, `5m`, `1h`,
or `30s`) adds or updates the lower time bound on the current interactive
filter. These commands filter the activity stream only. Choose `clear` to
remove all interactive filter fields, including the time bound. Startup
`--worker` / `--level` options are applied before events reach the TUI and show
as a `FILTER:` header badge; `clear` cannot undo those options, so restart
without them to see the full source again.

There is no global `/` search or `f` filter. `/` opens search only in the
conversation transcript; elsewhere the generic footer's `/` Search hint is
not bound.

**File heatmap** (`H` or `h`): lowercase `s` cycles sorting in this order:
modifications (default), recent, workers, collisions, then back to
modifications; four presses of `s` return to the default sort. Lowercase `c`
toggles collisions-only files; lowercase `a` toggles anomalies-only. These
filters are exclusive: either key clears the other mode, and pressing `a` again
returns to the ordinary file list. If collisions-only is active, press `a`
twice to return to all files; if anomalies-only is active, press `a` once.
Heatmap filter and sort state remains when you leave and re-enter with
`Escape` and `H`/`h`. The TUI has no directory-search control; `a` and `c`
only change anomaly/collision mode. In this view lowercase `c` also
fires the global Collision Alerts toggle, so the filter changes and the screen
switches to Collision Alerts. Press `Escape`, then `H`/`h` to return. If the
heatmap is still collisions-only, use `a` twice to clear that filter without
another view switch. Navigate with
`↑`/`↓`/`j`/`k`; `g`/`G` jump to first/last. Inside this view `g`/`G` are
exclusively the heatmap's first/last navigation — the digest toggle does not
fire here; reach the digest with `Escape` then `G`, or the command palette's
`digest` command (see *Binding conflicts*).

**Task dependency DAG** (`D` or `d`): lowercase `f` filters the graph. From a
fresh launch, its first press shows blocked tasks, the second shows
in-progress tasks, and the third combines in-progress with critical-path-only.
Further presses refresh the same combined filter instead of advancing or
clearing it. There is currently no keyboard reset for this filter: `Escape`
or `D`/`d` leaves the DAG, but re-entering preserves the filter; restart FABRIC
to restore all tasks. Lowercase `s` opens the statistics sub-view; the DAG has
no sort key. `t` shows the tree, `b` top blockers, `r` ready tasks, and
`C-r` forces a refresh without changing the filter. Navigate with
`↑`/`↓`/`j`/`k`; `g`/`G` jump to first/last.

**Session replay** (`R`): `Space` / `p` play/pause · `←`/`→` (or `b`/`n`) step
backward/forward · `↑`/`↓` speed down/up · `1`–`5` set 0.5x / 1x / 2x / 5x /
10x · `Home`/`End` jump to start/end · `e`/`E`/`m` export (file / base64 /
Markdown) · `i` import. The footer shows the live transport state
(`READY`/`PLAYING`/`PAUSED`/`ENDED`) and current speed. Use `Home` to rewind
while staying in the view — `r` resets playback without leaving the view
(the global re-render fires alongside the reset).

**Error groups** (`E` or `e`): there is no interactive filter or sort key in
this view; `f`, `s`, and `/` do not filter, sort, or search error groups.
`↑`/`↓`/`j`/`k` navigate all groups · `Enter` / `Space` expand / collapse
detail · `Escape` collapses an expanded detail first, then a later `Escape`
returns to the default view.

**Session digest** (`G`): `1`–`5` switch tabs (Summary / Beads / Files /
Errors / Workers) · `e` export JSON · `m` export Markdown · `t` export text ·
`j`/`k` scroll. Arrow keys scroll too; the shared `Ctrl+U`/`Ctrl+D` and
`Ctrl+B`/`Ctrl+F` aliases page through the focused content.

**Collision alerts** (`C`): `↑`/`↓`/`j`/`k` navigate alerts · `Enter` /
`Space` acknowledge the selected alert · `a` acknowledge all.

**Git integration** (`I`): `s` status · `d` diff · `p` PR preview · `r`
refresh · `c` clear history. Press `d` or `p` again to return to status.
Scroll status, diff, and preview content with arrows or `j`/`k`; `Ctrl+U` /
`Ctrl+D` page half a screen and `Ctrl+B` / `Ctrl+F` page a full screen.
`Escape` exits the Git view to the default view under the global lifecycle.

**Semantic narrative** (`N`): `↑`/`↓`/`j`/`k` navigate segments · `Enter` /
`Space` toggle detail · `f` full narrative · `r` refresh · `Escape` returns to
the list before leaving the view.

**Worker analytics** (`A`): lowercase `s` cycles sort order: beads completed
(default, highest first), error rate (lowest first), cost per bead (lowest
first), and efficiency (highest first), then back to beads. Sort state
persists when you leave and re-enter; four presses of `s` return to the default
sort. `↑`/`↓`/`j`/`k` navigate workers · `←`/`→` pick comparison workers
(arrow keys only — the former `h`/`l` aliases were removed so lowercase `h`
stays the heatmap toggle; see *Binding conflicts*) · `Enter` / `Space` toggle
detail · `a` aggregated view · `c` comparison mode · `r` refresh · `Escape`
returns from a detail/sub-view to the list before a later `Escape` leaves the
view. Lowercase `c` also fires the global Collision Alerts toggle, so it
switches away while changing the analytics panel to comparison mode; see
*Binding conflicts*.

**Conversation transcript** (`T`): `/` opens the search input; type a query and
press `Enter` to highlight matching transcript entries while keeping the full
transcript visible. `n`/`N` move to the next/previous match; `/` starts another
search, and submitting an empty query clears the highlights. `Escape` closes
an open search input and steps back to the default view. Uppercase `N` also
enters Semantic Narrative, so it changes views while moving to the previous
match (see *Binding conflicts*). `t` toggles the nearest tool call · `c`
collapses all tool calls · `e` expands all · `x` exports Markdown · `j`/`k` scroll.

**Cross references** (`X`): `↑`/`↓`/`j`/`k` navigate · `Enter` follow the
selected reference · `s` toggle stats · `l` toggle links · `r` refresh ·
`Escape` returns to links before leaving a secondary view.

**Budget dashboard** (`B`): `a` acknowledge alert · `r` refresh cost data ·
`s` is reserved for settings, but the app does not provide a settings callback,
so it currently has no effect. The panel acknowledges the first unacknowledged
alert with `a`; scroll its content with arrows or `j`/`k` and page with the
shared `Ctrl+U`/`Ctrl+D` or `Ctrl+B`/`Ctrl+F` bindings.

#### Command palette (`Ctrl+K`)

Fuzzy-searchable commands: view entry (`heatmap`, `dag`, `replay`, `errors`,
`digest`, `collisions`, `git`, `narrative`, `analytics`, `budget`,
`transcript`, `xref`), filters (`filter:worker:…`, `filter:level:…`,
`filter:last:…`, `clear` — the palette also suggests `filter:bead:…`, but no
handler is wired for it yet, so selecting it is a no-op), theme
(`theme` / `theme:toggle`, `theme:dark`, `theme:light`),
focus presets (`preset:save`, `preset:list`, `preset:load:<name>`,
`preset:delete:<name>`), exports (`export` / `export:file`, `export:link`,
`export:import`),
jumps (`worker:<id>`, `bead:<id>`, `file:<pattern>`, `goto:<timestamp>`), and
`help`, `pause`, `refresh`, `quit`. `Escape` closes the focused palette first.
The underlying worker/detail overlay or view remains in place; a later
`Escape` dismisses that layer before the active view steps back to the default.
If help is open, help has the first Escape instead.

#### Binding conflicts (known quirks)

Several keys are registered both globally and as a focused-widget action.
Blessed dispatches a key to **all** matching handlers, so both fire — the
local action runs and the global action also takes effect:

| Key | Global effect | Local effect (focused view) |
|-----|---------------|------------------------------|
| `r` | Re-renders the screen (never switches views) | Reset in replay, ready-tasks sub-view in DAG, refresh in git, narrative, analytics, xref, budget — every local `r` action is itself a refresh, so the combined effect is a data refresh plus a re-render |
| `g` / `G` | Toggles session digest — **except in the heatmap view, where the toggle is suppressed** (deconflicted, see below) | First/last or top/bottom navigation in focused scrollable lists and boxes (including worker grid, activity stream, and DAG) |
| `d` | Enters the DAG | Diff sub-view in git integration |
| `e` / `E` | Enters error groups | Export in digest (`e`) and replay (`e` file, `E` base64), expand-all in transcript |
| `c` | Enters collision alerts | Collisions-only filter in heatmap, comparison mode in analytics, collapse-all in transcript, clear history in git |
| `p` | Pin selected worker (default view only) | Pause activity stream, play/pause replay, PR preview in git |
| `N` | Enters semantic narrative | Previous search match in transcript |
| `Enter` | Opens worker detail for the selected worker | Expand error detail, acknowledge a collision, toggle narrative/analytics detail, follow a cross-reference, or submit transcript search |
| `Ctrl+F` | Toggles the file-context split in the default view | Pages down in the focused widget when it has vi paging enabled |
| `Ctrl+C` | Quits FABRIC | The activity stream also registers a clear handler, but quit runs first |

The `g`/`G` row also applies to any focused scrollable list or text box with
Blessed's `vi` keys enabled: its first/last or top/bottom navigation runs
alongside the session-digest toggle. Only the heatmap suppresses the global
toggle. In the activity stream and other text panels, `Ctrl+U`/`Ctrl+D` and
`Ctrl+B`/`Ctrl+F` page content as described above.

The `r` / `R` pair is deconflicted: `r` re-renders, `R` toggles session replay,
and the DAG view's force refresh moved from `R` to `C-r` so it cannot collide
with the replay toggle. Lowercase `h` is fully deconflicted too: `H`/`h`
toggle the heatmap and no view binds a local `h` — worker analytics used to
move its comparison selection with `h`, and both handlers fired; that alias
was removed and comparison selection is arrow-keys-only now. `g`/`G` are
deconflicted inside the heatmap view specifically: the screen-level digest
toggle steps aside there, so the heatmap's jump-to-first/last handlers are the
sole effect. Everywhere else — the default view and every other overlay —
`g`/`G` toggle the session digest exactly as before, and in the worker grid
and DAG the jump still fires alongside the toggle.

In practice: `d`/`e`/`c` inside the git/digest/transcript/heatmap/analytics
views will also switch you away — expect the view change and re-enter with the
view's uppercase key. Keys unique to a single view (`s`, `a`, `f`, `t`, `b`,
`n`, `l`, `m`, `x`, `i`, `1`–`5`, `Home`/`End`) and the deconflicted
`h` / `r` / `R` / `C-r` bindings — plus `g`/`G` within the heatmap view —
have no view-switching collision.

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
| `--archive-after <days>` | indefinite | Archive files older than N days |
| `--archive-retain <days>` | indefinite | Delete archives older than N days |
| `--max-age <days>` | indefinite | Delete files older than N days regardless |
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

Generate session digest from a log source (directory or file).

### Usage

```bash
fabric digest [options]
```

### Source resolution

The source is resolved as `--source` → `-f/--file` → default, matching
`resolveFromOptions` in `src/cli.ts`:

1. `--source <path>` — validated with `fs.stat` and classified as directory
   or file; exits 1 if the path does not exist (`~` is expanded).
2. `-f, --file <path>` — legacy single-file mode: the path is used as-is,
   with no existence check.
3. Neither option — defaults to the `~/.needle/logs/` directory.

There is no consolidated `workers.log`; a directory source tails every
per-worker `*.jsonl` file in it.

### Options

| Option | Alias | Default | Description |
|--------|-------|---------|-------------|
| `-f, --file <path>` | — | — | Legacy single-file mode (path used as-is; no existence check) |
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
and observations.

**What is sent to the provider** — extracted summary data only:

- session id, time window, and aggregate counts (plus the token/cost estimate
  when present)
- per-worker summaries — top 20 by activity
- completed bead ids with worker and duration — top 20
- most-modified file paths with counts and tools — top 15
- recent error messages, flattened to one line each — top 10

Raw log lines, file contents, and environment variables are never sent, and
the API key never enters the prompt or the logs. Lists beyond a cap are
represented only by an "… and N more" overflow line; the aggregate stats
always reflect the full session.

**Configuration** (environment variables):

| Variable | Default | Description |
|----------|---------|-------------|
| `FABRIC_DIGEST_AI_API_KEY` | — | API key (preferred). Falls back to `ANTHROPIC_API_KEY` |
| `FABRIC_DIGEST_AI_MODEL` | `claude-opus-5` | Model id |
| `FABRIC_DIGEST_AI_MAX_TOKENS` | `4096` | Response token cap |
| `FABRIC_DIGEST_AI_TIMEOUT_MS` | `60000` | Request timeout; when it elapses the fallback fires |
| `FABRIC_DIGEST_AI_MAX_RETRIES` | `1` | Transport retries |

**Configuration precedence** — every setting has a single resolution chain;
the first non-empty value wins:

| Setting | Resolution order |
|---------|------------------|
| API key | `FABRIC_DIGEST_AI_API_KEY` → `ANTHROPIC_API_KEY` → none (fallback fires) |
| Model | `--ai-model <model>` → `FABRIC_DIGEST_AI_MODEL` → `claude-opus-5` |
| Max response tokens | `FABRIC_DIGEST_AI_MAX_TOKENS` (must be > 0) → `4096` |
| Request timeout | `FABRIC_DIGEST_AI_TIMEOUT_MS` (must be > 0) → `60000` |
| Transport retries | `FABRIC_DIGEST_AI_MAX_RETRIES` (≥ 0) → `1` |
| API endpoint | `ANTHROPIC_BASE_URL` (standard SDK override, e.g. for a gateway) → Anthropic default |

An empty value counts as unset: an empty `FABRIC_DIGEST_AI_API_KEY` still
falls through to `ANTHROPIC_API_KEY`, and an empty `--ai-model` still picks up
`FABRIC_DIGEST_AI_MODEL`. Invalid (non-numeric or out-of-range) tuning values
silently fall back to their defaults. `--ai-model` without `--ai` has no
effect — a warning is printed and the run stays deterministic.

**Fallback behavior:** the deterministic digest is always produced and is the
backbone of the output. If `--ai` is set but no API key is configured, or the
provider call fails (auth error, rate limit, timeout, malformed response, or a
model refusal), FABRIC prints the reason to **stderr** and emits the
deterministic digest unchanged. The command still exits **0** — an AI outage
never loses the digest. The API key is never logged or rendered into output.

**Stderr messages** — progress and every fallback reason go to stderr, never
stdout, so the Markdown digest on stdout stays clean:

| Message | Meaning |
|---------|---------|
| `AI digest unavailable: no API key found (set FABRIC_DIGEST_AI_API_KEY or ANTHROPIC_API_KEY) — using deterministic digest` | `--ai` set but no key resolved |
| `Requesting AI narrative (model: <model>)...` | the provider call is starting |
| `AI narrative added (model: <model>)` | success; `## AI Narrative` appended |
| `AI digest failed (<reason>) — using deterministic digest` | any fallback; digest emitted unchanged |
| `--ai-model has no effect without --ai; ignoring` | `--ai-model` passed without `--ai` |

The `<reason>` in a fallback line is one of:

| `<reason>` | Trigger |
|------------|---------|
| `provider request failed: <sdk message>` | auth error, rate limit, network failure, or an elapsed `FABRIC_DIGEST_AI_TIMEOUT_MS` |
| `model declined the request (stop_reason=refusal)` | the model refused the prompt |
| `response contained no text content` | HTTP 200 whose `content` is missing or empty |

**Exit codes:**

| Code | When |
|------|------|
| `0` | A digest was produced — without `--ai`, with the AI narrative appended, or through any AI fallback above |
| `1` | The `--source` path does not exist, or digest generation itself failed (including an unwritable `--output` path) |

An AI problem can never produce a non-zero exit or a lost digest.

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
| `FABRIC_DIGEST_AI_*` | AI digest narrative configuration (`_API_KEY` — falls back to `ANTHROPIC_API_KEY` — `_MODEL`, `_MAX_TOKENS`, `_TIMEOUT_MS`, `_MAX_RETRIES`); see the [`fabric digest`](#fabric-digest) `--ai` section |
| `NODE_ENV` | When `production`, enables heap snapshots by default |
| `WATCHDOG_USEC` | systemd watchdog timeout (enables watchdog ping) |
| `NOTIFY_SOCKET` | systemd notification socket (for watchdog) |

---

## See Also

- [Plan](plan.md) - Implementation roadmap
- [Schema](schema.md) - NeedleEvent wire format
- [Metrics](metrics.md) - Prometheus metrics export
- [README](../README.md) - Project overview
