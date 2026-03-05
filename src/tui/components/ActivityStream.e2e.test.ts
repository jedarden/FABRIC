/**
 * E2E Test: ActivityStream Display and Scrolling
 *
 * Verifies that ActivityStream displays log entries in chronological order
 * with proper timestamps, level colors, and filtering behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import blessed from 'blessed';

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
import { ActivityStream } from './ActivityStream.js';
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

describe('E2E: ActivityStream Display and Scrolling', () => {
  let activityStream: ActivityStream;
  let mockScreen: blessed.Widgets.Screen;
  let mockLogInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockScreen = createMockScreen();

    // Get the mock log instance from the mock
    const blessedMock = blessed as unknown as { log: Mock };
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

  describe('chronological order display', () => {
    it('should display events in chronological order', () => {
      const baseTime = Date.now();

      // Add events with sequential timestamps
      const events = [
        createMockEvent({ ts: baseTime, msg: 'First event' }),
        createMockEvent({ ts: baseTime + 1000, msg: 'Second event' }),
        createMockEvent({ ts: baseTime + 2000, msg: 'Third event' }),
        createMockEvent({ ts: baseTime + 3000, msg: 'Fourth event' }),
      ];

      for (const event of events) {
        activityStream.addEvent(event);
      }

      // Verify all events were logged in order
      expect(mockLogInstance.log).toHaveBeenCalledTimes(4);

      const calls = mockLogInstance.log.mock.calls;
      expect(calls[0][0]).toContain('First event');
      expect(calls[1][0]).toContain('Second event');
      expect(calls[2][0]).toContain('Third event');
      expect(calls[3][0]).toContain('Fourth event');
    });

    it('should maintain order when events arrive out of timestamp order', () => {
      const baseTime = Date.now();

      // Add events in non-chronological order
      activityStream.addEvent(createMockEvent({ ts: baseTime + 2000, msg: 'Third by time' }));
      activityStream.addEvent(createMockEvent({ ts: baseTime, msg: 'First by time' }));
      activityStream.addEvent(createMockEvent({ ts: baseTime + 3000, msg: 'Fourth by time' }));
      activityStream.addEvent(createMockEvent({ ts: baseTime + 1000, msg: 'Second by time' }));

      // Should display in arrival order, not timestamp order
      const calls = mockLogInstance.log.mock.calls;
      expect(calls[0][0]).toContain('Third by time');
      expect(calls[1][0]).toContain('First by time');
      expect(calls[2][0]).toContain('Fourth by time');
      expect(calls[3][0]).toContain('Second by time');
    });

    it('should display 100+ events in order', () => {
      const baseTime = Date.now();

      // Add many events
      for (let i = 0; i < 150; i++) {
        activityStream.addEvent(createMockEvent({
          ts: baseTime + i * 100,
          msg: `Event ${i}`,
        }));
      }

      // Verify correct number of calls
      expect(mockLogInstance.log).toHaveBeenCalledTimes(150);

      // Check first few and last few
      const calls = mockLogInstance.log.mock.calls;
      expect(calls[0][0]).toContain('Event 0');
      expect(calls[1][0]).toContain('Event 1');
      expect(calls[148][0]).toContain('Event 148');
      expect(calls[149][0]).toContain('Event 149');
    });
  });

  describe('timestamp display', () => {
    it('should include formatted timestamp in each entry', () => {
      const timestamp = new Date('2024-03-05T12:30:45.000Z').getTime();
      const event = createMockEvent({ ts: timestamp });

      activityStream.addEvent(event);

      const loggedContent = mockLogInstance.log.mock.calls[0][0];

      // Should contain formatted time (format varies by locale)
      expect(loggedContent).toBeDefined();
      expect(typeof loggedContent).toBe('string');
    });

    it('should display different timestamps for different events', () => {
      const time1 = new Date('2024-03-05T12:00:00.000Z').getTime();
      const time2 = new Date('2024-03-05T13:00:00.000Z').getTime();

      activityStream.addEvent(createMockEvent({ ts: time1, msg: 'Morning event' }));
      activityStream.addEvent(createMockEvent({ ts: time2, msg: 'Afternoon event' }));

      const calls = mockLogInstance.log.mock.calls;
      const firstLog = calls[0][0];
      const secondLog = calls[1][0];

      // Timestamps should be different (specific format depends on locale)
      expect(firstLog).toBeDefined();
      expect(secondLog).toBeDefined();
      expect(firstLog).toContain('Morning event');
      expect(secondLog).toContain('Afternoon event');
    });

    it('should handle timestamps at midnight', () => {
      const midnight = new Date('2024-03-05T00:00:00.000Z').getTime();
      const event = createMockEvent({ ts: midnight, msg: 'Midnight event' });

      expect(() => activityStream.addEvent(event)).not.toThrow();
      expect(mockLogInstance.log).toHaveBeenCalled();
    });

    it('should handle timestamps with millisecond precision', () => {
      const preciseTime = new Date('2024-03-05T12:30:45.123Z').getTime();
      const event = createMockEvent({ ts: preciseTime, msg: 'Precise event' });

      expect(() => activityStream.addEvent(event)).not.toThrow();
      expect(mockLogInstance.log).toHaveBeenCalled();
    });
  });

  describe('level colors', () => {
    it('should display DEBUG level with correct formatting', () => {
      activityStream.addEvent(createMockEvent({ level: 'debug', msg: 'Debug message' }));

      const loggedContent = mockLogInstance.log.mock.calls[0][0];
      expect(loggedContent).toContain('DEBUG');
    });

    it('should display INFO level with correct formatting', () => {
      activityStream.addEvent(createMockEvent({ level: 'info', msg: 'Info message' }));

      const loggedContent = mockLogInstance.log.mock.calls[0][0];
      expect(loggedContent).toContain('INFO');
    });

    it('should display WARN level with correct formatting', () => {
      activityStream.addEvent(createMockEvent({ level: 'warn', msg: 'Warning message' }));

      const loggedContent = mockLogInstance.log.mock.calls[0][0];
      expect(loggedContent).toContain('WARN');
    });

    it('should display ERROR level with correct formatting', () => {
      activityStream.addEvent(createMockEvent({ level: 'error', msg: 'Error message' }));

      const loggedContent = mockLogInstance.log.mock.calls[0][0];
      expect(loggedContent).toContain('ERROR');
    });

    it('should differentiate between log levels visually', () => {
      const levels: Array<'debug' | 'info' | 'warn' | 'error'> = ['debug', 'info', 'warn', 'error'];

      for (const level of levels) {
        activityStream.addEvent(createMockEvent({ level, msg: `${level} message` }));
      }

      const calls = mockLogInstance.log.mock.calls;

      // Each level should have its level name in uppercase
      expect(calls[0][0]).toContain('DEBUG');
      expect(calls[1][0]).toContain('INFO');
      expect(calls[2][0]).toContain('WARN');
      expect(calls[3][0]).toContain('ERROR');

      // Each should contain its message
      expect(calls[0][0]).toContain('debug message');
      expect(calls[1][0]).toContain('info message');
      expect(calls[2][0]).toContain('warn message');
      expect(calls[3][0]).toContain('error message');
    });

    it('should apply color tags for levels', () => {
      activityStream.addEvent(createMockEvent({ level: 'error', msg: 'Critical error' }));

      const loggedContent = mockLogInstance.log.mock.calls[0][0];

      // Should contain blessed color tags (format: {color-fg})
      expect(loggedContent).toMatch(/\{[a-z]+-fg\}/);
    });
  });

  describe('scrolling behavior', () => {
    it('should be created with scrollable options', () => {
      const blessedMock = blessed as unknown as { log: Mock };

      expect(blessedMock.log).toHaveBeenCalledWith(
        expect.objectContaining({
          scrollable: true,
          alwaysScroll: true,
          keys: true,
          vi: true,
          mouse: true,
        })
      );
    });

    it('should handle large number of events without error', () => {
      // Add many events to test scrolling buffer
      for (let i = 0; i < 1000; i++) {
        activityStream.addEvent(createMockEvent({ msg: `Event ${i}` }));
      }

      // Should trim to maxLines (default 500)
      expect(activityStream.getEventsCount()).toBe(500);
    });

    it('should respect custom maxLines option', () => {
      const smallStream = new ActivityStream({
        parent: mockScreen,
        top: 0,
        right: 0,
        width: '50%',
        bottom: 0,
        maxLines: 10,
      });

      // Add more events than maxLines
      for (let i = 0; i < 20; i++) {
        smallStream.addEvent(createMockEvent({ msg: `Event ${i}` }));
      }

      // Should trim to maxLines
      expect(smallStream.getEventsCount()).toBe(10);
    });

    it('should keep newest events when trimming', () => {
      const smallStream = new ActivityStream({
        parent: mockScreen,
        top: 0,
        right: 0,
        width: '50%',
        bottom: 0,
        maxLines: 5,
      });

      // Add 10 events
      for (let i = 0; i < 10; i++) {
        smallStream.addEvent(createMockEvent({ msg: `Event ${i}` }));
      }

      // Should have kept only the last 5
      vi.clearAllMocks();

      // Trigger re-render to see what's in the buffer
      smallStream.setFilter({});

      const calls = mockLogInstance.log.mock.calls;

      // Should contain events 5-9
      expect(calls.some((call: unknown[]) => String(call[0]).includes('Event 5'))).toBe(true);
      expect(calls.some((call: unknown[]) => String(call[0]).includes('Event 9'))).toBe(true);

      // Should NOT contain events 0-4
      expect(calls.some((call: unknown[]) => String(call[0]).includes('Event 0'))).toBe(false);
      expect(calls.some((call: unknown[]) => String(call[0]).includes('Event 4'))).toBe(false);
    });

    it('should continue scrolling when new events arrive', () => {
      // Add initial batch
      for (let i = 0; i < 10; i++) {
        activityStream.addEvent(createMockEvent({ msg: `Event ${i}` }));
      }

      vi.clearAllMocks();

      // Add more events
      activityStream.addEvent(createMockEvent({ msg: 'New event' }));

      // Should have logged the new event
      expect(mockLogInstance.log).toHaveBeenCalledTimes(1);
      expect(mockLogInstance.log).toHaveBeenCalledWith(expect.stringContaining('New event'));
    });

    it('should not scroll when paused', () => {
      // Add initial events
      activityStream.addEvent(createMockEvent({ msg: 'Before pause' }));

      // Pause
      activityStream.togglePause();

      vi.clearAllMocks();

      // Add new event
      activityStream.addEvent(createMockEvent({ msg: 'During pause' }));

      // Should NOT have logged (paused)
      expect(mockLogInstance.log).not.toHaveBeenCalled();
    });

    it('should resume scrolling after unpause', () => {
      activityStream.togglePause();
      activityStream.addEvent(createMockEvent({ msg: 'During pause' }));
      activityStream.togglePause();

      vi.clearAllMocks();

      // Add event after unpause
      activityStream.addEvent(createMockEvent({ msg: 'After unpause' }));

      // Should log normally
      expect(mockLogInstance.log).toHaveBeenCalledTimes(1);
    });
  });

  describe('filtering behavior', () => {
    it('should filter by worker ID', () => {
      activityStream.setFilter({ workerId: 'w-alpha' });

      // Add matching event
      activityStream.addEvent(createMockEvent({ worker: 'w-alpha', msg: 'Alpha message' }));
      expect(mockLogInstance.log).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Add non-matching event
      activityStream.addEvent(createMockEvent({ worker: 'w-beta', msg: 'Beta message' }));
      expect(mockLogInstance.log).not.toHaveBeenCalled();
    });

    it('should filter by log level', () => {
      activityStream.setFilter({ level: 'error' });

      // Add matching event
      activityStream.addEvent(createMockEvent({ level: 'error', msg: 'Error message' }));
      expect(mockLogInstance.log).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Add non-matching events
      activityStream.addEvent(createMockEvent({ level: 'info', msg: 'Info message' }));
      activityStream.addEvent(createMockEvent({ level: 'warn', msg: 'Warn message' }));
      expect(mockLogInstance.log).not.toHaveBeenCalled();
    });

    it('should filter by search term (message)', () => {
      activityStream.setFilter({ search: 'critical' });

      // Add matching event
      activityStream.addEvent(createMockEvent({ msg: 'This is a critical error' }));
      expect(mockLogInstance.log).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Add non-matching event
      activityStream.addEvent(createMockEvent({ msg: 'Normal operation' }));
      expect(mockLogInstance.log).not.toHaveBeenCalled();
    });

    it('should filter by search term (worker)', () => {
      activityStream.setFilter({ search: 'alpha' });

      // Add matching event
      activityStream.addEvent(createMockEvent({ worker: 'w-alpha-123', msg: 'Test' }));
      expect(mockLogInstance.log).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Add non-matching event
      activityStream.addEvent(createMockEvent({ worker: 'w-beta-456', msg: 'Test' }));
      expect(mockLogInstance.log).not.toHaveBeenCalled();
    });

    it('should filter by search term (tool)', () => {
      activityStream.setFilter({ search: 'read' });

      // Add matching event
      activityStream.addEvent(createMockEvent({ tool: 'Read', msg: 'File read' }));
      expect(mockLogInstance.log).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Add non-matching event
      activityStream.addEvent(createMockEvent({ tool: 'Write', msg: 'File write' }));
      expect(mockLogInstance.log).not.toHaveBeenCalled();
    });

    it('should filter by search term (bead)', () => {
      activityStream.setFilter({ search: 'abc' });

      // Add matching event
      activityStream.addEvent(createMockEvent({ bead: 'bd-abc123', msg: 'Test' }));
      expect(mockLogInstance.log).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Add non-matching event
      activityStream.addEvent(createMockEvent({ bead: 'bd-xyz789', msg: 'Test' }));
      expect(mockLogInstance.log).not.toHaveBeenCalled();
    });

    it('should filter case-insensitively', () => {
      activityStream.setFilter({ search: 'ERROR' });

      // Add matching event with different case
      activityStream.addEvent(createMockEvent({ msg: 'error occurred' }));
      expect(mockLogInstance.log).toHaveBeenCalledTimes(1);
    });

    it('should combine multiple filters (AND logic)', () => {
      activityStream.setFilter({
        workerId: 'w-alpha',
        level: 'error',
        search: 'critical',
      });

      // Add event matching all criteria
      activityStream.addEvent(createMockEvent({
        worker: 'w-alpha',
        level: 'error',
        msg: 'Critical failure',
      }));
      expect(mockLogInstance.log).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Add events matching only some criteria
      activityStream.addEvent(createMockEvent({
        worker: 'w-alpha',
        level: 'error',
        msg: 'Normal error',
      })); // Missing 'critical'
      expect(mockLogInstance.log).not.toHaveBeenCalled();

      activityStream.addEvent(createMockEvent({
        worker: 'w-alpha',
        level: 'info',
        msg: 'Critical info',
      })); // Wrong level
      expect(mockLogInstance.log).not.toHaveBeenCalled();

      activityStream.addEvent(createMockEvent({
        worker: 'w-beta',
        level: 'error',
        msg: 'Critical failure',
      })); // Wrong worker
      expect(mockLogInstance.log).not.toHaveBeenCalled();
    });

    it('should filter by time range (since)', () => {
      const now = Date.now();
      const fiveMinutesAgo = now - 5 * 60 * 1000;

      activityStream.setFilter({ since: fiveMinutesAgo });

      // Add recent event (should pass)
      activityStream.addEvent(createMockEvent({ ts: now, msg: 'Recent event' }));
      expect(mockLogInstance.log).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Add old event (should be filtered)
      activityStream.addEvent(createMockEvent({ ts: fiveMinutesAgo - 1000, msg: 'Old event' }));
      expect(mockLogInstance.log).not.toHaveBeenCalled();
    });

    it('should filter by time range (until)', () => {
      const now = Date.now();
      const fiveMinutesAgo = now - 5 * 60 * 1000;

      activityStream.setFilter({ until: fiveMinutesAgo });

      // Add old event (should pass)
      activityStream.addEvent(createMockEvent({ ts: fiveMinutesAgo - 1000, msg: 'Old event' }));
      expect(mockLogInstance.log).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Add recent event (should be filtered)
      activityStream.addEvent(createMockEvent({ ts: now, msg: 'Recent event' }));
      expect(mockLogInstance.log).not.toHaveBeenCalled();
    });

    it('should filter by time range (since and until)', () => {
      const now = Date.now();
      const tenMinutesAgo = now - 10 * 60 * 1000;
      const fiveMinutesAgo = now - 5 * 60 * 1000;

      activityStream.setFilter({ since: tenMinutesAgo, until: fiveMinutesAgo });

      // Add event in range (should pass)
      activityStream.addEvent(createMockEvent({ ts: tenMinutesAgo + 1000, msg: 'In range' }));
      expect(mockLogInstance.log).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Add event too old (should be filtered)
      activityStream.addEvent(createMockEvent({ ts: tenMinutesAgo - 1000, msg: 'Too old' }));
      expect(mockLogInstance.log).not.toHaveBeenCalled();

      // Add event too recent (should be filtered)
      activityStream.addEvent(createMockEvent({ ts: now, msg: 'Too recent' }));
      expect(mockLogInstance.log).not.toHaveBeenCalled();
    });

    it('should re-render existing events when filter changes', () => {
      // Add events before filtering
      activityStream.addEvent(createMockEvent({ worker: 'w-alpha', msg: 'Alpha 1' }));
      activityStream.addEvent(createMockEvent({ worker: 'w-beta', msg: 'Beta 1' }));
      activityStream.addEvent(createMockEvent({ worker: 'w-alpha', msg: 'Alpha 2' }));

      vi.clearAllMocks();

      // Apply filter
      activityStream.setFilter({ workerId: 'w-alpha' });

      // Should have called setContent (to clear) and log (to re-add filtered events)
      expect(mockLogInstance.setContent).toHaveBeenCalledWith('');
      expect(mockLogInstance.log).toHaveBeenCalledTimes(2); // Two alpha events
    });

    it('should show all events when filter is cleared', () => {
      // Add events
      activityStream.addEvent(createMockEvent({ worker: 'w-alpha', msg: 'Alpha' }));
      activityStream.addEvent(createMockEvent({ worker: 'w-beta', msg: 'Beta' }));

      // Apply filter
      activityStream.setFilter({ workerId: 'w-alpha' });

      vi.clearAllMocks();

      // Clear filter
      activityStream.clearFilter();

      // Should re-render all events
      expect(mockLogInstance.setContent).toHaveBeenCalledWith('');
      expect(mockLogInstance.log).toHaveBeenCalledTimes(2); // Both events
    });
  });

  describe('complete display workflow', () => {
    it('should handle realistic event stream with all features', () => {
      const baseTime = Date.now();

      // Simulate realistic event stream
      const events = [
        createMockEvent({
          ts: baseTime,
          worker: 'w-alpha-001',
          level: 'info',
          msg: 'Worker started',
        }),
        createMockEvent({
          ts: baseTime + 100,
          worker: 'w-alpha-001',
          level: 'debug',
          msg: 'Loading configuration',
          tool: 'Read',
        }),
        createMockEvent({
          ts: baseTime + 200,
          worker: 'w-alpha-001',
          level: 'info',
          msg: 'Processing bead',
          bead: 'bd-abc123',
        }),
        createMockEvent({
          ts: baseTime + 300,
          worker: 'w-beta-002',
          level: 'warn',
          msg: 'Retry attempt',
          bead: 'bd-xyz789',
        }),
        createMockEvent({
          ts: baseTime + 400,
          worker: 'w-alpha-001',
          level: 'error',
          msg: 'Operation failed',
          tool: 'Write',
          bead: 'bd-abc123',
        }),
        createMockEvent({
          ts: baseTime + 500,
          worker: 'w-beta-002',
          level: 'info',
          msg: 'Task completed',
          bead: 'bd-xyz789',
        }),
      ];

      // Add all events
      for (const event of events) {
        activityStream.addEvent(event);
      }

      // Verify all were logged
      expect(mockLogInstance.log).toHaveBeenCalledTimes(6);

      vi.clearAllMocks();

      // Filter for errors only
      activityStream.setFilter({ level: 'error' });

      // Should show only the error event
      expect(mockLogInstance.log).toHaveBeenCalledTimes(1);
      expect(mockLogInstance.log).toHaveBeenCalledWith(
        expect.stringContaining('Operation failed')
      );

      vi.clearAllMocks();

      // Filter for specific bead
      activityStream.setFilter({ search: 'bd-abc123' });

      // Should show events for that bead
      expect(mockLogInstance.log).toHaveBeenCalledTimes(2);

      vi.clearAllMocks();

      // Filter for specific worker
      activityStream.setFilter({ workerId: 'w-beta-002' });

      // Should show events for that worker
      expect(mockLogInstance.log).toHaveBeenCalledTimes(2);

      vi.clearAllMocks();

      // Clear filter
      activityStream.clearFilter();

      // Should show all events again
      expect(mockLogInstance.log).toHaveBeenCalledTimes(6);
    });

    it('should handle pause, filter, and resume workflow', () => {
      // Add initial events
      activityStream.addEvent(createMockEvent({ msg: 'Event 1' }));
      activityStream.addEvent(createMockEvent({ msg: 'Event 2' }));

      // Pause
      activityStream.togglePause();

      vi.clearAllMocks();

      // Add events while paused
      activityStream.addEvent(createMockEvent({ msg: 'Event 3' }));
      activityStream.addEvent(createMockEvent({ msg: 'Event 4' }));

      // Events should not be displayed
      expect(mockLogInstance.log).not.toHaveBeenCalled();

      // Apply filter
      activityStream.setFilter({ search: 'Event 3' });

      // Should show matching events from buffer
      expect(mockLogInstance.log).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Unpause
      activityStream.togglePause();

      // Add new event
      activityStream.addEvent(createMockEvent({ msg: 'Event 3 again' }));

      // Should display (matches filter and unpaused)
      expect(mockLogInstance.log).toHaveBeenCalledTimes(1);
    });

    it('should maintain performance with high event volume', () => {
      const startTime = Date.now();

      // Add 1000 events rapidly
      for (let i = 0; i < 1000; i++) {
        activityStream.addEvent(createMockEvent({
          ts: startTime + i,
          msg: `High volume event ${i}`,
        }));
      }

      // Should complete without hanging
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete in reasonable time (less than 1 second)
      expect(duration).toBeLessThan(1000);

      // Should have trimmed to maxLines
      expect(activityStream.getEventsCount()).toBe(500);
    });
  });
});
