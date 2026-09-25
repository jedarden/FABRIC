/**
 * FABRIC Memory Profiler
 *
 * Real-time memory profiling and leak detection utilities.
 * Tracks memory usage over time, captures snapshots, and provides diff analysis.
 */

import { writeFileSync, mkdirSync, existsSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Snapshot directory for heap snapshots. Overridable so tests can isolate
 * from the live service: the running web process captures real snapshots
 * here, and suite-induced memory pressure makes it write mid-test.
 */
const SNAPSHOT_DIR =
  process.env.FABRIC_SNAPSHOT_DIR ?? join(homedir(), '.needle', 'snapshots');

/** Maximum number of in-memory snapshots to keep (docs/heap-snapshot-retention.md) */
export const MAX_IN_MEMORY_SNAPSHOTS = 100;

/** Snapshot interval in milliseconds */
const SNAPSHOT_INTERVAL_MS = 30 * 1000; // 30 seconds

/** Maximum number of heap snapshots to retain on disk (docs/heap-snapshot-retention.md) */
export const MAX_DISK_SNAPSHOTS = 50;

/** Maximum age of heap snapshots in days (docs/heap-snapshot-retention.md) */
export const MAX_SNAPSHOT_AGE_DAYS = 30;

/**
 * Default cap on total on-disk heap snapshot bytes (10 GiB). Each
 * .heapsnapshot file is roughly the size of the heap it captures, so at the
 * 85%-of-1GB pressure seen in production a full 50-file retention window
 * would hold ~45GB — enough to fill this box's disk on its own.
 */
export const DEFAULT_MAX_TOTAL_SNAPSHOT_BYTES = 10 * 1024 * 1024 * 1024;

/** Heap usage percent above which the memory monitor captures a pressure snapshot */
export const MEMORY_PRESSURE_THRESHOLD_PERCENT = 80;

/** Minimum time between memory-pressure snapshots (matches the periodic default) */
export const PRESSURE_SNAPSHOT_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * Resolve the total-size cap for on-disk snapshots from the environment.
 * Read at call time (not module load) so operators and tests can change it.
 */
function getMaxTotalSnapshotBytes(): number {
  const raw = process.env.FABRIC_SNAPSHOT_MAX_TOTAL_BYTES;
  if (!raw) return DEFAULT_MAX_TOTAL_SNAPSHOT_BYTES;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_TOTAL_SNAPSHOT_BYTES;
}

/**
 * Decide whether the memory monitor should capture a 'memory-pressure'
 * heap snapshot. Pure so the pressure policy is unit-testable without
 * inducing real heap pressure in a test process.
 *
 * @param heapUsagePercent current heap usage as % of heap_size_limit
 * @param snapshotsEnabled whether snapshot writing is enabled (CLI --heap-snapshots / NODE_ENV=production)
 * @param lastPressureSnapshotMs epoch ms of the last pressure snapshot (0 = never)
 * @param nowMs current epoch ms
 * @param cooldownMs minimum spacing between pressure snapshots
 */
export function shouldCapturePressureSnapshot(
  heapUsagePercent: number,
  snapshotsEnabled: boolean,
  lastPressureSnapshotMs: number,
  nowMs: number,
  cooldownMs: number = PRESSURE_SNAPSHOT_COOLDOWN_MS
): boolean {
  if (!snapshotsEnabled) return false;
  if (heapUsagePercent <= MEMORY_PRESSURE_THRESHOLD_PERCENT) return false;
  return nowMs - lastPressureSnapshotMs >= cooldownMs;
}

/** Format bytes as a human-readable string. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

/** Trigger reasons for heap snapshots */
export type SnapshotTrigger = 'manual' | 'memory-pressure' | 'periodic' | 'oom-risk' | 'test';

/** All documented trigger reasons (docs/heap-snapshot-retention.md). */
export const SNAPSHOT_TRIGGERS: readonly SnapshotTrigger[] = [
  'manual',
  'memory-pressure',
  'periodic',
  'oom-risk',
  'test',
];

/**
 * Runtime guard for trigger values that arrive as untyped input (HTTP body).
 * The trigger becomes part of the on-disk filename, so anything outside the
 * documented set must be rejected rather than interpolated into a path.
 */
export function isSnapshotTrigger(value: unknown): value is SnapshotTrigger {
  return typeof value === 'string' && (SNAPSHOT_TRIGGERS as readonly string[]).includes(value);
}

export interface MemorySnapshot {
  timestamp: number;
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
}

export interface MemoryStats {
  current: MemorySnapshot;
  trend: 'stable' | 'rising' | 'falling' | 'unknown';
  avgRss: number;
  maxRss: number;
  minRss: number;
}

export interface MemoryDiff {
  baseline: MemorySnapshot;
  current: MemorySnapshot;
  durationMs: number;
  rssDelta: number;
  heapUsedDelta: number;
  heapTotalDelta: number;
  externalDelta: number;
  arrayBuffersDelta: number;
  percentChange: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
  };
}

