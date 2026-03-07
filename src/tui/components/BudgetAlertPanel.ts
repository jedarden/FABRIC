/**
 * Budget Alert Panel Component
 *
 * Displays budget alerts, burn rate, and cost projections.
 * Shows warnings at 80% and critical alerts at 95% budget consumed.
 */

import blessed from 'blessed';
import {
  CostSummary,
  BudgetStatus,
  BurnRate,
  BudgetAlert,
  TopConsumer,
  formatCost,
  formatBurnRate,
  formatTimeToExhaustion,
  getBudgetBadge,
} from '../utils/costTracking.js';
import { colors } from '../utils/colors.js';

export interface BudgetAlertPanelOptions {
  /** Parent screen */
  parent: blessed.Widgets.Screen;

  /** Position options */
  top: number | string;
  left: number | string;
  width: number | string;
  height: number | string;

  /** Callback when alert is acknowledged */
  onAcknowledge?: (alertId: string) => void;

  /** Callback when budget settings are opened */
  onOpenSettings?: () => void;
}

export class BudgetAlertPanel {
  private container: blessed.Widgets.BoxElement;
  private headerBox: blessed.Widgets.BoxElement;
  private contentBox: blessed.Widgets.BoxElement;
  private footerBox: blessed.Widgets.BoxElement;
  private costSummary: CostSummary | null = null;
  private alerts: BudgetAlert[] = [];
  private onAcknowledge?: (alertId: string) => void;
  private onOpenSettings?: () => void;

  constructor(options: BudgetAlertPanelOptions) {
    this.onAcknowledge = options.onAcknowledge;
    this.onOpenSettings = options.onOpenSettings;

    // Main container
    this.container = blessed.box({
      parent: options.parent,
      top: options.top,
      left: options.left,
      width: options.width,
      height: options.height,
      label: ' Budget Dashboard ',
      border: { type: 'line' },
      style: {
        border: { fg: colors.border },
        label: { fg: colors.header },
      },
      hidden: true,
    });

    // Header with current cost and budget
    this.headerBox = blessed.box({
      parent: this.container,
      top: 0,
      left: 0,
      right: 0,
      height: 3,
      content: '{gray-fg}No budget data{/}',
      tags: true,
    });

    // Content area with alerts and details
    this.contentBox = blessed.box({
      parent: this.container,
      top: 3,
      left: 0,
      right: 0,
      bottom: 1,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      tags: true,
      style: {
        fg: colors.text,
      },
    });

    // Footer with controls
    this.footerBox = blessed.box({
      parent: this.container,
      bottom: 0,
      left: 0,
      right: 0,
      height: 1,
      content: ' [a] Acknowledge  [r] Refresh  [s] Settings  [Esc] Close',
      style: {
        fg: colors.muted,
      },
    });

    // Bind keyboard events
    this.bindKeys();
  }

  /**
   * Bind keyboard shortcuts
   */
  private bindKeys(): void {
    this.contentBox.key(['a'], () => this.acknowledgeCurrentAlert());
    this.contentBox.key(['r'], () => this.refresh());
    this.contentBox.key(['s'], () => {
      if (this.onOpenSettings) {
        this.onOpenSettings();
      }
    });
  }

  /**
   * Update cost summary data
   */
  setCostSummary(summary: CostSummary): void {
    this.costSummary = summary;
    this.render();
  }

  /**
   * Update alerts
   */
  setAlerts(alerts: BudgetAlert[]): void {
    this.alerts = alerts;
    this.render();
  }

  /**
   * Refresh display
   */
  refresh(): void {
    this.render();
    this.container.screen.render();
  }

  /**
   * Acknowledge current/most recent alert
   */
  private acknowledgeCurrentAlert(): void {
    const unacknowledged = this.alerts.filter(a => !a.acknowledged);
    if (unacknowledged.length > 0 && this.onAcknowledge) {
      this.onAcknowledge(unacknowledged[0].id);
    }
  }

