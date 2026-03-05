/**
 * E2E Test: Keyboard Navigation
 *
 * Verifies that keyboard shortcuts work correctly:
 * - Tab switches panel focus
 * - j/k scrolls (via blessed vi mode)
 * - H shows heatmap view
 * - D shows DAG view
 * - E shows errors view
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import blessed from 'blessed';

// Mock process.exit before importing
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

// Mock blessed module with comprehensive mock elements
vi.mock('blessed', () => {
  const createMockElement = () => ({
    setContent: vi.fn(),
    setLabel: vi.fn(),
    getContent: vi.fn(() => ''),
    show: vi.fn(),
    hide: vi.fn(),
    focus: vi.fn(),
    key: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
    hidden: true,
    screen: {
      render: vi.fn(),
      destroy: vi.fn(),
      append: vi.fn(),
      key: vi.fn(),
      focusNext: vi.fn(),
      focusPrevious: vi.fn(),
    },
  });

  const mockBoxInstance = createMockElement();
  const mockLogInstance = {
    ...createMockElement(),
    log: vi.fn(),
  };

  const mockScreen = {
    render: vi.fn(),
    destroy: vi.fn(),
    append: vi.fn(),
    key: vi.fn(),
    focusNext: vi.fn(),
    focusPrevious: vi.fn(),
  };

  return {
    default: {
      screen: vi.fn(() => mockScreen),
      box: vi.fn(() => mockBoxInstance),
      log: vi.fn(() => mockLogInstance),
      textbox: vi.fn(() => mockBoxInstance),
      list: vi.fn(() => mockBoxInstance),
    },
    screen: vi.fn(() => mockScreen),
    box: vi.fn(() => mockBoxInstance),
    log: vi.fn(() => mockLogInstance),
    textbox: vi.fn(() => mockBoxInstance),
    list: vi.fn(() => mockBoxInstance),
  };
});

// Mock all components
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
  },
}));

vi.mock('./components/FileHeatmap.js', () => ({
  FileHeatmap: class {
    updateData = vi.fn();
    focus = vi.fn();
    getElement = vi.fn(() => ({ hide: vi.fn(), show: vi.fn(), screen: { render: vi.fn() } }));
    getSelected = vi.fn(() => null);
    getSortMode = vi.fn(() => 'modifications');
    getCollisionFilter = vi.fn(() => false);
  },
}));

vi.mock('./components/DependencyDag.js', () => ({
  DependencyDag: class {
    refresh = vi.fn();
    focus = vi.fn();
    getElement = vi.fn(() => ({ hide: vi.fn(), show: vi.fn(), screen: { render: vi.fn() } }));
    getGraph = vi.fn(() => null);
    getStats = vi.fn(() => null);
  },
}));

vi.mock('./components/SessionReplay.js', () => ({
  SessionReplay: class {
    loadEvents = vi.fn();
    show = vi.fn();
    hide = vi.fn();
    focus = vi.fn();
    getState = vi.fn(() => 'ready');
    getSpeed = vi.fn(() => 1);
    play = vi.fn();
    pause = vi.fn();
    reset = vi.fn();
  },
}));

vi.mock('./components/ErrorGroupPanel.js', () => ({
  ErrorGroupPanel: class {
    show = vi.fn();
    hide = vi.fn();
    focus = vi.fn();
    updateGroups = vi.fn();
  },
}));

vi.mock('./components/SessionDigest.js', () => ({
  SessionDigest: class {
    show = vi.fn();
    hide = vi.fn();
    focus = vi.fn();
    setDigest = vi.fn();
  },
  generateSessionDigest: vi.fn(() => ({
    sessionStart: Date.now(),
    sessionEnd: Date.now(),
    duration: 60000,
    totalWorkers: 0,
    totalBeadsCompleted: 0,
    totalFilesModified: 0,
    totalErrors: 0,
    topWorkers: [],
    beadTimeline: [],
    fileModifications: [],
    errorSummary: [],
    workerSummaries: [],
  })),
}));

vi.mock('./components/CollisionAlert.js', () => ({
  CollisionAlert: class {
    show = vi.fn();
    hide = vi.fn();
    updateAlerts = vi.fn();
  },
}));

vi.mock('./components/GitIntegration.js', () => ({
  GitIntegration: class {
    show = vi.fn();
    hide = vi.fn();
    focus = vi.fn();
    updateGitEvents = vi.fn();
  },
}));

vi.mock('./components/SemanticNarrativePanel.js', () => ({
  SemanticNarrativePanel: class {
    show = vi.fn();
    hide = vi.fn();
    focus = vi.fn();
    updateAggregated = vi.fn();
  },
}));

vi.mock('./components/WorkerAnalyticsPanel.js', () => ({
  WorkerAnalyticsPanel: class {
    show = vi.fn();
    hide = vi.fn();
    focus = vi.fn();
    setMetrics = vi.fn();
  },
}));

// Import after mocking
import { FabricTuiApp } from './app.js';
import { InMemoryEventStore } from '../store.js';
import { LogEvent } from '../types.js';

// Helper functions
function createMockStore(): InMemoryEventStore {
  return new InMemoryEventStore();
}

function createMockEvent(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    ts: Date.now(),
    worker: 'w-test123',
    level: 'info',
    msg: 'Test event message',
    ...overrides,
  };
}

function getMockScreen() {
  return (blessed.screen as Mock)();
}

function getKeyHandler(mockScreen: any, keyBinding: string | string[]): (() => void) | undefined {
  const keyBindings = Array.isArray(keyBinding) ? keyBinding : [keyBinding];

  const keyCall = mockScreen.key.mock.calls.find(
    (call: unknown[]) => {
      if (!Array.isArray(call?.[0])) return false;
      const callKeys = call[0] as string[];
      return keyBindings.some(key => callKeys.includes(key));
    }
  );

  return keyCall?.[1] as (() => void) | undefined;
}

describe('E2E: Keyboard Navigation', () => {
  let store: InMemoryEventStore;
  let app: FabricTuiApp;
  let mockScreen: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit.mockClear();
    store = createMockStore();
    app = new FabricTuiApp(store);
    app.start();
    mockScreen = getMockScreen();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Tab Navigation', () => {
    it('should focus next element when Tab is pressed', () => {
      const tabHandler = getKeyHandler(mockScreen, 'tab');
      expect(tabHandler).toBeDefined();

      tabHandler!();

      expect(mockScreen.focusNext).toHaveBeenCalled();
    });

    it('should focus previous element when Shift+Tab is pressed', () => {
      const stabHandler = getKeyHandler(mockScreen, 'S-tab');
      expect(stabHandler).toBeDefined();

      stabHandler!();

      expect(mockScreen.focusPrevious).toHaveBeenCalled();
    });

    it('should cycle through multiple tab presses', () => {
      const tabHandler = getKeyHandler(mockScreen, 'tab');
      expect(tabHandler).toBeDefined();

      // Press tab multiple times
      tabHandler!();
      tabHandler!();
      tabHandler!();

      expect(mockScreen.focusNext).toHaveBeenCalledTimes(3);
    });

    it('should reverse cycle with shift+tab', () => {
      const tabHandler = getKeyHandler(mockScreen, 'tab');
      const stabHandler = getKeyHandler(mockScreen, 'S-tab');
      expect(tabHandler).toBeDefined();
      expect(stabHandler).toBeDefined();

      // Move forward then backward
      tabHandler!();
      stabHandler!();

      expect(mockScreen.focusNext).toHaveBeenCalledTimes(1);
      expect(mockScreen.focusPrevious).toHaveBeenCalledTimes(1);
    });
  });

  describe('j/k Scrolling', () => {
    it('should enable vi mode for ActivityStream with j/k keys', () => {
      // ActivityStream is created with vi: true, which enables j/k scrolling
      // This is built into blessed, so we verify the component was created with vi mode
      const blessedMock = blessed as unknown as { log: Mock };

      // Check that blessed.log was called with vi: true
      const logCalls = blessedMock.log.mock.calls;
      const viEnabledCall = logCalls.find((call: any[]) => call[0]?.vi === true);

      expect(viEnabledCall).toBeDefined();
      expect(viEnabledCall?.[0]?.vi).toBe(true);
      expect(viEnabledCall?.[0]?.keys).toBe(true);
      expect(viEnabledCall?.[0]?.scrollable).toBe(true);
    });

    it('should create ActivityStream with scrollable options', () => {
      const blessedMock = blessed as unknown as { log: Mock };

      // Verify ActivityStream was created with proper scrolling options
      const logCalls = blessedMock.log.mock.calls;
      const scrollableCall = logCalls.find((call: any[]) => call[0]?.scrollable === true);

      expect(scrollableCall).toBeDefined();
      expect(scrollableCall?.[0]?.scrollable).toBe(true);
      expect(scrollableCall?.[0]?.alwaysScroll).toBe(true);
    });
  });

  describe('View Mode Navigation', () => {
    it('should show heatmap view when H is pressed', () => {
      const hHandler = getKeyHandler(mockScreen, 'H');
      expect(hHandler).toBeDefined();

      // Initially should not throw
      expect(() => hHandler!()).not.toThrow();

      // Screen should be rendered
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should show DAG view when D is pressed', () => {
      const dHandler = getKeyHandler(mockScreen, 'D');
      expect(dHandler).toBeDefined();

      expect(() => dHandler!()).not.toThrow();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should show errors view when E is pressed', () => {
      const eHandler = getKeyHandler(mockScreen, 'E');
      expect(eHandler).toBeDefined();

      expect(() => eHandler!()).not.toThrow();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should toggle heatmap view on/off with repeated H presses', () => {
      const hHandler = getKeyHandler(mockScreen, 'H');
      expect(hHandler).toBeDefined();

      // First press - show heatmap
      vi.clearAllMocks();
      hHandler!();
      expect(mockScreen.render).toHaveBeenCalled();

      // Second press - hide heatmap (return to default)
      vi.clearAllMocks();
      hHandler!();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should toggle DAG view on/off with repeated D presses', () => {
      const dHandler = getKeyHandler(mockScreen, 'D');
      expect(dHandler).toBeDefined();

      // First press - show DAG
      vi.clearAllMocks();
      dHandler!();
      expect(mockScreen.render).toHaveBeenCalled();

      // Second press - hide DAG (return to default)
      vi.clearAllMocks();
      dHandler!();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should toggle errors view on/off with repeated E presses', () => {
      const eHandler = getKeyHandler(mockScreen, 'E');
      expect(eHandler).toBeDefined();

      // First press - show errors
      vi.clearAllMocks();
      eHandler!();
      expect(mockScreen.render).toHaveBeenCalled();

      // Second press - hide errors (return to default)
      vi.clearAllMocks();
      eHandler!();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should switch between different views', () => {
      const hHandler = getKeyHandler(mockScreen, 'H');
      const dHandler = getKeyHandler(mockScreen, 'D');
      const eHandler = getKeyHandler(mockScreen, 'E');

      expect(hHandler).toBeDefined();
      expect(dHandler).toBeDefined();
      expect(eHandler).toBeDefined();

      // Switch between multiple views
      expect(() => {
        hHandler!(); // Show heatmap
        dHandler!(); // Switch to DAG
        eHandler!(); // Switch to errors
      }).not.toThrow();

      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should return to default view with Escape key', () => {
      const hHandler = getKeyHandler(mockScreen, 'H');
      const escHandler = getKeyHandler(mockScreen, 'escape');

      expect(hHandler).toBeDefined();
      expect(escHandler).toBeDefined();

      // Show heatmap
      hHandler!();

      // Press escape to return to default
      vi.clearAllMocks();
      escHandler!();

      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should do nothing when Escape pressed in default view', () => {
      const escHandler = getKeyHandler(mockScreen, 'escape');
      expect(escHandler).toBeDefined();

      vi.clearAllMocks();

      // Press escape in default view (should do nothing)
      escHandler!();

      // render might not be called since view didn't change
      // Just verify it doesn't throw
      expect(() => escHandler!()).not.toThrow();
    });
  });

  describe('Complete Keyboard Navigation Workflow', () => {
    it('should handle realistic navigation sequence', () => {
      const tabHandler = getKeyHandler(mockScreen, 'tab');
      const hHandler = getKeyHandler(mockScreen, 'H');
      const dHandler = getKeyHandler(mockScreen, 'D');
      const eHandler = getKeyHandler(mockScreen, 'E');
      const escHandler = getKeyHandler(mockScreen, 'escape');

      // Realistic user workflow
      expect(() => {
        // User tabs through panels
        tabHandler!();
        tabHandler!();

        // User opens heatmap
        hHandler!();

        // User tabs in heatmap view
        tabHandler!();

        // User switches to DAG view
        dHandler!();

        // User switches to errors view
        eHandler!();

        // User returns to default
        escHandler!();

        // User continues tabbing
        tabHandler!();
      }).not.toThrow();

      // Verify navigation methods were called
      expect(mockScreen.focusNext).toHaveBeenCalled();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should handle rapid keyboard input', () => {
      const tabHandler = getKeyHandler(mockScreen, 'tab');
      const hHandler = getKeyHandler(mockScreen, 'H');
      const dHandler = getKeyHandler(mockScreen, 'D');
      const eHandler = getKeyHandler(mockScreen, 'E');

      // Rapid key presses
      expect(() => {
        for (let i = 0; i < 10; i++) {
          tabHandler!();
          hHandler!();
          dHandler!();
          eHandler!();
        }
      }).not.toThrow();
    });

    it('should maintain state across view switches', () => {
      // Add events to store
      store.add(createMockEvent({ msg: 'Event 1' }));
      store.add(createMockEvent({ msg: 'Event 2' }));

      const hHandler = getKeyHandler(mockScreen, 'H');
      const escHandler = getKeyHandler(mockScreen, 'escape');

      // Switch views
      hHandler!();
      escHandler!();

      // Events should still be in store
      expect(store.query().length).toBe(2);
    });

    it('should work with events being added during navigation', () => {
      const tabHandler = getKeyHandler(mockScreen, 'tab');
      const hHandler = getKeyHandler(mockScreen, 'H');

      // Navigate while adding events
      expect(() => {
        tabHandler!();
        app.addEvent(createMockEvent({ msg: 'Event during tab' }));

        hHandler!();
        app.addEvent(createMockEvent({ msg: 'Event during heatmap' }));

        tabHandler!();
        app.addEvent(createMockEvent({ msg: 'Event during second tab' }));
      }).not.toThrow();

      // All events should be in store
      expect(store.query().length).toBe(3);
    });
  });

  describe('Additional Navigation Keys', () => {
    it('should handle refresh key (r)', () => {
      const rHandler = getKeyHandler(mockScreen, 'r');
      expect(rHandler).toBeDefined();

      vi.clearAllMocks();
      rHandler!();

      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should toggle help with ?', () => {
      const helpHandler = getKeyHandler(mockScreen, '?');
      expect(helpHandler).toBeDefined();

      expect(() => {
        helpHandler!();
        helpHandler!();
      }).not.toThrow();
    });

    it('should open command palette with Ctrl+K', () => {
      const ckHandler = getKeyHandler(mockScreen, 'C-k');
      expect(ckHandler).toBeDefined();

      expect(() => ckHandler!()).not.toThrow();
    });

    it('should handle collision view (C key)', () => {
      const cHandler = getKeyHandler(mockScreen, 'C');
      expect(cHandler).toBeDefined();

      expect(() => cHandler!()).not.toThrow();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should handle git integration view (I key)', () => {
      const iHandler = getKeyHandler(mockScreen, 'I');
      expect(iHandler).toBeDefined();

      expect(() => iHandler!()).not.toThrow();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should handle narrative view (N key)', () => {
      const nHandler = getKeyHandler(mockScreen, 'N');
      expect(nHandler).toBeDefined();

      expect(() => nHandler!()).not.toThrow();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should handle analytics view (A key)', () => {
      const aHandler = getKeyHandler(mockScreen, 'A');
      expect(aHandler).toBeDefined();

      expect(() => aHandler!()).not.toThrow();
      expect(mockScreen.render).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle keyboard input with empty store', () => {
      const emptyStore = createMockStore();
      const emptyApp = new FabricTuiApp(emptyStore);
      emptyApp.start();

      const emptyScreen = getMockScreen();
      const tabHandler = getKeyHandler(emptyScreen, 'tab');
      const hHandler = getKeyHandler(emptyScreen, 'H');

      expect(() => {
        tabHandler!();
        hHandler!();
      }).not.toThrow();
    });

    it('should handle keyboard input before app start', () => {
      const newStore = createMockStore();
      const newApp = new FabricTuiApp(newStore);

      // Try to get handlers before start - should still be bound
      expect(() => newApp.render()).not.toThrow();
    });

    it('should handle invalid key sequences gracefully', () => {
      // All handlers should not throw even with unusual sequences
      const handlers = [
        getKeyHandler(mockScreen, 'tab'),
        getKeyHandler(mockScreen, 'H'),
        getKeyHandler(mockScreen, 'D'),
        getKeyHandler(mockScreen, 'E'),
        getKeyHandler(mockScreen, 'escape'),
      ].filter(h => h !== undefined) as (() => void)[];

      expect(() => {
        // Random sequence of keypresses
        handlers.forEach(h => h());
        handlers.reverse().forEach(h => h());
        handlers.forEach(h => h());
      }).not.toThrow();
    });
  });
});
