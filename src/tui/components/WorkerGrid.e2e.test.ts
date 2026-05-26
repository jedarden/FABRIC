/**
 * E2E Test: WorkerGrid Status Colors
 *
 * Verifies that WorkerGrid component renders worker entries with correct
 * status colors: green for active, yellow for idle, red for error.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import blessed from 'blessed';

// Mock the blessed module before importing WorkerGrid
vi.mock('blessed', () => {
  // Create the mock box instance
  const mockBoxInstance = {
    setContent: vi.fn(),
    focus: vi.fn(),
    key: vi.fn(),
    screen: {
      render: vi.fn(),
    },
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
import { WorkerGrid } from './WorkerGrid.js';
import { WorkerInfo } from '../../types.js';

// Helper to create mock WorkerInfo
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
    currentBead: null,
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

describe('E2E: WorkerGrid Status Colors', () => {
  let workerGrid: WorkerGrid;
  let mockScreen: blessed.Widgets.Screen;
  let mockBoxInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockScreen = createMockScreen();

    // Get the mock box instance from the mock
    const blessedMock = blessed as unknown as { box: Mock };
    mockBoxInstance = blessedMock.box();

    workerGrid = new WorkerGrid({
      parent: mockScreen,
      top: 0,
      left: 0,
      width: '50%',
      bottom: 0,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('status color rendering', () => {
    it('should render active workers with green color', () => {
      const workers = [
        createMockWorker({ id: 'w-active-1', status: 'active' }),
        createMockWorker({ id: 'w-active-2', status: 'active' }),
      ];

      workerGrid.updateWorkers(workers);

      const content = mockBoxInstance.setContent.mock.calls[0][0];

      // Should contain green color tag for active status
      expect(content).toContain('{light-green-fg}');
    });

    it('should render idle workers with yellow color', () => {
      const workers = [
        createMockWorker({ id: 'w-idle-1', status: 'idle' }),
        createMockWorker({ id: 'w-idle-2', status: 'idle' }),
      ];

      workerGrid.updateWorkers(workers);

      const content = mockBoxInstance.setContent.mock.calls[0][0];

      // Should contain yellow color tag for idle status
      expect(content).toContain('{light-yellow-fg}');
    });

    it('should render error workers with red color', () => {
      const workers = [
        createMockWorker({ id: 'w-error-1', status: 'error' }),
        createMockWorker({ id: 'w-error-2', status: 'error' }),
      ];

      workerGrid.updateWorkers(workers);

      const content = mockBoxInstance.setContent.mock.calls[0][0];

      // Should contain red color tag for error status
      expect(content).toContain('{light-red-fg}');
    });

    it('should render mixed status workers with correct colors', () => {
      const workers = [
        createMockWorker({ id: 'w-active', status: 'active' }),
        createMockWorker({ id: 'w-idle', status: 'idle' }),
        createMockWorker({ id: 'w-error', status: 'error' }),
      ];

      workerGrid.updateWorkers(workers);

      const content = mockBoxInstance.setContent.mock.calls[0][0];

      // Should contain all three color tags
      expect(content).toContain('{light-green-fg}');  // active
      expect(content).toContain('{light-yellow-fg}'); // idle
      expect(content).toContain('{light-red-fg}');    // error
    });

    it('should apply color tags to status icons only', () => {
      const workers = [
        createMockWorker({ id: 'w-1', status: 'active' }),
      ];

      workerGrid.updateWorkers(workers);

      const content = mockBoxInstance.setContent.mock.calls[0][0];

      // Color tag should be followed by closing tag
      expect(content).toMatch(/\{light-green-fg\}●{\/}/);
    });
  });

  describe('status icons with colors', () => {
    it('should display active status icon with green color', () => {
      const workers = [createMockWorker({ id: 'w-1', status: 'active' })];

      workerGrid.updateWorkers(workers);

      const content = mockBoxInstance.setContent.mock.calls[0][0];

      // Active uses filled circle ● with green
      expect(content).toContain('{light-green-fg}●');
    });

    it('should display idle status icon with yellow color', () => {
      const workers = [createMockWorker({ id: 'w-1', status: 'idle' })];

      workerGrid.updateWorkers(workers);

      const content = mockBoxInstance.setContent.mock.calls[0][0];

      // Idle uses hollow circle ○ with yellow
      expect(content).toContain('{light-yellow-fg}○');
    });

    it('should display error status icon with red color', () => {
      const workers = [createMockWorker({ id: 'w-1', status: 'error' })];

      workerGrid.updateWorkers(workers);

      const content = mockBoxInstance.setContent.mock.calls[0][0];

      // Error uses X mark ✗ with red
      expect(content).toContain('{light-red-fg}✗');
    });
  });

  describe('worker entry formatting', () => {
    it('should include worker ID with status color line', () => {
      const workers = [createMockWorker({ id: 'w-abc123xyz', status: 'active' })];

      workerGrid.updateWorkers(workers);

      const content = mockBoxInstance.setContent.mock.calls[0][0];

      // Should contain truncated worker ID
      expect(content).toContain('w-abc123xyz');
      // Should contain active color tag
      expect(content).toContain('{light-green-fg}');
    });

    it('should display worker count in header', () => {
      const workers = [
        createMockWorker({ id: 'w-1', status: 'active' }),
        createMockWorker({ id: 'w-2', status: 'idle' }),
        createMockWorker({ id: 'w-3', status: 'error' }),
      ];

      workerGrid.updateWorkers(workers);

      const content = mockBoxInstance.setContent.mock.calls[0][0];

      // Should show total count
      expect(content).toContain('Total: 3 workers');
    });
  });

  describe('color consistency across updates', () => {
    it('should maintain colors when workers change status', () => {
      // Start with active worker
      let workers = [createMockWorker({ id: 'w-1', status: 'active' })];
      workerGrid.updateWorkers(workers);

      let content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('{light-green-fg}');

      // Change to idle
      workers = [createMockWorker({ id: 'w-1', status: 'idle' })];
      workerGrid.updateWorkers(workers);

      content = mockBoxInstance.setContent.mock.calls[1][0];
      expect(content).toContain('{light-yellow-fg}');
      expect(content).not.toContain('{light-green-fg}');

      // Change to error
      workers = [createMockWorker({ id: 'w-1', status: 'error' })];
      workerGrid.updateWorkers(workers);

      content = mockBoxInstance.setContent.mock.calls[2][0];
      expect(content).toContain('{light-red-fg}');
      expect(content).not.toContain('{light-yellow-fg}');
    });

    it('should handle empty worker list', () => {
      workerGrid.updateWorkers([]);

      const content = mockBoxInstance.setContent.mock.calls[0][0];

      // Should show empty state message
      expect(content).toContain('No workers detected');
    });
  });

  describe('complete workflow', () => {
    it('should handle realistic worker status scenario', () => {
      // Simulate realistic multi-worker scenario
      const workers = [
        createMockWorker({
          id: 'w-claude-001',
          status: 'active',
          lastEvent: {
            ts: Date.now(),
            worker: 'w-claude-001',
            level: 'info',
            msg: 'Processing bead bd-abc123',
            bead: 'bd-abc123',
          },
        }),
        createMockWorker({
          id: 'w-claude-002',
          status: 'idle',
          lastEvent: {
            ts: Date.now() - 30000,
            worker: 'w-claude-002',
            level: 'info',
            msg: 'Waiting for work',
          },
        }),
        createMockWorker({
          id: 'w-claude-003',
          status: 'error',
          lastEvent: {
            ts: Date.now() - 10000,
            worker: 'w-claude-003',
            level: 'error',
            msg: 'Connection failed',
          },
        }),
      ];

      workerGrid.updateWorkers(workers);

      const content = mockBoxInstance.setContent.mock.calls[0][0];

      // Verify all status colors are present
      expect(content).toContain('{light-green-fg}');   // active worker
      expect(content).toContain('{light-yellow-fg}');  // idle worker
      expect(content).toContain('{light-red-fg}');     // error worker

      // Verify worker IDs are present
      expect(content).toContain('w-claude-001');
      expect(content).toContain('w-claude-002');
      expect(content).toContain('w-claude-003');

      // Verify bead/task info
      expect(content).toContain('bd-abc123');
      expect(content).toContain('Processing bead');
    });
  });
});
