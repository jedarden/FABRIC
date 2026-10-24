/**
 * Tests for Fleet Analytics Aggregation
 *
 * `computeFleetAnalytics` reads NEEDLE log files from a directory derived at
 * module load (`join(homedir(), '.needle', 'logs')`), so each test points
 * `HOME` at a temp tree seeded with fixture logs and imports the module
 * fresh (`vi.resetModules` + dynamic import) to rebind that constant. The
 * fixtures are crafted so every metric path — model extraction, duration
 * buckets, strand success/fail classification, claim races, workspace
 * coverage, relaunch counting, hourly bucketing — carries at least one event.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FleetAnalytics } from './analytics.js';

const REAL_HOME = process.env.HOME;
let tempHome = '';

/** Build a temp HOME containing `.needle/logs/` and return its path. */
function makeTempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fabric-analytics-'));
  mkdirSync(join(dir, '.needle', 'logs'), { recursive: true });
  return dir;
}

/** Freshly import the module so NEEDLE_LOG_DIR picks up the current HOME. */
async function loadAnalytics(): Promise<typeof import('./analytics.js')> {
  vi.resetModules();
  return import('./analytics.js');
}

/** Worker IDs chosen to exercise each extractModel branch. */
const WORKER_GLM = 'claude-code-glm-5-alpha'; // regex path -> "glm-5"
const WORKER_OPUS = 'claude-anthropic-opus-4.7-bravo'; // regex path -> "opus-4.7"
const WORKER_CODEX = 'codex-worker-one'; // fallback: strip ends -> "worker"
const WORKER_SHORT = 'alpha'; // fallback: too few segments -> itself

/** Local-time timestamps on distinct hours so the time series buckets split. */
const HOUR_A = new Date(2026, 0, 15, 10, 5, 0).getTime();
const HOUR_B = new Date(2026, 0, 15, 11, 10, 0).getTime();
const HOUR_A_LATE = new Date(2026, 0, 15, 10, 45, 0).getTime();

/** A needle log line. */
function line(
  ts: number,
  event: string,
  worker: string,
  data: Record<string, unknown> = {},
  level = 'info',
): string {
  return JSON.stringify({ ts: new Date(ts).toISOString(), event, worker, level, session: 's-1', data });
}

/**
 * The canonical fixture: one file per worker family plus a decoy that must
 * be ignored, a broken symlink that must be filtered by existsSync, and
 * malformed lines that parseLine must reject.
 */
