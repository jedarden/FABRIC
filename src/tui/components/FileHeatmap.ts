/**
 * FileHeatmap Component
 *
 * Displays a heatmap of files showing modification frequency and collision risks.
 * Helps identify hotspots and potential collision areas between workers.
 * Includes anomaly detection for unexpected file activity.
 */

import blessed from 'blessed';
import { FileHeatmapEntry, FileHeatmapStats, HeatmapOptions, HeatLevel, FileAnomaly, AnomalyDetectionOptions } from '../../types.js';
import { colors, getHeatColor, getHeatIcon } from '../utils/colors.js';
import { getAnomalyIcon, getAnomalyColor, getAnomalyTypeLabel } from '../utils/fileAnomalyDetection.js';

export interface FileHeatmapOptions {
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

export type HeatmapSortMode = 'modifications' | 'recent' | 'workers' | 'collisions';

/**
 * FileHeatmap displays file modification frequency as a visual heatmap
 */
export class FileHeatmap {
  private box: blessed.Widgets.BoxElement;
  private entries: FileHeatmapEntry[] = [];
  private stats: FileHeatmapStats | null = null;
  private anomalies: FileAnomaly[] = [];
  private selectedIndex = 0;
  private sortMode: HeatmapSortMode = 'modifications';
  private filter: string = '';
  private showCollisionOnly = false;
  private showAnomaliesOnly = false;
  private anomalyIndex = 0;

  constructor(options: FileHeatmapOptions) {
    this.box = blessed.box({
      parent: options.parent,
      tags: true,
      top: options.top,
      left: options.left,
      width: options.width,
      bottom: options.bottom,
      label: ' File Heatmap ',
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
      this.selectedIndex = Math.max(0, this.entries.length - 1);
      this.render();
    });

    // Sort mode cycling
    this.box.key(['s'], () => {
      this.cycleSortMode();
    });

    // Toggle collision filter
    this.box.key(['c'], () => {
      this.showCollisionOnly = !this.showCollisionOnly;
      this.showAnomaliesOnly = false; // Reset anomaly mode
      this.render();
    });

    // Toggle anomaly view
    this.box.key(['a'], () => {
      this.showAnomaliesOnly = !this.showAnomaliesOnly;
      this.showCollisionOnly = false; // Reset collision mode
      this.anomalyIndex = 0;
      this.render();
    });
  }

  /**
   * Cycle through sort modes
   */
  private cycleSortMode(): void {
    const modes: HeatmapSortMode[] = ['modifications', 'recent', 'workers', 'collisions'];
    const currentIndex = modes.indexOf(this.sortMode);
    this.sortMode = modes[(currentIndex + 1) % modes.length];
    this.render();
  }

  /**
   * Get heat bar visualization
   */
  private getHeatBar(level: HeatLevel, modifications: number): string {
    const maxBars = 10;
    let bars: number;

    switch (level) {
      case 'cold': bars = Math.min(2, modifications); break;
      case 'warm': bars = Math.min(4, Math.floor(modifications / 2) + 2); break;
      case 'hot': bars = Math.min(7, Math.floor(modifications / 2) + 4); break;
      case 'critical': bars = Math.min(10, Math.floor(modifications / 2) + 6); break;
    }

    const filled = '█'.repeat(bars);
    const empty = '░'.repeat(maxBars - bars);
    const color = getHeatColor(level);

    return `{${color}-fg}${filled}{/}${empty}`;
  }

  /**
   * Format path for display (truncate if too long)
   */
  private formatPath(path: string, maxLength: number = 40): string {
    if (path.length <= maxLength) return path;

    // Try to keep the filename visible
    const fileName = path.substring(path.lastIndexOf('/') + 1);
    const dir = path.substring(0, path.lastIndexOf('/'));

    if (fileName.length >= maxLength - 3) {
      return '...' + fileName.substring(0, maxLength - 3);
    }

    const available = maxLength - fileName.length - 4; // 4 for ".../"
    if (available > 0 && dir.length > available) {
      return dir.substring(0, available) + '.../' + fileName;
    }

    return '...' + path.substring(path.length - maxLength + 3);
  }

  /**
   * Format worker list for display
   */
  private formatWorkers(workers: FileHeatmapEntry['workers']): string {
    if (workers.length === 0) return '-';
    if (workers.length === 1) return `{cyan-fg}${workers[0].workerId.slice(0, 8)}{/}`;

    // Show top 2 workers with count
    const top = workers.slice(0, 2).map(w => w.workerId.slice(0, 6)).join(', ');
    const extra = workers.length > 2 ? ` +${workers.length - 2}` : '';
    return `{cyan-fg}${top}{/}${extra}`;
  }

