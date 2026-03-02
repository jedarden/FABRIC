# FABRIC Implementation Plan

**Flow Analysis & Bead Reporting Interface Console**

## Overview

FABRIC is a live display for NEEDLE worker activity. It parses NEEDLE's logging output and renders it in real-time as either a TUI (terminal) or web dashboard.

## Goals

1. **Live Display**: Real-time visualization of NEEDLE worker activity
2. **Dual Interface**: TUI for terminal users, web app for browser users
3. **Stateless**: Reads and displays - no storage or persistence

## Data Flow

```
NEEDLE Workers → ~/.needle/logs/ → FABRIC → Live TUI or Web Dashboard
```

FABRIC continuously tails NEEDLE's output and updates the display in real-time.

## Input: NEEDLE Log Format

FABRIC expects structured JSON log lines from NEEDLE:

```json
{"ts":1709337600,"worker":"w-abc123","level":"info","msg":"Starting task","task":"bd-xyz"}
{"ts":1709337601,"worker":"w-abc123","level":"debug","msg":"Tool call","tool":"Read","path":"/src/main.ts"}
{"ts":1709337605,"worker":"w-abc123","level":"info","msg":"Task complete","duration_ms":5000}
```

### Parsed Structure
```typescript
interface LogEvent {
  ts: number;
  worker: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  [key: string]: any;  // Additional fields
}
```

## Default Source

FABRIC reads from `~/.needle/logs/` by default. NEEDLE's folder structure:

```
~/.needle/
├── config.yaml    # NEEDLE configuration
├── logs/          # Worker log output (FABRIC reads this)
├── state/         # Runtime state
├── cache/         # Cached data
└── README.md
```

## Output: Live Displays

### TUI Mode (`fabric tui`)

Live terminal dashboard that continuously updates:

- **Worker Grid**: Real-time status of all active workers
- **Log Stream**: Scrolling log output as events arrive
- **Detail Panel**: Focus on a specific worker's activity

Features:
- Auto-updates as new log events arrive
- Filter by worker, log level, or search term
- Keyboard navigation (j/k scroll, / search, Tab switch panels, q quit)
- Color-coded log levels

#### TUI Mockup

```
┌─ FABRIC ─────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  Workers (4 active)                                              [?] Help    │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │  ● w-alpha    Running   bd-1847  "Implement auth flow"         2m 34s   │ │
│ │  ● w-bravo    Running   bd-1852  "Fix login validation"        1m 12s   │ │
│ │  ○ w-charlie  Idle      -        -                                  -   │ │
│ │  ● w-delta    Running   bd-1849  "Add unit tests"                 45s   │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  Activity Stream                                        Filter: [All     ▾] │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ 14:32:07  w-alpha   INFO   Tool call: Edit src/auth/login.ts            │ │
│ │ 14:32:05  w-bravo   DEBUG  Reading file: src/validators/index.ts        │ │
│ │ 14:32:04  w-delta   INFO   Starting task bd-1849                        │ │
│ │ 14:32:01  w-alpha   INFO   Tool call: Read src/auth/types.ts            │ │
│ │ 14:31:58  w-bravo   WARN   Retry attempt 2/3 for API call               │ │
│ │ 14:31:55  w-alpha   DEBUG  Analyzing dependencies...                    │ │
│ │ 14:31:52  w-charlie INFO   Task bd-1845 completed (duration: 4m 12s)    │ │
│ │ 14:31:50  w-bravo   INFO   Tool call: Grep pattern="validateUser"       │ │
│ │ 14:31:47  w-alpha   INFO   Tool call: Glob **/*.ts                      │ │
│ │ 14:31:44  w-charlie INFO   Committing changes...                        │ │
│ │                                                                          │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  [Tab] Switch panel  [j/k] Scroll  [/] Search  [f] Filter  [q] Quit         │
└──────────────────────────────────────────────────────────────────────────────┘
```

#### TUI Worker Detail View (when worker selected)

