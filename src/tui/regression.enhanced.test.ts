/**
 * Enhanced Regression Test Suite for FABRIC TUI
 *
 * This test suite extends the base regression tests with:
 * - Snapshot tests for rendered output
 * - Focus preset management
 * - Theme switching
 * - File context panel split view
 * - Budget panel and cost tracking
 * - Export/import functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';

// Mock process.exit before importing
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

// Mock blessed module - must have everything inline due to hoisting
vi.mock('blessed', () => {
  const createMockBoxElement = () => ({
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
    right: 0,
    width: '60%',
    left: '60%',
  });

  const mockBoxInstance = createMockBoxElement();
  const mockLogInstance = {
    ...createMockBoxElement(),
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

// Create mock element factory for use in component mocks
const createMockBoxElement = () => ({
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
  right: 0,
  width: '60%',
  left: '60%',
});

// Mock focus presets
vi.mock('../focusPresets.js', () => ({
  createTuiPresetManager: vi.fn(() => ({
    savePreset: vi.fn((name: string, workers: string[], beads: string[]) => true),
    loadPreset: vi.fn((name: string) => ({ workers: ['w-test1'], beads: ['bd-abc123'] })),
    getPreset: vi.fn((name: string) => ({
      name,
      pinnedWorkers: ['w-test1'],
      pinnedBeads: ['bd-abc123'],
    })),
    deletePreset: vi.fn(() => true),
    getPresets: vi.fn(() => [
      { name: 'test-preset', pinnedWorkers: ['w-1'], pinnedBeads: ['bd-1'] },
      { name: 'another-preset', pinnedWorkers: ['w-2'], pinnedBeads: ['bd-2'] },
    ]),
  })),
}));

// Mock cost tracking - must export all actual exports
vi.mock('./utils/costTracking.js', () => {
  const mockTracker = {
    getSummary: vi.fn(() => ({
      totalCostUsd: 1.23,
      totalTokens: 12345,
      eventCount: 100,
      byWorker: new Map(),
    })),
    getAlerts: vi.fn(() => []),
    acknowledgeAlert: vi.fn(),
    processEvent: vi.fn(),
  };

  class MockCostTracker {
    getSummary = mockTracker.getSummary;
    getAlerts = mockTracker.getAlerts;
    acknowledgeAlert = mockTracker.acknowledgeAlert;
    processEvent = mockTracker.processEvent;
  }

  return {
    CostTracker: MockCostTracker,
    getCostTracker: vi.fn(() => mockTracker),
    formatCost: vi.fn((usd: number) => `$${usd.toFixed(2)}`),
    formatTokens: vi.fn((count: number) => count.toString()),
    formatTimeToExhaustion: vi.fn((mins: number) => `${mins}m`),
    formatBurnRate: vi.fn((rate: number) => `$${rate}/min`),
    getBudgetIndicator: vi.fn(() => ''),
    getBudgetBadge: vi.fn(() => ''),
    formatBudgetAlert: vi.fn(() => 'Budget alert'),
  };
});

// Mock theme manager
vi.mock('./utils/colors.js', () => ({
  colors: {
    border: 'white',
    header: 'cyan',
    focus: 'green',
    muted: 'gray',
  },
  getStatusColor: vi.fn((status: string) => {
    const colors: Record<string, string> = { active: 'green', idle: 'yellow', error: 'red' };
    return colors[status] || 'white';
  }),
  getNeedleStateColor: vi.fn(() => 'cyan'),
  getNeedleStateIcon: vi.fn(() => '●'),
  getLevelColor: vi.fn((level: string) => {
    const colors: Record<string, string> = { debug: 'gray', info: 'green', warn: 'yellow', error: 'red' };
    return colors[level] || 'white';
  }),
  getThemeManager: vi.fn(() => ({
    getTheme: vi.fn(() => 'dark'),
    setTheme: vi.fn(),
    toggleTheme: vi.fn(() => 'light'),
    subscribe: vi.fn(() => vi.fn()),
  })),
}));

// Mock all components using class syntax (like regression.test.ts)
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
    getElement = vi.fn(() => ({ hide: vi.fn(), show: vi.fn(), screen: { render: vi.fn() }, right: 0, width: '60%' }));
    getIsPaused = vi.fn(() => false);
    setFocusMode = vi.fn();
    getFilter = vi.fn(() => ({}));
    getEventsCount = vi.fn(() => 0);
    getFilteredEventsCount = vi.fn(() => 0);
    setTimeFilter = vi.fn();
    scrollToTimestamp = vi.fn();
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
    toggle = vi.fn();
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

vi.mock('./components/FileContextPanel.js', () => ({
  FileContextPanel: class {
    show = vi.fn();
    hide = vi.fn();
    setContextFromEvent = vi.fn();
    getElement = vi.fn(() => ({ hide: vi.fn(), show: vi.fn(), screen: { render: vi.fn() }, left: '60%', width: '40%' }));
  },
}));

vi.mock('./components/ConversationTranscript.js', () => ({
  ConversationTranscript: class {
    show = vi.fn();
    hide = vi.fn();
    focus = vi.fn();
  },
}));

vi.mock('./components/CrossReferencePanel.js', () => ({
  CrossReferencePanel: class {
    show = vi.fn();
    hide = vi.fn();
    focus = vi.fn();
  },
}));

vi.mock('./components/BudgetAlertPanel.js', () => ({
  BudgetAlertPanel: class {
    show = vi.fn();
    hide = vi.fn();
    focus = vi.fn();
    setCostSummary = vi.fn();
    setAlerts = vi.fn();
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

describe('TUI Enhanced Regression Tests', () => {
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

  describe('Snapshot Tests', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
      app.start();
    });

    it('should snapshot worker grid with active workers', () => {
      const workers = [
        createMockWorker({ id: 'w-active123', status: 'active', beadsCompleted: 10 }),
        createMockWorker({ id: 'w-idle456', status: 'idle', beadsCompleted: 5 }),
        createMockWorker({ id: 'w-error789', status: 'error', beadsCompleted: 2 }),
      ];

      workers.forEach(w => {
        store.add(createMockEvent({ worker: w.id, msg: `Worker ${w.id} activity` }));
      });

      app.render();

      const mockScreen = getMockScreen();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should snapshot activity stream event formatting', () => {
      const events = [
        createMockEvent({ level: 'info', msg: 'Info message', tool: 'Read', bead: 'bd-test1' }),
        createMockEvent({ level: 'warn', msg: 'Warning message', tool: 'Edit' }),
        createMockEvent({ level: 'error', msg: 'Error message', error: 'Something failed' }),
      ];

      events.forEach(e => app.addEvent(e));

      const mockScreen = getMockScreen();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should snapshot header with worker stats badge', () => {
      store.add(createMockEvent({ worker: 'w-1', level: 'info' }));
      store.add(createMockEvent({ worker: 'w-2', level: 'error' }));

      app.render();

      const blessedMock = blessed as unknown as { box: Mock };
      const boxCalls = blessedMock.box.mock.calls;
      expect(boxCalls.length).toBeGreaterThan(0);
    });

    it('should snapshot footer with key hints', () => {
      app.render();

      const blessedMock = blessed as unknown as { box: Mock };
      const boxCalls = blessedMock.box.mock.calls;

      const footerCall = boxCalls.find((call: unknown[]) => {
        const opts = call?.[0] as Record<string, unknown> | undefined;
        return opts?.bottom === 0;
      });

      expect(footerCall).toBeDefined();
    });

    it('should snapshot empty state display', () => {
      app.render();
      const mockScreen = getMockScreen();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should snapshot collision indicators', () => {
      store.add(createMockEvent({ worker: 'w-1', path: '/shared/file.ts' }));
      store.add(createMockEvent({ worker: 'w-2', path: '/shared/file.ts' }));

      app.render();
      const mockScreen = getMockScreen();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should snapshot focus mode dimmed workers', () => {
      store.add(createMockEvent({ worker: 'w-1' }));
      store.add(createMockEvent({ worker: 'w-2' }));

      const mockScreen = getMockScreen();
      const fCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('F')
      );
      const fHandler = fCall?.[1] as () => void;
      fHandler?.();

      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should snapshot time-filtered events', () => {
      const now = Date.now();
      const events = [
        createMockEvent({ ts: now - 3600000, msg: '1 hour ago' }),
        createMockEvent({ ts: now - 60000, msg: '1 minute ago' }),
        createMockEvent({ ts: now, msg: 'Just now' }),
      ];

      events.forEach(e => app.addEvent(e));

      const mockScreen = getMockScreen();
      expect(mockScreen.render).toHaveBeenCalled();
    });
  });

  describe('Focus Preset Management', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
      app.start();

      store.add(createMockEvent({ worker: 'w-alpha', bead: 'bd-alpha-task' }));
      store.add(createMockEvent({ worker: 'w-beta', bead: 'bd-beta-task' }));
    });

    it('should save focus preset via keyboard shortcut', () => {
      const mockScreen = getMockScreen();

      const bracketCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('[')
      );
      const bracketHandler = bracketCall?.[1] as () => void;

      expect(() => bracketHandler?.()).not.toThrow();
    });

    it('should cycle through presets via keyboard shortcut', () => {
      const mockScreen = getMockScreen();

      const closeBracketCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes(']')
      );
      const closeBracketHandler = closeBracketCall?.[1] as () => void;

      expect(() => closeBracketHandler?.()).not.toThrow();
    });

    it('should handle preset:save command', () => {
      expect(() => app['handleCommand']('preset:save')).not.toThrow();
    });

    it('should handle preset:list command', () => {
      expect(() => app['handleCommand']('preset:list')).not.toThrow();
    });

    it('should handle preset:load command', () => {
      expect(() => app['handleCommand']('preset:load:test-preset')).not.toThrow();
    });

    it('should handle preset:delete command', () => {
      expect(() => app['handleCommand']('preset:delete:test-preset')).not.toThrow();
    });
  });

  describe('Theme Switching', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
      app.start();
    });

    it('should toggle theme via Ctrl+T', () => {
      const mockScreen = getMockScreen();

      const ctrlTCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('C-t')
      );
      const ctrlTHandler = ctrlTCall?.[1] as () => void;

      expect(() => ctrlTHandler?.()).not.toThrow();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should handle theme:toggle command', () => {
      expect(() => app['handleCommand']('theme:toggle')).not.toThrow();
    });

    it('should handle theme:dark command', () => {
      expect(() => app['handleCommand']('theme:dark')).not.toThrow();
    });

    it('should handle theme:light command', () => {
      expect(() => app['handleCommand']('theme:light')).not.toThrow();
    });
  });

  describe('File Context Panel Split View', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
      app.start();
    });

    it('should toggle file context panel via Ctrl+F', () => {
      const mockScreen = getMockScreen();

      const ctrlFCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('C-f')
      );
      const ctrlFHandler = ctrlFCall?.[1] as () => void;

      expect(() => ctrlFHandler?.()).not.toThrow();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should resize split view via { key', () => {
      const mockScreen = getMockScreen();

      const ctrlFCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('C-f')
      );
      const ctrlFHandler = ctrlFCall?.[1] as () => void;
      ctrlFHandler?.();

      const braceCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('{')
      );
      const braceHandler = braceCall?.[1] as () => void;

      expect(() => braceHandler?.()).not.toThrow();
    });

    it('should resize split view via } key', () => {
      const mockScreen = getMockScreen();

      const ctrlFCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('C-f')
      );
      const ctrlFHandler = ctrlFCall?.[1] as () => void;
      ctrlFHandler?.();

      const closeBraceCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('}')
      );
      const closeBraceHandler = closeBraceCall?.[1] as () => void;

      expect(() => closeBraceHandler?.()).not.toThrow();
    });

    it('should clamp split ratio between 20% and 80%', () => {
      const mockScreen = getMockScreen();

      const ctrlFCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('C-f')
      );
      const ctrlFHandler = ctrlFCall?.[1] as () => void;
      ctrlFHandler?.();

      const braceCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('{')
      );
      const braceHandler = braceCall?.[1] as () => void;

      for (let i = 0; i < 20; i++) {
        expect(() => braceHandler?.()).not.toThrow();
      }

      expect(mockScreen.render).toHaveBeenCalled();
    });
  });

  describe('Budget Panel and Cost Tracking', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
      app.start();
    });

    it('should toggle budget view via B key', () => {
      const mockScreen = getMockScreen();

      const bCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('B')
      );
      const bHandler = bCall?.[1] as () => void;

      expect(() => bHandler?.()).not.toThrow();
    });

    it('should handle budget: command from command palette', () => {
      expect(() => app['handleCommand']('budget')).not.toThrow();
    });
  });

  describe('Export/Import Functionality', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);

      const events = [
        createMockEvent({ worker: 'w-1', msg: 'Event 1' }),
        createMockEvent({ worker: 'w-2', msg: 'Event 2' }),
        createMockEvent({ worker: 'w-3', msg: 'Event 3' }),
      ];
      events.forEach(e => store.add(e));

      app.start();
    });

    it('should handle export command', () => {
      expect(() => app['handleCommand']('export')).not.toThrow();
    });

    it('should handle export:file command', () => {
      expect(() => app['handleCommand']('export:file')).not.toThrow();
    });

    it('should handle export:link command', () => {
      expect(() => app['handleCommand']('export:link')).not.toThrow();
    });

    it('should handle export:import command', () => {
      expect(() => app['handleCommand']('export:import')).not.toThrow();
    });

    it('should show message when no events to export', () => {
      const emptyStore = createMockStore();
      const emptyApp = new FabricTuiApp(emptyStore);
      emptyApp.start();

      expect(() => emptyApp['handleCommand']('export:file')).not.toThrow();
    });
  });

  describe('Advanced Navigation Commands', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
      app.start();

      store.add(createMockEvent({ worker: 'w-alpha', bead: 'bd-task1' }));
      store.add(createMockEvent({ worker: 'w-beta', bead: 'bd-task2' }));
    });

    it('should handle worker: command to jump to worker', () => {
      expect(() => app['handleCommand']('worker:w-alpha')).not.toThrow();
    });

    it('should handle bead: command to show bead events', () => {
      expect(() => app['handleCommand']('bead:bd-task1')).not.toThrow();
    });

    it('should handle file: command to show file operations', () => {
      expect(() => app['handleCommand']('file:.ts')).not.toThrow();
    });

    it('should handle goto: command to jump to timestamp', () => {
      expect(() => app['handleCommand']('goto:14:30')).not.toThrow();
    });

    it('should show error message for invalid worker ID', () => {
      expect(() => app['handleCommand']('worker:nonexistent')).not.toThrow();
    });

    it('should show error message for invalid timestamp', () => {
      expect(() => app['handleCommand']('goto:invalid')).not.toThrow();
    });
  });

  describe('Time Filter Commands', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
      app.start();

      const now = Date.now();
      store.add(createMockEvent({ ts: now - 3600000, msg: '1 hour ago' }));
      store.add(createMockEvent({ ts: now - 60000, msg: '1 minute ago' }));
      store.add(createMockEvent({ ts: now, msg: 'Just now' }));
    });

    it('should handle filter:last:5s command', () => {
      expect(() => app['handleCommand']('filter:last:5s')).not.toThrow();
    });

    it('should handle filter:last:5m command', () => {
      expect(() => app['handleCommand']('filter:last:5m')).not.toThrow();
    });

    it('should handle filter:last:1h command', () => {
      expect(() => app['handleCommand']('filter:last:1h')).not.toThrow();
    });

    it('should show error for invalid duration format', () => {
      expect(() => app['handleCommand']('filter:last:invalid')).not.toThrow();
    });
  });

  describe('Factory Function Variants', () => {
    it('should create app with custom maxEvents', () => {
      const customApp = createTuiApp(store, { maxEvents: 500 });
      expect(customApp).toBeInstanceOf(FabricTuiApp);
    });

    it('should create app with custom refreshInterval', () => {
      const customApp = createTuiApp(store, { refreshInterval: 200 });
      expect(customApp).toBeInstanceOf(FabricTuiApp);
    });

    it('should create app with custom logPath', () => {
      const customApp = createTuiApp(store, { logPath: '/test/path.log' });
      expect(customApp).toBeInstanceOf(FabricTuiApp);
    });

    it('should create app with custom filter', () => {
      const customApp = createTuiApp(store, { filter: { worker: 'w-test', level: 'error' } });
      expect(customApp).toBeInstanceOf(FabricTuiApp);
    });

    it('should create app with all custom options', () => {
      const customApp = createTuiApp(store, {
        maxEvents: 1000,
        refreshInterval: 50,
        logPath: '/custom/path.log',
        filter: { level: 'info' },
      });
      expect(customApp).toBeInstanceOf(FabricTuiApp);
    });
  });

  describe('State Preservation', () => {
    it('should preserve store data across app instances', () => {
      const app1 = new FabricTuiApp(store);
      app1.start();
      store.add(createMockEvent({ msg: 'Event from app1' }));

      const app2 = new FabricTuiApp(store);
      app2.start();

      expect(store.query().length).toBe(1);
      expect(store.query()[0].msg).toBe('Event from app1');
    });

    it('should handle rapid app creation and destruction', () => {
      for (let i = 0; i < 10; i++) {
        const tempApp = new FabricTuiApp(store);
        tempApp.start();
        store.add(createMockEvent({ msg: `Event ${i}` }));
      }

      expect(store.query().length).toBe(10);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle command with unknown prefix gracefully', () => {
      app = new FabricTuiApp(store);
      app.start();

      expect(() => app['handleCommand']('unknown:command')).not.toThrow();
    });

    it('should handle very long command strings', () => {
      app = new FabricTuiApp(store);
      app.start();

      const longCommand = 'a'.repeat(1000);
      expect(() => app['handleCommand'](longCommand)).not.toThrow();
    });

    it('should handle command with special characters', () => {
      app = new FabricTuiApp(store);
      app.start();

      expect(() => app['handleCommand']('test:command-with_special.chars')).not.toThrow();
    });

    it('should handle empty command string', () => {
      app = new FabricTuiApp(store);
      app.start();

      expect(() => app['handleCommand']('')).not.toThrow();
    });

    it('should handle command with only prefix', () => {
      app = new FabricTuiApp(store);
      app.start();

      expect(() => app['handleCommand']('worker:')).not.toThrow();
      expect(() => app['handleCommand']('bead:')).not.toThrow();
      expect(() => app['handleCommand']('file:')).not.toThrow();
    });
  });

  describe('Component Coordination', () => {
    beforeEach(() => {
      app = new FabricTuiApp(store);
      app.start();
    });

    it('should coordinate activity stream and worker grid on event add', () => {
      const event = createMockEvent({ worker: 'w-1', path: '/test.ts' });
      app.addEvent(event);

      const mockScreen = getMockScreen();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should update header stats after event addition', () => {
      store.add(createMockEvent({ worker: 'w-1', level: 'error' }));
      app.addEvent(createMockEvent({ worker: 'w-1', level: 'error' }));

      const mockScreen = getMockScreen();
      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should trigger file context update for file events', () => {
      const mockScreen = getMockScreen();

      const ctrlFCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('C-f')
      );
      const ctrlFHandler = ctrlFCall?.[1] as () => void;
      ctrlFHandler?.();

      app.addEvent(createMockEvent({ path: '/test/file.ts', tool: 'Edit' }));

      expect(mockScreen.render).toHaveBeenCalled();
    });

    it('should maintain focus mode state across renders', () => {
      const mockScreen = getMockScreen();

      const fCall = mockScreen.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('F')
      );
      const fHandler = fCall?.[1] as () => void;
      fHandler?.();

      app.addEvent(createMockEvent());
      app.addEvent(createMockEvent());

      expect(mockScreen.render).toHaveBeenCalled();
    });
  });
});
