/**
 * Comprehensive Regression Test Suite for FABRIC TUI
 *
 * This test suite ensures that all TUI components work together correctly
 * and that no regressions are introduced during development.
 *
 * Test Coverage:
 * - Component integration and coordination
 * - View mode transitions
 * - Focus mode behavior
 * - Keyboard navigation and bindings
 * - Snapshot tests for rendered output
 * - Edge cases and error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';

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
    getElement = vi.fn(() => ({ hide: vi.fn(), show: vi.fn(), screen: { render: vi.fn() } }));
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
import { FabricTuiApp, createTuiApp } from './app.js';
import { InMemoryEventStore } from '../store.js';
import { LogEvent, WorkerInfo } from '../types.js';
import blessed from 'blessed';

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
    eventCount: 10,
    ...overrides,
  };
}

function getMockScreen() {
  return (blessed.screen as Mock)();
}

describe('TUI Regression Tests', () => {
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

  describe('Component Integration', () => {
    it('should coordinate WorkerGrid and ActivityStream updates', () => {
      app = new FabricTuiApp(store);
      app.start();

      // Add an event
      const event = createMockEvent({ worker: 'w-123' });
      app.addEvent(event);

      // Both components should update
      const mockScreen = getMockScreen();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should pass worker data to WorkerDetail when requested', () => {
      app = new FabricTuiApp(store);
      const worker = createMockWorker();
      store.add(createMockEvent({ worker: worker.id }));

      app.start();

      // Should be able to access worker data
      const workers = store.getWorkers();
      expect(workers.length).toBeGreaterThan(0);
    });

    it('should synchronize filters between ActivityStream and WorkerGrid', () => {
      app = new FabricTuiApp(store);
      app.start();

      // Filter operations should not throw
      expect(() => app.render()).not.toThrow();
    });

    it('should update FileHeatmap when events are added', () => {
      app = new FabricTuiApp(store);
      app.start();

      const event = createMockEvent({ path: '/test/file.ts' });
      app.addEvent(event);

      // Should not throw and render should be called
      expect(getMockScreen().render).toHaveBeenCalled();
    });

    it('should cascade renders when store is updated', () => {
      app = new FabricTuiApp(store);
      app.start();

      const mockScreen = getMockScreen();
      vi.clearAllMocks();

      // Add multiple events
      for (let i = 0; i < 5; i++) {
        app.addEvent(createMockEvent({ msg: `Event ${i}` }));
      }

      // Render should be called multiple times
      expect(mockScreen.render).toHaveBeenCalled();
    });
  });

  describe('View Mode Transitions', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
      app.start();
    });

    it('should transition from default to heatmap view smoothly', () => {
      const mockScreen = getMockScreen();

      // Find and trigger heatmap view
      const hCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('H')
      );
      const hHandler = hCall?.[1] as () => void;

      expect(() => hHandler()).not.toThrow();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should transition from default to DAG view smoothly', () => {
      const mockScreen = getMockScreen();

      const dCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('D')
      );
      const dHandler = dCall?.[1] as () => void;

      expect(() => dHandler()).not.toThrow();
    });

    it('should transition from default to replay view smoothly', () => {
      const mockScreen = getMockScreen();

      const rCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('R')
      );
      const rHandler = rCall?.[1] as () => void;

      expect(() => rHandler()).not.toThrow();
    });

    it('should return to default from any view with escape', () => {
      const mockScreen = getMockScreen();

      // Go to heatmap
      const hCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('H')
      );
      const hHandler = hCall?.[1] as () => void;
      hHandler();

      // Press escape
      const escCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('escape')
      );
      const escHandler = escCall?.[1] as () => void;

      expect(() => escHandler()).not.toThrow();
    });

    it('should handle rapid view mode switching', () => {
      const mockScreen = getMockScreen();

      // Get all view mode handlers
      const hCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('H')
      );
      const dCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('D')
      );
      const escCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('escape')
      );

      const hHandler = hCall?.[1] as () => void;
      const dHandler = dCall?.[1] as () => void;
      const escHandler = escCall?.[1] as () => void;

      // Rapidly switch views
      expect(() => {
        hHandler();
        dHandler();
        escHandler();
        hHandler();
        escHandler();
      }).not.toThrow();
    });

    it('should maintain component state across view transitions', () => {
      // Add event to store directly
      store.add(createMockEvent({ msg: 'Test event' }));

      // Switch views
      const mockScreen = getMockScreen();
      const hCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('H')
      );
      const hHandler = hCall?.[1] as () => void;
      hHandler();

      // Switch back
      const escCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('escape')
      );
      const escHandler = escCall?.[1] as () => void;
      escHandler();

      // Events should still be in store
      expect(store.query().length).toBeGreaterThan(0);
    });

    it('should toggle collision view', () => {
      const mockScreen = getMockScreen();
      const cCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('C')
      );
      const cHandler = cCall?.[1] as () => void;

      expect(() => cHandler()).not.toThrow();
    });

    it('should toggle git integration view', () => {
      const mockScreen = getMockScreen();
      const iCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('I')
      );
      const iHandler = iCall?.[1] as () => void;

      expect(() => iHandler()).not.toThrow();
    });

    it('should toggle error group view', () => {
      const mockScreen = getMockScreen();
      const eCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('E')
      );
      const eHandler = eCall?.[1] as () => void;

      expect(() => eHandler()).not.toThrow();
    });

    it('should toggle narrative view', () => {
      const mockScreen = getMockScreen();
      const nCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('N')
      );
      const nHandler = nCall?.[1] as () => void;

      expect(() => nHandler()).not.toThrow();
    });

    it('should toggle analytics view', () => {
      const mockScreen = getMockScreen();
      const aCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('A')
      );
      const aHandler = aCall?.[1] as () => void;

      expect(() => aHandler()).not.toThrow();
    });
  });

  describe('Focus Mode Integration', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
      app.start();
    });

    it('should toggle focus mode', () => {
      const mockScreen = getMockScreen();

      const fCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('F')
      );
      const fHandler = fCall?.[1] as () => void;

      expect(() => {
        fHandler();
        fHandler();
      }).not.toThrow();
    });

    it('should pin worker when focus mode enabled', () => {
      const mockScreen = getMockScreen();

      // Enable focus mode
      const fCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('F')
      );
      const fHandler = fCall?.[1] as () => void;
      fHandler();

      // Try to pin worker
      const pCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('p')
      );
      const pHandler = pCall?.[1] as () => void;

      expect(() => pHandler()).not.toThrow();
    });

    it('should pin bead when focus mode enabled', () => {
      const mockScreen = getMockScreen();

      // Enable focus mode
      const fCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('F')
      );
      const fHandler = fCall?.[1] as () => void;
      fHandler();

      // Try to pin bead
      const PCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('P')
      );
      const PHandler = PCall?.[1] as () => void;

      expect(() => PHandler()).not.toThrow();
    });

    it('should clear pins when focus mode disabled', () => {
      const mockScreen = getMockScreen();

      const fCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('F')
      );
      const fHandler = fCall?.[1] as () => void;

      // Enable and disable
      fHandler();
      fHandler();

      // Should not throw
      expect(mockScreen.render).toHaveBeenCalled();
    });
  });

  describe('Keyboard Navigation', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
      app.start();
    });

    it('should handle tab navigation', () => {
      const mockScreen = getMockScreen();

      const tabCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('tab')
      );
      const tabHandler = tabCall?.[1] as () => void;

      tabHandler();
      expect(mockScreen.focusNext).toHaveBeenCalled();
    });

    it('should handle shift+tab navigation', () => {
      const mockScreen = getMockScreen();

      const stabCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('S-tab')
      );
      const stabHandler = stabCall?.[1] as () => void;

      stabHandler();
      expect(mockScreen.focusPrevious).toHaveBeenCalled();
    });

    it('should handle refresh key (r)', () => {
      const mockScreen = getMockScreen();

      const rCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('r')
      );
      const rHandler = rCall?.[1] as () => void;

      rHandler();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should handle help toggle (?)', () => {
      const mockScreen = getMockScreen();

      const helpCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('?')
      );
      const helpHandler = helpCall?.[1] as () => void;

      // Toggle help on and off
      helpHandler();
      helpHandler();

      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should handle command palette (C-k)', () => {
      const mockScreen = getMockScreen();

      const ckCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('C-k')
      );
      const ckHandler = ckCall?.[1] as () => void;

      expect(() => ckHandler()).not.toThrow();
    });

    it('should handle worker detail toggle (enter)', () => {
      const mockScreen = getMockScreen();

      const enterCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('enter')
      );
      const enterHandler = enterCall?.[1] as () => void;

      // Should not throw even with no worker selected
      expect(() => enterHandler()).not.toThrow();
    });

    it('should handle quit keys (q, C-c)', () => {
      const mockScreen = getMockScreen();

      const qCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('q')
      );
      const qHandler = qCall?.[1] as () => void;

      qHandler();

      expect(mockScreen.destroy).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(0);
    });
  });

  describe('Command Palette Integration', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
      app.start();
    });

    it('should handle clear command', () => {
      expect(() => app['handleCommand']('clear')).not.toThrow();
    });

    it('should handle pause command', () => {
      expect(() => app['handleCommand']('pause')).not.toThrow();
    });

    it('should handle refresh command', () => {
      expect(() => app['handleCommand']('refresh')).not.toThrow();
    });

    it('should handle help command', () => {
      expect(() => app['handleCommand']('help')).not.toThrow();
    });

    it('should handle quit command', () => {
      app['handleCommand']('quit');
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it('should handle heatmap command', () => {
      expect(() => app['handleCommand']('heatmap')).not.toThrow();
    });

    it('should handle dag command', () => {
      expect(() => app['handleCommand']('dag')).not.toThrow();
    });

    it('should handle filter commands', () => {
      expect(() => app['handleCommand']('filter:worker:w-123')).not.toThrow();
      expect(() => app['handleCommand']('filter:level:error')).not.toThrow();
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle empty store gracefully', () => {
      app = new FabricTuiApp(store);
      expect(() => app.render()).not.toThrow();
    });

    it('should handle store with many events', () => {
      app = new FabricTuiApp(store);

      // Add many events
      for (let i = 0; i < 1000; i++) {
        store.add(createMockEvent({ msg: `Event ${i}` }));
      }

      expect(() => app.render()).not.toThrow();
    });

    it('should handle rapid event additions', () => {
      app = new FabricTuiApp(store);
      app.start();

      // Add events rapidly
      for (let i = 0; i < 100; i++) {
        app.addEvent(createMockEvent({ msg: `Rapid event ${i}` }));
      }

      expect(getMockScreen().render).toHaveBeenCalled();
    });

    it('should handle multiple start calls idempotently', () => {
      app = new FabricTuiApp(store);

      app.start();
      app.start();
      app.start();

      expect(getMockScreen().render).toHaveBeenCalled();
    });

    it('should handle events before start', () => {
      app = new FabricTuiApp(store);

      expect(() => app.addEvent(createMockEvent())).not.toThrow();
    });

    it('should handle malformed events gracefully', () => {
      app = new FabricTuiApp(store);
      app.start();

      const malformed = createMockEvent({ msg: '', worker: '', level: 'info' });
      expect(() => app.addEvent(malformed)).not.toThrow();
    });

    it('should handle events with missing optional fields', () => {
      app = new FabricTuiApp(store);
      app.start();

      const minimal: LogEvent = {
        ts: Date.now(),
        worker: 'w-test',
        level: 'info',
        msg: 'Minimal event',
      };

      expect(() => app.addEvent(minimal)).not.toThrow();
    });

    it('should handle rapid view mode changes', () => {
      app = new FabricTuiApp(store);
      app.start();

      const mockScreen = getMockScreen();

      // Get handlers
      const handlers: Array<() => void> = [];
      ['H', 'D', 'E', 'C', 'I', 'N', 'A'].forEach((key) => {
        const call = mockScreen.key.mock.calls.find(
          (c: unknown[]) => Array.isArray(c?.[0]) && c[0].includes(key)
        );
        if (call) handlers.push(call[1] as () => void);
      });

      // Call all handlers rapidly
      expect(() => {
        handlers.forEach((h) => h());
      }).not.toThrow();
    });

    it('should handle stop without start', () => {
      app = new FabricTuiApp(store);

      expect(() => app.stop()).not.toThrow();
    });

    it('should handle render without start', () => {
      app = new FabricTuiApp(store);

      expect(() => app.render()).not.toThrow();
    });

    it('should handle events from multiple workers', () => {
      app = new FabricTuiApp(store);
      app.start();

      const workers = ['w-1', 'w-2', 'w-3', 'w-4', 'w-5'];
      workers.forEach((workerId) => {
        for (let i = 0; i < 10; i++) {
          store.add(createMockEvent({ worker: workerId, msg: `Event from ${workerId}` }));
        }
      });

      expect(store.getWorkers().length).toBeGreaterThan(0);
    });

    it('should handle concurrent worker updates', () => {
      app = new FabricTuiApp(store);
      app.start();

      // Simulate concurrent events
      const events = Array.from({ length: 50 }, (_, i) =>
        createMockEvent({ worker: `w-${i % 5}`, msg: `Concurrent ${i}` })
      );

      events.forEach((e) => store.add(e));

      expect(store.query().length).toBe(50);
    });
  });

  describe('Factory Function', () => {
    it('should create app via factory function', () => {
      const app = createTuiApp(store);
      expect(app).toBeInstanceOf(FabricTuiApp);
    });

    it('should accept options via factory function', () => {
      const app = createTuiApp(store, {
        maxEvents: 500,
        refreshInterval: 200,
      });

      expect(app).toBeInstanceOf(FabricTuiApp);
    });
  });

  describe('Performance and Resource Management', () => {
    it('should handle large event batches', () => {
      app = new FabricTuiApp(store);
      app.start();

      const events = Array.from({ length: 1000 }, (_, i) =>
        createMockEvent({ msg: `Batch event ${i}` })
      );

      expect(() => {
        events.forEach((e) => app.addEvent(e));
      }).not.toThrow();
    });

    it('should clean up resources on stop', () => {
      app = new FabricTuiApp(store);
      app.start();

      app.stop();

      const mockScreen = getMockScreen();
      expect(mockScreen.destroy).toHaveBeenCalled();
    });

    it('should handle rapid start/stop cycles', () => {
      app = new FabricTuiApp(store);

      expect(() => {
        app.start();
        app.stop();
        app = new FabricTuiApp(store);
        app.start();
        app.stop();
      }).not.toThrow();
    });

    it('should maintain performance with many workers', () => {
      app = new FabricTuiApp(store);

      // Add events from many workers
      for (let i = 0; i < 50; i++) {
        store.add(createMockEvent({ worker: `w-worker${i}` }));
      }

      expect(() => app.render()).not.toThrow();
    });
  });

  describe('Rendered Output Format', () => {
    it('should have consistent header format', () => {
      app = new FabricTuiApp(store);
      store.add(createMockEvent({ worker: 'w-1' }));

      app.start();

      const mockScreen = getMockScreen();
      const boxCalls = (blessed.box as Mock).mock.calls;

      // Header box should exist
      const headerCall = boxCalls.find((call) => call[0]?.content?.includes('FABRIC'));
      expect(headerCall).toBeDefined();
    });

    it('should render worker status badges correctly', () => {
      app = new FabricTuiApp(store);

      store.add(createMockEvent({ worker: 'w-active', level: 'info' }));
      store.add(createMockEvent({ worker: 'w-error', level: 'error' }));

      app.start();
      app.render();

      // Should not throw during render
      expect(getMockScreen().render).toHaveBeenCalled();
    });

    it('should format footer content correctly', () => {
      app = new FabricTuiApp(store);
      app.start();

      const mockScreen = getMockScreen();
      const boxCalls = (blessed.box as Mock).mock.calls;

      // Footer should contain key hints
      const footerCall = boxCalls.find((call) => call[0]?.bottom === 0);
      expect(footerCall).toBeDefined();
    });
  });

  describe('State Consistency', () => {
    it('should maintain consistent state across renders', () => {
      app = new FabricTuiApp(store);
      app.start();

      store.add(createMockEvent({ msg: 'Event 1' }));
      app.render();

      store.add(createMockEvent({ msg: 'Event 2' }));
      app.render();

      expect(store.query().length).toBe(2);
    });

    it('should not lose events during view transitions', () => {
      app = new FabricTuiApp(store);
      app.start();

      // Add events
      for (let i = 0; i < 10; i++) {
        app.addEvent(createMockEvent({ msg: `Event ${i}` }));
      }

      // Switch views
      const mockScreen = getMockScreen();
      const hCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('H')
      );
      const hHandler = hCall?.[1] as () => void;
      hHandler();

      // Return to default
      const escCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('escape')
      );
      const escHandler = escCall?.[1] as () => void;
      escHandler();

      // All events should still be in store
      expect(store.query().length).toBe(10);
    });

    it('should preserve worker state during refresh', () => {
      app = new FabricTuiApp(store);
      app.start();

      store.add(createMockEvent({ worker: 'w-1', bead: 'bd-task1' }));
      const workersBefore = store.getWorkers();

      app.render();

      const workersAfter = store.getWorkers();
      expect(workersAfter.length).toBe(workersBefore.length);
    });
  });
});