```
┌─ FABRIC ─────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  Worker: w-alpha                                              [Esc] Back     │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │  Status:    ● Running                                                    │ │
│ │  Task:      bd-1847 "Implement auth flow"                                │ │
│ │  Duration:  2m 34s                                                       │ │
│ │  Events:    47                                                           │ │
│ │  Errors:    0                                                            │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  Worker Log                                                                  │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ 14:32:07  INFO   Tool call: Edit src/auth/login.ts                      │ │
│ │                  old_string: "function login() {"                        │ │
│ │                  new_string: "async function login(): Promise<User> {"   │ │
│ │ 14:32:01  INFO   Tool call: Read src/auth/types.ts                      │ │
│ │ 14:31:55  DEBUG  Analyzing dependencies...                              │ │
│ │ 14:31:47  INFO   Tool call: Glob **/*.ts                                │ │
│ │                  Found 23 files                                          │ │
│ │ 14:31:42  INFO   Starting task bd-1847                                  │ │
│ │                  Task: "Implement auth flow"                             │ │
│ │                  Priority: P1                                            │ │
│ │                                                                          │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  [j/k] Scroll  [/] Search  [Esc] Back to overview                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Web Mode (`fabric web`)

Live browser dashboard served on localhost:

- **Worker Overview**: Cards showing each worker's current state
- **Activity Feed**: Real-time log stream
- **Timeline**: Visual representation of worker activity

Features:
- WebSocket-powered real-time updates
- Filter and search controls
- Responsive layout
- Auto-reconnect on connection loss

#### Web Mockup

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  ◉ FABRIC                                          ┌─────────────────────────┐  │
│  Flow Analysis & Bead Reporting Interface Console  │ 🔍 Search...            │  │
│                                                    └─────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐                │
│   │  4 Active       │  │  12 Completed   │  │  0 Errors       │                │
│   │  Workers        │  │  Today          │  │  Last Hour      │                │
│   └─────────────────┘  └─────────────────┘  └─────────────────┘                │
│                                                                                 │
│   Workers                                                                       │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │                                                                          │  │
│  │  ┌─────────────────────┐  ┌─────────────────────┐                       │  │
│  │  │ ● w-alpha           │  │ ● w-bravo           │                       │  │
│  │  │                     │  │                     │                       │  │
│  │  │ bd-1847             │  │ bd-1852             │                       │  │
│  │  │ Implement auth flow │  │ Fix login validation│                       │  │
│  │  │                     │  │                     │                       │  │
│  │  │ ██████████░░ 2m 34s │  │ █████░░░░░░ 1m 12s  │                       │  │
│  │  └─────────────────────┘  └─────────────────────┘                       │  │
│  │                                                                          │  │
│  │  ┌─────────────────────┐  ┌─────────────────────┐                       │  │
│  │  │ ○ w-charlie         │  │ ● w-delta           │                       │  │
│  │  │                     │  │                     │                       │  │
│  │  │ Idle                │  │ bd-1849             │                       │  │
│  │  │                     │  │ Add unit tests      │                       │  │
│  │  │                     │  │                     │                       │  │
│  │  │ Ready for work      │  │ ██░░░░░░░░░    45s  │                       │  │
│  │  └─────────────────────┘  └─────────────────────┘                       │  │
│  │                                                                          │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
│   Activity Feed                                    Filter: [All levels ▾]      │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │                                                                          │  │
│  │  14:32:07  ● w-alpha   INFO                                             │  │
│  │  Tool call: Edit src/auth/login.ts                                      │  │
│  │  ────────────────────────────────────────────────────────────────────── │  │
│  │  14:32:05  ● w-bravo   DEBUG                                            │  │
│  │  Reading file: src/validators/index.ts                                  │  │
│  │  ────────────────────────────────────────────────────────────────────── │  │
│  │  14:32:04  ● w-delta   INFO                                             │  │
│  │  Starting task bd-1849                                                  │  │
│  │  ────────────────────────────────────────────────────────────────────── │  │
│  │  14:31:58  ● w-bravo   WARN                                             │  │
│  │  Retry attempt 2/3 for API call                                         │  │
│  │  ────────────────────────────────────────────────────────────────────── │  │
│  │  14:31:52  ○ w-charlie INFO                                             │  │
│  │  Task bd-1845 completed (duration: 4m 12s)                              │  │
│  │                                                                          │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
│   Timeline (last 10 minutes)                                                    │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │        14:22    14:24    14:26    14:28    14:30    14:32                │  │
│  │  alpha  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░███████████████████            │  │
│  │  bravo  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░████████████            │  │
│  │  charlie████████████████████████████████████████░░░░░░░░░░░░            │  │
│  │  delta  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░███████            │  │
│  └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
│  ● Connected                                                    FABRIC v0.1.0  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

#### Web Worker Detail Modal (when worker card clicked)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                                                                 │
│      ┌───────────────────────────────────────────────────────────────────┐     │
│      │                                                            [✕]    │     │
│      │  Worker: w-alpha                                                  │     │
│      │                                                                   │     │
│      │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │     │
│      │  │ ● Running   │  │ 47 Events   │  │ 0 Errors    │               │     │
│      │  └─────────────┘  └─────────────┘  └─────────────┘               │     │
│      │                                                                   │     │
│      │  Current Task                                                     │     │
│      │  ┌───────────────────────────────────────────────────────────┐   │     │
│      │  │ bd-1847                                                   │   │     │
│      │  │ Implement auth flow                                       │   │     │
│      │  │ Duration: 2m 34s                                          │   │     │
│      │  └───────────────────────────────────────────────────────────┘   │     │
│      │                                                                   │     │
│      │  Recent Activity                                                  │     │
│      │  ┌───────────────────────────────────────────────────────────┐   │     │
│      │  │ 14:32:07  INFO   Edit src/auth/login.ts                   │   │     │
│      │  │ 14:32:01  INFO   Read src/auth/types.ts                   │   │     │
│      │  │ 14:31:55  DEBUG  Analyzing dependencies...                │   │     │
│      │  │ 14:31:47  INFO   Glob **/*.ts (23 files)                  │   │     │
│      │  │ 14:31:42  INFO   Starting task bd-1847                    │   │     │
│      │  └───────────────────────────────────────────────────────────┘   │     │
│      │                                                                   │     │
│      └───────────────────────────────────────────────────────────────────┘     │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Intelligence Features

FABRIC goes beyond simple log display with these intelligent features:

### 1. Stuck & Loop Detection

Automatically detect when a worker is spinning its wheels:
- No meaningful progress for N minutes
- Repeating the same tool calls (Read → Edit → Read → Edit on same file)
- Retrying failed operations repeatedly

Surfaces problems immediately without users having to watch logs constantly.

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️  STUCK DETECTED                                                │
│                                                                     │
│  w-alpha appears stuck (same file edited 4x in 6 minutes)          │
│                                                                     │
│  Pattern detected:                                                  │
│    14:31:07  Edit src/auth.ts  →  "add validation"                 │
│    14:33:12  Edit src/auth.ts  →  "fix validation"                 │
│    14:35:18  Edit src/auth.ts  →  "update validation"              │
│    14:37:24  Edit src/auth.ts  →  "refactor validation"            │
│                                                                     │
│  Suggestion: Worker may be in a fix-break cycle                    │
│                                                      [Inspect]      │
└─────────────────────────────────────────────────────────────────────┘
```

**Loop Detection Patterns:**
- Same file edited 3+ times in 5 minutes
- Same Grep/Glob pattern executed repeatedly
- Alternating Read/Edit on same file without progress
- Retry count exceeding threshold

---

### 2. Live Inline Diff View

When a worker calls `Edit`, render the actual diff inline with syntax highlighting:

```
14:32:07  w-alpha  INFO  Edit src/auth/login.ts
┌─────────────────────────────────────────────────────────────────────┐
│  @@ -12,7 +12,9 @@                                                  │
│                                                                     │
│    import { User } from './types';                                  │
│                                                                     │
│  - function login() {                                               │
│  + async function login(): Promise<User> {                          │
│      const user = await authenticate();                             │
│  -   return user;                                                   │
│  +   if (!user) throw new AuthError('Invalid credentials');         │
│  +   return sanitizeUser(user);                                     │
│    }                                                                │
└─────────────────────────────────────────────────────────────────────┘
```

**Implementation:**
- Parse `old_string` and `new_string` from Edit tool call logs
- Generate unified diff format
- Syntax highlight based on file extension
- Collapsible in log stream, expandable on click

---

### 3. Cross-Reference Hyperlinking

