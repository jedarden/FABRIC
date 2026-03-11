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
import { LogEvent, EventFilter, CrossReferenceEntityType, CrossReferenceRelationship, DagOptions, BeadStatus } from '../types.js';
import { InMemoryEventStore } from '../store.js';
import { refreshDependencyGraph, getDagStats } from '../tui/dagUtils.js';
import { parseEventObject } from '../parser.js';

/** Maximum payload size for POST requests (64KB) */
const MAX_PAYLOAD_SIZE = 64 * 1024;

/** Maximum number of events in a batch request */
const MAX_BATCH_SIZE = 100;

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface WebServerOptions {
  port: number;
  logPath: string;
  store: InMemoryEventStore;
  /** Optional auth token for POST endpoints. If provided, requires Bearer token in Authorization header */
  authToken?: string;
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
  const { port, logPath, store, authToken } = options;
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

 createAuthMiddleware(authToken: string | undefined) {
  /**
   * Creates Express middleware for Bearer token authentication
   * @param authToken - The optional auth token for POST endpoints
   */
  return function createAuthMiddleware(authToken?: string) {
  if (authToken) {
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/);
    return token !== authToken;
  }
  return function(req: Request, res: Response, next) {
    // If no auth header) {
      res.status(401).json({ error: 'Missing authorization', message: 'Authorization header required' });
      return;
    }

    next();
  }
};
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

    // POST endpoint to ingest NEEDLE telemetry events
    app.post('/api/events', (req: Request, res: Response) => {
      try {
        const eventObj = req.body;

        // Validate request body exists
        if (!eventObj || typeof eventObj !== 'object') {
          res.status(400).json({ error: 'Invalid request body', message: 'Expected JSON object' });
          return;
        }

        // Validate required fields for NEEDLE format
        if (!eventObj.ts) {
          res.status(400).json({ error: 'Missing required field', message: 'Field "ts" is required' });
          return;
        }
        if (!eventObj.event) {
          res.status(400).json({ error: 'Missing required field', message: 'Field "event" is required' });
          return;
        }

        // Parse the event object
        const logEvent = parseEventObject(eventObj);
        if (!logEvent) {
          res.status(400).json({ error: 'Invalid event format', message: 'Failed to parse event object' });
          return;
        }

        // Store the event
        store.add(logEvent);

        // Broadcast to all connected WebSocket clients
        broadcast(logEvent);

        // Return success
        res.status(201).json({ success: true, event: logEvent });
      } catch (err) {
        console.error('Error processing POST /api/events:', err);
        res.status(500).json({ error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' });
      }
    });

    // POST endpoint to ingest batched NEEDLE telemetry events
    app.post('/api/events/batch', (req: Request, res: Response) => {
      try {
        const eventsArray = req.body;

        // Validate request body is an array
        if (!Array.isArray(eventsArray)) {
          res.status(400).json({ error: 'Invalid request body', message: 'Expected JSON array of events' });
          return;
        }

        // Check batch size limit
        if (eventsArray.length === 0) {
          res.status(400).json({ error: 'Empty batch', message: 'Batch must contain at least one event' });
          return;
        }

        if (eventsArray.length > MAX_BATCH_SIZE) {
          res.status(400).json({
            error: 'Batch too large',
            message: `Batch exceeds maximum size of ${MAX_BATCH_SIZE} events (received ${eventsArray.length})`
          });
          return;
        }

        const ingestedEvents: LogEvent[] = [];
        const errors: { index: number; error: string }[] = [];

        // Process each event
        for (let i = 0; i < eventsArray.length; i++) {
          const eventObj = eventsArray[i];

          // Validate each event has required fields
          if (!eventObj || typeof eventObj !== 'object') {
            errors.push({ index: i, error: 'Invalid event object' });
            continue;
          }

          if (!eventObj.ts) {
            errors.push({ index: i, error: 'Missing required field "ts"' });
            continue;
          }
          if (!eventObj.event) {
            errors.push({ index: i, error: 'Missing required field "event"' });
            continue;
          }

          // Parse the event object
          const logEvent = parseEventObject(eventObj);
          if (!logEvent) {
            errors.push({ index: i, error: 'Failed to parse event object' });
            continue;
          }

          // Store the event
          store.add(logEvent);
          ingestedEvents.push(logEvent);
        }

        // Broadcast all ingested events to WebSocket clients
        for (const event of ingestedEvents) {
          broadcast(event);
        }

        // Return success with count
        res.status(201).json({
          success: true,
          ingested: ingestedEvents.length,
          total: eventsArray.length,
          errors: errors.length > 0 ? errors : undefined
        });
      } catch (err) {
        console.error('Error processing POST /api/events/batch:', err);
        res.status(500).json({ error: 'Internal server error', message: err instanceof Error ? err.message : 'Unknown error' });
      }
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
    // File Heatmap API Endpoints
    // ============================================

    // Get file heatmap entries
    app.get('/api/heatmap', (req: Request, res: Response) => {
      const sortBy = req.query.sortBy as 'modifications' | 'recent' | 'workers' | 'collisions' || undefined;
      const maxEntries = req.query.maxEntries ? parseInt(req.query.maxEntries as string) : 100;
      const collisionsOnly = req.query.collisionsOnly === 'true';
      const directoryFilter = req.query.directoryFilter as string | undefined;

      const entries = store.getFileHeatmap({
        sortBy,
        maxEntries,
        collisionsOnly,
        directoryFilter,
      });

      res.json(entries);
    });

    // Get file heatmap statistics
    app.get('/api/heatmap/stats', (_req: Request, res: Response) => {
      const stats = store.getFileHeatmapStats();
      res.json(stats);
    });

    // ============================================
    // Dependency DAG API Endpoints
    // ============================================

    // Get dependency graph
    app.get('/api/dag', (req: Request, res: Response) => {
      try {
        const status = req.query.status as BeadStatus | 'all' | undefined;
        const criticalOnly = req.query.criticalOnly === 'true';
        const maxDepth = req.query.maxDepth ? parseInt(req.query.maxDepth as string) : undefined;
        const includeClosed = req.query.includeClosed === 'true';

        const options: DagOptions = {};
        if (status && status !== 'all') {
          options.status = status as BeadStatus;
        }
        if (criticalOnly) {
          options.criticalOnly = true;
        }
        if (maxDepth !== undefined) {
          options.maxDepth = maxDepth;
        }
        if (includeClosed) {
          options.includeClosed = true;
        }

        const graph = refreshDependencyGraph(options);
        const stats = getDagStats(graph);

        res.json({ graph, stats });
      } catch (error) {
        console.error('Error generating dependency graph:', error);
        res.status(500).json({
          error: 'Failed to generate dependency graph',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    });

    // ============================================
    // Cross-Reference API Endpoints
    // ============================================

    // Get cross-reference statistics
    app.get('/api/xref/stats', (_req: Request, res: Response) => {
      const stats = store.getCrossReferenceStats();
      res.json(stats);
    });

    // Get all cross-reference links
    app.get('/api/xref/links', (req: Request, res: Response) => {
      const sourceType = req.query.sourceType as CrossReferenceEntityType | undefined;
      const targetType = req.query.targetType as CrossReferenceEntityType | undefined;
      const relationship = req.query.relationship as CrossReferenceRelationship | undefined;
      const minStrength = req.query.minStrength ? parseFloat(req.query.minStrength as string) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;

      const links = store.queryCrossReferences({
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
      const entities = store.getAllCrossReferenceEntities();
      res.json(entities);
    });

    // Get a specific entity
    app.get('/api/xref/entities/:type/:id', (req: Request, res: Response) => {
      const type = req.params.type as CrossReferenceEntityType;
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const entity = store.getCrossReferenceEntity(type, id);

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
      const links = store.getCrossReferenceLinksForEntity(type, id);
      res.json(links);
    });

    // Get linked entities for a specific entity
    app.get('/api/xref/entities/:type/:id/related', (req: Request, res: Response) => {
      const type = req.params.type as CrossReferenceEntityType;
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const related = store.getLinkedEntities(type, id);
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

      const path = store.findCrossReferencePath(sourceType, sourceId, targetType, targetId, maxDepth);

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
