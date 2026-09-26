/**
 * GET route-discovery auth + side-effect contract tests (docs/api-auth.md)
 *
 * The POST contract lives in server.authRoutes.test.ts. This file is its
 * GET twin, pinning the other half of the policy:
 *
 *   "Every GET endpoint is open — read-only, no secret data."
 *
 * for EVERY discovered GET route (WebServer.getGetRoutePatterns() walks the
 * live Express router) on BOTH HTTP listeners (the main port and the
 * optional OTLP/HTTP port wrap the same Express app):
 *
 *   - no Authorization header  → never 401/403. The auth middleware only
 *     ever challenges POST, so the answer to an unauthenticated GET is the
 *     handler's own verdict — 200, 400, 404, whatever the route does with
 *     an empty store — never the gate's.
 *   - a WRONG Bearer token     → still never 401/403. A bad credential must
 *     not be able to block a read; the policy's "open" is unconditional.
 *
 * "Read-only" is pinned as a side-effect contract across the whole sweep:
 * unauthenticated GETs ingest no events, never move the memory baseline,
 * and write nothing to disk (no heap snapshot, no trend report, no theme
 * file). The ONE documented exception is the memory profiler's lazy
 * in-memory initialization (docs/memory-api.md): the first stats read
 * (`GET /api/memory/stats`, and `GET /api/health` which feeds from it)
 * captures one snapshot into the profiler's in-memory ring when the ring is
 * empty so the response always has data. That side effect is memory-only —
 * no file write, no baseline change — and the first suite below pins it
 * exactly: ring 0 → 1 on the first stats read, never growing further from
 * reads, with `GET /api/memory/snapshots` performing no capture at all.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createWebServer, WebServer } from './server.js';
import { InMemoryEventStore } from '../store.js';
import { resetCrossReferenceManager } from '../crossReferenceManager.js';
import { getMemoryProfiler } from '../memoryProfiler.js';

// Isolate disk-writing handlers away from the real home BEFORE the server's
// module graph resolves the constant — same pattern as server.heap.test.ts
// and server.authRoutes.test.ts. The memory profiler resolves its snapshot
// directory at module load; this suite proves GETs never write into it.
const { ISOLATED_SNAPSHOT_DIR } = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/fabric-get-routes-test-${process.pid}-${Date.now()}`;
  process.env.FABRIC_SNAPSHOT_DIR = dir;
  return { ISOLATED_SNAPSHOT_DIR: dir };
});

afterAll(() => {
  fs.rmSync(ISOLATED_SNAPSHOT_DIR, { recursive: true, force: true });
});

/** Recursive name:size inventory of the isolated snapshot dir, sorted. */
const diskInventory = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return [];
  const walk = (sub: string): string[] =>
    fs.readdirSync(sub, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(sub, entry.name);
      if (entry.isDirectory()) return walk(full);
      return [`${path.relative(dir, full)}:${fs.statSync(full).size}`];
    });
  return walk(dir).sort();
};

