/**
 * Semantic Narrative Summarization
 *
 * Generates natural language summaries of worker activity by:
 * - Analyzing event sequences to detect patterns
 * - Grouping related events into narrative segments
 * - Generating human-readable summaries
 * - Updating narratives in real-time
 */

import {
  LogEvent,
  SemanticNarrative,
  NarrativeSegment,
  NarrativeOptions,
  NarrativeUpdate,
  SemanticNarrativeManager,
  EventPattern,
  NarrativeStyle,
} from './types.js';

const DEFAULT_OPTIONS: Required<NarrativeOptions> = {
  style: 'detailed',
  workerId: '',
  beadId: '',
  startTime: 0,
  endTime: 0,
  minConfidence: 0.5,
  maxSegments: 100,
  includeTechnicalDetails: true,
  includeTimeline: true,
  segmentWindowMs: 300000, // 5 minutes
  minEventsPerSegment: 1,
};

/**
 * Internal tracking for narrative generation
 */
interface NarrativeContext {
  narrativeId: string;
  workerId: string;
  events: LogEvent[];
  segments: NarrativeSegment[];
  activeSegment: NarrativeSegment | null;
  lastEventTime: number;
  startTime: number;
  beadsWorked: Set<string>;
  filesModified: Set<string>;
  toolsUsed: Set<string>;
  errorsEncountered: number;
  updateCallbacks: Array<(update: NarrativeUpdate) => void>;
}

/**
 * Semantic Narrative Manager
 */
export class SemanticNarrativeGenerator implements SemanticNarrativeManager {
  private contexts: Map<string, NarrativeContext> = new Map();
  private narratives: Map<string, SemanticNarrative> = new Map();
  private globalUpdateCallbacks: Array<(update: NarrativeUpdate) => void> = [];
  private segmentCounter = 0;
  private narrativeCounter = 0;

  /**
   * Process an event and update narratives
   */
  processEvent(event: LogEvent): void {
    // Get or create context for this worker
    let context = this.contexts.get(event.worker);
    if (!context) {
      context = this.createContext(event.worker, event.ts);
      this.contexts.set(event.worker, context);
    }

    // Add event to context
    context.events.push(event);
    context.lastEventTime = event.ts;

    // Track entities
    if (event.bead) context.beadsWorked.add(event.bead);
    if (event.path) context.filesModified.add(event.path);
    if (event.tool) context.toolsUsed.add(event.tool);
    if (event.level === 'error' || event.error) context.errorsEncountered++;

    // Update or create narrative segment
    this.updateNarrativeSegment(context, event);
  }

  /**
   * Generate narrative for a specific worker
   */
  generateNarrative(workerId: string, options: NarrativeOptions = {}): SemanticNarrative {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const context = this.contexts.get(workerId);

    if (!context) {
      return this.createEmptyNarrative(workerId);
    }

    // Filter events by time range if specified
    let events = context.events;
    if (opts.startTime > 0) {
      events = events.filter(e => e.ts >= opts.startTime);
    }
    if (opts.endTime > 0) {
      events = events.filter(e => e.ts <= opts.endTime);
    }

    // Filter by bead if specified
    if (opts.beadId) {
      events = events.filter(e => e.bead === opts.beadId);
    }

    // Regenerate segments from filtered events
    const segments = this.generateSegments(events, opts);

    // Generate narrative components
    const summary = this.generateSummary(segments, events);
    const fullNarrative = this.generateFullNarrative(segments, opts.style);
    const timeline = opts.includeTimeline ? this.generateTimeline(segments) : [];
    const accomplishments = this.extractAccomplishments(segments);
    const challenges = this.extractChallenges(segments);
    const sentiment = this.determineSentiment(segments, events);

    // Calculate statistics
    const beadsWorked = new Set(events.filter(e => e.bead).map(e => e.bead!));
    const filesModified = new Set(events.filter(e => e.path).map(e => e.path!));
    const toolsUsed = new Set(events.filter(e => e.tool).map(e => e.tool!));
    const errorsEncountered = events.filter(e => e.level === 'error' || e.error).length;

    const startTime = events.length > 0 ? events[0].ts : Date.now();
    const endTime = events.length > 0 ? events[events.length - 1].ts : Date.now();

    const narrative: SemanticNarrative = {
      id: context.narrativeId,
      workerId,
      title: this.generateTitle(workerId, segments),
      summary,
      segments,
      fullNarrative,
      timeline,
      startTime,
      endTime,
      durationMs: endTime - startTime,
      accomplishments,
      challenges,
      sentiment,
      stats: {
        totalEvents: events.length,
        segmentCount: segments.length,
        beadsWorked: beadsWorked.size,
        filesModified: filesModified.size,
        errorsEncountered,
        toolsUsed: toolsUsed.size,
      },
      generatedAt: Date.now(),
      isLive: true,
    };

    this.narratives.set(narrative.id, narrative);
    return narrative;
  }

