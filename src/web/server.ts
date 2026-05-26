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
import * as systemdNotify from 'systemd-notify';
import { WebSocketServer, WebSocket } from 'ws';
import { LogEvent, EventFilter, CrossReferenceEntityType, CrossReferenceRelationship, DagOptions, BeadStatus, SemanticNarrative, NarrativeSegment } from '../types.js';
import { InMemoryEventStore } from '../store.js';
import { refreshDependencyGraph, getDagStats } from '../tui/dagUtils.js';
import { normalizeToLogEvent, EventDeduplicator } from '../normalizer.js';
import { computeFleetAnalytics } from '../analytics.js';
import { createOtlpHttpRouter } from '../otlpHttpReceiver.js';
import { ServerMetrics } from '../serverMetrics.js';
import { SessionDigestGenerator, formatDigestAsMarkdown } from '../sessionDigest.js';
import { parseGitEvents } from '../gitParser.js';
import { generatePRPreview } from '../tui/utils/prPreview.js';
import { getMemoryProfiler } from '../memoryProfiler.js';
import { getRecentHeapDiff, analyzeTrend, formatTrendAsMarkdown, saveTrendReport } from '../heapDiff.js';
import { computeRetentionState, pruneLogs, formatPruneResult, PruneOptions } from '../logPruner.js';
import { scanBeadWorkspaces } from '../beadWorkspaceScanner.js';

/** Get the v8 module (available in Node.js) */
function getV8() {
  try {
    // @ts-ignore - v8 module exists in Node.js but not in TypeScript types
    return require('v8');
  } catch {
    return null;
  }
}

/** Format bytes to human readable string. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

/** Maximum payload size for POST requests (64KB) */
const MAX_PAYLOAD_SIZE = 64 * 1024;

/** Maximum number of events in a batch request */
const MAX_BATCH_SIZE = 100;

