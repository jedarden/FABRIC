/**
 * FileHeatmap × FabricTuiApp integration tests (fabric-75b5f60d)
 *
 * Boundary under test: real InMemoryEventStore → real FabricTuiApp
 * (screen-level key bindings and view machine) → real FileHeatmap component
 * (its own blessed box, key bindings, and rendered content).
 *
 * Only `blessed` is mocked — with a fresh, inspectable element instance per
 * construction call, so the heatmap's box is identified by its constructor
 * label and every assertion reads the component's actual rendered content —
 * plus the same five sibling components app.test.ts already stubs (WorkerGrid,
 * ActivityStream, WorkerDetail, CommandPalette, DependencyDag). Every
 * behavior below is therefore pinned across the whole wiring rather than at
 * either seam: store getters are the store's own, and sort/filter state
 * reaches the DOM only through a real updateData pull.
 *
 * Covers the behaviors docs/FileHeatmap-Integration.md §4 documents:
 * view show/hide, data refresh, the four sort modes, mutually exclusive
 * collision/anomaly filters, anomaly/collision rendering, heat levels,
 * selection movement, and worker tracking.
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';

// process.exit fires from app.stop() (the q binding); keep it inert so an
// accidental press can never kill the vitest worker.
vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

// Mock blessed with a fresh element per construction call. The registry lets
// tests recover the screen, the heatmap's own box (by its constructor label),
// and every other element the real app created.
vi.mock('blessed', () => {
  const registry: {
    screens: Record<string, unknown>[];
    boxes: Record<string, unknown>[];
    logs: Record<string, unknown>[];
    textboxes: Record<string, unknown>[];
    lists: Record<string, unknown>[];
  } = { screens: [], boxes: [], logs: [], textboxes: [], lists: [] };

  const makeElement = (kind: string, options: Record<string, unknown> | undefined) => ({
    __kind: kind,
    __options: options,
    setContent: vi.fn(),
    getContent: vi.fn(() => ''),
    setLabel: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    focus: vi.fn(),
    key: vi.fn(),
    on: vi.fn(),
    append: vi.fn(),
    render: vi.fn(),
    destroy: vi.fn(),
    hidden: true,
    width: 100,
    height: 40,
    log: vi.fn(),
    setItems: vi.fn(),
    select: vi.fn(),
    getValue: vi.fn(() => ''),
    setValue: vi.fn(),
    screen: {
      render: vi.fn(),
      destroy: vi.fn(),
      append: vi.fn(),
      key: vi.fn(),
      on: vi.fn(),
      focusNext: vi.fn(),
      focusPrevious: vi.fn(),
    },
  });

  const makeFactory = (kind: string, sink: Record<string, unknown>[]) =>
    vi.fn((options?: Record<string, unknown>) => {
      const el = makeElement(kind, options);
      sink.push(el);
      return el;
    });

  const screen = vi.fn((options?: Record<string, unknown>) => {
    const el = makeElement('screen', options);
    registry.screens.push(el);
    return el;
  });

  const module = {
    __registry: registry,
    screen,
    box: makeFactory('box', registry.boxes),
    log: makeFactory('log', registry.logs),
    textbox: makeFactory('textbox', registry.textboxes),
    list: makeFactory('list', registry.lists),
  };

  return { __esModule: true, default: module, ...module };
});

// Sibling components stubbed exactly as in app.test.ts — FileHeatmap
// deliberately NOT among them.
vi.mock('./components/WorkerGrid.js', () => ({
  WorkerGrid: class {
    updateWorkers = vi.fn();
    getSelected = vi.fn(() => null);
    focus = vi.fn();
    getElement = vi.fn(() => ({ hide: vi.fn(), show: vi.fn(), screen: { render: vi.fn() } }));
    setFocusMode = vi.fn();
    selectNext = vi.fn();
    selectPrevious = vi.fn();
  },
}));

vi.mock('./components/ActivityStream.js', () => ({
  ActivityStream: class {
    addEvent = vi.fn();
    clearFilter = vi.fn();
    setFilter = vi.fn();
    togglePause = vi.fn();
    focus = vi.fn();
    getElement = vi.fn(() => ({ hide: vi.fn(), show: vi.fn(), screen: { render: vi.fn() }, key: vi.fn() }));
    getIsPaused = vi.fn(() => false);
    setFocusMode = vi.fn();
    getFilter = vi.fn(() => ({}));
    getEventsCount = vi.fn(() => 0);
    getFilteredEventsCount = vi.fn(() => 0);
  },
}));

vi.mock('./components/WorkerDetail.js', () => ({
  WorkerDetail: class {
    setWorker = vi.fn();
    setRecentEvents = vi.fn();
    show = vi.fn();
    hide = vi.fn();
    focus = vi.fn();
    isVisible = vi.fn(() => false);
    getElement = vi.fn(() => ({ hide: vi.fn(), show: vi.fn(), screen: { render: vi.fn() } }));
  },
}));

vi.mock('./components/CommandPalette.js', () => ({
  CommandPalette: class {
    toggle = vi.fn();
    show = vi.fn();
    hide = vi.fn();
    isVisible = vi.fn(() => false);
    addSuggestion = vi.fn();
    addSuggestions = vi.fn();
    clearSuggestions = vi.fn();
  },
}));

vi.mock('./components/DependencyDag.js', () => ({
  DependencyDag: class {
    refresh = vi.fn();
    focus = vi.fn();
    // One stable element per instance so assertions on getElement().show/hide
    // observe the calls the app made.
    element = { hide: vi.fn(), show: vi.fn(), hidden: true, screen: { render: vi.fn() } };
    getElement = vi.fn(() => this.element);
    getGraph = vi.fn(() => null);
    getStats = vi.fn(() => null);
  },
}));

// Import after mocking
import blessed from 'blessed';
import { FabricTuiApp } from './app.js';
import { InMemoryEventStore } from '../store.js';
import { LogEvent } from '../types.js';
import { getHeatColor, getHeatIcon } from './utils/colors.js';

interface MockElement {
  __kind: string;
  __options?: Record<string, unknown>;
  setContent: Mock;
  getContent: Mock;
  setLabel: Mock;
  show: Mock;
  hide: Mock;
  focus: Mock;
  key: Mock;
  [key: string]: unknown;
}

interface ElementRegistry {
  screens: MockElement[];
  boxes: MockElement[];
  logs: MockElement[];
  textboxes: MockElement[];
  lists: MockElement[];
}

const registry = (): ElementRegistry =>
  (blessed as unknown as { __registry: ElementRegistry }).__registry;

/** A file-modification event as NEEDLE would emit it. */
function edit(worker: string, path: string, ts: number): LogEvent {
  return { ts, worker, level: 'info', msg: `Edit ${path}`, tool: 'Edit', path };
}

