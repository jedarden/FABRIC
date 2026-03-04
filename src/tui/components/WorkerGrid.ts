/**
 * WorkerGrid Component
 *
 * Displays all active workers with status indicators in a scrollable list.
 */

import * as blessed from 'blessed';
import { WorkerInfo } from '../../types.js';
import { colors, getStatusColor } from '../utils/colors.js';

export interface WorkerGridOptions {
  /** Parent screen */
  parent: blessed.Widgets.Screen;

  /** Position from top */
  top: number | string;

  /** Position from left */
  left: number | string;

  /** Width of the panel */
  width: number | string;

  /** Position from bottom */
  bottom: number | string;
}

/**
 * WorkerGrid displays worker status in a grid format
 */
export class WorkerGrid {
  private box: blessed.Widgets.BoxElement;
  private workers: WorkerInfo[] = [];
  private selectedIndex = 0;
  private focusModeEnabled = false;
  private pinnedWorkerId?: string;

  constructor(options: WorkerGridOptions) {
    this.box = blessed.box({
      parent: options.parent,
      top: options.top,
      left: options.left,
      width: options.width,
      bottom: options.bottom,
      label: ' Workers ',
      border: { type: 'line' },
      style: {
        border: { fg: colors.border },
        label: { fg: colors.header },
        selected: { fg: colors.focus },
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
    this.box.key(['up', 'k'], () => {
      this.selectPrevious();
    });

    this.box.key(['down', 'j'], () => {
      this.selectNext();
    });

    this.box.key(['g'], () => {
      this.selectedIndex = 0;
      this.render();
    });

    this.box.key(['G'], () => {
      this.selectedIndex = Math.max(0, this.workers.length - 1);
      this.render();
    });
  }

  /**
   * Get status icon for worker
   */
  private getStatusIcon(worker: WorkerInfo): string {
    switch (worker.status) {
      case 'active': return '●';
      case 'idle': return '○';
      case 'error': return '✗';
    }
  }

  /**
   * Get collision indicator for worker
   */
  private getCollisionIndicator(worker: WorkerInfo): string {
    if (worker.hasCollision) {
      return '{yellow-fg}⚠{/}';
    }
    return '';
  }

  /**
   * Format worker line for display
   */
  private formatWorkerLine(worker: WorkerInfo, isSelected: boolean): string {
    const icon = this.getStatusIcon(worker);
    const color = getStatusColor(worker.status);
    const workerId = worker.id.slice(0, 12);
    const currentTask = worker.lastEvent?.bead || '-';
    const taskDesc = (worker.lastEvent?.msg || '').slice(0, 25);
    const duration = this.formatDuration(worker.lastEvent?.ts);
    const collisionIndicator = this.getCollisionIndicator(worker);

    const selectedMarker = isSelected ? '>' : ' ';
    const isPinned = this.pinnedWorkerId === worker.id;
    const pinIndicator = isPinned ? '{yellow-fg}📌{/}' : '';

    // Dim non-pinned workers when in focus mode
    const shouldDim = this.focusModeEnabled && this.pinnedWorkerId && !isPinned;
    const dimPrefix = shouldDim ? '{gray-fg}' : '';
    const dimSuffix = shouldDim ? '{/}' : '';

    return `${dimPrefix}${selectedMarker} {${color}-fg}${icon}{/} {bold}${workerId}{/} ${pinIndicator} {gray-fg}${currentTask}{/} ${taskDesc} {blue-fg}${duration}{/} ${collisionIndicator}${dimSuffix}`;
  }

  /**
   * Format duration from timestamp
   */
  private formatDuration(ts?: number): string {
    if (!ts) return '-';
    const seconds = Math.floor((Date.now() - ts) / 1000);
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h`;
  }

  /**
   * Update workers data
   */
  updateWorkers(workers: WorkerInfo[]): void {
    this.workers = workers;
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, workers.length - 1));
    this.render();
  }

  /**
   * Select next worker
   */
  selectNext(): void {
    if (this.workers.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.workers.length;
    this.render();
  }

  /**
   * Select previous worker
   */
  selectPrevious(): void {
    if (this.workers.length === 0) return;
    this.selectedIndex = this.selectedIndex === 0
      ? this.workers.length - 1
      : this.selectedIndex - 1;
    this.render();
  }

  /**
   * Get currently selected worker
   */
  getSelected(): WorkerInfo | undefined {
    return this.workers[this.selectedIndex];
  }

  /**
   * Render the component
   */
  render(): void {
    const lines: string[] = [];

    if (this.workers.length === 0) {
      lines.push('{gray-fg}No workers detected{/}');
    } else {
      lines.push(`{bold}Total: ${this.workers.length} workers{/}\n`);

      for (let i = 0; i < this.workers.length; i++) {
        const worker = this.workers[i];
        const isSelected = i === this.selectedIndex;
        lines.push(this.formatWorkerLine(worker, isSelected));
      }
    }

    this.box.setContent(lines.join('\n'));
    this.box.screen.render();
  }

  /**
   * Focus this component
   */
  focus(): void {
    this.box.focus();
  }

  /**
   * Get the underlying box element
   */
  getElement(): blessed.Widgets.BoxElement {
    return this.box;
  }

  /**
   * Set focus mode state
   */
  setFocusMode(enabled: boolean, pinnedWorkerId?: string): void {
    this.focusModeEnabled = enabled;
    this.pinnedWorkerId = pinnedWorkerId;
    this.render();
  }
}

export default WorkerGrid;
