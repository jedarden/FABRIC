/**
 * Fleet Analytics Aggregation
 *
 * Parses NEEDLE worker log files and computes metrics by model, strand, and completion quality.
 * Designed to be called on each page load — no persistent state needed.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

// ============================================
// Types
// ============================================

export interface NeedleLogEntry {
  ts: string;
  event: string;
  level?: string;
  session: string;
  worker: string;
  data?: Record<string, unknown>;
}

interface ParsedEvent {
  ts: number;
  event: string;
  level: string;
  session: string;
  worker: string;
  model: string;
  data: Record<string, unknown>;
}

/** Duration distribution bucket */
export interface DurationBucket {
  label: string;
  range: string; // e.g., "<5s"
  count: number;
}

/** Metrics for a single model */
export interface ModelMetrics {
  model: string;
  beadsCompleted: number;
  avgDurationMs: number;
  medianDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  durationBuckets: DurationBucket[];
  shallowCount: number; // <10s
  shallowPercent: number;
}

/** Metrics for a single strand */
export interface StrandMetrics {
  strand: string;
  invocations: number;
  successCount: number;
  failCount: number;
  successRate: number;
  totalDurationMs: number;
  avgDurationMs: number;
}

/** A suspicious shallow completion */
export interface ShallowCompletion {
  beadId: string;
  worker: string;
  model: string;
  durationMs: number;
  timestamp: number;
  session: string;
}

/** A bead completed event with metadata */
export interface BeadCompletion {
  beadId: string;
  worker: string;
  model: string;
  durationMs: number;
  timestamp: number;
  session: string;
  isShallow: boolean;
}

/** Fleet worker time-series point */
export interface FleetTimePoint {
  hour: string; // ISO hour label
  activeWorkers: number;
  beadsCompleted: number;
  timestamp: number;
}

/** Workspace coverage entry */
export interface WorkspaceEntry {
  workspace: string;
  workerCount: number;
  beadCount: number;
}

/** A bead claimed by multiple workers */
export interface ClaimRace {
  beadId: string;
  workers: string[];
  claimCount: number;
}

/** The full analytics response */
export interface FleetAnalytics {
  periodStart: number;
  periodEnd: number;
  totalEvents: number;
  logFiles: string[];

  // Model performance
  modelMetrics: ModelMetrics[];

  // Strand utilization
  strandMetrics: StrandMetrics[];

  // Completion quality
  shallowCompletions: ShallowCompletion[];
  totalCompletions: number;
  shallowPercent: number;
  claimRaces: ClaimRace[];

  // Fleet overview
  fleetTimeSeries: FleetTimePoint[];
  workerRelaunchCount: number;
  workspaceCoverage: WorkspaceEntry[];
  beadsPerHour: number;

  // Raw bead completions for deeper analysis
  beadCompletions: BeadCompletion[];
}

// ============================================
// Log Parsing
// ============================================

const NEEDLE_LOG_DIR = join(homedir(), '.needle', 'logs');

/** Extract model name from worker ID (e.g., "claude-code-glm-5-alpha" -> "glm-5") */
function extractModel(workerId: string): string {
  // Patterns: claude-code-<model>-<id>, claude-anthropic-<model>-<id>
  const match = workerId.match(/claude-(?:code|anthropic)-([a-z0-9.]+(?:-[a-z0-9.]+)?)-/);
  if (match) return match[1];
  // Fallback: strip last segment if it looks like an identifier
  const parts = workerId.split('-');
  if (parts.length > 2) return parts.slice(1, -1).join('-');
  return workerId;
}

/** Extract workspace from a data object */
function extractWorkspace(data: Record<string, unknown>): string {
  return (data.workspace as string) || '';
}

/** Parse a single JSONL line into a ParsedEvent */
function parseLine(line: string): ParsedEvent | null {
  try {
    const entry: NeedleLogEntry = JSON.parse(line);
    if (!entry.ts || !entry.event) return null;

    return {
      ts: new Date(entry.ts).getTime(),
      event: entry.event,
      level: entry.level || 'info',
      session: entry.session || '',
      worker: entry.worker || '',
      model: extractModel(entry.worker || ''),
      data: entry.data || {},
    };
  } catch {
    return null;
  }
}

/** Read all events from a single log file */
function readLogFile(filePath: string): ParsedEvent[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  const events: ParsedEvent[] = [];

  for (const line of lines) {
    const evt = parseLine(line);
    if (evt) events.push(evt);
  }

  return events;
}

/** Read all NEEDLE log files and return combined events */
function readAllLogs(): { events: ParsedEvent[]; files: string[] } {
  if (!existsSync(NEEDLE_LOG_DIR)) return { events: [], files: [] };

  const files = readdirSync(NEEDLE_LOG_DIR)
    .filter(f => f.startsWith('needle-') && f.endsWith('.log'))
    .map(f => join(NEEDLE_LOG_DIR, f))
    .filter(f => existsSync(f));

  const allEvents: ParsedEvent[] = [];
  for (const file of files) {
    const events = readLogFile(file);
    allEvents.push(...events);
  }

  // Sort by timestamp
  allEvents.sort((a, b) => a.ts - b.ts);

  return { events: allEvents, files: files.map(f => f.split('/').pop() || f) };
}

