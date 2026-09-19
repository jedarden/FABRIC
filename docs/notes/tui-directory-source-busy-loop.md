# TUI directory-source busy-loop — root cause (fabric-0386d35e)

`fabric tui --source <dir>` pins a core at ~100% and never renders on
realistic directories. This note records the root cause **confirmed against
current main** (commit `ffe9323`, 2026-09-18) by (a) pausing a live spinning
process and capturing its synchronous call stack via the inspector protocol,
(b) an event-loop heartbeat probe, and (c) a controlled amplification
measurement. Reproduce with `scripts/gen-synthetic-logs.sh`.

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

## The synchronous chain (file:line, verified on main)

Startup order — tailer first, first paint second:

- `src/cli.ts:292` — `tailer.start()`
- `src/cli.ts:293` — `app.start()` (the **first** `screen.render()`; only
  reached after the whole replay finishes)

Directory construction:

- `src/cli.ts:180-181` — `--source <dir>` → `DirectoryTailer`
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

- `src/cli.ts:198-205` — `tailer.on('event')` → `store.add(event)` +
  `app.addEvent(event)`
- `src/tui/app.ts:2044-2077` — `TuiApp.addEvent`:
  `activityStream.addEvent(event)` (1 incremental append) **then**
  `renderWorkers()` **then** a second `activityStream.setFocusMode(...)` —
  each of the latter two triggering a full re-render — then another
  `screen.render()`
- `src/tui/app.ts:2034-2039` — `renderWorkers()` →
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

- `-f` constructs `LogTailer` with `lines: 50` (`src/cli.ts:182-188`) →
  `readExistingLines()` (`src/tailer.ts:119-135`) reads the file but processes
  **only the last 50 lines**, once (~2–3 s of storm, then done). No
  `startPosition` → no catch-up read (`src/tailer.ts:111-113`).
- `--source <dir>` replays **every line of every recently-modified file**
  (position 0), each line paying the 44–54 ms render storm.

Steady state (after startup) explains the residual CPU numbers: with 3 files
(~101% CPU) and `-f` (48% CPU) the loop still costs ~44 ms per **live** event;
it yields between events, so renders happen — the burn rate tracks the event
rate. The large-directory case never gets that far: startup replay is ordered
**before** the first paint (`src/cli.ts:292-293`), and the TUI has **no
periodic render loop at all** (`options.refreshInterval` at
`src/tui/app.ts:105-106` is dead config — set, never read), so nothing can
paint until an explicit `screen.render()` finally runs.

So the answer to "startup-scan cost or starved render loop": **neither**.
The scan (`readdirSync`/`statSync`, `src/directoryTailer.ts:136-158`) is
seconds, not minutes. There is no background render loop to starve. The first
frame is simply *sequenced after* an unbounded synchronous replay, and each
replayed line costs ~50 ms of blessed re-wrapping. (`fabric digest` is
unaffected for the same reason: it ingests without building the TUI — 40k
events in <60 s.)

## Recommended fix shape (input to the fix child)

**Keep `fs.watch` wake-ups event-driven. Do not replace them with interval
re-scanning** — the watcher itself is correct, and interval-driven rescans
would reintroduce O(directory) cost per tick. Two independent fixes, in this
order:

1. **P1 — coalesce the render work (primary, load-bearing).** One ingested
   line must cost one incremental append, not ~200. In
   `TuiApp.addEvent` (`src/tui/app.ts:2044`) keep
   `activityStream.addEvent` (the single `log.log()`) inline, and debounce the
   expensive part — `renderWorkers()`, both `setFocusMode()` calls,
   `screen.render()` — to at most once per 100–250 ms via a coalescing timer.
   `ActivityStream.setFocusMode` (`ActivityStream.ts:361-366`) should not
   `reRender()` unconditionally; it only needs to when focus state actually
   changed. Repurposing the dead `refreshInterval` option
   (`src/tui/app.ts:105-106`) as this coalescing interval would give the
   option its intended meaning. This alone turns startup replay from
   O(events × 100 log.log) into O(events log.log) — hours → seconds.

2. **P2 — make the startup replay yield (supporting).** Even at O(1) renders
   per line, a 40k-event replay should not hold the thread for its whole
   duration: interleave `DirectoryTailer.start()`'s activation loop
   (`src/directoryTailer.ts:162-164`) with `setImmediate`/`await` between
   files, and/or make `readNewContent` (`src/tailer.ts:158-188`) chunked and
   async (`fs.promises`) with an await per chunk. This keeps timers, signals
   and blessed responsive during catch-up. Note the trap: async reads
   **without** P1 would still burn the core — each async continuation
   immediately re-arms into the next 44–54 ms render storm, which is exactly
   why P1 is primary and P2 is supporting.

3. **Sequencing:** paint before catching up — call `app.start()` before
   `tailer.start()` (`src/cli.ts:292-293`) so the dashboard frame appears
   immediately and fills in as replay progresses.

## Reproducing

```bash
npm run build
REPRO_DIR=$(scripts/gen-synthetic-logs.sh --count 120 --events-per-file 400 | tail -1)
node dist/cli.js tui --source "$REPRO_DIR"   # ~100% CPU, blank for tens of minutes
rm -rf "$REPRO_DIR"
```

Smaller/faster variant: `--events-per-file 5` (600 events) still blocks the
main thread for ~57 s before the first timer tick fires. The script never
writes under `~/.needle/logs`.

Re-verified 2026-09-19 at HEAD `5bdb723` (fabric-ac34599b, dispatch 3): default (120×400 = 48,000 lines) and explicit-flag (101×9 = 909 lines, `--dir` honored) runs exit 0 with the fresh mktemp path on the last stdout line; all 48,909 lines pass JSON + ingest-field checks and `normalizeToLogEvent` (the call at `src/tailer.ts:212`) with 0 invalid; `bash -n`/`--help`/exec bit clean; the `~/.needle/logs` guard refuses direct, subdir, symlink, `..`-escape, trailing-slash and hostile `${TMPDIR}` destinations (exit 1, empty stdout, no writes — the live logs dir's only delta during the window was concurrent fleet-worker logs, zero repro artifacts under it); bad-input battery (missing/non-numeric/zero/negative counts, unknown options) all exit 1 with clear errors; `npx tsc --noEmit` clean, `npm test` 2904 passed / 2 skipped; no script defect found.
