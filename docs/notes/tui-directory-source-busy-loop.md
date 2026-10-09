# TUI directory-source busy-loop — root cause (fabric-0386d35e)

`fabric tui --source <dir>` pins a core at ~100% and never renders on
realistic directories. This note records the root cause originally **confirmed
against main** (commit `ffe9323`, 2026-09-18) by (a) pausing a live spinning
process and capturing its synchronous call stack via the inspector protocol,
(b) an event-loop heartbeat probe, and (c) a controlled amplification
measurement. The file:line citations were re-verified against current main at
commit `8d382f7ec30ff6465893d5fcfcc84993bd28012d` on 2026-10-08. Reproduce
with `scripts/gen-synthetic-logs.sh`.

The 2026-10-08 re-verification found no substantive change to the root-cause
claims. `src/cli.ts` and `src/tui/app.ts` have drifted since the prior
confirmation, so their citations below are updated; the
`directoryTailer.ts`, `tailer.ts`, and `ActivityStream.ts` citations still land
on the same code. In particular, the previously cited `src/cli.ts:180-188`,
`src/cli.ts:198-205`, and `src/cli.ts:292-293` windows were walked but now
cover workers-log handling/watching and web-command filter setup,
respectively; the TUI paths are now at `src/cli.ts:128-136`,
`src/cli.ts:146-153`, and `src/cli.ts:239-241`.

## TL;DR

The spin is **not** `fs.watch` and **not** the directory scan. It is two
multiplicative factors in the directory startup path:

1. **Full-history synchronous replay.** For every `*.jsonl` file whose mtime
   is within `startupRereadMs` (default 4 h), the tailer sets the start
   position to 0 and processes **every line of every such file in one
   uninterrupted synchronous pass** — no `await`, no timer, no yield between
   lines or between files.
2. **O(100×) render amplification per line.** Every replayed line synchronously
   triggers `TuiApp.addEvent()`, which performs **one incremental append plus
   two full re-renders** of the 100-line activity stream, then a third
   `screen.render()` — measured at **201 `log.log()` + 203 `_wrapContent()` +
   6 `screen.render()` ≈ 44–54 ms per line** on current main.

Their product makes the main thread disappear into a single synchronous
execution for minutes (small dirs) to hours (real log dirs). Because
`cli.ts` starts the tailer **before** the TUI's first paint, the first frame
cannot appear until the entire storm drains — which is why the screen stays
blank while one core burns.

## Four diagnostic answers

1. **Which loop burns the CPU, and why does it scale?** The CPU-burning loop is
   the synchronous `for` over lines in `LogTailer.readNewContent()` at
   `src/tailer.ts:179-183`, entered from `src/tailer.ts:158-188` while
   `DirectoryTailer.start()` activates files at
   `src/directoryTailer.ts:162-164`. It processes every replayed line without
   yielding, and each iteration emits one event into the render storm described
   below. The total startup work has the multiplicative shape
   **files-within-4h-window × events-per-file × per-line render cost**:
   `F_recent × E_file × C_line`, with `F_recent` capped by
   `maxActiveFiles` (200). The directory scan is also O(directory entries), but
   that is the short secondary cost; the minutes-to-hours cost is the replay
   product.

2. **Why does `-f <single file>` sleep correctly?** Single-file mode constructs
   `LogTailer` with `lines: 50` at `src/cli.ts:128-136`, so
   `readExistingLines()` at `src/tailer.ts:119-135` replays only the last 50
   lines and then returns. It has no `startPosition`, so it does not enter the
   catch-up path at `src/tailer.ts:111-113`. The directory path instead sets
   `position: 0` for each recently modified file and synchronously replays all
   of its history. After either bounded startup replay, `fs.watch` delivers
   live events one at a time, so the single-file path yields between events and
   appears idle when no new lines arrive.

3. **Is the missing render scan cost or a starved render loop?** Neither. The
   `readdirSync`/`statSync` scan at `src/directoryTailer.ts:136-158` takes
   seconds even for the large directory, and the TUI has no periodic render
   loop (`refreshInterval` is defaulted at `src/tui/app.ts:102-107` but is not
   consumed by any render timer).
   The first paint is simply sequenced after the unbounded synchronous replay
   (`src/cli.ts:239-241`), so that replay monopolizes the main thread before
   any frame can be drawn.

