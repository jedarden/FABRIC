/**
 * Regression coverage for the documented TUI view state machine.
 *
 * The component implementations are replaced with tracked panels so this
 * test exercises the real FabricTuiApp screen bindings and setViewMode logic
 * without depending on terminal timing or blessed's event loop.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  class Element {
    visible = false;
    right: string | number = 0;
    width: string | number = 0;
    left: string | number = 0;
    show = vi.fn(() => {
      this.visible = true;
    });
    hide = vi.fn(() => {
      this.visible = false;
    });
    focus = vi.fn();
    key = vi.fn();
    on = vi.fn();
    destroy = vi.fn();
    setContent = vi.fn();
    getContent = vi.fn(() => '');
    setLabel = vi.fn();
    append = vi.fn();
    getValue = vi.fn(() => '');
    setValue = vi.fn();
  }

  class Panel {
    visible = false;
    detailVisible = false;
    element = new Element();
    show = vi.fn(() => {
      this.visible = true;
      this.element.show();
    });
    hide = vi.fn(() => {
      this.visible = false;
      this.element.hide();
    });
    focus = vi.fn();
    getElement = vi.fn(() => this.element);
    updateData = vi.fn();
    refresh = vi.fn();
    loadEvents = vi.fn();
    updateGroups = vi.fn();
    setDigest = vi.fn();
    updateAlerts = vi.fn();
    updateGitEvents = vi.fn();
    updateAggregated = vi.fn();
    setMetrics = vi.fn();
    setCostSummary = vi.fn();
    setAlerts = vi.fn();
    setContextFromEvent = vi.fn();
    getState = vi.fn(() => 'ready');
    getSpeed = vi.fn(() => 1);
    getSelected = vi.fn(() => null);
    getSortMode = vi.fn(() => 'modifications');
    getCollisionFilter = vi.fn(() => false);
    getAnomalyFilter = vi.fn(() => false);
    updateWorkers = vi.fn();
    setFocusMode = vi.fn();
    addEvent = vi.fn();
    clearFilter = vi.fn();
    setFilter = vi.fn();
    togglePause = vi.fn();
    scrollToTimestamp = vi.fn();
    isVisible = vi.fn(() => this.visible);
    isDetailVisible = vi.fn(() => this.detailVisible);
    setWorker = vi.fn();
    setRecentEvents = vi.fn();
    toggle = vi.fn(() => {
      if (this.visible) this.hide();
      else this.show();
    });
    /** Dispatch the focused panel's documented detail keys. */
    dispatchLocalKey = vi.fn((key: string) => {
      if (key === 'enter') this.detailVisible = true;
      if (key === 'escape' && this.detailVisible) this.detailVisible = false;
    });
    addSuggestions = vi.fn();
    clearSuggestions = vi.fn();
  }

  class DefaultPanel extends Panel {
    constructor() {
      super();
      this.visible = true;
      this.element.show();
    }
  }

  const screen = {
    render: vi.fn(),
    destroy: vi.fn(),
    append: vi.fn(),
    key: vi.fn(),
    focusNext: vi.fn(),
    focusPrevious: vi.fn(),
  };

  const screenFactory = vi.fn(() => screen);
  const elementFactory = vi.fn(() => new Element());

  return { DefaultPanel, Element, Panel, elementFactory, screen, screenFactory };
});

vi.mock('blessed', () => {
  const blessed = {
    screen: harness.screenFactory,
    box: harness.elementFactory,
    log: harness.elementFactory,
    textbox: harness.elementFactory,
    list: harness.elementFactory,
  };
  return { default: blessed, ...blessed };
});

