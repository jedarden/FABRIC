/**
 * Tests for WorkerAnalyticsPanel Component
 *
 * Tests worker analytics display, metrics, and comparisons.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import blessed from 'blessed';

// Mock the blessed module before importing WorkerAnalyticsPanel
vi.mock('blessed', () => {
  const mockBoxInstance = {
    setContent: vi.fn(),
    setLabel: vi.fn(),
    setItems: vi.fn(),
    select: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    focus: vi.fn(),
    key: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
    hidden: true,
    screen: {
      render: vi.fn(),
    },
    visible: false,
    height: 20,
    width: 80,
  };

  const mockListInstance = {
    setContent: vi.fn(),
    setLabel: vi.fn(),
    setItems: vi.fn(),
    select: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    focus: vi.fn(),
    key: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
    hidden: true,
    screen: {
      render: vi.fn(),
    },
    visible: false,
    height: 20,
    width: 80,
  };

  return {
    default: {
      box: vi.fn(() => mockBoxInstance),
      list: vi.fn(() => mockListInstance),
    },
    box: vi.fn(() => mockBoxInstance),
    list: vi.fn(() => mockListInstance),
  };
});

// Mock colors module
vi.mock('../utils/colors.js', () => ({
  colors: {
    border: 'blue',
    header: 'cyan',
    text: 'white',
    dim: 'gray',
    selected: 'magenta',
    focus: 'green',
  },
}));

// Mock workerAnalytics module - define everything inline inside the factory to avoid hoisting issues
vi.mock('../../workerAnalytics.js', () => {
  class MockWorkerAnalytics {
    compareWorkers = vi.fn(() => ({
      worker1: { workerId: 'w-1', beadsCompleted: 10, beadsPerHour: 5, avgCompletionTimeMs: 1000, errorRate: 0.1, costPerBead: 0.5, totalCostUsd: 5, efficiencyScore: 0.8, activeTimeMs: 10000, idlePercentage: 0.2, errorCount: 1, totalTokens: 1000, trend: undefined },
      worker2: { workerId: 'w-2', beadsCompleted: 15, beadsPerHour: 7, avgCompletionTimeMs: 800, errorRate: 0.05, costPerBead: 0.3, totalCostUsd: 4.5, efficiencyScore: 0.9, activeTimeMs: 15000, idlePercentage: 0.1, errorCount: 0, totalTokens: 900, trend: undefined },
      differences: { beadsCompleted: -5, beadsPerHour: -2, avgCompletionTimeMs: 200, errorRate: 0.05, costPerBead: 0.2, efficiencyScore: -0.1, activeTimeMs: -5000, idlePercentage: 0.1, totalCostUsd: 0.5, totalTokens: 100 },
      percentDifferences: { beadsCompleted: -33.3, beadsPerHour: -28.6, avgCompletionTimeMs: 25, errorRate: 100, costPerBead: 66.7, efficiencyScore: -12.5, activeTimeMs: -33.3, idlePercentage: 100, totalCostUsd: 11.1, totalTokens: 11.1 },
      betterWorker: { beadsCompleted: 'worker2', beadsPerHour: 'worker2', avgCompletionTimeMs: 'worker2', errorRate: 'worker2', costPerBead: 'worker2', efficiencyScore: 'worker2', activeTimeMs: 'worker2', idlePercentage: 'worker2', totalCostUsd: 'worker2' },
      score: { worker1: 0, worker2: 9 },
      overallWinner: 'worker2',
    }));
  }

  return {
    WorkerAnalytics: MockWorkerAnalytics,
  };
});

// Import after mocking
import { WorkerAnalyticsPanel } from './WorkerAnalyticsPanel.js';
import { WorkerAnalytics } from '../../workerAnalytics.js';
import type { WorkerMetrics, AggregatedAnalytics } from '../../types.js';

// Helper to create mock screen
function createMockScreen() {
  return {
    render: vi.fn(),
    append: vi.fn(),
    key: vi.fn(),
    destroy: vi.fn(),
  } as unknown as blessed.Widgets.Screen;
}

// Helper to create mock worker metrics
function createMockMetrics(overrides: Partial<WorkerMetrics> = {}): WorkerMetrics {
  return {
    workerId: 'w-test123',
    periodStart: Date.now() - 3600000,
    periodEnd: Date.now(),
    beadsCompleted: 10,
    beadsPerHour: 10,
    avgCompletionTimeMs: 60000,
    errorRate: 0.05,
    errorCount: 1,
    costPerBead: 0.5,
    totalCostUsd: 5,
    totalTokens: 10000,
    tokensPerBead: 1000,
    activeTimeMs: 3000000,
    idleTimeMs: 600000,
    idlePercentage: 0.2,
    efficiencyScore: 0.8,
    totalEvents: 100,
    trend: {
      direction: 'improving',
      confidence: 0.85,
      factors: ['faster completion', 'fewer errors'],
    },
    ...overrides,
  };
}

// Helper to create mock aggregated analytics
function createMockAggregated(overrides: Partial<AggregatedAnalytics> = {}): AggregatedAnalytics {
  return {
    totalBeadsCompleted: 100,
    activeWorkerCount: 5,
    avgBeadsPerHour: 20,
    avgEfficiency: 0.85,
    totalCostUsd: 50,
    avgCostPerBead: 0.5,
    totalTokens: 100000,
    overallErrorRate: 0.03,
    totalErrors: 3,
    periodStart: Date.now() - 3600000,
    periodEnd: Date.now(),
    totalWorkers: 5,
    avgCompletionTimeMs: 60000,
    topPerformers: [
      createMockMetrics({ workerId: 'w-top1', beadsCompleted: 30, efficiencyScore: 0.95 }),
      createMockMetrics({ workerId: 'w-top2', beadsCompleted: 25, efficiencyScore: 0.9 }),
      createMockMetrics({ workerId: 'w-top3', beadsCompleted: 20, efficiencyScore: 0.88 }),
    ],
    highErrorRateWorkers: [],
    costEfficientWorkers: [],
    underperformers: [
      createMockMetrics({ workerId: 'w-low1', errorRate: 0.2 }),
      createMockMetrics({ workerId: 'w-low2', errorRate: 0.15 }),
    ],
    ...overrides,
  };
}

describe('WorkerAnalyticsPanel', () => {
  let panel: WorkerAnalyticsPanel;
  let mockScreen: blessed.Widgets.Screen;
  let mockBoxInstance: any;
  let mockListInstance: any;
  let mockSubBox: any;
  let onSelectCallback: (workerId: string) => void;

  beforeEach(() => {
    vi.clearAllMocks();

    mockScreen = createMockScreen();
    onSelectCallback = vi.fn() as unknown as (workerId: string) => void;

    // Get the mock instances from the mock
    const blessedMock = blessed as unknown as { box: Mock; list: Mock };
    mockBoxInstance = blessedMock.box();
    mockListInstance = blessedMock.list();
    mockSubBox = blessedMock.box({ parent: mockBoxInstance });

    panel = new WorkerAnalyticsPanel({
      parent: mockScreen,
      top: 0,
      left: 0,
      width: 80,
      height: 20,
      onSelect: onSelectCallback,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a blessed box with correct options', () => {
      const blessedMock = blessed as unknown as { box: Mock };
      expect(blessedMock.box).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: mockScreen,
          top: 0,
          left: 0,
          width: 80,
          height: 20,
          label: ' Worker Analytics ',
          scrollable: true,
          alwaysScroll: true,
          keys: true,
          vi: true,
          mouse: true,
        })
      );
    });

    it('should create list and detail box elements', () => {
      const blessedMock = blessed as unknown as { box: Mock; list: Mock };
      expect(blessedMock.list).toHaveBeenCalled();
      expect(blessedMock.box).toHaveBeenCalled();
    });

    it('should create WorkerAnalytics instance', () => {
      // The panel creates an analytics manager instance
      expect((panel as any).analyticsManager).toBeInstanceOf(WorkerAnalytics);
    });

    it('should bind key handlers', () => {
      expect(mockListInstance.key).toHaveBeenCalled();
    });
  });

  describe('setMetrics', () => {
    it('should set metrics and render', () => {
      const metrics = [createMockMetrics()];
      panel.setMetrics(metrics);

      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should sort metrics by default sort mode', () => {
      const metrics = [
        createMockMetrics({ beadsCompleted: 5, workerId: 'w-1' }),
        createMockMetrics({ beadsCompleted: 15, workerId: 'w-2' }),
        createMockMetrics({ beadsCompleted: 10, workerId: 'w-3' }),
      ];
      panel.setMetrics(metrics);

      // Should be sorted by beads completed (descending)
      expect((panel as any).metrics[0].beadsCompleted).toBe(15);
      expect((panel as any).metrics[1].beadsCompleted).toBe(10);
      expect((panel as any).metrics[2].beadsCompleted).toBe(5);
    });

    it('should reset selected index', () => {
      const metrics = [createMockMetrics()];
      (panel as any).selectedIndex = 5;
      panel.setMetrics(metrics);

      expect((panel as any).selectedIndex).toBe(0);
    });

    it('should handle empty metrics array', () => {
      panel.setMetrics([]);

      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });
  });

  describe('setAggregated', () => {
    it('should set aggregated analytics', () => {
      const aggregated = createMockAggregated();
      panel.setAggregated(aggregated);

      expect((panel as any).aggregated).toBe(aggregated);
    });
  });

  describe('sort modes', () => {
    it('should cycle through sort modes', () => {
      const metrics = [
        createMockMetrics({ beadsCompleted: 10, errorRate: 0.1, costPerBead: 1, efficiencyScore: 0.7 }),
        createMockMetrics({ beadsCompleted: 5, errorRate: 0.05, costPerBead: 0.5, efficiencyScore: 0.9 }),
      ];
      panel.setMetrics(metrics);

      const modes: Array<'beads' | 'errorRate' | 'cost' | 'efficiency'> = ['beads', 'errorRate', 'cost', 'efficiency'];

      modes.forEach(mode => {
        // Trigger sort mode cycle via s key
        const sCall = mockListInstance.key.mock.calls.find(
          (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('s')
        );
        const sHandler = sCall?.[1];

        expect(() => sHandler?.()).not.toThrow();
        expect((panel as any).sortMode).toBeDefined();
      });
    });

    it('should sort by beads completed (descending)', () => {
      const metrics = [
        createMockMetrics({ beadsCompleted: 5 }),
        createMockMetrics({ beadsCompleted: 15 }),
        createMockMetrics({ beadsCompleted: 10 }),
      ];
      panel.setMetrics(metrics);

      expect((panel as any).metrics[0].beadsCompleted).toBe(15);
    });

    it('should sort by error rate (ascending)', () => {
      const metrics = [
        createMockMetrics({ errorRate: 0.2 }),
        createMockMetrics({ errorRate: 0.05 }),
        createMockMetrics({ errorRate: 0.1 }),
      ];
      panel.setMetrics(metrics);
      // Cycle to error rate mode (default beads -> errorRate)
      panel.cycleSortMode();

      expect((panel as any).metrics[0].errorRate).toBe(0.05);
    });

    it('should sort by cost per bead (ascending)', () => {
      const metrics = [
        createMockMetrics({ costPerBead: 1.0 }),
        createMockMetrics({ costPerBead: 0.3 }),
        createMockMetrics({ costPerBead: 0.5 }),
      ];
      panel.setMetrics(metrics);
      // Cycle to cost mode (beads -> errorRate -> cost)
      panel.cycleSortMode();
      panel.cycleSortMode();

      expect((panel as any).metrics[0].costPerBead).toBe(0.3);
    });

    it('should sort by efficiency score (descending)', () => {
      const metrics = [
        createMockMetrics({ efficiencyScore: 0.6 }),
        createMockMetrics({ efficiencyScore: 0.95 }),
        createMockMetrics({ efficiencyScore: 0.8 }),
      ];
      panel.setMetrics(metrics);
      // Cycle to efficiency mode (beads -> errorRate -> cost -> efficiency)
      panel.cycleSortMode();
      panel.cycleSortMode();
      panel.cycleSortMode();

      expect((panel as any).metrics[0].efficiencyScore).toBe(0.95);
    });
  });

  describe('navigation', () => {
    beforeEach(() => {
      const metrics = [
        createMockMetrics({ workerId: 'w-1' }),
        createMockMetrics({ workerId: 'w-2' }),
        createMockMetrics({ workerId: 'w-3' }),
      ];
      panel.setMetrics(metrics);
    });

    it('should select next worker', () => {
      panel.selectNext();
      expect((panel as any).selectedIndex).toBe(1);

      panel.selectNext();
      expect((panel as any).selectedIndex).toBe(2);

      // Should wrap
      panel.selectNext();
      expect((panel as any).selectedIndex).toBe(0);
    });

    it('should select previous worker', () => {
      (panel as any).selectedIndex = 2;

      panel.selectPrevious();
      expect((panel as any).selectedIndex).toBe(1);

      panel.selectPrevious();
      expect((panel as any).selectedIndex).toBe(0);

      // Should wrap
      panel.selectPrevious();
      expect((panel as any).selectedIndex).toBe(2);
    });

    it('should not navigate when no metrics', () => {
      panel.setMetrics([]);

      (panel as any).selectedIndex = 0;
      panel.selectNext();
      expect((panel as any).selectedIndex).toBe(0);

      panel.selectPrevious();
      expect((panel as any).selectedIndex).toBe(0);
    });
  });

  describe('toggleDetail', () => {
    beforeEach(() => {
      panel.setMetrics([createMockMetrics({ workerId: 'w-test' })]);
    });

    it('should switch to detail view', () => {
      (panel as any).viewMode = 'list';
      panel.toggleDetail();

      expect((panel as any).viewMode).toBe('detail');
      expect(onSelectCallback).toHaveBeenCalledWith('w-test');
    });

    it('should switch back to list view', () => {
      (panel as any).viewMode = 'detail';
      panel.toggleDetail();

      expect((panel as any).viewMode).toBe('list');
    });

    it('should not toggle when no metrics', () => {
      panel.setMetrics([]);
      (panel as any).viewMode = 'list';

      panel.toggleDetail();

      expect((panel as any).viewMode).toBe('list');
    });
  });

  describe('toggleAggregated', () => {
    it('should switch to aggregated view', () => {
      (panel as any).viewMode = 'list';
      panel.toggleAggregated();

      expect((panel as any).viewMode).toBe('aggregated');
    });

    it('should switch back from aggregated view', () => {
      (panel as any).viewMode = 'aggregated';
      panel.toggleAggregated();

      expect((panel as any).viewMode).toBe('list');
    });
  });

  describe('toggleComparison', () => {
    beforeEach(() => {
      const metrics = [
        createMockMetrics({ workerId: 'w-1' }),
        createMockMetrics({ workerId: 'w-2' }),
        createMockMetrics({ workerId: 'w-3' }),
      ];
      panel.setMetrics(metrics);
    });

    it('should switch to comparison view when 2+ workers', () => {
      (panel as any).viewMode = 'list';
      panel.toggleComparison();

      expect((panel as any).viewMode).toBe('comparison');
    });

    it('should not switch to comparison with < 2 workers', () => {
      panel.setMetrics([createMockMetrics()]);

      (panel as any).viewMode = 'list';
      panel.toggleComparison();

      expect((panel as any).viewMode).toBe('list');
    });

    it('should switch back from comparison view', () => {
      (panel as any).viewMode = 'comparison';
      panel.toggleComparison();

      expect((panel as any).viewMode).toBe('list');
    });
  });

  describe('comparison navigation', () => {
    beforeEach(() => {
      const metrics = [
        createMockMetrics({ workerId: 'w-1' }),
        createMockMetrics({ workerId: 'w-2' }),
        createMockMetrics({ workerId: 'w-3' }),
      ];
      panel.setMetrics(metrics);
      (panel as any).viewMode = 'comparison';
    });

    it('should navigate both selections together in next', () => {
      const before1 = (panel as any).selectedIndex;
      const before2 = (panel as any).secondSelectedIndex;

      panel.selectNextComparison();

      expect((panel as any).selectedIndex).toBe((before1 + 1) % 3);
      expect((panel as any).secondSelectedIndex).toBe((before2 + 1) % 3);
    });

    it('should navigate both selections together in previous', () => {
      (panel as any).selectedIndex = 0;
      (panel as any).secondSelectedIndex = 1;

      panel.selectPreviousComparison();

      expect((panel as any).selectedIndex).toBe(2);
      expect((panel as any).secondSelectedIndex).toBe(0);
    });
  });

  describe('getSelected', () => {
    it('should return selected worker metrics', () => {
      const metrics = [createMockMetrics({ workerId: 'w-selected' })];
      panel.setMetrics(metrics);

      const selected = panel.getSelected();
      expect(selected?.workerId).toBe('w-selected');
    });

    it('should return undefined when no metrics', () => {
      panel.setMetrics([]);

      expect(panel.getSelected()).toBeUndefined();
    });
  });

  describe('show/hide/isVisible', () => {
    it('should show the panel', () => {
      panel.show();
      expect(mockBoxInstance.show).toHaveBeenCalled();
      expect(mockListInstance.focus).toHaveBeenCalled();
    });

    it('should hide the panel', () => {
      panel.hide();
      expect(mockBoxInstance.hide).toHaveBeenCalled();
    });

    it('should return visibility state', () => {
      mockBoxInstance.visible = false;
      expect(panel.isVisible()).toBe(false);

      mockBoxInstance.visible = true;
      expect(panel.isVisible()).toBe(true);
    });
  });

  describe('focus', () => {
    it('should focus the list element', () => {
      panel.focus();
      expect(mockListInstance.focus).toHaveBeenCalled();
    });
  });

  describe('getElement', () => {
    it('should return the box element', () => {
      const element = panel.getElement();
      expect(element).toBe(mockBoxInstance);
    });
  });

  describe('key bindings', () => {
    it('should bind up/k keys', () => {
      const keyCalls = mockListInstance.key.mock.calls;
      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && (call[0].includes('up') || call[0].includes('k'))
      )).toBe(true);
    });

    it('should bind down/j keys', () => {
      const keyCalls = mockListInstance.key.mock.calls;
      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && (call[0].includes('down') || call[0].includes('j'))
      )).toBe(true);
    });

    it('should bind left/h keys', () => {
      const keyCalls = mockListInstance.key.mock.calls;
      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && (call[0].includes('left') || call[0].includes('h'))
      )).toBe(true);
    });

    it('should bind right/l keys', () => {
      const keyCalls = mockListInstance.key.mock.calls;
      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && (call[0].includes('right') || call[0].includes('l'))
      )).toBe(true);
    });

    it('should bind enter/space keys', () => {
      const keyCalls = mockListInstance.key.mock.calls;
      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && (call[0].includes('enter') || call[0].includes('space'))
      )).toBe(true);
    });

    it('should bind a key for aggregated', () => {
      const keyCalls = mockListInstance.key.mock.calls;
      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && call[0].includes('a')
      )).toBe(true);
    });

    it('should bind c key for comparison', () => {
      const keyCalls = mockListInstance.key.mock.calls;
      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && call[0].includes('c')
      )).toBe(true);
    });

    it('should bind s key for sort', () => {
      const keyCalls = mockListInstance.key.mock.calls;
      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && call[0].includes('s')
      )).toBe(true);
    });

    it('should bind r key for refresh', () => {
      const keyCalls = mockListInstance.key.mock.calls;
      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && call[0].includes('r')
      )).toBe(true);
    });

    it('should bind escape key', () => {
      const keyCalls = mockListInstance.key.mock.calls;
      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && call[0].includes('escape')
      )).toBe(true);
    });
  });

  describe('render output formatting', () => {
    it('should render list items with metrics', () => {
      const metrics = [createMockMetrics({ workerId: 'w-abc123' })];
      panel.setMetrics(metrics);

      expect(mockListInstance.setItems).toHaveBeenCalled();
    });

    it('should update label with sort mode', () => {
      panel.setMetrics([]);

      const label = mockBoxInstance.setLabel.mock.calls[mockBoxInstance.setLabel.mock.calls.length - 1][0];
      expect(label).toContain('sort: Beads');
    });

    it('should render detail box with worker info', () => {
      const metrics = [createMockMetrics({ workerId: 'w-test' })];
      panel.setMetrics(metrics);

      expect(mockSubBox.setContent).toHaveBeenCalled();
    });

    it('should render aggregated view', () => {
      const aggregated = createMockAggregated();
      panel.setAggregated(aggregated);
      (panel as any).viewMode = 'aggregated';

      panel.render();

      expect(mockListInstance.hide).toHaveBeenCalled();
      expect(mockSubBox.setContent).toHaveBeenCalled();
    });

    it('should render comparison view', () => {
      const metrics = [
        createMockMetrics({ workerId: 'w-1' }),
        createMockMetrics({ workerId: 'w-2' }),
      ];
      panel.setMetrics(metrics);
      (panel as any).viewMode = 'comparison';

      panel.render();

      expect(mockListInstance.hide).toHaveBeenCalled();
      expect(mockSubBox.setContent).toHaveBeenCalled();
    });
  });

  describe('trend rendering', () => {
    it('should handle improving trend', () => {
      const metrics = [createMockMetrics({
        trend: {
          direction: 'improving',
          confidence: 0.9,
          factors: ['faster'],
        },
      })];
      panel.setMetrics(metrics);

      expect(mockSubBox.setContent).toHaveBeenCalled();
    });

    it('should handle declining trend', () => {
      const metrics = [createMockMetrics({
        trend: {
          direction: 'declining',
          confidence: 0.8,
          factors: ['slower'],
        },
      })];
      panel.setMetrics(metrics);

      expect(mockSubBox.setContent).toHaveBeenCalled();
    });

    it('should handle stable trend', () => {
      const metrics = [createMockMetrics({
        trend: {
          direction: 'stable',
          confidence: 0.95,
          factors: [],
        },
      })];
      panel.setMetrics(metrics);

      expect(mockSubBox.setContent).toHaveBeenCalled();
    });

    it('should handle missing trend', () => {
      const metrics = [createMockMetrics({ trend: undefined })];
      panel.setMetrics(metrics);

      expect(mockSubBox.setContent).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle empty metrics array', () => {
      panel.setMetrics([]);

      expect(mockListInstance.setItems).toHaveBeenCalled();
      const items = mockListInstance.setItems.mock.calls[0][0];
      expect(items[0]).toContain('No worker metrics');
    });

    it('should handle very long worker IDs', () => {
      const metrics = [createMockMetrics({ workerId: 'w-verylongworkeridthatexceedsnormal' })];
      panel.setMetrics(metrics);

      expect(mockListInstance.setItems).toHaveBeenCalled();
    });

    it('should handle very large cost values', () => {
      const metrics = [createMockMetrics({ costPerBead: 1000, totalCostUsd: 10000 })];
      panel.setMetrics(metrics);

      expect(mockSubBox.setContent).toHaveBeenCalled();
    });

    it('should handle very small cost values', () => {
      const metrics = [createMockMetrics({ costPerBead: 0.001, totalCostUsd: 0.01 })];
      panel.setMetrics(metrics);

      expect(mockSubBox.setContent).toHaveBeenCalled();
    });

    it('should handle zero error rate', () => {
      const metrics = [createMockMetrics({ errorRate: 0, errorCount: 0 })];
      panel.setMetrics(metrics);

      expect(mockSubBox.setContent).toHaveBeenCalled();
    });

    it('should handle 100% error rate', () => {
      const metrics = [createMockMetrics({ errorRate: 1.0 })];
      panel.setMetrics(metrics);

      expect(mockSubBox.setContent).toHaveBeenCalled();
    });

    it('should handle extreme durations', () => {
      const metrics = [createMockMetrics({
        avgCompletionTimeMs: 0,
        activeTimeMs: 1,
        idleTimeMs: 1,
      })];
      panel.setMetrics(metrics);

      expect(mockSubBox.setContent).toHaveBeenCalled();
    });
  });

  describe('regression tests', () => {
    it('should not regress list item format', () => {
      const metrics = [createMockMetrics({ workerId: 'w-test' })];
      panel.setMetrics(metrics);

      const items = mockListInstance.setItems.mock.calls[0][0];
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]).toContain('B:'); // Beads column
      expect(items[0]).toContain('/h'); // Per hour
    });

    it('should not regress detail view format', () => {
      const metrics = [createMockMetrics()];
      panel.setMetrics(metrics);

      const content = mockSubBox.setContent.mock.calls[0][0];
      expect(content).toContain('Performance Metrics:');
      expect(content).toContain('Error Tracking:');
      expect(content).toContain('Cost Analysis:');
    });

    it('should not regress status colors', () => {
      const lowError = createMockMetrics({ errorRate: 0.01 });
      const medError = createMockMetrics({ errorRate: 0.1 });
      const highError = createMockMetrics({ errorRate: 0.3 });

      panel.setMetrics([lowError, medError, highError]);

      const items = mockListInstance.setItems.mock.calls[0][0];
      expect(items.length).toBe(3);
    });

    it('should not regress comparison rendering', () => {
      const metrics = [
        createMockMetrics({ workerId: 'w-1', beadsCompleted: 10 }),
        createMockMetrics({ workerId: 'w-2', beadsCompleted: 20 }),
      ];
      panel.setMetrics(metrics);
      // Use toggleComparison to properly set up the comparison state
      panel.toggleComparison();

      const content = mockSubBox.setContent.mock.calls[mockSubBox.setContent.mock.calls.length - 1][0];
      expect(content).toContain('WORKER COMPARISON');
    });
  });
});
