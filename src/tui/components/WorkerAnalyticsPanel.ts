/**
 * WorkerAnalyticsPanel Component
 *
 * TUI component to display worker performance analytics.
 * Shows metrics like beads/hour, error rate, cost per bead, and trends.
 */

import blessed from 'blessed';
import { WorkerMetrics, AggregatedAnalytics, MetricsDataPoint, WorkerComparison } from '../../types.js';

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
 * Render a comparison row with values, difference, and winner indicator
 */
function renderComparisonRow(
  label: string,
  value1: string | number,
  value2: string | number,
  diff: number,
  percentDiff: number,
  better: 'worker1' | 'worker2' | 'tie',
  lowerIsBetter: boolean
): string {
  const v1Str = String(value1).padStart(12);
  const v2Str = String(value2).padStart(12);

  // Format difference
  let diffStr = '';
  if (Math.abs(diff) < 0.001) {
    diffStr = '        0';
  } else {
    const sign = diff > 0 ? '+' : '';
    const color = (lowerIsBetter ? diff < 0 : diff > 0) ? 'green' : 'red';
    diffStr = `{${color}-fg}${sign}${diff.toFixed(2)}{/}`;
  }

  // Format percentage difference
  let percentStr = '';
  if (Math.abs(percentDiff) < 0.1) {
    percentStr = '     0.0%';
  } else {
    const sign = percentDiff > 0 ? '+' : '';
    const color = (lowerIsBetter ? percentDiff < 0 : percentDiff > 0) ? 'green' : 'red';
    percentStr = `{${color}-fg}${sign}${percentDiff.toFixed(1)}%{/}`;
  }

  // Winner indicator
  const winner = better === 'worker1' ? '{green-fg}←{/}' : better === 'worker2' ? '{green-fg}→{/}' : ' ';

  return `  ${label.padEnd(15)} ${v1Str}  ${v2Str}  ${diffStr}  ${percentStr}  ${winner}`;
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
  private secondSelectedIndex = 1; // For comparison mode
  private viewMode: 'list' | 'detail' | 'aggregated' | 'comparison' = 'list';
  private sortMode: 'beads' | 'errorRate' | 'cost' | 'efficiency' = 'beads';
  private onSelect?: (workerId: string) => void;
  private analyticsManager: WorkerAnalytics;
  private comparisonResult: WorkerComparison | null = null;

  constructor(options: WorkerAnalyticsPanelOptions) {
    this.onSelect = options.onSelect;
    this.analyticsManager = new WorkerAnalytics();

    // Main container
    this.box = blessed.box({
      parent: options.parent,
      tags: true,
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
      tags: true,
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
      if (this.viewMode === 'comparison') {
        this.selectPreviousComparison();
      } else {
        this.selectPrevious();
      }
    });

    this.list.key(['down', 'j'], () => {
      if (this.viewMode === 'comparison') {
        this.selectNextComparison();
      } else {
        this.selectNext();
      }
    });

    this.list.key(['left', 'h'], () => {
      if (this.viewMode === 'comparison') {
        // Move to first worker selection
        this.selectedIndexChanged(this.selectedIndex);
        this.render();
      }
    });

    this.list.key(['right', 'l'], () => {
      if (this.viewMode === 'comparison') {
        // Move to second worker selection
        this.secondSelectedIndexChanged(this.secondSelectedIndex);
        this.render();
      }
    });

    this.list.key(['enter', 'space'], () => {
      this.toggleDetail();
    });

    this.list.key(['a'], () => {
      this.toggleAggregated();
    });

    this.list.key(['c'], () => {
      this.toggleComparison();
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
   * Toggle comparison view
   */
  toggleComparison(): void {
    if (this.metrics.length < 2) {
      // Need at least 2 workers to compare
      return;
    }

    if (this.viewMode === 'comparison') {
      this.viewMode = 'list';
    } else {
      this.viewMode = 'comparison';
      // Ensure both indices are valid
      if (this.secondSelectedIndex >= this.metrics.length) {
        this.secondSelectedIndex = (this.selectedIndex + 1) % this.metrics.length;
      }
      // Update comparison result
      this.updateComparisonResult();
    }
    this.render();
  }

  /**
   * Select next worker in comparison mode (cycles both selections together)
   */
  selectNextComparison(): void {
    if (this.metrics.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.metrics.length;
    this.secondSelectedIndex = (this.secondSelectedIndex + 1) % this.metrics.length;
    this.updateComparisonResult();
    this.render();
  }

  /**
   * Select previous worker in comparison mode
   */
  selectPreviousComparison(): void {
    if (this.metrics.length === 0) return;
    this.selectedIndex = this.selectedIndex === 0
      ? this.metrics.length - 1
      : this.selectedIndex - 1;
    this.secondSelectedIndex = this.secondSelectedIndex === 0
      ? this.metrics.length - 1
      : this.secondSelectedIndex - 1;
    this.updateComparisonResult();
    this.render();
  }

  /**
   * Change primary selection index
   */
  selectedIndexChanged(newIndex: number): void {
    if (this.metrics.length === 0) return;
    this.selectedIndex = newIndex;
    this.updateComparisonResult();
    this.render();
  }

  /**
   * Change secondary selection index
   */
  secondSelectedIndexChanged(newIndex: number): void {
    if (this.metrics.length === 0) return;
    this.secondSelectedIndex = newIndex;
    this.updateComparisonResult();
    this.render();
  }

  /**
   * Update the comparison result based on current selections
   */
  private updateComparisonResult(): void {
    if (this.metrics.length < 2) {
      this.comparisonResult = null;
      return;
    }

    const worker1 = this.metrics[this.selectedIndex];
    const worker2 = this.metrics[this.secondSelectedIndex];

    if (!worker1 || !worker2) {
      this.comparisonResult = null;
      return;
    }

    // Use the analytics manager's compareWorkers method
    this.comparisonResult = this.analyticsManager.compareWorkers(
      worker1.workerId,
      worker2.workerId
    );
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
   * Render comparison view
   */
  private renderComparison(): void {
    if (!this.comparisonResult || this.metrics.length < 2) {
      this.detailBox.setContent('{gray-fg}Need at least 2 workers to compare{/}');
      this.list.hide();
      this.detailBox.top = 0;
      this.detailBox.height = '100%-2';
      return;
    }

    const c = this.comparisonResult;
    const w1 = c.worker1;
    const w2 = c.worker2;
    const lines: string[] = [];

    lines.push('{bold}=== WORKER COMPARISON ==={/}');
    lines.push('');

    // Header with worker IDs
    const w1Short = w1.workerId.slice(0, 15);
    const w2Short = w2.workerId.slice(0, 15);
    const winnerIndicator = c.overallWinner === 'worker1' ? '{green-fg}★{/}' : c.overallWinner === 'worker2' ? '{green-fg}  ★{/}' : '  =';

    lines.push(`{bold}Worker 1:${/} {cyan-fg}${w1Short.padEnd(15)}{/}  {bold}Worker 2:{/} {cyan-fg}${w2Short.padEnd(15)}{/}  ${winnerIndicator}`);
    lines.push('{bold}' + '-'.repeat(60) + '{/}');
    lines.push('');

    // Performance metrics
    lines.push('{bold}Performance Metrics:{/}');
    lines.push(renderComparisonRow(
      'Beads Completed',
      w1.beadsCompleted,
      w2.beadsCompleted,
      c.differences.beadsCompleted,
      c.percentDifferences.beadsCompleted,
      c.betterWorker.beadsCompleted,
      false // higher is better
    ));
    lines.push(renderComparisonRow(
      'Beads/Hour',
      w1.beadsPerHour.toFixed(2),
      w2.beadsPerHour.toFixed(2),
      c.differences.beadsPerHour,
      c.percentDifferences.beadsPerHour,
      c.betterWorker.beadsPerHour,
      false // higher is better
    ));
    lines.push(renderComparisonRow(
      'Avg Completion',
      formatDuration(w1.avgCompletionTimeMs),
      formatDuration(w2.avgCompletionTimeMs),
      c.differences.avgCompletionTimeMs,
      c.percentDifferences.avgCompletionTimeMs,
      c.betterWorker.avgCompletionTimeMs,
      true // lower is better
    ));
    lines.push('');

    // Error and cost metrics
    lines.push('{bold}Error & Cost Metrics:{/}');
    lines.push(renderComparisonRow(
      'Error Rate',
      formatPercent(w1.errorRate),
      formatPercent(w2.errorRate),
      c.differences.errorRate,
      c.percentDifferences.errorRate,
      c.betterWorker.errorRate,
      true // lower is better
    ));
    lines.push(renderComparisonRow(
      'Cost Per Bead',
      formatCost(w1.costPerBead),
      formatCost(w2.costPerBead),
      c.differences.costPerBead,
      c.percentDifferences.costPerBead,
      c.betterWorker.costPerBead,
      true // lower is better
    ));
    lines.push(renderComparisonRow(
      'Total Cost',
      formatCost(w1.totalCostUsd),
      formatCost(w2.totalCostUsd),
      w1.totalCostUsd - w2.totalCostUsd,
      (w1.totalCostUsd - w2.totalCostUsd) / (w2.totalCostUsd || 0.01) * 100,
      w1.totalCostUsd < w2.totalCostUsd ? 'worker1' : w1.totalCostUsd > w2.totalCostUsd ? 'worker2' : 'tie',
      true // lower is better
    ));
    lines.push('');

    // Efficiency metrics
    lines.push('{bold}Efficiency Metrics:{/}');
    lines.push(renderComparisonRow(
      'Efficiency Score',
      formatPercent(w1.efficiencyScore),
      formatPercent(w2.efficiencyScore),
      c.differences.efficiencyScore,
      c.percentDifferences.efficiencyScore,
      c.betterWorker.efficiencyScore,
      false // higher is better
    ));
    lines.push(renderComparisonRow(
      'Active Time',
      formatDuration(w1.activeTimeMs),
      formatDuration(w2.activeTimeMs),
      w1.activeTimeMs - w2.activeTimeMs,
      (w1.activeTimeMs - w2.activeTimeMs) / (w2.activeTimeMs || 1) * 100,
      w1.activeTimeMs > w2.activeTimeMs ? 'worker1' : w1.activeTimeMs < w2.activeTimeMs ? 'worker2' : 'tie',
      false // higher is better (more active time)
    ));
    lines.push(renderComparisonRow(
      'Idle Percentage',
      formatPercent(w1.idlePercentage),
      formatPercent(w2.idlePercentage),
      w1.idlePercentage - w2.idlePercentage,
      (w1.idlePercentage - w2.idlePercentage) / (w2.idlePercentage || 0.01) * 100,
      w1.idlePercentage < w2.idlePercentage ? 'worker1' : w1.idlePercentage > w2.idlePercentage ? 'worker2' : 'tie',
      true // lower is better
    ));
    lines.push('');

    // Overall score
    lines.push('{bold}Overall Score:{/}');
    lines.push(`  Worker 1: {cyan-fg}${c.score.worker1}{/} metrics won`);
    lines.push(`  Worker 2: {cyan-fg}${c.score.worker2}{/} metrics won`);
    lines.push('');

    const overallText = c.overallWinner === 'worker1'
      ? '{green-fg}Worker 1 wins overall{/}'
      : c.overallWinner === 'worker2'
      ? '{green-fg}Worker 2 wins overall{/}'
      : '{yellow-fg}Overall tie{/}';
    lines.push(`  Result: ${overallText}`);

    lines.push('');
    lines.push('{gray-fg}[↑/↓] Next pair  [←/→] Swap workers  [Esc] Back{/}');

    // Hide list in comparison view
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
    } else if (this.viewMode === 'comparison') {
      this.renderComparison();
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