// ── Suite 1: the documented in-memory initialization side effect ──────
// Declared FIRST so this file is the profiler singleton's first touch: the
// ring starts empty and the suite can pin the exact 0 → 1 initialization.
describe('the documented in-memory initialization side effect (docs/memory-api.md)', () => {
  let store: InMemoryEventStore;
  let server: WebServer;
  let port: number;
  let logDir: string;

  beforeEach(async () => {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-get-routes-init-logs-'));
    store = new InMemoryEventStore();
    resetCrossReferenceManager();

    server = createWebServer({ port: 0, logPath: logDir, store });
    await new Promise<void>((resolve) => {
      server.on('start', () => resolve());
      server.start();
    });
    port = server.getPort();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.on('stop', () => resolve());
      server.stop();
    });
    store.clear();
    resetCrossReferenceManager();
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  it('performs no capture on GET /api/memory/snapshots with an empty ring', async () => {
    // First profiler touch of this whole file — the ring must still be empty
    // here (instantiating the singleton captures nothing).
    expect(getMemoryProfiler().getRecent(1)).toHaveLength(0);

    const res = await fetch(`http://localhost:${port}/api/memory/snapshots`);
    expect(res.status).toBe(200);
    const data = await res.json() as { count: number; snapshots: unknown[] };
    expect(data.count).toBe(0);
    expect(data.snapshots).toEqual([]);
    // The read neither captured nor seeded the ring.
    expect(getMemoryProfiler().getRecent(1)).toHaveLength(0);
  });

  it('initializes the ring with exactly one capture on the first GET /api/memory/stats', async () => {
    expect(getMemoryProfiler().getRecent(1)).toHaveLength(0);

    const res = await fetch(`http://localhost:${port}/api/memory/stats`);
    expect(res.status).toBe(200);
    const data = await res.json() as { current: { rss: number }; trend: string };
    // The documented reason for the side effect: the response always has data.
    expect(data.current.rss).toBeGreaterThan(0);

    const ring = getMemoryProfiler().getRecent(10_000);
    expect(ring).toHaveLength(1);
    expect(ring[0].rss).toBe(data.current.rss);
  });

  it('does not grow the ring on subsequent stats reads', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`http://localhost:${port}/api/memory/stats`);
      expect(res.status).toBe(200);
    }
    // Initialization, not accumulation: reads never add snapshots.
    expect(getMemoryProfiler().getRecent(10_000)).toHaveLength(1);
  });

  it('reads the warm ring from GET /api/health without growing it', async () => {
    const res = await fetch(`http://localhost:${port}/api/health`);
    expect(res.status).toBe(200);
    const data = await res.json() as { memory: { rss: number } };
    expect(data.memory.rss).toBeGreaterThan(0);
    expect(getMemoryProfiler().getRecent(10_000)).toHaveLength(1);
  });

  it('initialization writes no file and sets no baseline', async () => {
    // Everything above ran through the real routes — and the snapshot
    // directory the profiler created at first touch holds no files at all.
    expect(diskInventory(ISOLATED_SNAPSHOT_DIR)).toEqual([]);

    const res = await fetch(`http://localhost:${port}/api/memory/diff`);
    expect(res.status).toBe(404);
    const data = await res.json() as { error: string };
    expect(data.error).toBe('No baseline set');
  });
});

