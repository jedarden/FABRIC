/**
 * TUI global key semantics regression tests (docs/cli.md "Global keys").
 *
 * Pins the CLI-documented behavior of the screen-level keys that must work
 * the same in every view, plus the overlays they interact with:
 *
 *   - `?` help overlay: opens above the current state, only `?` closes it,
 *     and it never changes the active view
 *   - Escape precedence: the worker detail overlay closes first, then the
 *     view steps back to the default view, and in the default view it is a
 *     no-op — it never dismisses the help overlay or the command palette
 *   - worker-detail dismissal: Enter opens it only for a selected worker,
 *     Escape closes it
 *   - command-palette dismissal at screen level: Ctrl+K toggles it (and
 *     refreshes preset suggestions first); the component-level half of the
 *     palette's Escape handling lives in
 *     `src/tui/components/commandPaletteEscape.test.ts`, which tests the
 *     real component — mocking `./components/CommandPalette.js` here (as
 *     the app-level tests must) means a component test in this file would
 *     only exercise the mock
 *   - Ctrl+T: flips dark/light through the shared theme manager, flashes
 *     the header for one second, never changes the active view, and the new
 *     theme survives view navigation (default-view footer badge)
 *   - uppercase R versus lowercase r: `r` only re-renders and never
 *     switches views (in particular never toggles replay); `R` is the only
 *     replay toggle
 *   - g/G versus the heatmap: `g`/`G` toggle the session digest from the
 *     default view and every overlay except the heatmap, where they are
 *     the heatmap's own jump-to-first/last navigation and the toggle is
 *     suppressed (docs/cli.md "Binding conflicts")
 *   - view switching from overlays: a view key pressed while the help
 *     overlay, the worker detail, or the open command palette floats above
 *     switches views and leaves the overlay open
 *
 * The same stateful-fake approach as viewStateContract.test.ts is used for
 * the app-level tests; the theme manager runs for real against a redirected
 * HOME so no user config is touched.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Redirect HOME to a throwaway directory for the whole file, before any
// import runs: the theme manager reads ~/.fabric/theme.json on first use,
// the command palette resolves its recent-commands file path at module
// load, and focus presets persist under ~/.fabric too. The directory is
// never pre-created — every writer in that chain mkdirs what it needs, and
// a missing directory simply reads as the default theme / no recents.
const homeCtl = vi.hoisted(() => {
  const originalHome = process.env.HOME;
  const fakeHome = `${process.env.TMPDIR ?? '/tmp'}/fabric-keysemantics-${process.pid}-${Math.random()
    .toString(36)
    .slice(2)}`;
  process.env.HOME = fakeHome;
  return { originalHome, fakeHome };
});

// ESM namespaces can't be spied on, so route os.homedir() through the same
// override (the command palette joins its recent-commands path from it).
const homedirCtl = vi.hoisted(() => ({ fakeHome: process.env.HOME }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => homedirCtl.fakeHome ?? actual.homedir(),
  };
});

afterAll(() => {
  process.env.HOME = homeCtl.originalHome;
  fs.rmSync(homeCtl.fakeHome, { recursive: true, force: true });
});

const h = vi.hoisted(() => {
  const state = {
    keyBindings: [] as Array<{ names: string[]; handler: () => void }>,
    boxes: [] as Array<Record<string, any>>,
    screens: [] as Array<{ renders: number }>,
    components: {} as Record<string, any>,
    selectedWorker: null as unknown,
    workerDetailWorker: null as unknown,
    workerDetailEvents: null as unknown,
  };

  function makeElement(options: Record<string, any> = {}) {
    const el: Record<string, any> = {
      options,
      content: options.content ?? '',
      value: '',
      hidden: true,
      destroyed: false,
      screen: { render: () => { el.screen.renders += 1; }, renders: 0 },
      eventHandlers: {} as Record<string, Array<(...args: unknown[]) => void>>,
      keyBindings: [] as Array<{ names: string[]; handler: () => void }>,
      setContent: (c: string) => {
        el.content = c;
      },
      getContent: () => el.content,
      setLabel: () => {},
      show: () => {
        el.hidden = false;
      },
      hide: () => {
        el.hidden = true;
      },
      focus: () => {},
      on: (event: string, handler: (...args: unknown[]) => void) => {
        (el.eventHandlers[event] ??= []).push(handler);
      },
      key: (names: string[], handler: () => void) => {
        el.keyBindings.push({ names, handler });
      },
      getValue: () => el.value,
      setValue: (v: string) => {
        el.value = v;
      },
      setItems: (items: string[]) => {
        el.lastItems = items;
      },
      select: (index: number) => {
        el.selectedIndex = index;
      },
      destroy: () => {
        el.destroyed = true;
      },
    };
    return el;
  }

  function makeScreen() {
    const screen = {
      renders: 0,
      render: () => {
        screen.renders += 1;
      },
      destroy: () => {},
      append: () => {},
      key: (names: string[], handler: () => void) => {
        state.keyBindings.push({ names, handler });
      },
      focusNext: () => {},
      focusPrevious: () => {},
    };
    state.screens.push(screen);
    return screen;
  }

  function makePanel(name: string, extra: Record<string, any> = {}, startVisible = false) {
    const panel: Record<string, any> = {
      panelName: name,
      visible: startVisible,
      showCalls: 0,
      hideCalls: 0,
      callLog: [] as string[],
    };
    panel.show = () => {
      panel.visible = true;
      panel.showCalls += 1;
      panel.callLog.push('show');
    };
    panel.hide = () => {
      panel.visible = false;
      panel.hideCalls += 1;
      panel.callLog.push('hide');
    };
    panel.focus = () => {};
    panel.isVisible = () => panel.visible;
    panel.getElement = () => ({
      show: panel.show,
      hide: panel.hide,
      get hidden() {
        return !panel.visible;
      },
      screen: { render: () => {} },
    });
    Object.assign(panel, extra);
    state.components[name] = panel;
    return panel;
  }

  // Used with `new` from the vi.mock factories below: returning an object
  // from a constructor replaces `this`, so each construction registers a
  // fresh stateful panel under its name.
  const panelClass = (name: string, extra: Record<string, any> = {}, startVisible = false) =>
    function MockPanelCtor() {
      return makePanel(name, extra, startVisible);
    };

  return { state, makeElement, makeScreen, panelClass };
});

vi.mock('blessed', () => {
  const blessedMock = {
    screen: vi.fn(() => h.makeScreen()),
    box: vi.fn((options?: Record<string, any>) => {
      const el = h.makeElement(options ?? {});
      h.state.boxes.push(el);
      return el;
    }),
    log: vi.fn((options?: Record<string, any>) => h.makeElement({ ...options, log: () => {} })),
    textbox: vi.fn((options?: Record<string, any>) => h.makeElement({ ...options })),
    list: vi.fn((options?: Record<string, any>) =>
      h.makeElement({ ...options, setItems: () => {}, select: () => {} })
    ),
  };
  return { default: blessedMock, ...blessedMock };
});

vi.mock('./components/WorkerGrid.js', () => ({
  WorkerGrid: h.panelClass(
    'workerGrid',
    {
      updateWorkers: () => {},
      setFocusMode: () => {},
      getSelected: () => h.state.selectedWorker ?? null,
    },
    true
  ),
}));

vi.mock('./components/ActivityStream.js', () => ({
  ActivityStream: h.panelClass(
    'activityStream',
    {
      addEvent: () => {},
      clearFilter: () => {},
      setFilter: () => {},
      togglePause: () => {},
      getIsPaused: () => false,
      setFocusMode: () => {},
    },
    true
  ),
}));

vi.mock('./components/WorkerDetail.js', () => ({
  WorkerDetail: h.panelClass('workerDetail', {
    setWorker: (worker: unknown) => {
      h.state.workerDetailWorker = worker;
    },
    setRecentEvents: (events: unknown) => {
      h.state.workerDetailEvents = events;
    },
  }),
}));

vi.mock('./components/CommandPalette.js', () => ({
  CommandPalette: h.panelClass('commandPalette', {
    toggle: () => {
      const palette = h.state.components.commandPalette;
      palette.visible = !palette.visible;
      palette.callLog.push('toggle');
    },
    clearSuggestions: () => {
      h.state.components.commandPalette.callLog.push('clearSuggestions');
    },
    addSuggestions: () => {
      h.state.components.commandPalette.callLog.push('addSuggestions');
    },
    addSuggestion: () => {},
  }),
}));

vi.mock('./components/FileHeatmap.js', () => ({
  FileHeatmap: h.panelClass('fileHeatmap', {
    updateData: () => {},
    getSelected: () => null,
    getSortMode: () => 'modifications',
    getCollisionFilter: () => false,
    getAnomalyFilter: () => false,
  }),
}));

vi.mock('./components/DependencyDag.js', () => ({
  DependencyDag: h.panelClass('dependencyDag', {
    refresh: () => {},
    getGraph: () => null,
    getStats: () => null,
  }),
}));

vi.mock('./components/SessionReplay.js', () => ({
  SessionReplay: h.panelClass('sessionReplay', {
    loadEvents: () => {},
    getState: () => 'ready',
    getSpeed: () => 1,
    play: () => {},
    pause: () => {},
    reset: () => {},
  }),
}));

vi.mock('./components/ErrorGroupPanel.js', () => ({
  ErrorGroupPanel: h.panelClass('errorGroupPanel', {
    updateGroups: () => {},
  }),
}));

vi.mock('./components/SessionDigest.js', () => ({
  SessionDigest: h.panelClass('sessionDigest', {
    setDigest: () => {},
  }),
  generateSessionDigest: () => ({}),
}));

vi.mock('./components/CollisionAlert.js', () => ({
  CollisionAlert: h.panelClass('collisionAlert', {
    updateAlerts: () => {},
  }),
}));

vi.mock('./components/GitIntegration.js', () => ({
  GitIntegration: h.panelClass('gitIntegration', {
    updateGitEvents: () => {},
  }),
}));

vi.mock('./components/SemanticNarrativePanel.js', () => ({
  SemanticNarrativePanel: h.panelClass('semanticNarrativePanel', {
    updateAggregated: () => {},
  }),
}));

vi.mock('./components/WorkerAnalyticsPanel.js', () => ({
  WorkerAnalyticsPanel: h.panelClass('workerAnalyticsPanel', {
    setMetrics: () => {},
  }),
}));

vi.mock('./components/FileContextPanel.js', () => ({
  FileContextPanel: h.panelClass('fileContextPanel', {
    setContextFromEvent: () => {},
  }),
}));

vi.mock('./components/ConversationTranscript.js', () => ({
  ConversationTranscript: h.panelClass('conversationTranscript', {}),
}));

vi.mock('./components/CrossReferencePanel.js', () => ({
  CrossReferencePanel: h.panelClass('crossReferencePanel', {}),
}));

vi.mock('./components/BudgetAlertPanel.js', () => ({
  BudgetAlertPanel: h.panelClass('budgetAlertPanel', {
    setCostSummary: () => {},
    setAlerts: () => {},
  }),
}));

// Import after mocking
import { FabricTuiApp, TuiOptions } from './app.js';
import { InMemoryEventStore } from '../store.js';
import { WorkerInfo } from '../types.js';
import { getThemeManager } from './utils/theme.js';

/** Header text of the default view (empty store, no CLI filter). */
const DEFAULT_HEADER = ' FABRIC - Worker Activity Monitor';

