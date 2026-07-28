/**
 * Usage Examples for Test Helpers
 *
 * This file demonstrates how to use the test helper functions
 * for testing FABRIC's log file processing functionality.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createTempLogFile,
  createTempDir,
  createMockEvent,
  eventsToJsonl,
  createMultiWorkerLogFile,
} from './testHelpers.js';

// Example 1: Basic temp log file usage
describe('Basic log file testing', () => {
  it('should test log file parsing with temp file', () => {
    // Create a temporary log file with 3 events
    const { filePath, cleanup } = createTempLogFile({
      filename: 'test-worker.jsonl',
      eventCount: 3,
      workerId: 'test-worker',
      sessionId: 'test-session',
    });

    try {
      // Use the file path in your test
      // const tailer = new LogTailer({ path: filePath });
      // const events = await parseLogFile(filePath);

      // Verify the file exists
      expect(filePath).toBeDefined();
      // expect(events).toHaveLength(3);
    } finally {
      // Always clean up
      cleanup();
    }
  });
});

// Example 2: Testing --source option with multiple workers
describe('--source option testing', () => {
  let tempDir: ReturnType<typeof createTempDir>;
  let logFiles: string[] = [];

  beforeEach(() => {
    // Create a temporary directory to simulate ~/.needle/logs/
    tempDir = createTempDir({ dirname: 'needle-logs' });

    // Create multiple worker log files
    const workers = ['worker-1', 'worker-2', 'worker-3'];
    logFiles = workers.map((workerId) => {
      const { filePath, cleanup } = createTempLogFile({
        filename: `${workerId}.jsonl`,
        workerId,
        eventCount: 5,
      });

      // Copy to temp directory (simulating real log directory)
      const destPath = tempDir.createLogFile(
        `${workerId}.jsonl`,
        require('fs').readFileSync(filePath, 'utf8')
      );

      cleanup(); // Clean up the source file
      return destPath;
    });
  });

  afterEach(() => {
    // Clean up the entire directory
    tempDir.cleanup();
  });

  it('should process all worker logs from a directory', () => {
    // Test that all log files are processed
    expect(logFiles).toHaveLength(3);

    // const tailer = new DirectoryTailer({
    //   directory: tempDir.path,
    // });
    //
    // tailer.start();
    // // ... test logic
    // tailer.stop();
  });
});

// Example 3: Testing with custom event types
describe('Custom event type testing', () => {
  it('should test specific bead workflow events', () => {
    const { filePath, cleanup, readContents } = createTempLogFile({
      eventCount: 10,
      eventTypes: [
        'bead.claim.succeeded',
        'bead.claim.attempted',
        'bead.released',
        'bead.completed',
        'outcome.classified',
      ],
      includeBeadId: true,
    });

    try {
      const content = readContents();
      const events = content.split('\n').map((line) => JSON.parse(line));

      // Verify bead workflow
      const beadEvents = events.filter((e) => e.data.bead_id);
      expect(beadEvents.length).toBeGreaterThan(0);

      // const processor = new BeadProcessor();
      // beadEvents.forEach(event => processor.process(event));
    } finally {
      cleanup();
    }
  });
});

// Example 4: Testing event appending for real-time scenarios
describe('Real-time log tailing', () => {
  it('should test appending events to log file', () => {
    const { filePath, cleanup, appendEvent, readContents } = createTempLogFile({
      eventCount: 1,
      startSequence: 1,
    });

    try {
      // Initial state
      let content = readContents();
      let events = content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
      expect(events).toHaveLength(1);

      // Simulate real-time event appending
      appendEvent({
        event_type: 'bead.claim.succeeded',
        worker_id: 'worker-1',
        sequence: 2,
        data: { bead_id: 'bd-test-123' },
      });

      appendEvent({
        event_type: 'bead.completed',
        worker_id: 'worker-1',
        sequence: 3,
        data: { bead_id: 'bd-test-123', duration_ms: 5000 },
      });

      // Verify appended events
      content = readContents();
      events = content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
      expect(events).toHaveLength(3);

      // const tailer = new LogTailer({ path: filePath });
      // tailer.start();
      // // ... test real-time updates
      // tailer.stop();
    } finally {
      cleanup();
    }
  });
});

// Example 5: Testing multi-worker scenarios
describe('Fleet-wide testing', () => {
  it('should test fleet coordination across workers', () => {
    const { filePath, cleanup, readContents } = createMultiWorkerLogFile(
      5, // 5 workers
      10 // 10 events per worker
    );

    try {
      const content = readContents();
      const events = content.split('\n').filter(Boolean).map((line: string) => JSON.parse(line));

      // Verify we have events from all workers
      const workerIds = new Set(events.map((e) => e.worker_id));
      expect(workerIds.size).toBe(5);

      // Verify chronological ordering
      const timestamps = events.map((e) => new Date(e.timestamp).getTime());
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
      }

      // const analytics = new FleetAnalytics();
      // analytics.processBatch(events);
      // expect(activeWorkers).toBe(5);
    } finally {
      cleanup();
    }
  });
});

// Example 6: Using mock events directly
describe('Mock event usage', () => {
  it('should create custom mock events for specific scenarios', () => {
    // Create a specific error scenario
    const errorEvent = createMockEvent({
      event_type: 'error.agent_crash',
      worker_id: 'worker-failed',
      sequence: 42,
      data: {
        error: 'Memory limit exceeded',
        heap_size: 2048000000,
      },
    });

    expect(errorEvent.event_type).toBe('error.agent_crash');
    expect(errorEvent.data.error).toBe('Memory limit exceeded');

    // const errorHandler = new ErrorHandler();
    // errorHandler.handle(errorEvent);
    // expect(errorHandler.seenErrors).toContain('Memory limit exceeded');
  });
});

// Example 7: Testing event sequence and ordering
describe('Event ordering tests', () => {
  it('should test event sequence validation', () => {
    const events = [
      createMockEvent({ sequence: 1, event_type: 'worker.started' }),
      createMockEvent({ sequence: 2, event_type: 'bead.claim.succeeded' }),
      createMockEvent({ sequence: 3, event_type: 'bead.completed' }),
      createMockEvent({ sequence: 4, event_type: 'worker.idle' }),
    ];

    const jsonl = eventsToJsonl(events);

    // Create temp file with specific sequence
    const { filePath, cleanup, readContents } = createTempLogFile({
      eventCount: 0,
    });

    try {
      // Write custom content
      require('fs').writeFileSync(filePath, jsonl);

      const content = readContents();
      const parsedEvents = content
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));

      // Verify sequence order
      expect(parsedEvents[0].sequence).toBe(1);
      expect(parsedEvents[1].sequence).toBe(2);
      expect(parsedEvents[2].sequence).toBe(3);
      expect(parsedEvents[3].sequence).toBe(4);

      // const validator = new SequenceValidator();
      // expect(validator.validate(parsedEvents)).toBe(true);
    } finally {
      cleanup();
    }
  });
});

// Example 8: Integration test with cleanup handling
describe('Cleanup and error handling', () => {
  it('should handle cleanup in error scenarios', () => {
    let tempFile: ReturnType<typeof createTempLogFile> | null = null;

    try {
      tempFile = createTempLogFile({
        eventCount: 100,
        workerId: 'stress-test-worker',
      });

      // Simulate a test that might throw an error
      // const processor = new LogProcessor();
      // processor.process(tempFile.filePath);
      // throw new Error('Simulated processing error');

      // If an error occurs, cleanup still happens in finally block
    } catch (error) {
      // Expected error handling
      expect(error).toBeInstanceOf(Error);
    } finally {
      // Cleanup always runs, even if test fails
      if (tempFile) {
        tempFile.cleanup();
      }
    }

    // Verify cleanup happened
    expect(tempFile && require('fs').existsSync(tempFile.filePath)).toBe(false);
  });

  it('should handle multiple temp files safely', () => {
    const tempFiles = [
      createTempLogFile({ filename: 'test1.jsonl' }),
      createTempLogFile({ filename: 'test2.jsonl' }),
      createTempLogFile({ filename: 'test3.jsonl' }),
    ];

    try {
      // All files should exist
      tempFiles.forEach(({ filePath }) => {
        expect(require('fs').existsSync(filePath)).toBe(true);
      });

      // ... test logic with multiple files
    } finally {
      // Clean up all files
      tempFiles.forEach(({ cleanup }) => cleanup());
    }

    // Verify all cleaned up
    tempFiles.forEach(({ filePath }) => {
      expect(require('fs').existsSync(filePath)).toBe(false);
    });
  });
});

// Example 9: Performance testing with large datasets
describe('Performance testing', () => {
  it('should test with large log files', () => {
    const eventCount = 10000;
    const { filePath, cleanup, readContents } = createTempLogFile({
      eventCount,
      workerId: 'perf-test-worker',
    });

    try {
      const startTime = Date.now();
      const content = readContents();
      const events = content.split('\n').filter(Boolean);

      const parseTime = Date.now() - startTime;

      expect(events).toHaveLength(eventCount);
      expect(parseTime).toBeLessThan(1000); // Should parse in < 1s

      // const parser = new LogParser();
      // const parseStart = Date.now();
      // parser.parse(filePath);
      // const parseDuration = Date.now() - parseStart;
      // expect(parseDuration).toBeLessThan(5000);
    } finally {
      cleanup();
    }
  });
});

// Example 10: Testing different NEEDLE event schemas
describe('NEEDLE event schema compatibility', () => {
  it('should test various NEEDLE event formats', () => {
    const { filePath, cleanup, appendEvent } = createTempLogFile({
      eventCount: 0,
    });

    try {
      // Test different event types
      const eventTypes = [
        'worker.started',
        'worker.stopped',
        'worker.errored',
        'worker.exhausted',
        'bead.claim.succeeded',
        'bead.released',
        'bead.completed',
        'heartbeat.emitted',
        'outcome.classified',
      ];

      eventTypes.forEach((eventType, index) => {
        appendEvent({
          event_type: eventType,
          worker_id: 'schema-test-worker',
          sequence: index + 1,
          data: {
            test_field: `value-${index}`,
          },
        });
      });

      const content = require('fs').readFileSync(filePath, 'utf8');
      const events = content.split('\n').filter(Boolean).map((line: string) => JSON.parse(line));

      expect(events).toHaveLength(eventTypes.length);

      // const schemaValidator = new SchemaValidator();
      // events.forEach(event => {
      //   expect(schemaValidator.validate(event)).toBe(true);
      // });
    } finally {
      cleanup();
    }
  });
});
