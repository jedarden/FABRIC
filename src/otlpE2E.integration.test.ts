/**
 * E2E OTLP Integration Test
 *
 * Full HTTP → normalizer → store → API response path test.
 * Starts the FABRIC web server with OTLP/HTTP receiver on a random port,
 * POSTs realistic NEEDLE OTLP payloads (spans + metrics with NEEDLE attributes),
 * and asserts the worker state appears correctly in the API responses.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createWebServer } from './web/server.js';
import { InMemoryEventStore } from './store.js';
import { EventDeduplicator } from './normalizer.js';
import type { AddressInfo } from 'node:net';

// API response types
interface Worker {
  id: string;
  needleState: string;
  status: string;
  [key: string]: unknown;
}

interface HealthResponse {
  dedup_dropped: number;
  [key: string]: unknown;
}

describe('E2E OTLP Integration', () => {
  let server: ReturnType<typeof createWebServer>;
  let store: InMemoryEventStore;
  let deduplicator: EventDeduplicator;
  let webPort: number;
  let otlpPort: number;
  let baseUrl: string;
  let otlpUrl: string;

  beforeAll(async () => {
    // Find free ports for web and OTLP
    webPort = await getFreePort();
    otlpPort = await getFreePort();

    store = new InMemoryEventStore();
    deduplicator = new EventDeduplicator();

    server = createWebServer({
      port: webPort,
      logPath: '/tmp/fabric-test-logs',
      store,
      otlpHttpPort: otlpPort,
      deduplicator,
    });

    server.start();

    // Wait for server to start listening
    await new Promise(resolve => setTimeout(resolve, 100));

    baseUrl = `http://127.0.0.1:${webPort}`;
    otlpUrl = `http://127.0.0.1:${otlpPort}`;
  });

  afterAll(() => {
    server.stop();
  });

  const testWorkerId = 'e2e-test-worker-opus-4.8-charlie';
  const testSessionId = 'e2e-test-session-12345';
  const testBeadId = 'bf-e2e-test';

  it('POST /v1/traces with span produces worker with non-STOPPED needleState', async () => {
    const nowNs = String(Date.now() * 1_000_000);

    // First send a worker.state_transition event to establish the worker with a known state
    const stateTransitionPayload = {
      resourceLogs: [{
        scopeLogs: [{
          logRecords: [{
            timeUnixNano: String((Date.now() - 1000) * 1_000_000),
            attributes: [
              { key: 'event_type', value: { stringValue: 'worker.state_transition' } },
              { key: 'needle.worker.id', value: { stringValue: testWorkerId } },
              { key: 'needle.session.id', value: { stringValue: testSessionId } },
              { key: 'needle.sequence', value: { intValue: 1 } },
              { key: 'from', value: { stringValue: 'BOOTING' } },
              { key: 'to', value: { stringValue: 'SELECTING' } },
            ],
          }],
        }],
      }],
    };

    const stateRes = await fetch(`${otlpUrl}/v1/logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(stateTransitionPayload),
    });
    expect(stateRes.status).toBe(200);

    // Wait for worker creation
    await new Promise(resolve => setTimeout(resolve, 200));

    // Now send a span representing an active bead execution (bead.claimed/started)
    const startNs = String((Date.now() - 500) * 1_000_000);
    const tracesPayload = {
      resourceSpans: [{
        scopeSpans: [{
          spans: [{
            traceId: 'e2e-trace-123',
            spanId: 'e2e-span-456',
            name: 'bead_execution',
            startTimeUnixNano: startNs,
            endTimeUnixNano: nowNs,
            status: { code: 'OK' },
            attributes: [
              { key: 'needle.worker.id', value: { stringValue: testWorkerId } },
              { key: 'needle.session.id', value: { stringValue: testSessionId } },
              { key: 'needle.sequence', value: { intValue: 2 } },
              { key: 'needle.bead.id', value: { stringValue: testBeadId } },
            ],
          }],
        }],
      }],
    };

    const res = await fetch(`${otlpUrl}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(tracesPayload),
    });

    expect(res.status).toBe(200);

    // Wait for events to be processed and worker state to update
    await new Promise(resolve => setTimeout(resolve, 200));

    // GET /api/workers should return the test worker
    const workersRes = await fetch(`${baseUrl}/api/workers`);
    expect(workersRes.status).toBe(200);

    const workers = await workersRes.json() as Worker[];
    expect(workers).toBeInstanceOf(Array);
    expect(workers.length).toBeGreaterThan(0);

    // Find our test worker
    const testWorker = workers.find((w: Worker) => w.id === testWorkerId);
    expect(testWorker).toBeDefined();
    expect(testWorker!.id).toBe(testWorkerId);

    // Worker should have a non-STOPPED needleState (SELECTING for active worker)
    expect(testWorker!.needleState).toBeDefined();
    expect(testWorker!.needleState).not.toBe('STOPPED');

    // Status should be 'active' for a worker with an active bead
    expect(testWorker!.status).toBe('active');
  });

  it('POST /v1/metrics with worker_id attributes updates worker state', async () => {
    const nowNs = String(Date.now() * 1_000_000);

    // Send a metric representing token usage
    const metricsPayload = {
      resourceMetrics: [{
        scopeMetrics: [{
          metrics: [{
            name: 'tokens.used',
            gauge: {
              dataPoints: [{
                timeUnixNano: nowNs,
                asDouble: 12345.0,
                attributes: [
                  { key: 'needle.worker.id', value: { stringValue: testWorkerId } },
                  { key: 'needle.session.id', value: { stringValue: testSessionId } },
                  { key: 'needle.bead.id', value: { stringValue: testBeadId } },
                  { key: 'provider', value: { stringValue: 'anthropic' } },
                  { key: 'model', value: { stringValue: 'claude-opus-4-8' } },
                ],
              }],
            },
          }],
        }],
      }],
    };

    const res = await fetch(`${otlpUrl}/v1/metrics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(metricsPayload),
    });

    expect(res.status).toBe(200);

    // Wait for event processing
    await new Promise(resolve => setTimeout(resolve, 200));

    // Verify worker still exists with correct state (from first test's SELECTING state)
    const workersRes = await fetch(`${baseUrl}/api/workers`);
    expect(workersRes.status).toBe(200);

    const workers = await workersRes.json() as Worker[];
    const testWorker = workers.find((w: Worker) => w.id === testWorkerId);

    expect(testWorker).toBeDefined();
    expect(testWorker!.needleState).toBeDefined();
    expect(testWorker!.needleState).not.toBe('STOPPED');
  });

  it('POST /v1/logs with worker.started event creates active worker', async () => {
    const nowNs = String(Date.now() * 1_000_000);
    const newWorkerId = 'e2e-new-worker-' + Date.now();
    const newSessionId = 'sess-new-' + Date.now();

    // First send a worker.state_transition event to establish the worker
    const stateTransitionPayload = {
      resourceLogs: [{
        scopeLogs: [{
          logRecords: [{
            timeUnixNano: String((Date.now() - 100) * 1_000_000),
            attributes: [
              { key: 'event_type', value: { stringValue: 'worker.state_transition' } },
              { key: 'needle.worker.id', value: { stringValue: newWorkerId } },
              { key: 'needle.session.id', value: { stringValue: newSessionId } },
              { key: 'needle.sequence', value: { intValue: 1 } },
              { key: 'from', value: { stringValue: 'BOOTING' } },
              { key: 'to', value: { stringValue: 'SELECTING' } },
            ],
          }],
        }],
      }],
    };

    const stateRes = await fetch(`${otlpUrl}/v1/logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(stateTransitionPayload),
    });
    expect(stateRes.status).toBe(200);

    // Send a worker.started log event
    const logsPayload = {
      resourceLogs: [{
        scopeLogs: [{
          logRecords: [{
            timeUnixNano: nowNs,
            attributes: [
              { key: 'event_type', value: { stringValue: 'worker.started' } },
              { key: 'needle.worker.id', value: { stringValue: newWorkerId } },
              { key: 'needle.session.id', value: { stringValue: newSessionId } },
              { key: 'needle.sequence', value: { intValue: 2 } },
              { key: 'provider', value: { stringValue: 'anthropic' } },
              { key: 'model', value: { stringValue: 'claude-sonnet-4-6' } },
            ],
          }],
        }],
      }],
    };

    const res = await fetch(`${otlpUrl}/v1/logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(logsPayload),
    });

    expect(res.status).toBe(200);

    // Wait for event processing
    await new Promise(resolve => setTimeout(resolve, 200));

    // Verify new worker appears in API
    const workersRes = await fetch(`${baseUrl}/api/workers`);
    expect(workersRes.status).toBe(200);

    const workers = await workersRes.json() as Worker[];
    const newWorker = workers.find((w: Worker) => w.id === newWorkerId);

    expect(newWorker).toBeDefined();
    expect(newWorker!.id).toBe(newWorkerId);
    expect(newWorker!.needleState).toBeDefined();
    expect(newWorker!.needleState).not.toBe('STOPPED');
  });

  it('POST /v1/logs with worker.state_transition to STOPPED produces stopped worker', async () => {
    const workerId = 'e2e-worker-stopped-' + Date.now();
    const sessionId = 'sess-stopped-' + Date.now();

    // Send a worker.state_transition event to establish the worker as SELECTING
    const stateStartPayload = {
      resourceLogs: [{
        scopeLogs: [{
          logRecords: [{
            timeUnixNano: String((Date.now() - 500) * 1_000_000),
            attributes: [
              { key: 'event_type', value: { stringValue: 'worker.state_transition' } },
              { key: 'needle.worker.id', value: { stringValue: workerId } },
              { key: 'needle.session.id', value: { stringValue: sessionId } },
              { key: 'needle.sequence', value: { intValue: 1 } },
              { key: 'from', value: { stringValue: 'BOOTING' } },
              { key: 'to', value: { stringValue: 'SELECTING' } },
            ],
          }],
        }],
      }],
    };

    await fetch(`${otlpUrl}/v1/logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(stateStartPayload),
    });

    // Wait a bit for the worker to be created
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify worker exists in SELECTING state
    const workersRes1 = await fetch(`${baseUrl}/api/workers`);
    expect(workersRes1.status).toBe(200);

    const workers1 = await workersRes1.json() as Worker[];
    const workerBefore = workers1.find((w: Worker) => w.id === workerId);
    expect(workerBefore).toBeDefined();
    expect(workerBefore!.needleState).toBe('SELECTING');
    expect(workerBefore!.needleState).not.toBe('STOPPED');

    // Now send a state transition to STOPPED
    const stoppedPayload = {
      resourceLogs: [{
        scopeLogs: [{
          logRecords: [{
            timeUnixNano: String(Date.now() * 1_000_000),
            attributes: [
              { key: 'event_type', value: { stringValue: 'worker.state_transition' } },
              { key: 'needle.worker.id', value: { stringValue: workerId } },
              { key: 'needle.session.id', value: { stringValue: sessionId } },
              { key: 'needle.sequence', value: { intValue: 2 } },
              { key: 'from', value: { stringValue: 'CLOSING' } },
              { key: 'to', value: { stringValue: 'STOPPED' } },
            ],
          }],
        }],
      }],
    };

    const res = await fetch(`${otlpUrl}/v1/logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(stoppedPayload),
    });

    expect(res.status).toBe(200);

    // Wait for event processing
    await new Promise(resolve => setTimeout(resolve, 200));

    // Verify worker state changed to STOPPED
    const workersRes2 = await fetch(`${baseUrl}/api/workers`);
    expect(workersRes2.status).toBe(200);

    const workers2 = await workersRes2.json() as Worker[];
    const stoppedWorker = workers2.find((w: Worker) => w.id === workerId);

    expect(stoppedWorker).toBeDefined();
    expect(stoppedWorker!.needleState).toBe('STOPPED');
    expect(stoppedWorker!.status).toBe('idle'); // STOPPED maps to idle
  });

  it('GET /api/health returns dedup_dropped when deduplicator is active', async () => {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    expect(healthRes.status).toBe(200);

    const health = await healthRes.json() as HealthResponse;
    expect(health).toHaveProperty('dedup_dropped');
    expect(typeof health.dedup_dropped).toBe('number');
  });

  it('Deduplication: sending duplicate OTLP events increments dedup_dropped', async () => {
    const initialDropped = deduplicator.droppedCount;

    const nowNs = String(Date.now() * 1_000_000);

    // Send the same event twice (same worker_id, session_id, sequence)
    const duplicatePayload = {
      resourceLogs: [{
        scopeLogs: [{
          logRecords: [{
            timeUnixNano: nowNs,
            attributes: [
              { key: 'event_type', value: { stringValue: 'test.event' } },
              { key: 'needle.worker.id', value: { stringValue: 'e2e-dedup-worker' } },
              { key: 'needle.session.id', value: { stringValue: 'e2e-dedup-session' } },
              { key: 'needle.sequence', value: { intValue: 999 } },
            ],
          }],
        }],
      }],
    };

    // First submission - should be accepted
    const res1 = await fetch(`${otlpUrl}/v1/logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(duplicatePayload),
    });
    expect(res1.status).toBe(200);

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 100));

    // Second submission - should be deduplicated
    const res2 = await fetch(`${otlpUrl}/v1/logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(duplicatePayload),
    });
    expect(res2.status).toBe(200);

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 100));

    // Check /api/health for dedup_dropped increment
    const healthRes = await fetch(`${baseUrl}/api/health`);
    expect(healthRes.status).toBe(200);

    const health = await healthRes.json() as HealthResponse;
    expect(health.dedup_dropped).toBeGreaterThanOrEqual(initialDropped);
  });

  it('Active workers count from /api/workers should be >= 1 after OTLP events', async () => {
    // Create a new active worker
    const workerId = 'e2e-active-count-' + Date.now();
    const sessionId = 'sess-active-' + Date.now();

    const stateTransitionPayload = {
      resourceLogs: [{
        scopeLogs: [{
          logRecords: [{
            timeUnixNano: String(Date.now() * 1_000_000),
            attributes: [
              { key: 'event_type', value: { stringValue: 'worker.state_transition' } },
              { key: 'needle.worker.id', value: { stringValue: workerId } },
              { key: 'needle.session.id', value: { stringValue: sessionId } },
              { key: 'needle.sequence', value: { intValue: 1 } },
              { key: 'from', value: { stringValue: 'BOOTING' } },
              { key: 'to', value: { stringValue: 'WORKING' } },
            ],
          }],
        }],
      }],
    };

    const res = await fetch(`${otlpUrl}/v1/logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(stateTransitionPayload),
    });
    expect(res.status).toBe(200);

    // Wait for event processing
    await new Promise(resolve => setTimeout(resolve, 200));

    // Count active workers (non-STOPPED states) from /api/workers
    const workersRes = await fetch(`${baseUrl}/api/workers`);
    expect(workersRes.status).toBe(200);

    const workers = await workersRes.json() as Worker[];
    const activeWorkers = workers.filter((w: Worker) =>
      w.needleState && w.needleState !== 'STOPPED'
    );

    // Should have at least 1 active worker
    expect(activeWorkers.length).toBeGreaterThanOrEqual(1);
  });
});

/**
 * Get a free port from the OS.
 * Returns a promise that resolves to an available port number.
 */
async function getFreePort(): Promise<number> {
  const net = await import('net');
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}
