/**
 * Executable conformance suite for the native event API — docs/events-api.md.
 *
 * Each describe maps to a section of that document, and the assertions pin
 * the documented wire behavior exactly: payload shapes (NEEDLE JSONL, legacy
 * flat, canonical NeedleEvent), validation ordering, host defaults, batch
 * semantics, transport/content-type requirements, response bodies, and the
 * side-effect contract (a rejected request must ingest nothing and touch no
 * metric).
 *
 * Deliberately NOT re-pinned here (already owned by dedicated suites):
 *   - the per-route auth sweep across BOTH HTTP listeners and every
 *     discovered POST route  → server.authRoutes.test.ts
 *   - WebSocket broadcast delivery for both routes → server.test.ts
 *
 * Metrics are observed through the live /api/metrics exposition: each
 * recordEvent() call is what creates/increments a per-host
 * `fabric_event_count{host=…}` series, so a rejected request that "does not
 * mutate metrics" is pinned as "no series appears and the local series does
 * not move".
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createWebServer, WebServer } from './server.js';
import { InMemoryEventStore } from '../store.js';
import { resetCrossReferenceManager } from '../crossReferenceManager.js';
import { getLocalHostname } from '../hostname.js';

const AUTH_TOKEN = 'events-api-contract-token';

/** A minimal valid NEEDLE JSONL shape event (doc shape 1). */
const jsonlEvent = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  ts: '2026-09-26T12:00:00.000Z',
  event: 'worker.started',
  worker: 'contract-worker',
  ...overrides,
});

/** A minimal valid legacy flat shape event (doc shape 2). */
const flatEvent = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  ts: 1773035639517,
  event: 'flat.gate.pair',
  worker: 'contract-flat-worker',
  level: 'info',
  msg: 'Task complete',
  ...overrides,
});

/** A full canonical NeedleEvent body that also carries the ts/event gate pair (doc shape 3). */
const canonicalEvent = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  ts: '2026-09-26T12:00:00.000Z',
  event: 'jsonl.gate.pair',
  timestamp: '2026-09-26T13:00:01.000Z',
  event_type: 'bead.claimed',
  worker_id: 'contract-canonical-worker',
  session_id: 'sess-contract',
  sequence: 42,
  host: 'fleet-remote-1',
  bead_id: 'bd-9',
  data: { duration_ms: 1200 },
  ...overrides,
});