  /**
   * Generate aggregated narrative for all workers
   */
  generateAggregatedNarrative(options: NarrativeOptions = {}): SemanticNarrative {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Collect all events from all workers
    const allEvents: LogEvent[] = [];
    for (const context of this.contexts.values()) {
      allEvents.push(...context.events);
    }

    // Sort by timestamp
    allEvents.sort((a, b) => a.ts - b.ts);

    // Filter by time range
    let events = allEvents;
    if (opts.startTime > 0) {
      events = events.filter(e => e.ts >= opts.startTime);
    }
    if (opts.endTime > 0) {
      events = events.filter(e => e.ts <= opts.endTime);
    }

    // Generate segments
    const segments = this.generateSegments(events, opts);

    // Generate narrative components
    const summary = this.generateSummary(segments, events, true);
    const fullNarrative = this.generateFullNarrative(segments, opts.style, true);
    const timeline = opts.includeTimeline ? this.generateTimeline(segments) : [];
    const accomplishments = this.extractAccomplishments(segments);
    const challenges = this.extractChallenges(segments);
    const sentiment = this.determineSentiment(segments, events);

    // Calculate statistics
    const workers = new Set(events.map(e => e.worker));
    const beadsWorked = new Set(events.filter(e => e.bead).map(e => e.bead!));
    const filesModified = new Set(events.filter(e => e.path).map(e => e.path!));
    const toolsUsed = new Set(events.filter(e => e.tool).map(e => e.tool!));
    const errorsEncountered = events.filter(e => e.level === 'error' || e.error).length;

    const startTime = events.length > 0 ? events[0].ts : Date.now();
    const endTime = events.length > 0 ? events[events.length - 1].ts : Date.now();

    const narrative: SemanticNarrative = {
      id: `narrative-agg-${this.narrativeCounter++}`,
      workerId: 'all',
      title: `Aggregated Activity: ${workers.size} worker${workers.size !== 1 ? 's' : ''}`,
      summary,
      segments,
      fullNarrative,
      timeline,
      startTime,
      endTime,
      durationMs: endTime - startTime,
      accomplishments,
      challenges,
      sentiment,
      stats: {
        totalEvents: events.length,
        segmentCount: segments.length,
        beadsWorked: beadsWorked.size,
        filesModified: filesModified.size,
        errorsEncountered,
        toolsUsed: toolsUsed.size,
      },
      generatedAt: Date.now(),
      isLive: true,
    };

    this.narratives.set(narrative.id, narrative);
    return narrative;
  }

  /**
   * Get all active narratives
   */
  getActiveNarratives(): SemanticNarrative[] {
    return Array.from(this.narratives.values()).filter(n => n.isLive);
  }

  /**
   * Get narrative by ID
   */
  getNarrative(narrativeId: string): SemanticNarrative | undefined {
    return this.narratives.get(narrativeId);
  }

