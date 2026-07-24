/**
 * FABRIC Historical Analytics Storage
 *
 * SQLite-based persistent storage for historical session analytics.
 * Enables worker comparison across sessions and recovery playbook learning.
 *
 * Schema matches plan.md lines 1016-1124
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import {
  WorkerMetrics,
  ErrorCategory,
  AggregatedAnalytics,
} from './types.js';

// ============================================
// Type Definitions
// ============================================

/**
 * Session summary record
 */
export interface SessionRecord {
  id: string;
  started_at: number;
  ended_at: number;
  worker_count: number;
  task_count: number;
  total_cost: number;
  total_tokens: number;
  metrics_source?: string;
}

/**
 * Task metrics record
 */
export interface TaskMetricsRecord {
  id: string;
  session_id: string;
  worker_id: string;
  task_type: string;
  started_at: number;
  ended_at: number;
  duration_ms: number;
  cost: number;
  tokens_in: number;
  tokens_out: number;
  success: boolean;
  retry_count: number;
  host?: string;
}

/**
 * Error history record
 */
export interface ErrorHistoryRecord {
  id: number;
  session_id: string;
  worker_id: string;
  error_type: string;
  error_message: string;
  file_path: string | null;
  timestamp: number;
  resolution: string | null;
  resolution_successful: boolean | null;
  host?: string;
}

/**
 * Options for querying historical data
 */
export interface HistoricalQueryOptions {
  /** Start time (Unix timestamp in ms) */
  startTime?: number;
  /** End time (Unix timestamp in ms) */
  endTime?: number;
  /** Limit number of results */
  limit?: number;
  /** Filter by worker ID */
  workerId?: string;
  /** Filter by session ID */
  sessionId?: string;
  /** Filter by error type */
  errorType?: string;
  /** Filter by error category */
  errorCategory?: ErrorCategory;
  /** Include only resolved errors */
  resolvedOnly?: boolean;
}

/**
 * Worker comparison metrics across sessions
 */
export interface WorkerComparisonMetrics {
  workerId: string;
  sessionsCount: number;
  totalBeadsCompleted: number;
  avgBeadsPerSession: number;
  avgBeadsPerHour: number;
  totalErrors: number;
  avgErrorRate: number;
  totalCostUsd: number;
  avgCostPerBead: number;
  totalTokens: number;
  avgCompletionTimeMs: number;
  bestSession: SessionRecord | null;
  worstSession: SessionRecord | null;
}

/**
 * Recovery playbook learned entry
 */
export interface LearnedRecoveryEntry {
  errorType: string;
  errorPattern: string;
  resolution: string;
  successRate: number;
  occurrenceCount: number;
  avgResolutionTime: number;
  lastSeen: number;
}

// ============================================
// Database Schema
// ============================================

const SCHEMA_VERSION = 3;

const CREATE_SESSIONS_TABLE = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  worker_count INTEGER NOT NULL DEFAULT 0,
  task_count INTEGER NOT NULL DEFAULT 0,
  total_cost REAL NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_ended ON sessions(ended_at);
