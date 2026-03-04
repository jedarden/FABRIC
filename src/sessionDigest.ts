/**
 * Session Digest Generator
 *
 * Generates end-of-session summaries aggregating:
 * - Beads completed
 * - Files modified
 * - Errors encountered
 * - Time spent
 * - Cost incurred
 *
 * Outputs as formatted markdown.
 */

import {
  LogEvent,
  EventStore,
  SessionDigest,
  SessionDigestOptions,
  BeadCompletion,
  FileModificationSummary,
  ErrorOccurrence,
  WorkerSessionSummary,
  ErrorCategory,
} from './types.js';
import { CostTracker } from './tui/utils/costTracking.js';
import { ErrorGroupManager } from './errorGrouping.js';

const DEFAULT_OPTIONS: SessionDigestOptions = {
  workers: [],
  includeErrors: true,
  includeCost: true,
  maxFiles: 50,
  maxErrors: 20,
};

/**
 * Session Digest Generator
 */
export class SessionDigestGenerator {
  private store: EventStore;
  private costTracker: CostTracker;
  private errorGroupManager: ErrorGroupManager;

  constructor(store: EventStore, costTracker?: CostTracker, errorGroupManager?: ErrorGroupManager) {
    this.store = store;
    this.costTracker = costTracker || new CostTracker();
    this.errorGroupManager = errorGroupManager || new ErrorGroupManager();
  }

  /**
   * Generate session digest from events
   */
  generateDigest(options: SessionDigestOptions = {}): SessionDigest {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Build filter for query
    const filter: any = {};
    if (opts.startTime !== undefined) filter.since = opts.startTime;
    if (opts.endTime !== undefined) filter.until = opts.endTime;

    // Query events within time range
    const events = this.store.query(Object.keys(filter).length > 0 ? filter : undefined);

    // Filter by workers if specified
    const filteredEvents = opts.workers && opts.workers.length > 0
      ? events.filter(e => opts.workers!.includes(e.worker))
      : events;

    // Process events to extract data
    const beadsCompleted = this.extractBeadCompletions(filteredEvents);
    const filesModified = this.extractFileModifications(filteredEvents, opts.maxFiles ?? 50);
    const errors = opts.includeErrors
      ? this.extractErrors(filteredEvents, opts.maxErrors ?? 20)
      : [];

    // Generate worker summaries
    const workers = this.generateWorkerSummaries(filteredEvents);

    // Process cost data
    filteredEvents.forEach(event => this.costTracker.processEvent(event));
    const costSummary = this.costTracker.getSummary();

    // Calculate session time bounds
    const now = Date.now();
    const startTime = filteredEvents.length > 0
      ? Math.min(...filteredEvents.map(e => e.ts))
      : (opts.startTime ?? now);
    const endTime = filteredEvents.length > 0
      ? Math.max(...filteredEvents.map(e => e.ts))
      : (opts.endTime ?? now);

    // Generate statistics
    const uniqueWorkers = new Set(filteredEvents.map(e => e.worker));
    const uniqueBeads = new Set(filteredEvents.filter(e => e.bead).map(e => e.bead!));
    const uniqueFiles = new Set(filesModified.map(f => f.path));

    return {
      sessionId: `session-${startTime}`,
      startTime,
      endTime,
      durationMs: endTime - startTime,
      beadsCompleted,
      filesModified,
      errors,
      workers,
      cost: {
        totalTokens: costSummary.total.total,
        inputTokens: costSummary.total.input,
        outputTokens: costSummary.total.output,
        estimatedCostUsd: costSummary.totalCostUsd,
      },
      stats: {
        totalEvents: filteredEvents.length,
        totalWorkers: uniqueWorkers.size,
        totalBeads: uniqueBeads.size,
        totalFiles: uniqueFiles.size,
        totalErrors: errors.length,
        avgEventsPerWorker: uniqueWorkers.size > 0
          ? filteredEvents.length / uniqueWorkers.size
          : 0,
        avgBeadsPerWorker: uniqueWorkers.size > 0
          ? uniqueBeads.size / uniqueWorkers.size
          : 0,
      },
    };
  }

  /**
   * Extract bead completions from events
   */
  private extractBeadCompletions(events: LogEvent[]): BeadCompletion[] {
    const completions: BeadCompletion[] = [];
    const beadStartTimes = new Map<string, number>();

    for (const event of events) {
      const beadId = event.bead;
      if (!beadId) continue;

      // Track bead start times
      if (!beadStartTimes.has(beadId)) {
        beadStartTimes.set(beadId, event.ts);
      }

      // Look for completion indicators
      if (this.isBeadCompletion(event)) {
        const startTime = beadStartTimes.get(beadId) || event.ts;
        completions.push({
          beadId,
          workerId: event.worker,
          completedAt: event.ts,
          durationMs: event.ts - startTime,
        });
      }
    }

    return completions;
  }

