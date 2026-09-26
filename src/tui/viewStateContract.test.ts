/**
 * TUI view-state and help-overlay contract tests.
 *
 * Pins the view state machine documented in docs/cli.md ("Keyboard
 * Shortcuts"): exactly one view is active at a time — the default view plus
 * twelve overlay views; view-entry keys work from any view and every view
 * key is a toggle; Escape closes the worker detail overlay first and
 * otherwise steps back to the default view; the `?` help overlay floats
 * above the active view without changing it and only `?` opens or closes
 * it; Ctrl+K toggles the command palette; and the help text's key claims
 * match the keys actually bound at the screen level (including its
 * documented omissions: no transcript/xref toggles, `/` and `f` listed as
 * view-scoped actions that are not bound globally).
 *
 * The blessed module and the panel components are replaced with stateful
 * fakes: panel visibility, header/footer content, help-overlay lifecycle
 * and the screen's key registry are all recorded, so the assertions below
 * check the app's actual state-machine behavior rather than that methods
 * were merely called.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const state = {
    keyBindings: [] as Array<{ names: string[]; handler: () => void }>,
    boxes: [] as Array<Record<string, any>>,
    components: {} as Record<string, any>,
    selectedWorker: null as unknown,
    workerDetailWorker: null as unknown,
    workerDetailEvents: null as unknown,
  };

  function makeElement(options: Record<string, any> = {}) {
    const el: Record<string, any> = {
      options,
      content: options.content ?? '',
      hidden: true,
      destroyed: false,
      setContentCalls: 0,
      setContent: (c: string) => {
        el.content = c;
        el.setContentCalls += 1;
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
      key: () => {},
      on: () => {},
      destroy: () => {
        el.destroyed = true;
      },
      screen: null,
    };
    return el;
  }

  function makePanel(name: string, extra: Record<string, any> = {}, startVisible = false) {
    const panel: Record<string, any> = {
      panelName: name,
      visible: startVisible,
      showCalls: 0,
      hideCalls: 0,
    };
    panel.show = () => {
      panel.visible = true;
      panel.showCalls += 1;
    };
    panel.hide = () => {
      panel.visible = false;
      panel.hideCalls += 1;
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

  function makeScreen() {
    return {
      render: () => {},
      destroy: () => {},
      append: () => {},
      key: (names: string[], handler: () => void) => {
        state.keyBindings.push({ names, handler });
      },
      focusNext: () => {},
      focusPrevious: () => {},
    };
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
    screen: () => h.makeScreen(),
    box: (options?: Record<string, any>) => {
      const el = h.makeElement(options);
      h.state.boxes.push(el);
      return el;
    },
    log: (options?: Record<string, any>) => h.makeElement({ ...options, log: () => {} }),
    textbox: (options?: Record<string, any>) =>
      h.makeElement({ ...options, getValue: () => '', setValue: () => {} }),
    list: (options?: Record<string, any>) =>
      h.makeElement({ ...options, setItems: () => {}, select: () => {} }),
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
    },
    clearSuggestions: () => {},
    addSuggestion: () => {},
    addSuggestions: () => {},
  }),
}));

vi.mock('./components/FileHeatmap.js', () => ({
  FileHeatmap: h.panelClass('fileHeatmap', {
    updateData: () => {},
    getSelected: () => null,
    getSortMode: () => 'modifications',
    getCollisionFilter: () => false,
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

/** Header text of the default view (empty store, no CLI filter). */
const DEFAULT_HEADER = ' FABRIC - Worker Activity Monitor';

/**
 * The twelve overlay views with their documented entry keys and exact
 * header text (docs/cli.md "Views — entry and exit"; the implementation
 * prefixes each documented header with one space).
 */
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

/** Every key name the docs declare as a screen-level binding. */
const DOCUMENTED_SCREEN_KEYS = [
  'q', 'C-c', // quit
  '?', // help overlay
  'tab', 'S-tab', // panel focus
  'enter', // worker detail
  'escape', // step back
  'C-k', // command palette
  'C-t', // theme
  'r', // re-render
  'R', // session replay (uppercase only)
  'H', 'h', // heatmap
  'D', 'd', // dag
  'E', 'e', // errors
  'G', 'g', // digest
  'C', 'c', // collisions
  'I', // git
  'N', // narrative
  'A', // analytics
  'T', // transcript
  'X', // xref
  'B', // budget
  'p', 'P', 'F', // pin worker / pin bead / focus mode
  'C-f', '{', '}', // file-context split and resize
  '[', ']', // focus presets
];