vi.mock('./components/WorkerGrid.js', () => ({ WorkerGrid: harness.DefaultPanel }));
vi.mock('./components/ActivityStream.js', () => ({ ActivityStream: harness.DefaultPanel }));
vi.mock('./components/WorkerDetail.js', () => ({ WorkerDetail: harness.Panel }));
vi.mock('./components/CommandPalette.js', () => ({ CommandPalette: harness.Panel }));
vi.mock('./components/FileHeatmap.js', () => ({ FileHeatmap: harness.Panel }));
vi.mock('./components/DependencyDag.js', () => ({ DependencyDag: harness.Panel }));
vi.mock('./components/SessionReplay.js', () => ({ SessionReplay: harness.Panel }));
vi.mock('./components/ErrorGroupPanel.js', () => ({ ErrorGroupPanel: harness.Panel }));
vi.mock('./components/SessionDigest.js', () => ({
  SessionDigest: harness.Panel,
  generateSessionDigest: vi.fn(() => ({})),
}));
vi.mock('./components/CollisionAlert.js', () => ({ CollisionAlert: harness.Panel }));
vi.mock('./components/GitIntegration.js', () => ({ GitIntegration: harness.Panel }));
vi.mock('./components/SemanticNarrativePanel.js', () => ({ SemanticNarrativePanel: harness.Panel }));
vi.mock('./components/WorkerAnalyticsPanel.js', () => ({ WorkerAnalyticsPanel: harness.Panel }));
vi.mock('./components/FileContextPanel.js', () => ({ FileContextPanel: harness.Panel }));
vi.mock('./components/ConversationTranscript.js', () => ({ ConversationTranscript: harness.Panel }));
vi.mock('./components/CrossReferencePanel.js', () => ({ CrossReferencePanel: harness.Panel }));
vi.mock('./components/BudgetAlertPanel.js', () => ({ BudgetAlertPanel: harness.Panel }));

import { FabricTuiApp } from './app.js';
import { InMemoryEventStore } from '../store.js';

type ViewMode =
  | 'default'
  | 'heatmap'
  | 'dag'
  | 'replay'
  | 'errors'
  | 'digest'
  | 'collisions'
  | 'git'
  | 'narrative'
  | 'analytics'
  | 'transcript'
  | 'xref'
  | 'budget';

const transitions: Array<{ mode: Exclude<ViewMode, 'default'>; keys: string[] }> = [
  { mode: 'heatmap', keys: ['H', 'h'] },
  { mode: 'dag', keys: ['D', 'd'] },
  { mode: 'replay', keys: ['R'] },
  { mode: 'errors', keys: ['E', 'e'] },
  { mode: 'digest', keys: ['G', 'g'] },
  { mode: 'collisions', keys: ['C', 'c'] },
  { mode: 'git', keys: ['I'] },
  { mode: 'narrative', keys: ['N'] },
  { mode: 'analytics', keys: ['A'] },
  { mode: 'transcript', keys: ['T'] },
  { mode: 'xref', keys: ['X'] },
  { mode: 'budget', keys: ['B'] },
];

const panelForView: Record<Exclude<ViewMode, 'default'>, string> = {
  heatmap: 'fileHeatmap',
  dag: 'dependencyDag',
  replay: 'sessionReplay',
  errors: 'errorGroupPanel',
  digest: 'sessionDigest',
  collisions: 'collisionAlert',
  git: 'gitIntegration',
  narrative: 'semanticNarrativePanel',
  analytics: 'workerAnalyticsPanel',
  transcript: 'conversationTranscript',
  xref: 'crossReferencePanel',
  budget: 'budgetAlertPanel',
};

function getHandler(keys: string[]): () => void {
  const call = harness.screen.key.mock.calls.find(
    (entry: unknown[]) =>
      Array.isArray(entry[0]) &&
      (entry[0] as string[]).length === keys.length &&
      keys.every((key, index) => (entry[0] as string[])[index] === key)
  );
  if (!call) throw new Error(`No screen binding for [${keys.join(', ')}]`);
  return call[1] as () => void;
}

function panelIsVisible(app: FabricTuiApp, name: string): boolean {
  const panel = (app as unknown as Record<string, { visible: boolean; element: { visible: boolean } }>)[name];
  return name === 'fileHeatmap' || name === 'dependencyDag' || name === 'workerGrid' || name === 'activityStream'
    ? panel.element.visible
    : panel.visible;
}