  /**
   * Check if event indicates bead completion
   */
  private isBeadCompletion(event: LogEvent): boolean {
    const msg = event.msg.toLowerCase();
    return (
      msg.includes('completed') ||
      msg.includes('finished') ||
      msg.includes('done') ||
      msg.includes('success') ||
      (event as any).status === 'completed'
    );
  }

  /**
   * Extract file modifications from events
   */
  private extractFileModifications(events: LogEvent[], maxFiles: number): FileModificationSummary[] {
    const fileMap = new Map<string, {
      modifications: number;
      workers: Set<string>;
      tools: Set<string>;
    }>();

    for (const event of events) {
      const path = event.path;
      if (!path) continue;

      // Only count file modification tools
      const tool = event.tool;
      if (!tool || !this.isFileModificationTool(tool)) continue;

      let fileData = fileMap.get(path);
      if (!fileData) {
        fileData = {
          modifications: 0,
          workers: new Set(),
          tools: new Set(),
        };
        fileMap.set(path, fileData);
      }

      fileData.modifications++;
      fileData.workers.add(event.worker);
      fileData.tools.add(tool);
    }

    // Convert to array and sort by modification count
    const files = Array.from(fileMap.entries())
      .map(([path, data]) => ({
        path,
        modifications: data.modifications,
        workers: Array.from(data.workers),
        tools: Array.from(data.tools),
      }))
      .sort((a, b) => b.modifications - a.modifications)
      .slice(0, maxFiles);

    return files;
  }

  /**
   * Check if tool is a file modification tool
   */
  private isFileModificationTool(tool: string): boolean {
    const modificationTools = ['Edit', 'Write', 'NotebookEdit', 'Delete', 'Move'];
    return modificationTools.includes(tool);
  }

  /**
   * Extract errors from events
   */
  private extractErrors(events: LogEvent[], maxErrors: number): ErrorOccurrence[] {
    const errors: ErrorOccurrence[] = [];

    for (const event of events) {
      if (event.level !== 'error' && !event.error) continue;

      // Process error through error group manager
      this.errorGroupManager.addError(event);

      const errorMsg = event.error || event.msg;
      const category = this.categorizeError(errorMsg);

      errors.push({
        message: errorMsg,
        category,
        workerId: event.worker,
        timestamp: event.ts,
      });
    }

    // Sort by timestamp (most recent first) and limit
    return errors
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, maxErrors);
  }

  /**
   * Categorize error message
   */
  private categorizeError(message: string): ErrorCategory {
    const msg = message.toLowerCase();

    if (msg.includes('econnrefused') || msg.includes('timeout') || msg.includes('network')) {
      return 'network';
    }
    if (msg.includes('permission') || msg.includes('denied') || msg.includes('unauthorized')) {
      return 'permission';
    }
    if (msg.includes('not found') || msg.includes('enoent') || msg.includes('404')) {
      return 'not_found';
    }
    if (msg.includes('invalid') || msg.includes('validation')) {
      return 'validation';
    }
    if (msg.includes('memory') || msg.includes('quota') || msg.includes('disk')) {
      return 'resource';
    }
    if (msg.includes('syntax') || msg.includes('parse')) {
      return 'syntax';
    }

    return 'unknown';
  }

  /**
   * Generate worker summaries
   */
  private generateWorkerSummaries(events: LogEvent[]): WorkerSessionSummary[] {
    const workerMap = new Map<string, {
      events: LogEvent[];
      beads: Set<string>;
      files: Set<string>;
      errors: number;
    }>();

    // Group events by worker
    for (const event of events) {
      let workerData = workerMap.get(event.worker);
      if (!workerData) {
        workerData = {
          events: [],
          beads: new Set(),
          files: new Set(),
          errors: 0,
        };
        workerMap.set(event.worker, workerData);
      }

      workerData.events.push(event);
      if (event.bead) workerData.beads.add(event.bead);
      if (event.path) workerData.files.add(event.path);
      if (event.level === 'error' || event.error) workerData.errors++;
    }

    // Generate summaries
    return Array.from(workerMap.entries()).map(([workerId, data]) => {
      const timestamps = data.events.map(e => e.ts).sort((a, b) => a - b);
      const firstActivity = timestamps[0] || 0;
      const lastActivity = timestamps[timestamps.length - 1] || 0;

      // Calculate active time (rough estimate based on event spread)
      const activeTimeMs = lastActivity - firstActivity;

      return {
        workerId,
        beadsCompleted: data.beads.size,
        filesModified: data.files.size,
        errorsEncountered: data.errors,
        totalEvents: data.events.length,
        activeTimeMs,
        firstActivity,
        lastActivity,
      };
    }).sort((a, b) => b.totalEvents - a.totalEvents);
  }
}

