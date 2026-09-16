/**
 * FABRIC Memory Profiler Tests
 *
 * Tests heap snapshot capture mechanism with trigger reasons,
 * retention policy, and file reading capabilities.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { getMemoryProfiler, shouldCapturePressureSnapshot, type SnapshotTrigger, type MemorySnapshot } from './memoryProfiler.js';
import { getHeapSnapshots, compareSnapshots } from './heapDiff.js';
import { existsSync, unlinkSync, readdirSync, readFileSync, mkdirSync, rmSync, writeFileSync, truncateSync, utimesSync } from 'fs';
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

/**
 * Create a placeholder .heapsnapshot file with a controlled size and age.
 * Retention and reading only ever stat these files, so sparse placeholders
 * exercise the policy without paying for real (heap-sized) writes.
 */
function writeFakeSnapshot(filename: string, sizeBytes: number, ageMs: number): string {
  const filepath = join(SNAPSHOT_DIR, filename);
  writeFileSync(filepath, '');
  truncateSync(filepath, sizeBytes); // sparse: stat.size reports sizeBytes
  const mtime = new Date(Date.now() - ageMs);
  utimesSync(filepath, mtime, mtime);
  return filepath;
}

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

    // Writes five full V8 heap snapshots back to back. Each one is tens of MB
    // and stops the world while it serializes, which overruns the default 5s
    // budget on a single-CPU CI container.
    it('should write heap snapshot with different trigger reasons', { timeout: 60_000 }, async () => {
      const triggers: SnapshotTrigger[] = ['manual', 'memory-pressure', 'periodic', 'oom-risk', 'test'];
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
        expect(['manual', 'memory-pressure', 'periodic', 'oom-risk', 'test']).toContain(snapshot.trigger);
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

    it('should prune oldest snapshots when total size cap is exceeded', { timeout: 60_000 }, async () => {
      // Cap is read from the environment at retention time (not module load),
      // so a 1-byte cap forces the size-based pass on every write.
      const previousCap = process.env.FABRIC_SNAPSHOT_MAX_TOTAL_BYTES;
      process.env.FABRIC_SNAPSHOT_MAX_TOTAL_BYTES = '1';
      try {
        // First write: a single snapshot always exceeds a 1-byte cap but must
        // survive — the just-written file is never pruned by the size pass.
        await profiler.writeHeapSnapshot('test');
        await new Promise(resolve => setTimeout(resolve, 50));
        const secondFilepath = await profiler.writeHeapSnapshot('test');

        const snapshots = getHeapSnapshots();
        expect(snapshots.length).toBe(1); // older one pruned, newest kept
        // Identifying the survivor by path proves the pass pruned oldest-first:
        // if it pruned the just-written file instead, the first write would remain.
        expect(snapshots[0].filepath).toBe(secondFilepath);
        expect(snapshots[0].trigger).toBe('test');
      } finally {
        if (previousCap === undefined) {
          delete process.env.FABRIC_SNAPSHOT_MAX_TOTAL_BYTES;
        } else {
          process.env.FABRIC_SNAPSHOT_MAX_TOTAL_BYTES = previousCap;
        }
      }
    });

    it('should enforce the 50-file on-disk limit, pruning the oldest first', { timeout: 60_000 }, async () => {
      // 55 placeholder snapshots, each older than the last (ages 6..60 min),
      // all under the default size cap and well within the age limit.
      const fakes: string[] = [];
      for (let i = 0; i < 55; i++) {
        fakes.push(writeFakeSnapshot(`heap-${1_000_000 + i}-test.heapsnapshot`, 1024, (60 - i) * 60_000));
      }

      // The real write is the newest file, pushing the directory to 56 files.
      const realFilepath = await profiler.writeHeapSnapshot('test');

      // Count-based cleanup prunes down to 50, taking the 6 oldest fakes.
      expect(profiler.getSnapshotCount()).toBe(50);
      expect(existsSync(realFilepath)).toBe(true);
      for (let i = 0; i < 6; i++) {
        expect(existsSync(fakes[i])).toBe(false);
      }
      for (let i = 6; i < 55; i++) {
        expect(existsSync(fakes[i])).toBe(true);
      }
    });

    it('should delete snapshots older than 30 days while keeping newer ones', { timeout: 60_000 }, async () => {
      const dayMs = 24 * 60 * 60 * 1000;
      // 31 days old (plus a minute, so the boundary is not razor-thin): pruned.
      const aged = [0, 1, 2].map(i =>
        writeFakeSnapshot(`heap-${2_000_000 + i}-test.heapsnapshot`, 1024, 31 * dayMs + 60_000));
      // 29 days old: retained.
      const fresh = [0, 1].map(i =>
        writeFakeSnapshot(`heap-${3_000_000 + i}-test.heapsnapshot`, 1024, 29 * dayMs));

      await profiler.writeHeapSnapshot('test');

      for (const filepath of aged) {
        expect(existsSync(filepath)).toBe(false);
      }
      for (const filepath of fresh) {
        expect(existsSync(filepath)).toBe(true);
      }
    });

    it('should apply a valid FABRIC_SNAPSHOT_MAX_TOTAL_BYTES cap at retention time', { timeout: 60_000 }, async () => {
      // A 5MB cap: far below the default 10 GiB, so with it set the fakes
      // must go; with the default they would survive (proved by the invalid-
      // override test below), which is what pins the env read at retention
      // time rather than at module load.
      const previousCap = process.env.FABRIC_SNAPSHOT_MAX_TOTAL_BYTES;
      process.env.FABRIC_SNAPSHOT_MAX_TOTAL_BYTES = String(5 * 1024 * 1024);
      try {
        const fakes = [0, 1, 2].map(i =>
          writeFakeSnapshot(`heap-${4_000_000 + i}-test.heapsnapshot`, 2 * 1024 * 1024, (10 - i) * 60_000));

        const realFilepath = await profiler.writeHeapSnapshot('test');

        // The real snapshot alone exceeds 5MB, so every older file is pruned
        // oldest-first — but the just-written file itself is never pruned.
        const snapshots = getHeapSnapshots();
        expect(snapshots.length).toBe(1);
        expect(snapshots[0].filepath).toBe(realFilepath);
        for (const filepath of fakes) {
          expect(existsSync(filepath)).toBe(false);
        }
      } finally {
        if (previousCap === undefined) {
          delete process.env.FABRIC_SNAPSHOT_MAX_TOTAL_BYTES;
        } else {
          process.env.FABRIC_SNAPSHOT_MAX_TOTAL_BYTES = previousCap;
        }
      }
    });

    it('should fall back to the 10 GiB default cap when FABRIC_SNAPSHOT_MAX_TOTAL_BYTES is invalid', { timeout: 60_000 }, async () => {
      const previousCap = process.env.FABRIC_SNAPSHOT_MAX_TOTAL_BYTES;
      const fakes = [0, 1].map(i =>
        writeFakeSnapshot(`heap-${5_000_000 + i}-test.heapsnapshot`, 2 * 1024 * 1024, (10 - i) * 60_000));

      try {
        // Unparseable, zero, and negative values all fall back to the default
        // cap rather than disabling the limit or clamping to zero.
        for (const invalid of ['not-a-number', '0', '-5']) {
          process.env.FABRIC_SNAPSHOT_MAX_TOTAL_BYTES = invalid;

          await profiler.writeHeapSnapshot('test');

          // Under the default cap nothing is size-pruned: both fakes survive.
          expect(existsSync(fakes[0])).toBe(true);
          expect(existsSync(fakes[1])).toBe(true);
        }
      } finally {
        if (previousCap === undefined) {
          delete process.env.FABRIC_SNAPSHOT_MAX_TOTAL_BYTES;
        } else {
          process.env.FABRIC_SNAPSHOT_MAX_TOTAL_BYTES = previousCap;
        }
      }
    });
  });

  describe('In-Memory Snapshot Retention', () => {
    it('should cap in-memory snapshots at 100, keeping the most recent', () => {
      const captured: MemorySnapshot[] = [];
      for (let i = 0; i < 105; i++) {
        captured.push(profiler.capture());
      }

      // getRecent(count) can only see what retention kept: asking for more
      // than the cap still returns exactly 100, and they are the newest 100.
      const retained = profiler.getRecent(1000);
      expect(retained.length).toBe(100);
      expect(retained).toEqual(captured.slice(-100));
    });
  });

  describe('Pressure Snapshot Policy', () => {
    it('should not capture when snapshots are disabled', () => {
      expect(shouldCapturePressureSnapshot(95, false, 0, Date.now())).toBe(false);
    });

    it('should not capture below the pressure threshold', () => {
      expect(shouldCapturePressureSnapshot(79.9, true, 0, Date.now())).toBe(false);
      expect(shouldCapturePressureSnapshot(80, true, 0, Date.now())).toBe(false);
    });

    it('should capture immediately on first pressure with no prior snapshot', () => {
      const now = Date.now();
      expect(shouldCapturePressureSnapshot(85.3, true, 0, now)).toBe(true);
    });

    it('should respect the cooldown between pressure snapshots', () => {
      const now = Date.now();
      const cooldown = 30 * 60 * 1000;
      // 10 minutes after the last pressure snapshot: still cooling down
      expect(shouldCapturePressureSnapshot(85.7, true, now - 10 * 60 * 1000, now, cooldown)).toBe(false);
      // Exactly at the cooldown: fires again (sustained pressure re-triggers)
      expect(shouldCapturePressureSnapshot(85.7, true, now - cooldown, now, cooldown)).toBe(true);
      // Pressure ended between snapshots: cooldown still applies from the last write
      expect(shouldCapturePressureSnapshot(81, true, now - cooldown - 1, now, cooldown)).toBe(true);
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

    it('should extract trigger metadata for every documented trigger, and undefined when absent', () => {
      const triggers: SnapshotTrigger[] = ['manual', 'memory-pressure', 'periodic', 'oom-risk', 'test'];
      triggers.forEach((trigger, i) => {
        writeFakeSnapshot(`heap-${6_000_000 + i}-${trigger}.heapsnapshot`, 512, 60_000);
      });
      // A file that does not follow the naming convention carries no trigger.
      writeFakeSnapshot('legacy-orphan.heapsnapshot', 512, 60_000);

      const snapshots = getHeapSnapshots();
      expect(snapshots.length).toBe(triggers.length + 1);

      for (const trigger of triggers) {
        const snapshot = snapshots.find(s => s.filename.endsWith(`-${trigger}.heapsnapshot`));
        expect(snapshot?.trigger).toBe(trigger);
      }
      const orphan = snapshots.find(s => s.filename === 'legacy-orphan.heapsnapshot');
      expect(orphan?.trigger).toBeUndefined();
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