/** Maximum buffered bytes per WebSocket client before termination. */
const WS_MAX_BUFFERED_BYTES = 1024 * 1024; // 1 MB

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Send a systemd sd_notify message. */
function sdNotify(state: string): void {
  try {
    systemdNotify.notify(state);
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
  /** CLI filter for worker/level - applied at tailer level */
  cliFilter?: import('../types.js').EventFilter;
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
  const { port, logPath, store, authToken, otlpHttpPort, maxEventCount, deduplicator, cliFilter } = options;
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
          collisions: store.getCollisions(),
          filter: cliFilter ? { worker: cliFilter.worker, level: cliFilter.level } : undefined,
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

      // Add memory stats from profiler
      const profiler = getMemoryProfiler();
      const memoryStats = profiler.getStats();

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
        memory: {
          rss: memoryStats.current.rss,
          heap_used: memoryStats.current.heapUsed,
          heap_total: memoryStats.current.heapTotal,
          external: memoryStats.current.external,
          array_buffers: memoryStats.current.arrayBuffers,
          trend: memoryStats.trend,
          avg_rss: memoryStats.avgRss,
          max_rss: memoryStats.maxRss,
          min_rss: memoryStats.minRss,
        },
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

    // ============================================
    // Log Retention API Endpoints
    // ============================================

    // Get current log retention state
    app.get('/api/retention', (_req: Request, res: Response) => {
      const policy = {
        archiveAfterDays: 3,
        maxAgeDays: 7,
        archiveRetentionDays: 30,
      };
      const state = computeRetentionState(logPath, policy);

      // Find the most recent mend.logs_pruned event from the store
      const pruneEvents = store.query().filter(e => e.msg === 'mend.logs_pruned');
      const lastPrune = pruneEvents.length > 0 ? pruneEvents[pruneEvents.length - 1] : null;

      res.json({
        current: {
          fileCount: state.fileCount,
          totalSizeBytes: state.totalSizeBytes,
          oldestFileAgeDays: Math.round(state.oldestFileAgeDays * 10) / 10,
          formattedSize: formatBytes(state.totalSizeBytes),
        },
        archives: {
          count: state.archiveCount,
          totalSizeBytes: state.archiveSizeBytes,
          formattedSize: formatBytes(state.archiveSizeBytes),
        },
        policy: state.policy,
        lastPrune: lastPrune ? {
          timestamp: lastPrune.timestamp,
          filesArchived: (lastPrune as Record<string, unknown>).files_archived,
          filesDeleted: (lastPrune as Record<string, unknown>).files_deleted,
          bytesFreed: (lastPrune as Record<string, unknown>).bytes_freed,
        } : null,
      });
    });

    // Trigger manual log pruning (requires auth)
    app.post('/api/retention/prune', (req: Request, res: Response) => {
      if (authToken) {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ') || authHeader.slice(7) !== authToken) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
      }

      // Parse optional overrides from request body
      const options: Partial<PruneOptions> = { logDir: logPath };
      if (req.body) {
        if (typeof req.body.archiveAfterDays === 'number') {
          options.archiveAfterDays = req.body.archiveAfterDays;
        }
        if (typeof req.body.archiveRetentionDays === 'number') {
          options.archiveRetentionDays = req.body.archiveRetentionDays;
        }
        if (typeof req.body.maxAgeDays === 'number') {
          options.maxAgeDays = req.body.maxAgeDays;
        }
        if (typeof req.body.dryRun === 'boolean') {
          options.dryRun = req.body.dryRun;
        }
      }

      try {
        const result = pruneLogs(options);
        res.json({
          success: true,
          result: {
            filesScanned: result.filesScanned,
            filesArchived: result.filesArchived,
            filesDeleted: result.filesDeleted,
            archivesCreated: result.archivesCreated,
            archivesDeleted: result.archivesDeleted,
            bytesFreed: result.bytesFreed,
            fileCountBefore: result.fileCountBefore,
            fileCountAfter: result.fileCountAfter,
            archivesBefore: result.archivesBefore,
            archivesAfter: result.archivesAfter,
            durationMs: result.durationMs,
            formattedBytesFreed: formatBytes(result.bytesFreed),
          },
          summary: formatPruneResult(result, options.dryRun ?? false),
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // ============================================
    // Memory Profiling API Endpoints
    // ============================================

    // Get current memory usage stats
    app.get('/api/memory/stats', (_req: Request, res: Response) => {
      const profiler = getMemoryProfiler();
      const stats = profiler.getStats();
      res.json(stats);
    });

    // Capture a memory snapshot
    app.post('/api/memory/capture', (_req: Request, res: Response) => {
      const profiler = getMemoryProfiler();
      const snapshot = profiler.capture();
      res.json({
        timestamp: snapshot.timestamp,
        rss: snapshot.rss,
        heapUsed: snapshot.heapUsed,
        heapTotal: snapshot.heapTotal,
        formatted: profiler.formatMemory(snapshot),
      });
    });

    // Get memory diff from baseline
    app.get('/api/memory/diff', (_req: Request, res: Response) => {
      const profiler = getMemoryProfiler();
      const diff = profiler.diffFromBaseline();
      if (!diff) {
        res.status(404).json({ error: 'No baseline set' });
        return;
      }
      res.json(diff);
    });

    // Set baseline for future comparisons
    app.post('/api/memory/baseline', (_req: Request, res: Response) => {
      const profiler = getMemoryProfiler();
      const baseline = profiler.setBaseline();
      res.json({
        timestamp: baseline.timestamp,
        formatted: profiler.formatMemory(baseline),
      });
    });

    // Write heap snapshot to disk (admin only - requires auth)
    app.post('/api/memory/heap-snapshot', (req: Request, res: Response) => {
      try {
        const profiler = getMemoryProfiler();
        profiler.writeHeapSnapshot().then(filepath => {
          res.json({
            success: true,
            filepath,
            message: `Heap snapshot written to ${filepath}`,
          });
        }).catch(err => {
          res.status(500).json({
            error: 'Failed to write heap snapshot',
            message: err instanceof Error ? err.message : 'Unknown error',
          });
        });
      } catch (err) {
        res.status(500).json({
          error: 'Failed to write heap snapshot',
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    });

    // Get recent memory snapshots
    app.get('/api/memory/snapshots', (req: Request, res: Response) => {
      const count = parseInt(req.query.count as string) || 10;
      const profiler = getMemoryProfiler();
      const snapshots = profiler.getRecent(count);
      res.json({
        count: snapshots.length,
        snapshots: snapshots.map(s => ({
          timestamp: s.timestamp,
          rss: s.rss,
          heapUsed: s.heapUsed,
          heapTotal: s.heapTotal,
        })),
      });
    });

    // ============================================
    // Heap Diff Analysis API Endpoints
    // ============================================

    // Get recent heap diff analysis
    app.get('/api/memory/diff-analysis', (_req: Request, res: Response) => {
      const diff = getRecentHeapDiff();
      if (!diff) {
        res.status(404).json({ error: 'Insufficient snapshots for diff analysis' });
        return;
      }
      res.json(diff);
    });

    // Get full trend analysis across all snapshots
    app.get('/api/memory/trend', (_req: Request, res: Response) => {
      const trend = analyzeTrend();
      res.json(trend);
    });

    // Get trend analysis as markdown report
    app.get('/api/memory/trend.md', (_req: Request, res: Response) => {
      const trend = analyzeTrend();
      if (trend.overallAssessment === 'insufficient-data') {
        res.status(404).json({ error: 'Insufficient snapshots for trend analysis' });
        return;
      }
      res.type('text/markdown').send(formatTrendAsMarkdown(trend));
    });

    // Generate and save a trend report
    app.post('/api/memory/trend/save', (req: Request, res: Response) => {
      const filepath = saveTrendReport();
      if (!filepath) {
        res.status(404).json({ error: 'Insufficient snapshots for trend report' });
        return;
      }
      res.json({
        success: true,
        filepath,
        message: `Trend report saved to ${filepath}`,
      });
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

    // Get heatmap timelapse data for animation
    app.get('/api/heatmap/timelapse', (req: Request, res: Response) => {
      try {
        const startTimestamp = req.query.startTimestamp
          ? parseInt(req.query.startTimestamp as string)
          : undefined;
        const endTimestamp = req.query.endTimestamp
          ? parseInt(req.query.endTimestamp as string)
          : undefined;
        const snapshotCount = req.query.snapshotCount
          ? parseInt(req.query.snapshotCount as string)
          : 30;
        const minModifications = req.query.minModifications
          ? parseInt(req.query.minModifications as string)
          : 1;
        const maxEntries = req.query.maxEntries
          ? parseInt(req.query.maxEntries as string)
          : 50;
        const sortBy = req.query.sortBy as 'modifications' | 'recent' | 'workers' | 'collisions' || undefined;
        const directoryFilter = req.query.directoryFilter as string | undefined;
        const collisionsOnly = req.query.collisionsOnly === 'true';

        const timelapse = store.getHeatmapTimelapse({
          startTimestamp,
          endTimestamp,
          snapshotCount,
          minModifications,
          maxEntries,
          sortBy,
          directoryFilter,
          collisionsOnly,
        });

        res.json(timelapse);
      } catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
      }
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

    // Productivity analytics — daily throughput + worker leaderboard + project breakdown
    app.get('/api/productivity', (_req: Request, res: Response) => {
      try {
        const now = Date.now();
        const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

        // Count bead completions by day from in-memory events
        const dayCounts = new Map<string, number>();
        for (const event of store.query({})) {
          if (
            event.msg === 'bead.released' &&
            (event as Record<string, unknown>)['reason'] === 'release_success' &&
            event.ts >= thirtyDaysAgo
          ) {
            const date = new Date(event.ts).toISOString().slice(0, 10);
            dayCounts.set(date, (dayCounts.get(date) ?? 0) + 1);
          }
        }

        // Fill in all 30 days (including zeros)
        const daily: { date: string; count: number }[] = [];
        for (let i = 29; i >= 0; i--) {
          const d = new Date(now - i * 24 * 60 * 60 * 1000);
          const date = d.toISOString().slice(0, 10);
          daily.push({ date, count: dayCounts.get(date) ?? 0 });
        }

        // Worker leaderboard
        const workers = store.getWorkers().map((w) => {
          const spanMs = Math.max(w.lastActivity - w.firstSeen, 1);
          const beadsPerHour = parseFloat(
            ((w.beadsCompleted / spanMs) * 3600000).toFixed(2)
          );
          return { id: w.id, beadsCompleted: w.beadsCompleted, beadsPerHour };
        });
        workers.sort((a, b) => b.beadsCompleted - a.beadsCompleted);

        // Project breakdown from bead workspace scanner
        const { byProject } = scanBeadWorkspaces();

        res.json({ daily, workers, byProject });
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
          // Use store's getSemanticNarrativeManager getter to access the manager
          const narrative = store.getSemanticNarrativeManager().generateNarrative(worker.id);
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
        // Use store's getSemanticNarrativeManager getter to access the manager
        const narrative = store.getSemanticNarrativeManager().generateNarrative(workerId);
        res.json(serializeNarrative(narrative));
      } catch (err) {
        console.error('Error generating narrative:', err);
        res.status(500).json({ error: 'Failed to generate narrative' });
      }
    });

    // ============================================
    // Conversation Transcript API
    // ============================================

    // Get all conversation sessions
    app.get('/api/conversations/sessions', (_req: Request, res: Response) => {
      try {
        const sessions = store.getConversationSessions();
        res.json(sessions);
      } catch (err) {
        console.error('Error getting conversation sessions:', err);
        res.status(500).json({ error: 'Failed to get conversation sessions' });
      }
    });

    // Get conversation sessions for a specific worker
    app.get('/api/conversations/workers/:workerId', (req: Request, res: Response) => {
      try {
        const workerId = req.params.workerId as string;
        const sessions = store.getWorkerConversationSessions(workerId);
        res.json(sessions);
      } catch (err) {
        console.error('Error getting worker conversation sessions:', err);
        res.status(500).json({ error: 'Failed to get worker conversation sessions' });
      }
    });

    // Get conversation session for a specific bead
    app.get('/api/conversations/beads/:beadId', (req: Request, res: Response) => {
      try {
        const beadId = req.params.beadId as string;
        const session = store.getBeadConversationSession(beadId);
        if (!session) {
          res.status(404).json({ error: 'Conversation session not found' });
          return;
        }
        res.json(session);
      } catch (err) {
        console.error('Error getting bead conversation session:', err);
        res.status(500).json({ error: 'Failed to get bead conversation session' });
      }
    });

    // Get a specific conversation session by ID
    app.get('/api/conversations/:sessionId', (req: Request, res: Response) => {
      try {
        const sessionId = req.params.sessionId as string;
        const session = store.getConversationSession(sessionId);
        if (!session) {
          res.status(404).json({ error: 'Conversation session not found' });
          return;
        }
        res.json(session);
      } catch (err) {
        console.error('Error getting conversation session:', err);
        res.status(500).json({ error: 'Failed to get conversation session' });
      }
    });

    // Get all conversation events across all sessions
    app.get('/api/conversations/events', (_req: Request, res: Response) => {
      try {
        const events = store.getConversationEvents();
        res.json(events);
      } catch (err) {
        console.error('Error getting conversation events:', err);
        res.status(500).json({ error: 'Failed to get conversation events' });
      }
    });

    // Get conversation events for a specific worker
    app.get('/api/conversations/workers/:workerId/events', (req: Request, res: Response) => {
      try {
        const workerId = req.params.workerId as string;
        const events = store.getWorkerConversationEvents(workerId);
        res.json(events);
      } catch (err) {
        console.error('Error getting worker conversation events:', err);
        res.status(500).json({ error: 'Failed to get worker conversation events' });
      }
    });

    // Get conversation events for a specific bead
    app.get('/api/conversations/beads/:beadId/events', (req: Request, res: Response) => {
      try {
        const beadId = req.params.beadId as string;
        const events = store.getBeadConversationEvents(beadId);
        res.json(events);
      } catch (err) {
        console.error('Error getting bead conversation events:', err);
        res.status(500).json({ error: 'Failed to get bead conversation events' });
      }
    });

    // ============================================
    // Historical Sessions API Endpoints
    // ============================================

    // Get historical sessions list (paginated, with time range filter)
    app.get('/api/sessions', (req: Request, res: Response) => {
      try {
        const historical = store.getHistoricalStore();
        const startTime = req.query.start ? parseInt(req.query.start as string) : undefined;
        const endTime = req.query.end ? parseInt(req.query.end as string) : undefined;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;

        const sessions = historical.getSessions({
          startTime,
          endTime,
          limit,
        });

        res.json({
          sessions,
          count: sessions.length,
        });
      } catch (error) {
        console.error('Error fetching sessions:', error);
        res.status(500).json({
          error: 'Failed to fetch sessions',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Get a specific session by ID
    app.get('/api/sessions/:id', (req: Request, res: Response) => {
      try {
        const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const historical = store.getHistoricalStore();
        const session = historical.getSession(sessionId);

        if (!session) {
          res.status(404).json({ error: 'Session not found' });
          return;
        }

        // Get worker summaries for this session
        const workerSummaries = historical.getSessionWorkerSummaries({ sessionId });

        res.json({
          session,
          workerSummaries,
        });
      } catch (error) {
        console.error('Error fetching session:', error);
        res.status(500).json({
          error: 'Failed to fetch session',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Get worker summaries for a specific session
    app.get('/api/sessions/:id/workers', (req: Request, res: Response) => {
      try {
        const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const historical = store.getHistoricalStore();
        const workerSummaries = historical.getSessionWorkerSummaries({ sessionId });

        res.json({
          sessionId,
          workers: workerSummaries,
          count: workerSummaries.length,
        });
      } catch (error) {
        console.error('Error fetching session workers:', error);
        res.status(500).json({
          error: 'Failed to fetch session workers',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // ============================================
    // Worker Comparison Analytics API Endpoints
    // ============================================

    // Compare two workers side-by-side
    app.get('/api/workers/compare', (req: Request, res: Response) => {
      try {
        const worker1 = req.query.worker1 as string;
        const worker2 = req.query.worker2 as string;

        if (!worker1 || !worker2) {
          res.status(400).json({ error: 'Missing required parameters: worker1 and worker2' });
          return;
        }

        const analytics = store.getWorkerAnalytics();
        const comparison = analytics.compareWorkers(worker1, worker2);

        if (!comparison) {
          res.status(404).json({ error: 'One or both workers not found' });
          return;
        }

        res.json(comparison);
      } catch (error) {
        console.error('Error comparing workers:', error);
        res.status(500).json({
          error: 'Failed to compare workers',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Get per-worker metrics for leaderboard table
    app.get('/api/analytics/workers', (req: Request, res: Response) => {
      try {
        const analytics = store.getWorkerAnalytics();
        const sortBy = req.query.sortBy as 'beadsCompleted' | 'beadsPerHour' | 'errorRate' | 'costPerBead' | 'efficiencyScore' | undefined;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;

        let workers = analytics.getAllWorkerMetrics();

        // Apply sort if specified
        if (sortBy) {
          const lowerIsBetter = ['errorRate', 'costPerBead'].includes(sortBy);
          workers.sort((a, b) => lowerIsBetter
            ? (a[sortBy] as number) - (b[sortBy] as number)
            : (b[sortBy] as number) - (a[sortBy] as number)
          );
        }

        // Apply limit if specified
        if (limit && limit > 0) {
          workers = workers.slice(0, limit);
        }

        res.json({
          workers,
          count: workers.length,
        });
      } catch (error) {
        console.error('Error fetching worker metrics:', error);
        res.status(500).json({
          error: 'Failed to fetch worker metrics',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Get historical sessions for cross-session comparisons
    app.get('/api/analytics/sessions', (req: Request, res: Response) => {
      try {
        const historical = store.getHistoricalStore();
        const startTime = req.query.start ? parseInt(req.query.start as string) : undefined;
        const endTime = req.query.end ? parseInt(req.query.end as string) : undefined;
        const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;

        const sessions = historical.getSessions({
          startTime,
          endTime,
          limit,
        });

        res.json({
          sessions,
          count: sessions.length,
        });
      } catch (error) {
        console.error('Error fetching historical sessions:', error);
        res.status(500).json({
          error: 'Failed to fetch historical sessions',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
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

    // Memory pressure monitoring: log warnings when approaching heap limit
    let lastMemoryLog = 0;
    const memoryCheckInterval = setInterval(() => {
      const mem = process.memoryUsage();
      const v8 = getV8();
      const heapLimitBytes = v8?.getHeapStatistics?.().heap_size_limit ?? 1024 * 1024 * 1024; // 1GB default
      const heapUsagePercent = (mem.heapUsed / heapLimitBytes) * 100;
      const profiler = getMemoryProfiler();
      profiler.capture();

      // Log memory stats every 5 minutes
      const now = Date.now();
      if (!lastMemoryLog || now - lastMemoryLog > 5 * 60 * 1000) {
        console.error(`Memory: RSS=${formatBytes(mem.rss)}, Heap=${formatBytes(mem.heapUsed)}/${formatBytes(mem.heapTotal)} (${heapUsagePercent.toFixed(1)}%), external=${formatBytes(mem.external)}, arrayBuffers=${formatBytes(mem.arrayBuffers)}`);
        lastMemoryLog = now;
      }

      // Warn when approaching heap limit (>80%)
      if (heapUsagePercent > 80) {
        console.warn(`Memory pressure warning: heap usage at ${heapUsagePercent.toFixed(1)}% of limit`);
      }
    }, 30_000);
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
    // Serialize once, reuse for all clients (reduces JSON.stringify overhead)
    const message = JSON.stringify({ type: 'event', data: event });
    const terminatedClients: WebSocket[] = [];

    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        // Backpressure: terminate clients whose send buffer exceeds the limit
        if (client.bufferedAmount > WS_MAX_BUFFERED_BYTES) {
          console.warn(`WebSocket client buffer exceeded ${WS_MAX_BUFFERED_BYTES} bytes — terminating`);
          client.close(1013, 'Send buffer overflow');
          terminatedClients.push(client);
          continue;
        }
        client.send(message);
      }
    }

    // Clean up terminated clients from the set
    for (const client of terminatedClients) {
      clients.delete(client);
    }
  }

  function broadcastCollisions(): void {
    const collisions = store.getCollisions();
    // Serialize once, reuse for all clients
    const message = JSON.stringify({
      type: 'collision',
      data: {
        collisions,
        workers: store.getWorkers()
      }
    });
    const terminatedClients: WebSocket[] = [];

    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        if (client.bufferedAmount > WS_MAX_BUFFERED_BYTES) {
          client.close(1013, 'Send buffer overflow');
          terminatedClients.push(client);
          continue;
        }
        client.send(message);
      }
    }

    for (const client of terminatedClients) {
      clients.delete(client);
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