`;

const CREATE_TASK_METRICS_TABLE = `
CREATE TABLE IF NOT EXISTS task_metrics (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 1,
  retry_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_task_metrics_session ON task_metrics(session_id);
CREATE INDEX IF NOT EXISTS idx_task_metrics_worker ON task_metrics(worker_id);
CREATE INDEX IF NOT EXISTS idx_task_metrics_started ON task_metrics(started_at);
`;

const CREATE_ERROR_HISTORY_TABLE = `
CREATE TABLE IF NOT EXISTS error_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  file_path TEXT,
  timestamp INTEGER NOT NULL,
  resolution TEXT,
  resolution_successful INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_error_history_session ON error_history(session_id);
CREATE INDEX IF NOT EXISTS idx_error_history_worker ON error_history(worker_id);
CREATE INDEX IF NOT EXISTS idx_error_history_type ON error_history(error_type);
CREATE INDEX IF NOT EXISTS idx_error_history_timestamp ON error_history(timestamp);
`;

const CREATE_SCHEMA_VERSION_TABLE = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);
`;

const CREATE_METRIC_SAMPLES_TABLE = `
CREATE TABLE IF NOT EXISTS metric_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  value REAL NOT NULL,
  timestamp INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'otlp-metric',
  bead_id TEXT,
  session_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_metric_samples_worker ON metric_samples(worker_id);
CREATE INDEX IF NOT EXISTS idx_metric_samples_name ON metric_samples(metric_name);
CREATE INDEX IF NOT EXISTS idx_metric_samples_timestamp ON metric_samples(timestamp);
`;

const CREATE_SESSION_WORKER_SUMMARIES_TABLE = `
CREATE TABLE IF NOT EXISTS session_worker_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  beads_completed INTEGER NOT NULL DEFAULT 0,
  beads_failed INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  metrics_source TEXT NOT NULL DEFAULT 'log-derived',
  updated_at INTEGER NOT NULL,
  UNIQUE(session_id, worker_id)
);

CREATE INDEX IF NOT EXISTS idx_sws_session ON session_worker_summaries(session_id);
CREATE INDEX IF NOT EXISTS idx_sws_worker ON session_worker_summaries(worker_id);
CREATE INDEX IF NOT EXISTS idx_sws_source ON session_worker_summaries(metrics_source);
`;

// Schema v2 migration: add metrics_source column to sessions if missing
const MIGRATE_V2_ADD_METRICS_SOURCE = `
ALTER TABLE sessions ADD COLUMN metrics_source TEXT NOT NULL DEFAULT 'log-derived';
`;

// Schema v3 migration: add host column to task_metrics, error_history, metric_samples, session_worker_summaries
const MIGRATE_V3_ADD_HOST_COLUMNS = `
ALTER TABLE task_metrics ADD COLUMN host TEXT;
ALTER TABLE error_history ADD COLUMN host TEXT;
ALTER TABLE metric_samples ADD COLUMN host TEXT;
ALTER TABLE session_worker_summaries ADD COLUMN host TEXT;
`;

// ============================================
// Historical Store Class
// ============================================

/**
 * SQLite-backed historical analytics storage
 */
export class HistoricalStore {
  private db: Database.Database;
  private dbPath: string;
  private currentSessionId: string | null = null;
  private sessionStartTime: number = 0;
  private taskCounter: number = 0;
  private errorCounter: number = 0;

  /**
   * Create or open the historical store
   */
  constructor(dbPath?: string) {
    // Default to ~/.needle/fabric.db
    this.dbPath = dbPath || path.join(os.homedir(), '.needle', 'fabric.db');

    // Ensure directory exists
    const dbDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Open database
    this.db = new Database(this.dbPath);

    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');

    // Initialize schema
    this.initializeSchema();
  }

  /**
   * Initialize database schema
   */
  private initializeSchema(): void {
    // Create schema_version table first (idempotent)
    this.db.exec(CREATE_SCHEMA_VERSION_TABLE);

    // Check current schema version
    const versionRow = this.db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
    const currentVersion = versionRow?.version || 0;

    if (currentVersion < 1) {
      // Initial schema (v1)
      this.db.exec(CREATE_SESSIONS_TABLE);
      this.db.exec(CREATE_TASK_METRICS_TABLE);
      this.db.exec(CREATE_ERROR_HISTORY_TABLE);
    }

    if (currentVersion < 2) {
      // v2: metric_samples, session_worker_summaries, metrics_source on sessions
      this.db.exec(CREATE_METRIC_SAMPLES_TABLE);
      this.db.exec(CREATE_SESSION_WORKER_SUMMARIES_TABLE);
      // Add metrics_source column to sessions (may already exist if v1 ran fresh)
      try {
        this.db.exec(MIGRATE_V2_ADD_METRICS_SOURCE);
      } catch {
        // Column already exists — safe to ignore
      }
    }

    if (currentVersion < 3) {
      // v3: add host column to task_metrics, error_history, metric_samples, session_worker_summaries
      try {
        this.db.exec(MIGRATE_V3_ADD_HOST_COLUMNS);
      } catch {
        // Columns already exist — safe to ignore
      }
    }

    // Update version
    if (currentVersion < SCHEMA_VERSION) {
      this.db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
    }
  }

  /**
   * Start a new session
   */
  startSession(sessionId?: string): string {
    this.currentSessionId = sessionId || this.generateSessionId();
    this.sessionStartTime = Date.now();
    this.taskCounter = 0;
    this.errorCounter = 0;

    // Insert session record
    this.db.prepare(`
      INSERT INTO sessions (id, started_at, ended_at, worker_count, task_count, total_cost, total_tokens)
      VALUES (?, ?, ?, 0, 0, 0, 0)
    `).run(this.currentSessionId, this.sessionStartTime, this.sessionStartTime);

    return this.currentSessionId;
  }

  /**
   * End the current session and write final metrics
   */
  endSession(metrics: {
    workerCount: number;
    taskCount: number;
    totalCost: number;
    totalTokens: number;
    metricsSource?: string;
  }): void {
    if (!this.currentSessionId) return;

    const endTime = Date.now();
    const source = metrics.metricsSource || 'log-derived';

    this.db.prepare(`
      UPDATE sessions
      SET ended_at = ?, worker_count = ?, task_count = ?, total_cost = ?, total_tokens = ?, metrics_source = ?
      WHERE id = ?
    `).run(
      endTime,
      metrics.workerCount,
      metrics.taskCount,
      metrics.totalCost,
      metrics.totalTokens,
      source,
      this.currentSessionId
    );

    this.currentSessionId = null;
    this.sessionStartTime = 0;
  }

  /**
   * Record a task completion
   */
  recordTask(task: {
    workerId: string;
    taskType: string;
    startedAt: number;
    endedAt: number;
    cost: number;
    tokensIn: number;
    tokensOut: number;
    success: boolean;
    retryCount: number;
    host?: string;
  }): string {
    if (!this.currentSessionId) {
      this.startSession();
    }

    const taskId = `${this.currentSessionId}-task-${++this.taskCounter}`;
    const durationMs = task.endedAt - task.startedAt;

    this.db.prepare(`
      INSERT INTO task_metrics (
        id, session_id, worker_id, task_type, started_at, ended_at,
        duration_ms, cost, tokens_in, tokens_out, success, retry_count, host
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      taskId,
      this.currentSessionId,
      task.workerId,
      task.taskType,
      task.startedAt,
      task.endedAt,
      durationMs,
      task.cost,
      task.tokensIn,
      task.tokensOut,
      task.success ? 1 : 0,
      task.retryCount,
      task.host || null
    );

    // Update session task count
    this.db.prepare(`
      UPDATE sessions SET task_count = task_count + 1 WHERE id = ?
    `).run(this.currentSessionId);

    return taskId;
  }

  /**
   * Record an error occurrence
   */
  recordError(error: {
    workerId: string;
    errorType: string;
    errorMessage: string;
    filePath?: string;
    timestamp: number;
    host?: string;
  }): number {
    if (!this.currentSessionId) {
      this.startSession();
    }

    const result = this.db.prepare(`
      INSERT INTO error_history (
        session_id, worker_id, error_type, error_message, file_path, timestamp, host
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      this.currentSessionId,
      error.workerId,
      error.errorType,
      error.errorMessage,
      error.filePath || null,
      error.timestamp,
      error.host || null
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Update error resolution
   */
  updateErrorResolution(
    errorId: number,
    resolution: string,
    successful: boolean
  ): void {
    this.db.prepare(`
      UPDATE error_history
      SET resolution = ?, resolution_successful = ?
      WHERE id = ?
    `).run(resolution, successful ? 1 : 0, errorId);
  }

  // ============================================
  // OTLP Metric Persistence
  // ============================================

  /**
   * Record a raw metric sample from OTLP ingestion.
   */
  recordMetricSample(sample: {
    workerId: string;
    metricName: string;
    value: number;
    timestamp: number;
    source: string;
    beadId?: string;
    host?: string;
  }): void {
    if (!this.currentSessionId) {
      this.startSession();
    }

    this.db.prepare(`
      INSERT INTO metric_samples (worker_id, metric_name, value, timestamp, source, bead_id, session_id, host)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sample.workerId,
      sample.metricName,
      sample.value,
      sample.timestamp,
      sample.source,
      sample.beadId || null,
      this.currentSessionId,
      sample.host || null,
    );
  }

  /**
   * Upsert per-worker session summary from metric accumulator snapshots.
   * When metric-sourced data is available it overwrites log-derived estimates.
   */
  upsertSessionWorkerSummary(summary: {
    workerId: string;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    beadsCompleted: number;
    beadsFailed: number;
    errors: number;
    metricsSource: string;
    host?: string;
  }): void {
    if (!this.currentSessionId) {
      this.startSession();
    }

    // Source priority: otlp-metric (0) > otlp-span (1) > log-derived (2).
    // Only overwrite existing row when the incoming source has equal or higher priority.
    const incomingRank = summary.metricsSource === 'otlp-metric' ? 0
      : summary.metricsSource === 'otlp-span' ? 1 : 2;

    this.db.prepare(`
      INSERT INTO session_worker_summaries
        (session_id, worker_id, tokens_in, tokens_out, cost_usd, beads_completed, beads_failed, errors, metrics_source, updated_at, host)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, worker_id) DO UPDATE SET
        tokens_in      = CASE WHEN ${incomingRank} <= CASE metrics_source WHEN 'otlp-metric' THEN 0 WHEN 'otlp-span' THEN 1 ELSE 2 END THEN excluded.tokens_in      ELSE tokens_in END,
        tokens_out     = CASE WHEN ${incomingRank} <= CASE metrics_source WHEN 'otlp-metric' THEN 0 WHEN 'otlp-span' THEN 1 ELSE 2 END THEN excluded.tokens_out     ELSE tokens_out END,
        cost_usd       = CASE WHEN ${incomingRank} <= CASE metrics_source WHEN 'otlp-metric' THEN 0 WHEN 'otlp-span' THEN 1 ELSE 2 END THEN excluded.cost_usd       ELSE cost_usd END,
        beads_completed = CASE WHEN ${incomingRank} <= CASE metrics_source WHEN 'otlp-metric' THEN 0 WHEN 'otlp-span' THEN 1 ELSE 2 END THEN excluded.beads_completed ELSE beads_completed END,
        beads_failed   = CASE WHEN ${incomingRank} <= CASE metrics_source WHEN 'otlp-metric' THEN 0 WHEN 'otlp-span' THEN 1 ELSE 2 END THEN excluded.beads_failed   ELSE beads_failed END,
        errors         = CASE WHEN ${incomingRank} <= CASE metrics_source WHEN 'otlp-metric' THEN 0 WHEN 'otlp-span' THEN 1 ELSE 2 END THEN excluded.errors         ELSE errors END,
        metrics_source = CASE WHEN ${incomingRank} <= CASE metrics_source WHEN 'otlp-metric' THEN 0 WHEN 'otlp-span' THEN 1 ELSE 2 END THEN excluded.metrics_source ELSE metrics_source END,
        host           = excluded.host,
        updated_at = excluded.updated_at
    `).run(
      this.currentSessionId,
      summary.workerId,
      summary.tokensIn,
      summary.tokensOut,
      summary.costUsd,
      summary.beadsCompleted,
      summary.beadsFailed,
      summary.errors,
      summary.metricsSource,
      Date.now(),
      summary.host || null,
    );
  }

  /**
   * Update the live (current) session row with aggregated metrics.
   */
  updateLiveSession(metrics: {
    workerCount: number;
    taskCount: number;
    totalCost: number;
    totalTokens: number;
    metricsSource: string;
  }): void {
    if (!this.currentSessionId) return;

    this.db.prepare(`
      UPDATE sessions
      SET worker_count = ?, task_count = ?, total_cost = ?, total_tokens = ?, metrics_source = ?, ended_at = ?
      WHERE id = ?
    `).run(
      metrics.workerCount,
      metrics.taskCount,
      metrics.totalCost,
      metrics.totalTokens,
      metrics.metricsSource,
      Date.now(),
      this.currentSessionId,
    );
  }

  /**
   * Get session worker summaries, preferring metric-sourced rows.
   */
  getSessionWorkerSummaries(options: { sessionId?: string; workerId?: string } = {}): Array<{
    sessionId: string;
    workerId: string;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    beadsCompleted: number;
    beadsFailed: number;
    errors: number;
    metricsSource: string;
  }> {
    let query = 'SELECT * FROM session_worker_summaries WHERE 1=1';
    const params: (string | number)[] = [];

    if (options.sessionId) {
      query += ' AND session_id = ?';
      params.push(options.sessionId);
    }
    if (options.workerId) {
      query += ' AND worker_id = ?';
      params.push(options.workerId);
    }

    query += ' ORDER BY updated_at DESC';

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: number;
      session_id: string;
      worker_id: string;
      tokens_in: number;
      tokens_out: number;
      cost_usd: number;
      beads_completed: number;
      beads_failed: number;
      errors: number;
      metrics_source: string;
      updated_at: number;
    }>;

    return rows.map(row => ({
      sessionId: row.session_id,
      workerId: row.worker_id,
      tokensIn: row.tokens_in,
      tokensOut: row.tokens_out,
      costUsd: row.cost_usd,
      beadsCompleted: row.beads_completed,
      beadsFailed: row.beads_failed,
      errors: row.errors,
      metricsSource: row.metrics_source,
    }));
  }

  /**
   * Query metric samples for a given time range / worker / instrument.
   * Returns metric-sourced rows first, then log-derived rows.
   */
  getMetricSamples(options: {
    workerId?: string;
    metricName?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  } = {}): Array<{
    workerId: string;
    metricName: string;
    value: number;
    timestamp: number;
    source: string;
    beadId: string | null;
    sessionId: string | null;
  }> {
    let query = 'SELECT * FROM metric_samples WHERE 1=1';
    const params: (string | number)[] = [];

    if (options.workerId) {
      query += ' AND worker_id = ?';
      params.push(options.workerId);
    }
    if (options.metricName) {
      query += ' AND metric_name = ?';
      params.push(options.metricName);
    }
    if (options.startTime) {
      query += ' AND timestamp >= ?';
      params.push(options.startTime);
    }
    if (options.endTime) {
      query += ' AND timestamp <= ?';
      params.push(options.endTime);
    }

    query += ` ORDER BY CASE source WHEN 'otlp-metric' THEN 0 WHEN 'otlp-span' THEN 1 ELSE 2 END, timestamp DESC LIMIT ?`;
    params.push(options.limit || 1000);

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: number;
      worker_id: string;
      metric_name: string;
      value: number;
      timestamp: number;
      source: string;
      bead_id: string | null;
      session_id: string | null;
    }>;

    return rows.map(row => ({
      workerId: row.worker_id,
      metricName: row.metric_name,
      value: row.value,
      timestamp: row.timestamp,
      source: row.source,
      beadId: row.bead_id,
      sessionId: row.session_id,
    }));
  }

  /**
   * Get the latest aggregated values for each instrument for a worker.
   * Prefers OTLP-metric-sourced data over log-derived.
   */
  getLatestWorkerMetrics(workerId: string): Record<string, { value: number; source: string; timestamp: number }> {
    const rows = this.db.prepare(`
      SELECT metric_name, value, source, timestamp
      FROM metric_samples
      WHERE worker_id = ?
      ORDER BY CASE source WHEN 'otlp-metric' THEN 0 WHEN 'otlp-span' THEN 1 ELSE 2 END, timestamp DESC
    `).all(workerId) as Array<{ metric_name: string; value: number; source: string; timestamp: number }>;

    // Keep the first occurrence per metric_name (which is the preferred source)
    const result: Record<string, { value: number; source: string; timestamp: number }> = {};
    for (const row of rows) {
      if (!(row.metric_name in result)) {
        result[row.metric_name] = {
          value: row.value,
          source: row.source,
          timestamp: row.timestamp,
        };
      }
    }
    return result;
  }

  // ============================================
  // Query Methods
  // ============================================

  /**
   * Get sessions within a time range
   */
  getSessions(options: HistoricalQueryOptions = {}): SessionRecord[] {
    const { startTime = 0, endTime = Date.now(), limit = 100 } = options;

    const rows = this.db.prepare(`
      SELECT * FROM sessions
      WHERE started_at >= ? AND ended_at <= ?
      ORDER BY started_at DESC
      LIMIT ?
    `).all(startTime, endTime, limit) as SessionRecord[];

    return rows;
  }

  /**
   * Get a specific session by ID
   */
  getSession(sessionId: string): SessionRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM sessions WHERE id = ?
    `).get(sessionId) as SessionRecord | undefined;

    return row || null;
  }

  /**
   * Get task metrics for a session or worker
   */
  getTaskMetrics(options: HistoricalQueryOptions = {}): TaskMetricsRecord[] {
    const { sessionId, workerId, startTime, endTime, limit = 1000 } = options;

    let query = 'SELECT * FROM task_metrics WHERE 1=1';
    const params: (string | number)[] = [];

    if (sessionId) {
      query += ' AND session_id = ?';
      params.push(sessionId);
    }

    if (workerId) {
      query += ' AND worker_id = ?';
      params.push(workerId);
    }

    if (startTime) {
      query += ' AND started_at >= ?';
      params.push(startTime);
    }

    if (endTime) {
      query += ' AND ended_at <= ?';
      params.push(endTime);
    }

    query += ' ORDER BY started_at DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(query).all(...params) as TaskMetricsRecord[];

    return rows;
  }

  /**
   * Get error history
   */
  getErrorHistory(options: HistoricalQueryOptions = {}): ErrorHistoryRecord[] {
    const {
      sessionId,
      workerId,
      errorType,
      startTime,
      endTime,
      resolvedOnly,
      limit = 1000,
    } = options;

    let query = 'SELECT * FROM error_history WHERE 1=1';
    const params: (string | number | null)[] = [];

    if (sessionId) {
      query += ' AND session_id = ?';
      params.push(sessionId);
    }

    if (workerId) {
      query += ' AND worker_id = ?';
      params.push(workerId);
    }

    if (errorType) {
      query += ' AND error_type = ?';
      params.push(errorType);
    }

    if (startTime) {
      query += ' AND timestamp >= ?';
      params.push(startTime);
    }

    if (endTime) {
      query += ' AND timestamp <= ?';
      params.push(endTime);
    }

    if (resolvedOnly) {
      query += ' AND resolution_successful = 1';
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(query).all(...params) as ErrorHistoryRecord[];

    return rows;
  }

  /**
   * Get worker comparison metrics across sessions
   */
  getWorkerComparisonMetrics(workerId: string): WorkerComparisonMetrics | null {
    // Get all task metrics for this worker
    const tasks = this.db.prepare(`
      SELECT * FROM task_metrics WHERE worker_id = ?
    `).all(workerId) as TaskMetricsRecord[];

    if (tasks.length === 0) {
      return null;
    }

    // Get unique sessions
    const sessionIds = [...new Set(tasks.map(t => t.session_id))];
    const sessions = this.db.prepare(`
      SELECT * FROM sessions WHERE id IN (${sessionIds.map(() => '?').join(',')})
    `).all(...sessionIds) as SessionRecord[];

    // Calculate metrics
    const sessionsMap = new Map(sessions.map(s => [s.id, s]));

    let totalBeadsCompleted = 0;
    let totalErrors = 0;
    let totalCostUsd = 0;
    let totalTokens = 0;
    let totalDurationMs = 0;
    let successCount = 0;

    for (const task of tasks) {
      if (task.success) {
        totalBeadsCompleted++;
        totalDurationMs += task.duration_ms;
        successCount++;
      } else {
        totalErrors++;
      }
      totalCostUsd += task.cost;
      totalTokens += task.tokens_in + task.tokens_out;
    }

    // Find best and worst sessions
    let bestSession: SessionRecord | null = null;
    let worstSession: SessionRecord | null = null;
    let bestTaskCount = 0;
    let worstTaskCount = Infinity;

    for (const session of sessions) {
      const sessionTasks = tasks.filter(t => t.session_id === session.id && t.success);
      if (sessionTasks.length > bestTaskCount) {
        bestTaskCount = sessionTasks.length;
        bestSession = session;
      }
      if (sessionTasks.length < worstTaskCount && sessionTasks.length > 0) {
        worstTaskCount = sessionTasks.length;
        worstSession = session;
      }
    }

    const avgBeadsPerSession = sessions.length > 0 ? totalBeadsCompleted / sessions.length : 0;

    // Calculate average time span per session
    let totalTimeHours = 0;
    for (const session of sessions) {
      totalTimeHours += (session.ended_at - session.started_at) / 3600000;
    }
    const avgBeadsPerHour = totalTimeHours > 0 ? totalBeadsCompleted / totalTimeHours : 0;

    const avgErrorRate = totalBeadsCompleted + totalErrors > 0
      ? totalErrors / (totalBeadsCompleted + totalErrors)
      : 0;

    const avgCostPerBead = totalBeadsCompleted > 0 ? totalCostUsd / totalBeadsCompleted : 0;

    const avgCompletionTimeMs = successCount > 0 ? totalDurationMs / successCount : 0;

    return {
      workerId,
      sessionsCount: sessions.length,
      totalBeadsCompleted,
      avgBeadsPerSession,
      avgBeadsPerHour,
      totalErrors,
      avgErrorRate,
      totalCostUsd,
      avgCostPerBead,
      totalTokens,
      avgCompletionTimeMs,
      bestSession,
      worstSession,
    };
  }

  /**
   * Get learned recovery patterns from error history
   */
  getLearnedRecoveries(): LearnedRecoveryEntry[] {
    const rows = this.db.prepare(`
      SELECT
        error_type,
        error_message,
        resolution,
        resolution_successful,
        timestamp
      FROM error_history
      WHERE resolution IS NOT NULL
      ORDER BY timestamp DESC
    `).all() as {
      error_type: string;
      error_message: string;
      resolution: string;
      resolution_successful: number;
      timestamp: number;
    }[];

    // Group by error type and resolution
    const grouped = new Map<string, {
      entries: typeof rows;
      successCount: number;
      totalResolutionTime: number;
    }>();

    for (const row of rows) {
      const key = `${row.error_type}::${row.resolution}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.entries.push(row);
        if (row.resolution_successful) {
          existing.successCount++;
        }
      } else {
        grouped.set(key, {
          entries: [row],
          successCount: row.resolution_successful ? 1 : 0,
          totalResolutionTime: 0,
        });
      }
    }

    // Convert to learned entries
    const learned: LearnedRecoveryEntry[] = [];

    for (const [key, data] of grouped) {
      const [errorType, resolution] = key.split('::');
      const successRate = data.entries.length > 0
        ? data.successCount / data.entries.length
        : 0;

      // Extract error pattern (simplified - first 50 chars)
      const errorPattern = data.entries[0].error_message.slice(0, 50);

      learned.push({
        errorType,
        errorPattern,
        resolution,
        successRate,
        occurrenceCount: data.entries.length,
        avgResolutionTime: 0, // Would need additional tracking for this
        lastSeen: Math.max(...data.entries.map(e => e.timestamp)),
      });
    }

    // Sort by occurrence count (most common first)
    return learned.sort((a, b) => b.occurrenceCount - a.occurrenceCount);
  }

  /**
   * Search for similar errors in history
   */
  findSimilarErrors(
    errorMessage: string,
    limit: number = 10
  ): (ErrorHistoryRecord & { similarity: number })[] {
    // Simple substring matching - could be enhanced with fuzzy matching
    const searchTerms = errorMessage.toLowerCase().split(/\s+/).filter(t => t.length > 3);

    if (searchTerms.length === 0) {
      return [];
    }

    const rows = this.db.prepare(`
      SELECT * FROM error_history
      WHERE ${searchTerms.map(() => 'LOWER(error_message) LIKE ?').join(' OR ')}
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(
      ...searchTerms.map(t => `%${t}%`),
      limit
    ) as ErrorHistoryRecord[];

    // Calculate simple similarity score
    return rows.map(row => {
      const lowerMsg = row.error_message.toLowerCase();
      const matchCount = searchTerms.filter(t => lowerMsg.includes(t)).length;
      const similarity = matchCount / searchTerms.length;

      return { ...row, similarity };
    }).sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Get aggregated analytics for a time period
   */
  getAggregatedAnalytics(options: HistoricalQueryOptions = {}): AggregatedAnalytics {
    const { startTime = 0, endTime = Date.now() } = options;

    // Get sessions in range
    const sessions = this.getSessionsInRange(startTime, endTime);
    const sessionIds = sessions.map(s => s.id);

    // Fetch metric-sourced worker summaries for these sessions
    // These are preferred over log-derived task_metrics when available
    const metricWorkerMap = new Map<string, {
      tokensIn: number;
      tokensOut: number;
      costUsd: number;
      beadsCompleted: number;
      beadsFailed: number;
      errors: number;
    }>();

    if (sessionIds.length > 0) {
      const summaries = this.db.prepare(`
        SELECT worker_id, tokens_in, tokens_out, cost_usd, beads_completed, beads_failed, errors, metrics_source
        FROM session_worker_summaries
        WHERE session_id IN (${sessionIds.map(() => '?').join(',')})
          AND metrics_source = 'otlp-metric'
      `).all(...sessionIds) as Array<{
        worker_id: string;
        tokens_in: number;
        tokens_out: number;
        cost_usd: number;
        beads_completed: number;
        beads_failed: number;
        errors: number;
        metrics_source: string;
      }>;

      for (const s of summaries) {
        metricWorkerMap.set(s.worker_id, {
          tokensIn: s.tokens_in,
          tokensOut: s.tokens_out,
          costUsd: s.cost_usd,
          beadsCompleted: s.beads_completed,
          beadsFailed: s.beads_failed,
          errors: s.errors,
        });
      }
    }

    // Get task metrics in range (fallback / log-derived)
    const tasks = this.db.prepare(`
      SELECT * FROM task_metrics
      WHERE started_at >= ? AND ended_at <= ?
    `).all(startTime, endTime) as TaskMetricsRecord[];

    // Calculate aggregated metrics
    const workerMap = new Map<string, {
      tasksCompleted: number;
      errors: number;
      cost: number;
      tokens: number;
      completionTimes: number[];
      hasMetricSource: boolean;
    }>();

    let totalBeadsCompleted = 0;
    let totalErrors = 0;
    let totalCostUsd = 0;
    let totalTokens = 0;
    let totalCompletionTime = 0;
    let successCount = 0;

    for (const task of tasks) {
      let worker = workerMap.get(task.worker_id);
      if (!worker) {
        worker = {
          tasksCompleted: 0,
          errors: 0,
          cost: 0,
          tokens: 0,
          completionTimes: [],
          hasMetricSource: metricWorkerMap.has(task.worker_id),
        };
        workerMap.set(task.worker_id, worker);
      }

      if (task.success) {
        totalBeadsCompleted++;
        totalCompletionTime += task.duration_ms;
        successCount++;
        worker.tasksCompleted++;
        worker.completionTimes.push(task.duration_ms);
      } else {
        totalErrors++;
        worker.errors++;
      }

      totalCostUsd += task.cost;
      totalTokens += task.tokens_in + task.tokens_out;
      worker.cost += task.cost;
      worker.tokens += task.tokens_in + task.tokens_out;
    }

    // For workers with metric-sourced summaries, override the log-derived values
    for (const [workerId, metricData] of metricWorkerMap) {
      const worker = workerMap.get(workerId);
      if (worker) {
        // Replace log-derived estimates with metric-sourced values
        worker.tasksCompleted = metricData.beadsCompleted;
        worker.errors = metricData.errors;
        worker.cost = metricData.costUsd;
        worker.tokens = metricData.tokensIn + metricData.tokensOut;
        worker.hasMetricSource = true;
      } else {
        // Worker has metric data but no task_metrics entries yet
        workerMap.set(workerId, {
          tasksCompleted: metricData.beadsCompleted,
          errors: metricData.errors,
          cost: metricData.costUsd,
          tokens: metricData.tokensIn + metricData.tokensOut,
          completionTimes: [],
          hasMetricSource: true,
        });
      }
    }

    // Recalculate totals from the (possibly overridden) worker map
    totalBeadsCompleted = 0;
    totalErrors = 0;
    totalCostUsd = 0;
    totalTokens = 0;
    totalCompletionTime = 0;
    successCount = 0;

    for (const worker of workerMap.values()) {
      totalBeadsCompleted += worker.tasksCompleted;
      totalErrors += worker.errors;
      totalCostUsd += worker.cost;
      totalTokens += worker.tokens;
      successCount += worker.tasksCompleted;
      for (const d of worker.completionTimes) {
        totalCompletionTime += d;
      }
    }

    const totalTimeMs = endTime - startTime;
    const totalTimeHours = totalTimeMs / 3600000;
    const avgBeadsPerHour = totalTimeHours > 0 ? totalBeadsCompleted / totalTimeHours : 0;
    const avgCompletionTimeMs = successCount > 0 ? totalCompletionTime / successCount : 0;
    const overallErrorRate = totalBeadsCompleted + totalErrors > 0
      ? totalErrors / (totalBeadsCompleted + totalErrors)
      : 0;
    const avgCostPerBead = totalBeadsCompleted > 0 ? totalCostUsd / totalBeadsCompleted : 0;

    // Build top performers list
    const topPerformers: WorkerMetrics[] = [];
    for (const [workerId, data] of workerMap) {
      const avgCompletion = data.completionTimes.length > 0
        ? data.completionTimes.reduce((a, b) => a + b, 0) / data.completionTimes.length
        : 0;

      topPerformers.push({
        workerId,
        periodStart: startTime,
        periodEnd: endTime,
        beadsCompleted: data.tasksCompleted,
        beadsPerHour: totalTimeHours > 0 ? data.tasksCompleted / totalTimeHours : 0,
        avgCompletionTimeMs: avgCompletion,
        errorCount: data.errors,
        errorRate: data.tasksCompleted + data.errors > 0
          ? data.errors / (data.tasksCompleted + data.errors)
          : 0,
        totalCostUsd: data.cost,
        costPerBead: data.tasksCompleted > 0 ? data.cost / data.tasksCompleted : 0,
        activeTimeMs: totalTimeMs,
        idleTimeMs: 0,
        idlePercentage: 0,
        totalEvents: data.tasksCompleted + data.errors,
        totalTokens: data.tokens,
        tokensPerBead: data.tasksCompleted > 0 ? data.tokens / data.tasksCompleted : 0,
        efficiencyScore: data.tasksCompleted > 0 ? 1 : 0,
      });
    }

    // Sort by beads completed
    topPerformers.sort((a, b) => b.beadsCompleted - a.beadsCompleted);

    return {
      periodStart: startTime,
      periodEnd: endTime,
      totalWorkers: workerMap.size,
      totalBeadsCompleted,
      avgBeadsPerHour,
      avgCompletionTimeMs,
      totalErrors,
      overallErrorRate,
      totalCostUsd,
      avgCostPerBead,
      topPerformers: topPerformers.slice(0, 10),
      highErrorRateWorkers: topPerformers.filter(w => w.errorRate > 0.2).slice(0, 10),
      costEfficientWorkers: [...topPerformers]
        .sort((a, b) => a.costPerBead - b.costPerBead)
        .slice(0, 10),
      activeWorkerCount: workerMap.size,
      totalTokens,
      avgEfficiency: topPerformers.length > 0
        ? topPerformers.reduce((sum, w) => sum + w.efficiencyScore, 0) / topPerformers.length
        : 0,
      underperformers: [],
    };
  }

  /**
   * Helper to get sessions in a time range
   */
  private getSessionsInRange(startTime: number, endTime: number): SessionRecord[] {
    return this.db.prepare(`
      SELECT * FROM sessions
      WHERE started_at >= ? AND ended_at <= ?
      ORDER BY started_at ASC
    `).all(startTime, endTime) as SessionRecord[];
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Get the current session ID
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Get database path
   */
  getDatabasePath(): string {
    return this.dbPath;
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.currentSessionId) {
      // Auto-end session if still open
      this.endSession({
        workerCount: 0,
        taskCount: this.taskCounter,
        totalCost: 0,
        totalTokens: 0,
      });
    }
    this.db.close();
  }

  /**
   * Clear all historical data
   */
  clear(): void {
    this.db.exec('DELETE FROM metric_samples');
    this.db.exec('DELETE FROM session_worker_summaries');
    this.db.exec('DELETE FROM error_history');
    this.db.exec('DELETE FROM task_metrics');
    this.db.exec('DELETE FROM sessions');
  }

  /**
   * Get database statistics
   */
  getStats(): {
    sessionsCount: number;
    tasksCount: number;
    errorsCount: number;
    dbSizeBytes: number;
    oldestSession: number | null;
    newestSession: number | null;
  } {
    const sessionsCount = (this.db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }).count;
    const tasksCount = (this.db.prepare('SELECT COUNT(*) as count FROM task_metrics').get() as { count: number }).count;
    const errorsCount = (this.db.prepare('SELECT COUNT(*) as count FROM error_history').get() as { count: number }).count;

    const oldestRow = this.db.prepare('SELECT MIN(started_at) as oldest FROM sessions').get() as { oldest: number | null };
    const newestRow = this.db.prepare('SELECT MAX(started_at) as newest FROM sessions').get() as { newest: number | null };

    // Get file size
    let dbSizeBytes = 0;
    try {
      const stats = fs.statSync(this.dbPath);
      dbSizeBytes = stats.size;
    } catch {
      // Ignore
    }

    return {
      sessionsCount,
      tasksCount,
      errorsCount,
      dbSizeBytes,
      oldestSession: oldestRow.oldest,
      newestSession: newestRow.newest,
    };
  }
}

// ============================================
// Singleton Instance
// ============================================

let globalHistoricalStore: HistoricalStore | undefined;

/**
 * Get the global historical store instance
 */
export function getHistoricalStore(): HistoricalStore {
  if (!globalHistoricalStore) {
    globalHistoricalStore = new HistoricalStore();
  }
  return globalHistoricalStore;
}

/**
 * Reset the global historical store
 */
export function resetHistoricalStore(): void {
  if (globalHistoricalStore) {
    globalHistoricalStore.close();
    globalHistoricalStore = undefined;
  }
}
