/**
 * Session Replay Export/Import Utilities Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { LogEvent } from '../types.js';
import {
  createReplayExport,
  exportToJson,
  exportToBase64,
  exportToMarkdown,
  importFromJson,
  importFromBase64,
  generateShareableUrl,
  extractReplayFromUrl,
  generateExportFilename,
  validateReplayExport,
  formatAsMarkdown,
  REPLAY_EXPORT_VERSION,
  type ReplayExport,
} from './replayExport.js';

describe('replayExport', () => {
  const mockEvents: LogEvent[] = [
    {
      ts: 1000,
      worker: 'w-abc123',
      level: 'info',
      msg: 'Starting task',
      bead: 'bd-xyz',
    },
    {
      ts: 2000,
      worker: 'w-abc123',
      level: 'debug',
      msg: 'Reading file',
      tool: 'Read',
      path: '/home/test.ts',
    },
    {
      ts: 3000,
      worker: 'w-def456',
      level: 'warn',
      msg: 'Warning occurred',
    },
    {
      ts: 4000,
      worker: 'w-abc123',
      level: 'error',
      msg: 'Error in process',
      error: 'Something went wrong',
    },
    {
      ts: 5000,
      worker: 'w-abc123',
      level: 'info',
      msg: 'Task completed',
      bead: 'bd-xyz',
    },
  ];

  describe('REPLAY_EXPORT_VERSION', () => {
    it('should be defined', () => {
      expect(REPLAY_EXPORT_VERSION).toBeDefined();
      expect(typeof REPLAY_EXPORT_VERSION).toBe('string');
    });
  });

  describe('createReplayExport', () => {
    it('should create export with correct structure', () => {
      const exportData = createReplayExport(mockEvents);

      expect(exportData.version).toBe(REPLAY_EXPORT_VERSION);
      expect(exportData.exportedAt).toBeTypeOf('number');
      expect(exportData.eventCount).toBe(mockEvents.length);
      expect(exportData.events).toEqual(mockEvents);
      expect(exportData.metadata).toBeDefined();
    });

    it('should sort events by timestamp', () => {
      const unsortedEvents: LogEvent[] = [
        { ts: 3000, worker: 'w-1', level: 'info', msg: 'Third' },
        { ts: 1000, worker: 'w-1', level: 'info', msg: 'First' },
        { ts: 2000, worker: 'w-1', level: 'info', msg: 'Second' },
      ];

      const exportData = createReplayExport(unsortedEvents);
      expect(exportData.events[0].ts).toBe(1000);
      expect(exportData.events[1].ts).toBe(2000);
      expect(exportData.events[2].ts).toBe(3000);
    });

    it('should calculate correct metadata', () => {
      const exportData = createReplayExport(mockEvents);

      expect(exportData.metadata.sessionStart).toBe(1000);
      expect(exportData.metadata.sessionEnd).toBe(5000);
      expect(exportData.metadata.workerCount).toBe(2); // w-abc123 and w-def456
    });

    it('should handle empty events', () => {
      const exportData = createReplayExport([]);

      expect(exportData.eventCount).toBe(0);
      expect(exportData.events).toEqual([]);
      expect(exportData.metadata.workerCount).toBe(0);
      expect(exportData.metadata.sessionStart).toBeTypeOf('number');
      expect(exportData.metadata.sessionEnd).toBeTypeOf('number');
    });

    it('should include optional fields in metadata', () => {
      const exportData = createReplayExport(mockEvents, {
        sourcePath: '/path/to/logs',
        description: 'Test session',
      });

      expect(exportData.metadata.sourcePath).toBe('/path/to/logs');
      expect(exportData.metadata.description).toBe('Test session');
    });
  });

  describe('exportToJson', () => {
    it('should export as JSON string', () => {
      const jsonString = exportToJson(mockEvents);
      const parsed = JSON.parse(jsonString);

      expect(parsed.version).toBe(REPLAY_EXPORT_VERSION);
      expect(parsed.eventCount).toBe(mockEvents.length);
      expect(parsed.events).toEqual(mockEvents);
    });

    it('should be parseable back to ReplayExport', () => {
      const jsonString = exportToJson(mockEvents);
      const parsed = JSON.parse(jsonString) as ReplayExport;

      expect(validateReplayExport(parsed)).toBe(true);
    });

    it('should include options in export', () => {
      const jsonString = exportToJson(mockEvents, {
        sourcePath: '/test/path',
        description: 'Test description',
      });
      const parsed = JSON.parse(jsonString) as ReplayExport;

      expect(parsed.metadata.sourcePath).toBe('/test/path');
      expect(parsed.metadata.description).toBe('Test description');
    });
  });

  describe('exportToBase64', () => {
    it('should export as base64 string', () => {
      const base64String = exportToBase64(mockEvents);

      expect(typeof base64String).toBe('string');
      expect(base64String.length).toBeGreaterThan(0);
    });

    it('should be decodable back to original data', () => {
      const base64String = exportToBase64(mockEvents);
      const decoded = importFromBase64(base64String);

      expect(decoded.eventCount).toBe(mockEvents.length);
      expect(decoded.events).toEqual(mockEvents);
    });

    it('should handle special characters', () => {
      const eventsWithSpecialChars: LogEvent[] = [
        { ts: 1000, worker: 'w-1', level: 'info', msg: 'Test with emoji 🎉' },
        { ts: 2000, worker: 'w-1', level: 'info', msg: 'Test with quotes "hello"' },
        { ts: 3000, worker: 'w-1', level: 'info', msg: 'Test with newlines\n' },
      ];

      const base64String = exportToBase64(eventsWithSpecialChars);
      const decoded = importFromBase64(base64String);

      expect(decoded.events[0].msg).toBe('Test with emoji 🎉');
      expect(decoded.events[1].msg).toBe('Test with quotes "hello"');
      expect(decoded.events[2].msg).toBe('Test with newlines\n');
    });
  });

  describe('importFromJson', () => {
    it('should import valid JSON', () => {
      const jsonString = exportToJson(mockEvents);
      const imported = importFromJson(jsonString);

      expect(imported.eventCount).toBe(mockEvents.length);
      expect(imported.events).toEqual(mockEvents);
    });

    it('should throw on invalid format', () => {
      expect(() => importFromJson('not json')).toThrow();
      expect(() => importFromJson('[]')).toThrow();
      expect(() => importFromJson('{"events": "not an array"}')).toThrow();
    });

    it('should throw on invalid event format', () => {
      const invalidJson = JSON.stringify({
        version: '1.0',
        events: [{ invalid: 'event' }],
      });

      expect(() => importFromJson(invalidJson)).toThrow();
    });

    it('should validate required event fields', () => {
      const invalidJson = JSON.stringify({
        version: '1.0',
        events: [{ ts: 1000, worker: 'w-1' }], // missing msg
      });

      expect(() => importFromJson(invalidJson)).toThrow();
    });
  });

  describe('importFromBase64', () => {
    it('should import valid base64', () => {
      const base64String = exportToBase64(mockEvents);
      const imported = importFromBase64(base64String);

      expect(imported.eventCount).toBe(mockEvents.length);
      expect(imported.events).toEqual(mockEvents);
    });

    it('should throw on invalid base64', () => {
      expect(() => importFromBase64('not base64!!!')).toThrow();
    });

    it('should throw on invalid JSON in base64', () => {
      const invalidBase64 = Buffer.from('not json').toString('base64');
      expect(() => importFromBase64(invalidBase64)).toThrow();
    });
  });

  describe('generateShareableUrl', () => {
    it('should generate URL with replay parameter', () => {
      const baseUrl = 'https://example.com/replay';
      const url = generateShareableUrl(mockEvents, baseUrl);

      expect(url).toContain(baseUrl);
      expect(url).toContain('replay=');
    });

    it('should be parseable by extractReplayFromUrl', () => {
      const baseUrl = 'https://example.com/replay';
      const url = generateShareableUrl(mockEvents, baseUrl);

      const extracted = extractReplayFromUrl(url);

      expect(extracted).not.toBeNull();
      expect(extracted?.eventCount).toBe(mockEvents.length);
    });

    it('should preserve existing URL parameters', () => {
      const baseUrl = 'https://example.com/replay?foo=bar';
      const url = generateShareableUrl(mockEvents, baseUrl);

      expect(url).toContain('foo=bar');
      expect(url).toContain('replay=');
    });

    it('should include options in export', () => {
      const baseUrl = 'https://example.com/replay';
      const url = generateShareableUrl(mockEvents, baseUrl, {
        sourcePath: '/test/path',
        description: 'Test description',
      });

      const extracted = extractReplayFromUrl(url);
      expect(extracted?.metadata.sourcePath).toBe('/test/path');
      expect(extracted?.metadata.description).toBe('Test description');
    });
  });

  describe('extractReplayFromUrl', () => {
    it('should extract replay data from URL', () => {
      const baseUrl = 'https://example.com/replay';
      const url = generateShareableUrl(mockEvents, baseUrl);

      const extracted = extractReplayFromUrl(url);

      expect(extracted).not.toBeNull();
      expect(extracted?.eventCount).toBe(mockEvents.length);
      expect(extracted?.events).toEqual(mockEvents);
    });

    it('should return null for URL without replay parameter', () => {
      const extracted = extractReplayFromUrl('https://example.com/replay');
      expect(extracted).toBeNull();
    });

    it('should return null for invalid replay data', () => {
      const url = 'https://example.com/replay?replay=invalid';
      const extracted = extractReplayFromUrl(url);
      expect(extracted).toBeNull();
    });

    it('should handle malformed URLs gracefully', () => {
      expect(extractReplayFromUrl('not a url')).toBeNull();
      expect(extractReplayFromUrl('')).toBeNull();
    });
  });

  describe('generateExportFilename', () => {
    it('should generate filename with date and time', () => {
      const metadata = {
        sessionStart: 1609459200000, // 2021-01-01 00:00:00 UTC
        sessionEnd: 1609459260000,
        workerCount: 2,
      };

      const filename = generateExportFilename(metadata);

      expect(filename).toMatch(/^session-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.fabric-replay$/);
    });

    it('should generate consistent filenames for same session', () => {
      const metadata = {
        sessionStart: 1609459200000,
        sessionEnd: 1609459260000,
        workerCount: 2,
      };

      const filename1 = generateExportFilename(metadata);
      const filename2 = generateExportFilename(metadata);

      expect(filename1).toBe(filename2);
    });
  });

  describe('validateReplayExport', () => {
    it('should validate correct structure', () => {
      const exportData = createReplayExport(mockEvents);
      expect(validateReplayExport(exportData)).toBe(true);
    });

    it('should reject null', () => {
      expect(validateReplayExport(null)).toBe(false);
    });

    it('should reject non-object', () => {
      expect(validateReplayExport('string')).toBe(false);
      expect(validateReplayExport(123)).toBe(false);
      expect(validateReplayExport([])).toBe(false);
    });

    it('should reject missing version', () => {
      const invalid = { version: undefined } as unknown as ReplayExport;
      expect(validateReplayExport(invalid)).toBe(false);
    });

    it('should reject missing events array', () => {
      const invalid = { version: '1.0', events: 'not array' } as unknown as ReplayExport;
      expect(validateReplayExport(invalid)).toBe(false);
    });

    it('should reject missing metadata', () => {
      const invalid = { version: '1.0', events: [], metadata: null } as unknown as ReplayExport;
      expect(validateReplayExport(invalid)).toBe(false);
    });

    it('should reject invalid metadata fields', () => {
      const invalid = {
        version: '1.0',
        exportedAt: Date.now(),
        eventCount: 0,
        events: [],
        metadata: {
          sessionStart: 'not a number',
          sessionEnd: 2000,
          workerCount: 1,
        },
      } as unknown as ReplayExport;

      expect(validateReplayExport(invalid)).toBe(false);
    });
  });

  describe('exportToMarkdown', () => {
    it('should export as markdown string', () => {
      const markdown = exportToMarkdown(mockEvents);

      expect(typeof markdown).toBe('string');
      expect(markdown).toContain('# Session Replay');
      expect(markdown).toContain('## Session Information');
      expect(markdown).toContain('## Events');
    });

    it('should include session metadata', () => {
      const markdown = exportToMarkdown(mockEvents, {
        sourcePath: '/test/path',
        description: 'Test description',
      });

      expect(markdown).toContain('/test/path');
      expect(markdown).toContain('Test description');
    });

    it('should include events table', () => {
      const markdown = exportToMarkdown(mockEvents);

      expect(markdown).toContain('| Time | Worker | Level |');
      expect(markdown).toContain('INFO');
      expect(markdown).toContain('DEBUG');
      expect(markdown).toContain('WARN');
      expect(markdown).toContain('ERROR');
    });

    it('should include worker breakdown', () => {
      const markdown = exportToMarkdown(mockEvents);

      expect(markdown).toContain('## Worker Breakdown');
      expect(markdown).toContain('| Worker | Events |');
    });

    it('should include level distribution', () => {
      const markdown = exportToMarkdown(mockEvents);

      expect(markdown).toContain('## Log Level Distribution');
      expect(markdown).toContain('| Level | Count |');
    });

    it('should handle empty events', () => {
      const markdown = exportToMarkdown([]);

      expect(markdown).toContain('_No events in this session_');
    });
  });

  describe('formatAsMarkdown', () => {
    it('should format ReplayExport as markdown', () => {
      const exportData = createReplayExport(mockEvents);
      const markdown = formatAsMarkdown(exportData);

      expect(markdown).toContain('# Session Replay');
      expect(markdown).toContain(`**Events:** ${mockEvents.length}`);
    });

    it('should format duration correctly', () => {
      const eventsWithDuration: LogEvent[] = [
        { ts: 1000, worker: 'w-1', level: 'info', msg: 'Start' },
        { ts: 65500, worker: 'w-1', level: 'info', msg: 'End' }, // ~65 seconds later
      ];

      const exportData = createReplayExport(eventsWithDuration);
      const markdown = formatAsMarkdown(exportData);

      expect(markdown).toContain('Duration:');
      expect(markdown).toMatch(/\d+s/); // Should contain seconds
    });
  });

  describe('Integration Tests', () => {
    it('should round-trip JSON export/import', () => {
      const original = createReplayExport(mockEvents, {
        sourcePath: '/test',
        description: 'Test',
      });

      const jsonString = exportToJson(mockEvents, {
        sourcePath: '/test',
        description: 'Test',
      });
      const imported = importFromJson(jsonString);

      expect(imported.version).toBe(original.version);
      expect(imported.events).toEqual(original.events);
      expect(imported.metadata.sessionStart).toBe(original.metadata.sessionStart);
      expect(imported.metadata.sessionEnd).toBe(original.metadata.sessionEnd);
      expect(imported.metadata.workerCount).toBe(original.metadata.workerCount);
      expect(imported.metadata.sourcePath).toBe(original.metadata.sourcePath);
      expect(imported.metadata.description).toBe(original.metadata.description);
    });

    it('should round-trip Base64 export/import', () => {
      const original = createReplayExport(mockEvents);
      const base64String = exportToBase64(mockEvents);
      const imported = importFromBase64(base64String);

      expect(imported.events).toEqual(original.events);
      expect(imported.metadata.workerCount).toBe(original.metadata.workerCount);
    });

    it('should round-trip URL export/extract', () => {
      const baseUrl = 'https://example.com/replay';
      const url = generateShareableUrl(mockEvents, baseUrl);
      const extracted = extractReplayFromUrl(url);

      expect(extracted).not.toBeNull();
      expect(extracted?.events).toEqual(mockEvents);
    });

    it('should handle large event sets', () => {
      const largeEvents: LogEvent[] = [];
      for (let i = 0; i < 1000; i++) {
        largeEvents.push({
          ts: i * 1000,
          worker: `w-${i % 10}`,
          level: 'info',
          msg: `Event ${i}`,
        });
      }

      const jsonString = exportToJson(largeEvents);
      const imported = importFromJson(jsonString);

      expect(imported.eventCount).toBe(1000);
      expect(imported.metadata.workerCount).toBe(10);
    });

    it('should handle all log levels', () => {
      const allLevels: LogEvent[] = ['debug', 'info', 'warn', 'error'].map((level, i) => ({
        ts: i * 1000,
        worker: 'w-1',
        level: level as LogEvent['level'],
        msg: `${level} message`,
      }));

      const markdown = exportToMarkdown(allLevels);

      expect(markdown).toContain('DEBUG');
      expect(markdown).toContain('INFO');
      expect(markdown).toContain('WARN');
      expect(markdown).toContain('ERROR');
    });
  });
});
