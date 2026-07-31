/**
 * Tests for Test Helper Functions
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  createTempLogFile,
  createTempDir,
  createMockEvent,
  eventsToJsonl,
  createMultiWorkerLogFile,
  type TempLogFileResult,
} from './testHelpers.js';

describe('createTempLogFile', () => {
  it('should create a temporary log file with default options', () => {
    const { filePath, cleanup } = createTempLogFile();

    expect(filePath).toBeDefined();
    expect(fs.existsSync(filePath)).toBe(true);

    cleanup();
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('should create a file with specified filename', () => {
    const { filePath, cleanup } = createTempLogFile({
      filename: 'custom-test.jsonl',
    });

    expect(path.basename(filePath)).toBe('custom-test.jsonl');

    cleanup();
  });

  it('should create specified number of events', () => {
    const eventCount = 5;
    const { filePath, cleanup, readContents } = createTempLogFile({
      eventCount,
    });

    const content = readContents();
    const lines = content.trim().split('\n');

    expect(lines).toHaveLength(eventCount);

    cleanup();
  });

  it('should create valid JSONL content', () => {
    const { filePath, cleanup, readContents } = createTempLogFile({
      eventCount: 3,
    });

    const content = readContents();
    const lines = content.trim().split('\n');

    lines.forEach((line) => {
      expect(() => JSON.parse(line)).not.toThrow();
      const event = JSON.parse(line);
      expect(event).toHaveProperty('timestamp');
      expect(event).toHaveProperty('event_type');
      expect(event).toHaveProperty('worker_id');
      expect(event).toHaveProperty('session_id');
      expect(event).toHaveProperty('sequence');
    });

    cleanup();
  });

  it('should use custom worker ID and session ID', () => {
    const workerId = 'custom-worker';
    const sessionId = 'custom-session';
    const { filePath, cleanup, readContents } = createTempLogFile({
      workerId,
      sessionId,
      eventCount: 1,
    });

    const content = readContents();
    const event = JSON.parse(content.trim());

    expect(event.worker_id).toBe(workerId);
    expect(event.session_id).toBe(sessionId);

    cleanup();
  });

  it('should include bead_id when requested', () => {
    const { filePath, cleanup, readContents } = createTempLogFile({
      includeBeadId: true,
      eventCount: 2,
    });

    const content = readContents();
    const lines = content.trim().split('\n');

    lines.forEach((line) => {
      const event = JSON.parse(line);
      expect(event.data.bead_id).toBeDefined();
      expect(event.data.bead_id).toMatch(/^bd-test-/);
    });

    cleanup();
  });

  it('should start sequence from specified number', () => {
    const startSequence = 10;
    const { filePath, cleanup, readContents } = createTempLogFile({
      startSequence,
      eventCount: 3,
    });

    const content = readContents();
    const lines = content.trim().split('\n');

    expect(JSON.parse(lines[0]).sequence).toBe(startSequence);
    expect(JSON.parse(lines[1]).sequence).toBe(startSequence + 1);
    expect(JSON.parse(lines[2]).sequence).toBe(startSequence + 2);

    cleanup();
  });

  it('should use specified event types', () => {
    const eventTypes = ['worker.started', 'bead.claimed', 'bead.completed'];
    const { filePath, cleanup, readContents } = createTempLogFile({
      eventTypes,
      eventCount: 6,
    });

    const content = readContents();
    const lines = content.trim().split('\n');

    lines.forEach((line, index) => {
      const event = JSON.parse(line);
      const expectedType = eventTypes[index % eventTypes.length];
      expect(event.event_type).toBe(expectedType);
    });

    cleanup();
  });

  it('should allow appending additional events', () => {
    const { filePath, cleanup, appendEvent, readContents } = createTempLogFile({
      eventCount: 1,
      startSequence: 1,
    });

    const initialContent = readContents();
    const initialLines = initialContent.trim().split('\n');
    expect(initialLines).toHaveLength(1);

    appendEvent({
      event_type: 'worker.idle',
      worker_id: 'worker-2',
      sequence: 2,
    });

    const updatedContent = readContents();
    const updatedLines = updatedContent.trim().split('\n');

    expect(updatedLines).toHaveLength(2);

    const newEvent = JSON.parse(updatedLines[1]);
    expect(newEvent.event_type).toBe('worker.idle');
    expect(newEvent.worker_id).toBe('worker-2');

    cleanup();
  });

  it('should handle file creation errors gracefully', () => {
    // Must be a path that fails for *any* uid: createTempLogFile mkdirs
    // recursively, so root can happily create /nonexistent/... and the
    // expectation silently inverts in a container. Descending into /dev/null
    // is ENOTDIR for everyone, root included.
    expect(() => {
      const result = createTempLogFile({
        directory: '/dev/null/cannot-be-a-directory',
      });
      // Should have cleaned up any partial creation
      result.cleanup();
    }).toThrow();
  });

  it('should clean up temporary directory on cleanup', () => {
    const { directory, cleanup } = createTempLogFile();

    expect(fs.existsSync(directory)).toBe(true);

    cleanup();

    expect(fs.existsSync(directory)).toBe(false);
  });

  it('should handle cleanup errors gracefully', () => {
    const { filePath, cleanup } = createTempLogFile();

    // Remove the directory manually to simulate cleanup error
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });

    // Cleanup should not throw, just log a warning
    expect(() => cleanup()).not.toThrow();
  });
});

describe('createTempDir', () => {
  it('should create a temporary directory', () => {
    const { path: dirPath, cleanup } = createTempDir();

    expect(dirPath).toBeDefined();
    expect(fs.existsSync(dirPath)).toBe(true);
    expect(fs.statSync(dirPath).isDirectory()).toBe(true);

    cleanup();
    expect(fs.existsSync(dirPath)).toBe(false);
  });

  it('should create directory with custom name', () => {
    const { path: dirPath, cleanup } = createTempDir({
      dirname: 'custom-test-dir',
    });

    expect(path.basename(dirPath)).toContain('custom-test-dir');

    cleanup();
  });

  it('should create log files in the directory', () => {
    const { path: dirPath, cleanup, createLogFile } = createTempDir();

    const logFilePath = createLogFile('test.jsonl', 'test content\n');

    expect(fs.existsSync(logFilePath)).toBe(true);
    expect(logFilePath).toContain(dirPath);

    const content = fs.readFileSync(logFilePath, 'utf8');
    expect(content).toBe('test content\n');

    cleanup();
    expect(fs.existsSync(dirPath)).toBe(false);
  });

  it('should handle multiple files creation', () => {
    const { path: dirPath, cleanup, createLogFile } = createTempDir();

    createLogFile('worker1.jsonl', 'worker1 content\n');
    createLogFile('worker2.jsonl', 'worker2 content\n');
    createLogFile('worker3.jsonl', 'worker3 content\n');

    const files = fs.readdirSync(dirPath);
    expect(files).toHaveLength(3);
    expect(files).toContain('worker1.jsonl');
    expect(files).toContain('worker2.jsonl');
    expect(files).toContain('worker3.jsonl');

    cleanup();
  });
});

describe('createMockEvent', () => {
  it('should create a valid NeedleEvent with defaults', () => {
    const event = createMockEvent();

    expect(event.timestamp).toBeDefined();
    expect(event.event_type).toBe('worker.started');
    expect(event.worker_id).toBe('test-worker');
    expect(event.session_id).toBe('test-session');
    expect(event.sequence).toBe(1);
    expect(event.data).toEqual({});
  });

  it('should override default fields', () => {
    const event = createMockEvent({
      event_type: 'bead.completed',
      worker_id: 'custom-worker',
      sequence: 42,
    });

    expect(event.event_type).toBe('bead.completed');
    expect(event.worker_id).toBe('custom-worker');
    expect(event.sequence).toBe(42);
  });

  it('should merge data objects', () => {
    const event = createMockEvent({
      data: {
        bead_id: 'bd-test',
        workspace: '/tmp/test',
      },
    });

    expect(event.data.bead_id).toBe('bd-test');
    expect(event.data.workspace).toBe('/tmp/test');
  });

  it('should preserve data from defaults when overriding', () => {
    const event = createMockEvent({
      data: {
        custom_field: 'custom_value',
      },
    });

    expect(event.data.custom_field).toBe('custom_value');
  });
});

describe('eventsToJsonl', () => {
  it('should convert array of events to JSONL format', () => {
    const events = [
      createMockEvent({ sequence: 1, event_type: 'worker.started' }),
      createMockEvent({ sequence: 2, event_type: 'worker.idle' }),
      createMockEvent({ sequence: 3, event_type: 'bead.completed' }),
    ];

    const jsonl = eventsToJsonl(events);
    const lines = jsonl.trim().split('\n');

    expect(lines).toHaveLength(3);

    lines.forEach((line) => {
      expect(() => JSON.parse(line)).not.toThrow();
    });
  });

  it('should handle empty array', () => {
    const jsonl = eventsToJsonl([]);
    expect(jsonl).toBe('\n');
  });

  it('should handle single event', () => {
    const events = [createMockEvent()];
    const jsonl = eventsToJsonl(events);
    const lines = jsonl.trim().split('\n');

    expect(lines).toHaveLength(1);
  });
});

describe('createMultiWorkerLogFile', () => {
  it('should create a log file with multiple workers', () => {
    const { filePath, cleanup, readContents } = createMultiWorkerLogFile(3, 5);

    expect(fs.existsSync(filePath)).toBe(true);

    const content = readContents();
    const lines = content.trim().split('\n');

    // Should have 3 workers * 5 events each = 15 events
    expect(lines).toHaveLength(15);

    cleanup();
  });

  it('should include events from all workers', () => {
    const workerCount = 2;
    const { filePath, cleanup, readContents } = createMultiWorkerLogFile(workerCount, 3);

    const content = readContents();
    const lines = content.trim().split('\n');

    const workerIds = new Set<string>();
    lines.forEach((line) => {
      const event = JSON.parse(line);
      workerIds.add(event.worker_id);
    });

    expect(workerIds.size).toBe(workerCount);
    expect(workerIds).toContain('worker-1');
    expect(workerIds).toContain('worker-2');

    cleanup();
  });

  it('should create valid JSONL with proper NeedleEvent structure', () => {
    const { filePath, cleanup, readContents } = createMultiWorkerLogFile(2, 2);

    const content = readContents();
    const lines = content.trim().split('\n');

    lines.forEach((line) => {
      const event = JSON.parse(line);

      expect(event).toHaveProperty('timestamp');
      expect(event).toHaveProperty('event_type');
      expect(event).toHaveProperty('worker_id');
      expect(event).toHaveProperty('session_id');
      expect(event).toHaveProperty('sequence');
      expect(event).toHaveProperty('data');
    });

    cleanup();
  });

  it('should have chronological timestamps', () => {
    const { filePath, cleanup, readContents } = createMultiWorkerLogFile(1, 10);

    const content = readContents();
    const lines = content.trim().split('\n');

    const timestamps: number[] = [];
    lines.forEach((line) => {
      const event = JSON.parse(line);
      timestamps.push(new Date(event.timestamp).getTime());
    });

    // Check timestamps are non-decreasing
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }

    cleanup();
  });

  it('should include bead_id in events', () => {
    const { filePath, cleanup, readContents } = createMultiWorkerLogFile(2, 3);

    const content = readContents();
    const lines = content.trim().split('\n');

    lines.forEach((line) => {
      const event = JSON.parse(line);
      // Some events should have bead_id
      if (event.event_type === 'bead.claim.succeeded' || event.event_type === 'bead.completed') {
        expect(event.data.bead_id).toBeDefined();
        expect(event.data.bead_id).toMatch(/^bd-test-/);
      }
    });

    cleanup();
  });
});

describe('integration tests', () => {
  it('should work with DirectoryTailer use case', () => {
    // Simulate creating multiple worker log files in a directory
    const { path: dirPath, cleanup: dirCleanup, createLogFile } = createTempDir();

    const worker1File = createLogFile('worker-1.jsonl');
    const worker2File = createLogFile('worker-2.jsonl');

    // Create temp log files for each worker
    const { filePath: worker1Path, cleanup: cleanup1 } = createTempLogFile({
      filename: 'worker-1.jsonl',
      workerId: 'worker-1',
      eventCount: 2,
    });

    const { filePath: worker2Path, cleanup: cleanup2 } = createTempLogFile({
      filename: 'worker-2.jsonl',
      workerId: 'worker-2',
      eventCount: 2,
    });

    // Copy content to the test directory
    fs.copyFileSync(worker1Path, worker1File);
    fs.copyFileSync(worker2Path, worker2File);

    // Verify files exist and have content
    expect(fs.existsSync(worker1File)).toBe(true);
    expect(fs.existsSync(worker2File)).toBe(true);

    const files = fs.readdirSync(dirPath);
    expect(files).toHaveLength(2);

    // Clean up
    cleanup1();
    cleanup2();
    dirCleanup();
  });

  it('should support testing --source option scenarios', () => {
    // Create a directory with multiple log files for testing --source option
    const { path: dirPath, cleanup: dirCleanup, createLogFile } = createTempDir({
      dirname: 'source-test',
    });

    // Simulate NEEDLE log directory structure
    const logFiles = [
      'claude-code-glm-4.7-india.jsonl',
      'claude-code-glm-4.7-juliet.jsonl',
      'claude-sonnet-4.1-charlie.jsonl',
    ];

    logFiles.forEach((filename) => {
      const workerId = filename.replace('.jsonl', '');
      const { filePath, cleanup } = createTempLogFile({
        filename,
        workerId,
        eventCount: 3,
      });

      const content = fs.readFileSync(filePath, 'utf8');
      createLogFile(filename, content);

      cleanup();
    });

    // Verify directory structure
    const files = fs.readdirSync(dirPath);
    expect(files).toHaveLength(3);
    files.forEach((file) => {
      expect(logFiles).toContain(file);
      const filePath = path.join(dirPath, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(3);
    });

    dirCleanup();
  });
});
