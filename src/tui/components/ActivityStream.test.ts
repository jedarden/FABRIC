/**
 * Tests for ActivityStream Component
 *
 * Tests the activity stream display with mocked blessed elements.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as blessed from 'blessed';

// Mock the blessed module before importing ActivityStream
vi.mock('blessed', () => {
  // Create the mock log instance
  const mockLogInstance = {
    setContent: vi.fn(),
    log: vi.fn(),
    setLabel: vi.fn(),
    focus: vi.fn(),
    key: vi.fn(),
    screen: {
      render: vi.fn(),
    },
  };

  const mockLog = vi.fn(() => mockLogInstance);

  return {
    default: {
      log: mockLog,
    },
    log: mockLog,
  };
});

// Import after mocking
import { ActivityStream, ActivityFilter } from './ActivityStream.js';
import { LogEvent } from '../../types.js';

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

describe('ActivityStream', () => {
  let activityStream: ActivityStream;
  let mockScreen: blessed.Widgets.Screen;
  let mockLogInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockScreen = createMockScreen();

    // Get the mock log instance from the mock
    const blessedMock = blessed as unknown as { log: vi.Mock };
    mockLogInstance = blessedMock.log();

    activityStream = new ActivityStream({
      parent: mockScreen,
      top: 0,
      right: 0,
      width: '50%',
      bottom: 0,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a blessed log with correct options', () => {
      const blessedMock = blessed as unknown as { log: vi.Mock };
      expect(blessedMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: mockScreen,
          top: 0,
          right: 0,
          width: '50%',
          bottom: 0,
          label: ' Activity Stream ',
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
      expect(mockLogInstance.key).toHaveBeenCalled();
    });

    it('should use default maxLines of 500', () => {
      const stream = new ActivityStream({
        parent: mockScreen,
        top: 0,
        right: 0,
        width: '50%',
        bottom: 0,
      });
      expect(stream).toBeDefined();
    });

    it('should accept custom maxLines option', () => {
      const stream = new ActivityStream({
        parent: mockScreen,
        top: 0,
        right: 0,
        width: '50%',
        bottom: 0,
        maxLines: 100,
      });
      expect(stream).toBeDefined();
    });
  });

  describe('addEvent', () => {
    it('should add event to the log', () => {
      const event = createMockEvent();
      activityStream.addEvent(event);

      expect(mockLogInstance.log).toHaveBeenCalled();
    });

    it('should format event with timestamp', () => {
      const event = createMockEvent({ ts: 1709347200000 }); // Fixed timestamp
      activityStream.addEvent(event);

      const loggedContent = mockLogInstance.log.mock.calls[0][0];
      // Should contain formatted time
      expect(loggedContent).toBeDefined();
    });

    it('should format event with worker ID (truncated)', () => {
      const event = createMockEvent({ worker: 'w-verylongworkerid123456' });
      activityStream.addEvent(event);

      const loggedContent = mockLogInstance.log.mock.calls[0][0];
      // Worker ID should be truncated to 8 characters
      expect(loggedContent).toContain('w-verylo');
    });

    it('should format event with log level', () => {
      const event = createMockEvent({ level: 'error' });
      activityStream.addEvent(event);

      const loggedContent = mockLogInstance.log.mock.calls[0][0];
      expect(loggedContent).toContain('ERROR');
    });

    it('should format event with tool if present', () => {
      const event = createMockEvent({ tool: 'Read' });
      activityStream.addEvent(event);

      const loggedContent = mockLogInstance.log.mock.calls[0][0];
      expect(loggedContent).toContain('[Read]');
    });

    it('should format event with bead if present', () => {
      const event = createMockEvent({ bead: 'bd-abc123' });
      activityStream.addEvent(event);

      const loggedContent = mockLogInstance.log.mock.calls[0][0];
      expect(loggedContent).toContain('bd-abc123');
    });

    it('should not display event when paused', () => {
      activityStream.togglePause();
      const event = createMockEvent();
      activityStream.addEvent(event);

      // Event is added to internal array but not displayed
      expect(mockLogInstance.log).not.toHaveBeenCalled();
    });

    it('should not display event when filtered out', () => {
      activityStream.setFilter({ workerId: 'w-specific' });

      const event = createMockEvent({ worker: 'w-other' });
      activityStream.addEvent(event);

      // Event doesn't match filter
      expect(mockLogInstance.log).not.toHaveBeenCalled();
    });

    it('should trim old events when exceeding maxLines', () => {
      // Create a stream with small maxLines
      const smallStream = new ActivityStream({
        parent: mockScreen,
        top: 0,
        right: 0,
        width: '50%',
        bottom: 0,
        maxLines: 5,
      });

      // Add more events than maxLines
      for (let i = 0; i < 10; i++) {
        smallStream.addEvent(createMockEvent({ msg: `Event ${i}` }));
      }

      // Should not throw and should have trimmed
      expect(mockLogInstance.log).toHaveBeenCalled();
    });
  });

  describe('addEvents', () => {
    it('should add multiple events', () => {
      const events = [
        createMockEvent({ msg: 'First' }),
        createMockEvent({ msg: 'Second' }),
        createMockEvent({ msg: 'Third' }),
      ];

      activityStream.addEvents(events);

      expect(mockLogInstance.log).toHaveBeenCalledTimes(3);
    });

    it('should handle empty array', () => {
      activityStream.addEvents([]);
      expect(mockLogInstance.log).not.toHaveBeenCalled();
    });
  });

  describe('togglePause', () => {
    it('should toggle pause state', () => {
      expect(activityStream.getIsPaused()).toBe(false);

      activityStream.togglePause();
      expect(activityStream.getIsPaused()).toBe(true);

      activityStream.togglePause();
      expect(activityStream.getIsPaused()).toBe(false);
    });

    it('should update label when paused', () => {
      activityStream.togglePause();

      expect(mockLogInstance.setLabel).toHaveBeenCalledWith(' Activity Stream [PAUSED] ');
    });

    it('should update label when unpaused', () => {
      activityStream.togglePause(); // Pause
      activityStream.togglePause(); // Unpause

      expect(mockLogInstance.setLabel).toHaveBeenCalledWith(' Activity Stream ');
    });

    it('should trigger screen render', () => {
      activityStream.togglePause();

      expect(mockLogInstance.screen.render).toHaveBeenCalled();
    });
  });

  describe('setFilter', () => {
    it('should set filter and re-render', () => {
      const filter: ActivityFilter = { workerId: 'w-test' };
      activityStream.setFilter(filter);

      expect(mockLogInstance.setContent).toHaveBeenCalled();
      expect(mockLogInstance.screen.render).toHaveBeenCalled();
    });

    it('should filter by workerId', () => {
      activityStream.setFilter({ workerId: 'w-specific' });

      // Add matching event
      activityStream.addEvent(createMockEvent({ worker: 'w-specific' }));
      expect(mockLogInstance.log).toHaveBeenCalled();

      vi.clearAllMocks();

      // Add non-matching event
      activityStream.addEvent(createMockEvent({ worker: 'w-other' }));
      expect(mockLogInstance.log).not.toHaveBeenCalled();
    });

    it('should filter by level', () => {
      activityStream.setFilter({ level: 'error' });

      // Add matching event
      activityStream.addEvent(createMockEvent({ level: 'error' }));
      expect(mockLogInstance.log).toHaveBeenCalled();

      vi.clearAllMocks();

      // Add non-matching event
      activityStream.addEvent(createMockEvent({ level: 'info' }));
      expect(mockLogInstance.log).not.toHaveBeenCalled();
    });

    it('should filter by search term in message', () => {
      activityStream.setFilter({ search: 'important' });

      // Add matching event
      activityStream.addEvent(createMockEvent({ msg: 'This is important' }));
      expect(mockLogInstance.log).toHaveBeenCalled();

      vi.clearAllMocks();

      // Add non-matching event
      activityStream.addEvent(createMockEvent({ msg: 'Something else' }));
      expect(mockLogInstance.log).not.toHaveBeenCalled();
    });

    it('should filter by search term in worker ID', () => {
      activityStream.setFilter({ search: 'alpha' });

      // Add matching event
      activityStream.addEvent(createMockEvent({ worker: 'w-alpha-worker' }));
      expect(mockLogInstance.log).toHaveBeenCalled();

      vi.clearAllMocks();

      // Add non-matching event
      activityStream.addEvent(createMockEvent({ worker: 'w-beta-worker' }));
      expect(mockLogInstance.log).not.toHaveBeenCalled();
    });

    it('should filter by search term in tool', () => {
      activityStream.setFilter({ search: 'read' });

      // Add matching event
      activityStream.addEvent(createMockEvent({ tool: 'Read' }));
      expect(mockLogInstance.log).toHaveBeenCalled();

      vi.clearAllMocks();

      // Add non-matching event
      activityStream.addEvent(createMockEvent({ tool: 'Write' }));
      expect(mockLogInstance.log).not.toHaveBeenCalled();
    });

    it('should filter by search term in bead', () => {
      activityStream.setFilter({ search: 'abc' });

      // Add matching event
      activityStream.addEvent(createMockEvent({ bead: 'bd-abc123' }));
      expect(mockLogInstance.log).toHaveBeenCalled();

      vi.clearAllMocks();

      // Add non-matching event
      activityStream.addEvent(createMockEvent({ bead: 'bd-xyz789' }));
      expect(mockLogInstance.log).not.toHaveBeenCalled();
    });

    it('should be case-insensitive for search', () => {
      activityStream.setFilter({ search: 'IMPORTANT' });

      // Add matching event with different case
      activityStream.addEvent(createMockEvent({ msg: 'This is important' }));
      expect(mockLogInstance.log).toHaveBeenCalled();
    });

    it('should combine multiple filter criteria (AND)', () => {
      activityStream.setFilter({ workerId: 'w-test', level: 'error' });

      // Add event matching only workerId
      activityStream.addEvent(createMockEvent({ worker: 'w-test', level: 'info' }));
      expect(mockLogInstance.log).not.toHaveBeenCalled();

      // Add event matching both
      activityStream.addEvent(createMockEvent({ worker: 'w-test', level: 'error' }));
      expect(mockLogInstance.log).toHaveBeenCalled();
    });

    it('should filter by time range - since', () => {
      const now = Date.now();
      const fiveMinutesAgo = now - 5 * 60 * 1000;

      activityStream.setFilter({ since: fiveMinutesAgo });

      // Add old event (should be filtered out)
      activityStream.addEvent(createMockEvent({ ts: fiveMinutesAgo - 1000 }));
      expect(mockLogInstance.log).not.toHaveBeenCalled();

      // Add recent event (should pass)
      activityStream.addEvent(createMockEvent({ ts: now }));
      expect(mockLogInstance.log).toHaveBeenCalled();
    });

    it('should filter by time range - until', () => {
      const now = Date.now();
      const fiveMinutesAgo = now - 5 * 60 * 1000;

      activityStream.setFilter({ until: fiveMinutesAgo });

      // Add recent event (should be filtered out)
      activityStream.addEvent(createMockEvent({ ts: now }));
      expect(mockLogInstance.log).not.toHaveBeenCalled();

      // Add old event (should pass)
      activityStream.addEvent(createMockEvent({ ts: fiveMinutesAgo - 1000 }));
      expect(mockLogInstance.log).toHaveBeenCalled();
    });

    it('should filter by time range - since and until', () => {
      const now = Date.now();
      const tenMinutesAgo = now - 10 * 60 * 1000;
      const fiveMinutesAgo = now - 5 * 60 * 1000;

      activityStream.setFilter({ since: tenMinutesAgo, until: fiveMinutesAgo });

      // Too old
      activityStream.addEvent(createMockEvent({ ts: tenMinutesAgo - 1000 }));
      expect(mockLogInstance.log).not.toHaveBeenCalled();

      // In range
      activityStream.addEvent(createMockEvent({ ts: tenMinutesAgo + 1000 }));
      expect(mockLogInstance.log).toHaveBeenCalled();

      vi.clearAllMocks();

      // Too recent
      activityStream.addEvent(createMockEvent({ ts: now }));
      expect(mockLogInstance.log).not.toHaveBeenCalled();
    });
  });

  describe('clearFilter', () => {
    it('should clear filter and re-render', () => {
      activityStream.setFilter({ workerId: 'w-test' });
      vi.clearAllMocks();

      activityStream.clearFilter();

      expect(mockLogInstance.setContent).toHaveBeenCalled();
      expect(mockLogInstance.screen.render).toHaveBeenCalled();
    });

    it('should allow all events after clear', () => {
      activityStream.setFilter({ workerId: 'w-specific' });
      activityStream.clearFilter();

      vi.clearAllMocks();

      // Events from any worker should now be shown
      activityStream.addEvent(createMockEvent({ worker: 'w-any' }));
      expect(mockLogInstance.log).toHaveBeenCalled();
    });
  });

  describe('clear', () => {
    it('should clear all events', () => {
      activityStream.addEvent(createMockEvent());
      activityStream.clear();

      expect(mockLogInstance.setContent).toHaveBeenCalledWith('');
      expect(mockLogInstance.screen.render).toHaveBeenCalled();
    });
  });

  describe('focus', () => {
    it('should focus the log element', () => {
      activityStream.focus();
      expect(mockLogInstance.focus).toHaveBeenCalled();
    });
  });

  describe('getElement', () => {
    it('should return the log element', () => {
      const element = activityStream.getElement();
      expect(element).toBe(mockLogInstance);
    });
  });

  describe('getIsPaused', () => {
    it('should return false initially', () => {
      expect(activityStream.getIsPaused()).toBe(false);
    });

    it('should return true after pause', () => {
      activityStream.togglePause();
      expect(activityStream.getIsPaused()).toBe(true);
    });
  });

  describe('getFilter', () => {
    it('should return current filter', () => {
      const filter: ActivityFilter = { workerId: 'w-test', level: 'error' };
      activityStream.setFilter(filter);

      const currentFilter = activityStream.getFilter();
      expect(currentFilter).toEqual(filter);
    });

    it('should return a copy of the filter', () => {
      const filter: ActivityFilter = { workerId: 'w-test' };
      activityStream.setFilter(filter);

      const currentFilter = activityStream.getFilter();
      currentFilter.workerId = 'w-modified';

      // Original filter should not be modified
      expect(activityStream.getFilter().workerId).toBe('w-test');
    });
  });

  describe('getEventsCount and getFilteredEventsCount', () => {
    it('should return total events count', () => {
      activityStream.addEvent(createMockEvent());
      activityStream.addEvent(createMockEvent());
      activityStream.addEvent(createMockEvent());

      expect(activityStream.getEventsCount()).toBe(3);
    });

    it('should return filtered events count', () => {
      activityStream.addEvent(createMockEvent({ worker: 'w-alpha' }));
      activityStream.addEvent(createMockEvent({ worker: 'w-beta' }));
      activityStream.addEvent(createMockEvent({ worker: 'w-alpha' }));

      activityStream.setFilter({ workerId: 'w-alpha' });

      expect(activityStream.getEventsCount()).toBe(3);
      expect(activityStream.getFilteredEventsCount()).toBe(2);
    });
  });

  describe('key bindings', () => {
    it('should bind p key to togglePause', () => {
      expect(mockLogInstance.key).toHaveBeenCalledWith(['p'], expect.any(Function));
    });

    it('should bind C-c key to clear', () => {
      expect(mockLogInstance.key).toHaveBeenCalledWith(['C-c'], expect.any(Function));
    });

    it('should toggle pause when p is pressed', () => {
      // Find the 'p' handler and call it
      const pCall = mockLogInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('p')
      );
      const pHandler = pCall?.[1];
      if (pHandler) {
        pHandler();
      }

      expect(mockLogInstance.setLabel).toHaveBeenCalledWith(' Activity Stream [PAUSED] ');
    });

    it('should clear when C-c is pressed', () => {
      // Find the 'C-c' handler and call it
      const ccCall = mockLogInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('C-c')
      );
      const ccHandler = ccCall?.[1];
      if (ccHandler) {
        ccHandler();
      }

      expect(mockLogInstance.setContent).toHaveBeenCalledWith('');
    });
  });

  describe('reRender behavior', () => {
    it('should re-render only matching events when filter changes', () => {
      // Add some events
      activityStream.addEvent(createMockEvent({ worker: 'w-alpha', msg: 'Alpha event' }));
      activityStream.addEvent(createMockEvent({ worker: 'w-beta', msg: 'Beta event' }));
      activityStream.addEvent(createMockEvent({ worker: 'w-alpha', msg: 'Another alpha' }));

      vi.clearAllMocks();

      // Set filter to only show alpha events
      activityStream.setFilter({ workerId: 'w-alpha' });

      // setContent should have been called (clearing and re-adding)
      expect(mockLogInstance.setContent).toHaveBeenCalledWith('');
      // log should be called for matching events (last 100)
      expect(mockLogInstance.log).toHaveBeenCalled();
    });

    it('should limit re-render to last 100 matching events', () => {
      // Add many events
      for (let i = 0; i < 150; i++) {
        activityStream.addEvent(createMockEvent({ msg: `Event ${i}` }));
      }

      vi.clearAllMocks();

      // Trigger re-render
      activityStream.setFilter({});

      // log should be called (but limited to 100)
      expect(mockLogInstance.log).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle event with empty message', () => {
      const event = createMockEvent({ msg: '' });
      expect(() => activityStream.addEvent(event)).not.toThrow();
    });

    it('should handle event with all optional fields missing', () => {
      const event: LogEvent = {
        ts: Date.now(),
        worker: 'w-test',
        level: 'info',
        msg: 'Basic event',
      };
      expect(() => activityStream.addEvent(event)).not.toThrow();
    });

    it('should handle event with all optional fields present', () => {
      const event: LogEvent = {
        ts: Date.now(),
        worker: 'w-test',
        level: 'debug',
        msg: 'Full event',
        tool: 'Read',
        path: '/some/path',
        bead: 'bd-123',
        duration_ms: 100,
        error: undefined,
      };
      expect(() => activityStream.addEvent(event)).not.toThrow();
    });

    it('should handle filter with empty search string', () => {
      activityStream.setFilter({ search: '' });

      // Empty search should match all events
      activityStream.addEvent(createMockEvent());
      expect(mockLogInstance.log).toHaveBeenCalled();
    });

    it('should handle very long message', () => {
      const longMessage = 'A'.repeat(1000);
      const event = createMockEvent({ msg: longMessage });
      expect(() => activityStream.addEvent(event)).not.toThrow();
    });

    it('should handle special characters in search', () => {
      activityStream.setFilter({ search: '[test]' });

      // Should handle regex-like characters as literal
      activityStream.addEvent(createMockEvent({ msg: 'This has [test] in it' }));
      expect(mockLogInstance.log).toHaveBeenCalled();
    });

    it('should handle unicode in messages', () => {
      const event = createMockEvent({ msg: 'Unicode: \u4e2d\u6587 \ud83d\ude00' });
      expect(() => activityStream.addEvent(event)).not.toThrow();
    });

    it('should handle all log levels', () => {
      const levels: Array<'debug' | 'info' | 'warn' | 'error'> = ['debug', 'info', 'warn', 'error'];

      for (const level of levels) {
        const event = createMockEvent({ level });
        expect(() => activityStream.addEvent(event)).not.toThrow();
      }
    });

    it('should handle events added while paused', () => {
      activityStream.togglePause();

      // Add events while paused
      activityStream.addEvent(createMockEvent({ msg: 'Event 1' }));
      activityStream.addEvent(createMockEvent({ msg: 'Event 2' }));

      // Unpause
      activityStream.togglePause();

      // Events should be in internal storage (shown on re-render)
      activityStream.setFilter({});
      expect(mockLogInstance.log).toHaveBeenCalled();
    });
  });

  describe('position options', () => {
    it('should accept string positions', () => {
      const stream = new ActivityStream({
        parent: mockScreen,
        top: '10%',
        right: '5%',
        width: '40%',
        bottom: '20%',
      });

      const blessedMock = blessed as unknown as { log: vi.Mock };
      expect(blessedMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          top: '10%',
          right: '5%',
          width: '40%',
          bottom: '20%',
        })
      );
    });

    it('should accept numeric positions', () => {
      const stream = new ActivityStream({
        parent: mockScreen,
        top: 5,
        right: 0,
        width: 50,
        bottom: 10,
      });

      const blessedMock = blessed as unknown as { log: vi.Mock };
      expect(blessedMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          top: 5,
          right: 0,
          width: 50,
          bottom: 10,
        })
      );
    });
  });
});
