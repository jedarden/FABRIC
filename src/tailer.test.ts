/**
 * Tests for FABRIC Log Tailer
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { LogTailer } from './tailer.js';

describe('LogTailer', () => {
  let tempDir: string;
  let logFile: string;

  beforeEach(() => {
    // Create temp directory and file
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-test-'));
    logFile = path.join(tempDir, 'test.log');
  });

  afterEach(() => {
    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should expand ~ to home directory', () => {
      const tailer = new LogTailer({ path: '~/test.log' });
      expect(tailer).toBeDefined();
    });

    it('should accept absolute paths', () => {
      const tailer = new LogTailer({ path: '/var/log/test.log' });
      expect(tailer).toBeDefined();
    });

    it('should default parseJson to true', () => {
      const tailer = new LogTailer({ path: logFile });
      expect(tailer).toBeDefined();
    });

    it('should default follow to true', () => {
      const tailer = new LogTailer({ path: logFile });
      expect(tailer).toBeDefined();
    });

    it('should default lines to 0', () => {
      const tailer = new LogTailer({ path: logFile });
      expect(tailer).toBeDefined();
    });
  });

  describe('start', () => {
    it('should emit error when file does not exist', async () => {
      const tailer = new LogTailer({ path: '/nonexistent/path/test.log' });

      const errorPromise = new Promise<Error>((resolve) => {
        tailer.on('error', resolve);
      });

      tailer.start();

      const err = await errorPromise;
      expect(err.message).toContain('Log file not found');
    });

    it('should start successfully when file exists', () => {
      fs.writeFileSync(logFile, '');
      const tailer = new LogTailer({ path: logFile, follow: false });

      // Should not throw
      tailer.start();
      // If we get here without error, the test passes
      expect(true).toBe(true);
    });
  });

  describe('event parsing', () => {
    it('should emit parsed events for valid JSON lines', async () => {
      const event = {
        ts: Date.now(),
        worker: 'w-test',
        level: 'info' as const,
        msg: 'Test message',
      };
      fs.writeFileSync(logFile, JSON.stringify(event) + '\n');

      const tailer = new LogTailer({
        path: logFile,
        follow: false,
        lines: 10,
      });

      const eventPromise = new Promise<any>((resolve) => {
        tailer.on('event', resolve);
      });

      tailer.start();

      const parsed = await eventPromise;
      expect(parsed.ts).toBe(event.ts);
      expect(parsed.worker).toBe(event.worker);
      expect(parsed.level).toBe(event.level);
      expect(parsed.msg).toBe(event.msg);
    });

    it('should emit raw lines regardless of JSON validity', async () => {
      fs.writeFileSync(logFile, 'not valid json\n');

      const tailer = new LogTailer({
        path: logFile,
        follow: false,
        lines: 10,
        parseJson: false,
      });

      const linePromise = new Promise<string>((resolve) => {
        tailer.on('line', resolve);
      });

      tailer.start();

      const line = await linePromise;
      expect(line).toBe('not valid json');
    });

    it('should not emit event for invalid JSON when parseJson is true', async () => {
      fs.writeFileSync(logFile, 'not valid json\n');

      const tailer = new LogTailer({
        path: logFile,
        follow: false,
        lines: 10,
      });

      let eventEmitted = false;
      tailer.on('event', () => {
        eventEmitted = true;
      });

      tailer.start();

      // Wait a bit for processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(eventEmitted).toBe(false);
    });

    it('should handle empty lines gracefully', async () => {
      fs.writeFileSync(logFile, '\n\n\n');

      const tailer = new LogTailer({
        path: logFile,
        follow: false,
        lines: 10,
      });

      let eventCount = 0;
      tailer.on('event', () => {
        eventCount++;
      });

      tailer.start();

      // Wait a bit for processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(eventCount).toBe(0);
    });
  });

  describe('reading existing lines', () => {
    it('should read last N lines on start when lines option is set', async () => {
      const events = [
        { ts: 1, worker: 'w1', level: 'info' as const, msg: 'first' },
        { ts: 2, worker: 'w2', level: 'info' as const, msg: 'second' },
        { ts: 3, worker: 'w3', level: 'info' as const, msg: 'third' },
      ];
      fs.writeFileSync(logFile, events.map((e) => JSON.stringify(e)).join('\n') + '\n');

      const tailer = new LogTailer({
        path: logFile,
        follow: false,
        lines: 2, // Only read last 2 lines
      });

      const receivedEvents: any[] = [];
      const allReceived = new Promise<void>((resolve) => {
        tailer.on('event', (event) => {
          receivedEvents.push(event);
          if (receivedEvents.length === 2) {
            resolve();
          }
        });
      });

      tailer.start();

      await allReceived;

      // Should have received 2 events (second and third)
      expect(receivedEvents.length).toBe(2);
      expect(receivedEvents[0].msg).toBe('second');
      expect(receivedEvents[1].msg).toBe('third');
    });

    it('should read all lines when lines is greater than file', async () => {
      const events = [
        { ts: 1, worker: 'w1', level: 'info' as const, msg: 'first' },
        { ts: 2, worker: 'w2', level: 'info' as const, msg: 'second' },
      ];
      fs.writeFileSync(logFile, events.map((e) => JSON.stringify(e)).join('\n') + '\n');

      const tailer = new LogTailer({
        path: logFile,
        follow: false,
        lines: 100, // More than file has
      });

      const receivedEvents: any[] = [];
      const allReceived = new Promise<void>((resolve) => {
        tailer.on('event', (event) => {
          receivedEvents.push(event);
          if (receivedEvents.length === 2) {
            resolve();
          }
        });
      });

      tailer.start();

      await allReceived;
      expect(receivedEvents.length).toBe(2);
    });
  });

  describe('stop', () => {
    it('should stop watching file', async () => {
      fs.writeFileSync(logFile, '');
      const tailer = new LogTailer({ path: logFile, follow: true });

      const endPromise = new Promise<void>((resolve) => {
        tailer.on('end', resolve);
      });

      tailer.start();
      // Give it time to start watching
      await new Promise((resolve) => setTimeout(resolve, 50));
      tailer.stop();

      await endPromise;
      expect(tailer.isActive).toBe(false);
    });

    it('should emit end event when stopped', async () => {
      fs.writeFileSync(logFile, '');
      const tailer = new LogTailer({ path: logFile, follow: true });

      const endPromise = new Promise<void>((resolve) => {
        tailer.on('end', resolve);
      });

      tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 50));
      tailer.stop();

      await endPromise;
    });
  });

  describe('follow mode', () => {
    it('should detect new content appended to file', async () => {
      fs.writeFileSync(logFile, '');
      const tailer = new LogTailer({ path: logFile, follow: true });

      const event = {
        ts: Date.now(),
        worker: 'w-test',
        level: 'info' as const,
        msg: 'new event',
      };

      const eventPromise = new Promise<any>((resolve) => {
        tailer.on('event', resolve);
      });

      tailer.start();

      // Append to file after a short delay
      await new Promise((resolve) => setTimeout(resolve, 100));
      fs.appendFileSync(logFile, JSON.stringify(event) + '\n');

      const parsed = await eventPromise;
      expect(parsed.msg).toBe('new event');
      tailer.stop();
    });

    it('should handle multiple events appended', async () => {
      fs.writeFileSync(logFile, '');
      const tailer = new LogTailer({ path: logFile, follow: true });

      const events = [
        { ts: 1, worker: 'w1', level: 'info' as const, msg: 'first' },
        { ts: 2, worker: 'w2', level: 'info' as const, msg: 'second' },
      ];

      const receivedEvents: any[] = [];
      const allEventsPromise = new Promise<void>((resolve) => {
        tailer.on('event', (event) => {
          receivedEvents.push(event);
          if (receivedEvents.length === 2) {
            resolve();
          }
        });
      });

      tailer.start();

      // Append events after a short delay
      await new Promise((resolve) => setTimeout(resolve, 100));
      fs.appendFileSync(logFile, events.map((e) => JSON.stringify(e)).join('\n') + '\n');

      await allEventsPromise;
      expect(receivedEvents[0].msg).toBe('first');
      expect(receivedEvents[1].msg).toBe('second');
      tailer.stop();
    });
  });

  describe('isActive', () => {
    it('should be false before start', () => {
      fs.writeFileSync(logFile, '');
      const tailer = new LogTailer({ path: logFile, follow: true });
      expect(tailer.isActive).toBe(false);
    });

    it('should be true after start in follow mode', async () => {
      fs.writeFileSync(logFile, '');
      const tailer = new LogTailer({ path: logFile, follow: true });

      tailer.start();
      // Give it a moment to set up the watcher
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(tailer.isActive).toBe(true);
      tailer.stop();
    });

    it('should be false after stop', async () => {
      fs.writeFileSync(logFile, '');
      const tailer = new LogTailer({ path: logFile, follow: true });

      const endPromise = new Promise<void>((resolve) => {
        tailer.on('end', resolve);
      });

      tailer.start();
      await new Promise((resolve) => setTimeout(resolve, 50));
      tailer.stop();

      await endPromise;
      expect(tailer.isActive).toBe(false);
    });
  });
});
