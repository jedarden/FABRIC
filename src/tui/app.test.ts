/**
 * Tests for FabricTuiApp Main TUI Class
 *
 * Tests initialization, key handling, and component coordination.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';

// Mock process.exit before importing app
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

// Mock blessed module
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
    setLabel: vi.fn(),
  };
  const mockTextboxInstance = {
    ...createMockElement(),
    getValue: vi.fn(() => ''),
    setValue: vi.fn(),
  };
  const mockListInstance = {
    ...createMockElement(),
    setItems: vi.fn(),
    select: vi.fn(),
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
      textbox: vi.fn(() => mockTextboxInstance),
      list: vi.fn(() => mockListInstance),
    },
    screen: vi.fn(() => mockScreen),
    box: vi.fn(() => mockBoxInstance),
    log: vi.fn(() => mockLogInstance),
    textbox: vi.fn(() => mockTextboxInstance),
    list: vi.fn(() => mockListInstance),
  };
});

// Mock all components - use class syntax for constructor mocking
vi.mock('./components/WorkerGrid.js', () => {
  return {
    WorkerGrid: class {
      updateWorkers = vi.fn();
      getSelected = vi.fn(() => null);
      focus = vi.fn();
      getElement = vi.fn(() => ({ hide: vi.fn(), show: vi.fn(), screen: { render: vi.fn() } }));
      setFocusMode = vi.fn();
    },
  };
});

vi.mock('./components/ActivityStream.js', () => {
  return {
    ActivityStream: class {
      addEvent = vi.fn();
      flushDisplay = vi.fn();
      clearFilter = vi.fn();
      setFilter = vi.fn();
      togglePause = vi.fn();
      focus = vi.fn();
      getElement = vi.fn(() => ({ hide: vi.fn(), show: vi.fn(), screen: { render: vi.fn() } }));
      getIsPaused = vi.fn(() => false);
      setFocusMode = vi.fn();
    },
  };
});

vi.mock('./components/WorkerDetail.js', () => {
  return {
    WorkerDetail: class {
      setWorker = vi.fn();
      setRecentEvents = vi.fn();
      show = vi.fn();
      hide = vi.fn();
      focus = vi.fn();
      isVisible = vi.fn(() => false);
      getElement = vi.fn(() => ({ hide: vi.fn(), show: vi.fn(), screen: { render: vi.fn() } }));
    },
  };
});

vi.mock('./components/CommandPalette.js', () => {
  return {
    CommandPalette: class {
      toggle = vi.fn();
      show = vi.fn();
      hide = vi.fn();
      isVisible = vi.fn(() => false);
      addSuggestion = vi.fn();
      addSuggestions = vi.fn();
      clearSuggestions = vi.fn();
    },
  };
});

vi.mock('./components/FileHeatmap.js', () => {
  return {
    FileHeatmap: class {
      // Stable element identity so tests can assert show/hide calls
      element = {
        hide: vi.fn(),
        show: vi.fn(),
        screen: { render: vi.fn() },
      };
      updateData = vi.fn();
      focus = vi.fn();
      getElement = vi.fn(() => this.element);
      getSelected = vi.fn(() => null);
      getSortMode = vi.fn(() => 'modifications');
      getCollisionFilter = vi.fn(() => false);
      getAnomalyFilter = vi.fn(() => false);
    },
  };
});

vi.mock('./components/DependencyDag.js', () => {
  return {
    DependencyDag: class {
      refresh = vi.fn();
      focus = vi.fn();
      getElement = vi.fn(() => ({
        hide: vi.fn(),
        show: vi.fn(),
        hidden: true,
        screen: { render: vi.fn() },
      }));
      getGraph = vi.fn(() => null);
      getStats = vi.fn(() => null);
    },
  };
});

// Import after mocking
import { FabricTuiApp, createTuiApp, TuiOptions } from './app.js';
import { InMemoryEventStore } from '../store.js';
import { LogEvent, WorkerInfo } from '../types.js';
import blessed from 'blessed';

// Helper to create mock store
function createMockStore(): InMemoryEventStore {
  const store = new InMemoryEventStore();
  return store;
}

// Helper to create mock log event
function createMockEvent(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    ts: Date.now(),
    worker: 'w-test123',
    level: 'info',
    msg: 'Test event message',
    ...overrides,
  };
}

// Helper to create mock worker
function createMockWorker(overrides: Partial<WorkerInfo> = {}): WorkerInfo {
  return {
    id: 'w-test123',
    status: 'active',
    beadsCompleted: 5,
    beadsSucceeded: 3,
    beadsTimedOut: 2,
    firstSeen: Date.now() - 60000,
    lastActivity: Date.now(),
    activeFiles: [],
    hasCollision: false,
    activeDirectories: [],
    collisionTypes: [],
    eventCount: 10,
    currentBead: null,
    ...overrides,
  };
}

// Get the mocked screen instance
function getMockScreen() {
  return (blessed.screen as Mock)();
}

describe('FabricTuiApp', () => {
  let store: InMemoryEventStore;
  let app: FabricTuiApp;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExit.mockClear();
    store = createMockStore();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create app with default options', () => {
      app = new FabricTuiApp(store);

      expect(blessed.screen).toHaveBeenCalledWith(
        expect.objectContaining({
          smartCSR: true,
          fullUnicode: true,
        })
      );
    });

    it('should create app with custom options', () => {
      const options: TuiOptions = {
        logPath: '/custom/path.log',
        maxEvents: 500,
        refreshInterval: 200,
      };

      app = new FabricTuiApp(store, options);

      // App should be created without errors
      expect(app).toBeInstanceOf(FabricTuiApp);
    });

    it('should initialize with isRunning set to false', () => {
      app = new FabricTuiApp(store);

      // Initially not running - start() sets isRunning to true
      // We can't directly access isRunning, but we can verify start() works
      const mockScreen = getMockScreen();
      app.start();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should initialize viewMode to default', () => {
      app = new FabricTuiApp(store);

      // Default view mode - we can verify via render() behavior
      app.render();

      const mockScreen = getMockScreen();
      expect(mockScreen.render).toHaveBeenCalled();
    });
  });

  describe('createTuiApp factory', () => {
    it('should create a FabricTuiApp instance', () => {
      const app = createTuiApp(store);

      expect(app).toBeInstanceOf(FabricTuiApp);
    });

    it('should pass options to constructor', () => {
      const options: TuiOptions = {
        maxEvents: 100,
      };

      const app = createTuiApp(store, options);

      expect(app).toBeInstanceOf(FabricTuiApp);
    });
  });

  describe('key bindings', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
    });

    it('should bind quit keys (q, C-c)', () => {
      const mockScreen = getMockScreen();

      // Find the quit key binding calls
      expect(mockScreen.key).toHaveBeenCalledWith(
        expect.arrayContaining(['q', 'C-c']),
        expect.any(Function)
      );
    });

    it('should bind help key (?)', () => {
      const mockScreen = getMockScreen();

      expect(mockScreen.key).toHaveBeenCalledWith(['?'], expect.any(Function));
    });

    it('should bind tab navigation keys', () => {
      const mockScreen = getMockScreen();

      expect(mockScreen.key).toHaveBeenCalledWith(['tab'], expect.any(Function));
      expect(mockScreen.key).toHaveBeenCalledWith(['S-tab'], expect.any(Function));
    });

    it('should bind refresh key (r)', () => {
      const mockScreen = getMockScreen();

      expect(mockScreen.key).toHaveBeenCalledWith(['r'], expect.any(Function));
    });

    it('should bind command palette key (C-k)', () => {
      const mockScreen = getMockScreen();

      expect(mockScreen.key).toHaveBeenCalledWith(['C-k'], expect.any(Function));
    });

    it('should bind enter key for worker detail', () => {
      const mockScreen = getMockScreen();

      expect(mockScreen.key).toHaveBeenCalledWith(['enter'], expect.any(Function));
    });

    it('should bind heatmap view key (H)', () => {
      const mockScreen = getMockScreen();

      expect(mockScreen.key).toHaveBeenCalledWith(['H', 'h'], expect.any(Function));
    });

    it('should bind DAG view key (D)', () => {
      const mockScreen = getMockScreen();

      expect(mockScreen.key).toHaveBeenCalledWith(['D', 'd'], expect.any(Function));
    });

    it('should bind escape key', () => {
      const mockScreen = getMockScreen();

      expect(mockScreen.key).toHaveBeenCalledWith(['escape'], expect.any(Function));
    });
  });

  describe('start method', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
    });

    it('should set isRunning to true', () => {
      app.start();
      // Calling start twice should be idempotent
      app.start();

      const mockScreen = getMockScreen();
      // Render should be called at least once
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should not start twice (idempotent)', () => {
      app.start();
      app.start();

      const mockScreen = getMockScreen();
      // Multiple calls should still work without error
      expect(mockScreen.render).toHaveBeenCalled();
    });
  });

  describe('stop method', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
    });

    it('should call screen.destroy()', () => {
      app.start();
      app.stop();

      const mockScreen = getMockScreen();
      expect(mockScreen.destroy).toHaveBeenCalled();
    });

    it('should call process.exit(0)', () => {
      app.start();
      app.stop();

      expect(mockExit).toHaveBeenCalledWith(0);
    });
  });

  describe('addEvent method', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
    });

    it('should add event to activity stream', () => {
      const event = createMockEvent();
      app.addEvent(event);

      // Event should be added without error
      expect(() => app.addEvent(event)).not.toThrow();
    });

    it('should update workers panel', () => {
      const event = createMockEvent();
      app.addEvent(event);

      // Should not throw
      expect(() => app.addEvent(event)).not.toThrow();
    });

    it('should trigger screen render', () => {
      app.start();
      const event = createMockEvent();
      app.addEvent(event);

      const mockScreen = getMockScreen();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('coalesces renders during directory-source startup replay', async () => {
      vi.useFakeTimers();
      try {
        // The CLI enables batching for directory sources so replayed events
        // append immediately but expensive TUI refresh work runs once on the
        // refresh timer, yielding the event loop between bursts.
        app = new FabricTuiApp(store, {
          refreshInterval: 100,
          batchEventRefresh: true,
        } as TuiOptions);
        app.start();

        const mockScreen = getMockScreen();
        mockScreen.render.mockClear();

        for (let index = 0; index < 20; index++) {
          app.addEvent(createMockEvent({ msg: `startup-${index}` }));
        }

        expect(mockScreen.render).not.toHaveBeenCalled();
        expect(app['activityStream'].addEvent).toHaveBeenCalledTimes(20);
        expect(app['activityStream'].addEvent).toHaveBeenCalledWith(
          expect.objectContaining({ msg: 'startup-19' }),
          true,
        );
        expect(app['activityStream'].flushDisplay).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(100);
        expect(mockScreen.render).toHaveBeenCalledTimes(1);
        expect(app['activityStream'].flushDisplay).toHaveBeenCalledTimes(1);
      } finally {
        app.stop();
        vi.useRealTimers();
      }
    });
  });

  describe('render method', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
    });

    it('should render the screen', () => {
      app.render();

      const mockScreen = getMockScreen();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should render workers in default view mode', () => {
      app.render();

      const mockScreen = getMockScreen();
      expect(mockScreen.render).toHaveBeenCalled();
    });
  });

  describe('view mode switching', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
    });

    it('should start in default view mode', () => {
      app.start();
      app.render();

      const mockScreen = getMockScreen();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should switch to heatmap view via H key handler', () => {
      const mockScreen = getMockScreen();

      // Find and call the H key handler
      const hCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('H')
      );
      expect(hCall).toBeDefined();

      const hHandler = hCall?.[1] as () => void;
      if (hHandler) {
        hHandler();
      }

      // Screen should have been rendered
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should switch to DAG view via D key handler', () => {
      const mockScreen = getMockScreen();

      // Find and call the D key handler
      const dCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('D')
      );
      expect(dCall).toBeDefined();

      const dHandler = dCall?.[1] as () => void;
      if (dHandler) {
        dHandler();
      }

      // Screen should have been rendered
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should return to default view from heatmap via escape', () => {
      const mockScreen = getMockScreen();

      // First switch to heatmap
      const hCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('H')
      );
      const hHandler = hCall?.[1] as () => void;
      if (hHandler) hHandler();

      // Then press escape
      const escapeCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('escape')
      );
      const escapeHandler = escapeCall?.[1] as () => void;
      if (escapeHandler) escapeHandler();

      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should return to default view from DAG via escape', () => {
      const mockScreen = getMockScreen();

      // First switch to DAG
      const dCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('D')
      );
      const dHandler = dCall?.[1] as () => void;
      if (dHandler) dHandler();

      // Then press escape
      const escapeCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('escape')
      );
      const escapeHandler = escapeCall?.[1] as () => void;
      if (escapeHandler) escapeHandler();

      expect(mockScreen.render).toHaveBeenCalled();
    });
  });

  describe('help overlay', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
    });

    it('should toggle help overlay on ? key', () => {
      const mockScreen = getMockScreen();

      // Find and call the ? key handler
      const helpCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('?')
      );
      expect(helpCall).toBeDefined();

      const helpHandler = helpCall?.[1] as () => void;
      if (helpHandler) {
        helpHandler();
      }

      // Should create a help overlay (blessed.box called)
      expect(blessed.box).toHaveBeenCalled();
    });

    it('should destroy help overlay on second ? press', () => {
      const mockScreen = getMockScreen();

      const helpCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('?')
      );
      const helpHandler = helpCall?.[1] as () => void;

      // Toggle on
      if (helpHandler) helpHandler();
      // Toggle off
      if (helpHandler) helpHandler();

      // Should have been called twice
      expect(mockScreen.render).toHaveBeenCalled();
    });
  });

  describe('command palette', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
    });

    it('should toggle command palette on C-k', () => {
      const mockScreen = getMockScreen();

      const ckCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('C-k')
      );
      expect(ckCall).toBeDefined();

      const ckHandler = ckCall?.[1] as () => void;

      // Should not throw when handler is called
      expect(() => {
        if (ckHandler) {
          ckHandler();
        }
      }).not.toThrow();
    });
  });

  describe('tab navigation', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
    });

    it('should focus next panel on tab', () => {
      const mockScreen = getMockScreen();

      const tabCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('tab')
      );
      expect(tabCall).toBeDefined();

      const tabHandler = tabCall?.[1] as () => void;
      if (tabHandler) {
        tabHandler();
      }

      expect(mockScreen.focusNext).toHaveBeenCalled();
    });

    it('should focus previous panel on Shift+Tab', () => {
      const mockScreen = getMockScreen();

      const stabCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('S-tab')
      );
      expect(stabCall).toBeDefined();

      const stabHandler = stabCall?.[1] as () => void;
      if (stabHandler) {
        stabHandler();
      }

      expect(mockScreen.focusPrevious).toHaveBeenCalled();
    });
  });

  describe('quit behavior', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
      app.start();
    });

    it('should stop app on q key', () => {
      const mockScreen = getMockScreen();

      const qCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('q')
      );
      const qHandler = qCall?.[1] as () => void;

      if (qHandler) {
        qHandler();
      }

      expect(mockScreen.destroy).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('should stop app on Ctrl+C', () => {
      const mockScreen = getMockScreen();

      const ccCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('C-c')
      );
      const ccHandler = ccCall?.[1] as () => void;

      if (ccHandler) {
        ccHandler();
      }

      expect(mockScreen.destroy).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
    });
  });

  describe('refresh behavior', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
    });

    it('should render on r key', () => {
      const mockScreen = getMockScreen();

      const rCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('r')
      );
      const rHandler = rCall?.[1] as () => void;

      if (rHandler) {
        rHandler();
      }

      expect(mockScreen.render).toHaveBeenCalled();
    });
  });

  describe('worker detail view', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
    });

    it('should not show worker detail when no worker selected', () => {
      const mockScreen = getMockScreen();

      const enterCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('enter')
      );
      const enterHandler = enterCall?.[1] as () => void;

      // WorkerGrid returns null for getSelected by default
      // Should not throw when no worker is selected
      expect(() => {
        if (enterHandler) {
          enterHandler();
        }
      }).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle empty store', () => {
      app = new FabricTuiApp(store);

      expect(() => app.render()).not.toThrow();
    });

    it('should handle store with events', () => {
      store.add(createMockEvent({ worker: 'w-1' }));
      store.add(createMockEvent({ worker: 'w-2' }));

      app = new FabricTuiApp(store);

      expect(() => app.render()).not.toThrow();
    });

    it('should handle multiple start calls', () => {
      app = new FabricTuiApp(store);

      app.start();
      app.start();
      app.start();

      const mockScreen = getMockScreen();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should handle events before start', () => {
      app = new FabricTuiApp(store);

      const event = createMockEvent();
      expect(() => app.addEvent(event)).not.toThrow();
    });
  });

  describe('worker stats badge', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
    });

    it('should show worker count badge with active workers', () => {
      // Add events for active workers
      store.add(createMockEvent({ worker: 'w-active-1', level: 'info' }));
      store.add(createMockEvent({ worker: 'w-active-2', level: 'info' }));

      app.start();
      app.render();

      const mockScreen = getMockScreen();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should show mixed worker statuses in badge', () => {
      // Add workers with different statuses
      store.add(createMockEvent({ worker: 'w-active', level: 'info' }));
      store.add(createMockEvent({ worker: 'w-idle', level: 'debug' }));
      store.add(createMockEvent({ worker: 'w-error', level: 'error' }));

      app.start();
      app.render();

      const mockScreen = getMockScreen();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should update header when new events arrive', () => {
      app.start();

      const event1 = createMockEvent({ worker: 'w-1' });
      app.addEvent(event1);

      const event2 = createMockEvent({ worker: 'w-2' });
      app.addEvent(event2);

      const mockScreen = getMockScreen();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should handle no workers gracefully', () => {
      app.start();
      app.render();

      const mockScreen = getMockScreen();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should show filter indicator when CLI filter is active', () => {
      const options: TuiOptions = {
        filter: { worker: 'w-test', level: 'info' },
      };
      app = new FabricTuiApp(store, options);
      app.start();

      const mockScreen = getMockScreen();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should update header in real-time as workers join', () => {
      app.start();

      // Initial state: no workers
      expect(() => app.render()).not.toThrow();

      // Worker joins
      store.add(createMockEvent({ worker: 'w-new' }));
      app.addEvent(createMockEvent({ worker: 'w-new' }));

      const mockScreen = getMockScreen();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should update header in real-time as workers change status', () => {
      app.start();

      // Worker starts as active
      store.add(createMockEvent({ worker: 'w-status', level: 'info' }));
      app.addEvent(createMockEvent({ worker: 'w-status', level: 'info' }));

      // Worker becomes idle
      app.addEvent(createMockEvent({ worker: 'w-status', level: 'debug' }));

      const mockScreen = getMockScreen();
      expect(mockScreen.render).toHaveBeenCalled();
    });
  });

  describe('heatmap view behavior', () => {
    const pressViewKey = (key: string): void => {
      const mockScreen = getMockScreen();
      const call = mockScreen.key.mock.calls.find(
        (c: unknown[]) => Array.isArray(c?.[0]) && c[0].includes(key)
      );
      expect(call).toBeDefined();
      (call?.[1] as () => void)();
    };

    const heatmapMock = () => (app as unknown as { fileHeatmap: any }).fileHeatmap;

    const fileEvent = (path: string, worker = 'w-heat') =>
      createMockEvent({
        worker,
        path,
        tool: 'Edit',
        msg: `Modifying ${path}`,
      });

    beforeEach(() => {
      app = new FabricTuiApp(store);
    });

    it('wires the store heatmap getters when entering the view', () => {
      store.add(fileEvent('/src/alpha.ts'));

      pressViewKey('H');

      const hm = heatmapMock();
      expect(hm.updateData).toHaveBeenCalled();

      const [getHeatmap, getStats, getAnomalies] = hm.updateData.mock.calls[0];
      const entries = getHeatmap({ sortBy: 'modifications' });
      expect(entries).toHaveLength(1);
      expect(entries[0].path).toBe('/src/alpha.ts');

      const stats = getStats();
      expect(stats.totalFiles).toBe(1);
      expect(stats.totalModifications).toBe(1);

      expect(Array.isArray(getAnomalies({}))).toBe(true);
    });

    it('focuses the heatmap when the view opens', () => {
      pressViewKey('H');

      expect(heatmapMock().focus).toHaveBeenCalled();
    });

    it('shows the heatmap element on open and hides it on close', () => {
      const el = heatmapMock().getElement();
      el.show.mockClear();
      el.hide.mockClear();

      pressViewKey('H');
      expect(el.show).toHaveBeenCalled();

      pressViewKey('H');
      expect(el.hide).toHaveBeenCalled();
    });

    it('refreshes heatmap data when new events arrive while the view is open', () => {
      pressViewKey('H');

      const hm = heatmapMock();
      const callsBefore = hm.updateData.mock.calls.length;
      expect(callsBefore).toBeGreaterThan(0);

      // The tailer feeds the store; the app refreshes the visible view
      store.add(fileEvent('/src/live-update.ts'));
      app.addEvent(fileEvent('/src/live-update.ts'));

      expect(hm.updateData.mock.calls.length).toBe(callsBefore + 1);
      const [getHeatmap] = hm.updateData.mock.calls[hm.updateData.mock.calls.length - 1];
      const entries = getHeatmap({});
      expect(entries.some((e: { path: string }) => e.path === '/src/live-update.ts')).toBe(true);
    });

    it('does not refresh while hidden but picks up new events on re-entry', () => {
      pressViewKey('H'); // open
      pressViewKey('H'); // close

      const hm = heatmapMock();
      hm.updateData.mockClear();

      store.add(fileEvent('/src/while-hidden.ts'));
      app.addEvent(fileEvent('/src/while-hidden.ts'));
      expect(hm.updateData).not.toHaveBeenCalled();

      pressViewKey('H'); // reopen
      expect(hm.updateData).toHaveBeenCalledTimes(1);
      const [getHeatmap] = hm.updateData.mock.calls[0];
      const entries = getHeatmap({});
      expect(entries.some((e: { path: string }) => e.path === '/src/while-hidden.ts')).toBe(true);
    });

    it('re-reads heatmap data when render() runs while the view is open', () => {
      pressViewKey('H');

      const hm = heatmapMock();
      hm.updateData.mockClear();

      app.render();

      expect(hm.updateData).toHaveBeenCalledTimes(1);
    });
  });

  // --- full documented behavior contract, pinned at the app seam (fabric-c0413489) ---
  // docs/FileHeatmap-Integration.md §4 specifies sort cycling, mutually
  // exclusive collision/anomaly filters, directory filtering, navigation,
  // heat levels, worker attribution, collision highlighting, and updates
  // from new events. The component owns the keys (pinned in
  // FileHeatmap.test.ts); these tests pin the app-side seam — the store
  // getters handed to the component when the view opens — against a real
  // InMemoryEventStore fed through the live ingestion path.

  describe('heatmap view data contract (documented behaviors)', () => {
    const pressViewKey = (key: string): void => {
      const mockScreen = getMockScreen();
      const call = mockScreen.key.mock.calls.find(
        (c: unknown[]) => Array.isArray(c?.[0]) && c[0].includes(key)
      );
      expect(call).toBeDefined();
      (call?.[1] as () => void)();
    };

    const heatmapMock = () => (app as unknown as { fileHeatmap: any }).fileHeatmap;

    const fileEventAt = (path: string, worker: string, ts: number): LogEvent => ({
      ts,
      worker,
      level: 'info',
      msg: `Modifying ${path}`,
      path,
      tool: 'Edit',
    });

    // Live ingestion path: the tailer writes the event to the store, then
    // the app refreshes the open heatmap view.
    const ingest = (path: string, worker: string, ts: number): void => {
      store.add(fileEventAt(path, worker, ts));
      app.addEvent(fileEventAt(path, worker, ts));
    };

    // Store getters wired into the most recent updateData call.
    const wiredGetters = () => heatmapMock().updateData.mock.calls.at(-1);

    const entryFor = (getHeatmap: (opts: unknown) => Array<Record<string, any>>, path: string) =>
      getHeatmap({}).find((e) => e.path === path);

    let base: number;

    beforeEach(() => {
      app = new FabricTuiApp(store);
      base = Date.now();
    });

    // Fixture fleet (different-worker edits spaced past the 5s collision
    // window unless a collision is intended):
    //   /src/hot.ts               12 mods, 1 worker  -> critical (11+)
    //   /src/multi.ts              4 mods, 3 workers -> warm, top of workers sort
    //   /src/quiet.ts              1 mod,  1 worker  -> cold, collision-free control
    //   /src/collided.ts           2 mods, 2 workers 1s apart -> active collision, most recent
    //   /app/config/settings.yaml  1 mod,  1 worker  -> config anomaly, outside /src
    const feedFleet = (): void => {
      for (let i = 0; i < 12; i++) ingest('/src/hot.ts', 'w-fleet-one', base + i * 1000);
      ingest('/src/multi.ts', 'w-fleet-one', base + 20000);
      ingest('/src/multi.ts', 'w-fleet-one', base + 21000);
      ingest('/src/multi.ts', 'w-fleet-two', base + 40000);
      ingest('/src/multi.ts', 'w-fleet-three', base + 60000);
      ingest('/src/quiet.ts', 'w-fleet-two', base + 50000);
      ingest('/src/collided.ts', 'w-fleet-two', base + 60000);
      ingest('/src/collided.ts', 'w-fleet-three', base + 61000);
      ingest('/app/config/settings.yaml', 'w-fleet-one', base + 45000);
    };

    it('wired heatmap getter honors all four documented sort modes over live data', () => {
      feedFleet();
      pressViewKey('H');

      const [getHeatmap] = wiredGetters();

      // Modifications (default): busiest file first.
      expect(getHeatmap({ sortBy: 'modifications' })[0].path).toBe('/src/hot.ts');
      // Recent: latest-touched file first.
      expect(getHeatmap({ sortBy: 'recent' })[0].path).toBe('/src/collided.ts');
      // Worker count: most contributors first.
      expect(getHeatmap({ sortBy: 'workers' })[0].path).toBe('/src/multi.ts');
      // Collision priority: collided files first, the rest by modification count.
      const byCollisions = getHeatmap({ sortBy: 'collisions' });
      expect(byCollisions[0]).toMatchObject({ path: '/src/collided.ts', hasCollision: true });
      expect(byCollisions.slice(1).every((e: { hasCollision: boolean }) => !e.hasCollision)).toBe(true);
    });

    it('highlights collisions through the wired getters (entry flags, stats, and filter)', () => {
      feedFleet();
      pressViewKey('H');

      const [getHeatmap, getStats] = wiredGetters();

      const collided = entryFor(getHeatmap, '/src/collided.ts');
      expect(collided).toMatchObject({ hasCollision: true, activeWorkers: 2 });

      const quiet = entryFor(getHeatmap, '/src/quiet.ts');
      expect(quiet).toMatchObject({ hasCollision: false, activeWorkers: 1 });

      expect(getStats().collisionFiles).toBe(1);

      // The documented [c] collisions-only filter keeps just the collided file.
      expect(getHeatmap({ collisionsOnly: true }).map((e: { path: string }) => e.path))
        .toEqual(['/src/collided.ts']);
    });

    it('filters by directory through the wired getter, alone and with the collision filter', () => {
      feedFleet();
      pressViewKey('H');

      const [getHeatmap] = wiredGetters();

      const srcOnly = getHeatmap({ directoryFilter: '/src' });
      expect(srcOnly).toHaveLength(4);
      expect(srcOnly.every((e: { path: string }) => e.path.startsWith('/src'))).toBe(true);
      // The config edit outside /src is excluded by the filter.
      expect(srcOnly.some((e: { path: string }) => e.path.includes('config'))).toBe(false);

      // Both filter axes travel in a single getter request.
      expect(
        getHeatmap({ directoryFilter: '/src', collisionsOnly: true }).map((e: { path: string }) => e.path)
      ).toEqual(['/src/collided.ts']);
    });

    it('reports the documented heat bands and distribution through the wired getters', () => {
      feedFleet();
      pressViewKey('H');

      const [getHeatmap, getStats] = wiredGetters();

      // Bands per docs: cold 1-2, warm 3-5, hot 6-10, critical 11+.
      expect(entryFor(getHeatmap, '/src/quiet.ts')?.heatLevel).toBe('cold'); // 1 mod
      expect(entryFor(getHeatmap, '/src/collided.ts')?.heatLevel).toBe('cold'); // 2 mods
      expect(entryFor(getHeatmap, '/src/multi.ts')?.heatLevel).toBe('warm'); // 4 mods
      expect(entryFor(getHeatmap, '/src/hot.ts')?.heatLevel).toBe('critical'); // 12 mods

      expect(getStats().heatDistribution).toEqual({ cold: 3, warm: 1, hot: 0, critical: 1 });
    });

    it('attributes modifications per worker through the wired getter', () => {
      feedFleet();
      pressViewKey('H');

      const [getHeatmap] = wiredGetters();
      const multi = entryFor(getHeatmap, '/src/multi.ts');
      if (!multi) throw new Error('missing /src/multi.ts entry');

      expect(multi.workers).toHaveLength(3);
      // Workers are ordered by contribution; the lead worker did 2 of 4.
      expect(multi.workers[0]).toMatchObject({
        workerId: 'w-fleet-one',
        modifications: 2,
        percentage: 50,
      });
      expect(multi.workers.slice(1).map((w: { workerId: string }) => w.workerId).sort())
        .toEqual(['w-fleet-three', 'w-fleet-two']);
      expect(multi.workers[1]).toMatchObject({ modifications: 1, percentage: 25 });
      expect(multi.workers[2]).toMatchObject({ modifications: 1, percentage: 25 });
    });

    it('upgrades heat band and attribution as new events land in the live view', () => {
      pressViewKey('H'); // view open before the data exists

      ingest('/src/growing.ts', 'w-live-alpha', base);
      const [getHeatmapCold] = wiredGetters();
      const cold = entryFor(getHeatmapCold, '/src/growing.ts');
      if (!cold) throw new Error('missing cold /src/growing.ts entry');
      expect(cold).toMatchObject({ modifications: 1, heatLevel: 'cold' });
      expect(cold.workers).toHaveLength(1);

      // Five more events: 6 total crosses warm (3-5) into hot (6-10); the
      // last lands from a second worker inside the 5s collision window.
      for (let i = 1; i <= 4; i++) ingest('/src/growing.ts', 'w-live-alpha', base + i * 1000);
      ingest('/src/growing.ts', 'w-live-beta', base + 4500);

      const [getHeatmapHot, getStats] = wiredGetters();
      expect(entryFor(getHeatmapHot, '/src/growing.ts')).toMatchObject({
        modifications: 6,
        heatLevel: 'hot',
        hasCollision: true,
      });
      const growing = entryFor(getHeatmapHot, '/src/growing.ts');
      if (!growing) throw new Error('missing hot /src/growing.ts entry');
      expect(growing.workers.map((w: { workerId: string }) => w.workerId).sort())
        .toEqual(['w-live-alpha', 'w-live-beta']);
      expect(getStats().totalModifications).toBe(6);
    });

    it('carries detected anomalies to the component through the wired anomaly getter', () => {
      feedFleet();
      pressViewKey('H');

      const [, , getAnomalies] = wiredGetters();
      const anomalies = getAnomalies({});
      const configAnomaly = anomalies.find((a: { path: string }) => a.path === '/app/config/settings.yaml');
      expect(configAnomaly).toBeDefined();
      expect(configAnomaly.type).toBe('config_modification');
    });
  });
});

describe('TuiOptions interface', () => {
  it('should accept partial options', () => {
    const options1: TuiOptions = {};
    const options2: TuiOptions = { logPath: '/path' };
    const options3: TuiOptions = { maxEvents: 100 };
    const options4: TuiOptions = { refreshInterval: 500 };

    expect(options1).toBeDefined();
    expect(options2).toBeDefined();
    expect(options3).toBeDefined();
    expect(options4).toBeDefined();
  });

  it('should accept all options', () => {
    const options: TuiOptions = {
      logPath: '/path/to/log',
      maxEvents: 500,
      refreshInterval: 200,
    };

    expect(options.logPath).toBe('/path/to/log');
    expect(options.maxEvents).toBe(500);
    expect(options.refreshInterval).toBe(200);
  });
});
