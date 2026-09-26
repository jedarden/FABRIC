/**
 * Tests for the system cgroup memory monitor's OOM-risk classification.
 *
 * systemCgroupMonitor.ts is the only source of the `oomRisk` level that
 * GET /api/alerts/oom reports (server.ts) and that gives the `oom-risk`
 * heap-snapshot trigger its meaning (docs/heap-snapshot-retention.md,
 * Trigger Reasons: "oom-risk — Out-of-memory risk detected"). The module
 * previously had no test coverage at all; these pin the classification
 * ladder, the pressure flag, and the OOM-kill state machinery.
 *
 * The module reads hardcoded cgroup v2 paths under
 * /sys/fs/cgroup/user.slice/user-1001.slice, so fs reads are mocked with a
 * controlled file map here — no test allocates memory, and every case (the
 * exact 80/90/95/98 boundaries included) is deterministic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'path';

// Mirrors the module-private CGROUP_PATH in systemCgroupMonitor.ts, keyed
// with the same join() the module performs. A deliberate change to the
// cgroup path in source fails these tests loudly (the mocked reads stop
// matching) rather than silently passing against real /sys state.
const CGROUP_PATH = '/sys/fs/cgroup/user.slice/user-1001.slice';

const { cgroupFiles } = vi.hoisted(() => ({
  cgroupFiles: {} as Record<string, string>,
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const has = (path: string | Buffer | URL): boolean =>
    Object.prototype.hasOwnProperty.call(cgroupFiles, path.toString());
  return {
    ...actual,
    existsSync: (path: string | Buffer | URL): boolean => has(path),
    readFileSync: (path: string | Buffer | URL): string => {
      const key = path.toString();
      if (has(key)) return cgroupFiles[key];
      // Unmapped paths (e.g. /proc/meminfo, /proc/self/status when the test
      // does not serve them) behave as absent files, which the module
      // handles through its own try/catch fallbacks.
      throw new Error(`ENOENT: no such file or directory, open '${key}'`);
    },
  };
});

type Monitor = typeof import('./systemCgroupMonitor.js');

/**
 * Load the module fresh for each test: lastOomKillCount, lastOomAt and
 * memoryHistory are module-level state, so a fresh instance keeps the
 * classification cases order-independent.
 */
async function loadMonitor(): Promise<Monitor> {
  vi.resetModules();
  return import('./systemCgroupMonitor.js');
}

interface CgroupOptions {
  /** memory.current content; null omits the file (unreadable cgroup) */
  current?: string | null;
  /** memory.max content; defaults to a 1,000,000-byte limit */
  max?: string;
  /** memory.events content; defaults to "oom_kill 0" */
  events?: string;
}

/** Serve a controlled cgroup view. memory.high/swap/stat are neutral. */
function setCgroup(options: CgroupOptions = {}): void {
  for (const key of Object.keys(cgroupFiles)) delete cgroupFiles[key];
  if (options.current !== null) {
    cgroupFiles[join(CGROUP_PATH, 'memory.current')] = options.current ?? '0';
  }
  cgroupFiles[join(CGROUP_PATH, 'memory.max')] = options.max ?? '1000000';
  cgroupFiles[join(CGROUP_PATH, 'memory.high')] = 'max';
  cgroupFiles[join(CGROUP_PATH, 'memory.swap.current')] = '0';
  cgroupFiles[join(CGROUP_PATH, 'memory.events')] = options.events ?? 'oom_kill 0';
  cgroupFiles[join(CGROUP_PATH, 'memory.stat')] = 'anon 0\nfile 0\n';
}

