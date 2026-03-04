/**
 * WorkerAnalyticsPanel Component
 *
 * TUI component to display worker performance analytics.
 * Shows metrics like beads/hour, error rate, cost per bead, and trends.
 */

import blessed from 'blessed';
import { WorkerMetrics, AggregatedAnalytics, MetricsDataPoint } from '../../types.js';

/** Inline trend type from WorkerMetrics */
type InlineTrend = {
  direction: 'improving' | 'declining' | 'stable';
  confidence: number;
  factors: string[];
};
import { colors } from '../utils/colors.js';
import { WorkerAnalytics } from '../../workerAnalytics.js';

export interface WorkerAnalyticsPanelOptions {
  /** Parent screen */
  parent: blessed.Widgets.Screen;

  /** Position from top */
  top: number | string;

  /** Position from left */
  left: number | string;

  /** Width of the panel */
  width: number | string;

  /** Height of the panel */
  height?: number | string;

  /** Position from bottom (alternative to height) */
  bottom?: number | string;

  /** Callback when a worker is selected */
  onSelect?: (workerId: string) => void;
}

/**
 * Get trend icon
 */
function getTrendIcon(trend: InlineTrend | undefined): string {
  if (!trend) return '→';
  switch (trend.direction) {
    case 'improving':
      return '↑';
    case 'declining':
      return '↓';
    case 'stable':
    default:
      return '→';
  }
}

/**
 * Get trend color
 */
function getTrendColor(trend: InlineTrend | undefined): string {
  if (!trend) return 'white';
  switch (trend.direction) {
    case 'improving':
      return 'green';
    case 'declining':
      return 'red';
    case 'stable':
    default:
      return 'yellow';
  }
}

/**
 * Format duration in human-readable form
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * Format cost
 */
function formatCost(usd: number): string {
  if (usd < 0.01) return `$${(usd * 100).toFixed(2)}c`;
  return `$${usd.toFixed(2)}`;
}

/**
 * Format percentage
 */
function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Get status color based on error rate
 */
function getStatusColor(errorRate: number): string {
  if (errorRate < 0.05) return 'green';
  if (errorRate < 0.15) return 'yellow';
  return 'red';
}

/**
 * WorkerAnalyticsPanel displays worker performance metrics
 */
export class WorkerAnalyticsPanel {
  private box: blessed.Widgets.BoxElement;
  private list: blessed.Widgets.ListElement;
  private detailBox: blessed.Widgets.BoxElement;
  private metrics: WorkerMetrics[] = [];
  private aggregated: AggregatedAnalytics | null = null;
  private selectedIndex = 0;
  private viewMode: 'list' | 'detail' | 'aggregated' = 'list';
  private sortMode: 'beads' | 'errorRate' | 'cost' | 'efficiency' = 'beads';
  private onSelect?: (workerId: string) => void;
  private analyticsManager: WorkerAnalytics;

