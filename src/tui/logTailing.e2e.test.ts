/**
 * E2E Test: Log File Tailing with ActivityStream
 *
 * Verifies that the TUI updates when new entries are appended to the log file.
 * Tests the integration between LogTailer and ActivityStream components.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LogTailer } from '../tailer.js';
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
import { ActivityStream } from './components/ActivityStream.js';
import { LogEvent } from '../types.js';

// Helper to create mock screen
function createMockScreen() {
  return {
    render: vi.fn(),
    append: vi.fn(),
    key: vi.fn(),
    destroy: vi.fn(),
  } as unknown as blessed.Widgets.Screen;
}

// Helper to create a valid log event JSON
function createLogJson(overrides: Partial<LogEvent> = {}): string {
  const event: LogEvent = {
    ts: Date.now(),
    worker: 'w-test123',
    level: 'info',
    msg: 'Test event message',
    ...overrides,
  };
  return JSON.stringify(event);
}

describe('E2E: Log Tailing with ActivityStream', () => {
  let tempDir: string;
  let logFile: string;
  let tailer: LogTailer;
  let activityStream: ActivityStream;
  let mockScreen: blessed.Widgets.Screen;
  let mockLogInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create temp directory and file
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-e2e-test-'));
    logFile = path.join(tempDir, 'test.log');
    fs.writeFileSync(logFile, ''); // Create empty log file

    // Create mock screen and ActivityStream
    mockScreen = createMockScreen();
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
    // Stop tailer if running
    if (tailer) {
      tailer.stop();
    }

    // Cleanup temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('real-time log tailing', () => {
    it('should pick up new entries appended to log file', async () => {
      // Create tailer in follow mode
      tailer = new LogTailer({
        path: logFile,
        follow: true,
        lines: 0, // Start from end
      });

      // Connect tailer events to ActivityStream
      tailer.on('event', (event: LogEvent) => {
        activityStream.addEvent(event);
      });

      // Start tailing
      tailer.start();

      // Give the watcher time to initialize
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Append a new log entry
      const newEvent = {
        ts: Date.now(),
        worker: 'w-alpha',
        level: 'info' as const,
        msg: 'New event appended',
      };
      fs.appendFileSync(logFile, createLogJson(newEvent) + '\n');

      // Wait for file change to be detected and processed
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Verify the event was added to ActivityStream
      expect(mockLogInstance.log).toHaveBeenCalled();

      const loggedContent = mockLogInstance.log.mock.calls[0][0];
      expect(loggedContent).toContain('New event appended');
      expect(loggedContent).toContain('w-alpha');
    });

    it('should pick up multiple events appended sequentially', async () => {
      tailer = new LogTailer({
        path: logFile,
        follow: true,
        lines: 0,
      });

      const receivedEvents: LogEvent[] = [];
      tailer.on('event', (event: LogEvent) => {
        receivedEvents.push(event);
        activityStream.addEvent(event);
      });

      tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Append first event
      fs.appendFileSync(logFile, createLogJson({ msg: 'First event' }) + '\n');
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Append second event
      fs.appendFileSync(logFile, createLogJson({ msg: 'Second event' }) + '\n');
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Append third event
      fs.appendFileSync(logFile, createLogJson({ msg: 'Third event' }) + '\n');
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify all events were received
      expect(receivedEvents.length).toBe(3);
      expect(receivedEvents[0].msg).toBe('First event');
      expect(receivedEvents[1].msg).toBe('Second event');
      expect(receivedEvents[2].msg).toBe('Third event');

      // Verify all were added to ActivityStream
      expect(mockLogInstance.log).toHaveBeenCalledTimes(3);
    });

    it('should pick up bulk appended events', async () => {
      tailer = new LogTailer({
        path: logFile,
        follow: true,
        lines: 0,
      });

      const receivedEvents: LogEvent[] = [];
      tailer.on('event', (event: LogEvent) => {
        receivedEvents.push(event);
        activityStream.addEvent(event);
      });

      tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Append multiple events at once
      const events = [
        createLogJson({ msg: 'Bulk event 1', worker: 'w-1' }),
        createLogJson({ msg: 'Bulk event 2', worker: 'w-2' }),
        createLogJson({ msg: 'Bulk event 3', worker: 'w-3' }),
        createLogJson({ msg: 'Bulk event 4', worker: 'w-4' }),
      ];
      fs.appendFileSync(logFile, events.join('\n') + '\n');

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Verify all events were received
      expect(receivedEvents.length).toBe(4);
      expect(receivedEvents[0].msg).toBe('Bulk event 1');
      expect(receivedEvents[1].msg).toBe('Bulk event 2');
      expect(receivedEvents[2].msg).toBe('Bulk event 3');
      expect(receivedEvents[3].msg).toBe('Bulk event 4');

      // Verify ActivityStream received them
      expect(mockLogInstance.log).toHaveBeenCalledTimes(4);
    });

    it('should display events with correct formatting', async () => {
      tailer = new LogTailer({
        path: logFile,
        follow: true,
        lines: 0,
      });

      tailer.on('event', (event: LogEvent) => {
        activityStream.addEvent(event);
      });

      tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Append event with tool and bead
      const eventWithMetadata = {
        ts: Date.now(),
        worker: 'w-worker123',
        level: 'error' as const,
        msg: 'File read failed',
        tool: 'Read',
        bead: 'bd-abc123',
      };
      fs.appendFileSync(logFile, createLogJson(eventWithMetadata) + '\n');

      await new Promise((resolve) => setTimeout(resolve, 150));

      // Verify formatted output
      expect(mockLogInstance.log).toHaveBeenCalled();
      const loggedContent = mockLogInstance.log.mock.calls[0][0];

      // Should contain error level
      expect(loggedContent).toContain('ERROR');

      // Should contain bead ID
      expect(loggedContent).toContain('bd-abc123');

      // Should contain tool name
      expect(loggedContent).toContain('[Read]');

      // Should contain message
      expect(loggedContent).toContain('File read failed');
    });

    it('should handle NEEDLE format events', async () => {
      tailer = new LogTailer({
        path: logFile,
        follow: true,
        lines: 0,
      });

      const receivedEvents: LogEvent[] = [];
      tailer.on('event', (event: LogEvent) => {
        receivedEvents.push(event);
        activityStream.addEvent(event);
      });

      tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Append NEEDLE format event
      const needleEvent = {
        ts: '2026-03-05T12:00:00.000Z',
        event: 'bead.claimed',
        session: 'test-session',
        worker: {
          runner: 'claude',
          provider: 'code',
          model: 'sonnet',
          identifier: 'worker1',
        },
        data: {
          bead_id: 'bd-xyz789',
          workspace: '/home/coder/FABRIC',
        },
      };
      fs.appendFileSync(logFile, JSON.stringify(needleEvent) + '\n');

      await new Promise((resolve) => setTimeout(resolve, 150));

      // Verify event was parsed correctly
      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].worker).toBe('claude-worker1');
      expect(receivedEvents[0].bead).toBe('bd-xyz789');
      expect(receivedEvents[0].msg).toBe('bead.claimed');

      // Verify ActivityStream received it
      expect(mockLogInstance.log).toHaveBeenCalled();
    });

    it('should continue tailing after pausing ActivityStream', async () => {
      tailer = new LogTailer({
        path: logFile,
        follow: true,
        lines: 0,
      });

      const receivedEvents: LogEvent[] = [];
      tailer.on('event', (event: LogEvent) => {
        receivedEvents.push(event);
        activityStream.addEvent(event);
      });

      tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Pause the ActivityStream
      activityStream.togglePause();

      // Append events while paused
      fs.appendFileSync(logFile, createLogJson({ msg: 'Event during pause 1' }) + '\n');
      await new Promise((resolve) => setTimeout(resolve, 100));
      fs.appendFileSync(logFile, createLogJson({ msg: 'Event during pause 2' }) + '\n');
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Events should be received by tailer even if not displayed
      expect(receivedEvents.length).toBe(2);

      // ActivityStream should not have logged them (paused)
      expect(mockLogInstance.log).not.toHaveBeenCalled();

      // Unpause
      activityStream.togglePause();

      // Add another event
      vi.clearAllMocks();
      fs.appendFileSync(logFile, createLogJson({ msg: 'Event after unpause' }) + '\n');
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Now should be displayed
      expect(mockLogInstance.log).toHaveBeenCalled();
    });

    it('should handle events with different log levels', async () => {
      tailer = new LogTailer({
        path: logFile,
        follow: true,
        lines: 0,
      });

      tailer.on('event', (event: LogEvent) => {
        activityStream.addEvent(event);
      });

      tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Append events with different levels
      const levels: Array<'debug' | 'info' | 'warn' | 'error'> = ['debug', 'info', 'warn', 'error'];
      for (const level of levels) {
        fs.appendFileSync(logFile, createLogJson({ level, msg: `${level} message` }) + '\n');
      }

      await new Promise((resolve) => setTimeout(resolve, 150));

      // Verify all levels were processed
      expect(mockLogInstance.log).toHaveBeenCalledTimes(4);

      // Check that each level appears in output
      const calls = mockLogInstance.log.mock.calls;
      expect(calls[0][0]).toContain('DEBUG');
      expect(calls[1][0]).toContain('INFO');
      expect(calls[2][0]).toContain('WARN');
      expect(calls[3][0]).toContain('ERROR');
    });
  });

  describe('initial content loading', () => {
    it('should read existing log entries on start', async () => {
      // Pre-populate log file with events
      const existingEvents = [
        createLogJson({ msg: 'Existing event 1' }),
        createLogJson({ msg: 'Existing event 2' }),
        createLogJson({ msg: 'Existing event 3' }),
      ];
      fs.writeFileSync(logFile, existingEvents.join('\n') + '\n');

      // Create tailer that reads last 3 lines
      tailer = new LogTailer({
        path: logFile,
        follow: true,
        lines: 3,
      });

      const receivedEvents: LogEvent[] = [];
      tailer.on('event', (event: LogEvent) => {
        receivedEvents.push(event);
        activityStream.addEvent(event);
      });

      tailer.start();

      // Wait for initial read
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify existing events were loaded
      expect(receivedEvents.length).toBe(3);
      expect(receivedEvents[0].msg).toBe('Existing event 1');
      expect(receivedEvents[1].msg).toBe('Existing event 2');
      expect(receivedEvents[2].msg).toBe('Existing event 3');

      // Verify they were added to ActivityStream
      expect(mockLogInstance.log).toHaveBeenCalledTimes(3);
    });

    it('should load existing then tail new entries', async () => {
      // Pre-populate log file
      fs.writeFileSync(logFile, createLogJson({ msg: 'Existing event' }) + '\n');

      tailer = new LogTailer({
        path: logFile,
        follow: true,
        lines: 10,
      });

      const receivedEvents: LogEvent[] = [];
      tailer.on('event', (event: LogEvent) => {
        receivedEvents.push(event);
        activityStream.addEvent(event);
      });

      tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify existing event loaded
      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].msg).toBe('Existing event');

      // Append new event
      fs.appendFileSync(logFile, createLogJson({ msg: 'New event' }) + '\n');
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Verify new event was picked up
      expect(receivedEvents.length).toBe(2);
      expect(receivedEvents[1].msg).toBe('New event');

      // Both should be in ActivityStream
      expect(mockLogInstance.log).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('should handle malformed JSON lines gracefully', async () => {
      tailer = new LogTailer({
        path: logFile,
        follow: true,
        lines: 0,
      });

      const receivedEvents: LogEvent[] = [];
      tailer.on('event', (event: LogEvent) => {
        receivedEvents.push(event);
        activityStream.addEvent(event);
      });

      tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Append malformed JSON
      fs.appendFileSync(logFile, 'not valid json\n');
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Append valid event
      fs.appendFileSync(logFile, createLogJson({ msg: 'Valid event' }) + '\n');
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should skip malformed and process valid
      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].msg).toBe('Valid event');

      // Only valid event should be in ActivityStream
      expect(mockLogInstance.log).toHaveBeenCalledTimes(1);
    });

    it('should handle empty lines gracefully', async () => {
      tailer = new LogTailer({
        path: logFile,
        follow: true,
        lines: 0,
      });

      const receivedEvents: LogEvent[] = [];
      tailer.on('event', (event: LogEvent) => {
        receivedEvents.push(event);
        activityStream.addEvent(event);
      });

      tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Append empty lines and valid event
      fs.appendFileSync(logFile, '\n\n\n');
      fs.appendFileSync(logFile, createLogJson({ msg: 'Valid event' }) + '\n');
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should only process valid event
      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].msg).toBe('Valid event');
    });
  });

  describe('cleanup', () => {
    it('should stop receiving events after tailer is stopped', async () => {
      tailer = new LogTailer({
        path: logFile,
        follow: true,
        lines: 0,
      });

      const receivedEvents: LogEvent[] = [];
      tailer.on('event', (event: LogEvent) => {
        receivedEvents.push(event);
        activityStream.addEvent(event);
      });

      tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Append event
      fs.appendFileSync(logFile, createLogJson({ msg: 'Before stop' }) + '\n');
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(receivedEvents.length).toBe(1);

      // Stop tailer
      tailer.stop();
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Append event after stop
      fs.appendFileSync(logFile, createLogJson({ msg: 'After stop' }) + '\n');
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should not receive new event
      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].msg).toBe('Before stop');
    });

    it('should emit end event when stopped', async () => {
      tailer = new LogTailer({
        path: logFile,
        follow: true,
        lines: 0,
      });

      const endPromise = new Promise<void>((resolve) => {
        tailer.on('end', resolve);
      });

      tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      tailer.stop();

      await endPromise;
      expect(tailer.isActive).toBe(false);
    });
  });
});