// ============================================
// Metric Computation
// ============================================

const DURATION_BUCKETS: { label: string; range: string; maxMs: number }[] = [
  { label: '<5s', range: '<5s', maxMs: 5000 },
  { label: '5-30s', range: '5-30s', maxMs: 30000 },
  { label: '30s-2m', range: '30s-2m', maxMs: 120000 },
  { label: '2-10m', range: '2-10m', maxMs: 600000 },
  { label: '10m+', range: '10m+', maxMs: Infinity },
];

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function bucketDurations(durations: number[]): DurationBucket[] {
  return DURATION_BUCKETS.map((bucket, i) => {
    const minMs = i === 0 ? 0 : DURATION_BUCKETS[i - 1].maxMs;
    const count = durations.filter(d => d >= minMs && d < bucket.maxMs).length;
    return { label: bucket.label, range: bucket.range, count };
  });
}

/** Extract strand name from event (e.g., "explore.workspace_pluck" -> "explore") */
function extractStrand(event: string): string {
  const dotIndex = event.indexOf('.');
  return dotIndex > 0 ? event.substring(0, dotIndex) : event;
}

/** Compute model metrics from bead.completed events */
function computeModelMetrics(completions: BeadCompletion[]): ModelMetrics[] {
  const byModel = new Map<string, number[]>();

  for (const c of completions) {
    if (!byModel.has(c.model)) byModel.set(c.model, []);
    byModel.get(c.model)!.push(c.durationMs);
  }

  const metrics: ModelMetrics[] = [];

  for (const [model, durations] of byModel) {
    const shallow = durations.filter(d => d < 10000);
    const avg = durations.reduce((s, d) => s + d, 0) / durations.length;
    const median = computeMedian(durations);

    metrics.push({
      model,
      beadsCompleted: durations.length,
      avgDurationMs: Math.round(avg),
      medianDurationMs: Math.round(median),
      minDurationMs: Math.min(...durations),
      maxDurationMs: Math.max(...durations),
      durationBuckets: bucketDurations(durations),
      shallowCount: shallow.length,
      shallowPercent: durations.length > 0 ? Math.round((shallow.length / durations.length) * 100) : 0,
    });
  }

  return metrics.sort((a, b) => b.beadsCompleted - a.beadsCompleted);
}

/** Compute strand metrics from strand.* events */
function computeStrandMetrics(events: ParsedEvent[]): StrandMetrics[] {
  const strandEvents = events.filter(e =>
    e.event.startsWith('explore.') ||
    e.event.startsWith('pulse.') ||
    e.event.startsWith('hook.') ||
    e.event.startsWith('weave.') ||
    e.event.startsWith('unravel.') ||
    e.event.startsWith('mend.')
  );

  const byStrand = new Map<string, { invocations: number; successCount: number; failCount: number; durations: number[] }>();

  for (const evt of strandEvents) {
    const strand = extractStrand(evt.event);
    if (!byStrand.has(strand)) {
      byStrand.set(strand, { invocations: 0, successCount: 0, failCount: 0, durations: [] });
    }
    const s = byStrand.get(strand)!;
    s.invocations++;

    // Determine success/fail from event suffix
    if (evt.event.endsWith('_completed') || evt.event.endsWith('_success') || evt.event.endsWith('_pluck') || evt.event.endsWith('_switch') || evt.event.endsWith('_created')) {
      s.successCount++;
    }
    if (evt.event.endsWith('_failed') || evt.event.endsWith('_error') || (evt.level === 'error' && evt.event.includes('failed'))) {
      s.failCount++;
    }

    const dur = evt.data.duration_ms as number | undefined;
    if (typeof dur === 'number' && dur > 0) {
      s.durations.push(dur);
    }
  }

  const metrics: StrandMetrics[] = [];

  for (const [strand, data] of byStrand) {
    metrics.push({
      strand,
      invocations: data.invocations,
      successCount: data.successCount,
      failCount: data.failCount,
      successRate: data.invocations > 0 ? Math.round((data.successCount / data.invocations) * 100) : 0,
      totalDurationMs: data.durations.reduce((s, d) => s + d, 0),
      avgDurationMs: data.durations.length > 0 ? Math.round(data.durations.reduce((s, d) => s + d, 0) / data.durations.length) : 0,
    });
  }

  return metrics.sort((a, b) => b.invocations - a.invocations);
}