  constructor(options: WorkerAnalyticsPanelOptions) {
    this.onSelect = options.onSelect;
    this.analyticsManager = new WorkerAnalytics();

    // Main container
    this.box = blessed.box({
      parent: options.parent,
      top: options.top,
      left: options.left,
      width: options.width,
      height: options.height,
      label: ' Worker Analytics ',
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

    // List for workers
    this.list = blessed.list({
      parent: this.box,
      top: 0,
      left: 0,
      width: '100%-2',
      height: '50%',
      keys: true,
      vi: true,
      mouse: true,
      style: {
        selected: { fg: colors.focus, bold: true },
        item: { fg: colors.text },
      },
    });

    // Detail box for selected worker
    this.detailBox = blessed.box({
      parent: this.box,
      bottom: 0,
      left: 0,
      width: '100%-2',
      height: '50%-1',
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      style: {
        fg: colors.text,
      },
    });

    this.bindKeys();
  }

  /**
   * Bind component-specific keys
   */
  private bindKeys(): void {
    this.list.key(['up', 'k'], () => {
      this.selectPrevious();
    });

    this.list.key(['down', 'j'], () => {
      this.selectNext();
    });

    this.list.key(['enter', 'space'], () => {
      this.toggleDetail();
    });

    this.list.key(['a'], () => {
      this.toggleAggregated();
    });

    this.list.key(['s'], () => {
      this.cycleSortMode();
    });

    this.list.key(['r'], () => {
      this.refresh();
    });

    this.list.key(['escape'], () => {
      if (this.viewMode !== 'list') {
        this.viewMode = 'list';
        this.render();
      }
    });
  }

  /**
   * Set metrics data
   */
  setMetrics(metrics: WorkerMetrics[]): void {
    this.metrics = metrics;
    this.sortMetrics();
    this.selectedIndex = 0;
    this.render();
  }

  /**
   * Set aggregated analytics
   */
  setAggregated(aggregated: AggregatedAnalytics): void {
    this.aggregated = aggregated;
  }

  /**
   * Sort metrics by current sort mode
   */
  private sortMetrics(): void {
    this.metrics.sort((a, b) => {
      switch (this.sortMode) {
        case 'beads':
          return b.beadsCompleted - a.beadsCompleted;
        case 'errorRate':
          return a.errorRate - b.errorRate; // Lower is better
        case 'cost':
          return a.costPerBead - b.costPerBead; // Lower is better
        case 'efficiency':
          return b.efficiencyScore - a.efficiencyScore;
        default:
          return 0;
      }
    });
  }

  /**
   * Cycle sort mode
   */
  cycleSortMode(): void {
    const modes: Array<'beads' | 'errorRate' | 'cost' | 'efficiency'> = ['beads', 'errorRate', 'cost', 'efficiency'];
    const currentIndex = modes.indexOf(this.sortMode);
    this.sortMode = modes[(currentIndex + 1) % modes.length];
    this.sortMetrics();
    this.render();
  }

  /**
   * Select next worker
   */
  selectNext(): void {
    if (this.metrics.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.metrics.length;
    this.render();
  }

  /**
   * Select previous worker
   */
  selectPrevious(): void {
    if (this.metrics.length === 0) return;
    this.selectedIndex = this.selectedIndex === 0
      ? this.metrics.length - 1
      : this.selectedIndex - 1;
    this.render();
  }

  /**
   * Toggle detail view
   */
  toggleDetail(): void {
    if (this.metrics.length === 0) return;
    if (this.viewMode === 'detail') {
      this.viewMode = 'list';
    } else {
      this.viewMode = 'detail';
      const selected = this.metrics[this.selectedIndex];
      this.onSelect?.(selected.workerId);
    }
    this.render();
  }

  /**
   * Toggle aggregated view
   */
  toggleAggregated(): void {
    if (this.viewMode === 'aggregated') {
      this.viewMode = 'list';
    } else {
      this.viewMode = 'aggregated';
    }
    this.render();
  }

  /**
   * Refresh metrics
   */
  refresh(): void {
    // Could re-fetch from manager if needed
    this.render();
  }

  /**
   * Get selected worker
   */
  getSelected(): WorkerMetrics | undefined {
    return this.metrics[this.selectedIndex];
  }

  /**
   * Show the panel
   */
  show(): void {
    this.box.show();
    this.list.focus();
    this.render();
  }

  /**
   * Hide the panel
   */
  hide(): void {
    this.box.hide();
    this.box.screen.render();
  }

  /**
   * Check if visible
   */
  isVisible(): boolean {
    return this.box.visible;
  }

  /**
   * Render list items
   */
  private renderList(): void {
    const items: string[] = [];

    if (this.metrics.length === 0) {
      items.push('{gray-fg}No worker metrics available{/}');
    } else {
      for (let i = 0; i < this.metrics.length; i++) {
        const m = this.metrics[i];
        const statusColor = getStatusColor(m.errorRate);
        const trendIcon = getTrendIcon(m.trend);
        const trendColor = getTrendColor(m.trend);

        const workerShort = m.workerId.slice(0, 12);
        const beads = m.beadsCompleted.toString().padStart(3);
        const rate = m.beadsPerHour.toFixed(1).padStart(5);
        const errRate = formatPercent(m.errorRate).padStart(6);
        const cost = formatCost(m.costPerBead).padStart(7);

        items.push(`{${statusColor}-fg}●{/} ${workerShort}  B:${beads}  ${rate}/h  Err:${errRate}  Cost:${cost}  {${trendColor}-fg}${trendIcon}{/}`);
      }
    }

    this.list.setItems(items);
    this.list.select(this.selectedIndex);
  }

  /**
   * Render detail view
   */
  private renderDetail(): void {
    if (this.metrics.length === 0) {
      this.detailBox.setContent('{gray-fg}Select a worker to view details{/}');
      return;
    }

    const m = this.metrics[this.selectedIndex];
    const lines: string[] = [];

    lines.push(`{bold}Worker:{/} {cyan-fg}${m.workerId}{/}`);
    lines.push('');

    lines.push('{bold}Performance Metrics:{/}');
    lines.push(`  Beads Completed:  ${m.beadsCompleted}`);
    lines.push(`  Beads/Hour:       ${m.beadsPerHour.toFixed(2)}`);
    lines.push(`  Avg Completion:   ${formatDuration(m.avgCompletionTimeMs)}`);
    lines.push('');

    lines.push('{bold}Error Tracking:{/}');
    lines.push(`  Error Rate:       {${getStatusColor(m.errorRate)}-fg}${formatPercent(m.errorRate)}{/}`);
    lines.push(`  Total Errors:     ${m.errorCount}`);
    lines.push('');

    lines.push('{bold}Cost Analysis:{/}');
    lines.push(`  Cost Per Bead:    ${formatCost(m.costPerBead)}`);
    lines.push(`  Total Cost:       ${formatCost(m.totalCostUsd)}`);
    lines.push(`  Tokens Used:      ${m.totalTokens.toLocaleString()}`);
    lines.push('');

    lines.push('{bold}Activity:{/}');
    lines.push(`  Active Time:      ${formatDuration(m.activeTimeMs)}`);
    lines.push(`  Idle Percentage:  ${formatPercent(m.idlePercentage)}`);
    lines.push(`  Efficiency:       ${formatPercent(m.efficiencyScore)}`);
    lines.push('');

    if (m.trend) {
      const trendColor = getTrendColor(m.trend);
      lines.push('{bold}Trend:{/}');
      lines.push(`  Direction:        {${trendColor}-fg}${m.trend.direction}${getTrendIcon(m.trend)}{/}`);
      lines.push(`  Confidence:       ${formatPercent(m.trend.confidence)}`);
      if (m.trend.factors.length > 0) {
        lines.push(`  Factors:          ${m.trend.factors.join(', ')}`);
      }
    }

    lines.push('');
    lines.push('{gray-fg}[Enter] Detail  [a] Aggregated  [s] Sort  [r] Refresh  [Esc] Back{/}');

    this.detailBox.setContent(lines.join('\n'));
  }

  /**
   * Render aggregated view
   */
  private renderAggregated(): void {
    if (!this.aggregated) {
      this.detailBox.setContent('{gray-fg}No aggregated analytics available{/}');
      return;
    }

    const a = this.aggregated;
    const lines: string[] = [];

    lines.push('{bold}=== AGGREGATED ANALYTICS ==={/}');
    lines.push('');

    lines.push('{bold}Team Performance:{/}');
    lines.push(`  Total Beads:      ${a.totalBeadsCompleted}`);
    lines.push(`  Active Workers:   ${a.activeWorkerCount}`);
    lines.push(`  Team Beads/Hour:  ${a.avgBeadsPerHour.toFixed(2)}`);
    lines.push(`  Avg Efficiency:   ${formatPercent(a.avgEfficiency)}`);
    lines.push('');

    lines.push('{bold}Cost Summary:{/}');
    lines.push(`  Total Cost:       ${formatCost(a.totalCostUsd)}`);
    lines.push(`  Avg Cost/Bead:    ${formatCost(a.avgCostPerBead)}`);
    lines.push(`  Total Tokens:     ${a.totalTokens.toLocaleString()}`);
    lines.push('');

    lines.push('{bold}Error Overview:{/}');
    lines.push(`  Team Error Rate:  {${getStatusColor(a.overallErrorRate)}-fg}${formatPercent(a.overallErrorRate)}{/}`);
    lines.push(`  Total Errors:     ${a.totalErrors}`);
    lines.push('');

    lines.push('{bold}Top Performers:{/}');
    for (let i = 0; i < Math.min(3, a.topPerformers.length); i++) {
      const p = a.topPerformers[i];
      lines.push(`  ${i + 1}. ${p.workerId.slice(0, 15)} - ${p.beadsCompleted} beads (${formatPercent(p.efficiencyScore)} eff)`);
    }

    if (a.underperformers.length > 0) {
      lines.push('');
      lines.push('{bold}Needs Attention:{/}');
      for (const u of a.underperformers.slice(0, 3)) {
        lines.push(`  ${u.workerId.slice(0, 15)} - {red-fg}${formatPercent(u.errorRate)}{/} error rate`);
      }
    }

    lines.push('');
    lines.push('{gray-fg}[Esc] Back to List{/}');

    // Hide list in aggregated view
    this.list.hide();
    this.detailBox.top = 0;
    this.detailBox.height = '100%-2';

    this.detailBox.setContent(lines.join('\n'));
  }

  /**
   * Render the component
   */
  render(): void {
    // Update box label
    const sortLabel = this.sortMode === 'beads' ? 'Beads' : this.sortMode === 'errorRate' ? 'Errors' : this.sortMode === 'cost' ? 'Cost' : 'Efficiency';
    this.box.setLabel(` Worker Analytics (sort: ${sortLabel}) `);

    if (this.viewMode === 'aggregated') {
      this.renderAggregated();
    } else {
      // Show list and detail side by side
      this.list.show();
      this.list.top = 0;
      this.list.height = '50%';
      this.detailBox.top = '50%';
      this.detailBox.height = '50%-1';

      this.renderList();
      this.renderDetail();
    }

    this.box.screen.render();
  }

  /**
   * Focus this component
   */
  focus(): void {
    this.list.focus();
  }

  /**
   * Get the underlying box element
   */
  getElement(): blessed.Widgets.BoxElement {
    return this.box;
  }
}

export default WorkerAnalyticsPanel;