4. **Can the evidence be reproduced?** Yes. The commands in
   [Reproducing](#reproducing) generate a safe synthetic directory, launch the
   same startup path, pause it through the Node inspector, count heartbeat
   ticks, and instrument `dist/` to produce the per-event amplification table.

## The synchronous chain (file:line, verified on main)

Startup order — tailer first, first paint second:

- `src/cli.ts:239` — `tailer.start()`
- `src/cli.ts:240-241` — `app.start()` (the **first** `screen.render()`; only
  reached after the whole replay finishes)

Directory construction:

- `src/cli.ts:128-136` — resolved directory source → `DirectoryTailer` (the
  single-file `-f` path is configured with `lines: 50` in the same range)
- `src/directoryTailer.ts:136-158` — startup scan: `readdirSync` +
  `statSync` per file (secondary cost: ~seconds even at 34k files)
- `src/directoryTailer.ts:144-149` — files with mtime ≤ `startupRereadMs`
  (4 h) get `position: 0` → **full-history replay**; older files start at EOF
- `src/directoryTailer.ts:162-164` — up to `maxActiveFiles` (200) candidates
  activated **synchronously, back-to-back, in one tick**
- `src/directoryTailer.ts:245-255` — `activateFile` → `new LogTailer({ …,
  startPosition: info.position })`

Per-file replay (all synchronous):

- `src/tailer.ts:111-113` — with `startPosition` set, `start()` immediately
  calls `readNewContent()`
- `src/tailer.ts:158-188` — `readNewContent()`: `statSync`/`openSync`/
  `readSync`/`closeSync`, then processes **all** bytes since `position`
- `src/tailer.ts:179-183` — `for` loop over lines → `processLine(line)`
- `src/tailer.ts:208-217` — `processLine` emits `'event'` **per line**

Per-line render storm (the amplifier):

- `src/cli.ts:146-153` — `tailer.on('event')` → `store.add(event)` +
  `app.addEvent(event)`
- `src/tui/app.ts:2147-2180` — `TuiApp.addEvent`:
  `activityStream.addEvent(event)` (1 incremental append) **then**
  `renderWorkers()` **then** a second `activityStream.setFocusMode(...)` —
  each of the latter two triggering a full re-render — then another
  `screen.render()`
- `src/tui/app.ts:2137-2142` — `renderWorkers()` →
  `activityStream.setFocusMode(...)`
- `src/tui/components/ActivityStream.ts:361-366` — `setFocusMode` →
  `this.reRender()` (unconditionally, every time)
- `src/tui/components/ActivityStream.ts:293-305` — `reRender()`:
  `setContent('')` + up to **100** × `log.log()` + `screen.render()`
- `src/tui/components/ActivityStream.ts:189-202` — `addEvent` → 1 × `log.log()`

Inside blessed, every `log.log()` is O(widget content) — it re-wraps the whole
log box:

- `node_modules/blessed/lib/widgets/log.js:53-61` — `Log.prototype.log` ==
  `Log.prototype.add` → `pushLine(text)`
- `node_modules/blessed/lib/widgets/element.js:2526` — `pushLine` →
  `insertLine`
- `node_modules/blessed/lib/widgets/element.js:2383` — `insertLine` →
  `setContent`
- `node_modules/blessed/lib/widgets/element.js:335` → `:396` — `setContent` →
  `parseContent` → `_wrapContent(content, width)` (full re-wrap)
- `node_modules/blessed/lib/widgets/element.js:712` → `:557` —
  `_wrapContent` → `_align` per line

## Live evidence (2026-09-18, node v24.19.0)

Synthetic dir: 120 files × 400 events (`scripts/gen-synthetic-logs.sh
--count 120 --events-per-file 400`).

1. **Synchronous stack of the spinning process.** `kill -USR1` + inspector
   `Debugger.pause` on the live process (single captured sample; pauses
   coalesce while blocked):

   ```
   #0  Element._align            element.js:557
   #1  Element._wrapContent      element.js:712
   #2  Element.parseContent      element.js:396
   #3  Element.setContent        element.js:335
   #4  Element.insertLine        element.js:2383
   #5  Element.pushLine          element.js:2526
   #6  Log.add                   widgets/log.js:61
   #7  ActivityStream.reRender   ActivityStream (re-adding ≤100 events)
   #8  ActivityStream.setFocusMode → reRender
   #9  TuiApp.addEvent           (renderWorkers / second setFocusMode)
   #10 cli.ts tailer.on('event') → app.addEvent
   #11 DirectoryTailer 'event' relay
   #12 LogTailer.processLine     tailer.ts:208
   #13 LogTailer.readNewContent  tailer.ts:158 (line loop)
   #14 LogTailer.start           tailer.ts:111 (catch-up read)
   #15 DirectoryTailer.activateFile  directoryTailer.ts:245
   #16 DirectoryTailer.start         directoryTailer.ts:162
   ```

2. **The event loop never runs.** A `--require` probe registering a 250 ms
   `setInterval` at process start produced **zero ticks in 98 s** while the
   process sat at ~99% CPU — one continuous synchronous execution since
   startup. Consequence: SIGINT/SIGTERM JS handlers cannot run either, so the
   process ignores graceful kill signals while wedged (observed: survived
   `timeout -s INT` and `timeout`'s SIGTERM; only SIGKILL works).

3. **Per-event amplification** (micro-benchmark against `dist/`, steady-state
   ~100-line activity widget, 50 events):

   | metric | per ingested event |
   |---|---|
   | `log.log()` calls | 201 (1 append + 2 × ≤100 re-adds) |
   | `_wrapContent()` calls | 203 |
   | `screen.render()` calls | 6 |
   | wall time | **44–54 ms** |

4. **End-to-end time-to-first-event-loop-tick:** a 120-file × 5-event synthetic
   dir (600 events) freed the main thread only at **57.2 s** (~95 ms/event
   including I/O and `store.add`). Extrapolations: the 91-file / 40,079-event
   dir from the 2026-09-12 measurements ≈ **30–60 min** of blocked main
   thread (they gave up at 2m16s); `~/.needle/logs` (34,155 files, ≤200
   activated but the 4 h window holds their recent history) ≈ hours —
   "never renders".

## Why `-f <file>` behaves differently

Both paths are `fs.watch`-driven and event-driven afterwards; the difference
is entirely in **startup replay volume**:

- `-f` constructs `LogTailer` with `lines: 50` (`src/cli.ts:128-136`) →
  `readExistingLines()` (`src/tailer.ts:119-135`) reads the file but processes
  **only the last 50 lines**, once (~2–3 s of storm, then done). No
  `startPosition` → no catch-up read (`src/tailer.ts:111-113`).
- `--source <dir>` replays **every line of every recently-modified file**
  (position 0), each line paying the 44–54 ms render storm.

Steady state (after startup) explains the residual CPU numbers: with 3 files
(~101% CPU) and `-f` (48% CPU) the loop still costs ~44 ms per **live** event;
it yields between events, so renders happen — the burn rate tracks the event
rate. The large-directory case never gets that far: startup replay is ordered
**before** the first paint (`src/cli.ts:239-241`), and the TUI has **no
periodic render loop at all** (`refreshInterval` at
`src/tui/app.ts:45-46,102-107` is declared and defaulted but otherwise unused), so nothing can
paint until an explicit `screen.render()` finally runs.

So the answer to "startup-scan cost or starved render loop": **neither**.
The scan (`readdirSync`/`statSync`, `src/directoryTailer.ts:136-158`) is
seconds, not minutes. There is no background render loop to starve. The first
frame is simply *sequenced after* an unbounded synchronous replay, and each
replayed line costs ~50 ms of blessed re-wrapping. (`fabric digest` is
unaffected for the same reason: it ingests without building the TUI — 40k
events in <60 s.)

## Recommended fix shape (input to the fix child)

**Decision: keep `fs.watch` wake-ups event-driven; do not add interval
re-scanning.** `DirectoryTailer.start()` installs the directory watcher
(`src/directoryTailer.ts:166-172`) and `LogTailer.watch()` handles file changes
(`src/tailer.ts:140-148`). These are the wake-up paths to preserve; periodic
rescans would repeat O(directory) work on every tick.

Implement the following in order:

1. **P1 — coalesce render work; this is the primary, load-bearing fix.** In
   `FabricTuiApp.addEvent()` (`src/tui/app.ts:2147-2179`), keep the event append
   through `ActivityStream.addEvent()` (`src/tui/components/ActivityStream.ts:189-202`)
   inline, but debounce/coalesce the expensive worker/focus updates and screen
   paint behind a one-shot 100–250 ms timer. Schedule only when no flush is
   pending; while one is pending, further events update state without
   scheduling another or resetting the timer. This allows at most one full
   render pass per 100–250 ms window. The pass should update the
   worker grid and header, call `ActivityStream.setFocusMode()` once, and call
   `screen.render()` once, replacing the duplicate focus updates and paints in
   `FabricTuiApp.addEvent()` / `renderWorkers()` (`src/tui/app.ts:2137-2179`).
   In `ActivityStream.setFocusMode()` (`src/tui/components/ActivityStream.ts:361-366`),
   call `reRender()` only when the focus tuple actually changes; its current
   unconditional re-render rebuilds up to 100 log rows (`:293-305`).

   Rechecked on current `main` (`4512ef7`): `refreshInterval` is declared and
   defaulted (`src/tui/app.ts:45-46,102-107`) but no render timer consumes it.
   Treat it as unused configuration today; if it is reused for P1, wire it to
   the coalescing delay explicitly. P1 must reduce each ingested event to one
   append plus no more than one full render pass per 100–250 ms.

2. **P2 — make startup replay yield, after P1.** In
   `DirectoryTailer.start()` (`src/directoryTailer.ts:162-164`), yield with
   `setImmediate` between activated files. In `LogTailer.readNewContent()`
   (`src/tailer.ts:158-188`), replace the synchronous whole-file read and
   line loop with chunked asynchronous reads, yielding between chunks. Both
   are required: yielding only between files still lets one large file block
   the event loop. This lets timers, signals, and blessed run during catch-up.
   The known trap is that async reads **without P1 still burn the core**: each
   async continuation immediately re-arms the per-event render storm. That is
   why P1 is primary and P2 is supporting.

3. **Paint before catch-up.** In the `tui` command action
   (`src/cli.ts:239-241`), call `app.start()` before `tailer.start()` so the
   first frame is painted before replay begins and then fills in during
   catch-up.

Fix-child scope boundary: implementation + verification only; no further diagnosis.

## Reproducing

```bash
npm run build
REPRO_DIR=$(scripts/gen-synthetic-logs.sh --count 120 --events-per-file 400 | tail -1)
printf 'repro directory: %s\n' "$REPRO_DIR"
```

For the basic reproduction, run this in a terminal and leave it running:

```bash
node dist/cli.js tui --source "$REPRO_DIR"   # ~100% CPU, blank for tens of minutes
```

Smaller/faster variant: `--events-per-file 5` (600 events) still blocks the
main thread for ~57 s before the first timer tick fires. The script never
writes under `~/.needle/logs`.

The following probes rerun the three evidence captures using the generated
directory. Launch the TUI separately in each probe and clean up only after all
probes finish.

### Synchronous stack capture

```bash
node dist/cli.js tui --source "$REPRO_DIR" >"$REPRO_DIR/tui.out" 2>&1 &
PID=$!
kill -USR1 "$PID"                         # enable Node's inspector
for _ in $(seq 1 50); do
  WS_URL=$(curl -fsS http://127.0.0.1:9229/json/list 2>/dev/null |
    node -e 'let s=""; process.stdin.on("data", d => s += d).on("end", () => process.stdout.write(JSON.parse(s)[0].webSocketDebuggerUrl))' 2>/dev/null) &&
    [ -n "$WS_URL" ] && break
  sleep 0.1
done
: "${WS_URL:?inspector did not start on 127.0.0.1:9229}"
node - "$WS_URL" <<'NODE'
const WebSocket = require('ws');
const ws = new WebSocket(process.argv[2]);
ws.on('open', () => ws.send(JSON.stringify({ id: 1, method: 'Debugger.enable' })));
ws.on('message', raw => {
  const message = JSON.parse(raw);
  if (message.id === 1) {
    ws.send(JSON.stringify({ id: 2, method: 'Debugger.pause' }));
  } else if (message.method === 'Debugger.paused') {
    for (const [index, frame] of message.params.callFrames.entries()) {
      const line = frame.location.lineNumber + 1;
      console.log(`#${index} ${frame.functionName || '(anonymous)'} ${frame.url}:${line}`);
    }
    ws.send(JSON.stringify({ id: 3, method: 'Debugger.resume' }));
    ws.close();
  }
});
NODE
kill -KILL "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
```

The frames should end in `LogTailer.processLine`,
`LogTailer.readNewContent`, `LogTailer.start`,
`DirectoryTailer.activateFile`, and `DirectoryTailer.start`; the top frames
should be blessed's `_align`/`_wrapContent` path.

### Event-loop heartbeat

```bash
HEARTBEAT_PROBE=$(mktemp)
printf '%s\n' 'setInterval(() => console.error(`heartbeat ${Date.now()}`), 250);' >"$HEARTBEAT_PROBE"
node --require "$HEARTBEAT_PROBE" dist/cli.js tui --source "$REPRO_DIR" \
  >"$REPRO_DIR/heartbeat.out" 2>"$REPRO_DIR/heartbeat.err" &