/**
 * Format session digest as markdown
 */
export function formatDigestAsMarkdown(digest: SessionDigest): string {
  const lines: string[] = [];

  // Header
  lines.push('# Session Digest');
  lines.push('');
  lines.push(`**Session ID:** ${digest.sessionId}`);
  lines.push(`**Duration:** ${formatDuration(digest.durationMs)}`);
  lines.push(`**Period:** ${new Date(digest.startTime).toISOString()} - ${new Date(digest.endTime).toISOString()}`);
  lines.push('');

  // Summary Statistics
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Count |');
  lines.push('|--------|-------|');
  lines.push(`| Total Events | ${digest.stats.totalEvents.toLocaleString()} |`);
  lines.push(`| Active Workers | ${digest.stats.totalWorkers} |`);
  lines.push(`| Beads Completed | ${digest.stats.totalBeads} |`);
  lines.push(`| Files Modified | ${digest.stats.totalFiles} |`);
  lines.push(`| Errors Encountered | ${digest.stats.totalErrors} |`);
  lines.push('');

  // Cost Summary
  if (digest.cost.totalTokens > 0) {
    lines.push('## Cost Summary');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Total Tokens | ${digest.cost.totalTokens.toLocaleString()} |`);
    lines.push(`| Input Tokens | ${digest.cost.inputTokens.toLocaleString()} |`);
    lines.push(`| Output Tokens | ${digest.cost.outputTokens.toLocaleString()} |`);
    lines.push(`| Estimated Cost | $${digest.cost.estimatedCostUsd.toFixed(4)} |`);
    lines.push('');
  }

  // Worker Summaries
  if (digest.workers.length > 0) {
    lines.push('## Worker Activity');
    lines.push('');
    lines.push('| Worker | Events | Beads | Files | Errors | Active Time |');
    lines.push('|--------|--------|-------|-------|--------|-------------|');

    for (const worker of digest.workers) {
      lines.push(
        `| ${worker.workerId} | ${worker.totalEvents} | ${worker.beadsCompleted} | ${worker.filesModified} | ${worker.errorsEncountered} | ${formatDuration(worker.activeTimeMs)} |`
      );
    }
    lines.push('');
  }

  // Beads Completed
  if (digest.beadsCompleted.length > 0) {
    lines.push('## Beads Completed');
    lines.push('');
    lines.push('| Bead ID | Worker | Duration |');
    lines.push('|---------|--------|----------|');

    for (const bead of digest.beadsCompleted) {
      const duration = bead.durationMs ? formatDuration(bead.durationMs) : 'N/A';
      lines.push(`| ${bead.beadId} | ${bead.workerId} | ${duration} |`);
    }
    lines.push('');
  }

  // Files Modified
  if (digest.filesModified.length > 0) {
    lines.push('## Files Modified');
    lines.push('');
    lines.push('| File | Modifications | Workers | Tools |');
    lines.push('|------|---------------|---------|-------|');

    for (const file of digest.filesModified.slice(0, 20)) {
      lines.push(
        `| ${truncatePath(file.path)} | ${file.modifications} | ${file.workers.length} | ${file.tools.join(', ')} |`
      );
    }

    if (digest.filesModified.length > 20) {
      lines.push(`| ... and ${digest.filesModified.length - 20} more files | | | |`);
    }
    lines.push('');
  }

  // Errors Encountered
  if (digest.errors.length > 0) {
    lines.push('## Errors Encountered');
    lines.push('');

    for (const error of digest.errors.slice(0, 10)) {
      lines.push(`### ${error.category} - ${error.workerId}`);
      lines.push('');
      lines.push('```');
      lines.push(error.message);
      lines.push('```');
      lines.push('');
      lines.push(`*Time:* ${new Date(error.timestamp).toISOString()}`);
      lines.push('');
    }

    if (digest.errors.length > 10) {
      lines.push(`*... and ${digest.errors.length - 10} more errors*`);
      lines.push('');
    }
  }

  // Footer
  lines.push('---');
  lines.push('');
  lines.push(`*Generated at ${new Date().toISOString()}*`);

  return lines.join('\n');
}

/**
 * Format duration in human-readable form
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0
    ? `${hours}h ${remainingMinutes}m`
    : `${hours}h`;
}

/**
 * Truncate file path for display
 */
function truncatePath(path: string, maxLength: number = 60): string {
  if (path.length <= maxLength) {
    return path;
  }

  const parts = path.split('/');
  if (parts.length <= 2) {
    return `...${path.slice(-(maxLength - 3))}`;
  }

  // Keep first and last parts, truncate middle
  const first = parts[0];
  const last = parts[parts.length - 1];
  return `${first}/.../.../${last}`;
}
