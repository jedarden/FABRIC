/**
 * Tests for SessionDigest Component
 *
 * Tests the session digest generation and formatting logic.
 * Note: Component UI tests are covered in regression.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs module
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
}));

// Mock colors module
vi.mock('../utils/colors.js', () => ({
  colors: {
    border: 'blue',
    header: 'cyan',
    text: 'white',
    dim: 'gray',
    muted: 'gray',
  },
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
import {
  generateSessionDigest,
} from './SessionDigest.js';
import { LogEvent, WorkerSessionSummary, SessionDigest as SessionDigestData } from '../../types.js';

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

// Helper to create mock WorkerSessionSummary
function createMockWorkerSummary(overrides: Partial<WorkerSessionSummary> = {}): WorkerSessionSummary {
  return {
    workerId: 'w-test123',
    beadsCompleted: 5,
    filesModified: 3,
    errorsEncountered: 1,
    totalEvents: 100,
    activeTimeMs: 60000,
    firstActivity: Date.now() - 60000,
    lastActivity: Date.now(),
    ...overrides,
  };
}

describe('generateSessionDigest', () => {
  it('should generate digest from events', () => {
    const events: LogEvent[] = [
      createMockEvent({ msg: 'Processing bead', bead: 'bd-1' }),
      createMockEvent({ msg: 'Bead completed', bead: 'bd-1' }),
      createMockEvent({ msg: 'File modified', path: '/test.ts', tool: 'Edit' }),
    ];
    const workers: WorkerSessionSummary[] = [createMockWorkerSummary()];

    const digest = generateSessionDigest(events, workers);

    expect(digest.sessionId).toBeDefined();
    expect(digest.startTime).toBeDefined();
    expect(digest.endTime).toBeDefined();
    expect(digest.stats.totalEvents).toBe(3);
  });

  it('should extract bead completions', () => {
    const events: LogEvent[] = [
      createMockEvent({ msg: 'Bead completed', bead: 'bd-1', worker: 'w-1' }),
      createMockEvent({ msg: 'Task complete', bead: 'bd-2', worker: 'w-2' }),
      createMockEvent({ msg: 'Processing', bead: 'bd-3' }), // No completion keyword
    ];
    const workers: WorkerSessionSummary[] = [];

    const digest = generateSessionDigest(events, workers);

    expect(digest.beadsCompleted.length).toBe(2);
  });

  it('should extract file modifications', () => {
    const events: LogEvent[] = [
      createMockEvent({ path: '/file1.ts', tool: 'Read' }),
      createMockEvent({ path: '/file1.ts', tool: 'Edit' }),
      createMockEvent({ path: '/file2.ts', tool: 'Write' }),
      createMockEvent({ path: '/file3.ts' }), // No tool
      createMockEvent({ tool: 'Read' }), // No path
    ];
    const workers: WorkerSessionSummary[] = [];

    const digest = generateSessionDigest(events, workers);

    expect(digest.filesModified.length).toBe(2);
    expect(digest.filesModified[0].modifications).toBe(2);
  });

  it('should track unique workers per file', () => {
    const events: LogEvent[] = [
      createMockEvent({ path: '/shared.ts', tool: 'Edit', worker: 'w-1' }),
      createMockEvent({ path: '/shared.ts', tool: 'Edit', worker: 'w-2' }),
      createMockEvent({ path: '/shared.ts', tool: 'Edit', worker: 'w-1' }), // Same worker again
    ];
    const workers: WorkerSessionSummary[] = [];

    const digest = generateSessionDigest(events, workers);

    expect(digest.filesModified[0].workers).toContain('w-1');
    expect(digest.filesModified[0].workers).toContain('w-2');
    expect(digest.filesModified[0].workers.length).toBe(2);
  });

  it('should track tools used per file', () => {
    const events: LogEvent[] = [
      createMockEvent({ path: '/file.ts', tool: 'Read' }),
      createMockEvent({ path: '/file.ts', tool: 'Edit' }),
      createMockEvent({ path: '/file.ts', tool: 'Read' }), // Same tool again
    ];
    const workers: WorkerSessionSummary[] = [];

    const digest = generateSessionDigest(events, workers);

    expect(digest.filesModified[0].tools).toContain('Read');
    expect(digest.filesModified[0].tools).toContain('Edit');
    expect(digest.filesModified[0].tools.length).toBe(2);
  });

  it('should extract errors', () => {
    const events: LogEvent[] = [
      createMockEvent({ level: 'error', msg: 'Something failed', error: 'Test error' }),
      createMockEvent({ level: 'error', msg: 'Another failure' }),
      createMockEvent({ level: 'info', msg: 'Not an error' }),
    ];
    const workers: WorkerSessionSummary[] = [];

    const digest = generateSessionDigest(events, workers);

    expect(digest.errors.length).toBe(2);
  });

  it('should use error message from error field when available', () => {
    const events: LogEvent[] = [
      createMockEvent({ level: 'error', msg: 'Short msg', error: 'Full error details here' }),
    ];
    const workers: WorkerSessionSummary[] = [];

    const digest = generateSessionDigest(events, workers);

    expect(digest.errors[0].message).toBe('Full error details here');
  });

  it('should use msg field when error is not available', () => {
    const events: LogEvent[] = [
      createMockEvent({ level: 'error', msg: 'Error in message' }),
    ];
    const workers: WorkerSessionSummary[] = [];

    const digest = generateSessionDigest(events, workers);

    expect(digest.errors[0].message).toBe('Error in message');
  });

  it('should handle empty events', () => {
    const digest = generateSessionDigest([], []);

    expect(digest.sessionId).toBeDefined();
    expect(digest.beadsCompleted.length).toBe(0);
    expect(digest.filesModified.length).toBe(0);
    expect(digest.errors.length).toBe(0);
    expect(digest.workers.length).toBe(0);
  });

  it('should accept custom options', () => {
    const customSessionId = 'custom-session';
    const customStart = Date.now() - 3600000;
    const customEnd = Date.now();

    const digest = generateSessionDigest([], [], {
      sessionId: customSessionId,
      startTime: customStart,
      endTime: customEnd,
    });

    expect(digest.sessionId).toBe(customSessionId);
    expect(digest.startTime).toBe(customStart);
    expect(digest.endTime).toBe(customEnd);
    expect(digest.durationMs).toBe(customEnd - customStart);
  });

  it('should categorize network errors correctly', () => {
    const networkErrors = [
      'ECONNREFUSED',
      'ENOTFOUND',
      'Network error',
      'DNS lookup failed',
      'Socket hang up',
      'Connection reset',
    ];

    networkErrors.forEach(errorMsg => {
      const events = [createMockEvent({ level: 'error', error: errorMsg })];
      const digest = generateSessionDigest(events, []);
      expect(digest.errors[0].category).toBe('network');
    });
  });

  it('should categorize permission errors correctly', () => {
    const permissionErrors = [
      'Permission denied',
      'Access denied',
      'Unauthorized',
      'Forbidden',
      'Authentication failed',
    ];

    permissionErrors.forEach(errorMsg => {
      const events = [createMockEvent({ level: 'error', error: errorMsg })];
      const digest = generateSessionDigest(events, []);
      expect(digest.errors[0].category).toBe('permission');
    });
  });

  it('should categorize validation errors correctly', () => {
    const validationErrors = [
      'Validation failed',
      'Invalid input',
      'Schema error',
      'Type error',
    ];

    validationErrors.forEach(errorMsg => {
      const events = [createMockEvent({ level: 'error', error: errorMsg })];
      const digest = generateSessionDigest(events, []);
      expect(digest.errors[0].category).toBe('validation');
    });
  });

  it('should categorize resource errors correctly', () => {
    const resourceErrors = [
      'Out of memory',
      'Disk full',
      'Quota exceeded',
      'Resource not available',
    ];

    resourceErrors.forEach(errorMsg => {
      const events = [createMockEvent({ level: 'error', error: errorMsg })];
      const digest = generateSessionDigest(events, []);
      expect(digest.errors[0].category).toBe('resource');
    });
  });

  it('should categorize not_found errors correctly', () => {
    const notFoundErrors = [
      'Not found',
      'ENOENT',
      '404 error',
    ];

    notFoundErrors.forEach(errorMsg => {
      const events = [createMockEvent({ level: 'error', error: errorMsg })];
      const digest = generateSessionDigest(events, []);
      expect(digest.errors[0].category).toBe('not_found');
    });
  });

  it('should categorize timeout errors correctly', () => {
    const timeoutErrors = [
      'Timeout',
      'Timed out',
      'Request timeout',
    ];

    timeoutErrors.forEach(errorMsg => {
      const events = [createMockEvent({ level: 'error', error: errorMsg })];
      const digest = generateSessionDigest(events, []);
      expect(digest.errors[0].category).toBe('timeout');
    });
  });

  it('should categorize syntax errors correctly', () => {
    const syntaxErrors = [
      'Syntax error',
      'Parse error',
      'Unexpected token',
    ];

    syntaxErrors.forEach(errorMsg => {
      const events = [createMockEvent({ level: 'error', error: errorMsg })];
      const digest = generateSessionDigest(events, []);
      expect(digest.errors[0].category).toBe('syntax');
    });
  });

  it('should categorize tool errors correctly', () => {
    const toolErrors = [
      'Tool execution failed',
      'Command failed',
    ];

    toolErrors.forEach(errorMsg => {
      const events = [createMockEvent({ level: 'error', error: errorMsg })];
      const digest = generateSessionDigest(events, []);
      expect(digest.errors[0].category).toBe('tool');
    });
  });

  it('should categorize unknown errors correctly', () => {
    const unknownErrors = [
      'Something went wrong',
      'Unknown issue',
      'Generic error',
    ];

    unknownErrors.forEach(errorMsg => {
      const events = [createMockEvent({ level: 'error', error: errorMsg })];
      const digest = generateSessionDigest(events, []);
      expect(digest.errors[0].category).toBe('unknown');
    });
  });

  it('should generate fingerprint for errors', () => {
    const events = [
      createMockEvent({ level: 'error', error: 'Test error message' }),
    ];
    const digest = generateSessionDigest(events, []);

    expect(digest.errors[0].fingerprint).toBeDefined();
    expect(typeof digest.errors[0].fingerprint).toBe('string');
  });

  it('should normalize fingerprints', () => {
    const events1 = [createMockEvent({ level: 'error', error: 'Error 123 with numbers' })];
    const events2 = [createMockEvent({ level: 'error', error: 'Error 456 with numbers' })];

    const digest1 = generateSessionDigest(events1, []);
    const digest2 = generateSessionDigest(events2, []);

    // Numbers should be normalized, so fingerprints should be similar
    expect(digest1.errors[0].fingerprint?.length).toBe(
      digest2.errors[0].fingerprint?.length
    );
  });

  it('should calculate statistics correctly', () => {
    const events: LogEvent[] = [
      createMockEvent({ worker: 'w-1' }),
      createMockEvent({ worker: 'w-1' }),
      createMockEvent({ worker: 'w-2' }),
    ];
    const workers: WorkerSessionSummary[] = [
      createMockWorkerSummary({ workerId: 'w-1' }),
      createMockWorkerSummary({ workerId: 'w-2' }),
    ];

    const digest = generateSessionDigest(events, workers);

    expect(digest.stats.totalEvents).toBe(3);
    expect(digest.stats.totalWorkers).toBe(2);
    expect(digest.stats.avgEventsPerWorker).toBe(1.5);
  });

  it('should handle division by zero for averages', () => {
    const digest = generateSessionDigest([], []);

    expect(digest.stats.avgEventsPerWorker).toBe(0);
    expect(digest.stats.avgBeadsPerWorker).toBe(0);
  });

  it('should include duration from events', () => {
    const start = Date.now() - 3600000; // 1 hour ago
    const end = Date.now();

    const events: LogEvent[] = [
      createMockEvent({ ts: start }),
      createMockEvent({ ts: start + 1800000 }), // 30 min later
      createMockEvent({ ts: end }),
    ];

    const digest = generateSessionDigest(events, []);

    expect(digest.durationMs).toBeGreaterThan(0);
    expect(digest.startTime).toBe(start);
    expect(digest.endTime).toBe(end);
  });

  it('should use current time when no events', () => {
    const before = Date.now();
    const digest = generateSessionDigest([], []);
    const after = Date.now();

    expect(digest.startTime).toBeGreaterThanOrEqual(before);
    expect(digest.startTime).toBeLessThanOrEqual(after);
  });

  it('should aggregate token information from events', () => {
    const events: LogEvent[] = [
      createMockEvent({ msg: 'Event 1' }),
      createMockEvent({ msg: 'Event 2' }),
    ];
    // Add tokens to events (using any to bypass type check for testing)
    (events[0] as any).tokens = 100;
    (events[1] as any).tokens = 200;

    const digest = generateSessionDigest(events, []);

    expect(digest.cost.totalTokens).toBe(300);
  });

  it('should include workers in digest', () => {
    const workers: WorkerSessionSummary[] = [
      createMockWorkerSummary({ workerId: 'w-1', beadsCompleted: 10 }),
      createMockWorkerSummary({ workerId: 'w-2', beadsCompleted: 5 }),
    ];

    const digest = generateSessionDigest([], workers);

    expect(digest.workers.length).toBe(2);
    expect(digest.workers[0].workerId).toBe('w-1');
  });

  it('should include bead duration when available', () => {
    const events: LogEvent[] = [
      createMockEvent({
        msg: 'Bead completed',
        bead: 'bd-1',
        duration_ms: 5000,
      }),
    ];

    const digest = generateSessionDigest(events, []);

    expect(digest.beadsCompleted[0].durationMs).toBe(5000);
  });
});