describe('systemCgroupMonitor OOM-risk classification', () => {
  beforeEach(() => {
    setCgroup();
  });

  // The documented ladder (systemCgroupMonitor.ts, "Determine OOM risk
  // level"): critical >= 98%, high >= 95%, medium >= 90%, low >= 80%,
  // none otherwise. memory.max defaults to 1,000,000 bytes in setCgroup,
  // so memory.current / 10,000 is the exact percentage each case drives.

  it('reports no risk below the 80% low-risk boundary', async () => {
    const m = await loadMonitor();

    setCgroup({ current: '799999' }); // 79.9999%
    expect(m.getSystemMemoryStatus().oomRisk).toBe('none');
    expect(m.getSystemMemoryStatus().underPressure).toBe(false);

    setCgroup({ current: '250000' }); // 25%
    const status = m.getSystemMemoryStatus();
    expect(status.oomRisk).toBe('none');
    expect(status.cgroupUsagePercent).toBeCloseTo(25, 10);
  });

  it('classifies exactly 80% as low risk — the boundary is inclusive', async () => {
    const m = await loadMonitor();

    setCgroup({ current: '800000' });
    const status = m.getSystemMemoryStatus();
    expect(status.oomRisk).toBe('low');
    // The percentage itself must land on the boundary value: a regression
    // that shifted the arithmetic (e.g. reordering the *100) would move
    // this across the >= 80 comparison and flip the verdict.
    expect(status.cgroupUsagePercent).toBeCloseTo(80, 10);
    expect(status.underPressure).toBe(false);

    setCgroup({ current: '899999' }); // just below medium
    expect(m.getSystemMemoryStatus().oomRisk).toBe('low');
  });

  it('classifies exactly 90% as medium risk, still below the pressure flag', async () => {
    const m = await loadMonitor();

    setCgroup({ current: '900000' });
    const status = m.getSystemMemoryStatus();
    expect(status.oomRisk).toBe('medium');
    // underPressure is a STRICT > 90 comparison, distinct from the
    // inclusive >= 90 risk boundary: at exactly 90% the risk is medium
    // while the pressure flag has not tripped yet.
    expect(status.underPressure).toBe(false);

    setCgroup({ current: '900001' });
    const pressured = m.getSystemMemoryStatus();
    expect(pressured.oomRisk).toBe('medium');
    expect(pressured.underPressure).toBe(true);

    setCgroup({ current: '949999' }); // just below high
    expect(m.getSystemMemoryStatus().oomRisk).toBe('medium');
  });

  it('classifies exactly 95% as high risk', async () => {
    const m = await loadMonitor();

    setCgroup({ current: '950000' });
    expect(m.getSystemMemoryStatus().oomRisk).toBe('high');

    setCgroup({ current: '979999' }); // just below critical
    expect(m.getSystemMemoryStatus().oomRisk).toBe('high');
  });

  it('classifies exactly 98% and beyond-limit usage as critical risk', async () => {
    const m = await loadMonitor();

    setCgroup({ current: '980000' });
    expect(m.getSystemMemoryStatus().oomRisk).toBe('critical');

    // Usage past the limit (e.g. swap accounting lag) is still critical,
    // not clamped away.
    setCgroup({ current: '1200000' });
    expect(m.getSystemMemoryStatus().oomRisk).toBe('critical');
  });

  it('reports no risk and no pressure when the cgroup limit is unlimited', async () => {
    const m = await loadMonitor();

    // memory.max = "max" means no limit: usage cannot form a percentage,
    // so the risk must be none rather than NaN-driven garbage — even with
    // an arbitrarily large usage reading.
    setCgroup({ current: '999999999', max: 'max' });
    const status = m.getSystemMemoryStatus();
    expect(status.cgroupLimit).toBeNull();
    expect(status.cgroupUsagePercent).toBeNull();
    expect(status.oomRisk).toBe('none');
    expect(status.underPressure).toBe(false);
    expect(status.cgroupUsage).toBe(999999999);
  });

  it('reports no risk when cgroup usage is unreadable', async () => {
    const m = await loadMonitor();

    setCgroup({ current: null });
    const status = m.getSystemMemoryStatus();
    expect(status.cgroupUsage).toBeNull();
    expect(status.cgroupUsagePercent).toBeNull();
    expect(status.oomRisk).toBe('none');
    expect(status.underPressure).toBe(false);
  });

  it('surfaces the parsed oom_kill count from memory.events', async () => {
    const m = await loadMonitor();

    setCgroup({ events: 'pgfault 1234\noom_kill 7\n' });
    const status = m.getSystemMemoryStatus();
    expect(status.oomKill).toBe(7);
    expect(status.oom).toBe(7); // compatibility alias
    expect(status.oomState.oomKillCount).toBe(7);
  });

  it('flags oomDetected only when a nonzero oom_kill count increases', async () => {
    const m = await loadMonitor();

    // First sight of a nonzero count is the baseline: a fresh process must
    // not report a "new" OOM for kills that predate it.
    setCgroup({ current: '500000', events: 'oom_kill 2' });
    const baseline = m.getSystemMemoryStatus();
    expect(baseline.oomState.oomDetected).toBe(false);

    // An increase over the observed baseline is the detection edge.
    setCgroup({ current: '600000', events: 'oom_kill 5' });
    const detected = m.getSystemMemoryStatus();
    expect(detected.oomState.oomDetected).toBe(true);
    expect(detected.oomState.oomKillCount).toBe(5);
    expect(detected.oomState.lastOomAt).toBeTruthy();
    // memory.current at the moment of detection is preserved for the alert.
    expect(detected.oomState.memoryCurrentAtOom).toBe(600000);

    // The same count again is not a new detection.
    const stable = m.getSystemMemoryStatus();
    expect(stable.oomState.oomDetected).toBe(false);
  });

  it('getOomState shares the detection edge with the status poller', async () => {
    const m = await loadMonitor();

    setCgroup({ current: '100000', events: 'oom_kill 3' });
    const first = m.getOomState();
    expect(first.oomDetected).toBe(false);

    setCgroup({ current: '200000', events: 'oom_kill 4' });
    const second = m.getOomState();
    expect(second.oomDetected).toBe(true);
    expect(second.oomKillCount).toBe(4);
    expect(second.memoryCurrentAtOom).toBe(200000);
    expect(second.lastOomAt).toBeTruthy();
  });

  it('keeps the sampler single-instance and caps history at 30 samples', async () => {
    vi.useFakeTimers();
    try {
      const m = await loadMonitor();
      setCgroup({ current: '100000' });

      // A redundant start must not stack a second interval — two samplers
      // would double every sample, the same duplicate-work shape the
      // periodic snapshot scheduler guards against.
      m.startMemorySampler(10_000);
      m.startMemorySampler(10_000);

      // Initial sample at start + 3 ticks: 4 samples, not 8.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(m.getMemoryHistory()).toHaveLength(4);

      // A redundant stop and a real one both leave no timer behind.
      m.stopMemorySampler();
      m.stopMemorySampler();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(m.getMemoryHistory()).toHaveLength(4);

      // History is bounded for the sparkline: only the newest 30 survive.
      for (let i = 0; i < 35; i++) {
        m.getSystemMemoryStatus();
      }
      const history = m.getMemoryHistory();
      expect(history).toHaveLength(30);
      // Samples are timestamped and carry their usage percentages.
      expect(history[29].usage).toBe(100000);
      expect(history[29].usagePercent).toBeCloseTo(10, 10);
    } finally {
      vi.useRealTimers();
    }
  });
});