  /**
   * Format a single heatmap entry
   */
  private formatEntry(entry: FileHeatmapEntry, isSelected: boolean): string {
    const icon = getHeatIcon(entry.heatLevel);
    const color = getHeatColor(entry.heatLevel);
    const heatBar = this.getHeatBar(entry.heatLevel, entry.modifications);
    const path = this.formatPath(entry.path);
    const workers = this.formatWorkers(entry.workers);

    // Collision indicator
    const collisionIndicator = entry.hasCollision
      ? '{red-fg}⚠{/}'
      : entry.activeWorkers > 1
        ? '{yellow-fg}⚡{/}'
        : ' ';

    // Modification count
    const modCount = `{bold}${entry.modifications.toString().padStart(3)}{/}`;

    const selectedMarker = isSelected ? '>' : ' ';

    // Format: [icon] [heat bar] [count] [path] [workers] [collision]
    return `${selectedMarker} {${color}-fg}${icon}{/} ${heatBar} ${modCount} ${path} ${workers} ${collisionIndicator}`;
  }

  /**
   * Format statistics header
   */
  private formatStats(stats: FileHeatmapStats): string {
    const heatDist = stats.heatDistribution;
    const sortLabel = `Sort: ${this.sortMode}`;
    const filterLabel = this.showCollisionOnly ? ' | Collisions Only' : '';
    const anomalyLabel = this.showAnomaliesOnly ? ' | Anomalies Only' : '';

    const anomalyCount = this.anomalies.length;
    const anomalyDisplay = anomalyCount > 0
      ? ` | {yellow-fg}⚠ ${anomalyCount} anomalies{/}`
      : '';

    return `{bold}Files: ${stats.totalFiles}{/} | ` +
      `Mods: ${stats.totalModifications} | ` +
      `Active: ${stats.activeFiles} | ` +
      `{red-fg}⚠ ${stats.collisionFiles}{/}${anomalyDisplay} | ` +
      `[s] ${sortLabel}${filterLabel}${anomalyLabel}\n` +
      `{blue-fg}○${heatDist.cold}{/} ` +
      `{yellow-fg}◐${heatDist.warm}{/} ` +
      `{magenta-fg}●${heatDist.hot}{/} ` +
      `{red-fg}🔥${heatDist.critical}{/}`;
  }

  /**
   * Format a single anomaly entry
   */
  private formatAnomaly(anomaly: FileAnomaly, isSelected: boolean): string {
    const icon = getAnomalyIcon(anomaly.severity);
    const color = getAnomalyColor(anomaly.severity);
    const typeLabel = getAnomalyTypeLabel(anomaly.type);
    const path = this.formatPath(anomaly.path);

    const selectedMarker = isSelected ? '>' : ' ';

    // Format: [icon] [type] [severity] [path] [message]
    const severityTag = `{${color}-fg}[${anomaly.severity.toUpperCase()}]{/}`;
    const typeTag = `{gray-fg}[${typeLabel}]{/}`;

    // Truncate message if too long
    let message = anomaly.message;
    if (message.length > 30) {
      message = message.substring(0, 27) + '...';
    }

    return `${selectedMarker} {${color}-fg}${icon}{/} ${typeTag} ${severityTag} ${path}\n` +
      `      ${message}`;
  }

  /**
   * Format anomaly section header
   */
  private formatAnomalyHeader(): string {
    const critical = this.anomalies.filter(a => a.severity === 'critical').length;
    const warning = this.anomalies.filter(a => a.severity === 'warning').length;
    const info = this.anomalies.filter(a => a.severity === 'info').length;

    return `{bold}Unexpected Activity{/} ` +
      `({red-fg}🚨 ${critical}{/} ` +
      `{yellow-fg}⚠ ${warning}{/} ` +
      `{blue-fg}ℹ ${info}{/})`;
  }

