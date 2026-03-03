/**
 * WorkerDetail Component
 *
 * Displays detailed information about a selected worker.
 */

import * as blessed from 'blessed';
import { WorkerInfo, LogEvent } from '../../types.js';
import { colors, getStatusColor, getLevelColor } from '../utils/colors.js';

export interface WorkerDetailOptions {
  /** Parent screen */
  parent: blessed.Widgets.Screen;

  /** Position options */
  top: number | string;
  left: number | string;
  width: number | string;
  height: number | string;
}

export class WorkerDetail {
  private box: blessed.Widgets.BoxElement;
  private worker: WorkerInfo | null = null;
  private recentEvents: LogEvent[] = [];

  constructor(options: WorkerDetailOptions) {
    this.box = blessed.box({
      parent: options.parent,
      top: options.top,
      left: options.left,
      width: options.width,
      height: options.height,
      label: ' Worker Details ',
      border: { type: 'line' },
      style: {
        border: { fg: colors.border },
        label: { fg: colors.header },
      },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      hidden: true,
    });
  }

  /**
   * Set worker to display
   */
  setWorker(worker: WorkerInfo | null): void {
    this.worker = worker;
    this.render();
  }

  /**
   * Set recent events for this worker
   */
  setRecentEvents(events: LogEvent[]): void {
    this.recentEvents = events.slice(-20); // Last 20 events
    this.render();
  }

  /**
   * Format duration for display
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  }

  /**
   * Format timestamp for display
   */
  private formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString();
  }

  /**
   * Format uptime
   */
  private formatUptime(firstSeen: number): string {
    const seconds = Math.floor((Date.now() - firstSeen) / 1000);
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }

  /**
   * Render the detail view
   */
  render(): void {
    if (!this.worker) {
      this.box.setContent('{gray-fg}No worker selected{/}');
      this.box.screen.render();
      return;
    }

    const w = this.worker;
    const lines: string[] = [];

    // Header with status
    const statusColor = getStatusColor(w.status);
    const statusIcon = w.status === 'active' ? '●' : w.status === 'idle' ? '○' : '✗';
    lines.push(`{${statusColor}-fg}{bold}${statusIcon} ${w.id}{/}`);
    lines.push('{gray-fg}─────────────────────────────────────{/}');
    lines.push('');

    // Status info
    lines.push(`{bold}Status:{/} {${statusColor}-fg}${w.status.toUpperCase()}{/}`);
    lines.push(`{bold}Uptime:{/} ${this.formatUptime(w.firstSeen)}`);
    lines.push(`{bold}Beads Completed:{/} {green-fg}${w.beadsCompleted}{/}`);
    lines.push('');

    // Last activity
    lines.push('{bold}Last Activity:{/}');
    if (w.lastEvent) {
      const e = w.lastEvent;
      lines.push(`  Time: ${this.formatTime(e.ts)}`);
      lines.push(`  Level: {${getLevelColor(e.level)}-fg}${e.level.toUpperCase()}{/}`);
      if (e.bead) lines.push(`  Bead: {magenta-fg}${e.bead}{/}`);
      if (e.tool) lines.push(`  Tool: {cyan-fg}${e.tool}{/}`);
      if (e.msg) lines.push(`  Msg: ${e.msg.slice(0, 60)}`);
      if (e.duration_ms) lines.push(`  Duration: ${this.formatDuration(e.duration_ms)}`);
      if (e.error) lines.push(`  {red-fg}Error: ${e.error}{/}`);
    } else {
      lines.push('  {gray-fg}No events recorded{/}');
    }

    // Recent events
    if (this.recentEvents.length > 0) {
      lines.push('');
      lines.push('{bold}Recent Events:{/}');
      lines.push('{gray-fg}─────────────────────────────────────{/}');

      for (const e of this.recentEvents.slice(-10)) {
        const time = this.formatTime(e.ts);
        const level = e.level.toUpperCase().slice(0, 3);
        const msg = e.msg?.slice(0, 40) || '';
        lines.push(`  {gray-fg}${time}{/} {${getLevelColor(e.level)}-fg}${level}{/} ${msg}`);
      }
    }

    this.box.setContent(lines.join('\n'));
    this.box.screen.render();
  }

  /**
   * Show the detail view
   */
  show(): void {
    this.box.show();
    this.box.screen.render();
  }

  /**
   * Hide the detail view
   */
  hide(): void {
    this.box.hide();
    this.box.screen.render();
  }

  /**
   * Toggle visibility
   */
  toggle(): void {
    if (this.box.hidden) {
      this.show();
    } else {
      this.hide();
    }
  }

  /**
   * Check if visible
   */
  isVisible(): boolean {
    return !this.box.hidden;
  }

  /**
   * Focus this component
   */
  focus(): void {
    this.box.focus();
  }

  /**
   * Get the underlying blessed element
   */
  getElement(): blessed.Widgets.BoxElement {
    return this.box;
  }
}

export function createWorkerDetail(options: WorkerDetailOptions): WorkerDetail {
  return new WorkerDetail(options);
}
