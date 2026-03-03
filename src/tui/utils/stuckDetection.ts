/**
 * Stuck Worker Detection
 *
 * Analyzes worker patterns to detect when workers are spinning their wheels
 * without making meaningful progress.
 */

import { LogEvent, WorkerInfo } from '../../types.js';

export interface StuckPattern {
  /** Type of stuck pattern detected */
  type: 'repeated_tool' | 'no_progress' | 'circular_edit' | 'long_running';

  /** Human-readable description */
  reason: string;

  /** Severity: warning = might be stuck, critical = definitely stuck */
  severity: 'warning' | 'critical';

  /** Evidence from recent events */
  evidence: string[];

  /** Suggested action */
  suggestion: string;
}

export interface StuckDetectionOptions {
  /** Time window to analyze (ms), default 5 minutes */
  windowMs?: number;

  /** Threshold for repeated tool calls */
  repeatedToolThreshold?: number;

  /** Threshold for no progress (ms), default 2 minutes */
  noProgressThresholdMs?: number;

  /** Threshold for long-running tasks (ms), default 10 minutes */
  longRunningThresholdMs?: number;
}

const DEFAULT_OPTIONS: Required<StuckDetectionOptions> = {
  windowMs: 5 * 60 * 1000, // 5 minutes
  repeatedToolThreshold: 5,
  noProgressThresholdMs: 2 * 60 * 1000, // 2 minutes
  longRunningThresholdMs: 10 * 60 * 1000, // 10 minutes
};

/**
 * Detect if a worker is stuck based on recent events
 */
export function isWorkerStuck(
  worker: WorkerInfo,
  events: LogEvent[],
  options: StuckDetectionOptions = {}
): StuckPattern | null {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const now = Date.now();
  const windowStart = now - opts.windowMs;

  // Filter to recent events for this worker
  const recentEvents = events.filter(
    (e) => e.worker === worker.id && e.ts >= windowStart
  );

  if (recentEvents.length === 0) {
    return null;
  }

  // Check patterns in order of severity
  const patterns = [
    detectRepeatedToolCalls(recentEvents, opts),
    detectNoProgress(worker, recentEvents, opts),
    detectCircularEdits(recentEvents, opts),
    detectLongRunning(worker, recentEvents, opts),
  ];

  // Return the most severe pattern
  for (const pattern of patterns) {
    if (pattern) {
      return pattern;
    }
  }

  return null;
}

/**
 * Get a human-readable stuck reason
 */
export function getStuckReason(
  worker: WorkerInfo,
  events: LogEvent[],
  options: StuckDetectionOptions = {}
): string | null {
  const pattern = isWorkerStuck(worker, events, options);
  return pattern?.reason ?? null;
}

/**
 * Detect repeated tool calls with same parameters
 */
function detectRepeatedToolCalls(
  events: LogEvent[],
  opts: Required<StuckDetectionOptions>
): StuckPattern | null {
  // Group events by tool + path (if path exists)
  const toolCounts = new Map<string, { count: number; events: LogEvent[] }>();

  for (const event of events) {
    if (!event.tool) continue;

    const key = event.path
      ? `${event.tool}:${event.path}`
      : event.tool;

    const existing = toolCounts.get(key);
    if (existing) {
      existing.count++;
      existing.events.push(event);
    } else {
      toolCounts.set(key, { count: 1, events: [event] });
    }
  }

  // Find repeated tool calls
  for (const [key, data] of toolCounts) {
    if (data.count >= opts.repeatedToolThreshold) {
      const [tool, path] = key.split(':');
      return {
        type: 'repeated_tool',
        reason: `Called ${tool}${path ? ` on ${path}` : ''} ${data.count} times without progress`,
        severity: data.count >= opts.repeatedToolThreshold * 2 ? 'critical' : 'warning',
        evidence: data.events.slice(-3).map((e) => `${e.tool}: ${e.msg?.slice(0, 50)}`),
        suggestion: 'Consider alternative approach or escalate to human',
      };
    }
  }

  return null;
}

