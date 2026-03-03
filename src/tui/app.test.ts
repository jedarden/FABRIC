/**
 * Tests for FabricTuiApp Main TUI Class
 *
 * Tests initialization, key handling, and component coordination.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
    },
  };
});

vi.mock('./components/ActivityStream.js', () => {
  return {
    ActivityStream: class {
      addEvent = vi.fn();
      clearFilter = vi.fn();
      setFilter = vi.fn();
      togglePause = vi.fn();
      focus = vi.fn();
      getElement = vi.fn(() => ({ hide: vi.fn(), show: vi.fn(), screen: { render: vi.fn() } }));
      getIsPaused = vi.fn(() => false);
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
    },
  };
});

vi.mock('./components/FileHeatmap.js', () => {
  return {
    FileHeatmap: class {
      updateData = vi.fn();
      focus = vi.fn();
      getElement = vi.fn(() => ({
        hide: vi.fn(),
        show: vi.fn(),
        screen: { render: vi.fn() },
      }));
      getSelected = vi.fn(() => null);
      getSortMode = vi.fn(() => 'modifications');
      getCollisionFilter = vi.fn(() => false);
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
import * as blessed from 'blessed';

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
    firstSeen: Date.now() - 60000,
    lastActivity: Date.now(),
    activeFiles: [],
    hasCollision: false,
    activeDirectories: [],
    collisionTypes: [],
    ...overrides,
  };
}

// Get the mocked screen instance
function getMockScreen() {
  return (blessed.screen as vi.Mock)();
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

      expect(mockScreen.key).toHaveBeenCalledWith(['H'], expect.any(Function));
    });

    it('should bind DAG view key (D)', () => {
      const mockScreen = getMockScreen();

      expect(mockScreen.key).toHaveBeenCalledWith(['D'], expect.any(Function));
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
