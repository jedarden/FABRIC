/**
 * ActivityStream Component
 *
 * Displays scrolling log output with filtering capabilities.
 */

import blessed from 'blessed';
import { LogEvent } from '../../types.js';
import { colors, getLevelColor } from '../utils/colors.js';
import { isHeartbeatEvent } from '../utils/heartbeatLiveness.js';

export interface ActivityStreamOptions {
  /** Parent screen */
  parent: blessed.Widgets.Screen;

  /** Position from top */
  top: number | string;

  /** Position from right */
  right: number | string;

  /** Width of the panel */
  width: number | string;

  /** Position from bottom */
  bottom: number | string;

  /** Maximum lines to keep in buffer */
  maxLines?: number;

  /** Whether to show the latest heartbeat sample for each worker */
  showHeartbeats?: boolean;
}

export interface ActivityFilter {
  /** Filter by worker ID */
  workerId?: string;

  /** Filter by log level */
  level?: string;

  /** Filter by search term */
  search?: string;

  /** Filter by time range start (Unix timestamp in ms) */
  since?: number;

  /** Filter by time range end (Unix timestamp in ms) */
  until?: number;

  /** Filter by bead ID */
  beadId?: string;

  /** Filter by file pattern (glob-style) */
  filePattern?: string;

  /** Filter by host */
  host?: string;

  /** Explicitly include the collapsed heartbeat samples in the stream */
  includeHeartbeats?: boolean;
}

/**
 * ActivityStream displays real-time log events
 */
export class ActivityStream {
  private log: blessed.Widgets.Log;
  private events: LogEvent[] = [];
  private heartbeatEvents: Map<string, LogEvent> = new Map();
  private totalEventCount = 0;
  private filter: ActivityFilter = {};
  private maxLines: number;
  private isPaused = false;
  private showHeartbeats = false;
  private focusModeEnabled = false;
  private pinnedBeadId?: string;
  private pinnedWorkerId?: string;

  constructor(options: ActivityStreamOptions) {
    this.maxLines = options.maxLines || 500;
    this.showHeartbeats = options.showHeartbeats ?? false;

    this.log = blessed.log({
      parent: options.parent,
      top: options.top,
      right: options.right,
      width: options.width,
      bottom: options.bottom,
      label: ' Activity Stream ',
      tags: true,
      border: { type: 'line' },
      style: {
        border: { fg: colors.border },
        label: { fg: colors.header },
      },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
    });

    this.bindKeys();
  }

  /**
   * Bind component-specific keys
   */
  private bindKeys(): void {
    this.log.key(['p'], () => {
      this.togglePause();
    });

    this.log.key(['C-c'], () => {
      this.clear();
    });
  }

  /**
   * Format event for display
   */
  private formatEvent(event: LogEvent): string {
    const time = new Date(event.ts).toLocaleTimeString();
    const levelColor = getLevelColor(event.level as 'debug' | 'info' | 'warn' | 'error');
    const workerShort = event.worker.slice(0, 8);
    const host = event.host ? `{magenta-fg}@${event.host.slice(0, 8)}{/} ` : '';

    let msg = event.msg;
    if (event.tool) {
      msg = `[${event.tool}] ${msg}`;
    }

    // Check if this event is pinned
    const isBeadPinned = this.pinnedBeadId && event.bead === this.pinnedBeadId;
    const isWorkerPinned = this.pinnedWorkerId && event.worker === this.pinnedWorkerId;
    const isPinned = isBeadPinned || isWorkerPinned;
    const pinIndicator = isPinned ? '{yellow-fg}📌{/}' : '';

    if (event.bead) {
      msg = `{blue-fg}${event.bead}{/} ${pinIndicator}${msg}`;
    }

    // Dim non-pinned events when in focus mode
    const shouldDim = this.focusModeEnabled && (this.pinnedBeadId || this.pinnedWorkerId) && !isPinned;
    const dimPrefix = shouldDim ? '{gray-fg}' : '';
    const dimSuffix = shouldDim ? '{/}' : '';

    return `${dimPrefix}{gray-fg}${time}{/} {bold}${workerShort}{/} ${host}{${levelColor}-fg}${event.level.toUpperCase()}{/} ${msg}${dimSuffix}`;
  }