PID=$!
sleep 10
printf 'heartbeat ticks in 10s: '
grep -c '^heartbeat ' "$REPRO_DIR/heartbeat.err" || true
kill -KILL "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
rm -f "$HEARTBEAT_PROBE"
```

On the spinning path the count remains zero; with a yielding path it becomes
nonzero. The same probe can be left running for the original 98-second
observation by changing `sleep 10` to `sleep 98`.

### Per-event amplification table

This probe pre-fills the activity widget to 100 events, resets its counters,
then measures 50 more events. It writes the result separately so blessed's
terminal control sequences do not obscure the JSON output.

```bash
AMP_OUT=$(mktemp)
AMP_OUT="$AMP_OUT" TERM=xterm-256color node --input-type=module > /dev/null 2>&1 <<'NODE'
import fs from 'node:fs';
import blessed from './node_modules/blessed/lib/blessed.js';
import { InMemoryEventStore } from './dist/store.js';
import { createTuiApp } from './dist/tui/app.js';

const measured = 50;
const counts = { log: 0, wrap: 0, render: 0 };
const originalLog = blessed.Log.prototype.log;
const originalWrap = blessed.Element.prototype._wrapContent;
const originalRender = blessed.Screen.prototype.render;
blessed.Log.prototype.log = function (...args) {
  counts.log++;
  return originalLog.apply(this, args);
};
blessed.Element.prototype._wrapContent = function (...args) {
  counts.wrap++;
  return originalWrap.apply(this, args);
};
blessed.Screen.prototype.render = function (...args) {
  counts.render++;
  return originalRender.apply(this, args);
};