/** The exact header text the theme flash shows while toggling. */
const themeFlash = (theme: string) => ` FABRIC - Theme: ${theme.toUpperCase()}`;

interface ViewSpec {
  name: string;
  /** All key aliases that enter the view. */
  keys: string[];
  /** Key in the components registry for the view's panel. */
  panel: string;
  /** Exact header text set on entry. */
  header: string;
}

const VIEWS: ViewSpec[] = [
  { name: 'heatmap', keys: ['H', 'h'], panel: 'fileHeatmap', header: ' FABRIC - File Heatmap' },
  { name: 'dag', keys: ['D', 'd'], panel: 'dependencyDag', header: ' FABRIC - Task Dependency DAG' },
  { name: 'replay', keys: ['R'], panel: 'sessionReplay', header: ' FABRIC - Session Replay' },
  { name: 'errors', keys: ['E', 'e'], panel: 'errorGroupPanel', header: ' FABRIC - Error Groups' },
  { name: 'digest', keys: ['G', 'g'], panel: 'sessionDigest', header: ' FABRIC - Session Digest' },
  { name: 'collisions', keys: ['C', 'c'], panel: 'collisionAlert', header: ' FABRIC - Collision Alerts' },
  { name: 'git', keys: ['I'], panel: 'gitIntegration', header: ' FABRIC - Git Integration' },
  { name: 'narrative', keys: ['N'], panel: 'semanticNarrativePanel', header: ' FABRIC - Semantic Narrative' },
  { name: 'analytics', keys: ['A'], panel: 'workerAnalyticsPanel', header: ' FABRIC - Worker Analytics' },
  { name: 'transcript', keys: ['T'], panel: 'conversationTranscript', header: ' FABRIC - Conversation Transcript' },
  { name: 'xref', keys: ['X'], panel: 'crossReferencePanel', header: ' FABRIC - Cross References' },
  { name: 'budget', keys: ['B'], panel: 'budgetAlertPanel', header: ' FABRIC - Budget Dashboard' },
];