  /**
   * Render the panel
   */
  private render(): void {
    this.renderHeader();
    this.renderContent();
    this.container.screen.render();
  }

  /**
   * Render header with budget status
   */
  private renderHeader(): void {
    if (!this.costSummary) {
      this.headerBox.setContent('{gray-fg}No budget data loaded{/}');
      return;
    }

    const { budget, totalCostUsd, burnRate } = this.costSummary;
    const lines: string[] = [];

    // Budget progress bar
    if (budget.limit > 0) {
      const percent = Math.min(100, budget.percentUsed);
      const filled = Math.floor(percent / 5); // 20 segments
      const empty = 20 - filled;

      let barColor = 'green';
      if (budget.warningLevel === 'critical') barColor = 'red';
      else if (budget.warningLevel === 'warning') barColor = 'yellow';

      const bar = `{${barColor}-fg}${'█'.repeat(filled)}{/}{gray-fg}${'░'.repeat(empty)}{/}`;

      lines.push(` ${formatCost(totalCostUsd)} / ${formatCost(budget.limit)}  ${bar}  ${Math.round(percent)}%`);
    } else {
      lines.push(` Session Cost: {green-fg}${formatCost(totalCostUsd)}{/}  {gray-fg}(no budget set){/}`);
    }

    // Burn rate line
    if (burnRate.costPerMinute > 0) {
      const burnRateColor = burnRate.isHighBurnRate ? 'yellow' : 'green';
      lines.push(` Rate: {${burnRateColor}-fg}${formatBurnRate(burnRate.costPerMinute)}{/}`);

      if (burnRate.timeToExhaustion && budget.limit > 0) {
        lines[1] += `  Time to exhaustion: ${burnRate.timeToExhaustion}`;
      }
    }

    this.headerBox.setContent(lines.join('\n'));
  }

  /**
   * Render content area
   */
  private renderContent(): void {
    const lines: string[] = [];

    // Show active alerts first
    const activeAlerts = this.alerts.filter(a => !a.acknowledged);
    if (activeAlerts.length > 0) {
      lines.push(this.renderAlertsSection(activeAlerts));
      lines.push('');
    }

    // Show top consumers
    if (this.costSummary) {
      lines.push(this.renderTopConsumersSection(this.costSummary));
    }

    // Show burn rate details
    if (this.costSummary?.burnRate) {
      lines.push('');
      lines.push(this.renderBurnRateSection(this.costSummary.burnRate));
    }

    this.contentBox.setContent(lines.join('\n'));
    this.contentBox.setScrollPerc(0);
  }

