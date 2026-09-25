/**
 * Route-discovery auth contract tests (docs/api-auth.md)
 *
 * POST auth coverage here is DERIVED from the routes the server actually
 * registers — WebServer.getPostRoutePatterns() walks the live Express router
 * — instead of a hand-maintained list, so a newly added POST route is swept
 * automatically and a removed one cannot leave a stale entry behind.
 *
 * The contract pinned, for EVERY discovered POST route on BOTH HTTP
 * listeners (the main port and the optional OTLP/HTTP port both wrap the
 * same Express app):
 *
 *   - no Authorization header  → 401 {"error": "Missing authorization"}
 *   - wrong Bearer token       → 403 {"error": "Forbidden"}
 *   - valid Bearer token       → passes the gate (never 401/403 again)
 *
 * Rejection must happen BEFORE body parsing (the 401/403 sweeps send
 * deliberately malformed JSON — a rejection that happened after parsing
 * would surface as a 400 parse error instead) and BEFORE handler side
 * effects (no events ingested, no OTLP records ingested, no theme
 * persisted, no prune attempt recorded).
 *
 * Token modes beyond the configured token are pinned too:
 *
 *   - valid token + malformed body → the gate passed and the request dies
 *     at the parse layer (400 from body-parser on /api/*, the receiver's
 *     500 decode failure on /v1/*) with no handler side effect.
 *   - unset-token mode (no authToken configured) → the gate lets EVERY
 *     POST through on BOTH listeners; handlers run for real (events ingest,
 *     theme persists).
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createWebServer, WebServer } from './server.js';
import { InMemoryEventStore } from '../store.js';
import { resetCrossReferenceManager } from '../crossReferenceManager.js';

// Isolate disk-writing handlers away from the real home BEFORE the server's
// module graph resolves the constant — same pattern as server.heap.test.ts.
// The valid-token sweep must be free to actually reach handlers, and the
// heap-snapshot/trend-report handlers write under this directory.
const { ISOLATED_SNAPSHOT_DIR } = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? '/tmp'}/fabric-auth-routes-test-${process.pid}-${Date.now()}`;
  process.env.FABRIC_SNAPSHOT_DIR = dir;
  return { ISOLATED_SNAPSHOT_DIR: dir };
});

afterAll(() => {
  fs.rmSync(ISOLATED_SNAPSHOT_DIR, { recursive: true, force: true });
});

describe('POST auth route-discovery contract', () => {
  let store: InMemoryEventStore;
  let server: WebServer;
  let port: number;
  let otlpPort: number;
  let logDir: string;
  let tmpHome: string;
  let originalHome: string | undefined;

  const AUTH_TOKEN = 'route-discovery-contract-token';

  const validEvent = {
    ts: new Date().toISOString(),
    event: 'auth.contract',
    worker: 'auth-contract-worker',
  };

  // Minimal OTLP/JSON ExportLogsServiceRequest (same shape as the fixtures
  // in otlpHttpReceiver.test.ts) — accepted by /v1/logs and normalized into
  // exactly one LogEvent.
  const OTLP_LOGS_PAYLOAD = {
    resourceLogs: [{
      scopeLogs: [{
        logRecords: [{
          timeUnixNano: String(Date.now() * 1_000_000),
          attributes: [
            { key: 'event_type', value: { stringValue: 'worker.started' } },
            { key: 'worker_id', value: { stringValue: 'auth-contract-worker' } },
          ],
        }],
      }],
    }],
  };

  beforeEach(async () => {
    // Theme persistence resolves HOME per call — keep it in a temp dir so a
    // valid-token theme POST cannot touch ~/.fabric/theme.json.
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-auth-routes-home-'));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;

    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-auth-routes-logs-'));

    store = new InMemoryEventStore();
    resetCrossReferenceManager();

    server = createWebServer({
      port: 0,
      logPath: logDir,
      store,
      authToken: AUTH_TOKEN,
      otlpHttpPort: 0, // mounts the OTLP router so /v1/* is discoverable and sweepable
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
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  /** Both HTTP listeners wrap the same Express app — the contract must hold on each. */
  const listenerPorts = (): number[] => {
    const otlp = server.getOtlpPort();
    return otlp !== undefined ? [port, otlp] : [port];
  };

  /** Turn a discovered pattern like /api/cost/alerts/:id/acknowledge into a requestable path. */
  const concretePath = (pattern: string): string => pattern.replace(/:[^/]+/g, 'contract-test');

  const post = (
    portNum: number,
    route: string,
    options: { body?: string; contentType?: string; token?: string } = {},
  ): Promise<Response> =>
    fetch(`http://localhost:${portNum}${route}`, {
      method: 'POST',
      headers: {
        ...(options.contentType !== undefined ? { 'Content-Type': options.contentType } : {}),
        ...(options.token !== undefined ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body,
    });

  const discovered = (): string[] => server.getPostRoutePatterns();

  // A body the handler will accept or reject on its own merits — either way
  // the response proves the request passed the auth gate. Defaults to an
  // empty JSON object; overrides only where {} would trigger a real side
  // effect (a non-dry-run prune) or a genuinely expensive operation (a V8
  // heap snapshot of this test process — an invalid trigger makes the
  // handler 400 before writing anything).
  const benignBody = (pattern: string): { body: string; contentType: string } => {
    switch (pattern) {
      case '/api/events':
        return { body: JSON.stringify(validEvent), contentType: 'application/json' };
      case '/api/events/batch':
        return { body: JSON.stringify([validEvent]), contentType: 'application/json' };
      case '/api/retention/prune':
        return { body: JSON.stringify({ dryRun: true }), contentType: 'application/json' };
      case '/api/memory/heap-snapshot':
        return { body: JSON.stringify({ trigger: 'not-a-real-trigger' }), contentType: 'application/json' };
      default:
        return { body: '{}', contentType: 'application/json' };
    }
  };

  describe('route discovery', () => {
    it('discovers the POST routes registered by the app and by mounted routers', () => {
      const patterns = discovered();
      expect(patterns.length).toBeGreaterThan(0);
      for (const pattern of patterns) {
        expect(pattern.startsWith('/'), pattern).toBe(true);
      }

      // Native app.post registrations…
      const appAnchors = [
        '/api/events',
        '/api/events/batch',
        '/api/retention/prune',
        '/api/retention/controls',
        '/api/retention/tombstones',
        '/api/retention/holds',
        '/api/theme',
        '/api/memory/capture',
        '/api/memory/baseline',
        '/api/memory/heap-snapshot',
        '/api/memory/trend/save',
        '/api/cost/alerts/:id/acknowledge',
      ];
      for (const anchor of appAnchors) {
        expect(patterns, `discovery must find ${anchor}`).toContain(anchor);
      }

      // …and routes contributed by the mounted OTLP/HTTP router.
      for (const anchor of ['/v1/logs', '/v1/traces', '/v1/metrics']) {
        expect(patterns, `discovery must find ${anchor}`).toContain(anchor);
      }
    });

    it('exposes both HTTP listeners, on distinct ports', () => {
      expect(otlpPort).toBeDefined();
      expect(otlpPort).not.toBe(port);
    });

    it('omits OTLP routes when no OTLP listener is configured', async () => {
      const bare = createWebServer({
        port: 0,
        logPath: logDir,
        store,
        authToken: AUTH_TOKEN,
        // no otlpHttpPort → the OTLP router is never mounted
      });
      await new Promise<void>((resolve) => {
        bare.on('start', () => resolve());
        bare.start();
      });
      const patterns = bare.getPostRoutePatterns();
      await new Promise<void>((resolve) => {
        bare.on('stop', () => resolve());
        bare.stop();
      });

      expect(patterns.some(p => p.startsWith('/v1/'))).toBe(false);
      expect(patterns).toContain('/api/events');
    });
  });

  describe('every discovered POST route, on both listeners', () => {
    // Deliberately malformed JSON: the auth middleware is registered before
    // express.json(), so a rejection that happened after parsing would
    // surface as a 400 parse error instead of 401/403. Every sweep request
    // therefore doubles as a before-parsing proof.
    const MALFORMED = '{this-is-not-json';

    it('answers 401 (Missing authorization) without an Authorization header', async () => {
      for (const listener of listenerPorts()) {
        for (const pattern of discovered()) {
          const res = await post(listener, concretePath(pattern), {
            body: MALFORMED,
            contentType: 'application/json',
          });
          expect(res.status, `${listener} ${pattern}`).toBe(401);
          const data = await res.json() as { error?: string };
          expect(data.error, `${listener} ${pattern}`).toBe('Missing authorization');
        }
      }
    });

    it('answers 403 (Forbidden) with a wrong Bearer token', async () => {
      for (const listener of listenerPorts()) {
        for (const pattern of discovered()) {
          const res = await post(listener, concretePath(pattern), {
            body: MALFORMED,
            contentType: 'application/json',
            token: 'wrong-token',
          });
          expect(res.status, `${listener} ${pattern}`).toBe(403);
          const data = await res.json() as { error?: string };
          expect(data.error, `${listener} ${pattern}`).toBe('Forbidden');
        }
      }
    });

    it('passes a valid token through the gate to the handler', async () => {
      for (const listener of listenerPorts()) {
        for (const pattern of discovered()) {
          const { body, contentType } = benignBody(pattern);
          const res = await post(listener, concretePath(pattern), { body, contentType, token: AUTH_TOKEN });
          expect([401, 403], `${listener} ${pattern} must not re-challenge a valid token`).not.toContain(res.status);
        }
      }
    });
  });

  describe('malformed bodies with a valid token die at the parse layer', () => {
    const MALFORMED = '{this-is-not-json';

    it('never reaches a handler, on either listener', async () => {
      for (const listener of listenerPorts()) {
        for (const pattern of discovered()) {
          const res = await post(listener, concretePath(pattern), {
            body: MALFORMED,
            contentType: 'application/json',
            token: AUTH_TOKEN,
          });
          // The gate passed, so the response is the parse layer's, not a
          // handler's: body-parser rejects malformed JSON on /api/* with
          // 400 before any app.post handler is invoked, and the OTLP
          // receiver (which parses its own raw body) answers its decode
          // failure on /v1/*. Either way the server stays up and the
          // status is deterministic — never a hang, never a 401/403
          // re-challenge, never an unhandled crash.
          if (pattern.startsWith('/v1/')) {
            expect(res.status, `${listener} ${pattern}`).toBe(500);
          } else {
            expect(res.status, `${listener} ${pattern}`).toBe(400);
          }
        }
      }
    });

    it('ingests nothing from a malformed /api/events body', async () => {
      const res = await post(port, '/api/events', {
        body: MALFORMED,
        contentType: 'application/json',
        token: AUTH_TOKEN,
      });
      expect(res.status).toBe(400);
      expect(store.size).toBe(0);
    });

    it('ingests nothing from a malformed /v1/logs body', async () => {
      const res = await post(otlpPort, '/v1/logs', {
        body: MALFORMED,
        contentType: 'application/json',
        token: AUTH_TOKEN,
      });
      expect(res.status).toBe(500);
      const data = await res.json() as { error?: string };
      expect(data.error).toBe('internal server error');
      expect(store.size).toBe(0);
    });

    it('persists no theme from a malformed /api/theme body', async () => {
      const themeFile = path.join(tmpHome, '.fabric', 'theme.json');
      const res = await post(port, '/api/theme', {
        body: MALFORMED,
        contentType: 'application/json',
        token: AUTH_TOKEN,
      });
      expect(res.status).toBe(400);
      expect(fs.existsSync(themeFile)).toBe(false);
    });
  });

  describe('rejection precedes handler side effects', () => {
    it('ingests no event on /api/events without a valid token, on either listener', async () => {
      for (const listener of listenerPorts()) {
        const noHeader = await post(listener, '/api/events', {
          body: JSON.stringify(validEvent),
          contentType: 'application/json',
        });
        expect(noHeader.status).toBe(401);
        const wrong = await post(listener, '/api/events', {
          body: JSON.stringify(validEvent),
          contentType: 'application/json',
          token: 'wrong-token',
        });
        expect(wrong.status).toBe(403);
        expect(store.size, `listener ${listener} must not have ingested anything`).toBe(0);
      }
    });

    it('ingests no OTLP log record without a valid token, on either listener', async () => {
      for (const listener of listenerPorts()) {
        const noHeader = await post(listener, '/v1/logs', {
          body: JSON.stringify(OTLP_LOGS_PAYLOAD),
          contentType: 'application/json',
        });
        expect(noHeader.status).toBe(401);
        const wrong = await post(listener, '/v1/logs', {
          body: JSON.stringify(OTLP_LOGS_PAYLOAD),
          contentType: 'application/json',
          token: 'wrong-token',
        });
        expect(wrong.status).toBe(403);
        expect(store.size, `listener ${listener} must not have ingested anything`).toBe(0);
      }
    });

    it('persists no theme without a valid token', async () => {
      const themeFile = path.join(tmpHome, '.fabric', 'theme.json');
      const noHeader = await post(port, '/api/theme', {
        body: JSON.stringify({ theme: 'light' }),
        contentType: 'application/json',
      });
      expect(noHeader.status).toBe(401);
      const wrong = await post(port, '/api/theme', {
        body: JSON.stringify({ theme: 'light' }),
        contentType: 'application/json',
        token: 'wrong-token',
      });
      expect(wrong.status).toBe(403);
      expect(fs.existsSync(themeFile)).toBe(false);
    });

    it('records no prune attempt for an unauthorized prune', async () => {
      // The handler stamps prune_last_run_timestamp_seconds the moment it
      // runs — even before pruning. Its absence from /api/metrics proves
      // the handler never ran for the rejected request.
      const wrong = await post(port, '/api/retention/prune', {
        body: JSON.stringify({ dryRun: false, maxAgeDays: 0 }),
        contentType: 'application/json',
        token: 'wrong-token',
      });
      expect(wrong.status).toBe(403);

      const metricsRes = await fetch(`http://localhost:${port}/api/metrics`);
      const metricsText = await metricsRes.text();
      expect(metricsText).not.toContain('prune_last_run_timestamp_seconds');
    });
  });

  describe('valid-token behavior reaches handlers', () => {
    it('ingests an event on the main listener', async () => {
      const res = await post(port, '/api/events', {
        body: JSON.stringify(validEvent),
        contentType: 'application/json',
        token: AUTH_TOKEN,
      });
      expect(res.status).toBe(201);
      expect(store.size).toBe(1);
    });

    it('ingests an OTLP log record on the OTLP listener', async () => {
      const res = await post(otlpPort, '/v1/logs', {
        body: JSON.stringify(OTLP_LOGS_PAYLOAD),
        contentType: 'application/json',
        token: AUTH_TOKEN,
      });
      expect(res.status).toBe(200);
      expect(store.size).toBe(1);
    });

    it('runs a dry-run prune', async () => {
      const res = await post(port, '/api/retention/prune', {
        body: JSON.stringify({ dryRun: true }),
        contentType: 'application/json',
        token: AUTH_TOKEN,
      });
      expect(res.status).toBe(200);
      const data = await res.json() as { success?: boolean; summary?: string };
      expect(data.success).toBe(true);
      expect(data.summary).toContain('[DRY RUN]');
    });
  });

  describe('GET endpoints stay open while POSTs are gated', () => {
    it('serves /api/health without a token on both listeners', async () => {
      for (const listener of listenerPorts()) {
        const res = await fetch(`http://localhost:${listener}/api/health`);
        expect(res.status, `listener ${listener}`).toBe(200);
      }
    });
  });
});

