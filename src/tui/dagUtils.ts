/**
 * DAG Utility Functions
 *
 * Utilities for working with dependency graphs from br commands.
 */

import {
  DependencyGraph,
  DagComponent,
  BeadNode,
  DagStats,
  DagOptions,
  BeadStatus,
  DependencyEdge,
} from '../types.js';
import { execSync } from 'child_process';

/**
 * Status icons for display
 */
export function getStatusIcon(status: BeadStatus): string {
  switch (status) {
    case 'open': return '○';
    case 'in_progress': return '●';
    case 'blocked': return '⊘';
    case 'completed': return '✓';
    case 'closed': return '✕';
    case 'deferred': return '⏰';
    default: return '?';
  }
}

/**
 * Priority indicator
 */
export function getPriorityIndicator(priority: number): string {
  switch (priority) {
    case 0: return 'P0';
    case 1: return 'P1';
    case 2: return 'P2';
    case 3: return 'P3';
    case 4: return 'P4';
    default: return `P${priority}`;
  }
}

/**
 * Get status color for blessed
 */
export function getStatusColor(status: BeadStatus): string {
  switch (status) {
    case 'open': return 'white';
    case 'in_progress': return 'green';
    case 'blocked': return 'red';
    case 'completed': return 'cyan';
    case 'closed': return 'gray';
    case 'deferred': return 'yellow';
    default: return 'white';
  }
}

/**
 * Parse br list output to build dependency graph
 */
export function refreshDependencyGraph(options: DagOptions = {}): DependencyGraph {
  // This is a stub implementation that returns an empty graph
  // The actual implementation would parse br list output
  return {
    components: [],
    totalNodes: 0,
    totalEdges: 0,
    totalComponents: 0,
    globalCriticalPath: [],
    generatedAt: Date.now(),
  };
}

/**
 * Get statistics about the dependency graph
 */
export function getDagStats(graph: DependencyGraph): DagStats {
  let blockedCount = 0;
  let readyCount = 0;
  let totalDeps = 0;
  let totalDependents = 0;
  let maxDepth = 0;

  for (const component of graph.components) {
    for (const node of component.nodes) {
      if (node.status === 'blocked') blockedCount++;
      if (node.status === 'open' && node.dependencyCount === 0) readyCount++;
      totalDeps += node.dependencyCount;
      totalDependents += node.dependentCount;
      maxDepth = Math.max(maxDepth, node.depth);
    }
  }

  const totalBeads = graph.totalNodes;

  return {
    totalBeads,
    blockedCount,
    readyCount,
    avgDependencies: totalBeads > 0 ? totalDeps / totalBeads : 0,
    avgDependents: totalBeads > 0 ? totalDependents / totalBeads : 0,
    maxDepth,
    cycleCount: graph.components.filter(c => c.hasCycle).length,
    criticalPathLength: graph.globalCriticalPath.length,
    criticalPathBeads: graph.globalCriticalPath.length,
  };
}

/**
 * Get top blockers (tasks that block the most others)
 */
export function getTopBlockers(graph: DependencyGraph, limit: number = 10): BeadNode[] {
  const nodes: BeadNode[] = [];

  for (const component of graph.components) {
    nodes.push(...component.nodes);
  }

  return nodes
    .filter(n => n.dependentCount > 0 && n.status !== 'completed' && n.status !== 'closed')
    .sort((a, b) => b.dependentCount - a.dependentCount)
    .slice(0, limit);
}

/**
 * Get ready beads (unblocked and open)
 */
export function getReadyBeads(graph: DependencyGraph): BeadNode[] {
  const nodes: BeadNode[] = [];

  for (const component of graph.components) {
    nodes.push(...component.nodes);
  }

  return nodes.filter(n => n.status === 'open' && n.dependencyCount === 0);
}

/**
 * Render dependency tree as string
 */
export function renderDependencyTree(
  component: DagComponent,
  options: {
    showPriority?: boolean;
    showStatus?: boolean;
    maxDepth?: number;
  } = {}
): string {
  const { showPriority = false, showStatus = false, maxDepth = 10 } = options;
  const lines: string[] = [];

  function renderNode(node: BeadNode, depth: number, prefix: string): void {
    if (depth > maxDepth) return;

    const icon = getStatusIcon(node.status);
    const statusColor = getStatusColor(node.status);
    const priority = showPriority ? ` [${getPriorityIndicator(node.priority)}]` : '';
    const critical = node.isCriticalPath ? ' ⚡' : '';

    lines.push(`${prefix}${icon} {${statusColor}-fg}${node.id}{/}${priority}${critical}`);
    lines.push(`${prefix}  ${node.title.slice(0, 40)}`);
  }

  // Render root nodes
  for (const rootId of component.roots) {
    const node = component.nodes.find(n => n.id === rootId);
    if (node) {
      renderNode(node, 0, '');
    }
  }

  return lines.join('\n');
}