// ── Suite 2: the GET contract on a token-configured server ────────────
describe('GET route-discovery contract (docs/api-auth.md)', () => {
  let store: InMemoryEventStore;
  let server: WebServer;
  let port: number;
  let otlpPort: number;
  let logDir: string;
  let tmpHome: string;
  let originalHome: string | undefined;

  const AUTH_TOKEN = 'get-route-contract-token';

  /** Both HTTP listeners wrap the same Express app — the contract must hold on each. */
  const listenerPorts = (): number[] => {
    const otlp = server.getOtlpPort();
    return otlp !== undefined ? [port, otlp] : [port];
  };

  /** Turn a discovered pattern like /api/workers/:id into a requestable path. */
  const concretePath = (pattern: string): string => pattern.replace(/:[^/]+/g, 'get-contract');

  const get = (portNum: number, route: string, token?: string): Promise<Response> =>
    fetch(`http://localhost:${portNum}${route}`, {
      method: 'GET',
      headers: token !== undefined ? { Authorization: `Bearer ${token}` } : {},
    });

  const discovered = (): string[] => server.getGetRoutePatterns();

  beforeEach(async () => {
    // Theme persistence resolves HOME per call — keep it in a temp dir so the
    // sweep can prove GET /api/theme never persists anything.
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-get-routes-home-'));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;

    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-get-routes-logs-'));

    store = new InMemoryEventStore();
    resetCrossReferenceManager();

    server = createWebServer({
      port: 0,
      logPath: logDir,
      store,
      authToken: AUTH_TOKEN,
      otlpHttpPort: 0, // mounts the OTLP router so both listeners are live
    });

    await new Promise<void>((resolve) => {
      server.on('start', () => resolve());
      server.start();
    });
    port = server.getPort();
    otlpPort = server.getOtlpPort()!;

    // Mirror production steady state: within 30s of startup the server's own
    // memory-check interval captures into the profiler, so by the time
    // anyone GETs anything the ring is warm and the lazy-initialization
    // side effect (pinned in suite 1) is no longer in play.
    getMemoryProfiler().setBaseline();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.on('stop', () => resolve());
      server.stop();
    });
    store.clear();
    resetCrossReferenceManager();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  describe('route discovery', () => {
    it('discovers the GET routes registered by the app', () => {
      const patterns = discovered();
      expect(patterns.length).toBeGreaterThan(0);
      for (const pattern of patterns) {
        expect(pattern.startsWith('/'), pattern).toBe(true);
      }

      // Native app.get registrations — a representative anchor from every
      // route family, memory endpoints especially (their side-effect story
      // is what this contract exists for).
      for (const anchor of [
        '/api/health',
        '/api/metrics',
        '/api/retention',
        '/api/retention/controls',
        '/api/theme',
        '/api/memory/stats',
        '/api/memory/diff',
        '/api/memory/snapshots',
        '/api/memory/diff-analysis',
        '/api/memory/trend',
        '/api/memory/trend.md',
        '/api/workers',
        '/api/events',
        '/api/heatmap',
        '/api/dag',
        '/api/cost/summary',
        '/api/errors/groups',
        '/api/productivity',
        '/api/digest',
        '/api/sessions',
        '/api/system/memory',
      ]) {
        expect(patterns, `discovery must find ${anchor}`).toContain(anchor);
      }
    });

    it('contains no OTLP receiver routes — the receiver is POST-only', () => {
      // GET /v1/logs has no handler; unauthenticated GETs there fall through
      // to the SPA fallback (pinned below) rather than to any OTLP handler.
      expect(discovered().some(p => p.startsWith('/v1/'))).toBe(false);
      expect(server.getPostRoutePatterns()).toEqual(
        expect.arrayContaining(['/v1/logs', '/v1/traces', '/v1/metrics']),
      );
    });

    it('exposes both HTTP listeners, on distinct ports', () => {
      expect(otlpPort).toBeDefined();
      expect(otlpPort).not.toBe(port);
    });
  });

  describe('every discovered GET route, on both listeners', () => {
    it('is served without an Authorization header — never 401, never 403', { timeout: 60_000 }, async () => {
      for (const listener of listenerPorts()) {
        for (const pattern of discovered()) {
          const res = await get(listener, concretePath(pattern));
          expect(res.status, `${listener} ${pattern} must not be auth-challenged`).not.toBe(401);
          expect(res.status, `${listener} ${pattern} must not be auth-challenged`).not.toBe(403);
        }
      }
    });

    it('is served even with a WRONG Bearer token — a bad credential cannot block a read', { timeout: 60_000 }, async () => {
      for (const listener of listenerPorts()) {
        for (const pattern of discovered()) {
          const res = await get(listener, concretePath(pattern), 'wrong-token');
          expect(res.status, `${listener} ${pattern} must not be auth-challenged`).not.toBe(401);
          expect(res.status, `${listener} ${pattern} must not be auth-challenged`).not.toBe(403);
        }
      }
    });

    it('answers 200 on the flagship reads of both listeners', async () => {
      for (const listener of listenerPorts()) {
        for (const anchor of ['/api/health', '/api/workers', '/api/events', '/api/memory/stats', '/api/memory/snapshots']) {
          const res = await get(listener, anchor);
          expect(res.status, `${listener} ${anchor}`).toBe(200);
        }
      }
    });
  });

  describe('unauthenticated GETs on the POST-only OTLP routes and unknown paths', () => {
    it('falls through to the SPA fallback for GET /v1/* — a 404, never an auth challenge', async () => {
      for (const listener of listenerPorts()) {
        for (const route of ['/v1/logs', '/v1/traces', '/v1/metrics']) {
          const res = await get(listener, route);
          expect(res.status, `${listener} ${route}`).toBe(404);
        }
      }
    });

    it('serves the SPA fallback for unknown GET paths without an auth challenge', async () => {
      for (const listener of listenerPorts()) {
        for (const route of ['/', '/definitely/not/a/route']) {
          const res = await get(listener, route);
          expect(res.status, `${listener} ${route}`).toBe(404);
          expect(await res.text()).toContain('FABRIC');
        }
      }
    });
  });

  describe('unauthenticated GETs are free of durable side effects', () => {
    it('ingests no events, moves no baseline, and writes no disk across the full sweep', { timeout: 60_000 }, async () => {
      const profiler = getMemoryProfiler();
      const diffBefore = profiler.diffFromBaseline();
      expect(diffBefore).not.toBeNull();

      const baselineBefore = diffBefore!.baseline;
      const ringBefore = profiler.getRecent(10_000).length;
      const eventsBefore = store.size;
      const diskBefore = diskInventory(ISOLATED_SNAPSHOT_DIR);
      const themeFile = path.join(tmpHome, '.fabric', 'theme.json');
      const sweepStart = Date.now();

      // The full unauthenticated sweep, both listeners.
      for (const listener of listenerPorts()) {
        for (const pattern of discovered()) {
          const res = await get(listener, concretePath(pattern));
          expect([401, 403], `${listener} ${pattern}`).not.toContain(res.status);
        }
      }

      // Ingestion: GET routes read the store, never add to it.
      expect(store.size).toBe(eventsBefore);

      // Baseline: the exact object set by POST /api/memory/baseline is still
      // in place — reference equality, so even a re-capture would fail this.
      const diffAfter = profiler.diffFromBaseline();
      expect(diffAfter).not.toBeNull();
      expect(diffAfter!.baseline).toBe(baselineBefore);
      expect(diffAfter!.baseline).toEqual(baselineBefore);

      // Ring: a GET can only capture into an EMPTY ring (suite 1 pins that
      // one-time initialization path). Here the ring is warm, so reads add
      // nothing — but this server's own 30s memory-check monitor may land a
      // capture mid-sweep, exactly as it does in production. Bound the
      // growth to that cadence plus scheduling slack: a regression where
      // reads captured per-call would add one snapshot per swept route
      // (~134), nowhere near this bound.
      const ringAfter = profiler.getRecent(10_000).length;
      const sweepMs = Date.now() - sweepStart;
      expect(ringAfter).toBeLessThanOrEqual(ringBefore + Math.floor((sweepMs + 10_000) / 30_000) + 1);

      // Disk: no heap snapshot, no trend report, nothing at all appeared.
      expect(diskInventory(ISOLATED_SNAPSHOT_DIR)).toEqual(diskBefore);

      // Theme: GET /api/theme reads; only its POST sibling persists.
      expect(fs.existsSync(themeFile)).toBe(false);
    });
  });
});