describe('native event API conformance (docs/events-api.md)', () => {
  let store: InMemoryEventStore;
  let server: WebServer;
  let port: number;
  let logDir: string;

  beforeEach(async () => {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-events-contract-'));
    store = new InMemoryEventStore();
    resetCrossReferenceManager();

    server = createWebServer({
      port: 0,
      logPath: logDir,
      store,
      authToken: AUTH_TOKEN,
    });
    await server.start();
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

  const post = (
    route: string,
    body: string,
    opts: { contentType?: string; token?: string } = {},
  ): Promise<Response> =>
    fetch(`http://localhost:${port}${route}`, {
      method: 'POST',
      headers: {
        ...(opts.contentType !== undefined ? { 'Content-Type': opts.contentType } : {}),
        ...(opts.token !== undefined ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body,
    });

  const postJson = (route: string, payload: unknown, token: string = AUTH_TOKEN): Promise<Response> =>
    post(route, JSON.stringify(payload), { contentType: 'application/json', token });

  const getJson = async (route: string): Promise<{ status: number; data: unknown }> => {
    const res = await fetch(`http://localhost:${port}${route}`);
    return { status: res.status, data: await res.json() };
  };

  /** Value of the per-host `fabric_event_count{host=…}` series, or null when absent. */
  const hostEventCount = async (host: string): Promise<string | null> => {
    const text = await (await fetch(`http://localhost:${port}/api/metrics`)).text();
    const match = text.match(new RegExp(`^fabric_event_count\\{host="${host}"\\} (\\d+)$`, 'm'));
    return match ? match[1] : null;
  };

  // ── Authentication ────────────────────────────────────────────

  describe('authentication (both routes, before body parse)', () => {
    const malformed = '{this-is-not-json';

    it('answers 401 with the documented body when the Authorization header is missing', async () => {
      for (const route of ['/api/events', '/api/events/batch']) {
        const res = await post(route, malformed, { contentType: 'application/json' });
        expect(res.status, route).toBe(401);
        expect(await res.json(), route).toEqual({
          error: 'Missing authorization',
          message: 'Authorization header required',
        });
      }
    });

    it('answers 403 with the documented body for a wrong token and for a non-Bearer scheme', async () => {
      for (const route of ['/api/events', '/api/events/batch']) {
        const wrong = await post(route, malformed, { contentType: 'application/json', token: 'wrong-token' });
        expect(wrong.status, route).toBe(403);
        expect(await wrong.json(), route).toEqual({
          error: 'Forbidden',
          message: 'Invalid or expired token',
        });

        const res = await fetch(`http://localhost:${port}${route}`, {
          method: 'POST',
          headers: { Authorization: `Basic ${AUTH_TOKEN}`, 'Content-Type': 'application/json' },
          body: malformed,
        });
        expect(res.status, route).toBe(403);
      }
    });

    it('rejects before the body is read: malformed JSON still answers 401/403, not a parse 400', async () => {
      for (const route of ['/api/events', '/api/events/batch']) {
        const noHeader = await post(route, malformed, { contentType: 'application/json' });
        expect(noHeader.status, route).toBe(401);
        const wrong = await post(route, malformed, { contentType: 'application/json', token: 'nope' });
        expect(wrong.status, route).toBe(403);
      }
      expect(store.size).toBe(0);
    });

    it('a rejected request ingests nothing and creates no per-host metric series', async () => {
      // The body would ingest under host fleet-remote-1 if it ever reached
      // the handler — its absence from the exposition is the proof.
      const body = JSON.stringify(canonicalEvent());
      for (const route of ['/api/events', '/api/events/batch']) {
        const noHeader = await post(route, body, { contentType: 'application/json' });
        expect(noHeader.status, route).toBe(401);
        const wrong = await post(route, body, { contentType: 'application/json', token: 'wrong' });
        expect(wrong.status, route).toBe(403);
      }
      expect(store.size).toBe(0);
      expect(await hostEventCount('fleet-remote-1')).toBeNull();
      expect(await hostEventCount(getLocalHostname())).toBe('0');
    });
  });

  // ── Transport limits and content type ─────────────────────────

  describe('transport limits and content type (both routes)', () => {
    it('rejects an over-cap single-event body with 413 and ingests nothing', async () => {
      const overCap = JSON.stringify({ ...jsonlEvent(), pad: 'x'.repeat(80 * 1024) });
      const res = await post('/api/events', overCap, { contentType: 'application/json', token: AUTH_TOKEN });
      expect(res.status).toBe(413);
      expect(store.size).toBe(0);
    });

    it('rejects an over-cap batch body with 413 and ingests nothing', async () => {
      const overCap = JSON.stringify([
        { ...jsonlEvent(), pad: 'x'.repeat(80 * 1024) },
      ]);
      const res = await post('/api/events/batch', overCap, { contentType: 'application/json', token: AUTH_TOKEN });
      expect(res.status).toBe(413);
      expect(store.size).toBe(0);
    });

    it('still accepts a just-under-cap body', async () => {
      const underCap = JSON.stringify({ ...jsonlEvent({ event: 'contract.under-cap' }), pad: 'x'.repeat(60 * 1024) });
      const res = await post('/api/events', underCap, { contentType: 'application/json', token: AUTH_TOKEN });
      expect(res.status).toBe(201);
      expect(store.size).toBe(1);
    });

    it('rejects malformed JSON with 400 on both routes before the handler runs', async () => {
      for (const route of ['/api/events', '/api/events/batch']) {
        const res = await post(route, '{not-json', { contentType: 'application/json', token: AUTH_TOKEN });
        expect(res.status, route).toBe(400);
      }
      expect(store.size).toBe(0);
    });

    it('answers the handler-level "Expected JSON object" 400 when no JSON body was parsed (single route)', async () => {
      // Missing Content-Type and an unparseable content type both leave
      // req.body undefined — the handler's own guard answers.
      for (const contentType of [undefined, 'text/plain']) {
        const res = await post('/api/events', '{}', { contentType, token: AUTH_TOKEN });
        expect(res.status, String(contentType)).toBe(400);
        expect(await res.json(), String(contentType)).toEqual({
          error: 'Invalid request body',
          message: 'Expected JSON object',
        });
      }
      expect(store.size).toBe(0);
    });

    it('answers the handler-level "Expected JSON array" 400 when no JSON body was parsed (batch route)', async () => {
      const res = await post('/api/events/batch', '[]', { token: AUTH_TOKEN });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Invalid request body',
        message: 'Expected JSON array of events',
      });
      expect(store.size).toBe(0);
    });

    it('answers 400 (body-parser) for JSON null and bare primitives on both routes', async () => {
      // Strict-mode express.json rejects these as malformed before any
      // handler guard runs — status 400 either way (docs "Error-response
      // summary": malformed JSON → 400 from body-parser).
      for (const route of ['/api/events', '/api/events/batch']) {
        for (const body of ['null', '5']) {
          const res = await post(route, body, { contentType: 'application/json', token: AUTH_TOKEN });
          expect(res.status, `${route} ${body}`).toBe(400);
        }
      }
      expect(store.size).toBe(0);
    });
  });

  // ── POST /api/events — payload shapes ─────────────────────────

  describe('single route: NEEDLE JSONL shape (doc shape 1)', () => {
    it('normalizes a string-worker entry and answers the documented 201 envelope', async () => {
      const res = await postJson('/api/events', jsonlEvent({
        session: 'needle-contract',
      }));
      expect(res.status).toBe(201);
      const data = await res.json() as { success: boolean; event: Record<string, unknown> };
      expect(data.success).toBe(true);
      expect(data.event).toMatchObject({
        ts: Date.parse('2026-09-26T12:00:00.000Z'),
        worker: 'contract-worker',
        msg: 'worker.started',
        level: 'info',
        session: 'needle-contract',
        host: getLocalHostname(),
      });
      // JSONL/flat entries carry no sequence — it is canonical-only.
      expect(data.event.sequence).toBeUndefined();
    });

    it('composes an object worker into runner-provider-model-identifier and lifts provider/model', async () => {
      const res = await postJson('/api/events', jsonlEvent({
        worker: { runner: 'claude-code', provider: 'glm', model: '5.3', identifier: 'alpha' },
      }));
      expect(res.status).toBe(201);
      const data = await res.json() as { event: Record<string, unknown> };
      expect(data.event.worker).toBe('claude-code-glm-5.3-alpha');
      expect(data.event.provider).toBe('glm');
      expect(data.event.model).toBe('5.3');
    });

    it('promotes data.bead_id to the event bead', async () => {
      const res = await postJson('/api/events', jsonlEvent({
        data: { bead_id: 'bd-123', workspace: '/home/coder/NEEDLE' },
      }));
      expect(res.status).toBe(201);
      const data = await res.json() as { event: Record<string, unknown> };
      expect(data.event.bead).toBe('bd-123');
      expect(data.event.bead_id).toBeUndefined();
    });

    it('defaults host to the collector hostname for JSONL and flat shapes; only canonical carries an explicit host', async () => {
      const res = await postJson('/api/events', flatEvent());
      expect(res.status).toBe(201);
      const data = await res.json() as { event: Record<string, unknown> };
      expect(data.event.host).toBe(getLocalHostname());
      expect(data.event.host).not.toBe('fleet-remote-1');
    });
  });

  describe('single route: legacy flat shape (doc shape 2)', () => {
    it('normalizes an epoch-ms entry: ts round-trips, msg becomes the event type, level is honored', async () => {
      const res = await postJson('/api/events', flatEvent({ level: 'warn' }));
      expect(res.status).toBe(201);
      const data = await res.json() as { event: Record<string, unknown> };
      expect(data.event).toMatchObject({
        ts: 1773035639517,
        worker: 'contract-flat-worker',
        msg: 'Task complete',
        level: 'warn',
        host: getLocalHostname(),
      });
    });

    it('carries non-standard top-level fields through as event data', async () => {
      const res = await postJson('/api/events', flatEvent({ custom_field: 'custom-value' }));
      expect(res.status).toBe(201);
      const data = await res.json() as { event: Record<string, unknown> };
      expect(data.event.custom_field).toBe('custom-value');
    });

    it('rejects an invalid level in the flat shape with "Failed to parse event object"', async () => {
      const res = await postJson('/api/events', flatEvent({ level: 'verbose' }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Invalid event format',
        message: 'Failed to parse event object',
      });
      expect(store.size).toBe(0);
    });
  });

  // ── POST /api/events — level derivation ───────────────────────

  describe('single route: level derivation (doc "Success response")', () => {
    /** Post one event and return the level on the normalized event. */
    const levelOf = async (body: Record<string, unknown>): Promise<unknown> => {
      const res = await postJson('/api/events', body);
      expect(res.status).toBe(201);
      const data = await res.json() as { event: Record<string, unknown> };
      return data.event.level;
    };

    it('infers the level from the event name when none is given: error.* / *.failed / *.retry / debug.* / else', async () => {
      expect(await levelOf(jsonlEvent({ event: 'error.boot.crashed' }))).toBe('error');
      expect(await levelOf(jsonlEvent({ event: 'bead.claim.failed' }))).toBe('warn');
      expect(await levelOf(jsonlEvent({ event: 'tool.invoke.retry' }))).toBe('warn');
      expect(await levelOf(jsonlEvent({ event: 'debug.trace.dump' }))).toBe('debug');
      expect(await levelOf(jsonlEvent({ event: 'worker.started' }))).toBe('info');
    });

    it('a valid explicit level overrides the event-name inference', async () => {
      expect(await levelOf(jsonlEvent({ event: 'error.boot.crashed', level: 'info' }))).toBe('info');
    });

    it('an invalid level in the JSONL shape is not fatal — inference applies instead (the flat shape 400s on the same input)', async () => {
      expect(await levelOf(jsonlEvent({ level: 'verbose' }))).toBe('info');
      expect(await levelOf(jsonlEvent({ event: 'error.boot.crashed', level: 'verbose' }))).toBe('error');
    });
  });

  // ── POST /api/events — timestamp shapes ───────────────────────

  describe('single route: timestamp shapes (doc payload table: RFC3339 string or epoch-ms number)', () => {
    it('normalizes an RFC3339 ts with a non-UTC offset to the equivalent epoch ms', async () => {
      // 14:00+02:00 is 12:00Z — the offset must be honored, not dropped.
      const res = await postJson('/api/events', jsonlEvent({ ts: '2026-09-26T14:00:00+02:00' }));
      expect(res.status).toBe(201);
      const data = await res.json() as { event: Record<string, unknown> };
      expect(data.event.ts).toBe(Date.parse('2026-09-26T12:00:00.000Z'));
    });

    it('reads a numeric ts as epoch milliseconds — no seconds heuristic', async () => {
      // 1773035639 as epoch *seconds* would be 2026; the doc pins the unit as ms.
      const res = await postJson('/api/events', flatEvent({ ts: 1773035639 }));
      expect(res.status).toBe(201);
      const data = await res.json() as { event: Record<string, unknown> };
      expect(data.event.ts).toBe(1773035639);
    });
  });

  // ── POST /api/events — worker/session normalization details ───

  describe('single route: worker and session normalization details (doc shape 1)', () => {
    it('omits session from the normalized event when the body carries none', async () => {
      const res = await postJson('/api/events', jsonlEvent());
      expect(res.status).toBe(201);
      const data = await res.json() as { event: Record<string, unknown> };
      expect(data.event.session).toBeUndefined();
    });

    it('composes every worker-object component into the id, in runner-provider-model-identifier order', async () => {
      const res = await postJson('/api/events', jsonlEvent({
        worker: { runner: 'codex', provider: 'openai', model: 'gpt-5o', identifier: 'zulu' },
      }));
      expect(res.status).toBe(201);
      const data = await res.json() as { event: Record<string, unknown> };
      expect(data.event.worker).toBe('codex-openai-gpt-5o-zulu');
    });
  });

  // ── POST /api/events — bead promotion and recognized fields ───

  describe('single route: bead promotion and recognized fields across shapes', () => {
    it('shape 1 promotes data.bead_id and keeps the remaining data keys alongside it', async () => {
      const res = await postJson('/api/events', jsonlEvent({
        data: { bead_id: 'bd-123', workspace: '/home/coder/NEEDLE' },
      }));
      expect(res.status).toBe(201);
      const data = await res.json() as { event: Record<string, unknown> };
      expect(data.event.bead).toBe('bd-123');
      expect(data.event.bead_id).toBeUndefined();
      expect(data.event.workspace).toBe('/home/coder/NEEDLE');
    });

    it('shape 2 promotes a top-level string bead, and the recognized tool/path fields surface as named event fields', async () => {
      const res = await postJson('/api/events', flatEvent({
        bead: 'bd-55',
        tool: 'Edit',
        path: 'src/auth/login.ts',
      }));
      expect(res.status).toBe(201);
      const data = await res.json() as { event: Record<string, unknown> };
      expect(data.event.bead).toBe('bd-55');
      expect(data.event.tool).toBe('Edit');
      expect(data.event.path).toBe('src/auth/login.ts');
    });

    it('shape 2 lifts duration_ms and error onto their named event fields', async () => {
      const res = await postJson('/api/events', flatEvent({ duration_ms: 5000, error: 'boom' }));
      expect(res.status).toBe(201);
      const data = await res.json() as { event: Record<string, unknown> };
      expect(data.event.duration_ms).toBe(5000);
      expect(data.event.error).toBe('boom');
    });
  });

  describe('single route: canonical NeedleEvent (doc shape 3)', () => {
    it('rejects a canonical-only body (no ts/event gate pair) at the pre-check', async () => {
      const { ts: _ts, event: _event, ...canonicalOnly } = canonicalEvent();
      const res = await postJson('/api/events', canonicalOnly);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Missing required field',
        message: 'Field "ts" is required',
      });
      expect(store.size).toBe(0);
    });

    it('parses a body carrying both the gate pair and canonical fields as canonical — canonical fields win', async () => {
      const res = await postJson('/api/events', canonicalEvent());
      expect(res.status).toBe(201);
      const data = await res.json() as { event: Record<string, unknown> };
      expect(data.event).toMatchObject({
        // canonical timestamp/event_type/host/sequence win over the ignored gate pair
        ts: Date.parse('2026-09-26T13:00:01.000Z'),
        msg: 'bead.claimed',
        host: 'fleet-remote-1',
        sequence: 42,
        bead: 'bd-9',
        session: 'sess-contract',
        duration_ms: 1200,
      });
      // The gate pair is ignored, not merged.
      expect(data.event.worker).toBe('contract-canonical-worker');
    });

    it('attributes an explicit canonical host in the per-host metric series', async () => {
      expect(await hostEventCount('fleet-remote-1')).toBeNull();
      const res = await postJson('/api/events', canonicalEvent());
      expect(res.status).toBe(201);
      expect(await hostEventCount('fleet-remote-1')).toBe('1');
    });

    it('answers 500 for a canonical body with a schema_version other than 1, ingesting nothing', async () => {
      const res = await postJson('/api/events', canonicalEvent({ schema_version: 2 }));
      expect(res.status).toBe(500);
      const data = await res.json() as { error: string; message: string };
      expect(data.error).toBe('Internal server error');
      expect(data.message).toContain('schema mismatch');
      expect(store.size).toBe(0);
      expect(await hostEventCount('fleet-remote-1')).toBeNull();
    });

    it('accepts an explicit schema_version of 1', async () => {
      const res = await postJson('/api/events', canonicalEvent({ schema_version: 1 }));
      expect(res.status).toBe(201);
      expect(store.size).toBe(1);
    });
  });

  describe('single route: canonical required fields and bead/host sources', () => {
    it('requires every canonical field: a missing sequence falls through every shape to "Failed to parse"', async () => {
      const { sequence: _sequence, ...noSequence } = canonicalEvent();
      const res = await postJson('/api/events', noSequence);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Invalid event format',
        message: 'Failed to parse event object',
      });
      expect(store.size).toBe(0);
    });

    it('requires session_id too: the gate pair alone does not make a body parseable', async () => {
      const { session_id: _session, ...noSession } = canonicalEvent();
      const res = await postJson('/api/events', noSession);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Invalid event format',
        message: 'Failed to parse event object',
      });
      expect(store.size).toBe(0);
    });

    it('does not promote data.bead_id in the canonical shape — bead comes from the top-level bead_id only', async () => {
      const { bead_id: _bead, ...dataBeadOnly } = canonicalEvent({ data: { bead_id: 'bd-777' } });
      const res = await postJson('/api/events', dataBeadOnly);
      expect(res.status).toBe(201);
      const data = await res.json() as { event: Record<string, unknown> };
      expect(data.event.bead).toBeUndefined();
      // …and the event still attributes to its explicit canonical host.
      expect(await hostEventCount('fleet-remote-1')).toBe('1');
    });

    it('a canonical body without an explicit host stores no host and lands on the local-host metric series', async () => {
      const { host: _host, ...noHost } = canonicalEvent();
      const res = await postJson('/api/events', noHost);
      expect(res.status).toBe(201);
      const data = await res.json() as { event: Record<string, unknown> };
      expect(data.event.host).toBeUndefined();
      expect(await hostEventCount('fleet-remote-1')).toBeNull();
      expect(await hostEventCount(getLocalHostname())).toBe('1');
    });
  });

  // ── POST /api/events — validation ordering ────────────────────

  describe('single route: validation ordering and error responses', () => {
    it('checks object-ness, then ts, then event, then shape — first failure answers', async () => {
      // 1. object-ness (a body the parser left undefined — see the transport
      //    section for the content-type cases; asserted exactly there).
      // 2. ts before event: a body missing BOTH answers "ts".
      const noFields = await postJson('/api/events', { worker: 'w' });
      expect(noFields.status).toBe(400);
      expect(await noFields.json()).toEqual({
        error: 'Missing required field',
        message: 'Field "ts" is required',
      });

      // An array body parses as an object but fails the same ts check.
      const arrayBody = await postJson('/api/events', ['not', 'an', 'object']);
      expect(arrayBody.status).toBe(400);
      expect(await arrayBody.json()).toEqual({
        error: 'Missing required field',
        message: 'Field "ts" is required',
      });

      // 3. event after ts.
      const noEvent = await postJson('/api/events', { ts: '2026-09-26T12:00:00.000Z' });
      expect(noEvent.status).toBe(400);
      expect(await noEvent.json()).toEqual({
        error: 'Missing required field',
        message: 'Field "event" is required',
      });

      // 4. shape parse last: numeric ts + object worker matches no wire shape.
      const badShape = await postJson('/api/events', {
        ts: 1773035639517,
        event: 'contract.bad',
        worker: { runner: 'r', provider: 'p', model: 'm', identifier: 'i' },
      });
      expect(badShape.status).toBe(400);
      expect(await badShape.json()).toEqual({
        error: 'Invalid event format',
        message: 'Failed to parse event object',
      });

      expect(store.size).toBe(0);
    });

    it('treats falsy ts and event as missing (the required checks are truthy checks)', async () => {
      for (const body of [
        { ts: 0, event: 'contract.falsy' },
        { ts: '', event: 'contract.falsy' },
        { ts: '2026-09-26T12:00:00.000Z', event: '' },
      ]) {
        const res = await postJson('/api/events', body);
        expect(res.status, JSON.stringify(body)).toBe(400);
        const data = await res.json() as { error: string; message: string };
        expect(data.error).toBe('Missing required field');
        expect(data.message).toMatch(/Field "(ts|event)" is required/);
      }
      expect(store.size).toBe(0);
    });
  });

  // ── POST /api/events — side effects of an accepted event ──────

  describe('single route: side effects (201 only)', () => {
    it('stores an accepted event (readable back) and counts it in the per-host series', async () => {
      expect(await hostEventCount(getLocalHostname())).toBe('0');
      const res = await postJson('/api/events', jsonlEvent());
      expect(res.status).toBe(201);
      expect(store.size).toBe(1);

      const readback = await getJson('/api/events');
      expect(readback.status).toBe(200);
      const events = readback.data as Array<Record<string, unknown>>;
      expect(events.some((e) => e.worker === 'contract-worker' && e.msg === 'worker.started')).toBe(true);
      expect(await hostEventCount(getLocalHostname())).toBe('1');
    });

    it('never deduplicates: the same event posted twice is stored twice', async () => {
      const body = jsonlEvent();
      expect((await postJson('/api/events', body)).status).toBe(201);
      expect((await postJson('/api/events', body)).status).toBe(201);
      expect(store.size).toBe(2);
      expect(await hostEventCount(getLocalHostname())).toBe('2');
    });
  });

  describe('store side effects: worker materialization (doc "Side effects (201 only)")', () => {
    it('an accepted event materializes its worker, readable back via /api/workers', async () => {
      const before = await getJson('/api/workers');
      expect(before.status).toBe(200);
      expect(before.data).toEqual([]);

      const res = await postJson('/api/events', jsonlEvent({ worker: 'contract-materialize' }));
      expect(res.status).toBe(201);

      const all = await getJson('/api/workers');
      expect(all.status).toBe(200);
      const workers = all.data as Array<Record<string, unknown>>;
      const mine = workers.find((w) => w.id === 'contract-materialize');
      expect(mine).toBeDefined();
      expect(mine).toMatchObject({ status: 'active', eventCount: 1 });
    });

    it('an event carrying a bead materializes the worker with that bead active, at its own host', async () => {
      const res = await postJson('/api/events', jsonlEvent({
        worker: 'contract-bead-worker',
        data: { bead_id: 'bd-materialize' },
      }));
      expect(res.status).toBe(201);

      const detail = await getJson('/api/workers/contract-bead-worker');
      expect(detail.status).toBe(200);
      expect(detail.data).toMatchObject({
        id: 'contract-bead-worker',
        activeBead: 'bd-materialize',
        host: getLocalHostname(),
      });
    });
  });

  // ── POST /api/events/batch ────────────────────────────────────

  describe('batch route: batch-level validation', () => {
    it('rejects a non-array body with the documented 400 and ingests nothing', async () => {
      const res = await postJson('/api/events/batch', { ts: '2026-09-26T12:00:00.000Z', event: 'x' });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Invalid request body',
        message: 'Expected JSON array of events',
      });
      expect(store.size).toBe(0);
      expect(await hostEventCount(getLocalHostname())).toBe('0');
    });

    it('rejects an empty batch with the documented 400', async () => {
      const res = await postJson('/api/events/batch', []);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Empty batch',
        message: 'Batch must contain at least one event',
      });
      expect(store.size).toBe(0);
    });

    it('rejects a batch over MAX_BATCH_SIZE (100) with the documented 400 and received count', async () => {
      const events = Array.from({ length: 101 }, () => jsonlEvent());
      const res = await postJson('/api/events/batch', events);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Batch too large',
        message: 'Batch exceeds maximum size of 100 events (received 101)',
      });
      expect(store.size).toBe(0);
      expect(await hostEventCount(getLocalHostname())).toBe('0');
    });

    it('accepts a batch of exactly 100 events', async () => {
      const events = Array.from({ length: 100 }, () => jsonlEvent());
      const res = await postJson('/api/events/batch', events);
      expect(res.status).toBe(201);
      const data = await res.json() as { ingested: number; total: number };
      expect(data.ingested).toBe(100);
      expect(data.total).toBe(100);
      expect(store.size).toBe(100);
    });
  });

  describe('batch route: partial success semantics', () => {
    it('ingests valid events and collects per-event rejections with 0-based indices and documented strings', async () => {
      const events = [
        jsonlEvent({ event: 'contract.batch.valid.1' }),                    // 0: ok
        { ts: '2026-09-26T12:00:01.000Z' },                                 // 1: missing event
        { event: 'contract.batch.missing.ts' },                             // 2: missing ts
        null,                                                               // 3: not an object
        {                                                                   // 4: matches no shape
          ts: 1773035639517,
          event: 'contract.batch.bad',
          worker: { runner: 'r', provider: 'p', model: 'm', identifier: 'i' },
        },
        jsonlEvent({ event: 'contract.batch.valid.2' }),                    // 5: ok
      ];
      const res = await postJson('/api/events/batch', events);
      expect(res.status).toBe(201);
      const data = await res.json() as {
        success: boolean; ingested: number; total: number;
        errors: Array<{ index: number; error: string }>;
      };
      expect(data.success).toBe(true);
      expect(data.ingested).toBe(2);
      expect(data.total).toBe(6);
      expect(data.errors).toEqual([
        { index: 1, error: 'Missing required field "event"' },
        { index: 2, error: 'Missing required field "ts"' },
        { index: 3, error: 'Invalid event object' },
        { index: 4, error: 'Failed to parse event object' },
      ]);
      // Only the valid events landed.
      expect(store.size).toBe(2);
      expect(await hostEventCount(getLocalHostname())).toBe('2');
    });

    it('answers 201 with ingested 0 for a batch whose every event failed', async () => {
      const res = await postJson('/api/events/batch', [{ event: 'no-ts' }, { ts: '2026-09-26T12:00:00.000Z' }]);
      expect(res.status).toBe(201);
      const data = await res.json() as { ingested: number; total: number; errors: unknown[] };
      expect(data.ingested).toBe(0);
      expect(data.total).toBe(2);
      expect(data.errors).toHaveLength(2);
      expect(store.size).toBe(0);
    });

    it('omits the errors key entirely when every event was accepted', async () => {
      const res = await postJson('/api/events/batch', [jsonlEvent(), flatEvent()]);
      expect(res.status).toBe(201);
      const data = await res.json() as { ingested: number; total: number; errors?: unknown };
      expect(data.ingested).toBe(2);
      expect(data.total).toBe(2);
      expect('errors' in data).toBe(false);
      expect(store.size).toBe(2);
    });
  });

  describe('batch route: mixed-host attribution and a fatal error mid-batch', () => {
    it('attributes each ingested event to its own host series: canonical explicit host vs local default', async () => {
      expect(await hostEventCount('fleet-remote-2')).toBeNull();
      const res = await postJson('/api/events/batch', [
        canonicalEvent({ host: 'fleet-remote-2' }),
        jsonlEvent(),
      ]);
      expect(res.status).toBe(201);
      const data = await res.json() as { ingested: number; total: number };
      expect(data.ingested).toBe(2);
      expect(await hostEventCount('fleet-remote-2')).toBe('1');
      expect(await hostEventCount(getLocalHostname())).toBe('1');
      expect(store.size).toBe(2);
    });

    it('a schema-mismatch canonical event answers 500 for the whole batch, yet events before it were already stored', async () => {
      const res = await postJson('/api/events/batch', [
        jsonlEvent({ event: 'contract.batch.before-fatal' }),
        canonicalEvent({ schema_version: 2 }),
        jsonlEvent({ event: 'contract.batch.after-fatal' }),
      ]);
      expect(res.status).toBe(500);
      const data = await res.json() as { error: string; message: string };
      expect(data.error).toBe('Internal server error');
      expect(data.message).toContain('schema mismatch');
      // Ingestion happens per event inside the loop: index 0 landed before the throw.
      expect(store.size).toBe(1);
      expect(await hostEventCount(getLocalHostname())).toBe('1');
    });
  });

  // ── Content type variants and empty bodies ────────────────────

  describe('content type variants and empty bodies (both routes)', () => {
    it('accepts the charset-annotated JSON content type', async () => {
      const res = await post('/api/events', JSON.stringify(jsonlEvent()), {
        contentType: 'application/json; charset=utf-8',
        token: AUTH_TOKEN,
      });
      expect(res.status).toBe(201);
      expect(store.size).toBe(1);
    });

    it('an empty body with the JSON content type parses to an empty object and fails the ts check (single route)', async () => {
      const res = await post('/api/events', '', { contentType: 'application/json', token: AUTH_TOKEN });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Missing required field',
        message: 'Field "ts" is required',
      });
      expect(store.size).toBe(0);
    });

    it('an empty body with the JSON content type fails the array pre-check (batch route)', async () => {
      const res = await post('/api/events/batch', '', { contentType: 'application/json', token: AUTH_TOKEN });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Invalid request body',
        message: 'Expected JSON array of events',
      });
      expect(store.size).toBe(0);
    });
  });

  // ── Append-only by design ─────────────────────────────────────

  describe('append-only: DELETE answers 405 under /api/events', () => {
    it('rejects DELETE /api/events and DELETE /api/events/batch with the documented 405', async () => {
      for (const route of ['/api/events', '/api/events/batch']) {
        const res = await fetch(`http://localhost:${port}${route}`, { method: 'DELETE' });
        expect(res.status, route).toBe(405);
        expect(await res.json(), route).toEqual({ error: 'Event deletion is not supported' });
      }
      expect(store.size).toBe(0);
    });
  });

  // ── Reading events back ───────────────────────────────────────

  describe('reading events back: GET /api/events', () => {
    beforeEach(async () => {
      // Seed three distinct events, oldest first.
      const seed = [
        jsonlEvent({ ts: '2026-09-26T11:00:00.000Z', event: 'contract.read.1', worker: 'read-alpha' }),
        flatEvent({ ts: 1773032400000, event: 'flat.pair', worker: 'read-bravo', level: 'error', msg: 'contract.read.2' }),
        jsonlEvent({ ts: '2026-09-26T13:00:00.000Z', event: 'contract.read.3', worker: 'read-alpha' }),
      ];
      const res = await postJson('/api/events/batch', seed);
      expect(res.status).toBe(201);
      expect(store.size).toBe(3);
    });

    it('returns events oldest first', async () => {
      const { status, data } = await getJson('/api/events');
      expect(status).toBe(200);
      const events = data as Array<Record<string, unknown>>;
      expect(events.map((e) => e.msg)).toEqual(['contract.read.1', 'contract.read.2', 'contract.read.3']);
    });

    it('limits to the tail of the matching set (most recent N, oldest first within)', async () => {
      const { data } = await getJson('/api/events?limit=1');
      const events = data as Array<Record<string, unknown>>;
      expect(events).toHaveLength(1);
      expect(events[0].msg).toBe('contract.read.3');
    });

    it('filters by worker and by level', async () => {
      const byWorker = await getJson('/api/events?worker=read-bravo');
      expect((byWorker.data as Array<Record<string, unknown>>).map((e) => e.worker)).toEqual(['read-bravo']);

      const byLevel = await getJson('/api/events?level=error');
      const leveled = byLevel.data as Array<Record<string, unknown>>;
      expect(leveled).toHaveLength(1);
      expect(leveled[0].msg).toBe('contract.read.2');
      expect(leveled[0].level).toBe('error');
    });
  });
});
