/**
 * Tests for WorkerDetail Component
 *
 * Tests the worker detail panel display with mocked blessed elements.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import blessed from 'blessed';

// Mock the blessed module before importing WorkerDetail
vi.mock('blessed', () => {
  const mockBoxInstance = {
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
  };

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
  },
  getStatusColor: vi.fn((status: string) => {
    switch (status) {
      case 'active': return 'light-green';
      case 'idle': return 'light-yellow';
      case 'error': return 'light-red';
      default: return 'white';
    }
  }),
  getLevelColor: vi.fn((level: string) => {
    switch (level) {
      case 'debug': return 'gray';
      case 'info': return 'white';
      case 'warn': return 'yellow';
      case 'error': return 'red';
      default: return 'white';
    }
  }),
}));

// Import after mocking
import { WorkerDetail, createWorkerDetail } from './WorkerDetail.js';
import { WorkerInfo, LogEvent } from '../../types.js';

// Helper to create mock WorkerInfo
function createMockWorker(overrides: Partial<WorkerInfo> = {}): WorkerInfo {
  return {
    id: 'w-test123',
    status: 'active',
    beadsCompleted: 5,
    firstSeen: Date.now() - 60000,
    lastActivity: Date.now(),
    activeFiles: ['/src/test.ts'],
    hasCollision: false,
    activeDirectories: ['/src'],
    collisionTypes: [],
    eventCount: 10,
    ...overrides,
  };
}

// Helper to create mock LogEvent
function createMockEvent(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    ts: Date.now(),
    worker: 'w-test123',
    level: 'info',
    msg: 'Test event',
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

describe('WorkerDetail', () => {
  let workerDetail: WorkerDetail;
  let mockScreen: blessed.Widgets.Screen;
  let mockBoxInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockScreen = createMockScreen();

    // Get the mock box instance from the mock
    const blessedMock = blessed as unknown as { box: Mock };
    mockBoxInstance = blessedMock.box();

    workerDetail = new WorkerDetail({
      parent: mockScreen,
      top: 0,
      left: 0,
      width: 50,
      height: 20,
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
          width: 50,
          height: 20,
          label: ' Worker Details ',
          scrollable: true,
          alwaysScroll: true,
          keys: true,
          vi: true,
          hidden: true,
        })
      );
    });
  });

  describe('setWorker', () => {
    it('should update worker and render', () => {
      const worker = createMockWorker();
      workerDetail.setWorker(worker);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should show no worker message when null', () => {
      workerDetail.setWorker(null);

      expect(mockBoxInstance.setContent).toHaveBeenCalledWith(
        expect.stringContaining('No worker selected')
      );
    });
  });

  describe('setRecentEvents', () => {
    it('should store recent events and render', () => {
      const events = [
        createMockEvent({ msg: 'Event 1' }),
        createMockEvent({ msg: 'Event 2' }),
      ];

      workerDetail.setWorker(createMockWorker());
      vi.clearAllMocks();

      workerDetail.setRecentEvents(events);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should limit to last 20 events', () => {
      const events = Array.from({ length: 30 }, (_, i) =>
        createMockEvent({ msg: `Event ${i}` })
      );

      workerDetail.setWorker(createMockWorker());
      workerDetail.setRecentEvents(events);

      // Should not throw
      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });
  });

  describe('show/hide/toggle', () => {
    it('should show the panel', () => {
      workerDetail.show();
      expect(mockBoxInstance.show).toHaveBeenCalled();
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should hide the panel', () => {
      workerDetail.hide();
      expect(mockBoxInstance.hide).toHaveBeenCalled();
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should toggle visibility', () => {
      // Initially hidden
      workerDetail.toggle();
      expect(mockBoxInstance.show).toHaveBeenCalled();

      vi.clearAllMocks();

      // Now visible, toggle should hide
      mockBoxInstance.hidden = false;
      workerDetail.toggle();
      expect(mockBoxInstance.hide).toHaveBeenCalled();
    });
  });

  describe('isVisible', () => {
    it('should return false when hidden', () => {
      mockBoxInstance.hidden = true;
      expect(workerDetail.isVisible()).toBe(false);
    });

    it('should return true when visible', () => {
      mockBoxInstance.hidden = false;
      expect(workerDetail.isVisible()).toBe(true);
    });
  });

  describe('focus', () => {
    it('should focus the box element', () => {
      workerDetail.focus();
      expect(mockBoxInstance.focus).toHaveBeenCalled();
    });
  });

  describe('getElement', () => {
    it('should return the box element', () => {
      const element = workerDetail.getElement();
      expect(element).toBe(mockBoxInstance);
    });
  });

  describe('render output', () => {
    it('should render worker status with correct icon', () => {
      const worker = createMockWorker({ status: 'active' });
      workerDetail.setWorker(worker);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('●'); // active icon
    });

    it('should render idle worker with correct icon', () => {
      const worker = createMockWorker({ status: 'idle' });
      workerDetail.setWorker(worker);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('○'); // idle icon
    });

    it('should render error worker with correct icon', () => {
      const worker = createMockWorker({ status: 'error' });
      workerDetail.setWorker(worker);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('✗'); // error icon
    });

    it('should include beads completed count', () => {
      const worker = createMockWorker({ beadsCompleted: 42 });
      workerDetail.setWorker(worker);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('42');
    });

    it('should include last event info when present', () => {
      const worker = createMockWorker({
        lastEvent: {
          ts: Date.now(),
          worker: 'w-test123',
          level: 'info',
          msg: 'Processing bead',
          bead: 'bd-abc123',
          tool: 'Read',
        },
      });
      workerDetail.setWorker(worker);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('bd-abc123');
      expect(content).toContain('Read');
    });

    it('should include error info when present', () => {
      const worker = createMockWorker({
        lastEvent: {
          ts: Date.now(),
          worker: 'w-test123',
          level: 'error',
          msg: 'Something failed',
          error: 'Test error message',
        },
      });
      workerDetail.setWorker(worker);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('Test error message');
    });

    it('should include duration when present', () => {
      const worker = createMockWorker({
        lastEvent: {
          ts: Date.now(),
          worker: 'w-test123',
          level: 'info',
          msg: 'Completed',
          duration_ms: 1500,
        },
      });
      workerDetail.setWorker(worker);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('1.5s');
    });

    it('should show recent events section when events present', () => {
      workerDetail.setWorker(createMockWorker());
      workerDetail.setRecentEvents([
        createMockEvent({ msg: 'Recent event 1' }),
        createMockEvent({ msg: 'Recent event 2' }),
      ]);

      const lastCall = mockBoxInstance.setContent.mock.calls[
        mockBoxInstance.setContent.mock.calls.length - 1
      ];
      const content = lastCall[0];
      expect(content).toContain('Recent Events');
    });

    it('should show no events message when no last event', () => {
      const worker = createMockWorker();
      delete worker.lastEvent;
      workerDetail.setWorker(worker);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('No events recorded');
    });
  });

  describe('edge cases', () => {
    it('should handle worker with no active files', () => {
      const worker = createMockWorker({ activeFiles: [] });
      expect(() => workerDetail.setWorker(worker)).not.toThrow();
    });

    it('should handle worker with many active files', () => {
      const worker = createMockWorker({
        activeFiles: Array.from({ length: 20 }, (_, i) => `/src/file${i}.ts`),
      });
      expect(() => workerDetail.setWorker(worker)).not.toThrow();
    });

    it('should handle worker with collision', () => {
      const worker = createMockWorker({
        hasCollision: true,
        collisionTypes: ['file', 'task'],
      });
      expect(() => workerDetail.setWorker(worker)).not.toThrow();
    });

    it('should handle very long worker ID', () => {
      const worker = createMockWorker({ id: 'w-verylongworkeridthatexceedsnormal' });
      expect(() => workerDetail.setWorker(worker)).not.toThrow();
    });

    it('should handle events with empty messages', () => {
      workerDetail.setWorker(createMockWorker());
      workerDetail.setRecentEvents([
        createMockEvent({ msg: '' }),
      ]);
      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });

    it('should handle events with all log levels', () => {
      const levels: Array<'debug' | 'info' | 'warn' | 'error'> = ['debug', 'info', 'warn', 'error'];

      for (const level of levels) {
        workerDetail.setWorker(createMockWorker());
        workerDetail.setRecentEvents([createMockEvent({ level })]);
        expect(mockBoxInstance.setContent).toHaveBeenCalled();
      }
    });
  });

  describe('factory function', () => {
    it('should create WorkerDetail via factory function', () => {
      const detail = createWorkerDetail({
        parent: mockScreen,
        top: 0,
        left: 0,
        width: 50,
        height: 20,
      });
      expect(detail).toBeInstanceOf(WorkerDetail);
    });
  });
});