function buildApp(options: TuiOptions = {}): FabricTuiApp {
  h.state.keyBindings.length = 0;
  h.state.boxes.length = 0;
  h.state.screens.length = 0;
  for (const key of Object.keys(h.state.components)) delete h.state.components[key];
  h.state.selectedWorker = null;
  h.state.workerDetailWorker = null;
  h.state.workerDetailEvents = null;
  const app = new FabricTuiApp(new InMemoryEventStore(), options);
  return app;
}

/** Press a key the way blessed does: dispatch to every handler bound to it. */
function press(key: string): void {
  const bindings = h.state.keyBindings.filter(b => b.names.includes(key));
  if (bindings.length === 0) {
    throw new Error(`no screen-level handler bound for key: ${key}`);
  }
  for (const binding of bindings) binding.handler();
}

function isBound(key: string): boolean {
  return h.state.keyBindings.some(b => b.names.includes(key));
}

function headerBox(): Record<string, any> {
  return h.state.boxes[0];
}

function footerBox(): Record<string, any> {
  return h.state.boxes[1];
}

function currentScreen(): { renders: number } {
  return h.state.screens[h.state.screens.length - 1];
}

function helpOverlays(): Array<Record<string, any>> {
  return h.state.boxes.filter(b => b.options && b.options.label === ' Help ');
}

