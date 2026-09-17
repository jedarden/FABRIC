/**
 * Unit tests for the heap snapshot analysis layer (src/heapDiff.ts).
 *
 * memoryProfiler.test.ts covers the retention passes and real snapshot
 * writes; server.heap.test.ts covers the HTTP endpoints end to end. This
 * file pins the analysis behavior documented in docs/heap-snapshot-retention.md
 * between them — diff math and assessment boundaries, trend aggregation,
 * the recent-diff window, listing metadata, and report saving —
 * deterministically: on-disk fixtures are sparse placeholders with controlled
 * mtimes, and compareSnapshots is exercised with synthetic summaries, so no
 * V8 heap serialization runs here.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import {
  getHeapSnapshots,
  compareSnapshots,
  getRecentHeapDiff,
  analyzeTrend,
  saveTrendReport,
  formatHeapDiffAsMarkdown,
  formatTrendAsMarkdown,
  type HeapSnapshotSummary,
} from './heapDiff.js';
import {
  writeFileSync, truncateSync, utimesSync, mkdirSync, rmSync,
  readdirSync, existsSync, readFileSync,
} from 'fs';
import { join } from 'path';

// Isolate from the live service's snapshot directory BEFORE heapDiff resolves
// it — same pattern as memoryProfiler.test.ts and server.heap.test.ts. The
// running fabric-web process writes real snapshots into ~/.needle/snapshots,
// which would break exact-count and ordering assertions here.
const { SNAPSHOT_DIR } = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/fabric-heapdiff-test-${process.pid}-${Date.now()}`;
  process.env.FABRIC_SNAPSHOT_DIR = dir;
  return { SNAPSHOT_DIR: dir };
});

const MB = 1024 * 1024;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Placeholder .heapsnapshot with controlled size and mtime. The analysis
 * layer only stats these files (timestamp comes from mtime, not the filename),
 * so utimesSync gives exact control over ordering and every duration below.
 * mtimeMs is returned so tests can assert timestamp equality exactly.
 */
function writeFakeSnapshot(filename: string, sizeBytes: number, mtimeMs: number): number {
  const filepath = join(SNAPSHOT_DIR, filename);
  writeFileSync(filepath, '');
  truncateSync(filepath, sizeBytes); // sparse: stat.size reports sizeBytes
  const t = new Date(mtimeMs);
  utimesSync(filepath, t, t);
  return mtimeMs;
}

/** Synthetic snapshot summary for the pure comparison functions. */
function summary(timestamp: number, sizeMb: number): HeapSnapshotSummary {
  const filename = `heap-${timestamp}-test.heapsnapshot`;
  return {
    filename,
    filepath: join(SNAPSHOT_DIR, filename),
    timestamp,
    sizeBytes: sizeMb * MB,
    sizeMb,
    trigger: 'test',
  };
}

