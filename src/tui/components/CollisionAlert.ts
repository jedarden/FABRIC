/**
 * CollisionAlert Component
 *
 * Displays collision alerts to users, warning about potential duplicate work
 * or conflicting operations between workers.
 */

import blessed from 'blessed';
import { CollisionAlert as CollisionAlertData, FileCollision, BeadCollision, TaskCollision } from '../../types.js';
import { colors } from '../utils/colors.js';

export interface CollisionAlertOptions {
  /** Parent screen */
  parent: blessed.Widgets.Screen;

  /** Position from top */
  top: number | string;

  /** Position from left */
  left: number | string;

  /** Width of the panel */
  width: number | string;

  /** Height of the panel */
  height: number | string;

  /** Callback when alert is acknowledged */
  onAcknowledge?: (alertId: string) => void;
}

/**
 * CollisionAlert displays collision warnings and alerts
 */
export class CollisionAlert {
  private box: blessed.Widgets.BoxElement;
  private list: blessed.Widgets.ListElement;
  private alerts: CollisionAlertData[] = [];
  private selectedIndex = 0;
  private onAcknowledge?: (alertId: string) => void;

  constructor(options: CollisionAlertOptions) {
    this.onAcknowledge = options.onAcknowledge;

    this.box = blessed.box({
      parent: options.parent,
      tags: true,
      top: options.top,
      left: options.left,
      width: options.width,
      height: options.height,
      label: ' Collision Alerts ',
      border: { type: 'line' },
      style: {
        border: { fg: colors.border },
        label: { fg: colors.warning },
        selected: { fg: colors.focus },
      },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
    });

    // Create inner list for alerts
    this.list = blessed.list({
      parent: this.box,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      keys: true,
      vi: true,
      mouse: true,
      style: {
        selected: { fg: colors.focus, bold: true },
        item: { fg: colors.text },
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
      this.acknowledgeSelected();
    });

    this.list.key(['a'], () => {
      this.acknowledgeAll();
    });

    this.list.key(['escape'], () => {
      this.hide();
    });
  }

  /**
   * Get severity icon and color
   */
  private getSeverityStyle(severity: CollisionAlertData['severity']): { icon: string; color: string } {
    switch (severity) {
      case 'critical':
        return { icon: '!!!', color: 'red' };
      case 'error':
        return { icon: ' !!', color: 'red' };
      case 'warning':
        return { icon: '  !', color: 'yellow' };
      case 'info':
        return { icon: '  i', color: 'blue' };
    }
  }

  /**
   * Get type icon
   */
  private getTypeIcon(type: CollisionAlertData['type']): string {
    switch (type) {
      case 'file':
        return 'F';
      case 'bead':
        return 'B';
      case 'task':
        return 'T';
    }
  }

  /**
   * Format alert for display
   */
  private formatAlertLine(alert: CollisionAlertData, isSelected: boolean): string {
    const severity = this.getSeverityStyle(alert.severity);
    const typeIcon = this.getTypeIcon(alert.type);
    const ackMarker = alert.acknowledged ? '{gray-fg}[ACK]{/} ' : '';
    const workers = alert.workers.length > 2
      ? `${alert.workers.length} workers`
      : alert.workers.join(', ').slice(0, 15);

    const title = alert.title.slice(0, 40);

    return `${ackMarker}{${severity.color}-fg}${severity.icon}{/} [${typeIcon}] ${title} {cyan-fg}${workers}{/}`;
  }

  /**
   * Update alerts data
   */
  updateAlerts(alerts: CollisionAlertData[]): void {
    this.alerts = alerts;
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, alerts.length - 1));
    this.render();
  }

  /**
   * Select next alert
   */
  selectNext(): void {
    if (this.alerts.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.alerts.length;
    this.render();
  }

  /**
   * Select previous alert
   */
  selectPrevious(): void {
    if (this.alerts.length === 0) return;
    this.selectedIndex = this.selectedIndex === 0
      ? this.alerts.length - 1
      : this.selectedIndex - 1;
    this.render();
  }

  /**
   * Acknowledge selected alert
   */
  acknowledgeSelected(): void {
    if (this.alerts.length === 0) return;
    const alert = this.alerts[this.selectedIndex];
    if (!alert.acknowledged) {
      alert.acknowledged = true;
      this.onAcknowledge?.(alert.id);
      this.render();
    }
  }

  /**
   * Acknowledge all alerts
   */
  acknowledgeAll(): void {
    for (const alert of this.alerts) {
      if (!alert.acknowledged) {
        alert.acknowledged = true;
        this.onAcknowledge?.(alert.id);
      }
    }
    this.render();
  }

  /**
   * Get currently selected alert
   */
  getSelected(): CollisionAlertData | undefined {
    return this.alerts[this.selectedIndex];
  }

  /**
   * Get unacknowledged alert count
   */
  getUnacknowledgedCount(): number {
    return this.alerts.filter(a => !a.acknowledged).length;
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
   * Render the component
   */
  render(): void {
    const lines: string[] = [];

    if (this.alerts.length === 0) {
      lines.push('{green-fg}No active collisions detected{/}');
    } else {
      const unacked = this.getUnacknowledgedCount();
      lines.push(`{bold}Alerts: ${this.alerts.length} (${unacked} unacknowledged){/}\n`);

      // Group by severity
      const critical = this.alerts.filter(a => a.severity === 'critical' || a.severity === 'error');
      const warnings = this.alerts.filter(a => a.severity === 'warning');
      const info = this.alerts.filter(a => a.severity === 'info');

      if (critical.length > 0) {
        lines.push(`\n{red-fg}CRITICAL/ERROR (${critical.length}):{/}`);
        for (let i = 0; i < critical.length; i++) {
          const alert = critical[i];
          const globalIdx = this.alerts.indexOf(alert);
          const isSelected = globalIdx === this.selectedIndex;
          lines.push(this.formatAlertLine(alert, isSelected));
        }
      }

      if (warnings.length > 0) {
        lines.push(`\n{yellow-fg}WARNINGS (${warnings.length}):{/}`);
        for (let i = 0; i < warnings.length; i++) {
          const alert = warnings[i];
          const globalIdx = this.alerts.indexOf(alert);
          const isSelected = globalIdx === this.selectedIndex;
          lines.push(this.formatAlertLine(alert, isSelected));
        }
      }

      if (info.length > 0) {
        lines.push(`\n{blue-fg}INFO (${info.length}):{/}`);
        for (let i = 0; i < info.length; i++) {
          const alert = info[i];
          const globalIdx = this.alerts.indexOf(alert);
          const isSelected = globalIdx === this.selectedIndex;
          lines.push(this.formatAlertLine(alert, isSelected));
        }
      }

      // Show selected alert details at bottom
      const selected = this.alerts[this.selectedIndex];
      if (selected) {
        lines.push(`\n{bold}──────────────────────────────────────────{/}`);
        lines.push(`{bold}Selected Alert Details:{/}`);
        lines.push(`  Title: ${selected.title}`);
        lines.push(`  ${selected.description}`);
        lines.push(`  Workers: ${selected.workers.join(', ')}`);
        if (selected.suggestion) {
          lines.push(`  {cyan-fg}Suggestion: ${selected.suggestion}{/}`);
        }
        lines.push(`\n  {gray-fg}[Enter] Acknowledge  [a] Acknowledge All  [Esc] Close{/}`);
      }
    }

    this.box.setContent(lines.join('\n'));
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

export default CollisionAlert;