describe('POST auth unset-token mode (no authToken configured)', () => {
  // docs/api-auth.md "Token configuration": with no token configured the
  // auth middleware is a no-op — the deployment model where a tailnet or
  // firewall already guards the port. The gate must let every POST through
  // on BOTH listeners, and handlers must run for real (not merely skip the
  // gate and fall through to nothing).
  let store: InMemoryEventStore;
  let server: WebServer;
  let port: number;
  let otlpPort: number;
  let logDir: string;
  let tmpHome: string;
  let originalHome: string | undefined;

  const validEvent = {
    ts: new Date().toISOString(),
    event: 'auth.unset-token',
    worker: 'auth-unset-worker',
  };

  const OTLP_LOGS_PAYLOAD = {
    resourceLogs: [{
      scopeLogs: [{
        logRecords: [{
          timeUnixNano: String(Date.now() * 1_000_000),
          attributes: [
            { key: 'event_type', value: { stringValue: 'worker.started' } },
            { key: 'worker_id', value: { stringValue: 'auth-unset-worker' } },
          ],
        }],
      }],
    }],
  };

  // Mirrors the configured-token suite's benign bodies: handlers really run
  // in this mode, so bodies must stay side-effect-free where a mutation
  // would reach disk (prune → dry run; heap snapshot → invalid trigger).
  const benignBody = (pattern: string): { body: string; contentType: string } => {
    switch (pattern) {
      case '/api/events':
        return { body: JSON.stringify(validEvent), contentType: 'application/json' };
      case '/api/events/batch':
        return { body: JSON.stringify([validEvent]), contentType: 'application/json' };
      case '/api/retention/prune':
        return { body: JSON.stringify({ dryRun: true }), contentType: 'application/json' };
      case '/api/memory/heap-snapshot':
        return { body: JSON.stringify({ trigger: 'not-a-real-trigger' }), contentType: 'application/json' };
      default:
        return { body: '{}', contentType: 'application/json' };
    }
  };

  beforeEach(async () => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-auth-unset-home-'));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;

    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-auth-unset-logs-'));

    store = new InMemoryEventStore();
    resetCrossReferenceManager();

    server = createWebServer({
      port: 0,
      logPath: logDir,
      store,
      // no authToken — the whole point of this suite
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
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  const listenerPorts = (): number[] => {
    const otlp = server.getOtlpPort();
    return otlp !== undefined ? [port, otlp] : [port];
  };

  const concretePath = (pattern: string): string => pattern.replace(/:[^/]+/g, 'unset-test');

  const post = (
    portNum: number,
    route: string,
    options: { body?: string; contentType?: string } = {},
  ): Promise<Response> =>
    fetch(`http://localhost:${portNum}${route}`, {
      method: 'POST',
      headers: options.contentType !== undefined ? { 'Content-Type': options.contentType } : {},
      body: options.body,
    });

  it('passes every discovered POST route through the gate on both listeners', async () => {
    for (const listener of listenerPorts()) {
      for (const pattern of server.getPostRoutePatterns()) {
        const { body, contentType } = benignBody(pattern);
        const res = await post(listener, concretePath(pattern), { body, contentType });
        // "Not 401/403" is the contract here — the handler is free to 400 a
        // vacuous {} body (e.g. retention controls) or 404 an unknown cost
        // alert; what must never happen is the auth middleware answering.
        expect([401, 403], `${listener} ${pattern}`).not.toContain(res.status);
      }
    }
  });

  it('really ingests /api/events with no header, on either listener', async () => {
    for (const listener of listenerPorts()) {
      const res = await post(listener, '/api/events', {
        body: JSON.stringify(validEvent),
        contentType: 'application/json',
      });
      expect(res.status, `listener ${listener}`).toBe(201);
    }
    expect(store.size).toBe(2);
  });

  it('really ingests /v1/logs on the OTLP listener with no header', async () => {
    const res = await post(otlpPort, '/v1/logs', {
      body: JSON.stringify(OTLP_LOGS_PAYLOAD),
      contentType: 'application/json',
    });
    expect(res.status).toBe(200);
    expect(store.size).toBe(1);
  });

  it('really persists /api/theme with no header', async () => {
    const themeFile = path.join(tmpHome, '.fabric', 'theme.json');
    const res = await post(port, '/api/theme', {
      body: JSON.stringify({ theme: 'light' }),
      contentType: 'application/json',
    });
    expect(res.status).toBe(200);
    expect(fs.existsSync(themeFile)).toBe(true);
  });

  it('still serves GET /api/health on both listeners', async () => {
    for (const listener of listenerPorts()) {
      const res = await fetch(`http://localhost:${listener}/api/health`);
      expect(res.status, `listener ${listener}`).toBe(200);
    }
  });
});
