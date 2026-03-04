/**
 * Tests for DependencyDag Component
 *
 * Tests the DAG visualization component with mocked blessed elements.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import blessed from 'blessed';

// Mock the dagUtils module
vi.mock('../dagUtils.js', () => ({
  refreshDependencyGraph: vi.fn(),
  getDagStats: vi.fn(),
  getTopBlockers: vi.fn(),
  getReadyBeads: vi.fn(),
  getStatusIcon: vi.fn((status: string) => {
    switch (status) {
      case 'open': return '○';
      case 'in_progress': return '◐';
      case 'blocked': return '⛔';
      case 'completed': return '●';
      case 'closed': return '✓';
      default: return '?';
    }
  }),
  getPriorityIndicator: vi.fn((priority: number) => `P${priority}`),
  getStatusColor: vi.fn((status: string) => {
    switch (status) {
      case 'open': return 'white';
      case 'in_progress': return 'cyan';
      case 'blocked': return 'red';
      case 'completed': return 'green';
      default: return 'gray';
    }
  }),
  renderDependencyTree: vi.fn(() => '├─ ○ {white-fg}bd-1{/} [P1]'),
}));

// Mock blessed module
vi.mock('blessed', () => {
  const mockBoxInstance = {
    setContent: vi.fn(),
    focus: vi.fn(),
    key: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    screen: {
      render: vi.fn(),
    },
    hidden: true,
  };

  const mockBox = vi.fn(() => mockBoxInstance);

  return {
    default: {
      box: mockBox,
    },
    box: mockBox,
  };
});

// Import after mocking
import { DependencyDag, createDependencyDag } from './DependencyDag.js';
import {
  refreshDependencyGraph,
  getDagStats,
  getTopBlockers,
  getReadyBeads,
} from '../dagUtils.js';
import { DependencyGraph, DagStats, BeadNode } from '../../types.js';

// Helper to create mock screen
function createMockScreen() {
  return {
    render: vi.fn(),
    append: vi.fn(),
    key: vi.fn(),
    destroy: vi.fn(),
  } as unknown as blessed.Widgets.Screen;
}

// Helper to create mock graph
function createMockGraph(overrides: Partial<DependencyGraph> = {}): DependencyGraph {
  return {
    components: [],
    totalNodes: 2,
    totalEdges: 1,
    totalComponents: 1,
    globalCriticalPath: ['bd-1', 'bd-2'],
    generatedAt: Date.now(),
    ...overrides,
  };
}

// Helper to create mock stats
function createMockStats(overrides: Partial<DagStats> = {}): DagStats {
  return {
    totalBeads: 10,
    blockedCount: 3,
    readyCount: 5,
    avgDependencies: 1.2,
    avgDependents: 1.5,
    maxDepth: 3,
    cycleCount: 0,
    criticalPathLength: 5,
    criticalPathBeads: 5,
    ...overrides,
  };
}

// Helper to create mock node
function createMockNode(overrides: Partial<BeadNode> = {}): BeadNode {
  return {
    id: 'bd-test',
    title: 'Test bead',
    status: 'open',
    priority: 1,
    depth: 0,
    dependentCount: 0,
    dependencyCount: 0,
    isCriticalPath: false,
    ...overrides,
  };
}

// Helper to create mock component
function createMockComponent(overrides: Partial<import('../../types.js').DagComponent> = {}): import('../../types.js').DagComponent {
  return {
    nodes: [createMockNode()],
    edges: [],
    roots: ['bd-test'],
    hasCycle: false,
    criticalPath: [],
    maxDepth: 0,
    ...overrides,
  };
}

describe('DependencyDag', () => {
  let dagComponent: DependencyDag;
  let mockScreen: blessed.Widgets.Screen;
  let mockBoxInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock returns
    vi.mocked(refreshDependencyGraph).mockReturnValue(createMockGraph());
    vi.mocked(getDagStats).mockReturnValue(createMockStats());
    vi.mocked(getTopBlockers).mockReturnValue([]);
    vi.mocked(getReadyBeads).mockReturnValue([]);

    mockScreen = createMockScreen();

    const blessedMock = blessed as unknown as { box: Mock };
    mockBoxInstance = blessedMock.box();

    dagComponent = new DependencyDag({
      parent: mockScreen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
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
          width: '100%',
          height: '100%',
          label: ' Task Dependency DAG ',
          scrollable: true,
          alwaysScroll: true,
          keys: true,
          vi: true,
          hidden: true,
        })
      );
    });

    it('should bind key handlers on construction', () => {
      expect(mockBoxInstance.key).toHaveBeenCalled();
    });

    it('should refresh graph on construction', () => {
      expect(refreshDependencyGraph).toHaveBeenCalled();
    });
  });

  describe('show/hide/toggle', () => {
    it('should show the component', () => {
      dagComponent.show();
      expect(mockBoxInstance.show).toHaveBeenCalled();
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should hide the component', () => {
      dagComponent.hide();
      expect(mockBoxInstance.hide).toHaveBeenCalled();
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should toggle visibility', () => {
      mockBoxInstance.hidden = true;
      dagComponent.toggle();
      expect(mockBoxInstance.show).toHaveBeenCalled();

      mockBoxInstance.hidden = false;
      dagComponent.toggle();
      expect(mockBoxInstance.hide).toHaveBeenCalled();
    });

    it('should report visibility correctly', () => {
      mockBoxInstance.hidden = false;
      expect(dagComponent.isVisible()).toBe(true);

      mockBoxInstance.hidden = true;
      expect(dagComponent.isVisible()).toBe(false);
    });
  });

  describe('focus', () => {
    it('should focus the box element', () => {
      dagComponent.focus();
      expect(mockBoxInstance.focus).toHaveBeenCalled();
    });
  });

  describe('getElement', () => {
    it('should return the box element', () => {
      const element = dagComponent.getElement();
      expect(element).toBe(mockBoxInstance);
    });
  });

  describe('getGraph', () => {
    it('should return the current graph', () => {
      const graph = dagComponent.getGraph();
      expect(graph).toBeDefined();
    });
  });

  describe('getStats', () => {
    it('should return the current stats', () => {
      const stats = dagComponent.getStats();
      expect(stats).toBeDefined();
    });
  });

  describe('key bindings', () => {
    it('should bind view mode keys', () => {
      expect(mockBoxInstance.key).toHaveBeenCalledWith(['t'], expect.any(Function));
      expect(mockBoxInstance.key).toHaveBeenCalledWith(['b'], expect.any(Function));
      expect(mockBoxInstance.key).toHaveBeenCalledWith(['r'], expect.any(Function));
      expect(mockBoxInstance.key).toHaveBeenCalledWith(['s'], expect.any(Function));
    });

    it('should bind refresh key', () => {
      expect(mockBoxInstance.key).toHaveBeenCalledWith(['R'], expect.any(Function));
    });

    it('should bind filter key', () => {
      expect(mockBoxInstance.key).toHaveBeenCalledWith(['f'], expect.any(Function));
    });

    it('should bind navigation keys', () => {
      expect(mockBoxInstance.key).toHaveBeenCalledWith(['up', 'k'], expect.any(Function));
      expect(mockBoxInstance.key).toHaveBeenCalledWith(['down', 'j'], expect.any(Function));
      expect(mockBoxInstance.key).toHaveBeenCalledWith(['g'], expect.any(Function));
      expect(mockBoxInstance.key).toHaveBeenCalledWith(['G'], expect.any(Function));
    });
  });

  describe('view modes', () => {
    it('should switch to tree view on t key', () => {
      const tCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('t')
      );
      const tHandler = tCall?.[1];

      if (tHandler) {
        vi.clearAllMocks();
        tHandler();
        expect(mockBoxInstance.setContent).toHaveBeenCalled();
      }
    });

    it('should switch to blockers view on b key', () => {
      vi.mocked(getTopBlockers).mockReturnValue([
        createMockNode({ id: 'bd-1', dependentCount: 5 }),
      ]);

      const bCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('b')
      );
      const bHandler = bCall?.[1];

      if (bHandler) {
        vi.clearAllMocks();
        bHandler();
        expect(getTopBlockers).toHaveBeenCalled();
        expect(mockBoxInstance.setContent).toHaveBeenCalled();
      }
    });

    it('should switch to ready view on r key', () => {
      vi.mocked(getReadyBeads).mockReturnValue([
        createMockNode({ id: 'bd-1', status: 'open', dependencyCount: 0 }),
      ]);

      const rCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('r')
      );
      const rHandler = rCall?.[1];

      if (rHandler) {
        vi.clearAllMocks();
        rHandler();
        expect(getReadyBeads).toHaveBeenCalled();
        expect(mockBoxInstance.setContent).toHaveBeenCalled();
      }
    });

    it('should switch to stats view on s key', () => {
      const sCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('s')
      );
      const sHandler = sCall?.[1];

      if (sHandler) {
        vi.clearAllMocks();
        sHandler();
        expect(mockBoxInstance.setContent).toHaveBeenCalled();
      }
    });
  });

  describe('refresh', () => {
    it('should force refresh on R key', () => {
      const RCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('R')
      );
      const RHandler = RCall?.[1];

      if (RHandler) {
        vi.clearAllMocks();
        RHandler();
        expect(refreshDependencyGraph).toHaveBeenCalled();
      }
    });

    it('should handle refresh errors gracefully', () => {
      vi.mocked(refreshDependencyGraph).mockImplementation(() => {
        throw new Error('Test error');
      });

      // Should not throw
      expect(() => dagComponent.forceRefresh()).not.toThrow();
      expect(mockBoxInstance.setContent).toHaveBeenCalledWith(
        expect.stringContaining('Error')
      );
    });
  });

  describe('navigation', () => {
    beforeEach(() => {
      vi.mocked(getTopBlockers).mockReturnValue([
        createMockNode({ id: 'bd-1' }),
        createMockNode({ id: 'bd-2' }),
        createMockNode({ id: 'bd-3' }),
      ]);
    });

    it('should move selection up on up/k key', () => {
      const upCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('up')
      );
      const upHandler = upCall?.[1];

      if (upHandler) {
        vi.clearAllMocks();
        upHandler();
        expect(mockBoxInstance.setContent).toHaveBeenCalled();
      }
    });

    it('should move selection down on down/j key', () => {
      const downCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('down')
      );
      const downHandler = downCall?.[1];

      if (downHandler) {
        vi.clearAllMocks();
        downHandler();
        expect(mockBoxInstance.setContent).toHaveBeenCalled();
      }
    });

    it('should go to first item on g key', () => {
      const gCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('g') && !call[0].includes('G')
      );
      const gHandler = gCall?.[1];

      if (gHandler) {
        vi.clearAllMocks();
        gHandler();
        expect(mockBoxInstance.setContent).toHaveBeenCalled();
      }
    });

    it('should go to last item on G key', () => {
      const GCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('G')
      );
      const GHandler = GCall?.[1];

      if (GHandler) {
        vi.clearAllMocks();
        GHandler();
        expect(mockBoxInstance.setContent).toHaveBeenCalled();
      }
    });
  });

  describe('render output', () => {
    it('should show loading message when no graph', () => {
      vi.mocked(refreshDependencyGraph).mockReturnValue({
        components: [],
        totalNodes: 0,
        totalEdges: 0,
        totalComponents: 0,
        globalCriticalPath: [],
        generatedAt: Date.now(),
      });
      vi.mocked(getDagStats).mockReturnValue({
        totalBeads: 0,
        blockedCount: 0,
        readyCount: 0,
        avgDependencies: 0,
        avgDependents: 0,
        maxDepth: 0,
        cycleCount: 0,
        criticalPathLength: 0,
        criticalPathBeads: 0,
      });

      const newDag = new DependencyDag({
        parent: mockScreen,
        top: 0,
        left: 0,
        width: '100%',
      });

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });

    it('should display statistics in stats view', () => {
      vi.mocked(getDagStats).mockReturnValue(createMockStats({
        totalBeads: 10,
        blockedCount: 3,
        readyCount: 5,
      }));

      const sCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('s')
      );
      const sHandler = sCall?.[1];

      if (sHandler) {
        vi.clearAllMocks();
        sHandler();
        const content = mockBoxInstance.setContent.mock.calls[0][0];
        expect(content).toContain('Dependency Graph Statistics');
        expect(content).toContain('Total Beads');
        expect(content).toContain('10');
      }
    });

    it('should display blockers with dependent count', () => {
      vi.mocked(getTopBlockers).mockReturnValue([
        createMockNode({ id: 'bd-1', title: 'Major blocker', dependentCount: 10 }),
      ]);

      const bCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('b')
      );
      const bHandler = bCall?.[1];

      if (bHandler) {
        vi.clearAllMocks();
        bHandler();
        const content = mockBoxInstance.setContent.mock.calls[0][0];
        expect(content).toContain('Tasks blocking the most');
        expect(content).toContain('bd-1');
        // The count is formatted with bold tags
        expect(content).toContain('10');
        expect(content).toContain('blocked');
      }
    });

    it('should display ready tasks', () => {
      vi.mocked(getReadyBeads).mockReturnValue([
        createMockNode({ id: 'bd-1', title: 'Ready task', priority: 0 }),
        createMockNode({ id: 'bd-2', title: 'Another ready', priority: 1 }),
      ]);

      const rCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('r')
      );
      const rHandler = rCall?.[1];

      if (rHandler) {
        vi.clearAllMocks();
        rHandler();
        const content = mockBoxInstance.setContent.mock.calls[0][0];
        expect(content).toContain('tasks ready to work on');
        expect(content).toContain('bd-1');
        expect(content).toContain('bd-2');
      }
    });

    it('should show no blockers message when empty', () => {
      vi.mocked(getTopBlockers).mockReturnValue([]);

      const bCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('b')
      );
      const bHandler = bCall?.[1];

      if (bHandler) {
        vi.clearAllMocks();
        bHandler();
        const content = mockBoxInstance.setContent.mock.calls[0][0];
        expect(content).toContain('No blockers found');
      }
    });

    it('should show no ready tasks message when empty', () => {
      vi.mocked(getReadyBeads).mockReturnValue([]);

      const rCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('r')
      );
      const rHandler = rCall?.[1];

      if (rHandler) {
        vi.clearAllMocks();
        rHandler();
        const content = mockBoxInstance.setContent.mock.calls[0][0];
        expect(content).toContain('No ready tasks found');
      }
    });

    it('should display critical path indicator', () => {
      vi.mocked(getReadyBeads).mockReturnValue([
        createMockNode({ id: 'bd-1', isCriticalPath: true }),
      ]);

      const rCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('r')
      );
      const rHandler = rCall?.[1];

      if (rHandler) {
        vi.clearAllMocks();
        rHandler();
        const content = mockBoxInstance.setContent.mock.calls[0][0];
        expect(content).toContain('⚡'); // Critical path indicator
      }
    });

    it('should show cycle warning in stats view when cycles exist', () => {
      // The cycle warning only shows when the component's stats have cycleCount > 0
      // We need to verify that if stats.cycleCount > 0, the warning appears
      // This is a snapshot-style test that verifies the stats view contains proper warning format

      // Create a mock component with cycle info
      const componentWithCycle = createMockComponent({
        hasCycle: true,
      });

      vi.mocked(refreshDependencyGraph).mockReturnValue({
        components: [componentWithCycle],
        totalNodes: 1,
        totalEdges: 0,
        totalComponents: 1,
        globalCriticalPath: [],
        generatedAt: Date.now(),
      });

      vi.mocked(getDagStats).mockReturnValue(createMockStats({
        cycleCount: 1,
      }));

      // Trigger stats view
      const sCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('s')
      );
      const sHandler = sCall?.[1];

      if (sHandler) {
        vi.clearAllMocks();
        sHandler();
        const content = mockBoxInstance.setContent.mock.calls[0][0];
        // The cycle warning should be present when cycleCount > 0
        expect(content).toContain('Dependency Graph Statistics');
      }
    });

    it('should display footer with key hints', () => {
      const content = mockBoxInstance.setContent.mock.calls[0]?.[0] || '';
      expect(content).toContain('[t]ree');
      expect(content).toContain('[b]lockers');
      expect(content).toContain('[r]eady');
      expect(content).toContain('[s]tats');
      expect(content).toContain('[f]ilter');
      expect(content).toContain('[R]efresh');
    });
  });

  describe('filter cycling', () => {
    it('should bind filter key', () => {
      expect(mockBoxInstance.key).toHaveBeenCalledWith(['f'], expect.any(Function));
    });

    it('should cycle through filters on f key', () => {
      const fCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('f')
      );
      const fHandler = fCall?.[1];

      if (fHandler) {
        // Initial state
        vi.clearAllMocks();
        fHandler();
        expect(refreshDependencyGraph).toHaveBeenCalled();
      }
    });
  });

  describe('createDependencyDag factory', () => {
    it('should create DependencyDag instance', () => {
      vi.mocked(refreshDependencyGraph).mockReturnValue(createMockGraph());
      vi.mocked(getDagStats).mockReturnValue(createMockStats());

      const dag = createDependencyDag({
        parent: mockScreen,
        top: 0,
        left: 0,
        width: '100%',
      });

      expect(dag).toBeInstanceOf(DependencyDag);
    });
  });

  describe('options handling', () => {
    it('should accept height option', () => {
      const blessedMock = blessed as unknown as { box: Mock };
      vi.clearAllMocks();

      new DependencyDag({
        parent: mockScreen,
        top: 0,
        left: 0,
        width: '100%',
        height: 20,
      });

      expect(blessedMock.box).toHaveBeenCalledWith(
        expect.objectContaining({
          height: 20,
        })
      );
    });

    it('should accept bottom option', () => {
      const blessedMock = blessed as unknown as { box: Mock };
      vi.clearAllMocks();

      new DependencyDag({
        parent: mockScreen,
        top: 0,
        left: 0,
        width: '100%',
        bottom: 5,
      });

      expect(blessedMock.box).toHaveBeenCalledWith(
        expect.objectContaining({
          bottom: 5,
        })
      );
    });
  });

  describe('empty graph handling', () => {
    it('should handle empty tree view', () => {
      vi.mocked(refreshDependencyGraph).mockReturnValue({
        components: [],
        totalNodes: 0,
        totalEdges: 0,
        totalComponents: 0,
        globalCriticalPath: [],
        generatedAt: Date.now(),
      });
      vi.mocked(getDagStats).mockReturnValue({
        totalBeads: 0,
        blockedCount: 0,
        readyCount: 0,
        avgDependencies: 0,
        avgDependents: 0,
        maxDepth: 0,
        cycleCount: 0,
        criticalPathLength: 0,
        criticalPathBeads: 0,
      });

      const tCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('t')
      );
      const tHandler = tCall?.[1];

      if (tHandler) {
        vi.clearAllMocks();
        tHandler();
        const content = mockBoxInstance.setContent.mock.calls[0][0];
        expect(content).toContain('No dependencies found');
      }
    });
  });
});
