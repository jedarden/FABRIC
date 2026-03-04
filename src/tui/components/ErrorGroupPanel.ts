/**
 * ErrorGroupPanel Component
 *
 * Displays grouped errors with count, first/last occurrence, affected workers,
 * and expandable stack traces.
 */

import * as blessed from 'blessed';
import { ErrorGroup, ErrorCategory } from '../../types.js';
import { colors } from '../utils/colors.js';

export interface ErrorGroupPanelOptions {
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

  /** Callback when group is selected */
  onSelect?: (groupId: string) => void;
}

/**
 * ErrorGroupPanel displays grouped errors with expandable details
 */
export class ErrorGroupPanel {
  private box: blessed.Widgets.BoxElement;
  private list: blessed.Widgets.ListElement;
  private detailBox: blessed.Widgets.BoxElement;
  private groups: ErrorGroup[] = [];
  private selectedIndex = 0;
  private expandedGroupId?: string;
  private onSelect?: (groupId: string) => void;

  constructor(options: ErrorGroupPanelOptions) {
    this.onSelect = options.onSelect;

    this.box = blessed.box({
      parent: options.parent,
      top: options.top,
      left: options.left,
      width: options.width,
      height: options.height,
      label: ' Error Groups ',
      border: { type: 'line' },
      style: {
        border: { fg: colors.border },
        label: { fg: colors.error },
        selected: { fg: colors.focus },
      },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
    });

    // Create inner list for error groups
    this.list = blessed.list({
      parent: this.box,
      top: 0,
      left: 0,
      right: 0,
      height: '50%',
      keys: true,
      vi: true,
      mouse: true,
      style: {
        selected: { fg: colors.focus, bold: true },
        item: { fg: colors.text },
      },
    });

    // Create detail view for expanded group
    this.detailBox = blessed.box({
      parent: this.box,
      top: '50%',
      left: 0,
      right: 0,
      bottom: 0,
      border: { type: 'line' },
      label: ' Details ',
      style: {
        border: { fg: colors.border },
        label: { fg: colors.info },
      },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
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
      this.toggleExpanded();
    });

    this.list.key(['escape'], () => {
      this.hide();
    });

    // Allow scrolling in detail box
    this.detailBox.key(['up', 'k'], () => {
      this.detailBox.scroll(-1);
      this.screen.render();
    });

    this.detailBox.key(['down', 'j'], () => {
      this.detailBox.scroll(1);
      this.screen.render();
    });
  }

  private get screen(): blessed.Widgets.Screen {
    return this.box.screen;
  }

  /**
   * Get severity icon and color
   */
  private getSeverityStyle(severity: ErrorGroup['severity']): { icon: string; color: string } {
    switch (severity) {
      case 'critical':
        return { icon: '!!!', color: 'red' };
      case 'high':
        return { icon: ' !!', color: 'red' };
      case 'medium':
        return { icon: '  !', color: 'yellow' };
      case 'low':
        return { icon: '  i', color: 'blue' };
    }
  }

  /**
   * Get category icon
   */
  private getCategoryIcon(category: ErrorCategory): string {
    switch (category) {
      case 'network':
        return '⚡';
      case 'permission':
        return '🔒';
      case 'validation':
        return '✗';
      case 'resource':
        return '💾';
      case 'not_found':
        return '?';
      case 'timeout':
        return '⏱';
      case 'syntax':
        return '⚠';
      case 'tool':
        return '🔧';
      case 'unknown':
        return '•';
    }
  }

