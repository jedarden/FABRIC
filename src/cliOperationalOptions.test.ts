/**
 * CLI contract tests for the `fabric web` operational options.
 *
 * Covers the three options documented in docs/cli.md ("fabric web" section):
 *
 *   --max-events <number>        default: unset — max events in store before
 *                                the liveness guard exits (memory-bomb guard)
 *   --heap-snapshots             default: true in production (NODE_ENV=production)
 *   --snapshot-interval <minutes>  default: 30
 *
 * The tests run the real built CLI (dist/cli.js — rebuilt by the `pretest`
 * hook, same pattern as digest.integration.test.ts / pathResolver.test.ts)
 * so the contract is exercised end-to-end: commander parsing → option
 * resolution in the web action → propagation into createWebServer
 * (/api/health overload reporting + the 3-consecutive-check liveness guard)
 * and the memory profiler (heap snapshot enablement + interval).
 *
 * Spawned CLI processes run with a temp HOME so they never touch the live
 * service's ~/.needle state (fabric.db, snapshots, logs) — the default log
 * source is overridden with --source pointing at a temp fixture file, which
 * also keeps the directory-source applyAllWorkerLimits() path out of play.
 */

import { describe, it, expect, afterEach, beforeEach, vi, type MockInstance } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import { createWebServer, type WebServer } from './web/server.js';
import { InMemoryEventStore } from './store.js';

const DIST_CLI = join(process.cwd(), 'dist', 'cli.js');

// Isolate the in-process tests from the live service's snapshot directory
// BEFORE server.ts / memoryProfiler.ts resolve it — same pattern as
// server.heap.test.ts. The fake-timer runs below advance the server's
// memory-check interval, and a test worker under heap pressure must never
// be able to write into ~/.needle/snapshots.
vi.hoisted(() => {
  process.env.FABRIC_SNAPSHOT_DIR =
    `${process.env.TMPDIR ?? '/tmp'}/fabric-cli-contract-snapshots-${process.pid}-${Date.now()}`;
});

// ─────────────────────────────────────────────────────────────────────
// Spawn helpers
// ─────────────────────────────────────────────────────────────────────

interface ExitInfo {
  code: number | null;
  signal: string | null;
}

interface SpawnedWeb {
  child: ChildProcess;
  port: number;
  /** Temp HOME the child ran with — removed after stop. */
  home: string;
  stdout: string;
  stderr: string;
  exitInfo: ExitInfo | null;
  exitPromise: Promise<ExitInfo>;
}

/** Grab an ephemeral port by binding and releasing a probe socket. */
function resolveFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as { port: number }).port;
      probe.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Spawn `node dist/cli.js web` against a temp HOME and a temp single-file
 * log source. Returns once the process is up (not once HTTP is ready —
 * see waitUntilReady).
 */
async function spawnWeb(
  args: string[],
  envOverrides: Record<string, string> = {},
): Promise<SpawnedWeb> {
  const home = mkdtempSync(join(tmpdir(), 'fabric-cli-contract-'));
  // Single-file source: skips applyAllWorkerLimits() (directory sources only)
  // and keeps the tailer away from the real ~/.needle/logs. The file stays
  // empty so the tailer replays nothing and store size == posted events.
  const logsDir = join(home, 'logs');
  mkdirSync(logsDir, { recursive: true });
  const sourceLog = join(logsDir, 'source.jsonl');
  writeFileSync(sourceLog, '', 'utf-8');

  const port = await resolveFreePort();
  const child = spawn(
    'node',
    [DIST_CLI, 'web', '--port', String(port), '--source', sourceLog, ...args],
    {
      env: {
        ...process.env,
        HOME: home, // isolates ~/.needle/fabric.db + snapshots from the live service
        NODE_ENV: 'test',
        FABRIC_AUTH_TOKEN: '', // POSTs must be open for fixture ingestion
        FABRIC_SNAPSHOT_DIR: join(home, 'snapshots'),
        WATCHDOG_USEC: '',
        ...envOverrides,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const spawned: SpawnedWeb = {
    child,
    port,
    home,
    stdout: '',
    stderr: '',
    exitInfo: null,
    exitPromise: Promise.resolve({ code: null, signal: null }),
  };
  spawned.exitPromise = new Promise<ExitInfo>((resolve) => {
    child.once('exit', (code, signal) => {
      spawned.exitInfo = { code, signal };
      resolve(spawned.exitInfo);
    });
  });
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => { spawned.stdout += chunk; });
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (chunk: string) => { spawned.stderr += chunk; });
  return spawned;
}

/** Poll /api/health until the spawned CLI answers (200 ok or 503 overloaded). */
async function waitUntilReady(sp: SpawnedWeb, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (sp.exitInfo) {
      throw new Error(
        `web CLI exited early (code=${sp.exitInfo.code}, signal=${sp.exitInfo.signal})\n` +
        `stdout:\n${sp.stdout}\nstderr:\n${sp.stderr}`,
      );
    }
    try {
      const res = await fetch(`http://127.0.0.1:${sp.port}/api/health`);
      if (res.status === 200 || res.status === 503) return;
    } catch {
      // not listening yet
    }
    await sleep(150);
  }
  throw new Error(
    `web CLI never became ready on port ${sp.port}\nstdout:\n${sp.stdout}\nstderr:\n${sp.stderr}`,
  );
}