  /**
   * Render alerts section
   */
  private renderAlertsSection(alerts: BudgetAlert[]): string {
    const lines: string[] = [];

    lines.push('{bold}{red-fg}══════════════════════════════════════════════════{/}');
    lines.push('{bold}{red-fg}              ACTIVE ALERTS ({/}' + alerts.length + '{bold}{red-fg}){/}');
    lines.push('{bold}{red-fg}══════════════════════════════════════════════════{/}');
    lines.push('');

    for (const alert of alerts) {
      const icon = alert.type === 'exhausted' ? '🚨' :
                   alert.type === 'critical' ? '⚠️' : '⚡';
      const color = alert.type === 'exhausted' || alert.type === 'critical' ? 'red' : 'yellow';

      lines.push(`{${color}-fg}${icon} ${alert.type.toUpperCase()}{/} {gray-fg}${new Date(alert.timestamp).toLocaleTimeString()}{/}`);
      lines.push(`  Spent: ${formatCost(alert.spent)} / ${formatCost(alert.limit)}`);
      lines.push(`  Burn rate: ${formatBurnRate(alert.burnRate)}`);
      lines.push('');

      if (alert.topConsumers.length > 0) {
        lines.push('  {bold}Top consumers:{/}');
        for (const consumer of alert.topConsumers) {
          const beadInfo = consumer.currentBead ? ` {cyan-fg}(${consumer.currentBead}){/}` : '';
          const insightInfo = consumer.insight ? ` {gray-fg}- ${consumer.insight}{/}` : '';
          lines.push(`    ${consumer.workerId}${beadInfo}: {yellow-fg}${formatCost(consumer.costUsd)}{/}${insightInfo}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Render top consumers section
   */
  private renderTopConsumersSection(summary: CostSummary): string {
    const lines: string[] = [];
    const workers = Array.from(summary.byWorker.values())
      .sort((a, b) => b.costUsd - a.costUsd)
      .slice(0, 5);

    if (workers.length === 0) {
      return '';
    }

    lines.push('{bold}{cyan-fg}══════════════════════════════════════════════════{/}');
    lines.push('{bold}{cyan-fg}              TOP CONSUMERS{/}');
    lines.push('{bold}{cyan-fg}══════════════════════════════════════════════════{/}');
    lines.push('');

    const totalCost = summary.totalCostUsd;

    for (const worker of workers) {
      const percent = totalCost > 0 ? Math.round((worker.costUsd / totalCost) * 100) : 0;
      const beadInfo = worker.currentBead ? ` {cyan-fg}(${worker.currentBead}){/}` : '';

      // Create mini progress bar
      const barWidth = 10;
      const filled = Math.floor((percent / 100) * barWidth);
      const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);

      lines.push(`{bold}${worker.workerId}{/}${beadInfo}`);
      lines.push(`  {yellow-fg}${formatCost(worker.costUsd)}{/} {gray-fg}[${bar}] ${percent}%{/}`);
      lines.push(`  {gray-fg}~${Math.round(worker.total / 1000)}k tokens, ${worker.apiCalls} calls{/}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Render burn rate section
   */
  private renderBurnRateSection(burnRate: BurnRate): string {
    const lines: string[] = [];

    lines.push('{bold}{magenta-fg}══════════════════════════════════════════════════{/}');
    lines.push('{bold}{magenta-fg}              BURN RATE ANALYSIS{/}');
    lines.push('{bold}{magenta-fg}══════════════════════════════════════════════════{/}');
    lines.push('');

    const rateColor = burnRate.isHighBurnRate ? 'yellow' : 'green';
    lines.push(`Current rate: {${rateColor}-fg}${formatBurnRate(burnRate.costPerMinute)}{/}`);
    lines.push(`Window: ${burnRate.windowMinutes} minutes`);

    if (burnRate.timeToExhaustion) {
      lines.push(`Time to exhaustion: {cyan-fg}${burnRate.timeToExhaustion}{/}`);
    }

    lines.push(`Projected session total: {yellow-fg}${formatCost(burnRate.projectedTotalCost)}{/}`);

    if (burnRate.isHighBurnRate) {
      lines.push('');
      lines.push('{yellow-fg}⚠ High burn rate detected!{/}');
    }

    return lines.join('\n');
  }

  /**
   * Show the panel
   */
  show(): void {
    this.container.show();
    this.contentBox.focus();
    this.container.screen.render();
  }

  /**
   * Hide the panel
   */
  hide(): void {
    this.container.hide();
    this.container.screen.render();
  }

  /**
   * Toggle visibility
   */
  toggle(): void {
    if (this.container.hidden) {
      this.show();
    } else {
      this.hide();
    }
  }

  /**
   * Check if visible
   */
  isVisible(): boolean {
    return !this.container.hidden;
  }

  /**
   * Focus this component
   */
  focus(): void {
    this.contentBox.focus();
  }

  /**
   * Get the underlying blessed element
   */
  getElement(): blessed.Widgets.BoxElement {
    return this.container;
  }
}

/**
 * Create a budget alert panel
 */
export function createBudgetAlertPanel(options: BudgetAlertPanelOptions): BudgetAlertPanel {
  return new BudgetAlertPanel(options);
}