  /**
   * Format timestamp as relative time
   */
  private formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return `${seconds}s ago`;
  }

  /**
   * Format error group line for display
   */
  private formatGroupLine(group: ErrorGroup, isSelected: boolean): string {
    const severity = this.getSeverityStyle(group.severity);
    const categoryIcon = this.getCategoryIcon(group.fingerprint.category);
    const expandMarker = this.expandedGroupId === group.id ? '{green-fg}▼{/}' : '{gray-fg}▶{/}';
    const activeMarker = group.isActive ? '{green-fg}●{/}' : '{gray-fg}○{/}';

    const count = `x${group.count}`.padEnd(6);
    const lastSeen = this.formatRelativeTime(group.lastSeen).padEnd(10);
    const workerStr = group.affectedWorkers.length > 2
      ? `${group.affectedWorkers.length}w`
      : group.affectedWorkers.join(',');
    const workers = workerStr.slice(0, 15);

    const signature = group.fingerprint.signature.slice(0, 40);

    return `${expandMarker} ${activeMarker} {${severity.color}-fg}${severity.icon}{/} ${categoryIcon} ${count} ${lastSeen} {cyan-fg}${workers.padEnd(12)}{/} ${signature}`;
  }

  /**
   * Format expanded group details
   */
  private formatGroupDetails(group: ErrorGroup): string[] {
    const lines: string[] = [];

    lines.push(`{bold}Error Group: ${group.id}{/}\n`);

    // Summary
    lines.push(`{bold}Category:{/} ${group.fingerprint.category}`);
    lines.push(`{bold}Severity:{/} ${group.severity} (${group.count} occurrences)`);
    lines.push(`{bold}Status:{/} ${group.isActive ? '{green-fg}Active{/}' : '{gray-fg}Inactive{/}'}`);
    lines.push(`{bold}First Seen:{/} ${new Date(group.firstSeen).toISOString()}`);
    lines.push(`{bold}Last Seen:{/} ${new Date(group.lastSeen).toISOString()} (${this.formatRelativeTime(group.lastSeen)})`);
    lines.push(`{bold}Affected Workers:{/} ${group.affectedWorkers.join(', ')}`);

    lines.push('');
    lines.push(`{bold}Signature:{/}`);
    lines.push(`  ${group.fingerprint.signature}`);

    lines.push('');
    lines.push(`{bold}Sample Message:{/}`);
    lines.push(`  ${group.fingerprint.sampleMessage.split('\n')[0]}`);

    // Show recent events (up to 5)
    lines.push('');
    lines.push(`{bold}Recent Events (${Math.min(5, group.events.length)} of ${group.events.length}):{/}`);

    const recentEvents = group.events.slice(-5).reverse();
    for (const event of recentEvents) {
      const timestamp = new Date(event.ts).toISOString().substring(11, 19);
      const errorMsg = event.error || event.msg;
      const firstLine = errorMsg.split('\n')[0].slice(0, 80);
      lines.push(`  {gray-fg}${timestamp}{/} [{cyan-fg}${event.worker}{/}] ${firstLine}`);
    }

    // Show stack trace if available
    const eventWithStack = group.events.find(e => e.error && e.error.includes('\n'));
    if (eventWithStack && eventWithStack.error) {
      lines.push('');
      lines.push(`{bold}Stack Trace:{/}`);
      const stackLines = eventWithStack.error.split('\n').slice(0, 15);
      for (const line of stackLines) {
        lines.push(`  {gray-fg}${line}{/}`);
      }
      if (eventWithStack.error.split('\n').length > 15) {
        lines.push(`  {gray-fg}... (${eventWithStack.error.split('\n').length - 15} more lines){/}`);
      }
    }

    return lines;
  }

  /**
   * Update error groups data
   */
  updateGroups(groups: ErrorGroup[]): void {
    this.groups = groups;
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, groups.length - 1));
    this.render();
  }

  /**
   * Select next group
   */
  selectNext(): void {
    if (this.groups.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.groups.length;
    this.render();
  }

  /**
   * Select previous group
   */
  selectPrevious(): void {
    if (this.groups.length === 0) return;
    this.selectedIndex = this.selectedIndex === 0
      ? this.groups.length - 1
      : this.selectedIndex - 1;
    this.render();
  }

  /**
   * Toggle expanded state for selected group
   */
  toggleExpanded(): void {
    if (this.groups.length === 0) return;
    const group = this.groups[this.selectedIndex];

    if (this.expandedGroupId === group.id) {
      this.expandedGroupId = undefined;
    } else {
      this.expandedGroupId = group.id;
      this.onSelect?.(group.id);
    }

    this.render();
  }

  /**
   * Get currently selected group
   */
  getSelected(): ErrorGroup | undefined {
    return this.groups[this.selectedIndex];
  }

  /**
   * Get active error count
   */
  getActiveErrorCount(): number {
    return this.groups.filter(g => g.isActive).length;
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
    this.screen.render();
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

    if (this.groups.length === 0) {
      lines.push('{green-fg}No errors detected{/}');
    } else {
      const activeCount = this.getActiveErrorCount();
      const totalErrors = this.groups.reduce((sum, g) => sum + g.count, 0);

      lines.push(`{bold}Groups: ${this.groups.length} | Active: ${activeCount} | Total Errors: ${totalErrors}{/}\n`);

      // Group by severity
      const critical = this.groups.filter(g => g.severity === 'critical');
      const high = this.groups.filter(g => g.severity === 'high');
      const medium = this.groups.filter(g => g.severity === 'medium');
      const low = this.groups.filter(g => g.severity === 'low');

      if (critical.length > 0) {
        lines.push(`\n{red-fg}{bold}CRITICAL (${critical.length}):{/}`);
        for (const group of critical) {
          const globalIdx = this.groups.indexOf(group);
          const isSelected = globalIdx === this.selectedIndex;
          lines.push(this.formatGroupLine(group, isSelected));
        }
      }

      if (high.length > 0) {
        lines.push(`\n{red-fg}HIGH (${high.length}):{/}`);
        for (const group of high) {
          const globalIdx = this.groups.indexOf(group);
          const isSelected = globalIdx === this.selectedIndex;
          lines.push(this.formatGroupLine(group, isSelected));
        }
      }

      if (medium.length > 0) {
        lines.push(`\n{yellow-fg}MEDIUM (${medium.length}):{/}`);
        for (const group of medium) {
          const globalIdx = this.groups.indexOf(group);
          const isSelected = globalIdx === this.selectedIndex;
          lines.push(this.formatGroupLine(group, isSelected));
        }
      }

      if (low.length > 0) {
        lines.push(`\n{blue-fg}LOW (${low.length}):{/}`);
        for (const group of low) {
          const globalIdx = this.groups.indexOf(group);
          const isSelected = globalIdx === this.selectedIndex;
          lines.push(this.formatGroupLine(group, isSelected));
        }
      }

      lines.push('\n{gray-fg}[↑/↓] Navigate  [Enter] Expand/Collapse  [Esc] Close{/}');
    }

    this.list.setContent(lines.join('\n'));

    // Update detail box
    const selectedGroup = this.groups[this.selectedIndex];
    if (selectedGroup && this.expandedGroupId === selectedGroup.id) {
      const details = this.formatGroupDetails(selectedGroup);
      this.detailBox.setContent(details.join('\n'));
      this.detailBox.show();
    } else {
      this.detailBox.setContent('{gray-fg}Select an error group and press Enter to view details{/}');
    }

    this.screen.render();
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

export default ErrorGroupPanel;