describe('heapDiff analysis layer', () => {
  beforeEach(() => {
    // Reset disk state: fixtures from prior tests and any saved reports.
    // Recreate the directory first — the missing-directory test below
    // removes SNAPSHOT_DIR itself, and beforeAll would not run again.
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
    for (const entry of readdirSync(SNAPSHOT_DIR)) {
      rmSync(join(SNAPSHOT_DIR, entry), { recursive: true, force: true });
    }
  });

  afterAll(() => {
    rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  });

  describe('getHeapSnapshots (listing)', () => {
    it('should return an empty list when the snapshot directory does not exist', () => {
      rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
      expect(getHeapSnapshots()).toEqual([]);
    });

    it('should list snapshots oldest-first with full metadata from mtime and size', () => {
      const t0 = Date.now() - 3 * HOUR_MS;
      const older = writeFakeSnapshot('heap-1100000-periodic.heapsnapshot', 5 * MB, t0);
      const newer = writeFakeSnapshot('heap-1100001-manual.heapsnapshot', 2 * MB, t0 + HOUR_MS);
      // Non-snapshot files (like saved reports) are never listed.
      writeFileSync(join(SNAPSHOT_DIR, 'trend-report-123.md'), 'not a snapshot');

      const snapshots = getHeapSnapshots();

      expect(snapshots).toHaveLength(2);
      expect(snapshots[0].filename).toBe('heap-1100000-periodic.heapsnapshot');
      expect(snapshots[1].filename).toBe('heap-1100001-manual.heapsnapshot');
      expect(snapshots[0].timestamp).toBe(older);
      expect(snapshots[1].timestamp).toBe(newer);
      expect(snapshots[0].filepath).toBe(join(SNAPSHOT_DIR, 'heap-1100000-periodic.heapsnapshot'));
      expect(snapshots[0].sizeBytes).toBe(5 * MB);
      expect(snapshots[0].sizeMb).toBe(5);
      expect(snapshots[0].trigger).toBe('periodic');
      expect(snapshots[1].trigger).toBe('manual');
    });
  });

  describe('compareSnapshots (diff)', () => {
    it('should compute duration, growth, percent change, and hourly rate', () => {
      const baseline = summary(1_700_000_000_000, 60);
      const current = summary(1_700_000_000_000 + 30 * 60_000, 90); // 30 min later

      const diff = compareSnapshots(baseline, current);

      expect(diff.baseline).toBe(baseline);
      expect(diff.current).toBe(current);
      expect(diff.durationMs).toBe(30 * 60_000);
      expect(diff.durationMinutes).toBe(30);
      expect(diff.sizeGrowthBytes).toBe(30 * MB);
      expect(diff.sizeGrowthMb).toBe(30);
      expect(diff.percentChange).toBeCloseTo(50); // +30MB on 60MB
      expect(diff.growthRateMbPerHour).toBeCloseTo(60); // 30MB in 0.5h
    });

    it('should not divide by zero when the baseline snapshot is empty', () => {
      const baseline = summary(1_700_000_000_000, 0);
      const current = summary(1_700_000_000_000 + HOUR_MS, 4);

      const diff = compareSnapshots(baseline, current);

      expect(diff.percentChange).toBe(0);
      expect(diff.growthRateMbPerHour).toBeCloseTo(4);
      // A percent change of exactly 0 is inside the stable band.
      expect(diff.assessment).toBe('stable');
    });

    it('should assess "unknown" with a caveat when the snapshots are less than 10 minutes apart', () => {
      const baseline = summary(1_700_000_000_000, 100);
      const current = summary(1_700_000_000_000 + 9 * 60_000, 200);

      const diff = compareSnapshots(baseline, current);

      expect(diff.assessment).toBe('unknown');
      expect(diff.recommendations).toContain('Insufficient time between snapshots for reliable assessment');
    });

    it('should leave the unknown band at exactly 10 minutes of separation', () => {
      const baseline = summary(1_700_000_000_000, 100);
      const current = summary(1_700_000_000_000 + 10 * 60_000, 102); // +2%: stable band

      expect(compareSnapshots(baseline, current).assessment).toBe('stable');
    });

    it('should assess "stable" when the size changed by less than 5 percent', () => {
      const baseline = summary(1_700_000_000_000, 100);
      const current = summary(1_700_000_000_000 + HOUR_MS, 102);

      const diff = compareSnapshots(baseline, current);

      expect(diff.assessment).toBe('stable');
      expect(diff.recommendations).toContain('Memory usage appears stable');
    });

    it('should assess "leaking" when growth is fast, even at a small percent change', () => {
      // +10% in half an hour is a 20 MB/hour rate: over the 10 MB/hour line.
      const baseline = summary(1_700_000_000_000, 100);
      const current = summary(1_700_000_000_000 + 30 * 60_000, 110);

      const diff = compareSnapshots(baseline, current);

      expect(diff.assessment).toBe('leaking');
      expect(diff.recommendations[0]).toBe('Potential leak: growing at 20.0 MB/hour');
      expect(diff.recommendations).toContain('Review heap snapshot in Chrome DevTools for growing retainers');
      expect(diff.recommendations).toContain('Check for unbounded collections in EventStore');
      expect(diff.recommendations).toContain('Verify WebSocket client cleanup');
    });

    it('should assess "growing" for large percent change at a slow rate', () => {
      // +50% over 10 hours is only 5 MB/hour: flagged as growth, not a leak.
      const baseline = summary(1_700_000_000_000, 100);
      const current = summary(1_700_000_000_000 + 10 * HOUR_MS, 150);

      const diff = compareSnapshots(baseline, current);

      expect(diff.assessment).toBe('growing');
      expect(diff.recommendations).toContain('Memory growing: 50.0% increase');
      expect(diff.recommendations).toContain('Monitor for continued growth');
    });

    it('should assess "stable" for moderate growth within acceptable bounds', () => {
      // +10% over 10 hours: outside the 5% band but under both alarms.
      const baseline = summary(1_700_000_000_000, 100);
      const current = summary(1_700_000_000_000 + 10 * HOUR_MS, 110);

      const diff = compareSnapshots(baseline, current);

      expect(diff.assessment).toBe('stable');
      expect(diff.recommendations).toContain('Memory growth within acceptable bounds');
    });

    it('should never flag shrinking memory as growing or leaking', () => {
      const baseline = summary(1_700_000_000_000, 100);
      const current = summary(1_700_000_000_000 + HOUR_MS, 50);

      const diff = compareSnapshots(baseline, current);

      expect(diff.sizeGrowthBytes).toBe(-50 * MB);
      expect(diff.percentChange).toBeCloseTo(-50);
      // A negative percent change passes neither alarm branch, so it falls
      // through to the acceptable-bounds verdict.
      expect(diff.assessment).toBe('stable');
      expect(diff.recommendations).toContain('Memory growth within acceptable bounds');
    });
  });

  describe('getRecentHeapDiff (diff window)', () => {
    it('should return null with fewer than two snapshots', () => {
      expect(getRecentHeapDiff()).toBeNull();

      writeFakeSnapshot('heap-1200000-test.heapsnapshot', MB, Date.now() - HOUR_MS);
      expect(getRecentHeapDiff()).toBeNull();
    });

    it('should diff the oldest of the last 10 snapshots against the newest', () => {
      // 12 snapshots: the 10-snapshot window starts at the 3rd oldest.
      const now = Date.now();
      for (let i = 0; i < 12; i++) {
        writeFakeSnapshot(`heap-120000${i}-test.heapsnapshot`, (i + 1) * MB, now - (12 - i) * HOUR_MS);
      }

      const diff = getRecentHeapDiff();

      expect(diff).not.toBeNull();
      expect(diff!.baseline.filename).toBe('heap-1200002-test.heapsnapshot');
      expect(diff!.current.filename).toBe('heap-12000011-test.heapsnapshot');
      // Sizes 3MB -> 12MB across 9 hours: +9MB at 1MB/hour.
      expect(diff!.sizeGrowthBytes).toBe(9 * MB);
      expect(diff!.growthRateMbPerHour).toBeCloseTo(1);
    });
  });

  describe('analyzeTrend (trend)', () => {
    it('should report insufficient-data with fewer than two snapshots', () => {
      writeFakeSnapshot('heap-1300000-test.heapsnapshot', MB, Date.now() - HOUR_MS);

      const trend = analyzeTrend();

      expect(trend.overallAssessment).toBe('insufficient-data');
      expect(trend.snapshots).toHaveLength(1);
      expect(trend.diffs).toEqual([]);
      expect(trend.avgGrowthRateMbPerHour).toBe(0);
      expect(trend.projectedGrowth24hMb).toBe(0);
    });

    it('should average consecutive diff rates and project 24h growth', () => {
      const now = Date.now();
      // Two consecutive growing pairs: 100->121MB (+21%, 2.1 MB/h) and
      // 121->146MB (+20.7%, 2.5 MB/h), each step 10 hours.
      writeFakeSnapshot('heap-1300001-test.heapsnapshot', 100 * MB, now - 20 * HOUR_MS);
      writeFakeSnapshot('heap-1300002-test.heapsnapshot', 121 * MB, now - 10 * HOUR_MS);
      writeFakeSnapshot('heap-1300003-test.heapsnapshot', 146 * MB, now);

      const trend = analyzeTrend();

      expect(trend.diffs).toHaveLength(2);
      expect(trend.overallAssessment).toBe('growing'); // 2/2 diffs growing >= 70%
      expect(trend.avgGrowthRateMbPerHour).toBeCloseTo(2.3);
      expect(trend.projectedGrowth24hMb).toBeCloseTo(2.3 * 24);
    });

    it('should assess "leaking" when at least half of the diffs leak', () => {
      const now = Date.now();
      // One diff, leaking: 100MB -> 200MB in one hour (100 MB/hour).
      writeFakeSnapshot('heap-1300004-test.heapsnapshot', 100 * MB, now - HOUR_MS);
      writeFakeSnapshot('heap-1300005-test.heapsnapshot', 200 * MB, now);

      const trend = analyzeTrend();

      expect(trend.overallAssessment).toBe('leaking');
      expect(trend.avgGrowthRateMbPerHour).toBeCloseTo(100);
      expect(trend.projectedGrowth24hMb).toBeCloseTo(2400);
    });

    it('should assess "leaking" when exactly half of the diffs leak', () => {
      const now = Date.now();
      // diff1 stable (100->102MB in 1h), diff2 leaking (102->202MB in 1h):
      // 1 of 2 leaks sits exactly on the >= half line, so the verdict flips.
      writeFakeSnapshot('heap-1300006-test.heapsnapshot', 100 * MB, now - 2 * HOUR_MS);
      writeFakeSnapshot('heap-1300007-test.heapsnapshot', 102 * MB, now - HOUR_MS);
      writeFakeSnapshot('heap-1300008-test.heapsnapshot', 202 * MB, now);

      const trend = analyzeTrend();

      expect(trend.diffs.map(d => d.assessment)).toEqual(['stable', 'leaking']);
      expect(trend.overallAssessment).toBe('leaking');
    });

    it('should stay "stable" when a single leaking diff is a minority', () => {
      const now = Date.now();
      // Three diffs: two stable (100->102->104MB, 1h each) and one leaking
      // (104->204MB in 1h). 1 of 3 is under both the 50% leaking line and
      // the 70% growing-or-leaking line, so the verdict holds at stable.
      writeFakeSnapshot('heap-1300009-test.heapsnapshot', 100 * MB, now - 3 * HOUR_MS);
      writeFakeSnapshot('heap-1300010-test.heapsnapshot', 102 * MB, now - 2 * HOUR_MS);
      writeFakeSnapshot('heap-1300011-test.heapsnapshot', 104 * MB, now - HOUR_MS);
      writeFakeSnapshot('heap-1300012-test.heapsnapshot', 204 * MB, now);

      const trend = analyzeTrend();

      expect(trend.diffs.map(d => d.assessment)).toEqual(['stable', 'stable', 'leaking']);
      expect(trend.overallAssessment).toBe('stable');
    });

    it('should assess "stable" when every diff is inside the stable band', () => {
      const now = Date.now();
      writeFakeSnapshot('heap-1300009-test.heapsnapshot', 100 * MB, now - 2 * HOUR_MS);
      writeFakeSnapshot('heap-1300010-test.heapsnapshot', 102 * MB, now - HOUR_MS);
      writeFakeSnapshot('heap-1300011-test.heapsnapshot', 104 * MB, now);

      const trend = analyzeTrend();

      expect(trend.overallAssessment).toBe('stable');
      expect(trend.avgGrowthRateMbPerHour).toBeCloseTo(2);
      expect(trend.projectedGrowth24hMb).toBeCloseTo(48);
    });
  });

  describe('saveTrendReport (report saving)', () => {
    it('should save nothing and return null with insufficient data', () => {
      writeFakeSnapshot('heap-1400000-test.heapsnapshot', MB, Date.now() - HOUR_MS);

      expect(saveTrendReport()).toBeNull();
      // The failed save must not leave a reports directory behind.
      expect(existsSync(join(SNAPSHOT_DIR, 'reports'))).toBe(false);
    });

    it('should write a markdown report into snapshots/reports and return its path', () => {
      const now = Date.now();
      writeFakeSnapshot('heap-1400001-test.heapsnapshot', 100 * MB, now - HOUR_MS);
      writeFakeSnapshot('heap-1400002-test.heapsnapshot', 200 * MB, now);

      const filepath = saveTrendReport();

      expect(filepath).not.toBeNull();
      expect(filepath!.startsWith(join(SNAPSHOT_DIR, 'reports', 'trend-report-'))).toBe(true);
      expect(filepath).toMatch(/trend-report-\d+\.md$/);

      const report = readFileSync(filepath!, 'utf-8');
      expect(report).toContain('# Heap Trend Analysis');
      expect(report).toContain('**Snapshots Analyzed:** 2');
      expect(report).toContain('**Overall Assessment:** **LEAKING**');
      expect(report).toContain('| Projected 24h Growth | 2400.0 MB |');
    });
  });

  describe('markdown formatters', () => {
    it('should render a heap diff with filenames, growth, assessment, and recommendations', () => {
      const baseline = summary(1_700_000_000_000, 100);
      const current = summary(1_700_000_000_000 + HOUR_MS, 200);
      const markdown = formatHeapDiffAsMarkdown(compareSnapshots(baseline, current));

      expect(markdown).toContain('# Heap Diff Analysis');
      expect(markdown).toContain(`**Baseline:** ${baseline.filename}`);
      expect(markdown).toContain(`**Current:** ${current.filename}`);
      expect(markdown).toContain('**Duration:** 60.0 minutes');
      expect(markdown).toContain('| Size Growth | 100.00 MB (+100.0%) |');
      expect(markdown).toContain('| Growth Rate | 100.00 MB/hour |');
      expect(markdown).toContain('| Assessment | **LEAKING** |');
      expect(markdown).toContain('- Potential leak: growing at 100.0 MB/hour');
    });

    it('should render a trend with per-snapshot comparisons', () => {
      const now = Date.now();
      writeFakeSnapshot('heap-1400003-test.heapsnapshot', 100 * MB, now - HOUR_MS);
      writeFakeSnapshot('heap-1400004-test.heapsnapshot', 200 * MB, now);

      const markdown = formatTrendAsMarkdown(analyzeTrend());

      expect(markdown).toContain('# Heap Trend Analysis');
      expect(markdown).toContain('**Snapshots Analyzed:** 2');
      expect(markdown).toContain('**Overall Assessment:** **LEAKING**');
      expect(markdown).toContain('| Average Growth Rate | 100.00 MB/hour |');
      expect(markdown).toContain('### heap-1400003-test.heapsnapshot → heap-1400004-test.heapsnapshot');
      expect(markdown).toContain('- Assessment: **leaking**');
    });
  });
});