/** Monotonically spaced timestamps for one file's modification series. */
function series(worker: string, path: string, startTs: number, count: number, stepMs = 1500): LogEvent[] {
  return Array.from({ length: count }, (_, i) => edit(worker, path, startTs + i * stepMs));
}

interface World {
  store: InMemoryEventStore;
  app: FabricTuiApp;
  screen: MockElement;
  heatBox: MockElement;
  heatmap: FileHeatmapAccessor;
}

/** The component as reachable through the mounted app (same seam app.test.ts uses). */
interface FileHeatmapAccessor {
  getSortMode(): string;
  getCollisionFilter(): boolean;
  getAnomalyFilter(): boolean;
  setFilter(filter: string): void;
}

/**
 * Build one app world. Timestamps in tests are offsets from `t0` so every
 * collision stays freshly detected (detectedAt is compared against
 * Date.now() by the store's stale sweep) while ordering stays deterministic.
 */
function buildWorld(): World & { t0: number } {
  const t0 = Date.now();
  const store = new InMemoryEventStore();
  const app = new FabricTuiApp(store);
  app.start();

  const r = registry();
  const screen = r.screens[r.screens.length - 1];
  const heatBox = r.boxes
    .filter((b) => b.__options?.label === ' File Heatmap ')
    .at(-1);
  if (!heatBox) throw new Error('FileHeatmap box was never constructed');

  const heatmap = (app as unknown as { fileHeatmap: FileHeatmapAccessor }).fileHeatmap;
  return { store, app, screen, heatBox, heatmap, t0 };
}

/** Screen-level key handler by exact binding array (order-sensitive). */
function screenKey(world: World, keys: string[]): () => void {
  const call = world.screen.key.mock.calls
    .filter(
      (c: unknown[]) =>
        Array.isArray(c?.[0]) &&
        (c[0] as string[]).length === keys.length &&
        keys.every((k, i) => (c[0] as string[])[i] === k)
    )
    .at(-1);
  if (!call) throw new Error(`screen never bound [${keys.join(', ')}]`);
  return call[1] as () => void;
}

/** The heatmap box's own key handler by exact binding array. */
function heatKey(world: World, keys: string[]): () => void {
  const call = world.heatBox.key.mock.calls
    .filter(
      (c: unknown[]) =>
        Array.isArray(c?.[0]) &&
        (c[0] as string[]).length === keys.length &&
        keys.every((k, i) => (c[0] as string[])[i] === k)
    )
    .at(-1);
  if (!call) throw new Error(`FileHeatmap never bound [${keys.join(', ')}]`);
  return call[1] as () => void;
}

/** Open the heatmap view the way a user does. */
function openHeatmap(world: World): void {
  screenKey(world, ['H', 'h'])();
}