/**
 * Detect no meaningful progress for extended time
 */
function detectNoProgress(
  worker: WorkerInfo,
  events: LogEvent[],
  opts: Required<StuckDetectionOptions>
): StuckPattern | null {
  const now = Date.now();
  const timeSinceActivity = now - worker.lastActivity;

  if (timeSinceActivity > opts.noProgressThresholdMs) {
    const seconds = Math.floor(timeSinceActivity / 1000);
    const minutes = Math.floor(seconds / 60);

    return {
      type: 'no_progress',
      reason: `No activity for ${minutes > 0 ? `${minutes}m` : `${seconds}s`}`,
      severity: timeSinceActivity > opts.longRunningThresholdMs ? 'critical' : 'warning',
      evidence: worker.lastEvent
        ? [`Last: ${worker.lastEvent.msg?.slice(0, 60)}`]
        : ['No recent events'],
      suggestion: 'Check if worker is waiting for external resource or blocked',
    };
  }

  // Also check for events but no completions
  const recentCompletions = events.filter(
    (e) => e.msg?.includes('completed') || e.msg?.includes('complete')
  );

  if (events.length > 10 && recentCompletions.length === 0) {
    return {
      type: 'no_progress',
      reason: `${events.length} events but no completions in window`,
      severity: 'warning',
      evidence: events.slice(-3).map((e) => e.msg?.slice(0, 40) || ''),
      suggestion: 'Worker may be stuck in exploration loop',
    };
  }

  return null;
}

/**
 * Detect circular file edits (same file edited back and forth)
 */
function detectCircularEdits(
  events: LogEvent[],
  opts: Required<StuckDetectionOptions>
): StuckPattern | null {
  const editEvents = events.filter(
    (e) => e.tool === 'Edit' && e.path
  );

  if (editEvents.length < 3) return null;

  // Track edit sequences per file
  const fileEdits = new Map<string, string[]>();

  for (const event of editEvents) {
    const path = event.path!;
    const edits = fileEdits.get(path) || [];
    // Simplified: track just the count per file
    edits.push(event.ts.toString());
    fileEdits.set(path, edits);
  }

  // Check for files with many back-and-forth edits
  for (const [path, timestamps] of fileEdits) {
    if (timestamps.length >= 4) {
      return {
        type: 'circular_edit',
        reason: `File ${path} edited ${timestamps.length} times - possible circular changes`,
        severity: timestamps.length >= 6 ? 'critical' : 'warning',
        evidence: [`Edits at: ${timestamps.slice(-4).join(', ')}`],
        suggestion: 'Review edit history, may need to step back and reconsider approach',
      };
    }
  }

  return null;
}

/**
 * Detect long-running tasks
 */
function detectLongRunning(
  worker: WorkerInfo,
  events: LogEvent[],
  opts: Required<StuckDetectionOptions>
): StuckPattern | null {
  const runningTime = Date.now() - worker.firstSeen;

  if (runningTime > opts.longRunningThresholdMs) {
    const minutes = Math.floor(runningTime / 60000);

    // Check if making progress
    const completions = events.filter(
      (e) => e.msg?.includes('completed') || e.msg?.includes('complete')
    ).length;

    if (completions < 2) {
      return {
        type: 'long_running',
        reason: `Running for ${minutes}m with only ${completions} completion(s)`,
        severity: minutes >= 20 ? 'critical' : 'warning',
        evidence: [`Beads completed: ${worker.beadsCompleted}`],
        suggestion: 'Consider breaking task into smaller pieces',
      };
    }
  }

  return null;
}

/**
 * Get stuck indicator character for display
 */
export function getStuckIndicator(pattern: StuckPattern | null): string {
  if (!pattern) return '';
  return pattern.severity === 'critical' ? '⚠' : '⚡';
}
