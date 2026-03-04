/**
 * Tests for WorkerGrid Component
 *
 * Tests the worker grid display with mocked blessed elements.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import blessed from 'blessed';

// Mock the blessed module before importing WorkerGrid
vi.mock('blessed', () => {
  // Create the mock box inside the factory
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

describe('WorkerGrid', () => {
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

  describe('constructor', () => {
    it('should create a blessed box with correct options', () => {
      const blessedMock = blessed as unknown as { box: Mock };
      expect(blessedMock.box).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: mockScreen,
          top: 0,
          left: 0,
          width: '50%',
          bottom: 0,
          label: ' Workers ',
          scrollable: true,
          alwaysScroll: true,
          keys: true,
          vi: true,
          mouse: true,
        })
      );
    });

    it('should bind key handlers on construction', () => {
      // Key bindings should be registered
      expect(mockBoxInstance.key).toHaveBeenCalled();
    });
  });

  describe('updateWorkers', () => {
    it('should update workers list and render', () => {
      const workers = [
        createMockWorker({ id: 'w-abc123', status: 'active' }),
        createMockWorker({ id: 'w-def456', status: 'idle' }),
      ];

      workerGrid.updateWorkers(workers);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
      // Component calls this.box.screen.render() which is the box's internal screen reference
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should show "No workers detected" when empty', () => {
      workerGrid.updateWorkers([]);

      expect(mockBoxInstance.setContent).toHaveBeenCalledWith(
        expect.stringContaining('No workers detected')
      );
    });

    it('should show worker count in header', () => {
      const workers = [
        createMockWorker({ id: 'w-abc123' }),
        createMockWorker({ id: 'w-def456' }),
        createMockWorker({ id: 'w-ghi789' }),
      ];

      workerGrid.updateWorkers(workers);

      expect(mockBoxInstance.setContent).toHaveBeenCalledWith(
        expect.stringContaining('Total: 3 workers')
      );
    });

    it('should reset selected index if out of bounds', () => {
      // First set some workers
      workerGrid.updateWorkers([
        createMockWorker({ id: 'w-1' }),
        createMockWorker({ id: 'w-2' }),
      ]);

      // Update to fewer workers
      workerGrid.updateWorkers([createMockWorker({ id: 'w-1' })]);

      // Should not throw and selection should be valid
      const selected = workerGrid.getSelected();
      expect(selected).toBeDefined();
      expect(selected?.id).toBe('w-1');
    });
  });

  describe('selectNext', () => {
    it('should move to next worker', () => {
      const workers = [
        createMockWorker({ id: 'w-1' }),
        createMockWorker({ id: 'w-2' }),
        createMockWorker({ id: 'w-3' }),
      ];

      workerGrid.updateWorkers(workers);

      // Initially selected is first worker
      expect(workerGrid.getSelected()?.id).toBe('w-1');

      workerGrid.selectNext();
      expect(workerGrid.getSelected()?.id).toBe('w-2');
    });

    it('should wrap to first worker when at end', () => {
      const workers = [
        createMockWorker({ id: 'w-1' }),
        createMockWorker({ id: 'w-2' }),
      ];

      workerGrid.updateWorkers(workers);

      // Move to last
      workerGrid.selectNext();
      expect(workerGrid.getSelected()?.id).toBe('w-2');

      // Wrap to first
      workerGrid.selectNext();
      expect(workerGrid.getSelected()?.id).toBe('w-1');
    });

    it('should do nothing when no workers', () => {
      workerGrid.updateWorkers([]);

      // Should not throw
      expect(() => workerGrid.selectNext()).not.toThrow();
    });
  });

  describe('selectPrevious', () => {
    it('should move to previous worker', () => {
      const workers = [
        createMockWorker({ id: 'w-1' }),
        createMockWorker({ id: 'w-2' }),
        createMockWorker({ id: 'w-3' }),
      ];

      workerGrid.updateWorkers(workers);

      // Move to second
      workerGrid.selectNext();
      expect(workerGrid.getSelected()?.id).toBe('w-2');

      // Move back to first
      workerGrid.selectPrevious();
      expect(workerGrid.getSelected()?.id).toBe('w-1');
    });

    it('should wrap to last worker when at beginning', () => {
      const workers = [
        createMockWorker({ id: 'w-1' }),
        createMockWorker({ id: 'w-2' }),
      ];

      workerGrid.updateWorkers(workers);

      // At first, wrap to last
      workerGrid.selectPrevious();
      expect(workerGrid.getSelected()?.id).toBe('w-2');
    });

    it('should do nothing when no workers', () => {
      workerGrid.updateWorkers([]);

      // Should not throw
      expect(() => workerGrid.selectPrevious()).not.toThrow();
    });
  });

  describe('getSelected', () => {
    it('should return currently selected worker', () => {
      const workers = [
        createMockWorker({ id: 'w-1' }),
        createMockWorker({ id: 'w-2' }),
      ];

      workerGrid.updateWorkers(workers);
      expect(workerGrid.getSelected()?.id).toBe('w-1');

      workerGrid.selectNext();
      expect(workerGrid.getSelected()?.id).toBe('w-2');
    });

    it('should return undefined when no workers', () => {
      workerGrid.updateWorkers([]);
      expect(workerGrid.getSelected()).toBeUndefined();
    });
  });

  describe('focus', () => {
    it('should focus the box element', () => {
      workerGrid.focus();
      expect(mockBoxInstance.focus).toHaveBeenCalled();
    });
  });

  describe('getElement', () => {
    it('should return the box element', () => {
      const element = workerGrid.getElement();
      expect(element).toBe(mockBoxInstance);
    });
  });

  describe('render output', () => {
    it('should include worker status icons', () => {
      const workers = [
        createMockWorker({ id: 'w-1', status: 'active' }),
        createMockWorker({ id: 'w-2', status: 'idle' }),
        createMockWorker({ id: 'w-3', status: 'error' }),
      ];

      workerGrid.updateWorkers(workers);

      const content = mockBoxInstance.setContent.mock.calls[0][0];

      // Check for status icons
      expect(content).toContain('●'); // active
      expect(content).toContain('○'); // idle
      expect(content).toContain('✗'); // error
    });

    it('should show collision indicator when worker has collision', () => {
      const workers = [
        createMockWorker({ id: 'w-1', hasCollision: true }),
      ];

      workerGrid.updateWorkers(workers);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('⚠');
    });

    it('should not show collision indicator when no collision', () => {
      const workers = [
        createMockWorker({ id: 'w-1', hasCollision: false }),
      ];

      workerGrid.updateWorkers(workers);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).not.toContain('⚠');
    });

    it('should truncate worker ID to 12 characters', () => {
      const workers = [
        createMockWorker({ id: 'w-verylongworkerid123456' }),
      ];

      workerGrid.updateWorkers(workers);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('w-verylongwo');
    });

    it('should show selection marker on selected worker', () => {
      const workers = [
        createMockWorker({ id: 'w-1' }),
        createMockWorker({ id: 'w-2' }),
      ];

      workerGrid.updateWorkers(workers);

      const firstContent = mockBoxInstance.setContent.mock.calls[0][0];
      expect(firstContent).toContain('>'); // Selection marker

      // Select second worker
      workerGrid.selectNext();

      const secondContent = mockBoxInstance.setContent.mock.calls[1][0];
      expect(secondContent).toContain('>');
    });

    it('should include current task from lastEvent', () => {
      const workers = [
        createMockWorker({
          id: 'w-1',
          lastEvent: {
            ts: Date.now(),
            worker: 'w-1',
            level: 'info',
            msg: 'Processing bead',
            bead: 'bd-abc123',
          },
        }),
      ];

      workerGrid.updateWorkers(workers);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('bd-abc123');
      expect(content).toContain('Processing bead');
    });
  });

  describe('key bindings', () => {
    it('should bind up and k keys to selectPrevious', () => {
      expect(mockBoxInstance.key).toHaveBeenCalledWith(['up', 'k'], expect.any(Function));
    });

    it('should bind down and j keys to selectNext', () => {
      expect(mockBoxInstance.key).toHaveBeenCalledWith(['down', 'j'], expect.any(Function));
    });

    it('should bind g key to select first', () => {
      expect(mockBoxInstance.key).toHaveBeenCalledWith(['g'], expect.any(Function));

      const workers = [
        createMockWorker({ id: 'w-1' }),
        createMockWorker({ id: 'w-2' }),
        createMockWorker({ id: 'w-3' }),
      ];

      workerGrid.updateWorkers(workers);

      // Move to last worker
      workerGrid.selectNext();
      workerGrid.selectNext();
      expect(workerGrid.getSelected()?.id).toBe('w-3');

      // Find the 'g' handler and call it
      const gCall = mockBoxInstance.key.mock.calls.find((call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('g'));
      const gHandler = gCall?.[1];
      if (gHandler) {
        gHandler();
      }

      expect(workerGrid.getSelected()?.id).toBe('w-1');
    });

    it('should bind G (shift+g) key to select last', () => {
      expect(mockBoxInstance.key).toHaveBeenCalledWith(['G'], expect.any(Function));

      const workers = [
        createMockWorker({ id: 'w-1' }),
        createMockWorker({ id: 'w-2' }),
        createMockWorker({ id: 'w-3' }),
      ];

      workerGrid.updateWorkers(workers);

      // Initially at first
      expect(workerGrid.getSelected()?.id).toBe('w-1');

      // Find the 'G' handler and call it
      const GCall = mockBoxInstance.key.mock.calls.find((call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('G'));
      const GHandler = GCall?.[1];
      if (GHandler) {
        GHandler();
      }

      expect(workerGrid.getSelected()?.id).toBe('w-3');
    });
  });

  describe('edge cases', () => {
    it('should handle workers with no lastEvent', () => {
      const workers = [
        createMockWorker({
          id: 'w-1',
          lastEvent: undefined,
        }),
      ];

      // Should not throw
      expect(() => workerGrid.updateWorkers(workers)).not.toThrow();
    });

    it('should handle empty message in lastEvent', () => {
      const workers = [
        createMockWorker({
          id: 'w-1',
          lastEvent: {
            ts: Date.now(),
            worker: 'w-1',
            level: 'info',
            msg: '',
          },
        }),
      ];

      // Should not throw
      expect(() => workerGrid.updateWorkers(workers)).not.toThrow();
    });

    it('should handle very long task descriptions', () => {
      const workers = [
        createMockWorker({
          id: 'w-1',
          lastEvent: {
            ts: Date.now(),
            worker: 'w-1',
            level: 'info',
            msg: 'This is a very long task description that should be truncated to 25 characters',
            bead: 'bd-test',
          },
        }),
      ];

      workerGrid.updateWorkers(workers);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      // Message should be truncated (25 chars)
      expect(content).toContain('This is a very long ta');
    });
  });
});
