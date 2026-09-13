/**
 * FABRIC Memory Profiler Tests
 *
 * Tests heap snapshot capture mechanism with trigger reasons,
 * retention policy, and file reading capabilities.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { getMemoryProfiler, type SnapshotTrigger } from './memoryProfiler.js';
import { getHeapSnapshots, compareSnapshots } from './heapDiff.js';
import { existsSync, unlinkSync, readdirSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Isolate from the live service's snapshot directory. The running fabric web
// process writes real heap snapshots into ~/.needle/snapshots, and the full
// test suite's own memory pressure triggers it to capture mid-run — which
// breaks the exact-count assertions below (and the old cleanup deleted the
// service's real diagnostic snapshots). vi.hoisted runs before the module
// imports are evaluated, so both modules resolve the override.
const { SNAPSHOT_DIR } = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/fabric-snapshot-test-${process.pid}-${Date.now()}`;
  process.env.FABRIC_SNAPSHOT_DIR = dir;
  return { SNAPSHOT_DIR: dir };
});

describe('Memory Profiler', () => {
  const profiler = getMemoryProfiler();

  beforeAll(() => {
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
  });

  afterAll(() => {
    rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Clear any existing snapshots before tests
    if (existsSync(SNAPSHOT_DIR)) {
      const files = readdirSync(SNAPSHOT_DIR).filter(f => f.endsWith('.heapsnapshot'));
      for (const file of files) {
        try {
          unlinkSync(join(SNAPSHOT_DIR, file));
        } catch (err) {
          // Ignore errors during cleanup
        }
      }
    }
  });

  afterEach(() => {
    // Clean up test snapshots
    if (existsSync(SNAPSHOT_DIR)) {
      const files = readdirSync(SNAPSHOT_DIR).filter(f => f.endsWith('.heapsnapshot'));
      for (const file of files) {
        try {
          unlinkSync(join(SNAPSHOT_DIR, file));
        } catch (err) {
          // Ignore errors during cleanup
        }
      }
    }
  });

  describe('Heap Snapshot Capture', () => {
    it('should capture memory snapshot with timestamp', () => {
      const snapshot = profiler.capture();

      expect(snapshot).toBeDefined();
      expect(snapshot.timestamp).toBeGreaterThan(0);
      expect(snapshot.rss).toBeGreaterThan(0);
      expect(snapshot.heapUsed).toBeGreaterThan(0);
      expect(snapshot.heapTotal).toBeGreaterThan(0);
    });

    // Every test below that writes heap snapshots carries an explicit timeout:
    // each write serializes the full V8 heap stop-the-world (tens of MB) and
    // the default 5s budget is not enough under CI's CPU quota. A timed-out
    // test also leaves its pending writes running, which pollutes the counts
    // of whichever test runs next — see the 60s precedent above.
    it('should write heap snapshot to disk with manual trigger', { timeout: 60_000 }, async () => {
      const filepath = await profiler.writeHeapSnapshot('manual');

      expect(filepath).toBeDefined();
      expect(filepath).toContain('.heapsnapshot');
      expect(filepath).toContain('manual');
      expect(existsSync(filepath)).toBe(true);
    });

    // Writes four full V8 heap snapshots back to back. Each one is tens of MB
    // and stops the world while it serializes, which overruns the default 5s
    // budget on a single-CPU CI container.
    it('should write heap snapshot with different trigger reasons', { timeout: 60_000 }, async () => {
      const triggers: SnapshotTrigger[] = ['manual', 'memory-pressure', 'periodic', 'test'];
      const filepaths: string[] = [];

      for (const trigger of triggers) {
        const filepath = await profiler.writeHeapSnapshot(trigger);
        filepaths.push(filepath);
        expect(existsSync(filepath)).toBe(true);
      }

      // Verify all files were created with correct trigger in filename
      for (let i = 0; i < triggers.length; i++) {
        expect(filepaths[i]).toContain(triggers[i]);
      }

      // Verify getHeapSnapshots can read them
      const snapshots = getHeapSnapshots();
      expect(snapshots.length).toBe(triggers.length);

      // Check that trigger reasons are extracted
      for (const snapshot of snapshots) {
        expect(snapshot.trigger).toBeDefined();
        expect(['manual', 'memory-pressure', 'periodic', 'test']).toContain(snapshot.trigger);
      }
    });

    it('should include timestamp and trigger reason in filename', { timeout: 60_000 }, async () => {
      const filepath = await profiler.writeHeapSnapshot('test');
      const filename = filepath.split('/').pop()!;

      // Filename format: heap-{timestamp}-{trigger}.heapsnapshot
      expect(filename).toMatch(/^heap-\d+-test\.heapsnapshot$/);

      // Extract and verify timestamp
      const match = filename.match(/heap-(\d+)-test\.heapsnapshot$/);
      expect(match).toBeTruthy();
      if (match) {
        const timestamp = parseInt(match[1], 10);
        const now = Date.now();
        expect(timestamp).toBeGreaterThan(now - 10000); // Within last 10 seconds
        expect(timestamp).toBeLessThanOrEqual(now);
      }
    });

    it('should create readable snapshot files', { timeout: 60_000 }, async () => {
      const filepath = await profiler.writeHeapSnapshot('test');

      // Verify file exists and is readable
      expect(existsSync(filepath)).toBe(true);

      // Verify file has content (heap snapshots are substantial files)
      const stats = require('fs').statSync(filepath);
      expect(stats.size).toBeGreaterThan(1000); // At least 1KB
    });
  });

  describe('Retention Policy', () => {
    it('should track snapshot count', () => {
      const initialCount = profiler.getSnapshotCount();
      expect(initialCount).toBe(0);
    });

    it('should apply retention policy after writing snapshot', { timeout: 60_000 }, async () => {
      // This test verifies the retention mechanism is called
      // Actual retention limits are high (50 files, 30 days) so we just
      // verify the mechanism works without hitting limits

      const countBefore = profiler.getSnapshotCount();
      await profiler.writeHeapSnapshot('test');
      const countAfter = profiler.getSnapshotCount();

      expect(countAfter).toBe(countBefore + 1);
    });

    it('should handle multiple snapshots efficiently', { timeout: 60_000 }, async () => {
      const writeCount = 5;

      for (let i = 0; i < writeCount; i++) {
        await profiler.writeHeapSnapshot('test');
        // Small delay to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const snapshots = getHeapSnapshots();
      expect(snapshots.length).toBe(writeCount);
    });
  });

  describe('Snapshot Reading and Comparison', () => {
    it('should read snapshots from disk', { timeout: 60_000 }, async () => {
      await profiler.writeHeapSnapshot('test');

      const snapshots = getHeapSnapshots();
      expect(snapshots.length).toBe(1);
      expect(snapshots[0].filename).toContain('test');
      expect(snapshots[0].sizeBytes).toBeGreaterThan(0);
      expect(snapshots[0].trigger).toBe('test');
    });

    it('should compare two snapshots successfully', { timeout: 60_000 }, async () => {
      await profiler.writeHeapSnapshot('test');
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 100));
      await profiler.writeHeapSnapshot('test');

      const snapshots = getHeapSnapshots();
      expect(snapshots.length).toBe(2);

      const diff = compareSnapshots(snapshots[0], snapshots[1]);

      expect(diff).toBeDefined();
      expect(diff.baseline.filename).toBe(snapshots[0].filename);
      expect(diff.current.filename).toBe(snapshots[1].filename);
      expect(diff.durationMs).toBeGreaterThan(0);
      expect(diff.sizeGrowthBytes).toBeDefined();
    });

    it('should provide meaningful assessment from snapshot comparison', { timeout: 60_000 }, async () => {
      await profiler.writeHeapSnapshot('test');
      await new Promise(resolve => setTimeout(resolve, 100));
      await profiler.writeHeapSnapshot('test');

      const snapshots = getHeapSnapshots();
      const diff = compareSnapshots(snapshots[0], snapshots[1]);

      expect(diff.assessment).toBeDefined();
      expect(['stable', 'growing', 'leaking', 'unknown']).toContain(diff.assessment);
      expect(diff.recommendations).toBeDefined();
      expect(Array.isArray(diff.recommendations)).toBe(true);
    });
  });

  describe('Integration with Memory Profiler', () => {
    it('should maintain consistent snapshot state between modules', { timeout: 60_000 }, async () => {
      // Write via profiler
      const filepath = await profiler.writeHeapSnapshot('test');

      // Read via heapDiff module
      const snapshots = getHeapSnapshots();
      expect(snapshots.length).toBe(1);
      expect(snapshots[0].filepath).toBe(filepath);
    });

    it('should handle concurrent snapshot operations', { timeout: 60_000 }, async () => {
      const promises = [];
      for (let i = 0; i < 3; i++) {
        // Add delay between writes to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 50));
        promises.push(profiler.writeHeapSnapshot('test'));
      }

      const filepaths = await Promise.all(promises);
      expect(filepaths).toHaveLength(3);

      // All files should exist
      for (const filepath of filepaths) {
        expect(existsSync(filepath)).toBe(true);
      }

      // Should be readable via getHeapSnapshots
      const snapshots = getHeapSnapshots();
      expect(snapshots.length).toBeGreaterThanOrEqual(3); // At least 3, may be more from other tests
    });
  });
});
