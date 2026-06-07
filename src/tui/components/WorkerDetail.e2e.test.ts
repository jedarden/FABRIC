/**
 * E2E Test: WorkerDetail Panel
 *
 * Verifies that WorkerDetail panel shows correct information for a selected
 * worker including status, uptime, beads completed, and recent events.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import blessed from 'blessed';

// Mock the blessed module before importing WorkerDetail
vi.mock('blessed', () => {
  const mockBoxInstance = {
    setContent: vi.fn(),
    focus: vi.fn(),
    key: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    hidden: true,
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
import { WorkerDetail } from './WorkerDetail.js';
import { WorkerInfo, LogEvent } from '../../types.js';

// Helper to create mock WorkerInfo
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

// Helper to create mock LogEvent
function createMockEvent(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    ts: Date.now(),
    worker: 'w-test123',
    level: 'info',
    msg: 'Test event message',
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

describe('E2E: WorkerDetail Panel', () => {
  let detail: WorkerDetail;
  let mockScreen: blessed.Widgets.Screen;
  let mockBoxInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockScreen = createMockScreen();

    // Get the mock box instance from the mock
    const blessedMock = blessed as unknown as { box: Mock };
    mockBoxInstance = blessedMock.box();

    detail = new WorkerDetail({
      parent: mockScreen,
      top: 0,
      left: '50%',
      width: '50%',
      height: '100%',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function getRenderedContent(): string {
    const calls = mockBoxInstance.setContent.mock.calls;
    return calls[calls.length - 1][0];
  }

  describe('no worker selected', () => {
    it('should show placeholder when no worker is set', () => {
      detail.render();
      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toBe('{gray-fg}No worker selected{/}');
    });

    it('should re-show placeholder when worker is set to null', () => {
      detail.setWorker(createMockWorker());
      detail.setWorker(null);

      const content = getRenderedContent();
      expect(content).toBe('{gray-fg}No worker selected{/}');
    });
  });

  describe('worker status display', () => {
    it('should show active status with green color and filled circle', () => {
      detail.setWorker(createMockWorker({ id: 'w-active-1', status: 'active' }));

      const content = getRenderedContent();
      expect(content).toContain('{light-green-fg}{bold}● w-active-1{/}');
      expect(content).toContain('State:');
      expect(content).toContain('{light-green-fg}ACTIVE{/}');
    });

    it('should show idle status with yellow color and hollow circle', () => {
      detail.setWorker(createMockWorker({ id: 'w-idle-1', status: 'idle' }));

      const content = getRenderedContent();
      expect(content).toContain('{light-yellow-fg}{bold}○ w-idle-1{/}');
      expect(content).toContain('{light-yellow-fg}IDLE{/}');
    });

    it('should show error status with red color and X mark', () => {
      detail.setWorker(createMockWorker({ id: 'w-error-1', status: 'error' }));

      const content = getRenderedContent();
      expect(content).toContain('{light-red-fg}{bold}✗ w-error-1{/}');
      expect(content).toContain('{light-red-fg}ERROR{/}');
    });
  });

  describe('uptime display', () => {
    it('should show uptime in seconds for recent workers', () => {
      detail.setWorker(createMockWorker({ firstSeen: Date.now() - 30000 }));

      const content = getRenderedContent();
      expect(content).toContain('Uptime:');
      expect(content).toMatch(/\d+s$/m);
    });

    it('should show uptime in minutes and seconds', () => {
      detail.setWorker(createMockWorker({ firstSeen: Date.now() - 150000 }));

      const content = getRenderedContent();
      expect(content).toMatch(/\d+m \d+s$/m);
    });

    it('should show uptime in hours and minutes for long-running workers', () => {
      detail.setWorker(createMockWorker({ firstSeen: Date.now() - 7200000 }));

      const content = getRenderedContent();
      expect(content).toMatch(/\d+h \d+m$/m);
    });
  });

  describe('beads completed display', () => {
    it('should display beads completed count with green color', () => {
      detail.setWorker(createMockWorker({
        beadsCompleted: 42,
        beadsSucceeded: 3,
        beadsTimedOut: 2,
      }));

      const content = getRenderedContent();
      expect(content).toContain('Beads Completed:');
      expect(content).toContain('{green-fg}42{/}');
    });

    it('should display zero beads completed', () => {
      detail.setWorker(createMockWorker({
        beadsCompleted: 0,
        beadsSucceeded: 0,
        beadsTimedOut: 0,
      }));

      const content = getRenderedContent();
      expect(content).toContain('{green-fg}0{/}');
    });
  });

  describe('last activity display', () => {
    it('should show last activity section header', () => {
      detail.setWorker(createMockWorker());

      const content = getRenderedContent();
      expect(content).toContain('Last Activity:');
    });

    it('should show no events message when worker has no last event', () => {
      detail.setWorker(createMockWorker({ lastEvent: undefined }));

      const content = getRenderedContent();
      expect(content).toContain('No events recorded');
    });

    it('should show last event details with time and level', () => {
      const event = createMockEvent({
        ts: Date.now(),
        level: 'info',
        msg: 'Processing bead bd-abc',
      });
      detail.setWorker(createMockWorker({ lastEvent: event }));

      const content = getRenderedContent();
      expect(content).toContain('Time:');
      expect(content).toContain('Level:');
      expect(content).toContain('{light-cyan-fg}INFO{/}');
      expect(content).toContain('Msg: Processing bead bd-abc');
    });

    it('should show bead info when present in last event', () => {
      const event = createMockEvent({ bead: 'bd-xyz789' });
      detail.setWorker(createMockWorker({ lastEvent: event }));

      const content = getRenderedContent();
      expect(content).toContain('Bead:');
      expect(content).toContain('{magenta-fg}bd-xyz789{/}');
    });

    it('should show tool info when present in last event', () => {
      const event = createMockEvent({ tool: 'Read' });
      detail.setWorker(createMockWorker({ lastEvent: event }));

      const content = getRenderedContent();
      expect(content).toContain('Tool:');
      expect(content).toContain('{cyan-fg}Read{/}');
    });

    it('should show duration when present in last event', () => {
      const event = createMockEvent({ duration_ms: 5000 });
      detail.setWorker(createMockWorker({ lastEvent: event }));

      const content = getRenderedContent();
      expect(content).toContain('Duration:');
      expect(content).toContain('5.0s');
    });

    it('should show error details when present in last event', () => {
      const event = createMockEvent({ error: 'Connection refused' });
      detail.setWorker(createMockWorker({ lastEvent: event }));

      const content = getRenderedContent();
      expect(content).toContain('{red-fg}Error: Connection refused{/}');
    });

    it('should truncate long messages to 60 characters', () => {
      const longMsg = 'A'.repeat(100);
      const event = createMockEvent({ msg: longMsg });
      detail.setWorker(createMockWorker({ lastEvent: event }));

      const content = getRenderedContent();
      expect(content).toContain('Msg: ' + 'A'.repeat(60));
      expect(content).not.toContain(longMsg);
    });
  });

  describe('recent events display', () => {
    it('should show recent events section when events are set', () => {
      const events = [
        createMockEvent({ msg: 'Event 1' }),
        createMockEvent({ msg: 'Event 2' }),
      ];
      detail.setWorker(createMockWorker());
      detail.setRecentEvents(events);

      const content = getRenderedContent();
      expect(content).toContain('Recent Events:');
      expect(content).toContain('Event 1');
      expect(content).toContain('Event 2');
    });

    it('should limit displayed events to last 10', () => {
      const events = Array.from({ length: 25 }, (_, i) =>
        createMockEvent({ msg: `Event ${i}` }),
      );
      detail.setWorker(createMockWorker());
      detail.setRecentEvents(events);

      const content = getRenderedContent();

      // First 15 events should not appear (only last 10 displayed)
      expect(content).not.toContain('Event 0');
      expect(content).not.toContain('Event 14');
      // Last 10 should appear
      expect(content).toContain('Event 15');
      expect(content).toContain('Event 24');
    });

    it('should store up to 20 events internally', () => {
      const events = Array.from({ length: 30 }, (_, i) =>
        createMockEvent({ msg: `Event ${i}` }),
      );
      detail.setWorker(createMockWorker());
      detail.setRecentEvents(events);

      // setRecentEvents stores last 20 (events 10-29), render shows last 10 of those (events 20-29)
      const content = getRenderedContent();
      expect(content).not.toContain('Event 9');
      expect(content).not.toContain('Event 19');
      expect(content).toContain('Event 20');
      expect(content).toContain('Event 29');
    });

    it('should show event level colors', () => {
      const events = [
        createMockEvent({ level: 'warn', msg: 'Warning event' }),
        createMockEvent({ level: 'error', msg: 'Error event' }),
      ];
      detail.setWorker(createMockWorker());
      detail.setRecentEvents(events);

      const content = getRenderedContent();
      expect(content).toContain('{light-yellow-fg}WAR{/}');
      expect(content).toContain('{light-red-fg}ERR{/}');
    });

    it('should truncate event messages to 40 characters', () => {
      const longMsg = 'X'.repeat(80);
      const events = [createMockEvent({ msg: longMsg })];
      detail.setWorker(createMockWorker());
      detail.setRecentEvents(events);

      const content = getRenderedContent();
      expect(content).toContain('X'.repeat(40));
      expect(content).not.toContain(longMsg);
    });
  });

  describe('visibility methods', () => {
    it('should start hidden', () => {
      // box.hidden=true means isVisible() returns !true = false
      expect(detail.isVisible()).toBe(false);
      expect(mockBoxInstance.hidden).toBe(true);
    });

    it('should show the panel', () => {
      detail.show();
      expect(mockBoxInstance.show).toHaveBeenCalled();
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should hide the panel', () => {
      detail.hide();
      expect(mockBoxInstance.hide).toHaveBeenCalled();
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should toggle visibility', () => {
      detail.toggle();
      expect(mockBoxInstance.show).toHaveBeenCalled();

      mockBoxInstance.hidden = false;
      detail.toggle();
      expect(mockBoxInstance.hide).toHaveBeenCalled();
    });

    it('should focus the panel', () => {
      detail.focus();
      expect(mockBoxInstance.focus).toHaveBeenCalled();
    });
  });

  describe('worker switching', () => {
    it('should update content when switching workers', () => {
      detail.setWorker(createMockWorker({ id: 'w-alpha', status: 'active' }));
      let content = getRenderedContent();
      expect(content).toContain('w-alpha');
      expect(content).toContain('{light-green-fg}');

      detail.setWorker(createMockWorker({ id: 'w-beta', status: 'error' }));
      content = getRenderedContent();
      expect(content).toContain('w-beta');
      expect(content).toContain('{light-red-fg}');
      expect(content).not.toContain('w-alpha');
    });
  });

  describe('complete workflow', () => {
    it('should render full worker detail with all fields populated', () => {
      const worker = createMockWorker({
        id: 'w-claude-sonnet-alpha',
        status: 'active',
        beadsCompleted: 23,
    beadsSucceeded: 3,
    beadsTimedOut: 2,
        firstSeen: Date.now() - 5400000, // ~1.5h ago
        lastEvent: {
          ts: Date.now() - 5000,
          worker: 'w-claude-sonnet-alpha',
          level: 'info',
          msg: 'Committed changes for bd-1j9',
          bead: 'bd-1j9',
          tool: 'Write',
          duration_ms: 1200,
        },
      });

      const recentEvents = [
        createMockEvent({ level: 'info', msg: 'Reading source files' }),
        createMockEvent({ level: 'warn', msg: 'Potential merge conflict detected' }),
        createMockEvent({ level: 'info', msg: 'Writing test file' }),
      ];

      detail.setWorker(worker);
      detail.setRecentEvents(recentEvents);

      const content = getRenderedContent();

      // Header with status
      expect(content).toContain('w-claude-sonnet-alpha');
      expect(content).toContain('{light-green-fg}{bold}● w-claude-sonnet-alpha{/}');

      // Status info
      expect(content).toContain('ACTIVE');
      expect(content).toMatch(/\d+h \d+m$/m);
      expect(content).toContain('{green-fg}23{/}');

      // Last activity
      expect(content).toContain('Bead: {magenta-fg}bd-1j9{/}');
      expect(content).toContain('Tool: {cyan-fg}Write{/}');
      expect(content).toContain('Msg: Committed changes for bd-1j9');
      expect(content).toContain('Duration: 1.2s');

      // Recent events
      expect(content).toContain('Reading source files');
      expect(content).toContain('Potential merge conflict detected');
      expect(content).toContain('Writing test file');
    });
  });
});
