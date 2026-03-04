/**
 * DependencyDag Component
 *
 * Displays task dependency visualization as a DAG (Directed Acyclic Graph).
 * Shows which tasks block others and highlights the critical path.
 */

import blessed from 'blessed';
import {
  DependencyGraph,
  DagComponent,
  BeadNode,
  DagStats,
  DagOptions,
  BeadStatus,
} from '../../types.js';
import {
  refreshDependencyGraph,
  getDagStats,
  getTopBlockers,
  getReadyBeads,
  getStatusIcon,
  getPriorityIndicator,
  renderDependencyTree,
  getStatusColor,
} from '../dagUtils.js';
import { colors } from '../utils/colors.js';

export interface DependencyDagOptions {
  /** Parent screen */
  parent: blessed.Widgets.Screen;

  /** Position options */
  top: number | string;
  left: number | string;
  width: number | string;
  height?: number | string;
  bottom?: number | string;
}

type ViewMode = 'tree' | 'blockers' | 'ready' | 'stats';

export class DependencyDag {
  private box: blessed.Widgets.BoxElement;
  private graph: DependencyGraph | null = null;
  private stats: DagStats | null = null;
  private viewMode: ViewMode = 'tree';
  private selectedIndex = 0;
  private filterOptions: DagOptions = {};
  private lastRefresh = 0;
  private refreshInterval = 5000; // 5 seconds

  constructor(options: DependencyDagOptions) {
    const boxOptions: blessed.Widgets.BoxOptions = {
      parent: options.parent,
      top: options.top,
      left: options.left,
      width: options.width,
      label: ' Task Dependency DAG ',
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
    };

    if (options.height !== undefined) {
      boxOptions.height = options.height;
    }
    if (options.bottom !== undefined) {
      boxOptions.bottom = options.bottom;
    }

    this.box = blessed.box(boxOptions);

    this.bindKeys();
    this.refresh();
  }

  /**
   * Bind keyboard shortcuts
   */
  private bindKeys(): void {
    this.box.key(['t'], () => {
      this.viewMode = 'tree';
      this.render();
    });

    this.box.key(['b'], () => {
      this.viewMode = 'blockers';
      this.render();
    });

    this.box.key(['r'], () => {
      this.viewMode = 'ready';
      this.render();
    });

    this.box.key(['s'], () => {
      this.viewMode = 'stats';
      this.render();
    });

    this.box.key(['R'], () => {
      this.forceRefresh();
    });

    this.box.key(['f'], () => {
      this.cycleFilter();
    });

    this.box.key(['up', 'k'], () => {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.render();
    });

    this.box.key(['down', 'j'], () => {
      this.selectedIndex++;
      this.render();
    });

    this.box.key(['g'], () => {
      this.selectedIndex = 0;
      this.render();
    });

    this.box.key(['G'], () => {
      // Go to end
      this.selectedIndex = this.getMaxIndex();
      this.render();
    });
  }

  /**
   * Get max selectable index based on current view
   */
  private getMaxIndex(): number {
    if (!this.graph) return 0;

    switch (this.viewMode) {
      case 'blockers':
        return Math.max(0, getTopBlockers(this.graph).length - 1);
      case 'ready':
        return Math.max(0, getReadyBeads(this.graph).length - 1);
      default:
        return Math.max(0, this.graph.totalNodes - 1);
    }
  }

  /**
   * Cycle through filter options
   */
  private cycleFilter(): void {
    const filters: Array<{ key: keyof DagOptions; value: any }> = [
      { key: 'status', value: undefined },
      { key: 'status', value: 'blocked' as BeadStatus },
      { key: 'status', value: 'in_progress' as BeadStatus },
      { key: 'criticalOnly', value: true },
      { key: 'criticalOnly', value: false },
    ];

    // Find current filter index
    const currentIdx = filters.findIndex(
      (f) =>
        (f.key === 'status' && this.filterOptions.status === f.value) ||
        (f.key === 'criticalOnly' && this.filterOptions.criticalOnly === f.value)
    );

    const nextIdx = (currentIdx + 1) % filters.length;
    const nextFilter = filters[nextIdx];

    this.filterOptions = { ...this.filterOptions, [nextFilter.key]: nextFilter.value };
    this.forceRefresh();
  }

  /**
   * Refresh the graph data
   */
  refresh(): void {
    const now = Date.now();
    if (now - this.lastRefresh < this.refreshInterval && this.graph) {
      return; // Skip if recently refreshed
    }

    this.forceRefresh();
  }