function expectDefaultView(context = ''): void {
  const why = context ? ` [${context}]` : '';
  const c = h.state.components;
  expect(headerBox().content, `header${why}`).toBe(DEFAULT_HEADER);
  expect(c.workerGrid.visible, `workerGrid${why}`).toBe(true);
  expect(c.activityStream.visible, `activityStream${why}`).toBe(true);
  expect(c.fileContextPanel.visible, `fileContextPanel${why}`).toBe(false);
  for (const v of VIEWS) {
    expect(c[v.panel].visible, `panel ${v.panel} in default view${why}`).toBe(false);
  }
}

function expectViewActive(view: ViewSpec, context = ''): void {
  const why = context ? ` [${context}]` : '';
  const c = h.state.components;
  expect(headerBox().content, `header${why}`).toBe(view.header);
  for (const v of VIEWS) {
    expect(c[v.panel].visible, `panel ${v.panel} while in ${view.name}${why}`).toBe(v.panel === view.panel);
  }
  expect(c.workerGrid.visible, `workerGrid while in ${view.name}${why}`).toBe(false);
  expect(c.activityStream.visible, `activityStream while in ${view.name}${why}`).toBe(false);
}

function findView(name: string): ViewSpec {
  const view = VIEWS.find(v => v.name === name);
  if (!view) throw new Error(`unknown view: ${name}`);
  return view;
}

const WORKER: WorkerInfo = {
  id: 'w-alpha',
  status: 'active',
  beadsCompleted: 3,
  beadsSucceeded: 2,
  beadsTimedOut: 1,
  firstSeen: Date.now() - 60_000,
  lastActivity: Date.now(),
  activeFiles: [],
  hasCollision: false,
  activeDirectories: [],
  collisionTypes: [],
  eventCount: 10,
  currentBead: null,
};

/** Open the worker detail overlay for the mock worker via Enter. */
function openWorkerDetail(): void {
  h.state.selectedWorker = WORKER;
  press('enter');
  expect(h.state.components.workerDetail.visible).toBe(true);
}

