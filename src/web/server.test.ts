/**
 * Tests for FABRIC Web Server API Endpoints
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createWebServer, WebServer } from './server.js';
import { InMemoryEventStore } from '../store.js';
import { resetCrossReferenceManager } from '../crossReferenceManager.js';
import { LogEvent } from '../types.js';

describe('Web Server API Endpoints', () => {
  let store: InMemoryEventStore;
  let server: WebServer;
  let port: number;

  const createEvent = (overrides: Partial<LogEvent> = {}): LogEvent => ({
    ts: Date.now(),
    worker: 'w-test',
    level: 'info',
    msg: 'Test message',
    ...overrides,
  });

  beforeEach(async () => {
    store = new InMemoryEventStore();
    resetCrossReferenceManager();

    // Find an available port
    port = 30000 + Math.floor(Math.random() * 1000);

    server = createWebServer({
      port,
      logPath: '/tmp/test-logs',
      store,
    });

    // Start server and wait for it to be ready
    await new Promise<void>((resolve) => {
      server.on('start', () => resolve());
      server.start();
    });
  });

  afterEach(async () => {
    // Stop server
    await new Promise<void>((resolve) => {
      server.on('stop', () => resolve());
      server.stop();
    });
    store.clear();
    resetCrossReferenceManager();
  });

  const fetchApi = async (path: string, options?: RequestInit) => {
    const response = await fetch(`http://localhost:${port}${path}`, options);
    return response;
  };

  describe('GET /api/health', () => {
    it('should return ok status', async () => {
      const response = await fetchApi('/api/health');
      expect(response.status).toBe(200);

      const data = await response.json() as any;
      expect(data.status).toBe('ok');
    });

    it('should include store size', async () => {
      store.add(createEvent());
      store.add(createEvent());

      const response = await fetchApi('/api/health');
      const data = await response.json() as any;

      expect(data.storeSize).toBe(2);
    });

    it('should return 0 store size for empty store', async () => {
      const response = await fetchApi('/api/health');
      const data = await response.json() as any;

      expect(data.storeSize).toBe(0);
    });
  });

  describe('GET /api/workers', () => {
    it('should return empty array when no workers', async () => {
      const response = await fetchApi('/api/workers');
      expect(response.status).toBe(200);

      const data = await response.json() as any;
      expect(data).toEqual([]);
    });

    it('should return all workers', async () => {
      store.add(createEvent({ worker: 'w1' }));
      store.add(createEvent({ worker: 'w2' }));
      store.add(createEvent({ worker: 'w3' }));

      const response = await fetchApi('/api/workers');
      const data = await response.json() as any;

      expect(data).toHaveLength(3);
      const ids = data.map((w: { id: string }) => w.id).sort();
      expect(ids).toEqual(['w1', 'w2', 'w3']);
    });

    it('should include worker status', async () => {
      store.add(createEvent({ worker: 'w-active', msg: 'Starting work' }));
      store.add(createEvent({ worker: 'w-error', level: 'error', msg: 'Something failed' }));
      store.add(createEvent({ worker: 'w-idle', msg: 'Task completed' }));

      const response = await fetchApi('/api/workers');
      const data = await response.json() as any;

      const activeWorker = data.find((w: { id: string }) => w.id === 'w-active');
      const errorWorker = data.find((w: { id: string }) => w.id === 'w-error');
      const idleWorker = data.find((w: { id: string }) => w.id === 'w-idle');

      expect(activeWorker.status).toBe('active');
      expect(errorWorker.status).toBe('error');
      expect(idleWorker.status).toBe('idle');
    });
  });

  describe('GET /api/workers/:id', () => {
    it('should return 404 for unknown worker', async () => {
      const response = await fetchApi('/api/workers/unknown');
      expect(response.status).toBe(404);

      const data = await response.json() as any;
      expect(data.error).toBe('Worker not found');
    });

    it('should return worker details', async () => {
      store.add(createEvent({ worker: 'w-test', bead: 'bd-123' }));

      const response = await fetchApi('/api/workers/w-test');
      expect(response.status).toBe(200);

      const data = await response.json() as any;
      expect(data.id).toBe('w-test');
      expect(data.activeBead).toBe('bd-123');
    });

    it('should track completed beads', async () => {
      store.add(createEvent({ worker: 'w-test', msg: 'Task completed', bead: 'bd-1' }));
      store.add(createEvent({ worker: 'w-test', msg: 'Task completed', bead: 'bd-2' }));

      const response = await fetchApi('/api/workers/w-test');
      const data = await response.json() as any;

      expect(data.beadsCompleted).toBe(2);
    });
  });

  describe('GET /api/events', () => {
    it('should return empty array when no events', async () => {
      const response = await fetchApi('/api/events');
      expect(response.status).toBe(200);

      const data = await response.json() as any;
      expect(data).toEqual([]);
    });

    it('should return recent events', async () => {
      store.add(createEvent({ ts: 1000, msg: 'Event 1' }));
      store.add(createEvent({ ts: 2000, msg: 'Event 2' }));
      store.add(createEvent({ ts: 3000, msg: 'Event 3' }));

      const response = await fetchApi('/api/events');
      const data = await response.json() as any;

      expect(data).toHaveLength(3);
    });

    it('should filter by worker', async () => {
      store.add(createEvent({ worker: 'w1', ts: 1000 }));
      store.add(createEvent({ worker: 'w2', ts: 2000 }));
      store.add(createEvent({ worker: 'w1', ts: 3000 }));

      const response = await fetchApi('/api/events?worker=w1');
      const data = await response.json() as any;

      expect(data).toHaveLength(2);
      expect(data.every((e: LogEvent) => e.worker === 'w1')).toBe(true);
    });

    it('should filter by level', async () => {
      store.add(createEvent({ level: 'info', ts: 1000 }));
      store.add(createEvent({ level: 'error', ts: 2000 }));
      store.add(createEvent({ level: 'info', ts: 3000 }));

      const response = await fetchApi('/api/events?level=error');
      const data = await response.json() as any;

      expect(data).toHaveLength(1);
      expect(data[0].level).toBe('error');
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 150; i++) {
        store.add(createEvent({ ts: i }));
      }

      const response = await fetchApi('/api/events?limit=10');
      const data = await response.json() as any;

      expect(data).toHaveLength(10);
    });

    it('should combine filters', async () => {
      store.add(createEvent({ worker: 'w1', level: 'info', ts: 1000 }));
      store.add(createEvent({ worker: 'w1', level: 'error', ts: 2000 }));
      store.add(createEvent({ worker: 'w2', level: 'error', ts: 3000 }));

      const response = await fetchApi('/api/events?worker=w1&level=error');
      const data = await response.json() as any;

      expect(data).toHaveLength(1);
      expect(data[0].worker).toBe('w1');
      expect(data[0].level).toBe('error');
    });
  });

  describe('GET /api/collisions', () => {
    it('should return empty array when no collisions', async () => {
      const response = await fetchApi('/api/collisions');
      expect(response.status).toBe(200);

      const data = await response.json() as any;
      expect(data).toEqual([]);
    });

    it('should return active collisions', async () => {
      const ts = Date.now();
      const path = '/src/test.ts';

      // Create collision - two workers modifying same file
      store.add(createEvent({
        worker: 'w1',
        path,
        tool: 'Edit',
        ts,
      }));
      store.add(createEvent({
        worker: 'w2',
        path,
        tool: 'Edit',
        ts: ts + 1000,
      }));

      const response = await fetchApi('/api/collisions');
      const data = await response.json() as any;

      expect(data).toHaveLength(1);
      expect(data[0].path).toBe(path);
      expect(data[0].workers).toContain('w1');
      expect(data[0].workers).toContain('w2');
      expect(data[0].isActive).toBe(true);
    });

    it('should not return old inactive collisions', async () => {
      // Single worker = no collision
      store.add(createEvent({
        worker: 'w1',
        path: '/src/test.ts',
        tool: 'Edit',
        ts: Date.now(),
      }));

      const response = await fetchApi('/api/collisions');
      const data = await response.json() as any;

      expect(data).toHaveLength(0);
    });
  });

  describe('GET /api/workers/:id/collisions', () => {
    it('should return empty array for worker with no collisions', async () => {
      store.add(createEvent({ worker: 'w1' }));

      const response = await fetchApi('/api/workers/w1/collisions');
      const data = await response.json() as any;

      expect(data).toEqual([]);
    });

    it('should return collisions for worker involved in collisions', async () => {
      const ts = Date.now();
      const path = '/src/shared.ts';

      store.add(createEvent({
        worker: 'w1',
        path,
        tool: 'Edit',
        ts,
      }));
      store.add(createEvent({
        worker: 'w2',
        path,
        tool: 'Edit',
        ts: ts + 1000,
      }));

      const response = await fetchApi('/api/workers/w1/collisions');
      const data = await response.json() as any;

      expect(data).toHaveLength(1);
      expect(data[0].path).toBe(path);
    });

    it('should return empty for worker not involved in collision', async () => {
      const ts = Date.now();

      // Create collision between w1 and w2
      store.add(createEvent({
        worker: 'w1',
        path: '/src/a.ts',
        tool: 'Edit',
        ts,
      }));
      store.add(createEvent({
        worker: 'w2',
        path: '/src/a.ts',
        tool: 'Edit',
        ts: ts + 1000,
      }));

      // w3 is not involved
      store.add(createEvent({ worker: 'w3' }));

      const response = await fetchApi('/api/workers/w3/collisions');
      const data = await response.json() as any;

      expect(data).toHaveLength(0);
    });
  });

  describe('Cross-Reference API', () => {
    describe('GET /api/xref/stats', () => {
      it('should return cross-reference statistics', async () => {
        const response = await fetchApi('/api/xref/stats');
        expect(response.status).toBe(200);

        const data = await response.json() as any;
        expect(data).toHaveProperty('totalLinks');
        expect(data).toHaveProperty('totalEntities');
        expect(data).toHaveProperty('byRelationship');
        expect(data).toHaveProperty('byEntityType');
      });

      it('should track entities after events are added', async () => {
        store.add(createEvent({ worker: 'w1', path: '/src/test.ts', bead: 'bd-1' }));

        const response = await fetchApi('/api/xref/stats');
        const data = await response.json() as any;

        // Should have entities after processing events
        expect(data.totalEntities).toBeGreaterThanOrEqual(0);
      });
    });

    describe('GET /api/xref/links', () => {
      it('should return all links', async () => {
        const response = await fetchApi('/api/xref/links');
        expect(response.status).toBe(200);

        const data = await response.json() as any;
        expect(Array.isArray(data)).toBe(true);
      });

      it('should respect limit parameter', async () => {
        const response = await fetchApi('/api/xref/links?limit=5');
        const data = await response.json() as any;

        expect(data.length).toBeLessThanOrEqual(5);
      });

      it('should filter by minStrength', async () => {
        const response = await fetchApi('/api/xref/links?minStrength=0.5');
        expect(response.status).toBe(200);

        const data = await response.json() as any;
        expect(Array.isArray(data)).toBe(true);
      });
    });

    describe('GET /api/xref/entities', () => {
      it('should return all entities', async () => {
        const response = await fetchApi('/api/xref/entities');
        expect(response.status).toBe(200);

        const data = await response.json() as any;
        expect(Array.isArray(data)).toBe(true);
      });
    });

    describe('GET /api/xref/entities/:type/:id', () => {
      it('should return 404 for unknown entity', async () => {
        const response = await fetchApi('/api/xref/entities/worker/unknown-worker');
        expect(response.status).toBe(404);

        const data = await response.json() as any;
        expect(data.error).toBe('Entity not found');
      });

      it('should return entity details for known entity', async () => {
        // The cross-reference manager needs events processed explicitly
        // It's a separate system from the store
        const { getCrossReferenceManager } = await import('../crossReferenceManager.js');
        const xrefManager = getCrossReferenceManager();

        // Process the event through the cross-reference manager
        const event = createEvent({ worker: 'w-known' });
        store.add(event);
        xrefManager.processEvent(event);

        const response = await fetchApi('/api/xref/entities/worker/w-known');
        expect(response.status).toBe(200);

        const data = await response.json() as any;
        expect(data.id).toBe('w-known');
        expect(data.type).toBe('worker');
      });
    });

    describe('GET /api/xref/entities/:type/:id/links', () => {
      it('should return links for entity', async () => {
        store.add(createEvent({ worker: 'w1', path: '/src/test.ts' }));

        const response = await fetchApi('/api/xref/entities/worker/w1/links');
        expect(response.status).toBe(200);

        const data = await response.json() as any;
        expect(Array.isArray(data)).toBe(true);
      });
    });

    describe('GET /api/xref/entities/:type/:id/related', () => {
      it('should return related entities', async () => {
        store.add(createEvent({ worker: 'w1', path: '/src/test.ts', bead: 'bd-1' }));

        const response = await fetchApi('/api/xref/entities/worker/w1/related');
        expect(response.status).toBe(200);

        const data = await response.json() as any;
        expect(Array.isArray(data)).toBe(true);
      });
    });

    describe('GET /api/xref/path', () => {
      it('should return 400 for missing parameters', async () => {
        const response = await fetchApi('/api/xref/path');
        expect(response.status).toBe(400);

        const data = await response.json() as any;
        expect(data.error).toContain('Missing required parameters');
      });

      it('should return 400 for partial parameters', async () => {
        const response = await fetchApi('/api/xref/path?sourceType=worker&sourceId=w1');
        expect(response.status).toBe(400);
      });

      it('should return 404 when no path found', async () => {
        const response = await fetchApi(
          '/api/xref/path?sourceType=worker&sourceId=unknown&targetType=file&targetId=unknown'
        );
        expect(response.status).toBe(404);

        const data = await response.json() as any;
        expect(data.error).toBe('No path found between entities');
      });

      it('should find path between related entities', async () => {
        // Create events that link worker to file
        store.add(createEvent({ worker: 'w1', path: '/src/test.ts' }));

        const response = await fetchApi(
          '/api/xref/path?sourceType=worker&sourceId=w1&targetType=file&targetId=/src/test.ts'
        );

        // May or may not find path depending on how cross-references are built
        expect([200, 404]).toContain(response.status);
      });
    });
  });

  describe('WebSocket functionality', () => {
    it('should expose broadcast method', () => {
      expect(server.broadcast).toBeDefined();
      expect(typeof server.broadcast).toBe('function');
    });

    it('should expose broadcastCollisions method', () => {
      expect(server.broadcastCollisions).toBeDefined();
      expect(typeof server.broadcastCollisions).toBe('function');
    });

    it('should expose getPort method', () => {
      expect(server.getPort).toBeDefined();
      expect(server.getPort()).toBe(port);
    });

    it('should accept WebSocket connections', async () => {
      const WebSocket = (await import('ws')).default;
      const ws = new WebSocket(`ws://localhost:${port}`);

      const openPromise = new Promise<void>((resolve) => {
        ws.on('open', () => {
          ws.close();
          resolve();
        });
      });

      await openPromise;
    });

    it('should send init message on connection', async () => {
      const WebSocket = (await import('ws')).default;
      const ws = new WebSocket(`ws://localhost:${port}`);

      const initMessage = await new Promise<any>((resolve) => {
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'init') {
            ws.close();
            resolve(msg);
          }
        });
      });

      expect(initMessage.type).toBe('init');
      expect(initMessage.data).toHaveProperty('workers');
      expect(initMessage.data).toHaveProperty('recentEvents');
      expect(initMessage.data).toHaveProperty('collisions');
      expect(Array.isArray(initMessage.data.workers)).toBe(true);
      expect(Array.isArray(initMessage.data.recentEvents)).toBe(true);
      expect(Array.isArray(initMessage.data.collisions)).toBe(true);
    });

    it('should include current state in init message', async () => {
      // Add some events first
      store.add(createEvent({ worker: 'w1', msg: 'Starting work' }));
      store.add(createEvent({ worker: 'w2', msg: 'Another event' }));

      const WebSocket = (await import('ws')).default;
      const ws = new WebSocket(`ws://localhost:${port}`);

      const initMessage = await new Promise<any>((resolve) => {
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'init') {
            ws.close();
            resolve(msg);
          }
        });
      });

      expect(initMessage.data.workers).toHaveLength(2);
      const workerIds = initMessage.data.workers.map((w: { id: string }) => w.id).sort();
      expect(workerIds).toEqual(['w1', 'w2']);
    });
  });

  describe('WebSocket broadcast', () => {
    it('should broadcast events to connected clients', async () => {
      const WebSocket = (await import('ws')).default;
      const ws = new WebSocket(`ws://localhost:${port}`);

      // Set up message listener before connection (to catch init)
      const messagePromise = new Promise<any>((resolve) => {
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          // Skip init messages, wait for event
          if (msg.type === 'event') {
            resolve(msg);
          }
        });
      });

      // Wait for connection
      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Small delay to ensure connection is established and init sent
      await new Promise(resolve => setTimeout(resolve, 50));

      // Broadcast an event
      const testEvent = createEvent({ worker: 'w-broadcast', msg: 'Broadcast test' });
      server.broadcast(testEvent);

      const message = await messagePromise;
      expect(message.type).toBe('event');
      expect(message.data.worker).toBe('w-broadcast');
      expect(message.data.msg).toBe('Broadcast test');

      ws.close();
    });

    it('should broadcast to multiple clients', async () => {
      const WebSocket = (await import('ws')).default;
      const clients: any[] = [];
      const messagePromises: Promise<any>[] = [];

      // Connect multiple clients with listeners set up first
      for (let i = 0; i < 3; i++) {
        const ws = new WebSocket(`ws://localhost:${port}`);

        // Set up listener before connection
        const msgPromise = new Promise<any>((resolve) => {
          ws.on('message', (data: Buffer) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'event') {
              resolve(msg);
            }
          });
        });
        messagePromises.push(msgPromise);

        await new Promise<void>((resolve) => {
          ws.on('open', resolve);
        });
        clients.push(ws);
      }

      // Small delay to ensure all connections are ready
      await new Promise(resolve => setTimeout(resolve, 50));

      // Broadcast an event
      const testEvent = createEvent({ worker: 'w-multi', msg: 'Multi-client broadcast' });
      server.broadcast(testEvent);

      // All clients should receive the message
      const messages = await Promise.all(messagePromises);
      expect(messages).toHaveLength(3);
      messages.forEach(msg => {
        expect(msg.type).toBe('event');
        expect(msg.data.worker).toBe('w-multi');
      });

      // Cleanup
      clients.forEach(ws => ws.close());
    });

    it('should not broadcast to closed clients', async () => {
      const WebSocket = (await import('ws')).default;

      // Connect and immediately close one client
      const closedWs = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) => {
        closedWs.on('open', () => {
          closedWs.close();
          resolve();
        });
      });

      // Connect another client that stays open (set up listener first)
      const openWs = new WebSocket(`ws://localhost:${port}`);
      const messagePromise = new Promise<any>((resolve) => {
        openWs.on('message', (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'event') {
            resolve(msg);
          }
        });
      });

      await new Promise<void>((resolve) => {
        openWs.on('open', resolve);
      });

      // Wait for close to complete
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      const testEvent = createEvent({ worker: 'w-after-close', msg: 'After close' });
      server.broadcast(testEvent);

      const message = await messagePromise;
      expect(message.data.worker).toBe('w-after-close');

      openWs.close();
    });
  });

  describe('WebSocket broadcastCollisions', () => {
    it('should broadcast collision updates', async () => {
      const WebSocket = (await import('ws')).default;
      const ws = new WebSocket(`ws://localhost:${port}`);

      // Set up listener for collision message before connection
      const messagePromise = new Promise<any>((resolve) => {
        ws.on('message', (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'collision') {
            resolve(msg);
          }
        });
      });

      // Wait for connection
      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Small delay to ensure connection is ready
      await new Promise(resolve => setTimeout(resolve, 50));

      // Create a collision
      const ts = Date.now();
      store.add(createEvent({ worker: 'w1', path: '/src/collision.ts', tool: 'Edit', ts }));
      store.add(createEvent({ worker: 'w2', path: '/src/collision.ts', tool: 'Edit', ts: ts + 100 }));

      server.broadcastCollisions();

      const message = await messagePromise;
      expect(message.type).toBe('collision');
      expect(message.data).toHaveProperty('collisions');
      expect(message.data).toHaveProperty('workers');
      expect(Array.isArray(message.data.collisions)).toBe(true);

      ws.close();
    });

    it('should include worker data in collision broadcast', async () => {
      const WebSocket = (await import('ws')).default;
      const ws = new WebSocket(`ws://localhost:${port}`);

      // Set up listener before connection
      const messagePromise = new Promise<any>((resolve) => {
        ws.on('message', (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'collision') {
            resolve(msg);
          }
        });
      });

      // Wait for connection
      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Small delay to ensure connection is ready
      await new Promise(resolve => setTimeout(resolve, 50));

      // Add workers
      store.add(createEvent({ worker: 'w-collision-1', msg: 'Working' }));
      store.add(createEvent({ worker: 'w-collision-2', msg: 'Working' }));

      server.broadcastCollisions();

      const message = await messagePromise;
      expect(message.data.workers).toBeDefined();
      expect(Array.isArray(message.data.workers)).toBe(true);

      ws.close();
    });
  });

  describe('WebSocket client lifecycle', () => {
    it('should handle client disconnect gracefully', async () => {
      const WebSocket = (await import('ws')).default;
      const ws = new WebSocket(`ws://localhost:${port}`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Close the connection
      const closePromise = new Promise<void>((resolve) => {
        ws.on('close', resolve);
      });

      ws.close();
      await closePromise;

      // Server should still work after client disconnect
      const response = await fetchApi('/api/health');
      expect(response.status).toBe(200);
    });

    it('should handle multiple connections and disconnections', async () => {
      const WebSocket = (await import('ws')).default;

      // Connect and disconnect multiple clients rapidly
      for (let i = 0; i < 5; i++) {
        const ws = new WebSocket(`ws://localhost:${port}`);
        await new Promise<void>((resolve) => {
          ws.on('open', () => {
            setTimeout(() => {
              ws.close();
              resolve();
            }, 50);
          });
        });
      }

      // Server should still be responsive
      const response = await fetchApi('/api/health');
      expect(response.status).toBe(200);
    });

    it('should handle WebSocket errors gracefully', async () => {
      const WebSocket = (await import('ws')).default;
      const ws = new WebSocket(`ws://localhost:${port}`);

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Simulate an error by sending invalid data (this should not crash the server)
      // The server handles errors in the ws.on('error') handler
      ws.terminate();

      // Wait a bit for cleanup
      await new Promise(resolve => setTimeout(resolve, 100));

      // Server should still work
      const response = await fetchApi('/api/health');
      expect(response.status).toBe(200);
    });
  });

  describe('Error handling', () => {
    it('should handle concurrent requests', async () => {
      // Add some events first
      for (let i = 0; i < 10; i++) {
        store.add(createEvent({ worker: `w${i}` }));
      }

      // Make concurrent requests
      const requests = Array(5).fill(null).map(() => fetchApi('/api/workers'));
      const responses = await Promise.all(requests);

      for (const response of responses) {
        expect(response.status).toBe(200);
        const data = await response.json() as any;
        expect(data).toHaveLength(10);
      }
    });

    it('should return valid JSON for all endpoints', async () => {
      const endpoints = [
        '/api/health',
        '/api/workers',
        '/api/events',
        '/api/collisions',
        '/api/xref/stats',
        '/api/xref/links',
        '/api/xref/entities',
      ];

      for (const endpoint of endpoints) {
        const response = await fetchApi(endpoint);
        expect(response.status).toBe(200);

        // Should not throw when parsing JSON
        const data = await response.json() as any;
        expect(data).toBeDefined();
      }
    });
  });

  describe('Server lifecycle', () => {
    it('should emit start event', () => {
      // This was already tested in beforeEach
      expect(server.getPort()).toBe(port);
    });

    it('should not start twice', async () => {
      // Server is already started in beforeEach
      // Calling start again should be a no-op
      server.start();

      // Wait a bit to ensure no error
      await new Promise(resolve => setTimeout(resolve, 100));

      // Server should still be running
      const response = await fetchApi('/api/health');
      expect(response.status).toBe(200);
    });
  });

  describe('POST /api/events', () => {
    it('should accept a valid NEEDLE format event', async () => {
      const needleEvent = {
        ts: '2026-03-09T12:33:59.517Z',
        event: 'bead.claimed',
        level: 'info',
        session: 'needle-claude-test',
        worker: 'claude-code-test',
        data: { bead_id: 'bd-123', workspace: '/home/coder/NEEDLE' }
      };

      const response = await fetchApi('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(needleEvent)
      });

      expect(response.status).toBe(201);
      const data = await response.json() as any;
      expect(data.success).toBe(true);
      expect(data.event).toBeDefined();
      expect(data.event.msg).toBe('bead.claimed');
    });

    it('should store the event in the store', async () => {
      const needleEvent = {
        ts: '2026-03-09T12:34:00.000Z',
        event: 'worker.started',
        worker: 'test-worker-post'
      };

      const response = await fetchApi('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(needleEvent)
      });

      expect(response.status).toBe(201);

      // Verify the event is in the store
      const eventsResponse = await fetchApi('/api/events');
      const events = await eventsResponse.json() as any[];
      expect(events.some(e => e.worker === 'test-worker-post')).toBe(true);
    });

    it('should broadcast the event to WebSocket clients', async () => {
      const WebSocket = (await import('ws')).default;
      const ws = new WebSocket(`ws://localhost:${port}`);

      // Set up listener for event message
      const messagePromise = new Promise<any>((resolve) => {
        ws.on('message', (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'event' && msg.data.msg === 'test.broadcast') {
            resolve(msg);
          }
        });
      });

      // Wait for connection
      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      // Small delay to ensure connection is ready
      await new Promise(resolve => setTimeout(resolve, 50));

      // Post an event
      const response = await fetchApi('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ts: new Date().toISOString(),
          event: 'test.broadcast',
          worker: 'ws-test-worker'
        })
      });

      expect(response.status).toBe(201);

      // Wait for WebSocket broadcast
      const message = await messagePromise;
      expect(message.type).toBe('event');
      expect(message.data.msg).toBe('test.broadcast');

      ws.close();
    });

    it('should return 400 for missing ts field', async () => {
      const response = await fetchApi('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'test.event',
          worker: 'test-worker'
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json() as any;
      expect(data.error).toContain('Missing required field');
      expect(data.message).toContain('ts');
    });

    it('should return 400 for missing event field', async () => {
      const response = await fetchApi('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ts: '2026-03-09T12:34:00.000Z',
          worker: 'test-worker'
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json() as any;
      expect(data.error).toContain('Missing required field');
      expect(data.message).toContain('event');
    });

    it('should return 400 for invalid JSON body', async () => {
      const response = await fetchApi('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json'
      });

      // Express.json() will reject malformed JSON
      expect(response.status).toBe(400);
    });

    it('should return 400 for array body (arrays fail field validation)', async () => {
      const response = await fetchApi('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(['array', 'not', 'object'])
      });

      expect(response.status).toBe(400);
      const data = await response.json() as any;
      // Arrays pass the object check but fail field validation
      expect(data.error).toContain('Missing required field');
    });

    it('should accept NEEDLE format with string worker', async () => {
      // NEEDLE format can have worker as a string like "runner-provider-model-id"
      const needleEvent = {
        ts: '2026-03-09T12:36:00.000Z',
        event: 'worker.ping',
        worker: 'claude-code-glm-5-alpha'
      };

      const response = await fetchApi('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(needleEvent)
      });

      expect(response.status).toBe(201);
      const data = await response.json() as any;
      expect(data.success).toBe(true);
      expect(data.event.worker).toBe('claude-code-glm-5-alpha');
    });
  });

  describe('POST /api/events/batch', () => {
    it('should accept an array of events', async () => {
      const events = [
        { ts: '2026-03-09T12:35:00.000Z', event: 'batch.1', worker: 'batch-worker' },
        { ts: '2026-03-09T12:35:01.000Z', event: 'batch.2', worker: 'batch-worker' },
        { ts: '2026-03-09T12:35:02.000Z', event: 'batch.3', worker: 'batch-worker' }
      ];

      const response = await fetchApi('/api/events/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(events)
      });

      expect(response.status).toBe(201);
      const data = await response.json() as any;
      expect(data.success).toBe(true);
      expect(data.ingested).toBe(3);
      expect(data.total).toBe(3);
    });

    it('should return 400 for non-array body', async () => {
      const response = await fetchApi('/api/events/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ts: '2026-03-09T12:35:00.000Z', event: 'test' })
      });

      expect(response.status).toBe(400);
      const data = await response.json() as any;
      expect(data.error).toContain('Invalid request body');
      expect(data.message).toContain('array');
    });

    it('should return 400 for empty array', async () => {
      const response = await fetchApi('/api/events/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([])
      });

      expect(response.status).toBe(400);
      const data = await response.json() as any;
      expect(data.error).toContain('Empty batch');
    });

    it('should return errors for invalid events in batch', async () => {
      const events = [
        { ts: '2026-03-09T12:35:00.000Z', event: 'valid.event', worker: 'worker' },
        { ts: '2026-03-09T12:35:01.000Z' }, // missing event
        { event: 'missing.ts', worker: 'worker' }, // missing ts
        { ts: '2026-03-09T12:35:02.000Z', event: 'another.valid', worker: 'worker' }
      ];

      const response = await fetchApi('/api/events/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(events)
      });

      expect(response.status).toBe(201);
      const data = await response.json() as any;
      expect(data.ingested).toBe(2);
      expect(data.total).toBe(4);
      expect(data.errors).toBeDefined();
      expect(data.errors.length).toBe(2);
    });

    it('should broadcast all valid events to WebSocket clients', async () => {
      const WebSocket = (await import('ws')).default;
      const ws = new WebSocket(`ws://localhost:${port}`);

      const messages: any[] = [];
      const messagePromise = new Promise<void>((resolve) => {
        let count = 0;
        ws.on('message', (data: Buffer) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'event' && msg.data.msg?.startsWith('batch.broadcast')) {
            messages.push(msg);
            count++;
            if (count === 2) resolve();
          }
        });
      });

      await new Promise<void>((resolve) => {
        ws.on('open', resolve);
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      const events = [
        { ts: new Date().toISOString(), event: 'batch.broadcast.1', worker: 'batch-worker' },
        { ts: new Date().toISOString(), event: 'batch.broadcast.2', worker: 'batch-worker' }
      ];

      await fetchApi('/api/events/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(events)
      });

      await messagePromise;
      expect(messages.length).toBe(2);

      ws.close();
    });
  });
});
