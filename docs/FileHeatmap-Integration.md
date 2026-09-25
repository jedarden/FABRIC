# FileHeatmap Integration Summary

## Overview
The FileHeatmap component is fully integrated into the FABRIC TUI application, providing real-time visualization of file modification patterns and collision detection.

## Integration Points

### 1. Component Instantiation
**Location:** `src/tui/app.ts` (`FabricTuiApp` constructor)
```typescript
this.fileHeatmap = new FileHeatmap({
  parent: this.screen,
  top: 1,
  left: 0,
  width: '100%',
  bottom: 1,
});
this.fileHeatmap.getElement().hide();
```

### 2. Keyboard Shortcut
**Keys:** `H` and `h` (both cases bind the same toggle — see *H versus h* below)
**Location:** `src/tui/app.ts`, `setupKeybindings()`
- Toggles between default view and heatmap view: pressing `H`/`h` opens the heatmap; pressing the same key again closes it
- `Escape` also returns to the default view from any overlay

### H versus h
`H` and `h` are **both bound to the heatmap toggle** everywhere in the TUI —
the binding is registered as `this.screen.key(['H', 'h'], …)`, so the choice
of case is purely cosmetic. `H` is the form used in the footer and help text
because every view also reserves its uppercase key as a global toggle.

One collision remains by design: inside the **worker analytics** view
(`src/tui/components/WorkerAnalyticsPanel.ts`), lowercase `h` is *also* bound
locally to move the comparison selection left. Blessed delivers the key to
both handlers, so pressing `h` there moves the selection **and** switches to
the heatmap — re-enter analytics with `A` if that happens. This mirrors the
per-view collision table in `docs/cli.md`.

### 3. Data Aggregation
**Location:** `src/tui/app.ts` (`setViewMode()`, `handleEvent()`, `render()`)

The heatmap aggregates file access counts from the event store:
```typescript
this.fileHeatmap.updateData(
  (opts) => this.store.getFileHeatmap(opts),
  () => this.store.getFileHeatmapStats(),
  (opts) => this.store.getFileAnomalies(opts)
);
```

**Store Methods:**
- `getFileHeatmap(options)` - Returns sorted file entries (`src/store.ts`)
- `getFileHeatmapStats()` - Returns aggregate statistics (`src/store.ts`)
- `getFileAnomalies(options)` - Returns unexpected-activity anomalies (`src/store.ts`)

### 4. Features
- **Real-time updates:** Heatmap updates automatically when new events are added
- **Multiple sort modes** (`s` cycles):
  - Modifications (default)
  - Recent activity
  - Worker count
  - Collision priority
- **Filtering:**
  - Collisions only mode (`c` key)
  - Anomalies only mode (`a` key; one of `c`/`a` at a time — each resets the other)
  - Directory filtering
- **Navigation:** `j/k` or arrow keys move the selection; `g`/`G` jump to first/last
- **Heat levels:**
  - Cold (1-2 modifications)
  - Warm (3-5 modifications)
  - Hot (6-10 modifications)
  - Critical (11+ modifications)
- **Worker tracking:** Shows which workers are modifying each file
- **Collision detection:** Highlights files with concurrent modifications

### 5. View Management
**Location:** `src/tui/app.ts` (`viewMode` union, `setupKeybindings()`, `setViewMode()`)

The TUI is a single view machine with 13 states: the `default` view plus
**twelve** full-screen overlay views (the same twelve documented in
`docs/cli.md`, § *Views — entry and exit*). Views are mutually exclusive:
pressing another view's key while a view is open switches directly to that
view.

| View mode | Overlay | Enter with | Exit |
|-----------|---------|------------|------|
| `default` | — (worker grid + activity stream) | startup, `Escape`, or toggling a view off | — |
| `heatmap` | File Heatmap | `H` / `h` | same key again or `Escape` |
| `dag` | Task Dependency DAG | `D` / `d` | same key again or `Escape` |
| `replay` | Session Replay | `R` | same key again or `Escape` |
| `errors` | Error Groups | `E` / `e` | same key again or `Escape` |
| `digest` | Session Digest | `G` / `g` | same key again or `Escape` |
| `collisions` | Collision Alerts | `C` / `c` | same key again or `Escape` |
| `git` | Git Integration | `I` | same key again or `Escape` |
| `narrative` | Semantic Narrative | `N` | same key again or `Escape` |
| `analytics` | Worker Analytics | `A` | same key again or `Escape` |
| `transcript` | Conversation Transcript | `T` | same key again or `Escape` |
| `xref` | Cross References | `X` | same key again or `Escape` |
| `budget` | Budget Dashboard | `B` | same key again or `Escape` |