  /**
   * Force refresh from br command
   */
  forceRefresh(): void {
    try {
      this.graph = refreshDependencyGraph(this.filterOptions);
      this.stats = getDagStats(this.graph);
      this.lastRefresh = Date.now();
      this.selectedIndex = 0;
      this.render();
    } catch (error) {
      this.showError(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Show error message
   */
  private showError(message: string): void {
    const lines = [
      '{red-fg}Error loading dependency graph{/}',
      '',
      message,
      '',
      '{gray-fg}Press R to retry{/}',
    ];
    this.box.setContent(lines.join('\n'));
    this.box.screen.render();
  }

  /**
   * Get view mode label
   */
  private getViewModeLabel(): string {
    switch (this.viewMode) {
      case 'tree':
        return 'Tree View';
      case 'blockers':
        return 'Top Blockers';
      case 'ready':
        return 'Ready Tasks';
      case 'stats':
        return 'Statistics';
      default:
        return 'Unknown';
    }
  }

  /**
   * Get filter description
   */
  private getFilterDescription(): string {
    const parts: string[] = [];

    if (this.filterOptions.status) {
      parts.push(`status=${this.filterOptions.status}`);
    }
    if (this.filterOptions.criticalOnly) {
      parts.push('critical-only');
    }
    if (this.filterOptions.maxDepth !== undefined) {
      parts.push(`depth≤${this.filterOptions.maxDepth}`);
    }

    return parts.length > 0 ? ` [${parts.join(', ')}]` : '';
  }

  /**
   * Render the current view
   */
  render(): void {
    if (!this.graph || !this.stats) {
      this.box.setContent('{gray-fg}Loading...{/}');
      this.box.screen.render();
      return;
    }

    const lines: string[] = [];

    // Header
    const modeLabel = this.getViewModeLabel();
    const filterDesc = this.getFilterDescription();
    lines.push(`{bold}${modeLabel}{/}${filterDesc}`);
    lines.push('{gray-fg}─────────────────────────────────────────────────────{/}');
    lines.push('');

    switch (this.viewMode) {
      case 'tree':
        this.renderTreeView(lines);
        break;
      case 'blockers':
        this.renderBlockersView(lines);
        break;
      case 'ready':
        this.renderReadyView(lines);
        break;
      case 'stats':
        this.renderStatsView(lines);
        break;
    }

    // Footer with key hints
    lines.push('');
    lines.push('{gray-fg}─────────────────────────────────────────────────────{/}');
    lines.push(
      '{gray-fg}[t]ree [b]lockers [r]eady [s]tats [f]ilter [R]efresh [↑/↓] navigate{/}'
    );

    this.box.setContent(lines.join('\n'));
    this.box.screen.render();
  }

  /**
   * Render tree view
   */
  private renderTreeView(lines: string[]): void {
    if (!this.graph) return;

    if (this.graph.components.length === 0) {
      lines.push('{gray-fg}No dependencies found{/}');
      lines.push('');
      lines.push('{gray-fg}Tasks with dependencies will appear here.{/}');
      return;
    }

    for (const component of this.graph.components) {
      // Component header
      if (component.hasCycle) {
        lines.push('{red-fg}⚠ Cycle detected in this component!{/}');
      }

      if (component.criticalPath.length > 0) {
        lines.push(
          `{yellow-fg}⚡ Critical path: ${component.criticalPath.map((id) => `{bold}${id}{/}`).join(' → ')}{/}`
        );
        lines.push('');
      }

      // Render tree
      const tree = renderDependencyTree(component, {
        showPriority: true,
        showStatus: true,
        maxDepth: 5,
      });
      lines.push(tree);
      lines.push('');
    }
  }

  /**
   * Render blockers view (tasks that block the most others)
   */
  private renderBlockersView(lines: string[]): void {
    if (!this.graph) return;

    const blockers = getTopBlockers(this.graph, 15);

    if (blockers.length === 0) {
      lines.push('{green-fg}No blockers found!{/}');
      lines.push('All tasks are unblocked.');
      return;
    }

    lines.push('{bold}Tasks blocking the most other tasks:{/}');
    lines.push('');

    for (let i = 0; i < blockers.length; i++) {
      const node = blockers[i];
      const icon = getStatusIcon(node.status);
      const statusColor = getStatusColor(node.status);
      const selected = i === this.selectedIndex;

      const line = `${selected ? '▶ ' : '  '}${icon} {${statusColor}-fg}${node.id}{/} [${getPriorityIndicator(node.priority)}] - {bold}${node.dependentCount}{/} blocked`;

      if (node.isCriticalPath) {
        lines.push(`${line} {yellow-fg}⚡{/}`);
      } else {
        lines.push(line);
      }

      lines.push(`     ${node.title.slice(0, 50)}`);
    }
  }

  /**
   * Render ready view (tasks with no blocking dependencies)
   */
  private renderReadyView(lines: string[]): void {
    if (!this.graph) return;

    const ready = getReadyBeads(this.graph);

    if (ready.length === 0) {
      lines.push('{yellow-fg}No ready tasks found.{/}');
      lines.push('');
      lines.push('All open tasks have blocking dependencies.');
      lines.push('Complete blockers to unlock new work.');
      return;
    }

    lines.push(`{bold}${ready.length} tasks ready to work on:{/}`);
    lines.push('');

    // Sort by priority
    ready.sort((a: BeadNode, b: BeadNode) => a.priority - b.priority);

    for (let i = 0; i < ready.length; i++) {
      const node = ready[i];
      const icon = getStatusIcon(node.status);
      const statusColor = getStatusColor(node.status);
      const selected = i === this.selectedIndex;

      const line = `${selected ? '▶ ' : '  '}${icon} {${statusColor}-fg}${node.id}{/} [${getPriorityIndicator(node.priority)}]`;

      if (node.isCriticalPath) {
        lines.push(`${line} {yellow-fg}⚡{/}`);
      } else {
        lines.push(line);
      }

      lines.push(`     ${node.title.slice(0, 50)}`);
    }
  }

  /**
   * Render statistics view
   */
  private renderStatsView(lines: string[]): void {
    if (!this.stats || !this.graph) return;

    lines.push('{bold}Dependency Graph Statistics{/}');
    lines.push('');

    // Overview
    lines.push(`{bold}Total Beads:{/}      ${this.stats.totalBeads}`);
    lines.push(`{bold}Components:{/}      ${this.graph.totalComponents}`);
    lines.push(`{bold}Total Edges:{/}     ${this.graph.totalEdges}`);
    lines.push('');

    // Status breakdown
    lines.push('{bold}Status Breakdown:{/}');
    lines.push(`  {green-fg}Ready:{/}         ${this.stats.readyCount}`);
    lines.push(`  {red-fg}Blocked:{/}       ${this.stats.blockedCount}`);
    lines.push('');

    // Depth info
    lines.push('{bold}Graph Depth:{/}');
    lines.push(`  Maximum:       ${this.stats.maxDepth}`);
    lines.push('');

    // Critical path
    lines.push('{bold}Critical Path:{/}');
    lines.push(`  Length:        ${this.stats.criticalPathLength}`);
    lines.push(`  Beads on path: ${this.stats.criticalPathBeads}`);
    lines.push('');

    if (this.graph.globalCriticalPath.length > 0) {
      lines.push('  Path:');
      for (const id of this.graph.globalCriticalPath.slice(0, 5)) {
        lines.push(`    → {magenta-fg}${id}{/}`);
      }
      if (this.graph.globalCriticalPath.length > 5) {
        lines.push(`    ... and ${this.graph.globalCriticalPath.length - 5} more`);
      }
    }
    lines.push('');

    // Averages
    lines.push('{bold}Averages:{/}');
    lines.push(`  Dependencies:  ${this.stats.avgDependencies.toFixed(1)}`);
    lines.push(`  Dependents:    ${this.stats.avgDependents.toFixed(1)}`);
    lines.push('');

    // Warnings
    if (this.stats.cycleCount > 0) {
      lines.push(`{red-fg}⚠ ${this.stats.cycleCount} cycle(s) detected!{/}`);
      lines.push('Circular dependencies prevent proper execution.');
    }
  }

  /**
   * Show the DAG view
   */
  show(): void {
    this.box.show();
    this.refresh();
    this.box.screen.render();
  }

  /**
   * Hide the DAG view
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
    this.refresh();
  }

  /**
   * Get the underlying blessed element
   */
  getElement(): blessed.Widgets.BoxElement {
    return this.box;
  }

  /**
   * Get current graph data
   */
  getGraph(): DependencyGraph | null {
    return this.graph;
  }

  /**
   * Get current stats
   */
  getStats(): DagStats | null {
    return this.stats;
  }
}

export function createDependencyDag(options: DependencyDagOptions): DependencyDag {
  return new DependencyDag(options);
}
