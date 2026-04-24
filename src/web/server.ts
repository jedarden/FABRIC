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
import { createSocket } from 'dgram';
import { WebSocketServer, WebSocket } from 'ws';
import { LogEvent, EventFilter, CrossReferenceEntityType, CrossReferenceRelationship, DagOptions, BeadStatus, SemanticNarrative, NarrativeSegment } from '../types.js';
import { InMemoryEventStore } from '../store.js';
import { SemanticNarrativeGenerator } from '../semanticNarrative.js';
import { refreshDependencyGraph, getDagStats } from '../tui/dagUtils.js';
import { normalizeToLogEvent, EventDeduplicator } from '../normalizer.js';
import { computeFleetAnalytics } from '../analytics.js';
import { createOtlpHttpRouter } from '../otlpHttpReceiver.js';
import { ServerMetrics } from '../serverMetrics.js';
import { SessionDigestGenerator, formatDigestAsMarkdown } from '../sessionDigest.js';
import { parseGitEvents } from '../gitParser.js';
import { generatePRPreview } from '../tui/utils/prPreview.js';

/** Maximum payload size for POST requests (64KB) */
const MAX_PAYLOAD_SIZE = 64 * 1024;

/** Maximum number of events in a batch request */
const MAX_BATCH_SIZE = 100;

/** Maximum buffered bytes per WebSocket client before termination. */
const WS_MAX_BUFFERED_BYTES = 1024 * 1024; // 1 MB

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Send a systemd sd_notify message via the NOTIFY_SOCKET Unix datagram socket. */
function sdNotify(state: string): void {
  const socketPath = process.env.NOTIFY_SOCKET;
  if (!socketPath) return;
  try {
    const client = createSocket('unix_dgram');
    const msg = Buffer.from(state);
    // Abstract sockets start with '@' in systemd notation; replace with '\0'
    const addr = socketPath.startsWith('@') ? '\0' + socketPath.slice(1) : socketPath;
    client.send(msg, 0, msg.length, addr, () => client.close());
  } catch {
    // Never crash the server due to a notify failure
  }
}

export interface WebServerOptions {
  port: number;
  logPath: string;
  store: InMemoryEventStore;
  /** Optional auth token for POST endpoints. If provided, requires Bearer token in Authorization header */
  authToken?: string;
  /** When set, creates a second HTTP listener on this port for OTLP/HTTP traffic. */
  otlpHttpPort?: number;
  /** Max events allowed in the store before liveness check fails (memory-bomb guard). */
  maxEventCount?: number;
  /** Shared deduplicator — exposes dedup_dropped in /api/health. */
  deduplicator?: EventDeduplicator;
}

export interface WebServer extends EventEmitter {
  start(): void;
  stop(): void;
  getPort(): number;
  broadcast(event: LogEvent): void;
  broadcastCollisions(): void;
  recordEvent(): void;
  setTailerFilesWatched(count: number): void;
}

/**
 * Create the FABRIC web server
 */