function expectOnlyViewVisible(app: FabricTuiApp, expected: ViewMode): void {
  const visibleViews = transitions
    .filter(({ mode }) => panelIsVisible(app, panelForView[mode]))
    .map(({ mode }) => mode);
  const defaultVisible = panelIsVisible(app, 'workerGrid') && panelIsVisible(app, 'activityStream');

  expect(visibleViews.length + (defaultVisible ? 1 : 0)).toBe(1);
  expect(visibleViews, `mode=${(app as unknown as { viewMode: ViewMode }).viewMode} expected=${expected}`).toEqual(
    expected === 'default' ? [] : [expected]
  );
  expect(defaultVisible).toBe(expected === 'default');
  expect((app as unknown as { viewMode: ViewMode }).viewMode).toBe(expected);
}

describe('TUI navigation view state machine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes every documented view key and keeps all thirteen views mutually exclusive', () => {
    const app = new FabricTuiApp(new InMemoryEventStore());
    app.start();
    expectOnlyViewVisible(app, 'default');

    // Walk directly between overlays. This catches stale panels when one
    // overlay is entered from another instead of from the default view.
    for (const transition of transitions) {
      getHandler(transition.keys)();
      expectOnlyViewVisible(app, transition.mode);
    }

    // Return to default, then verify each view key toggles its own view off.
    getHandler(['escape'])();
    expectOnlyViewVisible(app, 'default');
    for (const transition of transitions) {
      getHandler(transition.keys)();
      expectOnlyViewVisible(app, transition.mode);
      getHandler(transition.keys)();
      expectOnlyViewVisible(app, 'default');
    }

    const escape = getHandler(['escape']);
    escape();
    expectOnlyViewVisible(app, 'default');
  });

  const detailViews = [
    { mode: 'errors' as const, panel: 'errorGroupPanel', key: ['E', 'e'], label: 'error-group' },
    { mode: 'narrative' as const, panel: 'semanticNarrativePanel', key: ['N'], label: 'narrative' },
    { mode: 'analytics' as const, panel: 'workerAnalyticsPanel', key: ['A'], label: 'analytics' },
  ];

  it.each(detailViews)(
    'opens the documented $label detail with Enter and closes it before the view',
    detail => {
      const app = new FabricTuiApp(new InMemoryEventStore());
      app.start();
      getHandler(detail.key)();

      const panel = (app as unknown as Record<string, {
        dispatchLocalKey: (key: string) => void;
        isDetailVisible: () => boolean;
      }>)[detail.panel];
      panel.dispatchLocalKey('enter');
      expect(panel.isDetailVisible()).toBe(true);

      // Blessed sends Escape to the screen first, then to the focused panel.
      // The screen handler must leave the view alone so the panel can close
      // its detail layer; only the following Escape steps back from the view.
      getHandler(['escape'])();
      expectOnlyViewVisible(app, detail.mode);
      expect(panel.isDetailVisible()).toBe(true);
      panel.dispatchLocalKey('escape');
      expect(panel.isDetailVisible()).toBe(false);

      getHandler(['escape'])();
      expectOnlyViewVisible(app, 'default');
    }
  );

  it('closes the palette before a detail layer and only then leaves the view', () => {
    const app = new FabricTuiApp(new InMemoryEventStore());
    app.start();
    getHandler(['N'])();

    const narrative = (app as unknown as Record<string, {
      dispatchLocalKey: (key: string) => void;
      isDetailVisible: () => boolean;
    }>).semanticNarrativePanel;
    const palette = (app as unknown as Record<string, {
      isVisible: () => boolean;
    }>).commandPalette;

    narrative.dispatchLocalKey('enter');
    getHandler(['C-k'])();
    expect(palette.isVisible()).toBe(true);
    expect(narrative.isDetailVisible()).toBe(true);

    // The palette has focus and is the topmost layer.
    getHandler(['escape'])();
    expect(palette.isVisible()).toBe(false);
    expect(narrative.isDetailVisible()).toBe(true);
    expectOnlyViewVisible(app, 'narrative');

    // The next Escape reaches the detail layer, not the full-screen view.
    getHandler(['escape'])();
    expectOnlyViewVisible(app, 'narrative');
    narrative.dispatchLocalKey('escape');
    expect(narrative.isDetailVisible()).toBe(false);

    getHandler(['escape'])();
    expectOnlyViewVisible(app, 'default');
  });
});