  /**
   * Check if event passes current filter
   */
  private passesFilter(event: LogEvent): boolean {
    if (this.filter.workerId && event.worker !== this.filter.workerId) {
      return false;
    }
    if (this.filter.level && event.level !== this.filter.level) {
      return false;
    }
    if (this.filter.host && event.host !== this.filter.host) {
      return false;
    }
    if (this.filter.since && event.ts < this.filter.since) {
      return false;
    }
    if (this.filter.until && event.ts > this.filter.until) {
      return false;
    }
    if (this.filter.beadId && event.bead !== this.filter.beadId) {
      return false;
    }
    if (this.filter.filePattern) {
      const pattern = this.filter.filePattern.toLowerCase();
      const path = event.path?.toLowerCase() || '';
      const msg = event.msg.toLowerCase();
      // Match against file path or message containing file references
      if (!path.includes(pattern) && !msg.includes(pattern)) {
        return false;
      }
    }
    if (this.filter.search) {
      const searchLower = this.filter.search.toLowerCase();
      const matchesSearch =
        event.msg.toLowerCase().includes(searchLower) ||
        event.worker.toLowerCase().includes(searchLower) ||
        (event.tool?.toLowerCase().includes(searchLower) ?? false) ||
        (event.bead?.toLowerCase().includes(searchLower) ?? false);
      if (!matchesSearch) {
        return false;
      }
    }
    return true;
  }

  /** Whether an event should occupy a line in the scrolling stream. */
  private shouldDisplay(event: LogEvent): boolean {
    const includeHeartbeats = this.showHeartbeats || this.filter.includeHeartbeats;
    return (includeHeartbeats || !isHeartbeatEvent(event)) && this.passesFilter(event);
  }

  /** Return regular events plus one latest sample per worker when requested. */
  private getDisplayEvents(): LogEvent[] {
    const events = [...this.events];
    if (this.showHeartbeats || this.filter.includeHeartbeats) {
      events.push(...this.heartbeatEvents.values());
    }
    // Preserve the existing arrival order for non-heartbeat events. The
    // collapsed heartbeat samples are only appended when explicitly shown.
    return events.filter((event) => this.shouldDisplay(event));
  }

  /**
   * Add event to the stream
   */
  addEvent(event: LogEvent): void {
    this.totalEventCount++;

    if (isHeartbeatEvent(event)) {
      const previous = this.heartbeatEvents.get(event.worker);
      if (!previous || event.ts > previous.ts) {
        this.heartbeatEvents.set(event.worker, event);
      }

      // Heartbeats are collapsed to one latest sample per worker when an
      // explicit caller asks to inspect them; the default feed stays quiet.
      if (!this.isPaused && (this.showHeartbeats || this.filter.includeHeartbeats)) {
        this.reRender(false);
      }
      return;
    }

    this.events.push(event);

    // Trim old events
    if (this.events.length > this.maxLines) {
      this.events = this.events.slice(-this.maxLines);
    }

    // Only display if not paused and passes filter
    if (!this.isPaused && this.shouldDisplay(event)) {
      const formatted = this.formatEvent(event);
      this.log.log(formatted);
    }
  }

  /**
   * Add multiple events
   */
  addEvents(events: LogEvent[]): void {
    for (const event of events) {
      this.addEvent(event);
    }
  }

  /**
   * Toggle pause state
   */
  togglePause(): void {
    this.isPaused = !this.isPaused;
    const label = this.isPaused ? ' Activity Stream [PAUSED] ' : ' Activity Stream ';
    this.log.setLabel(label);
    this.log.screen.render();
  }

  /**
   * Set filter and re-render
   */
  setFilter(filter: ActivityFilter): void {
    this.filter = filter;
    this.reRender();
  }