/**
 * Help-overlay lines that claim a key toggles a view, paired with the view
 * they must really enter (docs/cli.md: the overlay is "a quick summary" of
 * the actual bindings).
 */
const HELP_TOGGLE_CLAIMS = [
  { key: 'H', action: 'Toggle file heatmap', view: 'heatmap' },
  { key: 'D', action: 'Toggle dependency DAG', view: 'dag' },
  { key: 'R', action: 'Toggle session replay', view: 'replay' },
  { key: 'E', action: 'Toggle error groups', view: 'errors' },
  { key: 'C', action: 'Toggle collision alerts', view: 'collisions' },
  { key: 'G', action: 'Toggle session digest', view: 'digest' },
  { key: 'I', action: 'Toggle git integration', view: 'git' },
  { key: 'N', action: 'Toggle semantic narrative', view: 'narrative' },
  { key: 'A', action: 'Toggle worker analytics', view: 'analytics' },
  { key: 'B', action: 'Toggle budget dashboard view', view: 'budget' },
];

function buildApp(options: TuiOptions = {}): FabricTuiApp {
  h.state.keyBindings.length = 0;
  h.state.boxes.length = 0;
  for (const key of Object.keys(h.state.components)) delete h.state.components[key];
  h.state.selectedWorker = null;
  h.state.workerDetailWorker = null;
  h.state.workerDetailEvents = null;
  return new FabricTuiApp(new InMemoryEventStore(), options);
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

function helpOverlays(): Array<Record<string, any>> {
  return h.state.boxes.filter(b => b.options && b.options.label === ' Help ');
}

function openHelpContent(): string {
  press('?');
  const overlays = helpOverlays();
  expect(overlays.length).toBeGreaterThan(0);
  return overlays[overlays.length - 1].content;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findView(name: string): ViewSpec {
  const view = VIEWS.find(v => v.name === name);
  if (!view) throw new Error(`unknown view: ${name}`);
  return view;
}

/**
 * Assert the full mutually-exclusive view state: the named view's header is
 * up, exactly its panel is visible, every other overlay panel plus the
 * default panels and the file-context split are hidden, and the footer
 * offers the Escape step-back.
 */
function expectViewActive(view: ViewSpec | null): void {
  const c = h.state.components;
  if (view === null) {
    expect(headerBox().content).toBe(DEFAULT_HEADER);
    expect(c.workerGrid.visible).toBe(true);
    expect(c.activityStream.visible).toBe(true);
    expect(c.fileContextPanel.visible).toBe(false);
    for (const v of VIEWS) {
      expect(c[v.panel].visible).toBe(false);
    }
    return;
  }
  expect(headerBox().content).toBe(view.header);
  for (const v of VIEWS) {
    expect(c[v.panel].visible, `panel ${v.panel} while in ${view.name}`).toBe(v.panel === view.panel);
  }
  expect(c.workerGrid.visible).toBe(false);
  expect(c.activityStream.visible).toBe(false);
  expect(c.fileContextPanel.visible).toBe(false);
  expect(footerBox().content).toContain('[Esc]');
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

describe('TUI view-state contract (docs/cli.md)', () => {
  beforeEach(() => {
    buildApp();
  });

  it('starts in the default view with the documented header and footer', () => {
    expect(headerBox().content).toBe(DEFAULT_HEADER);
    expect(footerBox().content).toContain('[?] Help');
    expect(footerBox().content).toContain('[q] Quit');
    const c = h.state.components;
    expect(c.workerGrid.visible).toBe(true);
    expect(c.activityStream.visible).toBe(true);
    for (const v of VIEWS) {
      expect(c[v.panel].visible).toBe(false);
    }
  });

  it('defines exactly twelve overlay views (default + 12 = the 13 documented views)', () => {
    expect(VIEWS).toHaveLength(12);
    for (const view of VIEWS) {
      for (const key of view.keys) {
        expect(isBound(key), `view key ${key} (${view.name})`).toBe(true);
      }
    }
  });

  describe('view entry and mutual exclusion', () => {
    it.each(VIEWS)('$name: entry shows only its panel and sets its documented header', view => {
      press(view.keys[0]);
      expectViewActive(view);
    });

    it('lowercase aliases enter the same views as the uppercase keys', () => {
      for (const view of VIEWS) {
        for (const key of view.keys.slice(1)) {
          press(key);
          expectViewActive(view);
          press('escape');
          expectViewActive(null);
        }
      }
    });

    it('switching directly between overlay views keeps exactly one active (full sweep)', () => {
      for (const view of VIEWS) {
        press(view.keys[0]);
        // Each press originates from a different view than the previous
        // one, so this chains every adjacent pair of views.
        expectViewActive(view);
      }
    });

    it('every view key is a toggle: pressing it again returns to the default view', () => {
      for (const view of VIEWS) {
        press(view.keys[0]);
        expectViewActive(view);
        press(view.keys[0]);
        expectViewActive(null);
      }
    });

    it('r re-renders and never switches views; R is the only replay toggle', () => {
      press('r');
      expectViewActive(null);

      press('H');
      press('r');
      expectViewActive(findView('heatmap'));

      press('R');
      expectViewActive(findView('replay'));
      press('r');
      expectViewActive(findView('replay'));
      press('R');
      expectViewActive(null);
    });
  });

  describe('Escape', () => {
    it.each(VIEWS)('steps back from $name to the default view', view => {
      press(view.keys[0]);
      expectViewActive(view);
      press('escape');
      expectViewActive(null);
    });

    it('is a no-op in the default view', () => {
      const setContentCallsBefore = headerBox().setContentCalls;
      press('escape');
      expect(headerBox().setContentCalls).toBe(setContentCallsBefore);
      expectViewActive(null);
    });

    it('never dismisses the help overlay — only ? closes it', () => {
      press('H');
      press('?');
      const overlay = helpOverlays()[0];
      expect(overlay).toBeDefined();

      press('escape');
      // The view still steps back…
      expectViewActive(null);
      // …but the overlay survives Escape.
      expect(overlay.destroyed).toBe(false);

      press('?');
      expect(overlay.destroyed).toBe(true);
      expect(helpOverlays().filter(o => !o.destroyed)).toHaveLength(0);
    });
  });

  describe('worker detail overlay', () => {
    it('Enter opens the detail overlay for the selected worker', () => {
      h.state.selectedWorker = WORKER;
      press('enter');
      const detail = h.state.components.workerDetail;
      expect(detail.visible).toBe(true);
      expect(h.state.workerDetailWorker).toBe(WORKER);
    });

    it('Enter does nothing when no worker is selected', () => {
      press('enter');
      expect(h.state.components.workerDetail.visible).toBe(false);
    });

    it('Escape closes the detail overlay before stepping back a view', () => {
      h.state.selectedWorker = WORKER;
      press('H');
      press('enter');
      expect(h.state.components.workerDetail.visible).toBe(true);

      press('escape');
      // First Escape closes the detail and leaves the view untouched.
      expect(h.state.components.workerDetail.visible).toBe(false);
      expectViewActive(findView('heatmap'));

      // Second Escape steps back to the default view.
      press('escape');
      expectViewActive(null);
    });

    it('Escape with the detail open in the default view stays in the default view', () => {
      h.state.selectedWorker = WORKER;
      press('enter');
      expect(h.state.components.workerDetail.visible).toBe(true);
      press('escape');
      expect(h.state.components.workerDetail.visible).toBe(false);
      expectViewActive(null);
    });
  });

  describe('command palette (Ctrl+K)', () => {
    it('Ctrl+K toggles the palette', () => {
      const palette = h.state.components.commandPalette;
      press('C-k');
      expect(palette.visible).toBe(true);
      press('C-k');
      expect(palette.visible).toBe(false);
    });

    it('the palette floats above the active view without changing it', () => {
      const palette = h.state.components.commandPalette;
      press('H');
      press('C-k');
      expect(palette.visible).toBe(true);
      expectViewActive(findView('heatmap'));
      press('C-k');
      expect(palette.visible).toBe(false);
      expectViewActive(findView('heatmap'));
    });

    it('Escape while the palette is open still steps back the active view', () => {
      // docs/cli.md: closing the palette with Escape also fires the global
      // Escape action, so the active view steps back at the same time.
      press('G');
      press('C-k');
      expect(h.state.components.commandPalette.visible).toBe(true);
      press('escape');
      expectViewActive(null);
    });
  });

  describe('help overlay (?)', () => {
    it('? creates a single overlay without changing the active view', () => {
      press('?');
      expect(helpOverlays()).toHaveLength(1);
      expectViewActive(null);

      // Entering a view while help is open keeps the overlay above it —
      // the still-open ? is the one that closes it (it toggles, so a
      // second ? never stacks a second overlay).
      press('H');
      expect(helpOverlays()[0].destroyed).toBe(false);
      expectViewActive(findView('heatmap'));

      press('?');
      expect(helpOverlays()[0].destroyed).toBe(true);
      // Closing help leaves the active view untouched.
      expectViewActive(findView('heatmap'));
    });

    it('? toggles: a second ? closes the overlay, a third reopens a fresh one', () => {
      press('?');
      const first = helpOverlays()[0];
      press('?');
      expect(first.destroyed).toBe(true);

      press('?');
      const overlays = helpOverlays();
      expect(overlays).toHaveLength(2);
      expect(overlays[1].destroyed).toBe(false);
    });

    it('opens above the worker detail overlay', () => {
      h.state.selectedWorker = WORKER;
      press('enter');
      expect(h.state.components.workerDetail.visible).toBe(true);
      press('?');
      expect(helpOverlays()).toHaveLength(1);
      expect(h.state.components.workerDetail.visible).toBe(true);
    });
  });

  describe('help text matches actual key scopes', () => {
    it.each(HELP_TOGGLE_CLAIMS)('$key: the help claim "$action" is real — the key toggles $view', claim => {
      const content = openHelpContent();
      expect(content).toMatch(
        new RegExp(`^\\s*${claim.key}\\s+- ${escapeRegExp(claim.action)}\\s*$`, 'm')
      );
      expect(isBound(claim.key)).toBe(true);
      press(claim.key);
      expectViewActive(findView(claim.view));
    });

    it('lists / and f as scoped actions but binds neither at screen level', () => {
      const content = openHelpContent();
      expect(content).toMatch(/^\s*\/\s+- Search\s*$/m);
      expect(content).toMatch(/^\s*f\s+- Filter\s*$/m);
      // docs/cli.md: "/" searches only inside the conversation transcript
      // and "f" acts only inside specific views — neither is a global key.
      expect(isBound('/')).toBe(false);
      expect(isBound('f')).toBe(false);
    });

    it('omits the transcript and cross-reference view toggles (documented omission)', () => {
      const content = openHelpContent().toLowerCase();
      expect(content).not.toContain('transcript');
      expect(content).not.toContain('cross');
      // …while T and X are nevertheless real, bound view toggles.
      expect(isBound('T')).toBe(true);
      expect(isBound('X')).toBe(true);
    });

    it('binds exactly the documented screen-level keys — nothing more', () => {
      const bound = [...new Set(h.state.keyBindings.flatMap(b => b.names))].sort();
      expect(bound).toEqual([...DOCUMENTED_SCREEN_KEYS].sort());
    });

    it('per-view action keys are view-scoped: they are not bound globally', () => {
      // docs/cli.md "Binding conflicts": s, a, f, t, b, n, l, m, x, i and
      // the digits/arrows act only inside their views — none may be a
      // screen-level binding, or they would switch views everywhere.
      const scopedKeys = [
        ...'abfijklmnostuvwxyz'.split(''),
        '1', '2', '3', '4', '5',
        'space', 'home', 'end', 'left', 'right', 'up', 'down',
      ];
      for (const key of scopedKeys) {
        expect(isBound(key), `key ${key} must stay view-scoped`).toBe(false);
      }
      expect(isBound('/')).toBe(false);
    });

    it('the lowercase letters bound globally are exactly the documented ones', () => {
      const boundLowercase = [...new Set(h.state.keyBindings.flatMap(b => b.names))]
        .filter(name => /^[a-z]$/.test(name))
        .sort();
      // h/d/e/g/c view toggles, r re-render, p pin worker, q quit.
      expect(boundLowercase).toEqual(['c', 'd', 'e', 'g', 'h', 'p', 'q', 'r']);
    });

    it('the overlay is the documented quick summary, not a full reference', () => {
      const content = openHelpContent();
      expect(content).toContain('Keyboard Shortcuts');
      // Sections present…
      expect(content).toContain('Heatmap View:');
      expect(content).toContain('Session Replay:');
      expect(content).toContain('Budget Dashboard:');
      // …with the documented Escape behavior of every overlay view.
      expect(content).toContain('Esc     - Return to default view');
    });
  });
});
