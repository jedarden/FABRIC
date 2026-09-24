/**
 * E2E contract tests for the `fabric web` operational options
 * (--max-events, --heap-snapshots, --snapshot-interval).
 *
 * Complements the seam-based cliOperationalOptions.test.ts suite by pinning
 * the contract purely through the compiled CLI artifact and a live server
 * probe — no in-process imports of the code under test:
 *
 *   1. `npm run build` runs in beforeAll, so this file is self-contained
 *      even under a bare `npx vitest run src/cliOperationalOptions.e2e.test.ts`
 *      (the `pretest` build hook only fires for `npm test`).
 *   2. `node dist/cli.js web --help` must document all three options with
 *      their documented defaults (docs/cli.md):
 *        --max-events <number>         "default: unset, no cap"
 *        --heap-snapshots              "default: true in production"
 *        --snapshot-interval <minutes> "default: 30"
 *   3. `node dist/cli.js web --port <ephemeral> --source <temp-dir>
 *      --max-events abc --snapshot-interval abc` must degrade gracefully:
 *      the server comes up, GET /api/health answers HTTP 200, the child
 *      process stays alive (the non-numeric cap never installs the
 *      liveness guard, so there is no overload exit), and the profiler
 *      startup line reports the effective interval fell back to the
 *      documented 30 minutes.
 *
 * Spawned CLI processes run with a temp HOME — isolating ~/.needle/fabric.db,
 * the needle state dir (applyAllWorkerLimits) and the snapshot fallback dir
 * from the live service — and NODE_ENV=production, so the documented
 * production default turns heap snapshots on. That is what makes the resolved
 * snapshot interval observable in startup logging without altering the argv
 * under test.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createNetServer } from 'node:net';

const REPO_ROOT = process.cwd();
const DIST_CLI = join(REPO_ROOT, 'dist', 'cli.js');

// ─────────────────────────────────────────────────────────────────────
// Compiled-artifact precondition — build dist/cli.js before asserting on it
// ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // `npm run build` is plain `tsc` (incremental via tsconfig.tsbuildinfo),
  // so under `npm test` this is a cheap no-op after the pretest hook.
  const res = spawnSync('npm', ['run', 'build'], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    timeout: 240_000,
  });
  if (res.status !== 0) {
    throw new Error(
      `npm run build failed (status=${res.status})\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`,
    );
  }
}, 240_000);

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
 * Spawn the compiled CLI with the exact argv under test:
 * `web --port <ephemeral> --source <temp-dir> --max-events abc --snapshot-interval abc`.
 */
async function spawnWebWithNonNumericOptions(): Promise<SpawnedWeb> {
  const home = mkdtempSync(join(tmpdir(), 'fabric-cli-e2e-'));
  const sourceDir = join(home, 'logs');
  mkdirSync(sourceDir, { recursive: true });
  // One empty per-worker JSONL so the directory tailer has a file to watch
  // that replays nothing — store size stays 0 without any POST.
  writeFileSync(join(sourceDir, 'w-e2e.jsonl'), '', 'utf-8');

  const port = await resolveFreePort();
  const child = spawn(
    'node',
    [
      DIST_CLI, 'web',
      '--port', String(port),
      '--source', sourceDir,
      '--max-events', 'abc',
      '--snapshot-interval', 'abc',
    ],
    {
      env: {
        ...process.env,
        HOME: home,                    // isolates fabric.db + needle state + snapshots
        NODE_ENV: 'production',        // documented default: snapshots on in production
        FABRIC_AUTH_TOKEN: '',         // keep POST posture open, though only GETs are made
        FABRIC_SNAPSHOT_DIR: join(home, 'snapshots'),
        WATCHDOG_USEC: '',             // no systemd watchdog in a spawned test child
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
  };
  child.once('exit', (code, signal) => {
    spawned.exitInfo = { code, signal };
  });
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => { spawned.stdout += chunk; });
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (chunk: string) => { spawned.stderr += chunk; });
  return spawned;
}