// ── Suite 3: unset-token mode ──────────────────────────────────────────
describe('GET endpoints in unset-token mode (no authToken configured)', () => {
  let store: InMemoryEventStore;
  let server: WebServer;
  let port: number;
  let otlpPort: number;
  let logDir: string;

  beforeEach(async () => {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-get-routes-unset-logs-'));
    store = new InMemoryEventStore();
    resetCrossReferenceManager();

    server = createWebServer({
      port: 0,
      logPath: logDir,
      store,
      // no authToken — the deployment model where a tailnet already guards
      // the port; mirrors the POST unset-token suite in server.authRoutes.test.ts
      otlpHttpPort: 0,
    });

    await new Promise<void>((resolve) => {
      server.on('start', () => resolve());
      server.start();
    });
    port = server.getPort();
    otlpPort = server.getOtlpPort()!;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.on('stop', () => resolve());
      server.stop();
    });
    store.clear();
    resetCrossReferenceManager();
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  it('serves the flagship GET routes on both listeners with no token configured', async () => {
    for (const listener of [port, otlpPort]) {
      for (const anchor of ['/api/health', '/api/workers', '/api/events', '/api/memory/stats']) {
        const res = await fetch(`http://localhost:${listener}${anchor}`);
        expect(res.status, `${listener} ${anchor}`).toBe(200);
      }
    }
  });
});