describe('TUI global key semantics (docs/cli.md "Global keys")', () => {
  beforeEach(() => {
    buildApp();
  });

  describe('? help overlay', () => {
    it('? opens a single overlay above the default view without changing it', () => {
      press('?');
      expect(helpOverlays()).toHaveLength(1);
      expect(helpOverlays()[0].destroyed).toBe(false);
      expectDefaultView();
    });

    it('? toggles: the second ? closes the overlay, a third opens a fresh one', () => {
      press('?');
      const first = helpOverlays()[0];

      press('?');
      expect(first.destroyed).toBe(true);
      expect(helpOverlays().filter(o => !o.destroyed)).toHaveLength(0);

      press('?');
      expect(helpOverlays()).toHaveLength(2);
      expect(helpOverlays()[1].destroyed).toBe(false);
    });

    it('? is the only key that closes the overlay — view keys keep it open', () => {
      press('?');
      const overlay = helpOverlays()[0];

      // Switching views leaves the overlay floating above the new view…
      press('H');
      expect(overlay.destroyed).toBe(false);
      expectViewActive(findView('heatmap'), 'heatmap with help open');

      // …and stepping back leaves it open too.
      press('escape');
      expect(overlay.destroyed).toBe(false);
      expectDefaultView('back to default with help open');

      press('?');
      expect(overlay.destroyed).toBe(true);
    });
  });

  describe('Escape precedence', () => {
    it('closes the worker detail first and leaves the view, help overlay, and palette untouched', () => {
      press('D');
      press('?');
      press('C-k');
      openWorkerDetail();
      const overlay = helpOverlays()[0];
      const palette = h.state.components.commandPalette;

      press('escape');
      // First Escape closes only the detail…
      expect(h.state.components.workerDetail.visible).toBe(false);
      // …the view stays…
      expectViewActive(findView('dag'), 'dag after detail dismissal');
      // …and neither floating overlay is touched.
      expect(overlay.destroyed).toBe(false);
      expect(palette.visible).toBe(true);
    });

    it('steps the view back on the second Escape and still spares the overlays', () => {
      press('D');
      press('?');
      press('C-k');
      openWorkerDetail();
      const overlay = helpOverlays()[0];
      const palette = h.state.components.commandPalette;

      press('escape'); // detail closes
      press('escape'); // view steps back
      expectDefaultView('after second escape');
      expect(overlay.destroyed).toBe(false);
      expect(palette.visible).toBe(true);
    });

    it('is a no-op in the default view: nothing re-renders and no overlay changes', () => {
      const rendersBefore = currentScreen().renders;
      const setContentCallsBefore = headerBox().content;

      press('escape');

      expect(currentScreen().renders).toBe(rendersBefore);
      expect(headerBox().content).toBe(setContentCallsBefore);
      expectDefaultView('escape no-op');
      expect(helpOverlays()).toHaveLength(0);
      expect(h.state.components.commandPalette.visible).toBe(false);
    });

    it('never dismisses the help overlay, even with nothing else open', () => {
      press('?');
      const overlay = helpOverlays()[0];

      press('escape');
      expect(overlay.destroyed).toBe(false);
      expectDefaultView('help survives escape');

      // ? remains the way out.
      press('?');
      expect(overlay.destroyed).toBe(true);
    });

    it('never dismisses the command palette — closing it is the palette\'s own binding', () => {
      const palette = h.state.components.commandPalette;
      press('C-k');
      expect(palette.visible).toBe(true);

      press('escape');
      // The screen-level Escape handler does not touch the palette; the
      // palette closes itself from its input element (pinned at component
      // level below).
      expect(palette.visible).toBe(true);
      expectDefaultView('palette survives escape');
    });
  });

  describe('worker detail dismissal', () => {
    it('Enter opens the detail overlay for the selected worker', () => {
      openWorkerDetail();
      expect(h.state.workerDetailWorker).toBe(WORKER);
      expectDefaultView('detail floats above default');
    });

    it('Enter is a no-op when no worker is selected', () => {
      press('enter');
      expect(h.state.components.workerDetail.visible).toBe(false);
    });

    it('Escape closes the detail and stays in the default view', () => {
      openWorkerDetail();

      press('escape');
      expect(h.state.components.workerDetail.visible).toBe(false);
      expectDefaultView('after detail dismissal');
    });
  });

  describe('Ctrl+K command palette', () => {
    it('opens the palette after refreshing preset suggestions', () => {
      const palette = h.state.components.commandPalette;

      press('C-k');
      expect(palette.visible).toBe(true);
      // Presets are refreshed on every open so the palette always offers
      // the current saved presets (docs/cli.md palette section).
      const clearAt = palette.callLog.indexOf('clearSuggestions');
      const toggleAt = palette.callLog.indexOf('toggle');
      expect(clearAt).toBeGreaterThanOrEqual(0);
      expect(clearAt).toBeLessThan(toggleAt);
      expectDefaultView('palette open above default');
    });

    it('Ctrl+K again dismisses the palette', () => {
      const palette = h.state.components.commandPalette;
      press('C-k');
      press('C-k');
      expect(palette.visible).toBe(false);
      expectDefaultView('palette dismissed');
    });

    it.each(VIEWS)('opens above $name without changing the view', view => {
      const palette = h.state.components.commandPalette;
      press(view.keys[0]);
      press('C-k');
      expect(palette.visible).toBe(true);
      expectViewActive(view, 'palette open');
      press('C-k');
      expect(palette.visible).toBe(false);
      expectViewActive(view, 'palette dismissed');
    });

    it('a view key pressed while the palette is open switches views and keeps the palette open', () => {
      const palette = h.state.components.commandPalette;
      press('C-k');
      press('D');
      expect(palette.visible).toBe(true);
      expectViewActive(findView('dag'), 'dag with palette open');
    });
  });

  describe('Ctrl+T theme toggle', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // Pin the starting theme so the flip direction is deterministic no
      // matter what earlier tests in this file did (fresh HOME starts
      // dark; the pin makes that explicit). Must happen before buildApp so
      // the pin's notification lands on previous apps, not this one.
      getThemeManager().setTheme('dark');
      buildApp();
    });

    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
    });

    it('Ctrl+T flips dark → light and flashes the header', () => {
      press('C-t');
      expect(getThemeManager().getTheme()).toBe('light');
      expect(headerBox().content).toBe(themeFlash('light'));
    });

    it('the flash restores the previous header after one second', () => {
      press('C-t');
      expect(headerBox().content).toBe(themeFlash('light'));

      vi.advanceTimersByTime(1001);
      expect(headerBox().content).toBe(DEFAULT_HEADER);
      // The theme itself does not flip back.
      expect(getThemeManager().getTheme()).toBe('light');
    });

    it('Ctrl+T again flips back to dark', () => {
      press('C-t');
      expect(getThemeManager().getTheme()).toBe('light');

      vi.advanceTimersByTime(1001); // settle the first flash timer
      press('C-t');
      expect(getThemeManager().getTheme()).toBe('dark');
      expect(headerBox().content).toBe(themeFlash('dark'));
    });

    it('the flipped theme is persisted to the shared theme store', () => {
      press('C-t');
      const stored = JSON.parse(
        fs.readFileSync(path.join(homeCtl.fakeHome, '.fabric', 'theme.json'), 'utf-8')
      );
      expect(stored).toEqual({ theme: 'light' });
    });

    it.each(VIEWS)('toggles the theme from $name without changing the view', view => {
      press(view.keys[0]);
      const rendersBefore = currentScreen().renders;

      press('C-t');
      expect(getThemeManager().getTheme()).toBe('light');
      // The theme subscriber re-renders the screen…
      expect(currentScreen().renders).toBeGreaterThan(rendersBefore);
      // …the header shows the flash (asserted exactly below)…
      expect(headerBox().content).toBe(themeFlash('light'));
      // …and the view itself is untouched: panels and footer still say $name.
      const c = h.state.components;
      for (const v of VIEWS) {
        expect(c[v.panel].visible, `panel ${v.panel} while in ${view.name}`).toBe(v.panel === view.panel);
      }
      expect(footerBox().content).toContain('[Esc]');

      // After the flash the view's header is restored.
      vi.advanceTimersByTime(1001);
      expectViewActive(view, 'header restored after flash');

      press('escape');
      expectDefaultView('stepped back after theme toggle');
    });

    it('toggles while the worker detail and help overlay are open, disturbing neither', () => {
      press('?');
      openWorkerDetail();
      const overlay = helpOverlays()[0];

      press('C-t');
      expect(getThemeManager().getTheme()).toBe('light');
      expect(overlay.destroyed).toBe(false);
      expect(h.state.components.workerDetail.visible).toBe(true);

      vi.advanceTimersByTime(1001);
      expect(headerBox().content).toBe(DEFAULT_HEADER);
    });

    it('the new theme survives view navigation (default-view footer badge)', () => {
      expect(footerBox().content).toContain('[DARK]');

      press('C-t');
      vi.advanceTimersByTime(1001);
      // Leaving the default view and coming back rebuilds the footer from
      // the live theme…
      press('D');
      press('escape');
      expect(footerBox().content).toContain('[LIGHT]');
      expect(footerBox().content).not.toContain('[DARK]');

      // …and toggling back restores the dark badge.
      press('C-t');
      vi.advanceTimersByTime(1001);
      press('D');
      press('escape');
      expect(footerBox().content).toContain('[DARK]');
    });
  });

  describe('uppercase R versus lowercase r', () => {
    it('r re-renders the screen and never switches views', () => {
      const rendersBefore = currentScreen().renders;
      press('r');
      expect(currentScreen().renders).toBe(rendersBefore + 1);
      expectDefaultView('r from default');
    });

    it('R is the only replay toggle and r inside replay never leaves it', () => {
      press('r');
      expectDefaultView('r must not open replay');

      press('R');
      expectViewActive(findView('replay'), 'R opens replay');

      const rendersBefore = currentScreen().renders;
      press('r');
      expect(currentScreen().renders).toBe(rendersBefore + 1);
      expectViewActive(findView('replay'), 'r inside replay only re-renders');

      press('R');
      expectDefaultView('R closes replay');
    });

    it.each(VIEWS)('r inside $name re-renders in place and never switches views', view => {
      press(view.keys[0]);
      const rendersBefore = currentScreen().renders;
      press('r');
      expect(currentScreen().renders).toBe(rendersBefore + 1);
      expectViewActive(view, 'after r');
    });

    it('binds r and R as separate handlers, with R bound uppercase-only', () => {
      const rBinding = h.state.keyBindings.find(b => b.names.includes('r'));
      const upperBinding = h.state.keyBindings.find(b => b.names.includes('R'));
      expect(rBinding).toBeDefined();
      expect(upperBinding).toBeDefined();
      // Separate registrations: the refresh handler must not be the replay
      // toggle, and the replay binding must not also claim lowercase r.
      expect(rBinding).not.toBe(upperBinding);
      expect(upperBinding?.names).toEqual(['R']);
    });
  });

  describe('g/G: digest toggle versus heatmap first/last navigation', () => {
    it('g and G both toggle the digest from the default view', () => {
      press('g');
      expectViewActive(findView('digest'), 'g opens the digest');

      press('G');
      expectDefaultView('G closes the digest');
    });

    it('inside the heatmap view g/G are the heatmap navigation and never toggle the digest', () => {
      press('H');
      expectViewActive(findView('heatmap'));

      // Blessed would fire the screen-level toggle alongside the heatmap's
      // own g/G handlers; the toggle is gated off so the jump is the sole
      // effect (docs/cli.md "Binding conflicts").
      press('g');
      expectViewActive(findView('heatmap'), 'g absorbed by the heatmap');
      press('G');
      expectViewActive(findView('heatmap'), 'G absorbed by the heatmap');

      // The digest panel never opened underneath.
      expect(h.state.components.sessionDigest.visible).toBe(false);
    });

    it.each(VIEWS.filter(v => v.name !== 'heatmap'))(
      'g still toggles the digest from $name (the gate is heatmap-only)',
      view => {
        press(view.keys[0]);
        press('g');
        if (view.name === 'digest') {
          expectDefaultView('g inside the digest toggles it off');
        } else {
          expectViewActive(findView('digest'), `g from ${view.name}`);
        }
      }
    );

    it('the screen-level binding still claims both aliases — the deconfliction is a state gate, not a binding removal', () => {
      const gBinding = h.state.keyBindings.find(b => b.names.includes('g'));
      expect(gBinding).toBeDefined();
      expect(gBinding?.names).toEqual(['G', 'g']);
    });
  });

  describe('view switching from overlays', () => {
    it('a view key pressed while the help overlay is open switches views and keeps the overlay', () => {
      press('?');
      const overlay = helpOverlays()[0];

      press('H');
      expectViewActive(findView('heatmap'), 'switched under help');
      expect(overlay.destroyed).toBe(false);

      // The overlay stays dismissible above the new view.
      press('?');
      expect(overlay.destroyed).toBe(true);
      expectViewActive(findView('heatmap'), 'help closed, heatmap stays');
    });

    it('a view key pressed while the worker detail is open switches views and keeps the detail', () => {
      openWorkerDetail();

      press('H');
      expectViewActive(findView('heatmap'), 'switched under detail');
      expect(h.state.components.workerDetail.visible).toBe(true);

      // Escape still dismisses the detail first, leaving the view.
      press('escape');
      expect(h.state.components.workerDetail.visible).toBe(false);
      expectViewActive(findView('heatmap'), 'detail closed, heatmap stays');
    });
  });
});