  /**
   * Subscribe to narrative updates
   */
  onUpdate(callback: (update: NarrativeUpdate) => void): () => void {
    this.globalUpdateCallbacks.push(callback);
    return () => {
      const index = this.globalUpdateCallbacks.indexOf(callback);
      if (index > -1) {
        this.globalUpdateCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Clear all narratives
   */
  clear(): void {
    this.contexts.clear();
    this.narratives.clear();
    this.globalUpdateCallbacks = [];
    this.segmentCounter = 0;
    this.narrativeCounter = 0;
  }

  /**
   * Format narrative as string
   */
  formatNarrative(narrative: SemanticNarrative, style: NarrativeStyle = 'detailed'): string {
    const lines: string[] = [];

    // Title
    lines.push(`# ${narrative.title}`);
    lines.push('');

    // Summary
    lines.push('## Summary');
    lines.push('');
    lines.push(narrative.summary);
    lines.push('');

    // Statistics
    lines.push('## Statistics');
    lines.push('');
    lines.push(`- **Duration:** ${this.formatDuration(narrative.durationMs)}`);
    lines.push(`- **Events:** ${narrative.stats.totalEvents}`);
    lines.push(`- **Beads Worked:** ${narrative.stats.beadsWorked}`);
    lines.push(`- **Files Modified:** ${narrative.stats.filesModified}`);
    lines.push(`- **Tools Used:** ${narrative.stats.toolsUsed}`);
    lines.push(`- **Errors:** ${narrative.stats.errorsEncountered}`);
    lines.push(`- **Sentiment:** ${narrative.sentiment}`);
    lines.push('');

    if (style === 'brief') {
      return lines.join('\n');
    }

    // Accomplishments
    if (narrative.accomplishments.length > 0) {
      lines.push('## Accomplishments');
      lines.push('');
      narrative.accomplishments.forEach(acc => {
        lines.push(`- ${acc}`);
      });
      lines.push('');
    }

    // Challenges
    if (narrative.challenges.length > 0) {
      lines.push('## Challenges');
      lines.push('');
      narrative.challenges.forEach(challenge => {
        lines.push(`- ${challenge}`);
      });
      lines.push('');
    }

    if (style === 'timeline') {
      // Timeline view
      lines.push('## Timeline');
      lines.push('');
      narrative.timeline.forEach(item => {
        lines.push(item);
      });
      lines.push('');
    } else if (style === 'detailed' || style === 'technical') {
      // Full narrative
      lines.push('## Narrative');
      lines.push('');
      lines.push(narrative.fullNarrative);
      lines.push('');

      // Technical details
      if (style === 'technical') {
        lines.push('## Detailed Segments');
        lines.push('');
        narrative.segments.forEach((segment, i) => {
          lines.push(`### ${i + 1}. ${segment.pattern} (${this.formatDuration(segment.durationMs)})`);
          lines.push('');
          lines.push(`**Summary:** ${segment.summary}`);
          if (segment.details) {
            lines.push('');
            lines.push(segment.details);
          }
          lines.push('');
          lines.push(`**Events:** ${segment.events.length}`);
          if (segment.entities.files && segment.entities.files.length > 0) {
            lines.push(`**Files:** ${segment.entities.files.join(', ')}`);
          }
          if (segment.entities.tools && segment.entities.tools.length > 0) {
            lines.push(`**Tools:** ${segment.entities.tools.join(', ')}`);
          }
          lines.push('');
        });
      }
    }

    lines.push('---');
    lines.push('');
    lines.push(`*Generated at ${new Date(narrative.generatedAt).toISOString()}*`);

    return lines.join('\n');
  }

  // ==========================================
  // Private Helper Methods
  // ==========================================

  private createContext(workerId: string, startTime: number): NarrativeContext {
    return {
      narrativeId: `narrative-${this.narrativeCounter++}`,
      workerId,
      events: [],
      segments: [],
      activeSegment: null,
      lastEventTime: startTime,
      startTime,
      beadsWorked: new Set(),
      filesModified: new Set(),
      toolsUsed: new Set(),
      errorsEncountered: 0,
      updateCallbacks: [],
    };
  }

  private createEmptyNarrative(workerId: string): SemanticNarrative {
    return {
      id: `narrative-empty-${this.narrativeCounter++}`,
      workerId,
      title: `No activity for ${workerId}`,
      summary: 'No events recorded for this worker.',
      segments: [],
      fullNarrative: 'No activity to report.',
      timeline: [],
      startTime: Date.now(),
      endTime: Date.now(),
      durationMs: 0,
      accomplishments: [],
      challenges: [],
      sentiment: 'idle',
      stats: {
        totalEvents: 0,
        segmentCount: 0,
        beadsWorked: 0,
        filesModified: 0,
        errorsEncountered: 0,
        toolsUsed: 0,
      },
      generatedAt: Date.now(),
      isLive: false,
    };
  }

  private updateNarrativeSegment(context: NarrativeContext, event: LogEvent): void {
    const timeSinceLastEvent = context.lastEventTime > 0
      ? event.ts - context.lastEventTime
      : 0;

    // If too much time has passed, close the active segment
    if (timeSinceLastEvent > DEFAULT_OPTIONS.segmentWindowMs && context.activeSegment) {
      this.closeSegment(context);
    }

    // Detect pattern for this event
    const pattern = this.detectPattern(event, context);

    // If no active segment or pattern changed, create new segment
    if (!context.activeSegment || context.activeSegment.pattern !== pattern) {
      if (context.activeSegment) {
        this.closeSegment(context);
      }
      context.activeSegment = this.createSegment(pattern, event, context);
    } else {
      // Add to existing segment
      context.activeSegment.events.push(event);
      context.activeSegment.endTime = event.ts;
      context.activeSegment.durationMs = event.ts - context.activeSegment.startTime;

      // Update entities
      if (event.path && !context.activeSegment.entities.files?.includes(event.path)) {
        context.activeSegment.entities.files = context.activeSegment.entities.files || [];
        context.activeSegment.entities.files.push(event.path);
      }
      if (event.tool && !context.activeSegment.entities.tools?.includes(event.tool)) {
        context.activeSegment.entities.tools = context.activeSegment.entities.tools || [];
        context.activeSegment.entities.tools.push(event.tool);
      }

      // Update summary
      context.activeSegment.summary = this.generateSegmentSummary(context.activeSegment);
    }

    // Emit update
    this.emitUpdate({
      narrativeId: context.narrativeId,
      type: 'segment_updated',
      segment: context.activeSegment,
      timestamp: event.ts,
      summary: context.activeSegment.summary,
    });
  }

  private closeSegment(context: NarrativeContext): void {
    if (!context.activeSegment) return;

    context.activeSegment.isActive = false;
    context.segments.push(context.activeSegment);

    this.emitUpdate({
      narrativeId: context.narrativeId,
      type: 'segment_completed',
      segment: context.activeSegment,
      timestamp: context.activeSegment.endTime,
    });

    context.activeSegment = null;
  }

  private createSegment(pattern: EventPattern, event: LogEvent, context: NarrativeContext): NarrativeSegment {
    const segment: NarrativeSegment = {
      id: `segment-${this.segmentCounter++}`,
      pattern,
      summary: '',
      startTime: event.ts,
      endTime: event.ts,
      durationMs: 0,
      workerId: event.worker,
      beadId: event.bead,
      events: [event],
      entities: {
        files: event.path ? [event.path] : [],
        tools: event.tool ? [event.tool] : [],
        beads: event.bead ? [event.bead] : [],
        errors: (event.level === 'error' || event.error) ? [event.error || event.msg] : [],
      },
      confidence: 0.8,
      isActive: true,
    };

    segment.summary = this.generateSegmentSummary(segment);
    return segment;
  }

  private detectPattern(event: LogEvent, context: NarrativeContext): EventPattern {
    const msg = event.msg.toLowerCase();
    const tool = event.tool?.toLowerCase() || '';

    // Bead lifecycle
    if (msg.includes('started') && event.bead) return 'bead_started';
    if (msg.includes('completed') || msg.includes('finished')) return 'bead_completed';

    // File operations
    if (tool === 'write' || msg.includes('creating file')) return 'file_created';
    if (tool === 'edit' || tool === 'notebookedit') return 'file_editing';

    // Testing
    if (msg.includes('test') || msg.includes('vitest') || msg.includes('jest')) return 'testing';

    // Debugging
    if (event.level === 'error' || event.error || msg.includes('debug')) return 'debugging';

    // Git operations
    if (tool === 'git' || msg.includes('commit') || msg.includes('push')) return 'git_operations';

    // Dependency management
    if (msg.includes('npm install') || msg.includes('yarn') || msg.includes('dependency')) return 'dependency_install';

    // Investigation
    if (tool === 'read' || tool === 'grep' || tool === 'glob') return 'investigation';

    // Iteration (multiple edits to same file)
    if (context.activeSegment?.pattern === 'file_editing' && context.activeSegment.entities.files?.includes(event.path || '')) {
      return 'iteration';
    }

    // Default
    return 'investigation';
  }

  private generateSegments(events: LogEvent[], options: Required<NarrativeOptions>): NarrativeSegment[] {
    const segments: NarrativeSegment[] = [];
    let currentSegment: NarrativeSegment | null = null;
    let lastEventTime = 0;

    const tempContext: Partial<NarrativeContext> = {
      segments: [],
      activeSegment: null,
    };

    for (const event of events) {
      const timeSinceLastEvent = lastEventTime > 0 ? event.ts - lastEventTime : 0;

      // Close segment if time gap is too large
      if (timeSinceLastEvent > options.segmentWindowMs && currentSegment) {
        currentSegment.isActive = false;
        if (currentSegment.events.length >= options.minEventsPerSegment) {
          segments.push(currentSegment);
        }
        currentSegment = null;
      }

      const pattern = this.detectPattern(event, tempContext as NarrativeContext);

      // Create new segment if pattern changed or no active segment
      if (!currentSegment || currentSegment.pattern !== pattern) {
        if (currentSegment) {
          currentSegment.isActive = false;
          if (currentSegment.events.length >= options.minEventsPerSegment) {
            segments.push(currentSegment);
          }
        }
        currentSegment = this.createSegment(pattern, event, tempContext as NarrativeContext);
      } else {
        // Add to existing segment
        currentSegment.events.push(event);
        currentSegment.endTime = event.ts;
        currentSegment.durationMs = event.ts - currentSegment.startTime;

        if (event.path && !currentSegment.entities.files?.includes(event.path)) {
          currentSegment.entities.files = currentSegment.entities.files || [];
          currentSegment.entities.files.push(event.path);
        }
        if (event.tool && !currentSegment.entities.tools?.includes(event.tool)) {
          currentSegment.entities.tools = currentSegment.entities.tools || [];
          currentSegment.entities.tools.push(event.tool);
        }
      }

      tempContext.activeSegment = currentSegment;
      lastEventTime = event.ts;
    }

    // Add final segment
    if (currentSegment && currentSegment.events.length >= options.minEventsPerSegment) {
      currentSegment.isActive = false;
      segments.push(currentSegment);
    }

    // Update all segment summaries
    segments.forEach(segment => {
      segment.summary = this.generateSegmentSummary(segment);
    });

    return segments.slice(0, options.maxSegments);
  }

  private generateSegmentSummary(segment: NarrativeSegment): string {
    const { pattern, events, entities } = segment;
    const fileCount = entities.files?.length || 0;
    const toolCount = entities.tools?.length || 0;

    switch (pattern) {
      case 'bead_started':
        return `Started working on ${segment.beadId || 'a task'}`;

      case 'bead_completed':
        return `Completed ${segment.beadId || 'task'} (${this.formatDuration(segment.durationMs)})`;

      case 'file_editing':
        if (fileCount === 1) {
          return `Editing ${entities.files![0]}`;
        }
        return `Editing ${fileCount} file${fileCount !== 1 ? 's' : ''}`;

      case 'file_created':
        if (fileCount === 1) {
          return `Created ${entities.files![0]}`;
        }
        return `Created ${fileCount} new file${fileCount !== 1 ? 's' : ''}`;

      case 'testing':
        return `Running tests (${events.length} event${events.length !== 1 ? 's' : ''})`;

      case 'debugging':
        const errorCount = entities.errors?.length || events.length;
        return `Debugging ${errorCount} error${errorCount !== 1 ? 's' : ''}`;

      case 'git_operations':
        return `Git operations (${events.length} action${events.length !== 1 ? 's' : ''})`;

      case 'dependency_install':
        return 'Installing dependencies';

      case 'iteration':
        return `Iterative refinement on ${fileCount} file${fileCount !== 1 ? 's' : ''}`;

      case 'investigation':
        return `Investigating codebase (${toolCount} tool${toolCount !== 1 ? 's' : ''} used)`;

      default:
        return `Working (${events.length} event${events.length !== 1 ? 's' : ''})`;
    }
  }

  private generateSummary(segments: NarrativeSegment[], events: LogEvent[], isAggregated = false): string {
    if (segments.length === 0) {
      return 'No activity to report.';
    }

    const beads = new Set(events.filter(e => e.bead).map(e => e.bead!));
    const files = new Set(events.filter(e => e.path).map(e => e.path!));
    const errors = events.filter(e => e.level === 'error' || e.error).length;

    const totalDuration = this.formatDuration(
      events.length > 0 ? events[events.length - 1].ts - events[0].ts : 0
    );

    const parts: string[] = [];

    if (isAggregated) {
      const workers = new Set(events.map(e => e.worker));
      parts.push(`${workers.size} worker${workers.size !== 1 ? 's' : ''} active over ${totalDuration}`);
    } else {
      parts.push(`Active for ${totalDuration}`);
    }

    if (beads.size > 0) {
      parts.push(`worked on ${beads.size} bead${beads.size !== 1 ? 's' : ''}`);
    }

    if (files.size > 0) {
      parts.push(`modified ${files.size} file${files.size !== 1 ? 's' : ''}`);
    }

    if (errors > 0) {
      parts.push(`encountered ${errors} error${errors !== 1 ? 's' : ''}`);
    }

    const mainActivities = this.getTopPatterns(segments, 3);
    if (mainActivities.length > 0) {
      parts.push(`primarily ${mainActivities.map(p => this.patternToVerb(p)).join(', ')}`);
    }

    return parts.join(', ') + '.';
  }

  private generateFullNarrative(segments: NarrativeSegment[], style: NarrativeStyle = 'detailed', isAggregated = false): string {
    if (segments.length === 0) {
      return 'No activity recorded.';
    }

    const lines: string[] = [];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const connector = i === 0 ? 'Started by' : this.getConnector(segment, segments[i - 1]);

      lines.push(`${connector} ${segment.summary.toLowerCase()}.`);

      if (style === 'detailed' && segment.details) {
        lines.push(`  ${segment.details}`);
      }
    }

    return lines.join(' ');
  }

  private generateTimeline(segments: NarrativeSegment[]): string[] {
    return segments.map(segment => {
      const time = new Date(segment.startTime).toISOString().split('T')[1].split('.')[0];
      return `[${time}] ${segment.summary}`;
    });
  }

  private generateTitle(workerId: string, segments: NarrativeSegment[]): string {
    if (segments.length === 0) {
      return `${workerId}: Idle`;
    }

    const topPattern = this.getTopPatterns(segments, 1)[0];
    const verb = topPattern ? this.patternToVerb(topPattern) : 'working';

    return `${workerId}: ${verb.charAt(0).toUpperCase() + verb.slice(1)}`;
  }

  private extractAccomplishments(segments: NarrativeSegment[]): string[] {
    const accomplishments: string[] = [];

    for (const segment of segments) {
      if (segment.pattern === 'bead_completed') {
        accomplishments.push(`Completed ${segment.beadId || 'task'}`);
      } else if (segment.pattern === 'file_created' && segment.entities.files) {
        accomplishments.push(`Created ${segment.entities.files.length} file${segment.entities.files.length !== 1 ? 's' : ''}`);
      } else if (segment.pattern === 'git_operations') {
        accomplishments.push('Committed changes to Git');
      }
    }

    return accomplishments.slice(0, 5);
  }

  private extractChallenges(segments: NarrativeSegment[]): string[] {
    const challenges: string[] = [];

    for (const segment of segments) {
      if (segment.pattern === 'debugging' && segment.entities.errors && segment.entities.errors.length > 0) {
        challenges.push(`Debugged ${segment.entities.errors.length} error${segment.entities.errors.length !== 1 ? 's' : ''}`);
      }
    }

    return challenges.slice(0, 5);
  }

  private determineSentiment(segments: NarrativeSegment[], events: LogEvent[]): 'productive' | 'struggling' | 'mixed' | 'idle' {
    if (segments.length === 0) return 'idle';

    const completions = segments.filter(s => s.pattern === 'bead_completed').length;
    const errors = segments.filter(s => s.pattern === 'debugging').length;
    const totalTime = segments.reduce((sum, s) => sum + s.durationMs, 0);

    if (completions > 0 && errors === 0) return 'productive';
    if (errors > completions * 2) return 'struggling';
    if (completions > 0 || totalTime > 300000) return 'productive'; // > 5 minutes active
    if (errors > 0) return 'mixed';

    return 'mixed';
  }

  private getTopPatterns(segments: NarrativeSegment[], count: number): EventPattern[] {
    const patternCounts = new Map<EventPattern, number>();

    for (const segment of segments) {
      patternCounts.set(segment.pattern, (patternCounts.get(segment.pattern) || 0) + 1);
    }

    return Array.from(patternCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([pattern]) => pattern);
  }

  private patternToVerb(pattern: EventPattern): string {
    const verbs: Record<EventPattern, string> = {
      bead_started: 'starting tasks',
      bead_completed: 'completing tasks',
      file_editing: 'editing files',
      file_created: 'creating files',
      testing: 'running tests',
      debugging: 'debugging',
      git_operations: 'using git',
      dependency_install: 'installing dependencies',
      iteration: 'iterating',
      investigation: 'investigating',
      collision_detected: 'resolving conflicts',
      error_recovery: 'recovering from errors',
    };

    return verbs[pattern] || 'working';
  }

  private getConnector(current: NarrativeSegment, previous: NarrativeSegment): string {
    const timeDiff = current.startTime - previous.endTime;

    if (timeDiff > 300000) { // 5 minutes
      return 'After a pause,';
    }

    if (current.pattern === previous.pattern) {
      return 'Continued';
    }

    if (current.pattern === 'debugging' && previous.pattern === 'testing') {
      return 'Tests revealed issues, then';
    }

    if (current.pattern === 'testing' && previous.pattern === 'file_editing') {
      return 'After edits,';
    }

    if (current.pattern === 'git_operations' && previous.pattern === 'testing') {
      return 'Tests passed, then';
    }

    return 'Then';
  }

  private emitUpdate(update: NarrativeUpdate): void {
    this.globalUpdateCallbacks.forEach(callback => {
      try {
        callback(update);
      } catch (error) {
        console.error('Error in narrative update callback:', error);
      }
    });
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) {
      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
}

// Singleton instance
let instance: SemanticNarrativeGenerator | null = null;

export function getSemanticNarrativeManager(): SemanticNarrativeGenerator {
  if (!instance) {
    instance = new SemanticNarrativeGenerator();
  }
  return instance;
}