  /**
   * Update heatmap data
   */
  updateData(
    getHeatmap: (options: HeatmapOptions) => FileHeatmapEntry[],
    getStats: () => FileHeatmapStats,
    getAnomalies?: (options: AnomalyDetectionOptions) => FileAnomaly[]
  ): void {
    this.entries = getHeatmap({
      sortBy: this.sortMode,
      maxEntries: 100,
      collisionsOnly: this.showCollisionOnly,
      directoryFilter: this.filter || undefined,
    });
    this.stats = getStats();

    // Get anomalies if getter provided
    if (getAnomalies) {
      this.anomalies = getAnomalies({});
    }

    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.entries.length - 1));
    this.anomalyIndex = Math.min(this.anomalyIndex, Math.max(0, this.anomalies.length - 1));
    this.render();
  }

  /**
   * Set directory filter
   */
  setFilter(filter: string): void {
    this.filter = filter;
    this.render();
  }

  /**
   * Clear filter
   */
  clearFilter(): void {
    this.filter = '';
    this.showCollisionOnly = false;
    this.showAnomaliesOnly = false;
    this.render();
  }

  /**
   * Select next entry
   */
  selectNext(): void {
    if (this.showAnomaliesOnly) {
      if (this.anomalies.length === 0) return;
      this.anomalyIndex = (this.anomalyIndex + 1) % this.anomalies.length;
    } else {
      if (this.entries.length === 0) return;
      this.selectedIndex = (this.selectedIndex + 1) % this.entries.length;
    }
    this.render();
  }

  /**
   * Select previous entry
   */
  selectPrevious(): void {
    if (this.showAnomaliesOnly) {
      if (this.anomalies.length === 0) return;
      this.anomalyIndex = this.anomalyIndex === 0
        ? this.anomalies.length - 1
        : this.anomalyIndex - 1;
    } else {
      if (this.entries.length === 0) return;
      this.selectedIndex = this.selectedIndex === 0
        ? this.entries.length - 1
        : this.selectedIndex - 1;
    }
    this.render();
  }

  /**
   * Get currently selected entry
   */
  getSelected(): FileHeatmapEntry | undefined {
    return this.entries[this.selectedIndex];
  }

  /**
   * Get currently selected anomaly
   */
  getSelectedAnomaly(): FileAnomaly | undefined {
    return this.anomalies[this.anomalyIndex];
  }

  /**
   * Get current sort mode
   */
  getSortMode(): HeatmapSortMode {
    return this.sortMode;
  }

  /**
   * Get collision filter state
   */
  getCollisionFilter(): boolean {
    return this.showCollisionOnly;
  }

  /**
   * Get anomaly filter state
   */
  getAnomalyFilter(): boolean {
    return this.showAnomaliesOnly;
  }

  /**
   * Render the component
   */
  render(): void {
    const lines: string[] = [];

    // Stats header
    if (this.stats) {
      lines.push(this.formatStats(this.stats));
      lines.push(''); // Empty line separator
    }

    // Anomaly-only view mode
    if (this.showAnomaliesOnly) {
      lines.push(this.formatAnomalyHeader());
      lines.push('');

      if (this.anomalies.length === 0) {
        lines.push('{green-fg}✓ No anomalies detected{/}');
        lines.push('{gray-fg}Press [a] to return to file view{/}');
      } else {
        for (let i = 0; i < this.anomalies.length; i++) {
          const anomaly = this.anomalies[i];
          const isSelected = i === this.anomalyIndex;
          lines.push(this.formatAnomaly(anomaly, isSelected));
        }

        // Footer help
        lines.push('');
        lines.push('{gray-fg}[a] Back to files  [j/k] Scroll{/}');
      }
    } else {
      // Normal file view
      if (this.entries.length === 0) {
        lines.push('{gray-fg}No file modifications detected{/}');
        if (this.showCollisionOnly) {
          lines.push('{gray-fg}Press [c] to show all files{/}');
        }
      } else {
        for (let i = 0; i < this.entries.length; i++) {
          const entry = this.entries[i];
          const isSelected = i === this.selectedIndex;
          lines.push(this.formatEntry(entry, isSelected));
        }

        // Footer help
        lines.push('');
        lines.push('{gray-fg}[s] Sort  [c] Collisions  [a] Anomalies  [j/k] Scroll{/}');
      }

      // Add anomaly summary section if there are anomalies
      if (this.anomalies.length > 0 && !this.showCollisionOnly) {
        lines.push('');
        lines.push('─'.repeat(40));
        lines.push(this.formatAnomalyHeader());

        // Show top 3 anomalies
        const topAnomalies = this.anomalies.slice(0, 3);
        for (const anomaly of topAnomalies) {
          const icon = getAnomalyIcon(anomaly.severity);
          const color = getAnomalyColor(anomaly.severity);
          const path = this.formatPath(anomaly.path, 25);
          lines.push(`  {${color}-fg}${icon}{/} ${path}`);
        }

        if (this.anomalies.length > 3) {
          lines.push(`  {gray-fg}  ... +${this.anomalies.length - 3} more (press [a] to view){/}`);
        }
      }
    }

    // Update label with current mode
    let label = ' File Heatmap ';
    if (this.showCollisionOnly) {
      label = ' File Heatmap [COLLISIONS] ';
    } else if (this.showAnomaliesOnly) {
      label = ' File Heatmap [ANOMALIES] ';
    }
    this.box.setLabel(label);

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
}

export default FileHeatmap;