  /**
   * Clear filter
   */
  clearFilter(): void {
    this.filter = {};
    this.reRender();
  }

  /**
   * Set time filter (show events since cutoff time)
   */
  setTimeFilter(cutoffTime: number): void {
    this.filter.since = cutoffTime;
    this.reRender();
  }

  /**
   * Scroll to a specific timestamp in the log
   */
  scrollToTimestamp(timestamp: number): void {
    // Find the event closest to the target timestamp
    const displayEvents = this.getDisplayEvents();
    let closestIndex = -1;
    let closestDiff = Infinity;

    for (let i = 0; i < displayEvents.length; i++) {
      const diff = Math.abs(displayEvents[i].ts - timestamp);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIndex = i;
      }
    }

    if (closestIndex >= 0) {
      // Re-render with context around the target
      this.log.setContent('');

      // Show 50 events before the target and 50 after
      const start = Math.max(0, closestIndex - 50);
      const end = Math.min(displayEvents.length, closestIndex + 51);

      for (let i = start; i < end; i++) {
        if (this.shouldDisplay(displayEvents[i])) {
          const formatted = this.formatEvent(displayEvents[i]);
          const isTarget = i === closestIndex;
          if (isTarget) {
            // Add indicator for the target event
            this.log.log(`{yellow-fg}➜{/} ${formatted}`);
          } else {
            this.log.log(formatted);
          }
        }
      }

      // Scroll to make the target visible
      this.log.setScroll((closestIndex - start) - 10);
      this.log.screen.render();
    }
  }

  /**
   * Re-render all events with current filter
   */
  private reRender(renderScreen = true): void {
    // Clear the log
    this.log.setContent('');

    // Re-add filtered events
    const filtered = this.getDisplayEvents();
    for (const event of filtered.slice(-100)) { // Show last 100 matching
      const formatted = this.formatEvent(event);
      this.log.log(formatted);
    }

    if (renderScreen) this.log.screen.render();
  }

  /**
   * Clear all events
   */
  clear(): void {
    this.events = [];
    this.heartbeatEvents.clear();
    this.totalEventCount = 0;
    this.log.setContent('');
    this.log.screen.render();
  }

  /**
   * Focus this component
   */
  focus(): void {
    this.log.focus();
  }

  /**
   * Get the underlying log element
   */
  getElement(): blessed.Widgets.Log {
    return this.log;
  }

  /**
   * Get pause state
   */
  getIsPaused(): boolean {
    return this.isPaused;
  }

  /**
   * Get current filter
   */
  getFilter(): ActivityFilter {
    return { ...this.filter };
  }

  /**
   * Get current events count
   */
  getEventsCount(): number {
    return this.totalEventCount;
  }

  /**
   * Get filtered events count
   */
  getFilteredEventsCount(): number {
    return this.getDisplayEvents().length;
  }

  /** Toggle the collapsed heartbeat samples for callers that need raw detail. */
  setShowHeartbeats(show: boolean): void {
    if (this.showHeartbeats === show) return;
    this.showHeartbeats = show;
    this.reRender();
  }

  /** Return the latest heartbeat seen for each worker. */
  getLastHeartbeats(): ReadonlyMap<string, LogEvent> {
    return new Map(this.heartbeatEvents);
  }

  /**
   * Set focus mode state
   */
  setFocusMode(
    enabled: boolean,
    pinnedBeadId?: string,
    pinnedWorkerId?: string,
    renderScreen = true,
  ): void {
    if (
      this.focusModeEnabled === enabled &&
      this.pinnedBeadId === pinnedBeadId &&
      this.pinnedWorkerId === pinnedWorkerId
    ) {
      return;
    }

    this.focusModeEnabled = enabled;
    this.pinnedBeadId = pinnedBeadId;
    this.pinnedWorkerId = pinnedWorkerId;
    this.reRender(renderScreen);
  }
}

export default ActivityStream;
