import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createWebServer, WebServer } from './server.js';
import { InMemoryEventStore } from '../store.js';
import { LogEvent } from '../types.js';

vi.setConfig({ testTimeout: 30_000 });

describe('report and SSE API contracts', () => {
  let server: WebServer;
  let store: InMemoryEventStore;
  let port: number;
  let logPath: string;

  const event = (overrides: Partial<LogEvent> = {}): LogEvent => ({
    ts: Date.parse('2026-11-08T12:00:00.000Z'),
    worker: 'report-worker',
    level: 'info',
    msg: 'bead.completed',
    bead: 'bd-report',
    ...overrides,
  });

  beforeEach(async () => {
    logPath = path.join(process.cwd(), `.report-sse-test-${process.pid}-${Date.now()}`);
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
    store.clear();
    fs.rmSync(logPath, { recursive: true, force: true });
  });

  it('returns a deterministic JSON report and supports worker/time filters', async () => {
    store.add(event());
    store.add(event({ worker: 'other-worker', bead: 'bd-other' }));

    const response = await fetch(`http://localhost:${port}/api/report?workers=report-worker&startTime=1762603200000`);
    expect(response.status).toBe(200);
    const report = await response.json() as {
      stats: { totalEvents: number; totalWorkers: number };
      workers: Array<{ workerId: string }>;
    };

    expect(report.stats.totalEvents).toBe(1);
    expect(report.stats.totalWorkers).toBe(1);
    expect(report.workers.map(worker => worker.workerId)).toEqual(['report-worker']);
  });

  it('returns Markdown reports and rejects invalid report queries', async () => {
    store.add(event());

    const markdown = await fetch(`http://localhost:${port}/api/report?format=markdown`);
    expect(markdown.status).toBe(200);
    expect(markdown.headers.get('content-type')).toContain('text/markdown');
    expect(await markdown.text()).toContain('# Session Digest');

    const invalid = await fetch(`http://localhost:${port}/api/report?format=csv`);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: 'Invalid report query',
      message: 'format must be "json" or "markdown"',
    });
  });

  it('honors includeCost=false without changing the report response shape', async () => {
    store.add(event({ input_tokens: 1000, output_tokens: 500 }));

    const response = await fetch(`http://localhost:${port}/api/report?includeCost=false`);
    expect(response.status).toBe(200);
    const report = await response.json() as {
      cost: { totalTokens: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number };
    };

    expect(report.cost).toEqual({
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    });
  });

  it('returns byte-stable reports when the store has no events', async () => {
    const first = await fetch(`http://localhost:${port}/api/report`);
    const firstJson = await first.json();
    const firstMarkdown = await (await fetch(`http://localhost:${port}/api/report?format=markdown`)).text();

    const second = await fetch(`http://localhost:${port}/api/report`);
    const secondJson = await second.json();
    const secondMarkdown = await (await fetch(`http://localhost:${port}/api/report?format=markdown`)).text();

    expect(secondJson).toEqual(firstJson);
    expect(secondMarkdown).toBe(firstMarkdown);
  });

  it('sends an initial snapshot and a live event frame over SSE', async () => {
    store.add(event({ worker: 'initial-worker' }));

    const controller = new AbortController();
    const response = await fetch(`http://localhost:${port}/api/events/stream`, {
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-cache');

    const reader = response.body!.getReader();
    try {
      const initial = await readUntil(reader, 'event: init');
      expect(initial).toContain('"worker":"initial-worker"');

      const liveEvent = readUntil(reader, 'event: event');
      const posted = await fetch(`http://localhost:${port}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ts: '2026-11-08T12:01:00.000Z',
          event: 'worker.started',
          worker: 'live-worker',
        }),
      });
      expect(posted.status).toBe(201);

      const frame = await liveEvent;
      expect(frame).toContain('id: 1');
      expect(frame).toContain('"worker":"live-worker"');
      expect(frame).toContain('"msg":"worker.started"');
    } finally {
      await reader.cancel();
      controller.abort();
    }
  });

  it('does not run the mutating collision cleanup while opening an SSE stream', async () => {
    const getCollisions = vi.spyOn(store, 'getCollisions');
    const controller = new AbortController();
    const response = await fetch(`http://localhost:${port}/api/events/stream`, {
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    try {
      await readUntil(reader, 'event: init');
      expect(getCollisions).not.toHaveBeenCalled();
    } finally {
      await reader.cancel();
      controller.abort();
    }
  });

  it('applies worker and level filters to the initial and live SSE frames', async () => {
    store.add(event({ worker: 'match-worker', level: 'warn' }));
    store.add(event({ worker: 'other-worker', level: 'warn' }));

    const controller = new AbortController();
    const response = await fetch(`http://localhost:${port}/api/events/stream?worker=match-worker&level=warn`, {
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    try {
      const initial = await readUntil(reader, 'event: init');
      const snapshot = parseSseData(initial) as {
        recentEvents: Array<{ worker: string }>;
      };
      expect(snapshot.recentEvents.map(item => item.worker)).toEqual(['match-worker']);

      const liveEvent = readUntil(reader, 'event: event');
      const rejected = await fetch(`http://localhost:${port}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ts: '2026-11-08T12:02:00.000Z',
          event: 'worker.started',
          worker: 'other-worker',
          level: 'warn',
        }),
      });
      expect(rejected.status).toBe(201);

      const accepted = await fetch(`http://localhost:${port}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ts: '2026-11-08T12:03:00.000Z',
          event: 'worker.started',
          worker: 'match-worker',
          level: 'warn',
        }),
      });
      expect(accepted.status).toBe(201);

      const frame = await liveEvent;
      expect(frame).toContain('"worker":"match-worker"');
      expect(frame).not.toContain('"worker":"other-worker"');
    } finally {
      await reader.cancel();
      controller.abort();
    }
  });

  it('rejects invalid SSE query values before opening a stream', async () => {
    const invalidLevel = await fetch(`http://localhost:${port}/api/events/stream?level=trace`);
    expect(invalidLevel.status).toBe(400);
    expect(await invalidLevel.json()).toEqual({
      error: 'Invalid stream query',
      message: 'level must be one of debug, info, warn, or error',
    });

    const repeatedWorker = await fetch(`http://localhost:${port}/api/events/stream?worker=one&worker=two`);
    expect(repeatedWorker.status).toBe(400);
    expect(await repeatedWorker.json()).toEqual({
      error: 'Invalid stream query',
      message: 'worker must be a string',
    });
  });
});

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  marker: string,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes(marker)) {
    const result = await reader.read();
    if (result.done) return text;
    text += decoder.decode(result.value, { stream: true });
  }
  return text;
}

function parseSseData(frame: string): unknown {
  const line = frame.split('\n').find(candidate => candidate.startsWith('data: '));
  if (!line) throw new Error(`SSE frame has no data line: ${frame}`);
  return JSON.parse(line.slice('data: '.length));
}
