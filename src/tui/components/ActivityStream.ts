/**
 * ActivityStream Component
 *
 * Displays scrolling log output with filtering capabilities.
 */

import * as blessed from 'blessed';
import { LogEvent } from '../../types.js';
import { colors, getLevelColor } from '../utils/colors.js';

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
}

export interface ActivityFilter {
  /** Filter by worker ID */
  workerId?: string;

  /** Filter by log level */
  level?: string;

  /** Filter by search term */
  search?: string;
}

/**
 * ActivityStream displays real-time log events
 */
export class ActivityStream {
  private log: blessed.Widgets.Log;
  private events: LogEvent[] = [];
  private filter: ActivityFilter = {};
  private maxLines: number;
  private isPaused = false;

  constructor(options: ActivityStreamOptions) {
    this.maxLines = options.maxLines || 500;

    this.log = blessed.log({
      parent: options.parent,
      top: options.top,
      right: options.right,
      width: options.width,
      bottom: options.bottom,
      label: ' Activity Stream ',
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

    let msg = event.msg;
    if (event.tool) {
      msg = `[${event.tool}] ${msg}`;
    }
    if (event.bead) {
      msg = `{blue-fg}${event.bead}{/} ${msg}`;
    }

    return `{gray-fg}${time}{/} {bold}${workerShort}{/} {${levelColor}-fg}${event.level.toUpperCase()}{/} ${msg}`;
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

  /**
   * Add event to the stream
   */
  addEvent(event: LogEvent): void {
    this.events.push(event);

    // Trim old events
    if (this.events.length > this.maxLines) {
      this.events = this.events.slice(-this.maxLines);
    }

    // Only display if not paused and passes filter
    if (!this.isPaused && this.passesFilter(event)) {
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
   * Re-render all events with current filter
   */
  private reRender(): void {
    // Clear the log
    this.log.setContent('');

    // Re-add filtered events
    const filtered = this.events.filter(e => this.passesFilter(e));
    for (const event of filtered.slice(-100)) { // Show last 100 matching
      const formatted = this.formatEvent(event);
      this.log.log(formatted);
    }

    this.log.screen.render();
  }

  /**
   * Clear all events
   */
  clear(): void {
    this.events = [];
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
}

export default ActivityStream;