Every entity in logs becomes a clickable/navigable link:

| Entity | Action |
|--------|--------|
| Bead ID (`bd-1847`) | Show all events across all workers for this bead |
| File path (`src/auth.ts`) | Show all operations on this file |
| Worker name (`w-alpha`) | Jump to worker detail view |
| Timestamp | Anchor link for sharing/bookmarking |
| Error code | Show all occurrences of this error |

```
Activity Stream
┌─────────────────────────────────────────────────────────────────────┐
│ 14:32:07  [w-alpha]  INFO  Edit [src/auth/login.ts] for [bd-1847] │
│           ─────────        ──── ───────────────────     ─────────  │
│           clickable        tool      clickable          clickable  │
│                                                                     │
│ Clicking bd-1847 shows:                                            │
│ ┌─────────────────────────────────────────────────────────────┐    │
│ │ All events for bd-1847 "Implement auth flow"                │    │
│ │                                                             │    │
│ │ 14:29:00  w-alpha   Assigned task                          │    │
│ │ 14:29:05  w-alpha   Glob **/*.ts                           │    │
│ │ 14:30:12  w-alpha   Read src/auth/types.ts                 │    │
│ │ 14:31:47  w-alpha   Read src/auth/login.ts                 │    │
│ │ 14:32:07  w-alpha   Edit src/auth/login.ts                 │    │
│ │ ...                                                         │    │
│ └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

**TUI:** Tab/Enter to follow links, Backspace to go back
**Web:** Standard hyperlinks with browser history

---

### 4. Worker Collision Detection

Real-time detection when workers operate on overlapping concerns:

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚡ COLLISION DETECTED                                              │
│                                                                     │
│  w-alpha and w-bravo are both modifying:                           │
│                                                                     │
│  ┌───────────────────┬──────────────────┬──────────────────┐       │
│  │ File              │ w-alpha          │ w-bravo          │       │
│  ├───────────────────┼──────────────────┼──────────────────┤       │
│  │ src/auth/login.ts │ Edit (line 45)   │ Edit (line 52)   │       │
│  │ src/auth/types.ts │ Read             │ Edit (line 12)   │       │
│  │ src/api/routes.ts │ -                │ Edit (line 88)   │       │
│  └───────────────────┴──────────────────┴──────────────────┘       │
│                                                                     │
│  Risk: Merge conflicts, duplicated work                            │
│  Duration: Overlapping for 2m 34s                                  │
│                                                                     │
│  [View w-alpha]  [View w-bravo]  [View Diff]  [Dismiss]            │
└─────────────────────────────────────────────────────────────────────┘
```

**Detection Logic:**
- Track file → worker mapping in memory
- Alert when same file has Edit from multiple workers within time window
- Severity levels: Read/Read (info), Read/Edit (warn), Edit/Edit (critical)

---

### 5. Session Replay

Record sessions and play them back with timeline scrubbing:

```
┌─ FABRIC REPLAY ─────────────────────────────────────────────────────┐
│                                                                     │
│  Session: 2026-03-02_14-20-00 (duration: 25m 34s)                  │
│                                                                     │
│  ◀◀  ◀  ▶▶  ▶▶▶   ━━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━━   [2x]        │
│  rew play pause ff            ↑                      speed         │
│                          14:32:07                                   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Workers at 14:32:07                                         │   │
│  │                                                             │   │
│  │ ● w-alpha    Running   bd-1847  (2m 34s elapsed)           │   │
│  │ ● w-bravo    Running   bd-1852  (1m 12s elapsed)           │   │
│  │ ○ w-charlie  Idle      -        (completed bd-1845)        │   │
│  │ ● w-delta    Starting  bd-1849  (just assigned)            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Events at this moment:                                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ ▶ 14:32:07  w-alpha   Edit src/auth/login.ts               │   │
│  │   14:32:05  w-bravo   Read src/validators/index.ts         │   │
│  │   14:32:04  w-delta   Starting task bd-1849                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  [j/k] Frame step  [Space] Play/Pause  [←/→] Seek  [q] Exit        │
└─────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Playback speeds: 0.5x, 1x, 2x, 5x, 10x
- Click timeline to jump to any point
- Frame-by-frame stepping (j/k or arrow keys)
- Keyboard shortcuts for common actions
- Export replay as shareable link or file

**Implementation:**
- Events are already timestamped in logs
- Replay = render events progressively based on timestamps
- No additional storage needed

---

### 6. Smart Error Grouping

Don't scatter errors through the log stream. Group and contextualize them:

```
┌─ Errors (3 unique, 5 total) ───────────────────────────────────────┐
│                                                                     │
│  ┌─ API Rate Limit ──────────────────────────────────────────────┐ │
│  │  Occurrences: 2                                               │ │
│  │  Workers: w-alpha, w-bravo                                    │ │
│  │  First: 14:31:07  Last: 14:31:12  (5s span)                  │ │
│  │                                                               │ │
│  │  Context:                                                     │ │
│  │    Both workers were making parallel Grep calls during        │ │
│  │    search phase. Hit rate limit on Anthropic API.            │ │
│  │                                                               │ │
│  │  Similar past error: 2026-03-01 09:15                        │ │
│  │    Resolution: Added 500ms delay between API calls            │ │
│  │                                                               │ │
│  │                                  [View Events] [View Context] │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ FileNotFoundError ───────────────────────────────────────────┐ │
│  │  Occurrences: 2                                               │ │
│  │  Workers: w-charlie                                           │ │
│  │  File: src/legacy/old-utils.ts                               │ │
│  │                                                               │ │
│  │  Context:                                                     │ │
│  │    File was deleted by w-alpha 2m before this error.         │ │
│  │    w-charlie's task bd-1845 had stale file reference.        │ │
│  │                                                               │ │
│  │                                  [View Events] [View Context] │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ TypeScript Compile Error ────────────────────────────────────┐ │
│  │  Occurrences: 1                                               │ │
│  │  Worker: w-delta                                              │ │
│  │  File: src/api/handlers.ts:47                                │ │
│  │                                                               │ │
│  │  Error: Property 'userId' does not exist on type 'Request'   │ │
│  │                                                               │ │
│  │  Context:                                                     │ │
│  │    Edit at 14:30:22 changed Request type definition          │ │
│  │    but handlers.ts wasn't updated to match.                  │ │
│  │                                                               │ │
│  │                                  [View Events] [View Context] │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Group by error signature (type + message pattern)
- Show occurrence count and time span
- Auto-detect likely cause from preceding events
- Link to similar past errors (if pattern matching enabled)
- One-click to see full stack trace and surrounding context

