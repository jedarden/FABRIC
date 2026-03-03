/**
 * FABRIC Web Server
 *
 * Express HTTP server with WebSocket support for real-time updates.
 */

import express, { Express, Request, Response } from 'express';
import { createServer, Server as HttpServer } from 'http';
import { EventEmitter } from 'events';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { LogEvent, EventFilter, CrossReferenceEntityType, CrossReferenceRelationship } from '../types.js';
import { InMemoryEventStore } from '../store.js';
import { CrossReferenceManager, getCrossReferenceManager } from '../crossReferenceManager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface WebServerOptions {
  port: number;
  logPath: string;
  store: InMemoryEventStore;
}

export interface WebServer extends EventEmitter {
  start(): void;
  stop(): void;
  getPort(): number;
  broadcast(event: LogEvent): void;
  broadcastCollisions(): void;
}

/**
 * Create the FABRIC web server
 */
export function createWebServer(options: WebServerOptions): WebServer {
  const { port, logPath, store } = options;
  const emitter = new EventEmitter();

  let app: Express;
  let httpServer: HttpServer;
  let wsServer: WebSocketServer;
  let running = false;
  const clients: Set<WebSocket> = new Set();

  function start() {
    if (running) return;

    app = express();
    httpServer = createServer(app);
    wsServer = new WebSocketServer({ server: httpServer });

    // WebSocket connection handling
    wsServer.on('connection', (ws: WebSocket) => {
      clients.add(ws);
      console.log(`WebSocket client connected (${clients.size} total)`);

      // Send initial state
      ws.send(JSON.stringify({
        type: 'init',
        data: {
          workers: store.getWorkers(),
          recentEvents: store.query().slice(-50),
          collisions: store.getCollisions()
        }
      }));

      ws.on('close', () => {
        clients.delete(ws);
        console.log(`WebSocket client disconnected (${clients.size} total)`);
      });

      ws.on('error', (err) => {
        console.error('WebSocket error:', err.message);
        clients.delete(ws);
      });
    });

    // Health check endpoint
    app.get('/api/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', storeSize: store.size });
    });

    // Get all workers
    app.get('/api/workers', (_req: Request, res: Response) => {
      const workers = store.getWorkers();
      res.json(workers);
    });

    // Get recent events
    app.get('/api/events', (req: Request, res: Response) => {
      const limit = parseInt(req.query.limit as string) || 100;
      const workerId = req.query.worker as string;
      const level = req.query.level as string;

      const filter: EventFilter = {};
      if (workerId) filter.worker = workerId;
      if (level) filter.level = level as EventFilter['level'];

      const events = store.query(filter).slice(-limit);
      res.json(events);
    });

    // Get worker details
    app.get('/api/workers/:id', (req: Request, res: Response) => {
      const workerId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const worker = store.getWorker(workerId);
      if (!worker) {
        res.status(404).json({ error: 'Worker not found' });
        return;
      }
      res.json(worker);
    });

    // Get active collisions
    app.get('/api/collisions', (_req: Request, res: Response) => {
      const collisions = store.getCollisions();
      res.json(collisions);
    });

    // Get collisions for specific worker
    app.get('/api/workers/:id/collisions', (req: Request, res: Response) => {
      const workerId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const collisions = store.getWorkerCollisions(workerId);
      res.json(collisions);
    });

    // ============================================
    // Cross-Reference API Endpoints
    // ============================================

    // Get cross-reference manager instance
    const xrefManager = getCrossReferenceManager();

    // Get cross-reference statistics
    app.get('/api/xref/stats', (_req: Request, res: Response) => {
      const stats = xrefManager.getStats();
      res.json(stats);
    });

    // Get all cross-reference links
    app.get('/api/xref/links', (req: Request, res: Response) => {
      const sourceType = req.query.sourceType as CrossReferenceEntityType | undefined;
      const targetType = req.query.targetType as CrossReferenceEntityType | undefined;
      const relationship = req.query.relationship as CrossReferenceRelationship | undefined;
      const minStrength = req.query.minStrength ? parseFloat(req.query.minStrength as string) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;

      const links = xrefManager.query({
        sourceType,
        targetType,
        relationship,
        minStrength,
        limit,
      });

      res.json(links);
    });

    // Get all tracked entities
    app.get('/api/xref/entities', (_req: Request, res: Response) => {
      const entities = xrefManager.getAllEntities();
      res.json(entities);
    });

    // Get a specific entity
    app.get('/api/xref/entities/:type/:id', (req: Request, res: Response) => {
      const type = req.params.type as CrossReferenceEntityType;
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const entity = xrefManager.getEntity(type, id);

      if (!entity) {
        res.status(404).json({ error: 'Entity not found' });
        return;
      }

      res.json(entity);
    });

    // Get links for a specific entity
    app.get('/api/xref/entities/:type/:id/links', (req: Request, res: Response) => {
      const type = req.params.type as CrossReferenceEntityType;
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const links = xrefManager.getLinksForEntity(type, id);
      res.json(links);
    });

    // Get linked entities for a specific entity
    app.get('/api/xref/entities/:type/:id/related', (req: Request, res: Response) => {
      const type = req.params.type as CrossReferenceEntityType;
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const related = xrefManager.getLinkedEntities(type, id);
      res.json(related);
    });

    // Find a navigation path between two entities
    app.get('/api/xref/path', (req: Request, res: Response) => {
      const sourceType = req.query.sourceType as CrossReferenceEntityType;
      const sourceId = req.query.sourceId as string;
      const targetType = req.query.targetType as CrossReferenceEntityType;
      const targetId = req.query.targetId as string;
      const maxDepth = req.query.maxDepth ? parseInt(req.query.maxDepth as string) : 5;

      if (!sourceType || !sourceId || !targetType || !targetId) {
        res.status(400).json({ error: 'Missing required parameters: sourceType, sourceId, targetType, targetId' });
        return;
      }

      const path = xrefManager.findPath(sourceType, sourceId, targetType, targetId, maxDepth);

      if (!path) {
        res.status(404).json({ error: 'No path found between entities' });
        return;
      }

      res.json(path);
    });

    // Serve static frontend files
    const staticPath = join(__dirname, '..', 'web');
    app.use(express.static(staticPath));

    // Fallback to index.html for SPA routing
    app.use((_req: Request, res: Response) => {
      res.sendFile(join(staticPath, 'index.html'), (err) => {
        if (err) {
          res.status(404).send(`
            <!DOCTYPE html>
            <html>
            <head><title>FABRIC</title></head>
            <body>
              <h1>FABRIC Web Dashboard</h1>
              <p>Frontend not built. Run <code>npm run build:web</code> first.</p>
              <h2>API Endpoints</h2>
              <ul>
                <li><a href="/api/health">/api/health</a> - Health check</li>
                <li><a href="/api/workers">/api/workers</a> - List workers</li>
                <li><a href="/api/events">/api/events</a> - Recent events</li>
              </ul>
            </body>
            </html>
          `);
        }
      });
    });

    httpServer.listen(port, () => {
      running = true;
      console.log(`FABRIC Web Dashboard running at http://localhost:${port}`);
      console.log(`API: http://localhost:${port}/api/`);
      console.log(`Watching: ${logPath}`);
      console.log('Press Ctrl+C to stop');
      emitter.emit('start');
    });

    httpServer.on('error', (err) => {
      emitter.emit('error', err);
    });
  }

  function stop() {
    if (!running || !httpServer) return;

    // Close all WebSocket connections
    for (const client of clients) {
      client.close();
    }
    clients.clear();

    wsServer.close(() => {
      httpServer.close(() => {
        running = false;
        emitter.emit('stop');
      });
    });
  }

  function getPort(): number {
    return port;
  }

  function broadcast(event: LogEvent): void {
    const message = JSON.stringify({ type: 'event', data: event });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  function broadcastCollisions(): void {
    const collisions = store.getCollisions();
    const message = JSON.stringify({
      type: 'collision',
      data: {
        collisions,
        workers: store.getWorkers()
      }
    });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  return Object.assign(emitter, { start, stop, getPort, broadcast, broadcastCollisions });
}

export default createWebServer;