class MemoryProfiler {
  private snapshots: MemorySnapshot[] = [];
  private baseline: MemorySnapshot | null = null;
  private lastCapture: number = 0;
  private periodicInterval: NodeJS.Timeout | null = null;

  /** CLI properties for heap snapshot configuration */
  writeSnapshots: boolean = false;
  autoSnapshot: boolean = false;
  snapshotIntervalMs: number = 30 * 60 * 1000; // Default 30 minutes

  constructor() {
    // Ensure snapshot directory exists
    if (!existsSync(SNAPSHOT_DIR)) {
      mkdirSync(SNAPSHOT_DIR, { recursive: true });
    }
  }

  /** Capture current memory usage */
  capture(): MemorySnapshot {
    const usage = process.memoryUsage();
    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      rss: usage.rss,
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      arrayBuffers: usage.arrayBuffers,
    };

    this.snapshots.push(snapshot);
    this.lastCapture = snapshot.timestamp;

    // Prune old snapshots if we exceed the limit
    if (this.snapshots.length > MAX_IN_MEMORY_SNAPSHOTS) {
      this.snapshots = this.snapshots.slice(-MAX_IN_MEMORY_SNAPSHOTS);
    }

    return snapshot;
  }

  /** Get current memory statistics with trend analysis */
  getStats(): MemoryStats {
    // Ensure we have at least one snapshot
    if (this.snapshots.length === 0) {
      this.capture();
    }

    const current = this.snapshots[this.snapshots.length - 1];
    const rssValues = this.snapshots.map(s => s.rss);

    const avgRss = rssValues.reduce((a, b) => a + b, 0) / rssValues.length;
    const maxRss = Math.max(...rssValues);
    const minRss = Math.min(...rssValues);

    // Determine trend based on recent samples
    let trend: 'stable' | 'rising' | 'falling' | 'unknown' = 'unknown';
    if (this.snapshots.length >= 3) {
      const recent = this.snapshots.slice(-10);
      const firstHalf = recent.slice(0, Math.floor(recent.length / 2));
      const secondHalf = recent.slice(Math.floor(recent.length / 2));

      const firstAvg = firstHalf.reduce((sum, s) => sum + s.heapUsed, 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((sum, s) => sum + s.heapUsed, 0) / secondHalf.length;

      const changePercent = ((secondAvg - firstAvg) / firstAvg) * 100;

      if (changePercent > 5) {
        trend = 'rising';
      } else if (changePercent < -5) {
        trend = 'falling';
      } else {
        trend = 'stable';
      }
    }

    return {
      current,
      trend,
      avgRss,
      maxRss,
      minRss,
    };
  }

  /** Set current memory state as baseline for future comparisons */
  setBaseline(): MemorySnapshot {
    this.baseline = this.capture();
    return this.baseline;
  }

  /** Get diff from baseline, or null if no baseline set */
  diffFromBaseline(): MemoryDiff | null {
    if (!this.baseline || this.snapshots.length === 0) {
      return null;
    }

    const current = this.snapshots[this.snapshots.length - 1];
    const durationMs = current.timestamp - this.baseline.timestamp;

    const rssDelta = current.rss - this.baseline.rss;
    const heapUsedDelta = current.heapUsed - this.baseline.heapUsed;
    const heapTotalDelta = current.heapTotal - this.baseline.heapTotal;
    const externalDelta = current.external - this.baseline.external;
    const arrayBuffersDelta = current.arrayBuffers - this.baseline.arrayBuffers;

    const percentChange = {
      rss: this.baseline.rss > 0 ? (rssDelta / this.baseline.rss) * 100 : 0,
      heapUsed: this.baseline.heapUsed > 0 ? (heapUsedDelta / this.baseline.heapUsed) * 100 : 0,
      heapTotal: this.baseline.heapTotal > 0 ? (heapTotalDelta / this.baseline.heapTotal) * 100 : 0,
    };

    return {
      baseline: this.baseline,
      current,
      durationMs,
      rssDelta,
      heapUsedDelta,
      heapTotalDelta,
      externalDelta,
      arrayBuffersDelta,
      percentChange,
    };
  }

  /** Get recent snapshots */
  getRecent(count: number): MemorySnapshot[] {
    return this.snapshots.slice(-count);
  }

  /** Format memory values as human-readable string */
  formatMemory(snapshot: MemorySnapshot): string {
    const format = (bytes: number): string => {
      if (bytes < 1024) return `${bytes}B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
      return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
    };

    return `RSS=${format(snapshot.rss)}, Heap=${format(snapshot.heapUsed)}/${format(snapshot.heapTotal)}, External=${format(snapshot.external)}`;
  }

  /** Write a V8 heap snapshot to disk with trigger reason */
  async writeHeapSnapshot(trigger: SnapshotTrigger = 'manual'): Promise<string> {
    const timestamp = Date.now();
    const filename = `heap-${timestamp}-${trigger}.heapsnapshot`;
    const filepath = join(SNAPSHOT_DIR, filename);

    // Ensure snapshot directory exists
    if (!existsSync(SNAPSHOT_DIR)) {
      mkdirSync(SNAPSHOT_DIR, { recursive: true });
    }

    // Use dynamic import for v8 module (Node.js built-in)
    const v8 = await import('v8');
    // @ts-ignore - v8.writeHeapSnapshot exists in Node.js but not in TypeScript types
    v8.writeHeapSnapshot(filepath);

    // Apply retention policy after writing
    this.applyRetentionPolicy();

    return filepath;
  }

  /** Apply retention policy to old snapshots */
  private applyRetentionPolicy(): void {
    if (!existsSync(SNAPSHOT_DIR)) return;

    const files = readdirSync(SNAPSHOT_DIR)
      .filter(f => f.endsWith('.heapsnapshot'))
      .map(f => {
        const filepath = join(SNAPSHOT_DIR, f);
        const stat = statSync(filepath);
        return { filename: f, filepath, mtime: stat.mtime.getTime(), sizeBytes: stat.size };
      })
      .sort((a, b) => b.mtime - a.mtime); // Sort by modification time, newest first

    const now = Date.now();
    const maxAgeMs = MAX_SNAPSHOT_AGE_DAYS * 24 * 60 * 60 * 1000;

    // Remove old snapshots beyond retention limits
    for (let i = MAX_DISK_SNAPSHOTS; i < files.length; i++) {
      try {
        unlinkSync(files[i].filepath);
      } catch (err) {
        console.error(`Failed to delete old snapshot ${files[i].filename}:`, err);
      }
    }

    // Remove snapshots beyond age limit
    for (const file of files) {
      if (now - file.mtime > maxAgeMs) {
        try {
          unlinkSync(file.filepath);
        } catch (err) {
          console.error(`Failed to delete aged snapshot ${file.filename}:`, err);
        }
      }
    }

    // Enforce a total-size cap, pruning oldest first. files[0] (the snapshot
    // just written) is never pruned by this pass so a single huge snapshot
    // cannot delete itself and leave the incident unrecorded.
    const maxTotalBytes = getMaxTotalSnapshotBytes();
    let totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);
    for (let i = files.length - 1; i > 0 && totalBytes > maxTotalBytes; i--) {
      try {
        unlinkSync(files[i].filepath);
        totalBytes -= files[i].sizeBytes;
        console.error(`Snapshot retention: deleted ${files[i].filename} (total ${formatBytes(totalBytes)} > cap)`);
      } catch (err) {
        console.error(`Failed to delete oversized snapshot ${files[i].filename}:`, err);
      }
    }
  }

  /** Get count of snapshots on disk */
  getSnapshotCount(): number {
    if (!existsSync(SNAPSHOT_DIR)) return 0;
    return readdirSync(SNAPSHOT_DIR).filter(f => f.endsWith('.heapsnapshot')).length;
  }

  /** Start periodic memory capture and snapshot writing */
  startPeriodicCapture(): void {
    if (this.periodicInterval) {
      return; // Already running
    }

    this.periodicInterval = setInterval(() => {
      this.capture();

      if (this.writeSnapshots && this.autoSnapshot) {
        // Name the trigger explicitly: the function default is 'manual', and
        // an unnamed call made every scheduled capture indistinguishable on
        // disk from a user-initiated one (docs/heap-snapshot-retention.md,
        // Trigger Reasons: periodic = scheduled automatic capture).
        this.writeHeapSnapshot('periodic')
          .then(filepath => console.error(`Heap snapshot written: ${filepath}`))
          .catch(err => console.error(`Failed to write heap snapshot: ${err}`));
      }
    }, this.snapshotIntervalMs);

    // Unref the interval so it doesn't keep the process alive
    if (this.periodicInterval.unref) {
      this.periodicInterval.unref();
    }
  }

  /** Stop periodic memory capture */
  stopPeriodicCapture(): void {
    if (this.periodicInterval) {
      clearInterval(this.periodicInterval);
      this.periodicInterval = null;
    }
  }
}

/** Singleton instance */
let profilerInstance: MemoryProfiler | null = null;

/** Get or create the memory profiler singleton */
export function getMemoryProfiler(): MemoryProfiler {
  if (!profilerInstance) {
    profilerInstance = new MemoryProfiler();
  }
  return profilerInstance;
}