Note the two key shapes among the overlays: `heatmap`, `dag`, `errors`,
`digest`, and `collisions` bind **both cases** of their key (`H`/`h`, `D`/`d`,
`E`/`e`, `G`/`g`, `C`/`c`), while `replay` and the last six (`git`,
`narrative`, `analytics`, `transcript`, `xref`, `budget`) bind **uppercase
only** — `R` is uppercase-only so lowercase `r` stays free for the global
re-render and view-local refresh actions, and the other uppercase-only views'
lowercase letters are used inside views for local actions (`d` diff sub-view
in git integration, `n`/`N` search navigation and `x` export in the
transcript, `a`/`s` aggregation and sort in analytics).

### 6. Help Text
**Location:** `src/tui/app.ts` (help overlay content)
```
Heatmap View:
  j/k     - Navigate files (g/G jump first/last)
  s       - Cycle sort mode
  c       - Toggle collisions only
  a       - Toggle anomalies only
  Esc     - Return to default view
```
The heatmap footer carries the same hints: `[s] Sort  [c] Collisions  [a] Anomalies  [Esc] Back  [?] Help  [q] Quit`.

## Documentation Check

`tests/docs/tui-view-model-doc.test.ts` keeps this document honest. It parses
the `viewMode` union and the `screen.key` view bindings out of
`src/tui/app.ts` and asserts that:

- the view table in § *View Management* above lists **exactly** the same
  modes, in the same order, with the same entry keys;
- every overlay's exit is documented as the same key or `Escape`;
- `docs/cli.md`'s *Views — entry and exit* table covers every overlay and
  every enter key;
- the *H versus h* section exists and explains the worker-analytics
  collision;
- the in-app help overlay's *Heatmap View* block mentions `s`, `c`, `a`, and
  `Esc`.

**When you add, remove, or rebind a TUI view**, update the table above and
`docs/cli.md` in the same commit — otherwise this test fails. Run it with:

```bash
npx vitest run tests/docs/tui-view-model-doc.test.ts
```

## Test Coverage

- **`src/tui/components/FileHeatmap.test.ts`:** 51 tests covering UI component behavior
- **`src/fileHeatmap.test.ts`:** 20 tests covering the store's heatmap aggregation logic
- **`src/web/frontend/test/FileHeatmap.test.tsx`:** 31 tests covering web frontend
- **`src/tui/utils/fileAnomalyDetection.test.ts`:** 16 tests covering anomaly detection
- **`src/tui/app.test.ts`:** heatmap keybinding and view-switch integration cases
- **`src/store.test.ts`:** covers `getFileHeatmap` / `getFileHeatmapStats` store methods
- **`tests/docs/tui-view-model-doc.test.ts`:** documentation check (see above)

Counts move with the code — treat them as a snapshot, and run the files
directly (`npx vitest run src/tui/components/FileHeatmap.test.ts …`) for the
current truth.

## Usage

1. Start FABRIC TUI: `npm start` or `npm run tui`
2. Press `H` (or `h`) to open the file heatmap view
3. Use `s` to cycle through sort modes:
   - Modifications (default)
   - Recent activity
   - Worker count
   - Collision priority
4. Press `c` to filter for files with collisions only
5. Press `a` to show unexpected-activity anomalies only
6. Use `j/k` or arrow keys to navigate files
7. Press `Esc` to return to the default view

## Technical Details

### Data Flow
```
LogEvents → Store.add() → FileModificationTracker
                              ↓
                    Store.getFileHeatmap()
                              ↓
                    FileHeatmap.updateData()
                              ↓
                      FileHeatmap.render()
```

### Performance
- File modifications tracked in-memory with `Map<string, FileModificationTracker>`
- Efficient O(1) lookups for file access patterns
- Configurable max entries limit (default: 50)
- Timestamps stored for interval calculations

### Collision Detection
The heatmap integrates with the collision detection system to highlight:
- **Active collisions** (⚠ red): Multiple workers modifying same file within 5s window
- **Potential collisions** (⚡ yellow): Multiple workers actively working on same file
- **Safe files** (no indicator): Single worker or no recent conflicts

## Related Files
- Component: `src/tui/components/FileHeatmap.ts`
- Integration: `src/tui/app.ts`
- Store logic: `src/store.ts`
- Anomaly detection: `src/tui/utils/fileAnomalyDetection.ts`
- Tests: `src/tui/components/FileHeatmap.test.ts`, `src/fileHeatmap.test.ts`, `src/tui/app.test.ts`
- Docs check: `tests/docs/tui-view-model-doc.test.ts`
- Types: `src/types.ts` (FileHeatmapEntry, FileHeatmapStats, HeatmapOptions)

## Completion Status
✅ **COMPLETE** - FileHeatmap is fully integrated and functional
- Keyboard shortcut `H`/`h` working
- Data aggregation from store working
- Real-time updates working
- View list synchronized with `docs/cli.md` and the `viewMode` union
- Documentation check guarding future view additions
