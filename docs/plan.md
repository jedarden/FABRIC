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

### Phase 2: TUI Display
- [ ] Worker list panel
- [ ] Live log stream panel
- [ ] Worker detail panel
- [ ] Keyboard controls and filtering
- [ ] Command palette (Ctrl+K)

### Phase 3: Web Display
- [ ] HTTP server with WebSocket support
- [ ] Real-time event streaming to browser
- [ ] React/Svelte dashboard UI
- [ ] Worker cards and activity feed
- [ ] Command palette (Cmd+K)

### Phase 4: Intelligence Features (Core)
- [ ] Cross-reference hyperlinking (bead, file, worker links)
- [ ] Inline diff view for Edit tool calls
- [ ] File activity heatmap
- [ ] Cost & token tracking dashboard

### Phase 5: Intelligence Features (Detection)
- [ ] Stuck detection (no progress timeout)
- [ ] Loop detection (repeated actions on same file)
- [ ] Worker collision detection (overlapping file edits)
- [ ] Smart error grouping with context

### Phase 6: Advanced Features
- [ ] Session replay with timeline scrubbing
- [ ] Task dependency DAG visualization
- [ ] Budget alerts and projections
- [ ] Anomaly detection (unexpected file activity)

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