/** Compute fleet time series (hourly active workers + completions) */
function computeFleetTimeSeries(events: ParsedEvent[]): FleetTimePoint[] {
  const hourBuckets = new Map<string, { workers: Set<string>; completions: number; timestamp: number }>();

  for (const evt of events) {
    const date = new Date(evt.ts);
    date.setMinutes(0, 0, 0);
    const hourKey = date.toISOString();
    const timestamp = date.getTime();

    if (!hourBuckets.has(hourKey)) {
      hourBuckets.set(hourKey, { workers: new Set(), completions: 0, timestamp });
    }
    const bucket = hourBuckets.get(hourKey)!;
    bucket.workers.add(evt.worker);

    if (evt.event === 'bead.completed') {
      bucket.completions++;
    }
  }

  const points: FleetTimePoint[] = [];
  for (const [hour, data] of hourBuckets) {
    points.push({
      hour,
      activeWorkers: data.workers.size,
      beadsCompleted: data.completions,
      timestamp: data.timestamp,
    });
  }

  return points.sort((a, b) => a.timestamp - b.timestamp);
}

/** Compute workspace coverage */
function computeWorkspaceCoverage(events: ParsedEvent[]): WorkspaceEntry[] {
  const workspaces = new Map<string, { workers: Set<string>; beads: Set<string> }>();

  for (const evt of events) {
    const ws = extractWorkspace(evt.data);
    if (!ws) continue;

    if (!workspaces.has(ws)) {
      workspaces.set(ws, { workers: new Set(), beads: new Set() });
    }
    const entry = workspaces.get(ws)!;
    entry.workers.add(evt.worker);

    const beadId = evt.data.bead_id as string | undefined;
    if (beadId && evt.event === 'bead.completed') {
      entry.beads.add(beadId);
    }
  }

  return Array.from(workspaces.entries())
    .map(([workspace, data]) => ({
      workspace,
      workerCount: data.workers.size,
      beadCount: data.beads.size,
    }))
    .sort((a, b) => b.beadCount - a.beadCount);
}

/** Find claim races (beads claimed by multiple workers) */
function computeClaimRaces(events: ParsedEvent[]): ClaimRace[] {
  const beadClaimers = new Map<string, Set<string>>();

  for (const evt of events) {
    if (evt.event !== 'bead.claimed') continue;
    const beadId = evt.data.bead_id as string | undefined;
    if (!beadId) continue;

    if (!beadClaimers.has(beadId)) {
      beadClaimers.set(beadId, new Set());
    }
    beadClaimers.get(beadId)!.add(evt.worker);
  }

  const races: ClaimRace[] = [];
  for (const [beadId, workers] of beadClaimers) {
    if (workers.size > 1) {
      races.push({
        beadId,
        workers: Array.from(workers),
        claimCount: workers.size,
      });
    }
  }

  return races.sort((a, b) => b.claimCount - a.claimCount);
}

// ============================================
// Main Analytics Function
// ============================================

/**
 * Compute full fleet analytics from NEEDLE log files.
 * Reads all log files fresh on each call — no caching, no persistent DB.
 */
export function computeFleetAnalytics(): FleetAnalytics {
  const { events, files } = readAllLogs();

  if (events.length === 0) {
    return {
      periodStart: 0,
      periodEnd: 0,
      totalEvents: 0,
      logFiles: [],
      modelMetrics: [],
      strandMetrics: [],
      shallowCompletions: [],
      totalCompletions: 0,
      shallowPercent: 0,
      claimRaces: [],
      fleetTimeSeries: [],
      workerRelaunchCount: 0,
      workspaceCoverage: [],
      beadsPerHour: 0,
      beadCompletions: [],
    };
  }

  const periodStart = events[0].ts;
  const periodEnd = events[events.length - 1].ts;

  // Extract bead completions
  const beadCompletions: BeadCompletion[] = [];
  for (const evt of events) {
    if (evt.event !== 'bead.completed') continue;
    const durationMs = (evt.data.duration_ms as number) || 0;
    const beadId = (evt.data.bead_id as string) || '';
    beadCompletions.push({
      beadId,
      worker: evt.worker,
      model: evt.model,
      durationMs,
      timestamp: evt.ts,
      session: evt.session,
      isShallow: durationMs > 0 && durationMs < 10000,
    });
  }

  const shallowCompletions = beadCompletions.filter(c => c.isShallow);
  const totalCompletions = beadCompletions.length;

  // Worker relaunch count (worker.started events minus unique workers)
  const uniqueWorkers = new Set(events.map(e => e.worker));
  const workerStartedCount = events.filter(e => e.event === 'worker.started').length;
  const workerRelaunchCount = Math.max(0, workerStartedCount - uniqueWorkers.size);

  // Beads per hour
  const hoursSpan = Math.max((periodEnd - periodStart) / 3600000, 0.001);
  const beadsPerHour = Math.round(totalCompletions / hoursSpan * 10) / 10;

  return {
    periodStart,
    periodEnd,
    totalEvents: events.length,
    logFiles: files,
    modelMetrics: computeModelMetrics(beadCompletions),
    strandMetrics: computeStrandMetrics(events),
    shallowCompletions,
    totalCompletions,
    shallowPercent: totalCompletions > 0 ? Math.round((shallowCompletions.length / totalCompletions) * 100) : 0,
    claimRaces: computeClaimRaces(events),
    fleetTimeSeries: computeFleetTimeSeries(events),
    workerRelaunchCount,
    workspaceCoverage: computeWorkspaceCoverage(events),
    beadsPerHour,
    beadCompletions,
  };
}