export function createWebServer(options: WebServerOptions): WebServer {
  const { port, logPath, store, authToken, otlpHttpPort, maxEventCount, deduplicator } = options;
  const emitter = new EventEmitter();
  const metrics = new ServerMetrics();

  let app: Express;
  let httpServer: HttpServer;
  let otlpHttpServer: HttpServer | undefined;
  let wsServer: WebSocketServer;
  let running = false;
  const clients: Set<WebSocket> = new Set();

  function start() {
    if (running) return;

    app = express();
    httpServer = createServer(app);
    wsServer = new WebSocketServer({ server: httpServer });

    // ── Auth middleware for all POST routes ──
    const authMiddleware = (req: Request, res: Response, next: () => void) => {
      if (!authToken) {
        next();
        return;
      }

      const authHeader = req.headers.authorization;
      if (!authHeader) {
        res.status(401).json({ error: 'Missing authorization', message: 'Authorization header required' });
        return;
      }

      const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/);
      if (!tokenMatch || tokenMatch[1] !== authToken) {
        res.status(403).json({ error: 'Forbidden', message: 'Invalid or expired token' });
        return;
      }

      next();
    };

    // Apply auth to all POST requests (event ingestion, OTLP, etc.)
    app.use((req, res, next) => {
      if (req.method === 'POST') {
        authMiddleware(req, res, next);
      } else {
        next();
      }
    });

    // ── OTLP/HTTP routes (mounted before json middleware so raw body is available) ──
    if (otlpHttpPort) {
      const otlpRouter = createOtlpHttpRouter({
        onEvent: (event: LogEvent) => {
          store.add(event);
          metrics.recordEvent();
          broadcast(event);
        },
      });
      app.use(otlpRouter);
    }

    // Parse JSON bodies
    app.use(express.json({ limit: MAX_PAYLOAD_SIZE.toString() }));

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
      metrics.wsClients = clients.size;
      metrics.dedupDropped = deduplicator?.droppedCount ?? 0;
      metrics.eventCount = store.size;
      const snap = metrics.snapshot();
      const overloaded = maxEventCount != null && store.size > maxEventCount;
      if (overloaded) snap.status = 'overloaded';
      res.status(overloaded ? 503 : 200).json({
        status: snap.status,
        uptime_sec: snap.uptime_sec,
        version: snap.version,
        event_count: snap.event_count,
        ingest_rate_per_sec: snap.ingest_rate_per_sec,
        ws_clients: snap.ws_clients,
        tailer_files_watched: snap.tailer_files_watched,
        dedup_dropped: snap.dedup_dropped,
        process_resident_memory_bytes: snap.process_resident_memory_bytes,
      });
    });

    // Prometheus metrics endpoint
    app.get('/api/metrics', (_req: Request, res: Response) => {
      metrics.wsClients = clients.size;
      metrics.dedupDropped = deduplicator?.droppedCount ?? 0;
      metrics.eventCount = store.size;
      const snap = metrics.snapshot();
      const overloaded = maxEventCount != null && store.size > maxEventCount;
      if (overloaded) snap.status = 'overloaded';
      res.type('text/plain').send(metrics.toPrometheus(snap));
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
        const logEvent = normalizeToLogEvent(eventObj, 'jsonl');
        if (!logEvent) {
          res.status(400).json({ error: 'Invalid event format', message: 'Failed to parse event object' });
          return;
        }

        // Store the event
        store.add(logEvent);
        metrics.recordEvent();

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
          const logEvent = normalizeToLogEvent(eventObj, 'jsonl');
          if (!logEvent) {
            errors.push({ index: i, error: 'Failed to parse event object' });
            continue;
          }

          // Store the event
          store.add(logEvent);
          metrics.recordEvent();
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
    // Recovery API Endpoints
    // ============================================

    // Get all recovery suggestions
    app.get('/api/recovery/suggestions', (_req: Request, res: Response) => {
      const suggestions = store.getRecoverySuggestions();
      res.json(suggestions);
    });

    // Get recovery statistics
    app.get('/api/recovery/stats', (_req: Request, res: Response) => {
      const stats = store.getRecoveryStats();
      res.json(stats);
    });

    // Get recovery suggestions for a specific worker
    app.get('/api/recovery/workers/:id', (req: Request, res: Response) => {
      const workerId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const suggestions = store.getWorkerRecoverySuggestions(workerId);
      res.json(suggestions);
    });

    // ============================================
    // Git Integration API Endpoints
    // ============================================

    // Get live git status derived from ingested log events
    app.get('/api/git/status', (req: Request, res: Response) => {
      try {
        const workerFilter = req.query.worker as string | undefined;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 500;

        // Fetch events and parse git events from them
        const filter: EventFilter = {};
        if (workerFilter) filter.worker = workerFilter;
        const allEvents = store.query(filter).slice(-limit);
        const gitEvents = parseGitEvents(allEvents);

        // Extract latest status event
        const statusEvents = gitEvents.filter(e => e.type === 'status');
        const currentStatus = statusEvents.length > 0 ? statusEvents[statusEvents.length - 1] : null;

        // Extract recent commits
        const commitEvents = gitEvents.filter(e => e.type === 'commit');
        const recentCommits = commitEvents.slice(-10);

        // Check for conflicts (unmerged files in staged/unstaged)
        let hasConflicts = false;
        if (currentStatus && currentStatus.type === 'status') {
          hasConflicts =
            currentStatus.staged.some(f => f.status === 'unmerged') ||
            currentStatus.unstaged.some(f => f.status === 'unmerged');
        }

        // Build worker attribution map: file path → worker IDs
        const fileWorkerMap: Record<string, string[]> = {};
        for (const event of gitEvents) {
          if (event.type === 'status' && event.type === 'status') {
            for (const file of [...event.staged, ...event.unstaged]) {
              if (!fileWorkerMap[file.path]) fileWorkerMap[file.path] = [];
              if (!fileWorkerMap[file.path].includes(event.worker)) {
                fileWorkerMap[file.path].push(event.worker);
              }
            }
          }
        }

        // Generate PR preview
        const prPreview = gitEvents.length > 0 ? generatePRPreview(gitEvents) : null;

        res.json({
          status: currentStatus,
          commits: recentCommits,
          prPreview,
          hasConflicts,
          fileWorkerMap,
          totalGitEvents: gitEvents.length,
          updatedAt: Date.now(),
        });
      } catch (error) {
        console.error('Error generating git status:', error);
        res.status(500).json({
          error: 'Failed to generate git status',
          message: error instanceof Error ? error.message : 'Unknown error',
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

    // ============================================
    // Cost & Budget API Endpoints
    // ============================================

    // Get cost summary
    app.get('/api/cost/summary', (_req: Request, res: Response) => {
      const costTracker = store.getCostTracker();
      const summary = costTracker.getSummary();

      res.json({
        totalCostUsd: summary.totalCostUsd,
        totalTokens: summary.total,
        inputTokens: summary.total.input,
        outputTokens: summary.total.output,
        budget: summary.budget,
        burnRate: summary.burnRate,
        timeRange: summary.timeRange,
        workerCount: summary.byWorker.size,
      });
    });

    // Get burn rate details
    app.get('/api/cost/burn-rate', (req: Request, res: Response) => {
      const costTracker = store.getCostTracker();
      const sinceMinutes = parseInt(req.query.since as string) || 60;
      const history = costTracker.getBurnRateHistory(sinceMinutes);

      res.json({
        current: costTracker.getSummary().burnRate,
        history,
      });
    });

    // Get per-worker cost breakdown
    app.get('/api/cost/workers', (_req: Request, res: Response) => {
      const costTracker = store.getCostTracker();
      const summary = costTracker.getSummary();
      const workers = Array.from(summary.byWorker.values())
        .sort((a, b) => b.costUsd - a.costUsd)
        .map(w => ({
          workerId: w.workerId,
          costUsd: w.costUsd,
          inputTokens: w.input,
          outputTokens: w.output,
          totalTokens: w.total,
          apiCalls: w.apiCalls,
          currentBead: w.currentBead,
          lastActivityTs: w.lastActivityTs,
        }));

      res.json({
        workers,
        totalCostUsd: summary.totalCostUsd,
      });
    });

    // Get per-bead cost breakdown
    app.get('/api/cost/beads', (_req: Request, res: Response) => {
      const costTracker = store.getCostTracker();
      const beads = costTracker.getBeadCosts()
        .map(b => ({
          beadId: b.beadId,
          costUsd: b.costUsd,
          inputTokens: b.input,
          outputTokens: b.output,
          apiCalls: b.apiCalls,
          workerCount: b.workers.size,
          workers: Array.from(b.workers),
          durationMinutes: b.durationMinutes,
          firstTs: b.firstTs,
          lastTs: b.lastTs,
        }));

      res.json({ beads });
    });

    // Get cost time-series for trend charts
    app.get('/api/cost/history', (req: Request, res: Response) => {
      const costTracker = store.getCostTracker();
      const sinceMinutes = parseInt(req.query.since as string) || 60;
      const bucketMinutes = parseInt(req.query.bucket as string) || 5;

      const timeSeries = costTracker.getAggregatedTimeSeries(sinceMinutes, bucketMinutes);

      res.json({
        timeSeries,
        sinceMinutes,
        bucketMinutes,
      });
    });

    // Get budget alerts
    app.get('/api/cost/alerts', (_req: Request, res: Response) => {
      const costTracker = store.getCostTracker();
      const alerts = costTracker.getAlerts();
      const allAlerts = costTracker.getAllAlerts();

      res.json({
        active: alerts,
        all: allAlerts,
      });
    });

    // Acknowledge a budget alert
    app.post('/api/cost/alerts/:id/acknowledge', (req: Request, res: Response) => {
      const alertId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const costTracker = store.getCostTracker();
      costTracker.acknowledgeAlert(alertId);
      res.json({ success: true });
    });

    // ============================================
    // Error Group API Endpoints
    // ============================================

    // Get all error groups
    app.get('/api/errors/groups', (req: Request, res: Response) => {
      const activeOnly = req.query.activeOnly === 'true';
      const groups = activeOnly
        ? store.getActiveErrorGroups()
        : store.getErrorGroups();

      // Serialize for the wire — events can be large, send a trimmed version
      const trimmed = groups.map(g => ({
        id: g.id,
        fingerprint: g.fingerprint,
        firstSeen: g.firstSeen,
        lastSeen: g.lastSeen,
        count: g.count,
        affectedWorkers: g.affectedWorkers,
        isActive: g.isActive,
        severity: g.severity,
        recentEvents: g.events.slice(-5).map(e => ({
          timestamp: e.timestamp,
          level: e.level,
          worker: e.worker,
          message: e.message,
          tool: e.tool,
          ts: e.ts,
          error: (e as Record<string, unknown>).error as string | undefined,
        })),
        sampleStack: (() => {
          const withStack = g.events.find(e => (e as Record<string, unknown>).error && String((e as Record<string, unknown>).error).includes('\n'));
          return withStack ? String((withStack as Record<string, unknown>).error) : undefined;
        })(),
      }));

      res.json(trimmed);
    });

    // Get error group statistics
    app.get('/api/errors/stats', (_req: Request, res: Response) => {
      const stats = store.getErrorStats();
      res.json(stats);
    });

    // Find similar past errors from error_history
    app.get('/api/errors/history/similar', (req: Request, res: Response) => {
      const message = req.query.message as string;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;

      if (!message) {
        res.status(400).json({ error: 'Missing required parameter: message' });
        return;
      }

      const similar = store.historical.findSimilarErrors(message, limit);
      res.json(similar);
    });

    // Get historical error records
    app.get('/api/errors/history', (req: Request, res: Response) => {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
      const workerId = req.query.worker as string | undefined;
      const errorType = req.query.errorType as string | undefined;

      const records = store.historical.getErrorHistory({
        limit,
        workerId,
        errorType,
      });

      res.json(records);
    });

    // Fleet analytics — reads log files fresh on each request
    app.get('/api/analytics', (_req: Request, res: Response) => {
      try {
        const analytics = computeFleetAnalytics();
        res.json(analytics);
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    app.get('/api/digest', (req: Request, res: Response) => {
      try {
        const generator = new SessionDigestGenerator(store);
        const opts: Record<string, unknown> = {};
        if (req.query.startTime) opts.startTime = Number(req.query.startTime);
        if (req.query.endTime) opts.endTime = Number(req.query.endTime);
        const digest = generator.generateDigest(opts);
        res.json(digest);
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // ============================================
    // Semantic Narrative API Endpoints
    // ============================================

    function serializeNarrative(narrative: SemanticNarrative) {
      return {
        ...narrative,
        segments: narrative.segments.map((s: NarrativeSegment) => ({
          id: s.id,
          pattern: s.pattern,
          summary: s.summary,
          details: s.details,
          startTime: s.startTime,
          endTime: s.endTime,
          durationMs: s.durationMs,
          workerId: s.workerId,
          beadId: s.beadId,
          entities: s.entities,
          confidence: s.confidence,
          isActive: s.isActive,
          eventCount: s.events.length,
        })),
      };
    }

    // Get narratives for all active workers
    app.get('/api/narrative', (_req: Request, res: Response) => {
      try {
        const workers = store.getWorkers().filter(w => w.status === 'active');
        const narratives = [];

        for (const worker of workers) {
          const events = store.query({ worker: worker.id });
          if (events.length === 0) continue;

          const generator = new SemanticNarrativeGenerator();
          events.forEach(e => generator.processEvent(e));
          const narrative = generator.generateNarrative(worker.id);
          narratives.push(serializeNarrative(narrative));
        }

        res.json(narratives);
      } catch (err) {
        console.error('Error generating narratives:', err);
        res.status(500).json({ error: 'Failed to generate narratives' });
      }
    });

    // Get narrative for a specific worker
    app.get('/api/narrative/:workerId', (req: Request, res: Response) => {
      try {
        const workerId = req.params.workerId as string;
        const events = store.query({ worker: workerId });

        const generator = new SemanticNarrativeGenerator();
        events.forEach(e => generator.processEvent(e));
        const narrative = generator.generateNarrative(workerId);

        res.json(serializeNarrative(narrative));
      } catch (err) {
        console.error('Error generating narrative:', err);
        res.status(500).json({ error: 'Failed to generate narrative' });
      }
    });

    // Serve static frontend files
    const staticPath = join(__dirname, 'public');
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
      if (!authToken) {
        console.warn(
          'WARNING: FABRIC_AUTH_TOKEN is not set. ' +
          'POST /api/events is unauthenticated and accepts events from any process. ' +
          'Set FABRIC_AUTH_TOKEN (or --auth-token) before exposing FABRIC outside localhost.'
        );
      }
      console.log('Press Ctrl+C to stop');

      // Notify systemd that the service is ready (Type=notify)
      sdNotify('READY=1\nSTATUS=FABRIC running\n');

      // Watchdog keepalives: ping at half the configured interval
      const watchdogUsec = parseInt(process.env.WATCHDOG_USEC ?? '0', 10);
      if (watchdogUsec > 0) {
        const intervalMs = Math.floor(watchdogUsec / 2 / 1000);
        setInterval(() => sdNotify('WATCHDOG=1'), intervalMs);
      }

      emitter.emit('start');
    });

    // Second HTTP listener for OTLP/HTTP traffic (port 4318 by convention)
    if (otlpHttpPort) {
      otlpHttpServer = createServer(app);
      otlpHttpServer.listen(otlpHttpPort, () => {
        console.log(`OTLP/HTTP receiver listening on 0.0.0.0:${otlpHttpPort}`);
      });
      otlpHttpServer.on('error', (err) => {
        console.error(`OTLP/HTTP listener error: ${(err as Error).message}`);
        emitter.emit('error', err);
      });
    }

    httpServer.on('error', (err) => {
      emitter.emit('error', err);
    });

    // Liveness self-check: exit non-zero if overloaded for consecutive checks
    if (maxEventCount) {
      let consecutiveFailures = 0;
      setInterval(() => {
        if (store.size > maxEventCount) {
          consecutiveFailures++;
          if (consecutiveFailures >= 3) {
            console.error(`Liveness check failed: event store (${store.size}) exceeds max (${maxEventCount}) for 3 consecutive checks — exiting`);
            process.exit(1);
          }
        } else {
          consecutiveFailures = 0;
        }
      }, 10_000);
    }
  }

  function stop() {
    if (!running || !httpServer) return;

    // Close all WebSocket connections
    for (const client of clients) {
      client.close();
    }
    clients.clear();

    const closeOtlp = () =>
      new Promise<void>((resolve) => {
        if (otlpHttpServer) {
          otlpHttpServer.close(() => resolve());
        } else {
          resolve();
        }
      });

    wsServer.close(() => {
      httpServer.close(() => {
        closeOtlp().then(() => {
          running = false;
          emitter.emit('stop');
        });
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
        // Backpressure: terminate clients whose send buffer exceeds the limit
        if (client.bufferedAmount > WS_MAX_BUFFERED_BYTES) {
          console.warn(`WebSocket client buffer exceeded ${WS_MAX_BUFFERED_BYTES} bytes — terminating`);
          client.close(1013, 'Send buffer overflow');
          clients.delete(client);
          continue;
        }
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
        if (client.bufferedAmount > WS_MAX_BUFFERED_BYTES) {
          client.close(1013, 'Send buffer overflow');
          clients.delete(client);
          continue;
        }
        client.send(message);
      }
    }
  }

  function recordEvent(): void {
    metrics.recordEvent();
  }

  function setTailerFilesWatched(count: number): void {
    metrics.tailerFilesWatched = count;
  }

  return Object.assign(emitter, { start, stop, getPort, broadcast, broadcastCollisions, recordEvent, setTailerFilesWatched });
}

export default createWebServer;