const app = createTuiApp(new InMemoryEventStore(), { maxEvents: 100 });
const event = (i) => ({
  ts: Date.now() + i,
  worker: 'probe-worker',
  level: 'info',
  msg: `event ${i}`,
});
for (let i = 0; i < 100; i++) app.addEvent(event(i));
counts.log = counts.wrap = counts.render = 0;
const start = performance.now();
for (let i = 0; i < measured; i++) app.addEvent(event(100 + i));
fs.writeFileSync(process.env.AMP_OUT, JSON.stringify({
  log_log_calls_per_event: counts.log / measured,
  wrapContent_calls_per_event: counts.wrap / measured,
  screen_render_calls_per_event: counts.render / measured,
  wall_ms_per_event: (performance.now() - start) / measured,
}) + '\n');
process.exit(0);
NODE
cat "$AMP_OUT"
rm -f "$AMP_OUT"
find "$REPRO_DIR" -depth -delete
```

The resulting JSON corresponds directly to the table above: approximately
201 `log.log()` calls, 203 `_wrapContent()` calls, 6 `screen.render()` calls,
and 44–54 ms per event on the measured environment.

Re-verified 2026-09-19 at HEAD `5bdb723` (fabric-ac34599b, dispatch 3): default (120×400 = 48,000 lines) and explicit-flag (101×9 = 909 lines, `--dir` honored) runs exit 0 with the fresh mktemp path on the last stdout line; all 48,909 lines pass JSON + ingest-field checks and `normalizeToLogEvent` (the call at `src/tailer.ts:212`) with 0 invalid; `bash -n`/`--help`/exec bit clean; the `~/.needle/logs` guard refuses direct, subdir, symlink, `..`-escape, trailing-slash and hostile `${TMPDIR}` destinations (exit 1, empty stdout, no writes — the live logs dir's only delta during the window was concurrent fleet-worker logs, zero repro artifacts under it); bad-input battery (missing/non-numeric/zero/negative counts, unknown options) all exit 1 with clear errors; `npx tsc --noEmit` clean, `npm test` 2904 passed / 2 skipped; no script defect found.

verified: 2026-10-08 at HEAD `fbbd8007ede2ab56e4b4ccc414eea79b42867877`; default 120×400 and explicit 101×9 runs created 120 and 101 JSONL files under fresh `/tmp` paths, printed each path last, and validated all 48,909 lines as JSON plus `normalizeToLogEvent`; `bash -n`, executable bit, `--help`, direct/symlink/traversal/hostile-`TMPDIR` guards, invalid-input battery, `npx tsc --noEmit`, and `npm test` (3759 passed, 2 skipped) passed; generated directories removed.