/** Latest content the component handed to its box. */
function rendered(world: World): string {
  const calls = world.heatBox.setContent.mock.calls;
  return (calls[calls.length - 1]?.[0] as string) ?? '';
}

/** First rendered line mentioning a path (paths never appear in header/footer). */
function rowFor(content: string, path: string): string | undefined {
  return content.split('\n').find((line) => line.includes(path));
}

/** Assert the given paths appear in content in exactly this relative order. */
function expectRowOrder(content: string, paths: string[]): void {
  const positions = paths.map((p) => {
    const row = rowFor(content, p);
    if (row === undefined) throw new Error(`no rendered row for ${p}`);
    return content.indexOf(row);
  });
  for (let i = 1; i < positions.length; i++) {
    expect(positions[i]).toBeGreaterThan(positions[i - 1]);
  }
}

/** Filled/empty cells of the heat bar on the row for a path. */
function heatBarCells(content: string, path: string, level: string): { filled: number; empty: number } {
  const row = rowFor(content, path);
  expect(row).toBeDefined();
  const match = row!.match(new RegExp(`\\{${getHeatColor(level as 'cold')}-fg\\}(█+)\\{/\\}(░*)`));
  return { filled: match ? match[1].length : 0, empty: match ? match[2].length : 0 };
}

describe('FileHeatmap TUI integration (real store → real app → real component)', () => {
  beforeEach(() => {
    const r = registry();
    r.screens.length = 0;
    r.boxes.length = 0;
    r.logs.length = 0;
    r.textboxes.length = 0;
    r.lists.length = 0;
  });

  describe('view show/hide lifecycle', () => {
    it('starts hidden, enters on H with real store data rendered, and takes the header', () => {
      const world = buildWorld();
      seedViaApp(world.store, world.app, series('w-alpha', 'work/live.ts', world.t0 + 1000, 2));

      // Construction hides the panel ('H' key note in app.ts).
      expect(world.heatBox.hide).toHaveBeenCalled();

      world.heatBox.show.mockClear();
      world.heatBox.hide.mockClear();
      openHeatmap(world);

      expect(world.heatBox.show).toHaveBeenCalled();
      expect(world.heatBox.focus).toHaveBeenCalled();

      const content = rendered(world);
      expect(content).toContain('Files: 1');
      expect(rowFor(content, 'work/live.ts')).toBeDefined();

      // The app header reflects the view switch.
      const headerSwitched = registry().boxes.some((b) =>
        b.setContent.mock.calls.some((c: unknown[]) => String(c?.[0]).includes('FABRIC - File Heatmap'))
      );
      expect(headerSwitched).toBe(true);
    });

    it('toggles back to default on a second H and hides the panel', () => {
      const world = buildWorld();
      const toggle = screenKey(world, ['H', 'h']);

      toggle(); // open
      world.heatBox.hide.mockClear();
      toggle(); // close

      expect(world.heatBox.hide).toHaveBeenCalled();
      expect(world.heatmap.getAnomalyFilter()).toBe(false);
    });

    it('Escape from the heatmap view hides the panel', () => {
      const world = buildWorld();
      openHeatmap(world);
      expect(world.heatBox.show).toHaveBeenCalled();

      world.heatBox.hide.mockClear();
      screenKey(world, ['escape'])();
      expect(world.heatBox.hide).toHaveBeenCalled();
    });

    it('switching directly to another view (D) hides the heatmap', () => {
      const world = buildWorld();
      openHeatmap(world);
      world.heatBox.hide.mockClear();

      screenKey(world, ['D', 'd'])();

      expect(world.heatBox.hide).toHaveBeenCalled();
      // The dag branch of setViewMode shows + focuses the dag panel and swaps the header.
      const dag = world.app as unknown as {
        dependencyDag: { getElement: Mock; focus: Mock };
        headerBox: { setContent: Mock };
      };
      expect(dag.dependencyDag.getElement().show).toHaveBeenCalled();
      expect(dag.dependencyDag.focus).toHaveBeenCalled();
      expect(dag.headerBox.setContent).toHaveBeenCalledWith(' FABRIC - Task Dependency DAG');
    });
  });

  describe('data refresh', () => {
    it('passes live sort and filter state through the app-to-store callbacks', () => {
      const world = buildWorld();
      const getHeatmap = vi.spyOn(world.store, 'getFileHeatmap');
      const getStats = vi.spyOn(world.store, 'getFileHeatmapStats');
      const getAnomalies = vi.spyOn(world.store, 'getFileAnomalies');

      openHeatmap(world);
      heatKey(world, ['s'])();
      world.heatmap.setFilter('src/');
      world.app.render();

      const expectedOptions = {
        sortBy: 'recent',
        maxEntries: 100,
        collisionsOnly: false,
        directoryFilter: 'src/',
      };
      expect(getHeatmap).toHaveBeenCalledWith(expectedOptions);
      expect(getStats).toHaveBeenCalled();
      expect(getAnomalies).toHaveBeenCalledWith({});

      getHeatmap.mockClear();
      getStats.mockClear();
      getAnomalies.mockClear();

      const next = edit('w-alpha', 'src/new.ts', Date.now());
      world.store.add(next);
      world.app.addEvent(next);

      expect(getHeatmap).toHaveBeenCalledWith(expectedOptions);
      expect(getStats).toHaveBeenCalledTimes(1);
      expect(getAnomalies).toHaveBeenCalledTimes(1);

      screenKey(world, ['escape'])();
      getHeatmap.mockClear();
      getStats.mockClear();
      getAnomalies.mockClear();

      const hiddenEvent = edit('w-bravo', 'src/hidden.ts', Date.now() + 1);
      world.store.add(hiddenEvent);
      world.app.addEvent(hiddenEvent);

      expect(getHeatmap).not.toHaveBeenCalled();
      expect(getStats).not.toHaveBeenCalled();
      expect(getAnomalies).not.toHaveBeenCalled();
    });

    it('pulls newly arrived files into the rendered rows while the view is open', () => {
      const world = buildWorld();
      seedViaApp(world.store, world.app, series('w-alpha', 'work/first.ts', world.t0 + 1000, 1));
      openHeatmap(world);

      expect(rowFor(rendered(world), 'work/first.ts')).toBeDefined();
      expect(rowFor(rendered(world), 'work/second.ts')).toBeUndefined();

      // Live event while the view is open: app.addEvent re-issues updateData.
      const [second] = series('w-bravo', 'work/second.ts', world.t0 + 60000, 1);
      world.store.add(second);
      world.app.addEvent(second);

      const content = rendered(world);
      expect(rowFor(content, 'work/second.ts')).toBeDefined();
      expect(content).toContain('Files: 2');
    });

    it('does not refresh while closed and re-pulls the store on reopen', () => {
      const world = buildWorld();
      seedViaApp(world.store, world.app, series('w-alpha', 'work/first.ts', world.t0 + 1000, 1));
      openHeatmap(world);
      expect(rowFor(rendered(world), 'work/first.ts')).toBeDefined();

      // Close, then land new events while nothing is watching.
      screenKey(world, ['H', 'h'])();
      const [later] = series('w-bravo', 'work/second.ts', world.t0 + 60000, 1);
      world.store.add(later);
      world.app.addEvent(later);
      expect(rowFor(rendered(world), 'work/second.ts')).toBeUndefined();

      // Reopening re-pulls: the hidden panel must not have stale content.
      openHeatmap(world);
      expect(rowFor(rendered(world), 'work/second.ts')).toBeDefined();
    });

    it('render() re-pulls grown modification counts from the store', () => {
      const world = buildWorld();
      seedViaApp(world.store, world.app, series('w-alpha', 'work/growing.ts', world.t0 + 1000, 1));
      openHeatmap(world);
      expect(rendered(world)).toContain('Mods: 1');

      // Store-only change (no app.addEvent): a render pass is the pull.
      for (const e of series('w-alpha', 'work/growing.ts', world.t0 + 50000, 2)) {
        world.store.add(e);
      }
      world.app.render();

      const content = rendered(world);
      expect(content).toContain('Mods: 3');
      expect(rowFor(content, 'work/growing.ts')).toContain('{bold}  3{/}');
    });

    it('applies the directory filter to the real store on the next refresh', () => {
      const world = buildWorld();
      seedViaApp(world.store, world.app, [
        ...series('w-alpha', 'src/live.ts', world.t0 + 1000, 2),
        ...series('w-bravo', 'docs/notes.md', world.t0 + 3000, 2),
      ]);
      openHeatmap(world);

      expect(rowFor(rendered(world), 'src/live.ts')).toBeDefined();
      expect(rowFor(rendered(world), 'docs/notes.md')).toBeDefined();

      world.heatmap.setFilter('src/');
      world.app.render();

      const filtered = rendered(world);
      expect(rowFor(filtered, 'src/live.ts')).toBeDefined();
      expect(rowFor(filtered, 'docs/notes.md')).toBeUndefined();
    });
  });

  describe('sorting through the real store', () => {
    /** A,B,C,D seeded in that order; D carries a real two-worker collision. */
    function seededWorld() {
      const world = buildWorld();
      const { t0 } = world;
      const events = [
        ...series('w-alpha', 'mods/alpha.ts', t0 + 1000, 12), // 12 mods, last +17500
        ...series('w-alpha', 'mods/bravo.ts', t0 + 20000, 3, 1200), // w-alpha half, last at +22400
        ...series('w-bravo', 'mods/bravo.ts', t0 + 28000, 3, 1200), // w-bravo half → 2 workers; the
        // 5600ms gap to the w-alpha half exceeds COLLISION_WINDOW_MS (5000), so the
        // recent-mods index trims w-alpha's edits and bravo stays collision-free.
        ...series('w-alpha', 'mods/charlie.ts', t0 + 30000, 3),
        edit('w-bravo', 'mods/delta.ts', t0 + 500000),
        edit('w-charlie', 'mods/delta.ts', t0 + 501000), // <5s apart → active collision
      ];
      seedViaApp(world.store, world.app, events);
      return world;
    }

    it('cycles all four sort modes and reorders real rows on each refresh', () => {
      const world = seededWorld();
      openHeatmap(world);
      const s = heatKey(world, ['s']);

      // Default: modifications, most-modified first (stable tie: charlie 3, delta 3).
      expect(rendered(world)).toContain('Sort: modifications');
      expectRowOrder(rendered(world), ['mods/alpha.ts', 'mods/bravo.ts', 'mods/charlie.ts', 'mods/delta.ts']);

      s();
      world.app.render();
      expect(world.heatmap.getSortMode()).toBe('recent');
      expect(rendered(world)).toContain('Sort: recent');
      expectRowOrder(rendered(world), ['mods/delta.ts', 'mods/charlie.ts', 'mods/bravo.ts', 'mods/alpha.ts']);

      s();
      world.app.render();
      expect(world.heatmap.getSortMode()).toBe('workers');
      expect(rendered(world)).toContain('Sort: workers');
      // bravo and delta have two workers each (bravo inserted first); alpha, charlie one.
      expectRowOrder(rendered(world), ['mods/bravo.ts', 'mods/delta.ts', 'mods/alpha.ts', 'mods/charlie.ts']);

      s();
      world.app.render();
      expect(world.heatmap.getSortMode()).toBe('collisions');
      expect(rendered(world)).toContain('Sort: collisions');
      // The collided file leads; the rest follow by modification count.
      expectRowOrder(rendered(world), ['mods/delta.ts', 'mods/alpha.ts', 'mods/bravo.ts', 'mods/charlie.ts']);

      // …and the cycle wraps.
      s();
      world.app.render();
      expect(world.heatmap.getSortMode()).toBe('modifications');
      expectRowOrder(rendered(world), ['mods/alpha.ts', 'mods/bravo.ts', 'mods/charlie.ts', 'mods/delta.ts']);
    });

    it('keeps the cycled sort mode when live events refresh the view', () => {
      const world = seededWorld();
      openHeatmap(world);
      const s = heatKey(world, ['s']);
      s(); // recent
      s(); // workers
      world.app.render();
      expect(rendered(world)).toContain('Sort: workers');

      const [extra] = series('w-delta', 'mods/echo.ts', world.t0 + 600000, 1);
      world.store.add(extra);
      world.app.addEvent(extra);

      const content = rendered(world);
      expect(content).toContain('Sort: workers');
      expectRowOrder(content, ['mods/bravo.ts', 'mods/delta.ts', 'mods/alpha.ts', 'mods/charlie.ts', 'mods/echo.ts']);
    });
  });

  describe('mutually exclusive collision/anomaly filters', () => {
    function collidedWorld() {
      const world = buildWorld();
      const { t0 } = world;
      const events = [
        edit('w-alpha', 'work/shared.ts', t0 + 10000),
        edit('w-bravo', 'work/shared.ts', t0 + 11000), // active collision
        edit('w-alpha', 'work/clean-one.ts', t0 + 20000),
        edit('w-alpha', 'work/clean-two.ts', t0 + 30000),
      ];
      seedViaApp(world.store, world.app, events);
      return world;
    }

    it('narrows to collided files at the next refresh, and a resets c (and vice versa)', () => {
      const world = collidedWorld();
      openHeatmap(world);
      const c = heatKey(world, ['c']);
      const a = heatKey(world, ['a']);

      expectRowOrder(rendered(world), ['work/shared.ts', 'work/clean-one.ts', 'work/clean-two.ts']);

      // Toggling c flips the mode label immediately; the row set only narrows
      // once the next updateData pull carries collisionsOnly to the store.
      c();
      expect(world.heatmap.getCollisionFilter()).toBe(true);
      expect(world.heatBox.setLabel).toHaveBeenCalledWith(' File Heatmap [COLLISIONS] ');
      expectRowOrder(rendered(world), ['work/shared.ts', 'work/clean-one.ts', 'work/clean-two.ts']);

      world.app.render();
      const collisionsOnly = rendered(world);
      expect(collisionsOnly).toContain('| Collisions Only');
      expect(rowFor(collisionsOnly, 'work/shared.ts')).toBeDefined();
      expect(rowFor(collisionsOnly, 'work/clean-one.ts')).toBeUndefined();
      expect(rowFor(collisionsOnly, 'work/clean-two.ts')).toBeUndefined();

      // a replaces the collision mode — they are mutually exclusive.
      a();
      expect(world.heatmap.getAnomalyFilter()).toBe(true);
      expect(world.heatmap.getCollisionFilter()).toBe(false);
      expect(world.heatBox.setLabel).toHaveBeenCalledWith(' File Heatmap [ANOMALIES] ');
      const anomalyView = rendered(world);
      expect(anomalyView).toContain('| Anomalies Only');
      expect(anomalyView).not.toContain('Collisions Only');
      // This store has no anomalies, so the dedicated empty state shows.
      expect(anomalyView).toContain('No anomalies detected');

      // …and c replaces a.
      c();
      expect(world.heatmap.getCollisionFilter()).toBe(true);
      expect(world.heatmap.getAnomalyFilter()).toBe(false);
      world.app.render();
      expect(rowFor(rendered(world), 'work/shared.ts')).toBeDefined();
      expect(rowFor(rendered(world), 'work/clean-one.ts')).toBeUndefined();
    });

    it('shows the release hint when collisions-only matches no files', () => {
      const world = buildWorld();
      seedViaApp(world.store, world.app, series('w-alpha', 'work/plain.ts', world.t0 + 1000, 1));

      openHeatmap(world);
      heatKey(world, ['c'])();
      world.app.render();

      const content = rendered(world);
      expect(content).toContain('No file modifications detected');
      expect(content).toContain('Press [c] to show all files');
    });

    it('returns to the normal file view when either filter is toggled off', () => {
      const world = buildWorld();
      const { t0 } = world;
      seedViaApp(world.store, world.app, [
        edit('w-alpha', 'work/shared.ts', t0 + 10000),
        edit('w-bravo', 'work/shared.ts', t0 + 11000),
        ...series('w-alpha', 'proj/config/settings.json', t0 + 20000, 2),
        ...series('w-bravo', 'deploy/token.env', t0 + 30000, 2),
      ]);

      openHeatmap(world);
      const c = heatKey(world, ['c']);
      const a = heatKey(world, ['a']);

      c();
      world.app.render();
      expect(world.heatmap.getCollisionFilter()).toBe(true);
      expect(world.heatmap.getAnomalyFilter()).toBe(false);
      expectRowOrder(rendered(world), ['work/shared.ts']);

      // The second c press leaves collision-only mode, and the next app
      // refresh must restore every file rather than the filtered row set.
      c();
      world.app.render();
      expect(world.heatmap.getCollisionFilter()).toBe(false);
      expectRowOrder(rendered(world), [
        'work/shared.ts',
        'proj/config/settings.json',
        'deploy/token.env',
      ]);
      expect(rendered(world)).not.toContain('Collisions Only');

      a();
      expect(world.heatmap.getAnomalyFilter()).toBe(true);
      expect(world.heatmap.getCollisionFilter()).toBe(false);
      expect(rendered(world)).toContain('Anomalies Only');
      expect(rendered(world)).not.toContain('work/shared.ts');

      // The second a press returns to the restored file set without needing
      // another event to arrive.
      a();
      expect(world.heatmap.getAnomalyFilter()).toBe(false);
      expectRowOrder(rendered(world), [
        'work/shared.ts',
        'proj/config/settings.json',
        'deploy/token.env',
      ]);
      expect(rendered(world)).not.toContain('Anomalies Only');
    });
  });

  describe('anomaly and collision rendering', () => {
    it('surfaces the live anomaly summary above the file list', () => {
      const world = buildWorld();
      const { t0 } = world;
      seedViaApp(world.store, world.app, [
        ...series('w-alpha', 'proj/config/settings.json', t0 + 1000, 2),
        ...series('w-bravo', 'deploy/token.env', t0 + 2000, 2),
        ...series('w-alpha', 'work/plain.ts', t0 + 3000, 2),
      ]);

      openHeatmap(world);
      const content = rendered(world);
      expect(content).toContain('⚠ 2 anomalies');
      expect(content).toContain('Unexpected Activity');
      expect(rowFor(content, 'deploy/token.env')).toBeDefined();
      expect(rowFor(content, 'proj/config/settings.json')).toBeDefined();
    });

    it('renders typed, severity-tagged anomaly rows in the anomalies-only view', () => {
      const world = buildWorld();
      const { t0 } = world;
      seedViaApp(world.store, world.app, [
        ...series('w-alpha', 'proj/config/settings.json', t0 + 1000, 2),
        ...series('w-bravo', 'deploy/token.env', t0 + 2000, 2),
      ]);

      openHeatmap(world);
      heatKey(world, ['a'])();

      const content = rendered(world);
      // Critical (sensitive) sorts ahead of warning (config).
      expectRowOrder(content, ['deploy/token.env', 'proj/config/settings.json']);
      expect(rowFor(content, 'deploy/token.env')).toContain('[SENSITIVE]');
      expect(rowFor(content, 'deploy/token.env')).toContain('[CRITICAL]');
      expect(rowFor(content, 'proj/config/settings.json')).toContain('[CONFIG]');
      expect(rowFor(content, 'proj/config/settings.json')).toContain('[WARNING]');
      // Populated anomaly view swaps the footer hints to the file-view return path.
      expect(content).toContain('[a] Back to files');
    });

    it('marks the active anomaly row and moves it with j', () => {
      const world = buildWorld();
      const { t0 } = world;
      seedViaApp(world.store, world.app, [
        ...series('w-alpha', 'proj/config/settings.json', t0 + 1000, 2),
        ...series('w-bravo', 'deploy/token.env', t0 + 2000, 2),
      ]);

      openHeatmap(world);
      heatKey(world, ['a'])();

      expect(rowFor(rendered(world), 'deploy/token.env')).toMatch(/^>/);
      expect(rowFor(rendered(world), 'proj/config/settings.json')).toMatch(/^ /);

      heatKey(world, ['down', 'j'])();
      expect(rowFor(rendered(world), 'proj/config/settings.json')).toMatch(/^>/);
      expect(rowFor(rendered(world), 'deploy/token.env')).toMatch(/^ /);
    });

    it('renders the collision warning over the potential-collision bolt from real events', () => {
      const world = buildWorld();
      const { t0 } = world;
      seedViaApp(world.store, world.app, [
        edit('w-alpha', 'work/shared.ts', t0 + 10000),
        edit('w-bravo', 'work/shared.ts', t0 + 11000), // <5s → active collision (⚠)
        edit('w-alpha', 'work/multi.ts', t0 + 20000),
        edit('w-bravo', 'work/multi.ts', t0 + 90000), // >5s → potential only (⚡)
        edit('w-alpha', 'work/solo.ts', t0 + 30000), // single worker → neither
      ]);

      openHeatmap(world);
      const content = rendered(world);

      const shared = rowFor(content, 'work/shared.ts');
      expect(shared).toContain('{red-fg}⚠{/}');
      expect(shared).not.toContain('⚡');
      expect(rowFor(content, 'work/multi.ts')).toContain('{yellow-fg}⚡{/}');
      expect(rowFor(content, 'work/multi.ts')).not.toContain('⚠');
      const solo = rowFor(content, 'work/solo.ts');
      expect(solo).not.toContain('⚠');
      expect(solo).not.toContain('⚡');
      // The stats header counts the collided file.
      expect(content).toContain('⚠ 1');
    });
  });

  describe('heat levels from live store data', () => {
    function heatWorld() {
      const world = buildWorld();
      const { t0 } = world;
      seedViaApp(world.store, world.app, [
        ...series('w-alpha', 'work/cold.ts', t0 + 1000, 1),
        ...series('w-alpha', 'work/warm.ts', t0 + 5000, 3),
        ...series('w-alpha', 'work/hot.ts', t0 + 10000, 6),
        ...series('w-alpha', 'work/critical.ts', t0 + 20000, 12),
      ]);
      return world;
    }

    it('renders the documented icon, color, and bar width for each level', () => {
      const world = heatWorld();
      openHeatmap(world);
      const content = rendered(world);

      expect(heatBarCells(content, 'work/cold.ts', 'cold')).toEqual({ filled: 1, empty: 9 });
      expect(heatBarCells(content, 'work/warm.ts', 'warm')).toEqual({ filled: 3, empty: 7 });
      expect(heatBarCells(content, 'work/hot.ts', 'hot')).toEqual({ filled: 7, empty: 3 });
      expect(heatBarCells(content, 'work/critical.ts', 'critical')).toEqual({ filled: 10, empty: 0 });

      for (const [path, level] of [
        ['work/cold.ts', 'cold'],
        ['work/warm.ts', 'warm'],
        ['work/hot.ts', 'hot'],
        ['work/critical.ts', 'critical'],
      ] as const) {
        expect(rowFor(content, path)).toContain(getHeatIcon(level));
        expect(rowFor(content, path)).toContain(`{${getHeatColor(level)}-fg}`);
      }
    });

    it('reports the level distribution and totals in the stats header', () => {
      const world = heatWorld();
      openHeatmap(world);
      const content = rendered(world);
      expect(content).toContain('Files: 4');
      expect(content).toContain('Mods: 22');
      expect(content).toContain('○1'); // cold
      expect(content).toContain('◐1'); // warm
      expect(content).toContain('●1'); // hot
      expect(content).toContain('🔥1'); // critical
    });

    it('upgrades a file through the levels as live events land', () => {
      const world = heatWorld();
      openHeatmap(world);
      expect(rowFor(rendered(world), 'work/cold.ts')).toContain(getHeatIcon('cold'));

      // 1 → 3 modifications: cold becomes warm.
      for (const e of series('w-alpha', 'work/cold.ts', world.t0 + 40000, 2)) {
        world.store.add(e);
        world.app.addEvent(e);
      }
      let content = rendered(world);
      expect(heatBarCells(content, 'work/cold.ts', 'warm')).toEqual({ filled: 3, empty: 7 });
      expect(rowFor(content, 'work/cold.ts')).toContain(getHeatIcon('warm'));

      // 3 → 12 modifications: warm becomes critical, distribution follows.
      for (const e of series('w-alpha', 'work/cold.ts', world.t0 + 80000, 9, 2000)) {
        world.store.add(e);
        world.app.addEvent(e);
      }
      content = rendered(world);
      expect(heatBarCells(content, 'work/cold.ts', 'critical')).toEqual({ filled: 10, empty: 0 });
      expect(rowFor(content, 'work/cold.ts')).toContain(getHeatIcon('critical'));
      expect(content).toContain('○0');
      expect(content).toContain('🔥2');
    });
  });

  describe('selection movement', () => {
    function threeFileWorld() {
      const world = buildWorld();
      const { t0 } = world;
      seedViaApp(world.store, world.app, [
        ...series('w-alpha', 'work/alpha.ts', t0 + 1000, 3),
        ...series('w-alpha', 'work/middle.ts', t0 + 5000, 2),
        ...series('w-alpha', 'work/omega.ts', t0 + 9000, 1),
      ]);
      return world;
    }

    it('moves the rendered marker with j/k and wraps at both edges', () => {
      const world = threeFileWorld();
      openHeatmap(world);
      const j = heatKey(world, ['down', 'j']);
      const k = heatKey(world, ['up', 'k']);

      expect(rowFor(rendered(world), 'work/alpha.ts')).toMatch(/^>/);

      j();
      expect(rowFor(rendered(world), 'work/middle.ts')).toMatch(/^>/);
      expect(rowFor(rendered(world), 'work/alpha.ts')).toMatch(/^ /);

      j();
      expect(rowFor(rendered(world), 'work/omega.ts')).toMatch(/^>/);

      j(); // wraps to first
      expect(rowFor(rendered(world), 'work/alpha.ts')).toMatch(/^>/);

      k(); // wraps back to last
      expect(rowFor(rendered(world), 'work/omega.ts')).toMatch(/^>/);
    });

    it('jumps to first and last with g/G inside the mounted view', () => {
      const world = threeFileWorld();
      openHeatmap(world);

      heatKey(world, ['G'])();
      expect(rowFor(rendered(world), 'work/omega.ts')).toMatch(/^>/);
      expect(rowFor(rendered(world), 'work/alpha.ts')).toMatch(/^ /);

      heatKey(world, ['g'])();
      expect(rowFor(rendered(world), 'work/alpha.ts')).toMatch(/^>/);
    });
  });

  describe('worker tracking', () => {
    it('renders per-file worker attribution from real events', () => {
      const world = buildWorld();
      const { t0 } = world;
      seedViaApp(world.store, world.app, [
        ...series('alphawork-one', 'work/attributed.ts', t0 + 1000, 4),
        ...series('bravowork-two', 'work/attributed.ts', t0 + 20000, 2, 1200),
      ]);

      openHeatmap(world);
      const row = rowFor(rendered(world), 'work/attributed.ts');
      expect(row).toBeDefined();
      // Two workers → both 6-char prefixes, no overflow count.
      expect(row).toContain('alphaw');
      expect(row).toContain('bravow');
      expect(row).not.toMatch(/\+\d/);

      // A third worker on the same file adds the +N overflow marker.
      const [third] = series('charlie-three', 'work/attributed.ts', world.t0 + 40000, 1);
      world.store.add(third);
      world.app.addEvent(third);
      expect(rowFor(rendered(world), 'work/attributed.ts')).toContain('+1');
    });
  });
});

/**
 * Seed through the store exactly as the live tailer would: events land in the
 * store first; the app learns of them via addEvent (the tailer's callback).
 * While the heatmap view is closed this must not touch the panel.
 */
function seedViaApp(store: InMemoryEventStore, app: FabricTuiApp, events: LogEvent[]): void {
  for (const event of events) {
    store.add(event);
    app.addEvent(event);
  }
}
