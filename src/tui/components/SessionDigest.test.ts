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
import { CostTracker } from '../utils/costTracking.js';

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
      createMockEvent({ msg: 'Event 1', input_tokens: 100, output_tokens: 50 }) as LogEvent,
      createMockEvent({ msg: 'Event 2', input_tokens: 200, output_tokens: 100 }) as LogEvent,
    ];

    const costTracker = new CostTracker();
    const digest = generateSessionDigest(events, [], { costTracker });

    expect(digest.cost.totalTokens).toBe(450); // 100+50+200+100
    expect(digest.cost.inputTokens).toBe(300);
    expect(digest.cost.outputTokens).toBe(150);
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

  it('should use real CostTracker when provided and calculate nonzero cost', () => {
    const events: LogEvent[] = [
      createMockEvent({
        msg: 'API call with tokens',
        input_tokens: 1000,
        output_tokens: 500,
      }) as LogEvent,
      createMockEvent({
        msg: 'Another API call',
        input_tokens: 2000,
        output_tokens: 1000,
      }) as LogEvent,
    ];

    const costTracker = new CostTracker();
    const digest = generateSessionDigest(events, [], { costTracker });

    // Should have nonzero cost from the CostTracker
    expect(digest.cost.totalTokens).toBeGreaterThan(0);
    expect(digest.cost.inputTokens).toBe(3000);
    expect(digest.cost.outputTokens).toBe(1500);
    expect(digest.cost.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('should return zero cost when no CostTracker provided', () => {
    const events: LogEvent[] = [
      createMockEvent({ msg: 'Event without token tracking' }),
    ];

    const digest = generateSessionDigest(events, []);

    // Without CostTracker, cost should be zero
    expect(digest.cost.totalTokens).toBe(0);
    expect(digest.cost.estimatedCostUsd).toBe(0);
  });
});

// ============================================================
// SessionDigest component (blessed panel) tests
// ============================================================

import blessed from 'blessed';
import { SessionDigest, createSessionDigest, DigestViewTab } from './SessionDigest.js';

type BoxLike = blessed.Widgets.BoxElement;
type KeyHandler = (ch?: string, key?: { name?: string }) => void;

/** Strip SGR escapes blessed leaves in getContent() so substrings match. */
function plain(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

/** Reach the private blessed boxes so tests can assert rendered content. */
function boxes(component: SessionDigest): Record<'header' | 'tabBar' | 'content' | 'footer', BoxLike> {
  const internals = component as unknown as {
    headerBox: BoxLike;
    tabBar: BoxLike;
    contentBox: BoxLike;
    footerBox: BoxLike;
  };
  return {
    header: internals.headerBox,
    tabBar: internals.tabBar,
    content: internals.contentBox,
    footer: internals.footerBox,
  };
}

/**
 * Capture key bindings registered while the factory runs (bindKeys binds on
 * the content box during construction) so tests can invoke the handlers
 * directly — the same pattern SessionReplay.test.ts uses.
 */
function captureKeyBindings(factory: () => SessionDigest): {
  instance: SessionDigest;
  handlers: Map<string, KeyHandler>;
} {
  const handlers = new Map<string, KeyHandler>();
  const boxWithProto = blessed.box as unknown as {
    prototype: { key: (keys: string[], handler: KeyHandler) => void };
  };
  const originalKey = boxWithProto.prototype.key;
  boxWithProto.prototype.key = function (keys: string[], handler: KeyHandler) {
    for (const k of keys) handlers.set(k, handler);
    return originalKey.call(this, keys, handler);
  };
  try {
    return { instance: factory(), handlers };
  } finally {
    boxWithProto.prototype.key = originalKey;
  }
}

/** A rich digest exercising every list branch of the render methods. */
function makeRichDigest(): SessionDigestData {
  return {
    sessionId: 'session-20261024-abcdefgh',
    startTime: 1770000000000,
    endTime: 1770003600000,
    durationMs: 3660000, // 1h 1m — hours branch of formatDuration
    beadsCompleted: [
      { beadId: 'bd-111', workerId: 'w-worker-one', completedAt: 1770001200000, durationMs: 65000 },
      { beadId: 'bd-222', workerId: 'w-worker-two', completedAt: 1770002400000 }, // no duration
      { beadId: 'bd-333', workerId: 'w-worker-one', completedAt: 1770003500000, durationMs: 500 },
    ],
    filesModified: [
      { path: '/repo/src/green.ts', modifications: 1, workers: ['w-a'], tools: ['Edit'] },
      { path: '/repo/src/cyan.ts', modifications: 3, workers: ['w-a', 'w-b'], tools: ['Edit', 'Write'] },
      { path: '/repo/src/yellow.ts', modifications: 5, workers: ['w-a'], tools: [] },
      { path: '/repo/src/red.ts', modifications: 10, workers: ['w-a', 'w-b'], tools: ['Edit'] },
    ],
    errors: [
      {
        message: 'x'.repeat(120), // >100 chars -> truncated with ellipsis
        category: 'network',
        workerId: 'w-worker-one',
        timestamp: 1770001000000,
        fingerprint: 'network-fingerprint',
      },
      {
        message: 'permission denied',
        category: 'permission',
        workerId: 'w-worker-two',
        timestamp: 1770002000000,
      },
    ],
    workers: [
      {
        workerId: 'w-worker-two',
        beadsCompleted: 1,
        filesModified: 2,
        errorsEncountered: 1,
        totalEvents: 40,
        activeTimeMs: 5500, // 5.5s branch of formatDuration
        firstActivity: 1770000100000,
        lastActivity: 1770003400000,
      },
      {
        workerId: 'w-worker-one',
        beadsCompleted: 2,
        filesModified: 2,
        errorsEncountered: 1,
        totalEvents: 60,
        activeTimeMs: 450, // ms branch of formatDuration
        firstActivity: 1770000050000,
        lastActivity: 1770003500000,
      },
    ],
    cost: {
      totalTokens: 12000,
      inputTokens: 8000,
      outputTokens: 4000,
      estimatedCostUsd: 0.1234,
    },
    stats: {
      totalEvents: 100,
      totalWorkers: 2,
      totalBeads: 3,
      totalFiles: 4,
      totalErrors: 2,
      avgEventsPerWorker: 50,
      avgBeadsPerWorker: 1.5,
    },
  };
}

/** A digest with empty lists — exercises each render method's empty branch. */
function makeEmptyDigest(): SessionDigestData {
  return {
    sessionId: 'session-empty',
    startTime: 1770000000000,
    endTime: 1770000600000,
    durationMs: 60000, // 1m 0s branch of formatDuration
    beadsCompleted: [],
    filesModified: [],
    errors: [],
    workers: [],
    cost: { totalTokens: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
    stats: {
      totalEvents: 0,
      totalWorkers: 0,
      totalBeads: 0,
      totalFiles: 0,
      totalErrors: 0,
      avgEventsPerWorker: 0,
      avgBeadsPerWorker: 0,
    },
  };
}

describe('SessionDigest component', () => {
  let screen: blessed.Widgets.Screen;
  let component: SessionDigest;
  let exported: Array<{ format: string; path: string }>;
  let writeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useRealTimers();
    writeMock = fs.writeFileSync as unknown as ReturnType<typeof vi.fn>;
    writeMock.mockReset();
    writeMock.mockImplementation(() => undefined);

    exported = [];
    screen = blessed.screen({ smartCSR: true, dump: false, warnings: false });
    component = createSessionDigest({
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      onExport: (format, path) => exported.push({ format, path }),
    });
  });

  afterEach(() => {
    component.getElement().destroy();
    screen.destroy();
    vi.useRealTimers();
  });

  it('creates a hidden panel via the factory and exposes its element', () => {
    expect(component).toBeInstanceOf(SessionDigest);
    expect(component.isVisible()).toBe(false);
    expect(component.getElement().options.label).toBe(' Session Digest ');
  });

  it('shows, hides, and toggles visibility', () => {
    component.show();
    expect(component.isVisible()).toBe(true);
    component.hide();
    expect(component.isVisible()).toBe(false);
    component.toggle(); // hidden -> show
    expect(component.isVisible()).toBe(true);
    component.toggle(); // visible -> hide
    expect(component.isVisible()).toBe(false);
    expect(() => component.focus()).not.toThrow();
  });

  it('renders the no-data placeholder before a digest is set', () => {
    component.render();
    expect(plain(boxes(component).content.getContent())).toContain('No session data loaded');
  });

  it('exports nothing before a digest is set', () => {
    const footerBefore = boxes(component).footer.getContent();
    component.exportDigest('json');
    expect(writeMock).not.toHaveBeenCalled();
    expect(exported).toEqual([]);
    expect(boxes(component).footer.getContent()).toBe(footerBefore);
  });

  it('renders the summary tab with stats, cost, and grouped error categories', () => {
    component.setDigest(makeRichDigest());

    const header = plain(boxes(component).header.getContent());
    expect(header).toContain('session-20261024...'); // sessionId sliced to 16 chars + ellipsis
    expect(header).toContain('1h 1m'); // durationMs 3660000

    const content = plain(boxes(component).content.getContent());
    expect(content).toContain('SESSION SUMMARY');
    expect(content).toContain('Total Events:     100');
    expect(content).toContain('Est. Cost:        $0.1234');
    expect(content).toContain('network: 1');
    expect(content).toContain('permission: 1');
    // 120-char message not on this tab; category counts only
    expect(component.getCurrentTab()).toBe('summary');
  });

  it('renders every tab and reports the current tab', () => {
    component.setDigest(makeRichDigest());

    const expectations: Array<[DigestViewTab, string]> = [
      ['summary', 'SESSION SUMMARY'],
      ['beads', 'COMPLETED BEADS'],
      ['files', 'FILES MODIFIED'],
      ['errors', 'ERRORS'],
      ['workers', 'WORKERS'],
    ];
    for (const [tab, marker] of expectations) {
      component.switchTab(tab);
      expect(component.getCurrentTab()).toBe(tab);
      expect(plain(boxes(component).content.getContent())).toContain(marker);
    }

    // Active tab is bracketed in the tab bar
    component.switchTab('beads');
    expect(plain(boxes(component).tabBar.getContent())).toContain('[2:Beads]');
  });

  it('renders beads newest-first with optional durations', () => {
    component.setDigest(makeRichDigest());
    component.switchTab('beads');

    const content = plain(boxes(component).content.getContent());
    const newest = content.indexOf('bd-333');
    const oldest = content.indexOf('bd-111');
    expect(newest).toBeGreaterThan(-1);
    expect(oldest).toBeGreaterThan(newest);
    expect(content).toContain('(1m 5s)'); // bd-111 duration
  });

  it('renders files with modification-count coloring tiers and tool lists', () => {
    component.setDigest(makeRichDigest());
    component.switchTab('files');

    const content = plain(boxes(component).content.getContent());
    expect(content).toContain('1 mod');       // green tier
    expect(content).toContain('3 mods');      // cyan tier
    expect(content).toContain('5 mods');      // yellow tier
    expect(content).toContain('10 mods');     // red tier
    expect(content).toContain('1 worker');
    expect(content).toContain('2 workers');
    expect(content).toContain('Tools: Edit, Write');
    expect(content.indexOf('/repo/src/red.ts')).toBeGreaterThan(-1);
  });

  it('renders errors newest-first with truncation over 100 chars and fingerprints', () => {
    component.setDigest(makeRichDigest());
    component.switchTab('errors');

    const content = plain(boxes(component).content.getContent());
    expect(content).toContain('[NETWORK]');
    expect(content).toContain('...');
    expect(content).toContain('Fingerprint: network-fingerprint');
    const permissionIdx = content.indexOf('permission denied');
    const networkIdx = content.indexOf('Fingerprint');
    // sorted newest-first: permission (ts ...20m) renders before network (ts ...10m)
    expect(networkIdx).toBeGreaterThan(permissionIdx);
  });

  it('renders workers most-productive-first with duration formatting', () => {
    component.setDigest(makeRichDigest());
    component.switchTab('workers');

    const content = plain(boxes(component).content.getContent());
    const twoIdx = content.indexOf('w-worker-two');
    const oneIdx = content.indexOf('w-worker-one');
    // w-worker-one has 2 beads and sorts first
    expect(oneIdx).toBeGreaterThan(-1);
    expect(twoIdx).toBeGreaterThan(oneIdx);
    expect(content).toContain('5.5s');  // w-worker-two activeTime
    expect(content).toContain('450ms'); // w-worker-one activeTime
  });

  it('renders empty-list placeholders on every tab', () => {
    component.setDigest(makeEmptyDigest());

    const placeholders: Array<[DigestViewTab, string]> = [
      ['beads', 'No beads completed'],
      ['files', 'No files modified'],
      ['errors', 'No errors encountered'],
      ['workers', 'No workers in this session'],
    ];
    for (const [tab, marker] of placeholders) {
      component.switchTab(tab);
      expect(plain(boxes(component).content.getContent())).toContain(marker);
    }

    // Summary of the empty digest omits the error section entirely
    component.switchTab('summary');
    expect(plain(boxes(component).content.getContent())).not.toContain('─── Errors');
  });

  it('exports json, markdown, and text digests and fires onExport', () => {
    vi.useFakeTimers();
    component.setDigest(makeRichDigest());
    const footerOriginal = ' [1-5] Tabs  [e] Export JSON  [m] Export Markdown  [j/k] Scroll  [Esc] Close';

    component.exportDigest('json');
    expect(writeMock).toHaveBeenCalledTimes(1);
    const [jsonPath, jsonContent] = writeMock.mock.calls[0] as [string, string];
    expect(jsonPath).toMatch(/session-digest-.*\.json$/);
    expect(jsonContent).toContain('"sessionId": "session-20261024-abcdefgh"');
    expect(boxes(component).footer.getContent()).toContain('Exported to');
    expect(exported).toEqual([{ format: 'json', path: jsonPath }]);

    // Footer resets to the control hint after 3 seconds
    vi.advanceTimersByTime(3000);
    expect(boxes(component).footer.getContent()).toBe(footerOriginal);

    component.exportDigest('markdown');
    const [, mdContent] = writeMock.mock.calls[1] as [string, string];
    expect(mdContent).toContain('# Session Digest');
    expect(mdContent).toContain('| Bead ID | Worker | Completed At | Duration |');
    expect(mdContent).toContain('| bd-111 | w-worker |');
    expect(mdContent).toContain('`/repo/src/red.ts` | 10 | 2 |');

    component.exportDigest('text');
    const [, txtContent] = writeMock.mock.calls[2] as [string, string];
    expect(txtContent).toContain('SESSION DIGEST');
    expect(txtContent).toContain('[NETWORK]');

    expect(exported.map((e) => e.format)).toEqual(['json', 'markdown', 'text']);
    vi.useRealTimers();
  });

  it('exports markdown and text with empty-list wording for an empty digest', () => {
    component.setDigest(makeEmptyDigest());
    component.exportDigest('markdown');
    const [, md] = writeMock.mock.calls[0] as [string, string];
    expect(md).toContain('_No beads completed_');
    expect(md).toContain('_No files modified_');
    expect(md).toContain('_No errors encountered_');

    component.exportDigest('text');
    const [, txt] = writeMock.mock.calls[1] as [string, string];
    expect(txt).toContain('No beads completed');
    expect(txt).toContain('No files modified');
    expect(txt).toContain('No errors encountered');
    expect(exported.map((e) => e.format)).toEqual(['markdown', 'text']);
  });

  it('shows an export-failure message when the write throws', () => {
    writeMock.mockImplementationOnce(() => {
      throw new Error('EACCES: permission denied');
    });
    component.setDigest(makeRichDigest());

    component.exportDigest('json');
    expect(boxes(component).footer.getContent()).toContain('Export failed');
    expect(exported).toEqual([]); // onExport not called on failure
  });

  it('binds tab and export keys on the content box', () => {
    const { instance, handlers } = captureKeyBindings(() =>
      createSessionDigest({ parent: screen, top: 0, left: 0, width: '100%', height: '100%' }),
    );
    try {
      instance.setDigest(makeRichDigest());

      for (const [key, tab] of [
        ['1', 'summary'],
        ['2', 'beads'],
        ['3', 'files'],
        ['4', 'errors'],
        ['5', 'workers'],
      ] as const) {
        handlers.get(key)!();
        expect(instance.getCurrentTab()).toBe(tab);
      }

      handlers.get('e')!();
      expect(writeMock).toHaveBeenCalledTimes(1);
      expect((writeMock.mock.calls[0] as [string])[0]).toMatch(/\.json$/);

      handlers.get('m')!();
      expect((writeMock.mock.calls[1] as [string])[0]).toMatch(/\.md$/);

      handlers.get('t')!();
      expect((writeMock.mock.calls[2] as [string])[0]).toMatch(/\.txt$/);
    } finally {
      instance.getElement().destroy();
    }
  });
});