/** POST `count` NEEDLE log-entry events (the shape /api/events accepts). */
async function postEvents(port: number, count: number, workerId: string): Promise<void> {
  for (let i = 0; i < count; i++) {
    const res = await fetch(`http://127.0.0.1:${port}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ts: new Date().toISOString(),
        event: 'worker.heartbeat',
        worker: workerId,
        level: 'info',
        msg: 'cli contract probe',
      }),
    });
    expect(res.status).toBe(201);
  }
}

async function getHealth(sp: SpawnedWeb): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${sp.port}/api/health`);
  return { httpStatus: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** SIGTERM the child (SIGKILL fallback), then remove its temp HOME. */
async function stopSpawned(sp: SpawnedWeb): Promise<void> {
  if (!sp.exitInfo) {
    sp.child.kill('SIGTERM');
    const killTimer = setTimeout(() => sp.child.kill('SIGKILL'), 3000);
    killTimer.unref();
    await sp.exitPromise;
  }
  rmSync(sp.home, { recursive: true, force: true });
}

let active: SpawnedWeb | null = null;

afterEach(async () => {
  if (active) {
    await stopSpawned(active);
    active = null;
  }
});

// ─────────────────────────────────────────────────────────────────────
// Parsing surface
// ─────────────────────────────────────────────────────────────────────

describe('fabric web --help (option parsing surface)', () => {
  it('documents the operational options with their documented defaults', { timeout: 20_000 }, () => {
    const res = spawnSync('node', [DIST_CLI, 'web', '--help'], { encoding: 'utf-8' });

    expect(res.status).toBe(0);
    // Commander wraps option descriptions at ~80 columns; collapse all
    // whitespace so an assertion can never be split across a wrap boundary.
    const help = `${res.stdout}${res.stderr}`.replace(/\s+/g, ' ');

    // --max-events: presence, value shape, and the documented "no cap" default
    expect(help).toContain('--max-events <number>');
    expect(help).toContain('Max events in store before liveness guard exits');
    expect(help).toContain('memory-bomb guard');
    expect(help).toContain('default: unset, no cap');

    // --heap-snapshots: presence (boolean flag — no value shape) and the
    // documented production-only default
    expect(help).toContain('--heap-snapshots');
    expect(help).toContain('default: true in production');

    // --snapshot-interval: presence, value shape, and the documented
    // 30-minute default
    expect(help).toContain('--snapshot-interval <minutes>');
    expect(help).toContain('Interval between heap snapshots (default: 30)');
  });
});

// ─────────────────────────────────────────────────────────────────────
// --max-events propagation → /api/health overload contract
// ─────────────────────────────────────────────────────────────────────

describe('--max-events propagation (liveness reporting)', () => {
  it('defaults to no cap: a store full of events still reports healthy (200)', { timeout: 20_000 }, async () => {
    active = await spawnWeb([]);
    await waitUntilReady(active);
    await postEvents(active.port, 5, 'w-no-max');

    const { httpStatus, body } = await getHealth(active);
    expect(httpStatus).toBe(200);
    expect(body.event_count).toBe(5);
    expect(body.status).not.toBe('overloaded');
  });

  it('reports healthy (200) while the store is under --max-events', { timeout: 20_000 }, async () => {
    active = await spawnWeb(['--max-events', '100']);
    await waitUntilReady(active);
    await postEvents(active.port, 5, 'w-under-max');

    const { httpStatus, body } = await getHealth(active);
    expect(httpStatus).toBe(200);
    expect(body.event_count).toBe(5);
    expect(body.status).not.toBe('overloaded');
  });

  it('reports overloaded (503) once the store exceeds --max-events', { timeout: 20_000 }, async () => {
    active = await spawnWeb(['--max-events', '3']);
    await waitUntilReady(active);
    await postEvents(active.port, 5, 'w-over-max');

    const { httpStatus, body } = await getHealth(active);
    expect(httpStatus).toBe(503);
    expect(body.status).toBe('overloaded');
    expect(body.event_count).toBe(5);
  });

  it('degrades gracefully on a non-numeric value: no overload, healthy (200)', { timeout: 20_000 }, async () => {
    // parseInt('abc') is NaN, which is falsy: the liveness guard is not
    // installed and the overload comparison can never trip. Non-numeric
    // input must not crash the server or brick ingestion.
    active = await spawnWeb(['--max-events', 'abc']);
    await waitUntilReady(active);
    await postEvents(active.port, 5, 'w-nan-max');

    const { httpStatus, body } = await getHealth(active);
    expect(httpStatus).toBe(200);
    expect(body.event_count).toBe(5);
    expect(body.status).not.toBe('overloaded');
  });
});

// ─────────────────────────────────────────────────────────────────────
// --heap-snapshots / --snapshot-interval defaults + propagation
// ─────────────────────────────────────────────────────────────────────

describe('--heap-snapshots / --snapshot-interval propagation', () => {
  // The web action announces its resolved profiler config on stderr:
  //   "Heap snapshots enabled: every <N> minutes → ~/.needle/snapshots/"
  // printed right after startPeriodicCapture(), so presence + interval in
  // that line is the observable propagation contract.
  const ENABLED_LINE = 'Heap snapshots enabled: every ';

  it('defaults heap snapshots ON with a 30-minute interval in production', { timeout: 20_000 }, async () => {
    // Documented production default (docs/cli.md: "true in production").
    active = await spawnWeb([], { NODE_ENV: 'production' });
    await waitUntilReady(active);

    expect(active.stderr).toContain(`${ENABLED_LINE}30 minutes`);
  });

  it('defaults heap snapshots OFF outside production', { timeout: 20_000 }, async () => {
    active = await spawnWeb([], { NODE_ENV: 'test' });
    await waitUntilReady(active);

    expect(active.stderr).not.toContain(ENABLED_LINE);
  });

  it('enables heap snapshots explicitly, outside production, at the 30-minute default', { timeout: 20_000 }, async () => {
    active = await spawnWeb(['--heap-snapshots'], { NODE_ENV: 'test' });
    await waitUntilReady(active);

    expect(active.stderr).toContain(`${ENABLED_LINE}30 minutes`);
  });

  it('propagates a custom --snapshot-interval', { timeout: 20_000 }, async () => {
    active = await spawnWeb(['--heap-snapshots', '--snapshot-interval', '5'], { NODE_ENV: 'test' });
    await waitUntilReady(active);

    expect(active.stderr).toContain(`${ENABLED_LINE}5 minutes`);
  });

  it('falls back to the documented 30-minute default for a non-numeric interval', { timeout: 20_000 }, async () => {
    // parseInt('abc') is NaN → `|| 30` → the documented default.
    active = await spawnWeb(['--heap-snapshots', '--snapshot-interval', 'abc'], { NODE_ENV: 'test' });
    await waitUntilReady(active);

    expect(active.stderr).toContain(`${ENABLED_LINE}30 minutes`);
  });

  it('does not enable snapshots when only --snapshot-interval is given', { timeout: 20_000 }, async () => {
    active = await spawnWeb(['--snapshot-interval', '5'], { NODE_ENV: 'test' });
    await waitUntilReady(active);

    expect(active.stderr).not.toContain(ENABLED_LINE);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Liveness guard — end-to-end exit contract
// ─────────────────────────────────────────────────────────────────────

describe('liveness guard (memory-bomb guard exit contract)', () => {
  // The guard checks every 10s and exits on the 3rd consecutive over-max
  // check, so this test necessarily takes ~35s of wall time.
  it('exits with code 1 after 3 consecutive over-max checks', { timeout: 70_000 }, async () => {
    active = await spawnWeb(['--max-events', '2']);
    await waitUntilReady(active);
    await postEvents(active.port, 10, 'w-memory-bomb');

    const exitInfo = await Promise.race([
      active.exitPromise,
      sleep(60_000).then(() => null),
    ]);

    expect(exitInfo).not.toBeNull();
    expect(exitInfo!.code).toBe(1);
    expect(active.stderr).toContain('Liveness check failed');
    expect(active.stderr).toContain('3 consecutive checks');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Liveness guard — consecutive-failure semantics (createWebServer seam)
// ─────────────────────────────────────────────────────────────────────
// The 3-strikes/reset rules are timing-shaped (10s cadence), so they are
// verified in-process against createWebServer with fake timers instead of
// paying ~30s per case in a spawned process.

describe('liveness guard semantics (createWebServer seam)', () => {
  let store: InMemoryEventStore;
  let server: WebServer;
  let exitSpy: MockInstance<(code?: number) => never>;
  let consoleErrorSpy: MockInstance<typeof console.error>;

  function addEvents(count: number): void {
    for (let i = 0; i < count; i++) {
      store.add({ ts: 1709337600 + i, worker: 'w-guard', level: 'info', msg: 'guard probe', sequence: i });
    }
  }

  async function startServer(srv: WebServer): Promise<void> {
    await new Promise<void>((resolve) => {
      srv.on('start', () => resolve());
      srv.start();
    });
  }

  async function advance(seconds: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(seconds * 1000);
  }

  beforeEach(() => {
    store = new InMemoryEventStore();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.useRealTimers();
    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    if (server) {
      await new Promise<void>((resolve) => {
        server.on('stop', () => resolve());
        server.stop();
      });
    }
    store.clear();
  });

  it('calls process.exit(1) on exactly the 3rd consecutive over-max check', async () => {
    vi.useFakeTimers();
    server = createWebServer({ port: 0, logPath: '/tmp/test-logs', store, maxEventCount: 5 });
    await startServer(server);
    addEvents(6); // store.size = 6 > 5

    await advance(10);
    expect(exitSpy).not.toHaveBeenCalled();
    await advance(10);
    expect(exitSpy).not.toHaveBeenCalled();

    await advance(10);
    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Liveness check failed: event store (6) exceeds max (5) for 3 consecutive checks'),
    );
  });

  it('resets the consecutive-failure streak when a check finds the store under max', async () => {
    vi.useFakeTimers();
    server = createWebServer({ port: 0, logPath: '/tmp/test-logs', store, maxEventCount: 5 });
    await startServer(server);

    // Two failing checks...
    addEvents(6);
    await advance(10);
    await advance(10);
    expect(exitSpy).not.toHaveBeenCalled();

    // ...then a passing one, which must reset the streak...
    store.clear();
    await advance(10);
    expect(exitSpy).not.toHaveBeenCalled();

    // ...so two further failures are still not enough...
    addEvents(6);
    await advance(10);
    await advance(10);
    expect(exitSpy).not.toHaveBeenCalled();

    // ...and only the third consecutive failure exits.
    await advance(10);
    expect(exitSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('does not install the guard when maxEventCount is unset', async () => {
    vi.useFakeTimers();
    server = createWebServer({ port: 0, logPath: '/tmp/test-logs', store });
    await startServer(server);
    addEvents(50); // far beyond any plausible threshold, but no cap was configured

    await advance(40);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
