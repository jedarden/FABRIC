import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createWebServer, WebServer } from './server.js';
import { InMemoryEventStore } from '../store.js';
import {
  validateNormalizedEventRequest,
  SUPPORTED_NORMALIZED_EVENT_TYPES,
} from './normalizedEventValidation.js';

const baseEvent = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'worker.started',
  timestamp: '2026-11-08T12:00:00.000Z',
  worker_id: 'worker-test',
  session_id: 'session-test',
  sequence: 1,
  data: {},
  ...overrides,
});

describe('normalized event request validation', () => {
  it('accepts the canonical envelope and returns one canonical event shape', () => {
    const result = validateNormalizedEventRequest(baseEvent({
      type: 'bead.completed',
      bead_id: 'bd-123',
      data: { duration_ms: 250 },
    }));

    expect(result).toEqual({
      ok: true,
      event: {
        timestamp: '2026-11-08T12:00:00.000Z',
        event_type: 'bead.completed',
        worker_id: 'worker-test',
        session_id: 'session-test',
        sequence: 1,
        bead_id: 'bd-123',
        data: { duration_ms: 250 },
      },
    });
  });

  it('accepts payload as an input alias while canonicalizing the result to data', () => {
    const result = validateNormalizedEventRequest({
      type: 'worker.started',
      payload: {
        timestamp: '2026-11-08T12:00:00Z',
        worker_id: 'worker-payload',
        session_id: 'session-payload',
        sequence: 0,
        version: '1.0.0',
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.event_type).toBe('worker.started');
      expect(result.event.worker_id).toBe('worker-payload');
      expect(result.event.data).toEqual({ version: '1.0.0' });
    }
  });

  it('rejects a missing type before attempting dispatch', () => {
    const result = validateNormalizedEventRequest(baseEvent({ type: undefined }));

    expect(result).toEqual({
      ok: false,
      error: { field: 'type', message: 'is required and must be a non-empty string' },
    });
  });

  it('rejects an unknown type', () => {
    const result = validateNormalizedEventRequest(baseEvent({ type: 'worker.not-a-real-event' }));

    expect(result).toEqual({
      ok: false,
      error: { field: 'type', message: 'unknown event type "worker.not-a-real-event"' },
    });
  });

  it.each([
    ['worker.stopped', {}, 'reason', 'is required'],
    ['bead.claimed', {}, 'bead_id', 'is required'],
    ['bead.claim.attempted', { bead_id: 'bd-1' }, 'attempt', 'is required'],
    ['bead.failed', { bead_id: 'bd-1' }, 'error', 'is required'],
    ['heartbeat.emitted', {}, 'status', 'is required'],
    ['outcome.classified', {}, 'outcome', 'is required'],
    ['verification.passed', {}, 'check', 'is required'],
  ])('requires the fields declared for %s', (type, data, field, message) => {
    const result = validateNormalizedEventRequest(baseEvent({ type, data }));

    expect(result).toEqual({ ok: false, error: { field, message } });
  });

  it.each([
    ['timestamp', 'not-a-timestamp'],
    ['worker_id', ''],
    ['session_id', 42],
    ['sequence', -1],
    ['data', []],
  ])('rejects invalid %s values', (field, value) => {
    const result = validateNormalizedEventRequest(baseEvent({ [field]: value }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe(field);
  });

  it('rejects invalid type-specific field values', () => {
    const result = validateNormalizedEventRequest(baseEvent({
      type: 'bead.completed',
      bead_id: 123,
      data: { duration_ms: -1 },
    }));

    expect(result).toEqual({
      ok: false,
      error: { field: 'bead_id', message: 'must be a non-empty string' },
    });
  });

  it('keeps the runtime support list explicit and non-empty', () => {
    expect(SUPPORTED_NORMALIZED_EVENT_TYPES.length).toBeGreaterThan(0);
    expect(new Set(SUPPORTED_NORMALIZED_EVENT_TYPES).size).toBe(SUPPORTED_NORMALIZED_EVENT_TYPES.length);
  });
});

describe('POST /event/normalized', () => {
  let server: WebServer;
  let store: InMemoryEventStore;
  let logPath: string;
  let port: number;

  beforeEach(async () => {
    logPath = path.join(process.cwd(), `.normalized-event-test-${process.pid}-${Date.now()}`);
    fs.mkdirSync(logPath, { recursive: true });
    store = new InMemoryEventStore();
    server = createWebServer({ port: 0, logPath, store });
    await server.start();
    port = server.getPort();
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.on('stop', () => resolve());
      server.stop();
    });
    fs.rmSync(logPath, { recursive: true, force: true });
  });

  const post = (body: string): Promise<Response> => fetch(`http://localhost:${port}/event/normalized`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  it('rejects malformed JSON deterministically without dispatching', async () => {
    const response = await post('{not-json');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Invalid JSON',
      message: 'Malformed JSON request body',
    });
    expect(store.size).toBe(0);
  });

  it('rejects missing and unknown types without dispatching', async () => {
    for (const event of [baseEvent({ type: undefined }), baseEvent({ type: 'unknown.event' })]) {
      const response = await post(JSON.stringify(event));
      expect(response.status).toBe(400);
      expect(store.size).toBe(0);
    }
  });

  it('dispatches only a validated event', async () => {
    const response = await post(JSON.stringify(baseEvent({
      type: 'bead.completed',
      bead_id: 'bd-dispatch',
      data: { duration_ms: 100 },
    })));

    expect(response.status).toBe(201);
    expect(store.size).toBe(1);
    const [event] = store.query();
    expect(event.msg).toBe('bead.completed');
    expect(event.bead).toBe('bd-dispatch');
  });

  it('does not dispatch a type-specific validation failure', async () => {
    const response = await post(JSON.stringify(baseEvent({
      type: 'bead.completed',
      data: { duration_ms: -1 },
    })));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'Invalid normalized event',
      field: 'bead_id',
    });
    expect(store.size).toBe(0);
  });
});

