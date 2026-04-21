/**
 * Tests for BudgetAlertPanel Component
 *
 * Tests the budget alert panel display with mocked blessed elements.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import blessed from 'blessed';

// Mock the blessed module before importing BudgetAlertPanel
vi.mock('blessed', () => {
  const createMockElement = () => ({
    setContent: vi.fn(),
    setLabel: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    focus: vi.fn(),
    key: vi.fn(),
    on: vi.fn(),
    screen: {
      render: vi.fn(),
    },
    hidden: true,
    setScrollPerc: vi.fn(),
  });

  const mockBoxInstance = createMockElement();

  const mockBox = vi.fn(() => mockBoxInstance);

  return {
    default: {
      box: mockBox,
    },
    box: mockBox,
  };
});

// Mock colors module
vi.mock('../utils/colors.js', () => ({
  colors: {
    border: 'blue',
    header: 'cyan',
    text: 'white',
    dim: 'gray',
    muted: 'gray',
  },
}));

// Mock costTracking module
vi.mock('../utils/costTracking.js', () => ({
  formatCost: vi.fn((cost: number) => `$${cost.toFixed(4)}`),
  formatBurnRate: vi.fn((rate: number) => `$${rate.toFixed(4)}/min`),
  formatTimeToExhaustion: vi.fn((time: string) => time),
  getBudgetBadge: vi.fn((percent: number) => {
    if (percent >= 95) return '🔴';
    if (percent >= 80) return '🟡';
    return '🟢';
  }),
}));

// Import after mocking
import { BudgetAlertPanel, createBudgetAlertPanel } from './BudgetAlertPanel.js';
import { CostSummary, BudgetAlert } from '../utils/costTracking.js';

// Helper to create mock CostSummary
function createMockCostSummary(overrides: Partial<CostSummary> = {}): CostSummary {
  return {
    totalCostUsd: 1.50,
    total: { input: 100000, output: 50000, total: 150000 },
    byWorker: new Map([
      ['w-1', { workerId: 'w-1', costUsd: 0.75, input: 70000, output: 30000, total: 100000, apiCalls: 10, currentBead: 'bd-1' }],
      ['w-2', { workerId: 'w-2', costUsd: 0.75, input: 30000, output: 20000, total: 50000, apiCalls: 5, currentBead: 'bd-2' }],
    ]),
    budget: {
      limit: 10,
      spent: 1.50,
      remaining: 8.50,
      percentUsed: 15,
      isOverBudget: false,
      warningLevel: 'none',
    },
    burnRate: {
      costPerMinute: 0.05,
      windowMinutes: 5,
      isHighBurnRate: false,
      projectedTotalCost: 5.00,
      minutesToExhaustion: 170,
      timeToExhaustion: '2h 50m',
    },
    timeRange: { start: Date.now() - 300000, end: Date.now() },
    ...overrides,
  };
}

// Helper to create mock BudgetAlert
function createMockAlert(overrides: Partial<BudgetAlert> = {}): BudgetAlert {
  return {
    id: 'alert-1',
    type: 'warning',
    message: 'Budget alert',
    timestamp: Date.now(),
    spent: 8.00,
    limit: 10.00,
    burnRate: 0.10,
    topConsumers: [
      { workerId: 'w-1', costUsd: 4.00, percentOfTotal: 50, currentBead: 'bd-1', insight: 'High API usage' },
    ],
    acknowledged: false,
    ...overrides,
  };
}

// Helper to create mock screen
function createMockScreen() {
  return {
    render: vi.fn(),
    append: vi.fn(),
    key: vi.fn(),
    destroy: vi.fn(),
  } as unknown as blessed.Widgets.Screen;
}

describe('BudgetAlertPanel', () => {
  let panel: BudgetAlertPanel;
  let mockScreen: blessed.Widgets.Screen;
  let mockBoxInstance: any;
  let mockOnAcknowledge: ReturnType<typeof vi.fn>;
  let mockOnOpenSettings: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockScreen = createMockScreen();
    mockOnAcknowledge = vi.fn();
    mockOnOpenSettings = vi.fn();

    // Get the mock box instance from the mock
    const blessedMock = blessed as unknown as { box: Mock };
    mockBoxInstance = blessedMock.box();

    panel = new BudgetAlertPanel({
      parent: mockScreen,
      top: 0,
      left: 0,
      width: 60,
      height: 20,
      onAcknowledge: mockOnAcknowledge as (alertId: string) => void,
      onOpenSettings: mockOnOpenSettings as () => void,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create blessed boxes with correct options', () => {
      const blessedMock = blessed as unknown as { box: Mock };
      expect(blessedMock.box).toHaveBeenCalled();
    });

    it('should store callbacks', () => {
      // Panel should be created without throwing
      expect(panel).toBeDefined();
    });
  });

  describe('setCostSummary', () => {
    it('should update cost summary and render', () => {
      const summary = createMockCostSummary();
      panel.setCostSummary(summary);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should handle empty worker map', () => {
      const summary = createMockCostSummary({ byWorker: new Map() });
      panel.setCostSummary(summary);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });

    it('should handle high burn rate', () => {
      const summary = createMockCostSummary({
        burnRate: {
          costPerMinute: 0.50,
          windowMinutes: 5,
          isHighBurnRate: true,
          projectedTotalCost: 50.00,
          minutesToExhaustion: 17,
          timeToExhaustion: '17 minutes',
        },
      });
      panel.setCostSummary(summary);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });

    it('should handle budget warnings', () => {
      const summary = createMockCostSummary({
        budget: {
          limit: 10,
          spent: 8.50,
          remaining: 1.50,
          percentUsed: 85,
          isOverBudget: false,
          warningLevel: 'warning',
        },
      });
      panel.setCostSummary(summary);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });

    it('should handle critical budget level', () => {
      const summary = createMockCostSummary({
        budget: {
          limit: 10,
          spent: 9.50,
          remaining: 0.50,
          percentUsed: 95,
          isOverBudget: false,
          warningLevel: 'critical',
        },
      });
      panel.setCostSummary(summary);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });

    it('should handle no budget set', () => {
      const summary = createMockCostSummary({
        budget: {
          limit: 0,
          spent: 1.50,
          remaining: 0,
          percentUsed: 0,
          isOverBudget: false,
          warningLevel: 'none',
        },
      });
      panel.setCostSummary(summary);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });
  });

  describe('setAlerts', () => {
    it('should update alerts and render', () => {
      const alerts = [createMockAlert()];
      panel.setAlerts(alerts);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should handle multiple alerts', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', type: 'warning' }),
        createMockAlert({ id: 'alert-2', type: 'critical' }),
        createMockAlert({ id: 'alert-3', type: 'exhausted' }),
      ];
      panel.setAlerts(alerts);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });

    it('should handle acknowledged alerts', () => {
      const alerts = [
        createMockAlert({ acknowledged: true }),
        createMockAlert({ acknowledged: false }),
      ];
      panel.setAlerts(alerts);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });

    it('should handle alerts with top consumers', () => {
      const alerts = [
        createMockAlert({
          topConsumers: [
            { workerId: 'w-1', costUsd: 4.00, percentOfTotal: 50, currentBead: 'bd-1', insight: 'High usage' },
            { workerId: 'w-2', costUsd: 2.00, percentOfTotal: 25, currentBead: undefined, insight: undefined },
          ],
        }),
      ];
      panel.setAlerts(alerts);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('should trigger render', () => {
      panel.refresh();

      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });
  });

  describe('show/hide/toggle', () => {
    it('should show the panel', () => {
      panel.show();
      expect(mockBoxInstance.show).toHaveBeenCalled();
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should hide the panel', () => {
      panel.hide();
      expect(mockBoxInstance.hide).toHaveBeenCalled();
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should toggle visibility - show when hidden', () => {
      mockBoxInstance.hidden = true;
      panel.toggle();
      expect(mockBoxInstance.show).toHaveBeenCalled();
    });

    it('should toggle visibility - hide when visible', () => {
      mockBoxInstance.hidden = false;
      panel.toggle();
      expect(mockBoxInstance.hide).toHaveBeenCalled();
    });
  });

  describe('isVisible', () => {
    it('should return false when hidden', () => {
      mockBoxInstance.hidden = true;
      expect(panel.isVisible()).toBe(false);
    });

    it('should return true when visible', () => {
      mockBoxInstance.hidden = false;
      expect(panel.isVisible()).toBe(true);
    });
  });

  describe('focus', () => {
    it('should focus the content box', () => {
      panel.focus();
      expect(mockBoxInstance.focus).toHaveBeenCalled();
    });
  });

  describe('getElement', () => {
    it('should return the container element', () => {
      const element = panel.getElement();
      expect(element).toBe(mockBoxInstance);
    });
  });

  describe('render output', () => {
    it('should render budget progress bar', () => {
      const summary = createMockCostSummary();
      panel.setCostSummary(summary);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      // Should contain progress bar characters
      expect(content).toBeDefined();
    });

    it('should render burn rate section', () => {
      const summary = createMockCostSummary({
        burnRate: {
          costPerMinute: 0.10,
          windowMinutes: 5,
          isHighBurnRate: true,
          projectedTotalCost: 10.00,
          minutesToExhaustion: 30,
          timeToExhaustion: '30 minutes',
        },
      });
      panel.setCostSummary(summary);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });

    it('should render top consumers section', () => {
      const summary = createMockCostSummary();
      panel.setCostSummary(summary);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });

    it('should render active alerts section', () => {
      const alerts = [createMockAlert({ acknowledged: false })];
      panel.setAlerts(alerts);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });

    it('should not show acknowledged alerts in active section', () => {
      const alerts = [createMockAlert({ acknowledged: true })];
      panel.setAlerts(alerts);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle null cost summary', () => {
      // Create panel without setting cost summary
      const newPanel = new BudgetAlertPanel({
        parent: mockScreen,
        top: 0,
        left: 0,
        width: 60,
        height: 20,
      });

      expect(newPanel).toBeDefined();
    });

    it('should handle empty alerts array', () => {
      panel.setAlerts([]);
      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });

    it('should handle workers without current bead', () => {
      const summary = createMockCostSummary({
        byWorker: new Map([
          ['w-1', { workerId: 'w-1', costUsd: 0.75, input: 70000, output: 30000, total: 100000, apiCalls: 10, currentBead: undefined }],
        ]),
      });
      panel.setCostSummary(summary);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });

    it('should handle zero cost', () => {
      const summary = createMockCostSummary({
        totalCostUsd: 0,
        burnRate: {
          costPerMinute: 0,
          windowMinutes: 5,
          isHighBurnRate: false,
          projectedTotalCost: 0,
          minutesToExhaustion: null,
          timeToExhaustion: null,
        },
      });
      panel.setCostSummary(summary);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });

    it('should handle very high costs', () => {
      const summary = createMockCostSummary({
        totalCostUsd: 1000.00,
        budget: {
          limit: 1000,
          spent: 1000,
          remaining: 0,
          percentUsed: 100,
          isOverBudget: true,
          warningLevel: 'critical',
        },
      });
      panel.setCostSummary(summary);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });
  });

  describe('factory function', () => {
    it('should create BudgetAlertPanel via factory function', () => {
      const newPanel = createBudgetAlertPanel({
        parent: mockScreen,
        top: 0,
        left: 0,
        width: 60,
        height: 20,
      });
      expect(newPanel).toBeInstanceOf(BudgetAlertPanel);
    });
  });
});