---

### 7. Command Palette (Ctrl+K / Cmd+K)

Universal search and command interface:

```
┌─────────────────────────────────────────────────────────────────────┐
│  > auth login_                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Files                                                              │
│    📄 src/auth/login.ts           (18 operations)                  │
│    📄 src/auth/login.test.ts      (4 operations)                   │
│                                                                     │
│  Beads                                                              │
│    📋 bd-1847 "Implement auth login flow"                          │
│    📋 bd-1823 "Fix login validation bug"                           │
│                                                                     │
│  Log entries                                                        │
│    14:32:07 w-alpha Edit src/auth/login.ts                         │
│    14:31:47 w-alpha Read src/auth/login.ts                         │
│    14:28:12 w-bravo Grep "login" in src/                           │
│                                                                     │
│  Commands                                                           │
│    🔧 Filter: Show only login-related events                       │
│    🔧 Jump to first mention of "login"                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Available Commands:**

| Command | Description |
|---------|-------------|
| `>worker alpha` | Jump to w-alpha detail view |
| `>bead 1847` | Show all events for bd-1847 |
| `>file auth.ts` | Show all operations on matching files |
| `>errors` | Jump to error panel |
| `>filter level:error` | Filter to errors only |
| `>filter worker:alpha` | Filter to one worker |
| `>filter last:5m` | Filter to last 5 minutes |
| `>goto 14:30` | Jump to timestamp |
| `>theme dark` | Switch color theme |
| `>replay` | Enter replay mode |
| `>export` | Export current view |

**Features:**
- Fuzzy matching on all inputs
- Recent commands history
- Keyboard-first (arrow keys to navigate, Enter to select)
- Context-aware suggestions

---

### 8. Cost & Token Tracking

Real-time visibility into API usage:

```
┌─ Cost Dashboard ────────────────────────────────────────────────────┐
│                                                                     │
│  Session Cost     $4.23 / $50.00 daily budget                      │
│                   ████████░░░░░░░░░░░░░░░░░░░░░░░░  8.5%           │
│                                                                     │
│  ┌─ Per Worker (this session) ──────────────────────────────────┐  │
│  │                                                               │  │
│  │  w-alpha     $1.82   ████████████████░░░░░░░░   ~68k tokens  │  │
│  │              ├─ Input:  52k tokens ($0.78)                   │  │
│  │              └─ Output: 16k tokens ($1.04)                   │  │
│  │                                                               │  │
│  │  w-bravo     $1.15   ██████████░░░░░░░░░░░░░░   ~43k tokens  │  │
│  │              ├─ Input:  35k tokens ($0.53)                   │  │
│  │              └─ Output:  8k tokens ($0.62)                   │  │
│  │                                                               │  │
│  │  w-charlie   $0.78   ███████░░░░░░░░░░░░░░░░░   ~29k tokens  │  │
│  │  w-delta     $0.48   ████░░░░░░░░░░░░░░░░░░░░   ~18k tokens  │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ Per Task ───────────────────────────────────────────────────┐  │
│  │                                                               │  │
│  │  bd-1847 "Implement auth flow"        $1.82   (in progress)  │  │
│  │  bd-1852 "Fix login validation"       $1.15   (in progress)  │  │
│  │  bd-1845 "Add user profile endpoint"  $0.78   (completed)    │  │
│  │  bd-1849 "Add unit tests"             $0.48   (in progress)  │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Rate: ~$0.12/min (last 5 min avg)                                 │
│  Projected session total: $8.40 (at current rate)                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Real-time token counting from NEEDLE logs
- Cost calculation based on model pricing
- Budget alerts (warning at 80%, critical at 95%)
- Per-worker and per-task breakdowns
- Burn rate and projection

**Budget Alert:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️  BUDGET WARNING                                                 │
│                                                                     │
│  Daily budget 80% consumed ($40.12 / $50.00)                       │
│  Current burn rate: $0.45/min                                      │
│  Time until budget exhausted: ~22 minutes                          │
│                                                                     │
│  Top consumers:                                                     │
│    w-alpha (bd-1847): $12.34 - complex implementation task         │
│    w-bravo (bd-1852): $8.92  - debugging loop detected             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 9. Task Dependency DAG

Visual directed graph showing task relationships:

```
┌─ Task Dependencies ─────────────────────────────────────────────────┐
│                                                                     │
│         ┌──────────────┐                                           │
│         │   bd-1840    │                                           │
│         │   Setup DB   │                                           │
│         │  ✅ Complete │                                           │
│         └──────┬───────┘                                           │
│                │                                                    │
│       ┌────────┴────────┐                                          │
│       │                 │                                          │
│       ▼                 ▼                                          │
│  ┌──────────────┐  ┌──────────────┐                                │
│  │   bd-1847    │  │   bd-1848    │                                │
│  │   Auth API   │  │   User API   │                                │
│  │  ● Running   │  │  ◌ Blocked   │ ← blocked by bd-1847           │
│  │   w-alpha    │  │              │                                │
│  └──────┬───────┘  └──────────────┘                                │
│         │                 │                                         │
│         │                 │                                         │
│         ▼                 │                                         │
│  ┌──────────────┐         │                                        │
│  │   bd-1849    │◄────────┘                                        │
│  │  Unit Tests  │                                                  │
│  │  ● Running   │                                                  │
│  │   w-delta    │                                                  │
│  └──────┬───────┘                                                  │
│         │                                                           │
│         ▼                                                           │
│  ┌──────────────┐                                                  │
│  │   bd-1852    │                                                  │
│  │  Integration │                                                  │
│  │  ○ Pending   │                                                  │
│  └──────────────┘                                                  │
│                                                                     │
│  Legend: ✅ Complete  ● Running  ◌ Blocked  ○ Pending              │
│                                                                     │
│  Critical path: bd-1840 → bd-1847 → bd-1849 → bd-1852              │
│  Estimated completion: 12 min (based on similar tasks)             │
│                                                                     │
│  [Click any node to view details]                                  │
└─────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Visual DAG layout (auto-arranged or manual)
- Color-coded by status
- Click nodes to navigate to task details
- Critical path highlighting
- Blocked task explanation on hover
- Zoom and pan for large graphs

**Web version** uses interactive SVG/Canvas with:
- Drag to pan
- Scroll to zoom
- Click to select
- Hover for details

---

### 10. File Activity Heatmap

Visual representation of where work is happening:

```
┌─ File Activity (last 30 min) ───────────────────────────────────────┐
│                                                                     │
│  src/                                                    Operations │
│  ├── auth/                                           🔥 Hot zone   │
│  │   ├── login.ts          ████████████████████████████░░   28    │
│  │   ├── types.ts          ██████████████████░░░░░░░░░░░░   18    │
│  │   ├── middleware.ts     ████████░░░░░░░░░░░░░░░░░░░░░░    8    │
│  │   └── utils.ts          ████░░░░░░░░░░░░░░░░░░░░░░░░░░    4    │
│  │                                                                  │
│  ├── api/                                                          │
│  │   ├── routes.ts         ██████████████░░░░░░░░░░░░░░░░   14    │
│  │   ├── handlers.ts       ██████████░░░░░░░░░░░░░░░░░░░░   10    │
│  │   └── middleware.ts     ██░░░░░░░░░░░░░░░░░░░░░░░░░░░░    2    │
│  │                                                                  │
│  ├── utils/                                                        │
│  │   └── validation.ts     ████████████░░░░░░░░░░░░░░░░░░   12    │
│  │                                                                  │
│  └── tests/                                                        │
│      ├── auth.test.ts      ██████░░░░░░░░░░░░░░░░░░░░░░░░    6    │
│      └── api.test.ts       ████░░░░░░░░░░░░░░░░░░░░░░░░░░    4    │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  Hotspots:                                                         │
│    🔥 src/auth/login.ts       28 ops  (w-alpha: 22, w-bravo: 6)   │
│    🔥 src/auth/types.ts       18 ops  (w-alpha: 18)                │
│                                                                     │
│  Unexpected activity:                                              │
│    ⚠️  src/config/db.ts       Modified outside of db-related task  │
│                                                                     │
│  [Click any file to see operations]                                │
└─────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Tree view matching project structure
- Heat coloring (gray → yellow → orange → red)
- Operation counts per file
- Per-worker breakdown on hover/expand
- Hotspot summary
- Anomaly detection (unexpected files being touched)
- Click to see all operations on that file

**Web version** can use:
- Treemap visualization (rectangles sized by activity)
- Interactive file tree with expandable nodes
- Time-lapse animation showing activity over time

---

### 11. Conversation Transcript View

Show the actual Claude conversation—prompts and responses—not just tool calls. Tool calls are symptoms; the conversation is the substance.

```
┌─ Conversation: w-alpha ─────────────────────────────────────────────┐
│                                                                     │
│  ┌─ System ─────────────────────────────────────────────────────┐  │
│  │ You are working on bd-1847: Implement authentication flow    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ Assistant ──────────────────────────────────────────────────┐  │
│  │ I'll start by understanding the existing auth structure.     │  │
│  │ Let me examine the current implementation.                   │  │
│  │                                                              │  │
│  │ [Tool: Glob **/*.ts in src/auth/]                           │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ Tool Result ────────────────────────────────────────────────┐  │
│  │ Found 4 files: login.ts, types.ts, middleware.ts, utils.ts  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ Assistant ──────────────────────────────────────────────────┐  │
│  │ Good, there's an existing auth module. I see login.ts       │  │
│  │ handles the login flow. Let me read it to understand the    │  │
│  │ current approach before making changes.                      │  │
│  │                                                              │  │
│  │ [Tool: Read src/auth/login.ts]                              │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  View: [Conversation] [Tools Only] [Thinking Only]                 │
└─────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Full conversation history with role labels (System, User, Assistant, Tool)
- Collapsible tool calls and results
- "Thinking" blocks shown separately (if available in logs)
- Search within conversation
- Jump between turns
- Sync with activity stream (click event → jump to conversation point)

**Why valuable:** Users see *why* decisions were made, not just what happened. Debug reasoning failures, understand worker logic, learn from good decisions.

---

### 12. Semantic Activity Narrative

Real-time natural language description of what's happening, updated as workers progress:

```
┌─ Live Narrative ────────────────────────────────────────────────────┐
│                                                                     │
│  w-alpha (bd-1847 "Implement auth flow")                           │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  Phase: Implementation (was: Research)                              │
│                                                                     │
│  "Alpha finished analyzing the existing auth code and is now       │
│   writing a new JWT-based login function. It has created the       │
│   token generation logic and is currently implementing the         │
│   validation middleware."                                           │
│                                                                     │
│  Key decisions made:                                                │
│    • Chose JWT over session cookies (for stateless scaling)        │
│    • Using existing User type from types.ts                        │
│    • Adding refresh token support                                  │
│                                                                     │
│  ──────────────────────────────────────────────────────────────────│
│                                                                     │
│  w-bravo (bd-1852 "Fix login validation")                          │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│  Phase: Debugging                                                   │
│                                                                     │
│  "Bravo identified the validation bug: the email regex was too     │
│   strict and rejected valid .co.uk addresses. Currently writing    │
│   a fix and adding test cases for edge cases."                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Phases detected:**
- Research (reading files, searching codebase)
- Planning (analyzing, deciding approach)
- Implementation (writing/editing code)
- Testing (running tests, fixing failures)
- Debugging (investigating errors, fixing issues)
- Finalizing (committing, cleanup)

**Features:**
- Auto-generated from activity patterns
- Phase transitions highlighted
- Key decisions extracted from conversation
- Updates in real-time as events arrive
- Expandable for more detail

**Why valuable:** Instant understanding without parsing logs. Executives, PMs, or anyone can understand status at a glance.

---

### 13. AI Session Digest

On-demand or automatic session summaries:

