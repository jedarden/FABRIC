/**
 * FABRIC Memory Profiler Tests
 *
 * Tests heap snapshot capture mechanism with trigger reasons,
 * retention policy, and file reading capabilities.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi, type MockInstance } from 'vitest';
import { getMemoryProfiler, shouldCapturePressureSnapshot, isSnapshotTrigger, SNAPSHOT_TRIGGERS, MEMORY_PRESSURE_THRESHOLD_PERCENT, PRESSURE_SNAPSHOT_COOLDOWN_MS, MAX_DISK_SNAPSHOTS, MAX_SNAPSHOT_AGE_DAYS, DEFAULT_MAX_TOTAL_SNAPSHOT_BYTES, MAX_IN_MEMORY_SNAPSHOTS, type SnapshotTrigger, type MemorySnapshot } from './memoryProfiler.js';
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
    it('should pin the documented retention limits: 50 files, 30 days, 10 GiB, 100 in memory', () => {
      // docs/heap-snapshot-retention.md, Retention Limits table. The
      // behavioral tests below would catch most drift of these constants,
      // but not every direction (e.g. the invalid-override fallback test
      // stays green if the default cap drifts upward to any value above the
      // seed data). Pinning the numbers literally makes any change to a
      // documented limit a deliberate, reviewable act — same pattern as the
      // 80%-threshold/30-minute-cooldown pin in the pressure tests.
      expect(MAX_DISK_SNAPSHOTS).toBe(50);
      expect(MAX_SNAPSHOT_AGE_DAYS).toBe(30);
      expect(DEFAULT_MAX_TOTAL_SNAPSHOT_BYTES).toBe(10 * 1024 ** 3);
      expect(MAX_IN_MEMORY_SNAPSHOTS).toBe(100);
    });

    it('should track snapshot count', () => {
      const initialCount = profiler.getSnapshotCount();
      expect(initialCount).toBe(0);
    });

    it('should apply retention policy after writing snapshot', { timeout: 60_000 }, async () => {
      // docs/heap-snapshot-retention.md, Automatic Cleanup step 4:
      // applyRetentionPolicy() runs after writeHeapSnapshot(). Seed the
      // directory exactly at the documented 50-file cap, then a single write
      // must trigger the count-based pass inside that write: the directory is
      // back to 50 files and the oldest seed is the one that went.
      const fakes: string[] = [];
      for (let i = 0; i < MAX_DISK_SNAPSHOTS; i++) {
        fakes.push(writeFakeSnapshot(`heap-${7_000_000 + i}-test.heapsnapshot`, 1024, (50 - i) * 60_000));
      }
      expect(profiler.getSnapshotCount()).toBe(MAX_DISK_SNAPSHOTS);

      const realFilepath = await profiler.writeHeapSnapshot('test');

      expect(profiler.getSnapshotCount()).toBe(MAX_DISK_SNAPSHOTS);
      expect(existsSync(realFilepath)).toBe(true);
      expect(existsSync(fakes[0])).toBe(false); // oldest seed pruned by the write
      for (let i = 1; i < fakes.length; i++) {
        expect(existsSync(fakes[i])).toBe(true);
      }
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

    it('should never prune the just-written snapshot even when it alone exceeds the size cap', { timeout: 60_000 }, async () => {
      // docs/heap-snapshot-retention.md, Retention Limits row 3 / Automatic
      // Cleanup step 3: "the just-written snapshot is never pruned by this
      // pass". The two-write test above cannot pin this in isolation: if the
      // size pass could prune files[0], its first write would delete itself,
      // the second write would then be the only survivor, and every assertion
      // there would still pass. Here the just-written file is the only file
      // and exceeds a 1-byte cap on its own — a pass bound that included the
      // just-written snapshot would delete the only record of the incident.
      const previousCap = process.env.FABRIC_SNAPSHOT_MAX_TOTAL_BYTES;
      process.env.FABRIC_SNAPSHOT_MAX_TOTAL_BYTES = '1';
      try {
        const filepath = await profiler.writeHeapSnapshot('test');

        expect(existsSync(filepath)).toBe(true);
        expect(profiler.getSnapshotCount()).toBe(1);
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
      // all under the default size cap and well within the age limit. The
      // embedded filename timestamps run OPPOSITE to the mtimes (the oldest
      // mtime carries the newest-looking name): the pruned set is then only
      // explainable by mtime ordering — a cleanup that ranked by filename
      // instead would prune the wrong six fakes and fail below.
      const fakes: string[] = [];
      for (let i = 0; i < 55; i++) {
        fakes.push(writeFakeSnapshot(`heap-${1_050_000 - i}-test.heapsnapshot`, 1024, (60 - i) * 60_000));
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

    it('should count and prune only .heapsnapshot files, leaving other directory entries alone', { timeout: 60_000 }, async () => {
      // The live snapshot directory co-hosts non-snapshot data (heapDiff.ts
      // writes trend reports into a reports/ subdirectory there). Both the
      // count-based and age-based passes must consider only *.heapsnapshot
      // entries: co-located data neither counts toward the 50-file cap nor
      // is ever a deletion candidate.
      const fakes: string[] = [];
      for (let i = 0; i < MAX_DISK_SNAPSHOTS; i++) {
        fakes.push(writeFakeSnapshot(`heap-${8_000_000 + i}-test.heapsnapshot`, 1024, (50 - i) * 60_000));
      }
      const strayFile = join(SNAPSHOT_DIR, 'trend-report-latest.md');
      const strayDir = join(SNAPSHOT_DIR, 'reports');
      try {
        writeFileSync(strayFile, '# trend report');
        mkdirSync(strayDir, { recursive: true });

        const realFilepath = await profiler.writeHeapSnapshot('test');

        // Seeded at exactly the cap with two extra directory entries: had
        // they counted, the write would have pruned three snapshots (and
        // tried to unlink the directory) instead of just the oldest one.
        expect(profiler.getSnapshotCount()).toBe(MAX_DISK_SNAPSHOTS);
        expect(existsSync(realFilepath)).toBe(true);
        expect(existsSync(fakes[0])).toBe(false); // oldest seed pruned by the write
        for (let i = 1; i < fakes.length; i++) {
          expect(existsSync(fakes[i])).toBe(true);
        }
        expect(existsSync(strayFile)).toBe(true);
        expect(existsSync(strayDir)).toBe(true);
      } finally {
        rmSync(strayFile, { force: true });
        rmSync(strayDir, { recursive: true, force: true });
      }
    });

    it('should delete snapshots older than 30 days while keeping newer ones', { timeout: 60_000 }, async () => {
      const dayMs = 24 * 60 * 60 * 1000;
      // Just past the documented 30-day boundary (a minute of margin, so the
      // verdict cannot flip on test-run latency): pruned.
      const aged = [0, 1, 2].map(i =>
        writeFakeSnapshot(`heap-${2_000_000 + i}-test.heapsnapshot`, 1024, 30 * dayMs + 60_000));
      // Just inside it: retained.
      const fresh = [0, 1].map(i =>
        writeFakeSnapshot(`heap-${3_000_000 + i}-test.heapsnapshot`, 1024, 30 * dayMs - 60_000));

      await profiler.writeHeapSnapshot('test');

      for (const filepath of aged) {
        expect(existsSync(filepath)).toBe(false);
      }
      for (const filepath of fresh) {
        expect(existsSync(filepath)).toBe(true);
      }
    });

    it('should apply the count and age passes together in one retention run', { timeout: 60_000 }, async () => {
      // 55 ancient seeds trip both limits at once once the write lands: the
      // count pass removes everything beyond the 50-file cap, then the age
      // pass removes the rest — re-attempting entries the count pass already
      // unlinked, so this also pins that a per-file unlink failure (that
      // ENOENT) is swallowed instead of rejecting the write.
      const dayMs = 24 * 60 * 60 * 1000;
      const ancient = [0, 1, 2, 3, 4].map(i =>
        writeFakeSnapshot(`heap-${9_000_000 + i}-test.heapsnapshot`, 1024, 40 * dayMs));
      const filler: string[] = [];
      for (let i = 0; i < 50; i++) {
        filler.push(writeFakeSnapshot(`heap-${9_050_000 + i}-test.heapsnapshot`, 1024, 40 * dayMs));
      }
      const fresh = [0, 1].map(i =>
        writeFakeSnapshot(`heap-${9_100_000 + i}-test.heapsnapshot`, 1024, dayMs));

      const realFilepath = await profiler.writeHeapSnapshot('test');

      // Only the write and the fresh seeds survive; every ancient seed is
      // gone regardless of which pass took it.
      expect(existsSync(realFilepath)).toBe(true);
      for (const filepath of fresh) {
        expect(existsSync(filepath)).toBe(true);
      }
      for (const filepath of [...ancient, ...filler]) {
        expect(existsSync(filepath)).toBe(false);
      }
      expect(profiler.getSnapshotCount()).toBe(fresh.length + 1);
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

    it('should enforce the default 10 GiB cap with no override, pruning only until under it', { timeout: 60_000 }, async () => {
      // docs/heap-snapshot-retention.md row 3 names the default cap itself
      // (10 GiB) as policy, not just the override. Every test above drives
      // the size pass through an explicit FABRIC_SNAPSHOT_MAX_TOTAL_BYTES;
      // this one leaves it unset so the DEFAULT_MAX_TOTAL_SNAPSHOT_BYTES
      // value pinned in the constants test is what actually governs. The
      // placeholders are sparse (truncate() writes no data blocks), so the
      // 6 GiB logical sizes cost no real disk.
      const previousCap = process.env.FABRIC_SNAPSHOT_MAX_TOTAL_BYTES;
      delete process.env.FABRIC_SNAPSHOT_MAX_TOTAL_BYTES;
      try {
        const fakeSize = 6 * 1024 ** 3; // two of these = 12 GiB > 10 GiB default
        expect(2 * fakeSize).toBeGreaterThan(DEFAULT_MAX_TOTAL_SNAPSHOT_BYTES);
        const oldest = writeFakeSnapshot(`heap-${10_000_000}-test.heapsnapshot`, fakeSize, 10 * 60_000);
        const middle = writeFakeSnapshot(`heap-${10_000_001}-test.heapsnapshot`, fakeSize, 5 * 60_000);

        const realFilepath = await profiler.writeHeapSnapshot('test');

        // Oldest-first: the 10-minute-old 6 GiB file goes, which drops the
        // directory to ~6 GiB + the real snapshot — under the cap — so the
        // prune stops there and the 5-minute-old 6 GiB file survives with
        // the just-written snapshot.
        expect(existsSync(oldest)).toBe(false);
        expect(existsSync(middle)).toBe(true);
        expect(existsSync(realFilepath)).toBe(true);
        expect(profiler.getSnapshotCount()).toBe(2);
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

    it('should treat an invalid FABRIC_SNAPSHOT_MAX_TOTAL_BYTES as the 10 GiB default, not as a disabled cap', { timeout: 60_000 }, async () => {
      // The fallback test above seeds only ~4MB, so it proves the override
      // stops applying on invalid input but cannot distinguish "fall back to
      // the documented default" from "fall back to no cap at all": a
      // regression that returned Infinity (or NaN) for unparseable input
      // would keep every assertion there green. Seeding past the default cap
      // pins the fallback's VALUE, for both fallback branches (unparseable
      // and non-positive): pruning still happens, with the same verdict as
      // the unset-override test — oldest 6 GiB file gone, the pass stops
      // once under 10 GiB, and the just-written snapshot survives.
      const previousCap = process.env.FABRIC_SNAPSHOT_MAX_TOTAL_BYTES;
      try {
        const fakeSize = 6 * 1024 ** 3; // two of these = 12 GiB > 10 GiB default
        expect(2 * fakeSize).toBeGreaterThan(DEFAULT_MAX_TOTAL_SNAPSHOT_BYTES);
        const cases = [
          { invalid: 'not-a-number', base: 11_000_000 }, // Number.isFinite branch
          { invalid: '-5', base: 11_001_000 },           // parsed > 0 branch
        ];
        let priorWrites = 0;
        for (const { invalid, base } of cases) {
          const oldest = writeFakeSnapshot(`heap-${base}-test.heapsnapshot`, fakeSize, 10 * 60_000);
          const middle = writeFakeSnapshot(`heap-${base + 1}-test.heapsnapshot`, fakeSize, 5 * 60_000);
          process.env.FABRIC_SNAPSHOT_MAX_TOTAL_BYTES = invalid;

          const realFilepath = await profiler.writeHeapSnapshot('test');

          expect(existsSync(oldest)).toBe(false);
          expect(existsSync(middle)).toBe(true);
          expect(existsSync(realFilepath)).toBe(true);
          priorWrites += 1;
          // The surviving middle seed plus every prior iteration's
          // just-written snapshot; prior writes are newer than both seeds,
          // so they are never prune candidates.
          expect(profiler.getSnapshotCount()).toBe(1 + priorWrites);
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

    it('should pin the documented 80% threshold and 30-minute default cooldown', () => {
      // docs/heap-snapshot-retention.md: "When heap usage exceeds 80% of limit
      // (checked every 30s; at most one capture per 30-minute cooldown while
      // pressure persists)". The server's memory monitor calls this policy
      // without a cooldown argument, so the default constant itself must
      // carry the documented value — the boundary tests above pass it
      // explicitly and would not notice a drifted default.
      expect(MEMORY_PRESSURE_THRESHOLD_PERCENT).toBe(80);
      expect(PRESSURE_SNAPSHOT_COOLDOWN_MS).toBe(30 * 60 * 1000);

      // With the cooldown argument omitted, that default applies: one
      // millisecond short of 30 minutes still blocks; exactly 30 fires.
      const now = Date.now();
      expect(shouldCapturePressureSnapshot(85, true, now - (PRESSURE_SNAPSHOT_COOLDOWN_MS - 1), now)).toBe(false);
      expect(shouldCapturePressureSnapshot(85, true, now - PRESSURE_SNAPSHOT_COOLDOWN_MS, now)).toBe(true);
    });
  });

  describe('Trigger Validation', () => {
    it('should pin the documented trigger set', () => {
      // docs/heap-snapshot-retention.md, Trigger Reasons table: exactly these
      // five reasons. The set guards the HTTP boundary (server.ts rejects any
      // other value with 400) and the type; adding or removing an entry is a
      // documented-surface change and must be deliberate.
      expect([...SNAPSHOT_TRIGGERS]).toEqual(['manual', 'memory-pressure', 'periodic', 'oom-risk', 'test']);
    });

    it('should accept every documented trigger', () => {
      for (const trigger of SNAPSHOT_TRIGGERS) {
        expect(isSnapshotTrigger(trigger)).toBe(true);
      }
    });

    it('should reject values that must never reach a snapshot filename', () => {
      // The trigger is interpolated into `heap-{ts}-{trigger}.heapsnapshot`,
      // so arbitrary values are rejected rather than passed through raw — the
      // unit-level counterpart of the 400 responses pinned in
      // server.heap.test.ts. Covers path syntax in both separator styles,
      // dot segments, empty/whitespace strings, case variants (matching is
      // exact, not normalized), underscore near-misses of a documented
      // trigger, and non-string inputs.
      const rejects: unknown[] = [
        '../../evil', 'a/b', 'a\\b', '..', '.', '', '  ',
        'MANUAL', 'Manual', 'memory_pressure', 'manual ',
        123, null, undefined, true, {}, ['manual'],
      ];
      for (const value of rejects) {
        expect(isSnapshotTrigger(value), `expected ${JSON.stringify(value)} to be rejected`).toBe(false);
      }
    });

    it('should keep every documented trigger filename-safe and round-trippable', () => {
      // If a trigger ever joins the documented set carrying path syntax,
      // isSnapshotTrigger alone would stop protecting the on-disk name, so
      // the invariant is pinned on the set itself: each entry is plain
      // lowercase kebab-case (no separators, no dot segments) and survives
      // the filename round-trip getHeapSnapshots() performs when it parses
      // the trigger back out of `heap-{ts}-{trigger}.heapsnapshot`.
      for (const trigger of SNAPSHOT_TRIGGERS) {
        expect(trigger).toMatch(/^[a-z][a-z0-9-]*$/);

        const filename = `heap-1700000000000-${trigger}.heapsnapshot`;
        const parsed = filename.match(/heap-\d+-(.+)\.heapsnapshot$/);
        expect(parsed?.[1]).toBe(trigger);
      }
    });
  });

  describe('Periodic Capture Scheduler', () => {
    // startPeriodicCapture() is the only scheduler behind the `periodic`
    // trigger (docs/heap-snapshot-retention.md: "Scheduled automatic capture,
    // every 30 minutes, configurable via --snapshot-interval"). The CLI
    // contract tests pin the flag plumbing; these pin the scheduler's own
    // behavior with fake timers so no test pays the real 30-minute cadence
    // or a real heap-sized write.
    const saved = { writeSnapshots: false, autoSnapshot: false, intervalMs: 30 * 60 * 1000 };

    beforeEach(() => {
      saved.writeSnapshots = profiler.writeSnapshots;
      saved.autoSnapshot = profiler.autoSnapshot;
      saved.intervalMs = profiler.snapshotIntervalMs;
      profiler.writeSnapshots = false;
      profiler.autoSnapshot = false;
      profiler.snapshotIntervalMs = 1_000; // 1s ticks for test speed
      vi.useFakeTimers();
    });

    afterEach(() => {
      profiler.stopPeriodicCapture();
      vi.useRealTimers();
      profiler.writeSnapshots = saved.writeSnapshots;
      profiler.autoSnapshot = saved.autoSnapshot;
      profiler.snapshotIntervalMs = saved.intervalMs;
    });

    function captureSpyStarting(): MockInstance {
      // Counted via a spy rather than getRecent().length: the in-memory
      // array is usually already saturated at MAX_IN_MEMORY_SNAPSHOTS by
      // the time these tests run (earlier captures in this file), so the
      // length no longer moves when a new capture evicts the oldest entry.
      return vi.spyOn(profiler, 'capture');
    }

    it('captures in memory on the configured interval, not more often', async () => {
      const captureSpy = captureSpyStarting();
      profiler.startPeriodicCapture();

      // One millisecond before the first tick: nothing yet — the interval
      // respects the configured snapshotIntervalMs rather than capturing
      // immediately.
      await vi.advanceTimersByTimeAsync(999);
      expect(captureSpy).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(captureSpy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(captureSpy).toHaveBeenCalledTimes(2);
      captureSpy.mockRestore();
    });

    it('ignores a redundant start so ticks stay single', async () => {
      // A second startPeriodicCapture() while running must not stack a second
      // interval: two stacked intervals would double-capture on every tick.
      const captureSpy = captureSpyStarting();
      profiler.startPeriodicCapture();
      profiler.startPeriodicCapture();

      await vi.advanceTimersByTimeAsync(2_000);
      expect(captureSpy).toHaveBeenCalledTimes(2); // two ticks × one capture, not four
      captureSpy.mockRestore();
    });

    it('delegates each tick to writeHeapSnapshot only when fully enabled', async () => {
      const writeSpy = vi.spyOn(profiler, 'writeHeapSnapshot')
        .mockResolvedValue(join(SNAPSHOT_DIR, 'spied-periodic.heapsnapshot'));
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        // Both flags required (cli.ts sets writeSnapshots on --heap-snapshots
        // and autoSnapshot only in production): with both set, every tick
        // writes, and it names the 'periodic' trigger explicitly — a no-arg
        // call would resolve writeHeapSnapshot's 'manual' default and make
        // every scheduled capture indistinguishable on disk from a
        // user-initiated one.
        profiler.writeSnapshots = true;
        profiler.autoSnapshot = true;
        profiler.startPeriodicCapture();

        await vi.advanceTimersByTimeAsync(1_000);
        await vi.advanceTimersByTimeAsync(1_000);

        expect(writeSpy).toHaveBeenCalledTimes(2);
        expect(writeSpy).toHaveBeenCalledWith('periodic');
      } finally {
        writeSpy.mockRestore();
        errSpy.mockRestore();
      }
    });

    it('names scheduled captures with the periodic trigger on disk', { timeout: 60_000 }, async () => {
      // Unmocked write: the scheduler's no-arg call resolves writeHeapSnapshot's
      // default trigger, and that default is what names the file — the only
      // place 'periodic' becomes observable (docs/heap-snapshot-retention.md,
      // Trigger Reasons: "periodic — Scheduled automatic capture").
      profiler.writeSnapshots = true;
      profiler.autoSnapshot = true;
      profiler.startPeriodicCapture();

      // The write serializes the full heap asynchronously after the tick;
      // keep advancing the fake clock while polling for the file. The first
      // tick lands at 1s; each advanceTimersByTimeAsync flushes the pending
      // microtasks, which drives the write's dynamic v8 import and its
      // (blocking, seconds-long) serialization to completion. The scheduler
      // is stopped the moment the file appears so the poll cannot write a
      // cascade of further real snapshots.
      let filepath: string | undefined;
      for (let i = 0; i < 200 && filepath === undefined; i++) {
        await vi.advanceTimersByTimeAsync(100);
        filepath = readdirSync(SNAPSHOT_DIR).find(f => /^heap-\d+-periodic\.heapsnapshot$/.test(f));
      }
      profiler.stopPeriodicCapture();

      expect(filepath).toBeDefined();
    });

    it('never writes snapshots unless both enablement flags are set', async () => {
      const writeSpy = vi.spyOn(profiler, 'writeHeapSnapshot')
        .mockResolvedValue(join(SNAPSHOT_DIR, 'spied-periodic.heapsnapshot'));

      try {
        profiler.startPeriodicCapture();

        // Default: both flags off — memory sampling continues, no disk writes.
        await vi.advanceTimersByTimeAsync(2_000);
        expect(writeSpy).not.toHaveBeenCalled();

        // writeSnapshots alone is not enough; the autoSnapshot gate must hold
        // independently or an explicit --heap-snapshots outside production
        // would silently start writing on the timer.
        profiler.writeSnapshots = true;
        await vi.advanceTimersByTimeAsync(1_000);
        expect(writeSpy).not.toHaveBeenCalled();
      } finally {
        writeSpy.mockRestore();
      }
    });

    it('stops the cadence on stopPeriodicCapture and tolerates a redundant stop', async () => {
      const captureSpy = captureSpyStarting();
      profiler.startPeriodicCapture();

      await vi.advanceTimersByTimeAsync(1_000);
      expect(captureSpy).toHaveBeenCalledTimes(1);

      // Both the real stop and a redundant one must be silent no-ops that
      // leave no timer behind: nothing further captures after either.
      profiler.stopPeriodicCapture();
      profiler.stopPeriodicCapture();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(captureSpy).toHaveBeenCalledTimes(1);
      captureSpy.mockRestore();
    });
  });

  describe('Periodic Capture Configuration', () => {
    it('pins the documented 30-minute default snapshot interval', () => {
      // docs/heap-snapshot-retention.md, Trigger Reasons: "periodic —
      // Scheduled automatic capture, every 30 minutes, configurable via
      // --snapshot-interval". The scheduler tests below run with
      // snapshotIntervalMs overridden for speed, and the CLI contract tests
      // pin the flag's own default — neither would notice the profiler-side
      // default drifting, and it is that default a deployment without an
      // explicit --snapshot-interval actually runs on.
      expect(profiler.snapshotIntervalMs).toBe(30 * 60 * 1000);
    });
  });

  describe('Automatic captures invoke retention', () => {
    // docs/heap-snapshot-retention.md, Automatic Cleanup step 4: retention
    // runs after writeHeapSnapshot() — for every trigger, not only the
    // explicit ones. The Retention Policy describe drives 'test' writes
    // directly; this drives the periodic path end-to-end (real scheduler
    // tick → real heap write named 'periodic' → retention inside that same
    // write) so an automatic capture can never silently lose the cleanup
    // step. The memory-pressure and oom-risk automatic paths are pinned at
    // their own seams in web/server.heap.test.ts.
    const saved = { writeSnapshots: false, autoSnapshot: false, intervalMs: 0 };

    beforeEach(() => {
      saved.writeSnapshots = profiler.writeSnapshots;
      saved.autoSnapshot = profiler.autoSnapshot;
      saved.intervalMs = profiler.snapshotIntervalMs;
    });

    afterEach(() => {
      profiler.stopPeriodicCapture();
      profiler.writeSnapshots = saved.writeSnapshots;
      profiler.autoSnapshot = saved.autoSnapshot;
      profiler.snapshotIntervalMs = saved.intervalMs;
    });

    it('the scheduled periodic write prunes past the 50-file cap', { timeout: 60_000 }, async () => {
      // Seed exactly at the documented cap (ages 1..50 minutes, oldest
      // first, same sparse-placeholder pattern as the retention tests).
      const fakes: string[] = [];
      for (let i = 0; i < MAX_DISK_SNAPSHOTS; i++) {
        fakes.push(writeFakeSnapshot(`heap-${12_000_000 + i}-test.heapsnapshot`, 1024, (50 - i) * 60_000));
      }
      expect(profiler.getSnapshotCount()).toBe(MAX_DISK_SNAPSHOTS);

      profiler.writeSnapshots = true;
      profiler.autoSnapshot = true;
      profiler.snapshotIntervalMs = 1_000;
      vi.useFakeTimers();
      let filepath: string | undefined;
      try {
        profiler.startPeriodicCapture();

        // The write serializes the full heap asynchronously after the tick;
        // keep advancing the fake clock while polling for the file (same
        // pattern as 'names scheduled captures with the periodic trigger on
        // disk' above). The scheduler is stopped the moment the file
        // appears so the poll cannot cascade further real writes.
        for (let i = 0; i < 200 && filepath === undefined; i++) {
          await vi.advanceTimersByTimeAsync(100);
          filepath = readdirSync(SNAPSHOT_DIR).find(f => /^heap-\d+-periodic\.heapsnapshot$/.test(f));
        }
      } finally {
        profiler.stopPeriodicCapture();
        vi.useRealTimers();
      }

      expect(filepath).toBeDefined();

      // The tick landed the directory at 51 files; retention ran inside
      // that same write and pruned the oldest seed, leaving the cap intact
      // with the automatic capture present. The poll matches a bare
      // filename inside SNAPSHOT_DIR; resolve it before the existence check.
      expect(profiler.getSnapshotCount()).toBe(MAX_DISK_SNAPSHOTS);
      expect(existsSync(join(SNAPSHOT_DIR, filepath!))).toBe(true);
      expect(existsSync(fakes[0])).toBe(false); // oldest seed pruned by the automatic write
      for (let i = 1; i < fakes.length; i++) {
        expect(existsSync(fakes[i])).toBe(true);
      }
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