function writeCanonicalFixture(): void {
  const logs = join(tempHome, '.needle', 'logs');

  // glm-5 completions: one in every duration bucket; 3000ms is shallow.
  // One completion at HOUR_B, the rest at HOUR_A/HOUR_A_LATE.
  writeFileSync(
    join(logs, 'needle-glm.log'),
    [
      line(HOUR_A, 'worker.started', WORKER_GLM),
      line(HOUR_A, 'bead.completed', WORKER_GLM, { bead_id: 'bd-1', duration_ms: 3000, workspace: 'FABRIC' }),
      line(HOUR_A_LATE, 'bead.completed', WORKER_GLM, { bead_id: 'bd-2', duration_ms: 15000 }),
      line(HOUR_A_LATE, 'bead.completed', WORKER_GLM, { bead_id: 'bd-3', duration_ms: 60000 }),
      line(HOUR_B, 'bead.completed', WORKER_GLM, { bead_id: 'bd-4', duration_ms: 300000 }),
      line(HOUR_B, 'bead.completed', WORKER_GLM, { bead_id: 'bd-5', duration_ms: 700000 }),
      // Missing duration_ms -> 0 -> not shallow
      line(HOUR_B, 'bead.completed', WORKER_GLM, { bead_id: 'bd-6' }),
      // Strand events: explore success + plain invocation
      line(HOUR_A, 'explore.workspace_pluck', WORKER_GLM, { duration_ms: 100 }),
      line(HOUR_A, 'explore.file_scan', WORKER_GLM),
      // Malformed lines are skipped by parseLine
      'this is not json',
      JSON.stringify({ event: 'no.ts' }),
      JSON.stringify({ ts: new Date(HOUR_A).toISOString() }),
    ].join('\n') + '\n',
  );

  writeFileSync(
    join(logs, 'needle-opus.log'),
    [
      line(HOUR_A, 'worker.started', WORKER_OPUS),
      line(HOUR_A_LATE, 'worker.started', WORKER_OPUS),
      line(HOUR_B, 'worker.started', WORKER_OPUS),
      // opus-4.7 completions: both shallow, even count for the median
      line(HOUR_A, 'bead.completed', WORKER_OPUS, { bead_id: 'bd-7', duration_ms: 2000, workspace: 'FABRIC' }),
      line(HOUR_A, 'bead.completed', WORKER_OPUS, { bead_id: 'bd-8', duration_ms: 6000, workspace: 'NEEDLE' }),
      // Claim race: bd-race claimed by two different workers
      line(HOUR_A, 'bead.claimed', WORKER_OPUS, { bead_id: 'bd-race' }),
      line(HOUR_A, 'bead.claimed', WORKER_GLM, { bead_id: 'bd-race' }),
      // Single claim never races; missing bead_id is skipped
      line(HOUR_A, 'bead.claimed', WORKER_OPUS, { bead_id: 'bd-solo' }),
      line(HOUR_A, 'bead.claimed', WORKER_OPUS, {}),
      // Strand failures via suffix and via error level
      line(HOUR_A, 'hook.deploy_failed', WORKER_OPUS),
      line(HOUR_A, 'pulse.api_error', WORKER_OPUS),
      line(HOUR_A, 'pulse.failed_retry', WORKER_OPUS, {}, 'error'),
      // Strand successes via other suffixes
      line(HOUR_A, 'weave.task_completed', WORKER_OPUS, { duration_ms: 50 }),
      line(HOUR_A, 'unravel.report_created', WORKER_OPUS),
      line(HOUR_A, 'mend.mode_switch', WORKER_OPUS),
      // Durations that must be ignored (0 / missing / non-number)
      line(HOUR_A, 'weave.step_success', WORKER_OPUS, { duration_ms: 0 }),
      line(HOUR_A, 'weave.step_created', WORKER_OPUS),
      line(HOUR_A, 'weave.step_switch', WORKER_OPUS, { duration_ms: 'fast' }),
    ].join('\n') + '\n',
  );

  writeFileSync(
    join(logs, 'needle-codex.log'),
    [
      line(HOUR_A, 'worker.started', WORKER_CODEX),
      // Fallback model extraction: "codex-worker-one" -> "worker"
      line(HOUR_A, 'bead.completed', WORKER_CODEX, { bead_id: 'bd-9', duration_ms: 8000 }),
      // No-dot strand prefix is outside the strand filter
      line(HOUR_A, 'hook', WORKER_CODEX),
      // Very short worker id: extractModel returns it unchanged
      line(HOUR_A, 'explore.edge_scan', WORKER_SHORT),
    ].join('\n') + '\n',
  );

  // Decoy: matching files must be needle-*.log only
  writeFileSync(join(logs, 'other-worker.jsonl'), line(HOUR_A, 'bead.completed', WORKER_GLM, { bead_id: 'ignored', duration_ms: 1000 }) + '\n');

  // Broken symlink: listed by readdirSync but rejected by existsSync
  symlinkSync(join(logs, 'does-not-exist.log'), join(logs, 'needle-ghost.log'));
}