```
┌─ Session Digest ────────────────────────────────────────────────────┐
│                                                                     │
│  Session: 2026-03-02 14:00-15:45 (1h 45m)                          │
│                                                                     │
│  📊 Overview                                                        │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Workers: 4         Tasks completed: 5/7                     │  │
│  │  Cost: $8.42        Files changed: 23                        │  │
│  │  Commits: 3         Lines added: 847  deleted: 234          │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ✅ Completed                                                       │
│    • bd-1847: Implemented JWT authentication with refresh tokens   │
│    • bd-1852: Fixed email validation to support all TLDs          │
│    • bd-1845: Added user profile CRUD endpoints                    │
│    • bd-1849: Created unit tests for auth module (94% coverage)   │
│    • bd-1850: Refactored error handling to use custom exceptions  │
│                                                                     │
│  🔄 In Progress                                                     │
│    • bd-1853: Integration tests (60% complete, est. 15 min)       │
│    • bd-1854: API documentation (blocked by bd-1853)              │
│                                                                     │
│  ⚠️ Issues Encountered                                              │
│    • Rate limit hit at 14:32 (resolved: added retry logic)        │
│    • w-alpha/w-bravo collision on types.ts (resolved: merged)     │
│                                                                     │
│  💡 Observations                                                    │
│    • w-alpha most efficient ($1.40/task avg)                      │
│    • Auth implementation took 2x expected time (complex codebase) │
│    • Consider: break large tasks into smaller chunks              │
│                                                                     │
│  [Copy Summary] [Export Markdown] [Share Link]                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Generation triggers:**
- On-demand via command palette (`>digest`)
- Automatic at session end
- Periodic (every 30 min) if enabled

**Export formats:**
- Markdown (for docs/Slack)
- JSON (for integrations)
- Plain text (for email)

**Why valuable:** Stakeholder communication in one click. Daily standup prep. Historical record of what was accomplished. No manual note-taking.

---

### 14. File Context Panel

When a worker interacts with a file, show its content in a persistent side panel:

```
┌─ Activity ──────────────────────┬─ File Context ─────────────────────┐
│                                 │                                     │
│  14:32:07  w-alpha              │  src/auth/login.ts                 │
│  Edit src/auth/login.ts        │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│                                 │                                     │
│  14:32:01  w-alpha              │   1│ import { User } from './types' │
│  Read src/auth/types.ts        │   2│ import { hash } from 'bcrypt'; │
│   ↳ 42 lines                    │   3│                               │
│                                 │   4│ export async function login(  │
│  14:31:55  w-alpha              │   5│   email: string,              │
│  Analyzing dependencies...      │   6│   password: string            │
│                                 │   7│ ): Promise<User> {            │
│  14:31:47  w-alpha              │   8│   const user = await findUser │
│  Glob **/*.ts                   │   9│   if (!user) {                │
│   ↳ Found 23 files              │  10│     throw new AuthError();    │
│                                 │  11│   }                           │
│                                 │  12│                               │
│  [Click any file event to      │  13│   const valid = await compare │
│   see file context]             │  14│   if (!valid) {               │
│                                 │  15│     throw new AuthError();    │
│                                 │  16│   }                           │
│                                 │  17│                               │
│                                 │  18│   return sanitize(user);      │
│                                 │  19│ }                             │
│                                 │                                     │
│                                 │  ─────────────────────────────────  │
│                                 │  Recent operations on this file:   │
│                                 │   • Read by w-alpha (14:32:01)     │
│                                 │   • Edit by w-alpha (14:32:07)     │
│                                 │                                     │
│                                 │  [Open in Editor] [Show Full File] │
└─────────────────────────────────┴─────────────────────────────────────┘
```

**Features:**
- Auto-updates when new file event selected
- Syntax highlighting based on file extension
- Line numbers with highlight on relevant lines
- Sticky panel - stays visible while scrolling activity
- File history: see all operations on this file
- Quick toggle between recently touched files
- "Open in Editor" button (launches configured editor)

**TUI layout:**
- Vertical split (activity left, file right)
- Toggle with `Ctrl+F` or `[` / `]` to resize
- `Tab` to switch focus between panels

**Web layout:**
- Collapsible side panel
- Resizable divider
- Can pop out to separate window

**Why valuable:** Full context without context-switching. Understand *what* workers are working with, not just *that* they're working.

---

### 15. Git Integration Panel

Live view of version control state as workers make changes:

```
┌─ Git Status ────────────────────────────────────────────────────────┐
│                                                                     │
│  Branch: feature/auth-jwt (3 commits ahead of main)                │
│                                                                     │
│  Uncommitted Changes (5 files)                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  M  src/auth/login.ts          +47 -12    w-alpha           │  │
│  │  M  src/auth/types.ts          +18 -3     w-alpha           │  │
│  │  A  src/auth/jwt.ts            +89        w-alpha           │  │
│  │  M  src/auth/middleware.ts     +23 -8     w-alpha           │  │
│  │  D  src/auth/legacy-auth.ts    -127       w-alpha (pending) │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Preview Commit                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  feat(auth): implement JWT-based authentication             │  │
│  │                                                              │  │
│  │  - Add JWT token generation and validation                  │  │
│  │  - Add refresh token support                                │  │
│  │  - Migrate from legacy session-based auth                   │  │
│  │  - Add middleware for protected routes                      │  │
│  │                                                              │  │
│  │  Breaking change: removes legacy auth endpoints             │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Potential Conflicts                                                │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  ⚠️  main has 2 new commits since branch creation            │  │
│  │     • fix: update bcrypt dependency (touches auth/login.ts) │  │
│  │     Recommendation: rebase before merging                   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  [View Full Diff] [Preview PR] [Refresh]                           │
└─────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Real-time git status from working directory
- Shows which worker made each change
- Auto-generates preview commit message from activity
- Detects potential conflicts with upstream
- PR preview (title, description, files changed)
- Branch visualization

**Data sources:**
- `git status` for uncommitted changes
- `git log` for commit history
- `git fetch` + `git log origin/main..HEAD` for upstream comparison
- Activity logs for worker attribution

**Why valuable:** Git is the ultimate source of truth. Seeing changes in git context makes worker activity concrete. Catch conflicts early. Preview PRs before they exist.

---

### 16. Worker Comparison Analytics

Compare worker performance over time to optimize allocation:

```
┌─ Worker Analytics ──────────────────────────────────────────────────┐
│                                                                     │
│  Comparison: Last 7 days (23 sessions, 89 tasks)                   │
│                                                                     │
│  ┌─ Efficiency Ranking ─────────────────────────────────────────┐  │
│  │                                                               │  │
│  │  Worker      Tasks   Avg Time   Cost/Task   Success   Score  │  │
│  │  ──────────────────────────────────────────────────────────  │  │
│  │  w-alpha       28     8.2m       $1.12       96%       A     │  │
│  │  w-charlie     24     9.5m       $1.34       92%       A-    │  │
│  │  w-delta       22    10.1m       $1.28       94%       B+    │  │
│  │  w-bravo       15    12.4m       $1.67       87%       B     │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ Task Type Performance ──────────────────────────────────────┐  │
│  │                                                               │  │
│  │  Task Type        Best Worker    Avg Time   vs. Others       │  │
│  │  ─────────────────────────────────────────────────────────── │  │
│  │  Implementation   w-alpha        7.8m       -22% faster      │  │
│  │  Bug fixes        w-charlie      5.2m       -15% faster      │  │
│  │  Refactoring      w-delta        6.1m       -8% faster       │  │
│  │  Tests            w-alpha        4.3m       -31% faster      │  │
│  │  Documentation    w-bravo        3.8m       -5% faster       │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ Trends ─────────────────────────────────────────────────────┐  │
│  │                                                               │  │
│  │  Cost per task (7-day trend)                                 │  │
│  │                                                               │  │
│  │  $2.00 │                                                     │  │
│  │        │  ╭─╮                                                │  │
│  │  $1.50 │ ╭╯  ╰╮    ╭─╮                                      │  │
│  │        │╭╯    ╰────╯  ╰──────────────                       │  │
│  │  $1.00 │                                                     │  │
│  │        └─────────────────────────────────────────────────    │  │
│  │         Mon   Tue   Wed   Thu   Fri   Sat   Sun              │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ Insights ───────────────────────────────────────────────────┐  │
│  │                                                               │  │
│  │  💡 w-alpha excels at complex implementation tasks           │  │
│  │  💡 w-charlie is most cost-efficient for quick fixes        │  │
│  │  ⚠️  w-bravo has higher retry rate (12% vs 5% avg)           │  │
│  │  💡 Parallel workers reduce total time by 40% on avg        │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  [Export Report] [Configure Metrics] [Compare Sessions]            │
└─────────────────────────────────────────────────────────────────────┘
```

**Metrics tracked:**
- Tasks completed
- Average completion time
- Cost per task
- Success/failure rate
- Retry frequency
- Tool usage patterns

**Comparisons:**
- Worker vs worker
- Session vs session
- Current session vs historical average

**Why valuable:** Data-driven worker optimization. Understand which configurations work best. Identify issues before they compound. Improve over time.

---

### 17. Recovery Playbook

When failures occur, show what worked in similar past situations:

```
┌─ Recovery Suggestions ──────────────────────────────────────────────┐
│                                                                     │
│  Current Error                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Worker: w-bravo                                              │  │
│  │  Error: TypeScript compilation failed                        │  │
│  │  File: src/api/handlers.ts:47                                │  │
│  │  Message: Property 'userId' does not exist on type 'Request' │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Similar Past Errors (3 found)                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                                                               │  │
│  │  #1  2026-02-28 Session (98% match)                          │  │
│  │      Error: Property 'user' does not exist on type 'Request' │  │
│  │      Resolution: Extended Request type in types/express.d.ts │  │
│  │      Time to resolve: 2 minutes                              │  │
│  │      ✅ Successful                                            │  │
│  │      [View Solution] [Show Context]                          │  │
│  │                                                               │  │
│  │  ────────────────────────────────────────────────────────── │  │
│  │                                                               │  │
│  │  #2  2026-02-25 Session (85% match)                          │  │
│  │      Error: Property 'session' missing on Request            │  │
│  │      Resolution: Added middleware to populate property       │  │
│  │      Time to resolve: 5 minutes                              │  │
│  │      ✅ Successful                                            │  │
│  │      [View Solution]                                          │  │
│  │                                                               │  │
│  │  ────────────────────────────────────────────────────────── │  │
│  │                                                               │  │
│  │  #3  2026-02-20 Session (72% match)                          │  │
│  │      Error: Type mismatch in handler                         │  │
│  │      Resolution: Updated type definition                     │  │
│  │      ⚠️  Caused regression - NOT RECOMMENDED                  │  │
│  │      [View Details]                                           │  │
│  │                                                               │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Suggested Recovery Steps                                           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Based on successful past resolutions:                       │  │
│  │                                                               │  │
│  │  1. Check if userId is set by auth middleware                │  │
│  │  2. Extend Request type in types/express.d.ts                │  │
│  │  3. Verify middleware order in app setup                     │  │
│  │                                                               │  │
│  │  Confidence: High (2/3 past solutions worked)                │  │
│  │                                                               │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  [Dismiss] [Mark as Resolved] [Add to Playbook]                    │
└─────────────────────────────────────────────────────────────────────┘
```

**How it works:**
1. Extract error signature (type, message pattern, file pattern)
2. Search historical session logs for similar errors
3. Find subsequent events that resolved the error
4. Rank by similarity and success rate
5. Present as actionable suggestions

**Error matching:**
- Exact match: same error type and message
- Pattern match: similar error type, related files
- Semantic match: similar context (same task type, same module)

**Feedback loop:**
- Mark resolution as successful/failed
- Improves future recommendations
- Build organizational knowledge base

**Why valuable:** Institutional memory. Don't repeat mistakes. Accelerate debugging. Workers (and humans) learn from past sessions.

---

### 18. Focus Mode with Pinning

Pin specific workers, tasks, or files. Everything else fades away:

```
┌─ FABRIC (Focus Mode) ───────────────────────────────────────────────┐
│                                                                     │
│  📌 Pinned: w-alpha, bd-1847                    [Exit Focus Mode]   │
│                                                                     │
│  ┌─ w-alpha on bd-1847 "Implement auth flow" ───────────────────┐  │
│  │                                                               │  │
│  │  Status: ● Running (8m 34s)     Cost: $1.82                  │  │
│  │                                                               │  │
│  │  Progress                                                     │  │
│  │  ━━━━━━━━━━━━━━━━━━━━━━━━━●━━━━━━━━━━━━  ~70% complete       │  │
│  │  Research → Implementation → [Testing]                        │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Activity (filtered to pinned only)                                │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                                                               │  │
│  │  14:32:07  Edit src/auth/login.ts                            │  │
│  │            ┌─────────────────────────────────────────────┐   │  │
│  │            │ - function login() {                        │   │  │
│  │            │ + async function login(): Promise<User> {   │   │  │
│  │            └─────────────────────────────────────────────┘   │  │
│  │                                                               │  │
│  │  14:32:01  Read src/auth/types.ts                            │  │
│  │                                                               │  │
│  │  14:31:55  Thinking: "Now I need to implement the token     │  │
│  │            validation. I'll create a new middleware..."       │  │
│  │                                                               │  │
│  │  14:31:47  Glob **/*.ts → 23 files                           │  │
│  │                                                               │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│  Other activity (3 workers, muted)              [Show All]         │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Pinning modes:**
- Pin worker: Show only that worker's activity
- Pin task (bead): Show all workers working on that task
- Pin file: Show all operations on that file
- Pin multiple: Combine any of the above

**Keyboard shortcuts:**
- `p` - Toggle pin mode
- `P` - Clear all pins
- Click/Enter on item while in pin mode adds to pins
- `Esc` - Exit focus mode

**Visual treatment:**
- Pinned items: Full color, full detail
- Unpinned items: Grayed out, collapsed, or hidden
- Muted activity bar at bottom shows unpinned worker count

**Presets:**
- Save pin configurations as named presets
- Quick switch: `>focus alpha` or `>focus auth-task`

**Why valuable:** Reduce noise. Follow what matters. Deep focus on one task without distraction. Scales from "show me everything" to "show me just this."

---

## CLI Interface

```bash
# TUI - live terminal dashboard
fabric tui                              # Read from ~/.needle/logs/
fabric tui --source /path/to/logs/      # Read from specific path
fabric tui --worker w-abc123            # Filter to one worker

# Web - live browser dashboard
fabric web                              # Serve on http://localhost:3000
fabric web --port 8080                  # Custom port
fabric web --source /path/to/logs/      # Read from specific path

# Simple log streaming (parsed + formatted, also live)
fabric logs                             # Stream parsed logs to stdout
fabric logs --level error               # Filter by level
fabric logs --worker w-abc123           # Filter by worker
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         FABRIC                              │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐    ┌─────────┐    ┌───────────────────────┐  │
│  │   Log    │───▶│ Parser  │───▶│   Display Renderer    │  │
│  │  Tailer  │    │         │    │   (TUI or Web)        │  │
│  └──────────┘    └─────────┘    └───────────────────────┘  │
│       │                                    │                │
│   ~/.needle/logs/                    Terminal or           │
│   (tail -f style)                    localhost:3000        │
└─────────────────────────────────────────────────────────────┘
```

### Components

1. **Log Tailer**: Continuously read new lines from log files (like `tail -f`)
2. **Parser**: Parse JSON log lines into structured events
3. **Display Renderer**: Update TUI or push to WebSocket clients

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Log tailer that watches `~/.needle/logs/`
- [ ] JSON line parser
- [ ] Event emitter for parsed events
- [ ] In-memory event index (by worker, bead, file, timestamp)
- [ ] Conversation transcript parser (extract full conversation from logs)

### Phase 2: TUI Display
- [ ] Worker list panel
- [ ] Live log stream panel
- [ ] Worker detail panel
- [ ] Keyboard controls and filtering
- [ ] Command palette (Ctrl+K)
- [ ] File context panel (split view)
- [ ] Focus mode with pinning

### Phase 3: Web Display
- [ ] HTTP server with WebSocket support
- [ ] Real-time event streaming to browser
- [ ] React/Svelte dashboard UI
- [ ] Worker cards and activity feed
- [ ] Command palette (Cmd+K)
- [ ] File context panel (side panel)
- [ ] Focus mode with pinning

### Phase 4: Intelligence Features (Core)
- [ ] Cross-reference hyperlinking (bead, file, worker links)
- [ ] Inline diff view for Edit tool calls
- [ ] File activity heatmap
- [ ] Cost & token tracking dashboard
- [ ] Conversation transcript view

### Phase 5: Intelligence Features (Detection)
- [ ] Stuck detection (no progress timeout)
- [ ] Loop detection (repeated actions on same file)
- [ ] Worker collision detection (overlapping file edits)
- [ ] Smart error grouping with context
- [ ] Semantic activity narrative (phase detection)

### Phase 6: Context & Integration
- [ ] Git integration panel (status, diff preview, conflict detection)
- [ ] AI session digest generation
- [ ] Worker comparison analytics
- [ ] Historical session index for comparisons

### Phase 7: Advanced Features
- [ ] Session replay with timeline scrubbing
- [ ] Task dependency DAG visualization
- [ ] Budget alerts and projections
- [ ] Anomaly detection (unexpected file activity)
- [ ] Recovery playbook (error pattern matching)

## Technology Options

### Log Tailer
- Node.js `fs.watch` + readline
- Go `fsnotify` + bufio
- `tail` module (Node.js)

### TUI
- **blessed** (Node.js) - Full-featured terminal UI
- **ink** (Node.js) - React for CLIs
- **bubbletea** (Go) - Elegant TUI framework

### Web
- **Express + ws** (Node.js) - Simple HTTP + WebSocket
- **Fastify** (Node.js) - Fast HTTP server
- **Fiber** (Go) - Express-style for Go
- **React/Svelte** - Frontend framework

## Example Usage

```bash
# Start TUI dashboard
fabric tui

# Start web dashboard
fabric web
# Then open http://localhost:3000 in browser

# Stream logs to terminal (simple mode)
fabric logs --follow
```

## Non-Goals

- ❌ Static report generation (FABRIC is live, not batch)
- ❌ Persistent storage (all state is in-memory, derived from logs)
- ❌ External database (logs are the source of truth)
- ❌ Push notifications (alerts are in-UI only)
- ❌ Worker control (FABRIC is read-only, cannot stop/start workers)

FABRIC is a live display with intelligence. It shows what NEEDLE is doing, detects problems, and helps you understand your workers.

---

**Status**: Planning phase
**Last Updated**: 2026-03-02