/** Poll GET /api/health until the spawned CLI answers (200 ok or 503 overloaded). */
async function waitUntilListening(sp: SpawnedWeb, timeoutMs = 20_000): Promise<void> {
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

async function getHealthStatus(sp: SpawnedWeb): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${sp.port}/api/health`);
  return res.status;
}

/** The child is still running: no exit event, no exit code, no kill signal. */
function assertChildAlive(sp: SpawnedWeb): void {
  expect(sp.exitInfo, `child exited: ${JSON.stringify(sp.exitInfo)}\nstderr:\n${sp.stderr}`).toBeNull();
  expect(sp.child.exitCode).toBeNull();
  expect(sp.child.signalCode).toBeNull();
}

/** SIGTERM the child (SIGKILL fallback), then remove its temp HOME. */
async function stopSpawned(sp: SpawnedWeb | null): Promise<void> {
  if (!sp) return;
  if (!sp.exitInfo) {
    sp.child.kill('SIGTERM');
    const killTimer = setTimeout(() => sp.child.kill('SIGKILL'), 3000);
    killTimer.unref();
    await new Promise<void>((resolve) => {
      if (sp.exitInfo) return resolve();
      sp.child.once('exit', () => resolve());
    });
  }
  rmSync(sp.home, { recursive: true, force: true });
}

let active: SpawnedWeb | null = null;

afterAll(async () => {
  await stopSpawned(active);
  active = null;
});

// ─────────────────────────────────────────────────────────────────────
// Help surface — the compiled binary documents the contract
// ─────────────────────────────────────────────────────────────────────

describe('compiled CLI help surface (node dist/cli.js web --help)', () => {
  it('documents all three operational options with their documented defaults', { timeout: 30_000 }, () => {
    const res = spawnSync('node', [DIST_CLI, 'web', '--help'], { encoding: 'utf-8' });

    expect(res.status).toBe(0);
    // Commander wraps option descriptions at ~80 columns; collapse all
    // whitespace so an assertion can never be split across a wrap boundary.
    const help = res.stdout.replace(/\s+/g, ' ');

    // --max-events: presence, value shape, and the documented "no cap" default
    expect(help).toContain('--max-events <number>');
    expect(help).toContain('default: unset, no cap');

    // --heap-snapshots: presence (boolean flag — no value shape) and the
    // documented production-only default
    expect(help).toContain('--heap-snapshots');
    expect(help).toContain('default: true in production');

    // --snapshot-interval: presence, value shape, and the documented
    // 30-minute default
    expect(help).toContain('--snapshot-interval <minutes>');
    expect(help).toContain('default: 30');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Live server — non-numeric operational options degrade gracefully
// ─────────────────────────────────────────────────────────────────────

describe('live server probe with non-numeric --max-events / --snapshot-interval', () => {
  it('starts, answers GET /api/health with 200, and stays alive (no overload exit)', { timeout: 45_000 }, async () => {
    active = await spawnWebWithNonNumericOptions();
    await waitUntilListening(active);

    // The liveness guard is never installed for a NaN cap (`if (maxEventCount)`
    // is falsy), and `store.size > NaN` is always false — so health can only
    // report 200, never the 503 overload status.
    expect(await getHealthStatus(active)).toBe(200);
    assertChildAlive(active);

    // Hold the process open past the probe: a degraded-but-alive server must
    // not exit shortly after startup either, and must keep answering.
    await sleep(750);
    assertChildAlive(active);
    expect(await getHealthStatus(active)).toBe(200);
  });

  it('resolves the effective snapshot interval to the documented 30-minute fallback', { timeout: 45_000 }, async () => {
    active = await spawnWebWithNonNumericOptions();
    await waitUntilListening(active);

    // The web action announces its resolved profiler config on stderr right
    // before the server is created:
    //   "Heap snapshots enabled: every <N> minutes → ~/.needle/snapshots/"
    // parseInt('abc') is NaN → `|| 30` → the documented default, observable
    // here because NODE_ENV=production enables snapshots without --heap-snapshots.
    expect(active.stderr).toContain('Heap snapshots enabled: every 30 minutes');
    assertChildAlive(active);
  });
});