describe('computeFleetAnalytics', () => {
  beforeEach(() => {
    tempHome = makeTempHome();
  });

  afterEach(() => {
    process.env.HOME = REAL_HOME;
    rmSync(tempHome, { recursive: true, force: true });
    vi.resetModules();
  });

  test('returns the empty analytics object when the log directory is missing', async () => {
    rmSync(join(tempHome, '.needle'), { recursive: true, force: true });
    process.env.HOME = tempHome;

    const { computeFleetAnalytics } = await loadAnalytics();
    const result = computeFleetAnalytics();

    expect(result.totalEvents).toBe(0);
    expect(result.logFiles).toEqual([]);
    expect(result.modelMetrics).toEqual([]);
    expect(result.strandMetrics).toEqual([]);
    expect(result.shallowCompletions).toEqual([]);
    expect(result.totalCompletions).toBe(0);
    expect(result.shallowPercent).toBe(0);
    expect(result.claimRaces).toEqual([]);
    expect(result.fleetTimeSeries).toEqual([]);
    expect(result.workerRelaunchCount).toBe(0);
    expect(result.workspaceCoverage).toEqual([]);
    expect(result.beadsPerHour).toBe(0);
    expect(result.beadCompletions).toEqual([]);
    expect(result.periodStart).toBe(0);
    expect(result.periodEnd).toBe(0);
  });

  test('returns the empty analytics object when the log directory has no needle-*.log files', async () => {
    process.env.HOME = tempHome;

    const { computeFleetAnalytics } = await loadAnalytics();
    const result = computeFleetAnalytics();

    expect(result.totalEvents).toBe(0);
    expect(result.logFiles).toEqual([]);
  });

  test('aggregates the canonical fixture across every metric', async () => {
    writeCanonicalFixture();
    process.env.HOME = tempHome;

    const { computeFleetAnalytics } = await loadAnalytics();
    const result: FleetAnalytics = computeFleetAnalytics();

    // --- file selection: three needle logs, decoy and broken symlink excluded
    expect(result.logFiles.sort()).toEqual(['needle-codex.log', 'needle-glm.log', 'needle-opus.log']);

    // glm: 1 started + 6 completions + 2 strand events
    // opus: 3 started + 2 completions + 4 claims + 9 strand events
    // codex: 1 started + 1 completion + bare 'hook' + short-worker strand
    // malformed lines (3) and the decoy file contribute nothing
    expect(result.totalEvents).toBe(9 + 18 + 4);

    // --- period from first and last parsed event
    expect(result.periodStart).toBe(HOUR_A);
    expect(result.periodEnd).toBe(HOUR_B);

    // --- completions: glm 6, opus 2, codex 1
    expect(result.totalCompletions).toBe(9);
    expect(result.beadCompletions.map((c) => c.beadId).sort()).toEqual(
      ['bd-1', 'bd-2', 'bd-3', 'bd-4', 'bd-5', 'bd-6', 'bd-7', 'bd-8', 'bd-9'].sort(),
    );

    // Shallow (<10s, duration > 0): bd-1 (3s), bd-7 (2s), bd-8 (6s), bd-9 (8s)
    expect(result.shallowCompletions.map((c) => c.beadId).sort()).toEqual(['bd-1', 'bd-7', 'bd-8', 'bd-9']);
    expect(result.shallowPercent).toBe(44); // 4/9 rounded

    // bd-6 has no duration -> 0, not shallow, not bucketed as <5s? it *is* in <5s bucket by range
    const bd6 = result.beadCompletions.find((c) => c.beadId === 'bd-6');
    expect(bd6).toMatchObject({ durationMs: 0, isShallow: false, model: 'glm-5' });

    // --- model metrics: sorted by beadsCompleted desc
    expect(result.modelMetrics.map((m) => m.model)).toEqual(['glm-5', 'opus-4.7', 'worker']);

    const glm = result.modelMetrics[0];
    // durations 3000, 15000, 60000, 300000, 700000, 0 -> median of sorted [0,3k,15k,60k,300k,700k] = (15k+60k)/2
    expect(glm.beadsCompleted).toBe(6);
    expect(glm.minDurationMs).toBe(0);
    expect(glm.maxDurationMs).toBe(700000);
    expect(glm.medianDurationMs).toBe(37500);
    expect(glm.avgDurationMs).toBe(Math.round(1078000 / 6));
    // Model-metric shallowness is plain `d < 10000` — no `> 0` guard, so
    // bd-6's 0ms counts here even though BeadCompletion.isShallow excludes it.
    expect(glm.shallowCount).toBe(2); // 3000 and 0
    expect(glm.shallowPercent).toBe(33); // 2/6
    expect(glm.durationBuckets).toEqual([
      { label: '<5s', range: '<5s', count: 2 }, // 3000 and 0
      { label: '5-30s', range: '5-30s', count: 1 }, // 15000
      { label: '30s-2m', range: '30s-2m', count: 1 }, // 60000
      { label: '2-10m', range: '2-10m', count: 1 }, // 300000
      { label: '10m+', range: '10m+', count: 1 }, // 700000
    ]);

    const opus = result.modelMetrics[1];
    // [2000, 6000] -> even median
    expect(opus.medianDurationMs).toBe(4000);
    expect(opus.shallowCount).toBe(2);
    expect(opus.shallowPercent).toBe(100);
    expect(opus.durationBuckets[0]).toMatchObject({ label: '<5s', count: 1 }); // 2000 only; 6000 is 5-30s
    expect(opus.durationBuckets[1]).toMatchObject({ label: '5-30s', count: 1 });

    // Fallback extraction: "codex-worker-one" -> "worker"
    const codex = result.modelMetrics[2];
    expect(codex.model).toBe('worker');
    expect(codex.beadsCompleted).toBe(1);

    // --- strand metrics: all six strands present, sorted by invocations desc
    // (tie order among the 1-invocation strands follows sort stability)
    const byStrand = new Map(result.strandMetrics.map((s) => [s.strand, s]));
    expect(result.strandMetrics.map((s) => s.strand).sort()).toEqual(
      ['explore', 'pulse', 'weave', 'hook', 'mend', 'unravel'].sort(),
    );
    expect(result.strandMetrics.map((s) => s.invocations)).toEqual([4, 3, 2, 1, 1, 1]);

    const explore = byStrand.get('explore')!;
    expect(explore.invocations).toBe(3); // workspace_pluck, file_scan, edge_scan
    expect(explore.successCount).toBe(1); // _pluck suffix
    expect(explore.failCount).toBe(0);
    expect(explore.successRate).toBe(33); // 1/3
    expect(explore.totalDurationMs).toBe(100);
    expect(explore.avgDurationMs).toBe(100);

    const pulse = byStrand.get('pulse')!;
    expect(pulse.invocations).toBe(2); // api_error, failed_retry
    expect(pulse.failCount).toBe(2); // _error suffix + error-level includes('failed')
    expect(pulse.successRate).toBe(0);

    const weave = byStrand.get('weave')!;
    // task_completed (success, 50ms), step_success (success, 0ms skipped),
    // step_created (success, no duration), step_switch (success, non-number)
    expect(weave.invocations).toBe(4);
    expect(weave.successCount).toBe(4);
    expect(weave.totalDurationMs).toBe(50); // only the 50ms duration counted; 0/missing/string skipped
    expect(weave.avgDurationMs).toBe(50);

    expect(byStrand.get('hook')).toMatchObject({ invocations: 1, failCount: 1, successRate: 0 });
    expect(byStrand.get('mend')).toMatchObject({ invocations: 1, successCount: 1, successRate: 100 });
    expect(byStrand.get('unravel')).toMatchObject({ invocations: 1, successCount: 1, successRate: 100 });

    // --- claim races
    expect(result.claimRaces).toEqual([
      { beadId: 'bd-race', workers: expect.arrayContaining([WORKER_GLM, WORKER_OPUS]), claimCount: 2 },
    ]);

    // --- workspace coverage: sorted by bead count desc
    // FABRIC: workers {glm, opus}, beads {bd-1, bd-7}
    // NEEDLE: workers {opus}, beads {bd-8}
    expect(result.workspaceCoverage).toEqual([
      { workspace: 'FABRIC', workerCount: 2, beadCount: 2 },
      { workspace: 'NEEDLE', workerCount: 1, beadCount: 1 },
    ]);

    // --- relaunches: 5 worker.started events (glm x1, opus x3, codex x1)
    // across 4 unique workers (glm, opus, codex, short 'alpha') -> 5 - 4 = 1
    expect(result.workerRelaunchCount).toBe(1);

    // --- time series: two local hours, sorted by timestamp
    expect(result.fleetTimeSeries).toHaveLength(2);
    const [firstHour, secondHour] = result.fleetTimeSeries;
    expect(firstHour.timestamp).toBeLessThan(secondHour.timestamp);
    expect(firstHour.activeWorkers).toBe(4); // glm, opus, codex, short 'alpha'
    // HOUR_A hour spans HOUR_A and HOUR_A_LATE: bd-1..3, bd-7..9
    expect(firstHour.beadsCompleted).toBe(6);
    // HOUR_B: bd-4, bd-5, bd-6
    expect(secondHour.beadsCompleted).toBe(3);
    expect(firstHour.hour).toMatch(/^2026-01-15T/);

    // --- beads per hour: 9 completions over (HOUR_B - HOUR_A) hours, 1 decimal
    const hoursSpan = (HOUR_B - HOUR_A) / 3600000;
    expect(result.beadsPerHour).toBe(Math.round((9 / hoursSpan) * 10) / 10);
  });

  test('defaults missing level/session/worker/data fields on parseable lines', async () => {
    const logs = join(tempHome, '.needle', 'logs');
    writeFileSync(
      join(logs, 'needle-minimal.log'),
      JSON.stringify({ ts: new Date(HOUR_A).toISOString(), event: 'worker.started' }) + '\n',
    );
    process.env.HOME = tempHome;

    const { computeFleetAnalytics } = await loadAnalytics();
    const result = computeFleetAnalytics();

    expect(result.totalEvents).toBe(1);
    // Empty worker id falls through both extractModel branches to itself
    expect(result.beadCompletions).toEqual([]);
    // worker.started for the '' worker: 1 started, 1 unique -> no relaunch
    expect(result.workerRelaunchCount).toBe(0);
  });
});
