/**
 * FABRIC DAG Utilities
 *
 * Utilities for building and analyzing task dependency graphs.
 * Used by DependencyDag component to visualize bead dependencies.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  DependencyGraph,
  DagComponent,
  BeadNode,
  DependencyEdge,
  DagStats,
  DagOptions,
  BeadStatus,
} from '../types.js';

/**
 * Raw bead data from JSONL
 */
interface RawBead {
  id: string;
  title: string;
  status: BeadStatus;
  priority: number;
  issue_type: string;
  dependencies?: Array<{
    issue_id: string;
    depends_on_id: string;
    type: string;
  }>;
  labels?: string[];
  created_at: string;
  updated_at: string;
  closed_at?: string;
  source_repo?: string;
}

/**
 * Get status icon for bead
 */
export function getStatusIcon(status: BeadStatus): string {
  switch (status) {
    case 'open': return '○';
    case 'in_progress': return '◐';
    case 'blocked': return '⛔';
    case 'completed': return '●';
    case 'closed': return '✓';
    case 'deferred': return '⏸';
    default: return '?';
  }
}

/**
 * Get color for status
 */
export function getStatusColor(status: BeadStatus): string {
  switch (status) {
    case 'open': return 'white';
    case 'in_progress': return 'cyan';
    case 'blocked': return 'red';
    case 'completed': return 'green';
    case 'closed': return 'green';
    case 'deferred': return 'yellow';
    default: return 'gray';
  }
}

/**
 * Get priority indicator (visual bar)
 */
export function getPriorityIndicator(priority: number): string {
  switch (priority) {
    case 0: return 'P0'; // Critical
    case 1: return 'P1'; // High
    case 2: return 'P2'; // Normal
    case 3: return 'P3'; // Low
    case 4: return 'P4'; // Backlog
    default: return 'P?';
  }
}

/**
 * Read beads from JSONL file
 */
function readBeadsFromJsonl(jsonPath: string): RawBead[] {
  if (!fs.existsSync(jsonPath)) {
    return [];
  }

  const content = fs.readFileSync(jsonPath, 'utf-8');
  const lines = content.trim().split('\n');
  const beads: RawBead[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const bead = JSON.parse(line) as RawBead;
      beads.push(bead);
    } catch {
      // Skip malformed lines
    }
  }

  return beads;
}

/**
 * Run br command and get beads
 */
function getBeadsFromBr(workspacePath: string): RawBead[] {
  try {
    const output = execSync('br list --all --format json 2>/dev/null', {
      cwd: workspacePath,
      encoding: 'utf-8',
      timeout: 5000,
    });

    // br list --format json outputs JSON array
    const beads = JSON.parse(output) as RawBead[];
    return beads;
  } catch {
    // Fall back to JSONL
    const jsonlPath = path.join(workspacePath, '.beads', 'issues.jsonl');
    return readBeadsFromJsonl(jsonlPath);
  }
}

/**
 * Build dependency graph from beads
 */
export function buildDependencyGraph(beads: RawBead[], options: DagOptions = {}): DependencyGraph {
  const nodes: BeadNode[] = [];
  const edges: DependencyEdge[] = [];
  const nodeMap = new Map<string, BeadNode>();
  const adjacencyList = new Map<string, Set<string>>(); // bead -> beads it depends on
  const reverseAdjacency = new Map<string, Set<string>>(); // bead -> beads that depend on it

  // Filter beads based on options
  let filteredBeads = beads;

  if (options.status && options.status !== 'all') {
    filteredBeads = filteredBeads.filter(b => b.status === options.status);
  }

  if (options.minPriority !== undefined) {
    filteredBeads = filteredBeads.filter(b => b.priority >= options.minPriority!);
  }

  if (options.maxPriority !== undefined) {
    filteredBeads = filteredBeads.filter(b => b.priority <= options.maxPriority!);
  }

  if (!options.includeClosed) {
    filteredBeads = filteredBeads.filter(b => b.status !== 'closed' && b.status !== 'completed');
  }

  // First pass: create nodes
  for (const bead of filteredBeads) {
    const node: BeadNode = {
      id: bead.id,
      title: bead.title,
      status: bead.status,
      priority: bead.priority,
      depth: 0,
      dependentCount: 0,
      dependencyCount: 0,
      isCriticalPath: false,
    };

    nodes.push(node);
    nodeMap.set(bead.id, node);
    adjacencyList.set(bead.id, new Set());
    reverseAdjacency.set(bead.id, new Set());
  }

  // Second pass: create edges and build adjacency lists
  for (const bead of filteredBeads) {
    if (!bead.dependencies) continue;

    for (const dep of bead.dependencies) {
      const depId = dep.depends_on_id;

      // Only add edges where both nodes exist in our filtered set
      if (nodeMap.has(depId)) {
        edges.push({
          from: bead.id,
          to: depId,
          isCritical: false,
        });

        adjacencyList.get(bead.id)!.add(depId);
        reverseAdjacency.get(depId)!.add(bead.id);
      }
    }
  }

  // Update dependency counts
  for (const node of nodes) {
    node.dependencyCount = adjacencyList.get(node.id)!.size;
    node.dependentCount = reverseAdjacency.get(node.id)!.size;
  }

  // Calculate depths using topological sort
  calculateDepths(nodes, adjacencyList, nodeMap);

  // Find connected components
  const components = findConnectedComponents(nodes, edges, adjacencyList, reverseAdjacency);

  // Calculate critical path for each component
  for (const component of components) {
    component.criticalPath = findCriticalPath(component, nodeMap, adjacencyList);
    component.maxDepth = Math.max(...component.nodes.map(n => n.depth));

    // Mark critical path nodes
    for (const nodeId of component.criticalPath) {
      const node = nodeMap.get(nodeId);
      if (node) {
        node.isCriticalPath = true;
      }
    }
  }

  // Find global critical path (longest across all components)
  const globalCriticalPath = findGlobalCriticalPath(components);

  return {
    components,
    totalNodes: nodes.length,
    totalEdges: edges.length,
    totalComponents: components.length,
    globalCriticalPath,
    generatedAt: Date.now(),
  };
}

/**
 * Calculate depth for each node using DFS
 */
function calculateDepths(
  nodes: BeadNode[],
  adjacencyList: Map<string, Set<string>>,
  nodeMap: Map<string, BeadNode>
): void {
  const visited = new Set<string>();
  const depths = new Map<string, number>();

  function dfs(nodeId: string, depth: number): void {
    if (visited.has(nodeId)) return;

    visited.add(nodeId);
    depths.set(nodeId, depth);

    const node = nodeMap.get(nodeId);
    if (node) {
      node.depth = depth;
    }

    // Visit all dependencies (what this node depends on)
    const deps = adjacencyList.get(nodeId);
    if (deps) {
      for (const depId of deps) {
        dfs(depId, depth + 1);
      }
    }
  }

  // Start from nodes with no dependents (roots of the dependency tree)
  for (const node of nodes) {
    if (node.dependentCount === 0) {
      dfs(node.id, 0);
    }
  }

  // Process any remaining unvisited nodes
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id, 0);
    }
  }
}

/**
 * Find connected components in the graph
 */
function findConnectedComponents(
  nodes: BeadNode[],
  edges: DependencyEdge[],
  adjacencyList: Map<string, Set<string>>,
  reverseAdjacency: Map<string, Set<string>>
): DagComponent[] {
  const visited = new Set<string>();
  const components: DagComponent[] = [];

  function bfs(startId: string): Set<string> {
    const component = new Set<string>();
    const queue = [startId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;

      visited.add(current);
      component.add(current);

      // Add dependencies
      const deps = adjacencyList.get(current);
      if (deps) {
        for (const depId of deps) {
          if (!visited.has(depId)) {
            queue.push(depId);
          }
        }
      }

      // Add dependents
      const dependents = reverseAdjacency.get(current);
      if (dependents) {
        for (const depId of dependents) {
          if (!visited.has(depId)) {
            queue.push(depId);
          }
        }
      }
    }

    return component;
  }

  // Find all components
  for (const node of nodes) {
    if (!visited.has(node.id)) {
      const componentIds = bfs(node.id);

      // Build component
      const componentNodes = nodes.filter(n => componentIds.has(n.id));
      const componentEdges = edges.filter(e =>
        componentIds.has(e.from) && componentIds.has(e.to)
      );

      // Find roots (no incoming edges from within component)
      const roots = Array.from(componentIds).filter(id => {
        const deps = adjacencyList.get(id);
        if (!deps) return true;
        return !Array.from(deps).some(depId => componentIds.has(depId));
      });

      // Check for cycles
      const hasCycle = detectCycle(componentIds, adjacencyList);

      components.push({
        nodes: componentNodes,
        edges: componentEdges,
        roots,
        hasCycle,
        criticalPath: [],
        maxDepth: 0,
      });
    }
  }

  // Sort components by size (largest first)
  components.sort((a, b) => b.nodes.length - a.nodes.length);

  return components;
}

/**
 * Detect cycles using DFS
 */
function detectCycle(
  nodeIds: Set<string>,
  adjacencyList: Map<string, Set<string>>
): boolean {
  const WHITE = 0; // Not visited
  const GRAY = 1;  // Currently visiting
  const BLACK = 2; // Finished

  const colors = new Map<string, number>();
  for (const id of nodeIds) {
    colors.set(id, WHITE);
  }

  function dfs(nodeId: string): boolean {
    colors.set(nodeId, GRAY);

    const deps = adjacencyList.get(nodeId);
    if (deps) {
      for (const depId of deps) {
        if (!nodeIds.has(depId)) continue;

        const color = colors.get(depId);
        if (color === GRAY) {
          return true; // Back edge found - cycle!
        }
        if (color === WHITE && dfs(depId)) {
          return true;
        }
      }
    }

    colors.set(nodeId, BLACK);
    return false;
  }

  for (const id of nodeIds) {
    if (colors.get(id) === WHITE) {
      if (dfs(id)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Find critical path (longest path) in a component
 */
function findCriticalPath(
  component: DagComponent,
  nodeMap: Map<string, BeadNode>,
  adjacencyList: Map<string, Set<string>>
): string[] {
  if (component.nodes.length === 0) return [];

  // Use dynamic programming to find longest path
  const componentIds = new Set(component.nodes.map(n => n.id));
  const memo = new Map<string, { length: number; path: string[] }>();

  function longestPath(nodeId: string): { length: number; path: string[] } {
    if (memo.has(nodeId)) {
      return memo.get(nodeId)!;
    }

    const deps = adjacencyList.get(nodeId);
    let maxLength = 0;
    let maxPath: string[] = [];

    if (deps) {
      for (const depId of deps) {
        if (!componentIds.has(depId)) continue;

        const result = longestPath(depId);
        if (result.length > maxLength) {
          maxLength = result.length;
          maxPath = result.path;
        }
      }
    }

    const result = {
      length: maxLength + 1,
      path: [nodeId, ...maxPath],
    };

    memo.set(nodeId, result);
    return result;
  }

  // Find longest path starting from each root
  let bestPath: string[] = [];
  let bestLength = 0;

  for (const rootId of component.roots) {
    const result = longestPath(rootId);
    if (result.length > bestLength) {
      bestLength = result.length;
      bestPath = result.path;
    }
  }

  // If no roots, try all nodes
  if (bestPath.length === 0) {
    for (const node of component.nodes) {
      const result = longestPath(node.id);
      if (result.length > bestLength) {
        bestLength = result.length;
        bestPath = result.path;
      }
    }
  }

  return bestPath;
}

/**
 * Find global critical path across all components
 */
function findGlobalCriticalPath(components: DagComponent[]): string[] {
  let longestPath: string[] = [];

  for (const component of components) {
    if (component.criticalPath.length > longestPath.length) {
      longestPath = component.criticalPath;
    }
  }

  return longestPath;
}

/**
 * Refresh dependency graph from workspace
 */
export function refreshDependencyGraph(options: DagOptions = {}): DependencyGraph {
  // Try to find workspace (current directory or parent)
  let workspacePath = process.cwd();

  // Look for .beads directory
  while (workspacePath !== '/' && !fs.existsSync(path.join(workspacePath, '.beads'))) {
    workspacePath = path.dirname(workspacePath);
  }

  const beads = getBeadsFromBr(workspacePath);
  return buildDependencyGraph(beads, options);
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
  let cycleCount = 0;

  for (const component of graph.components) {
    if (component.hasCycle) {
      cycleCount++;
    }

    for (const node of component.nodes) {
      totalDeps += node.dependencyCount;
      totalDependents += node.dependentCount;
      maxDepth = Math.max(maxDepth, node.depth);

      if (node.status === 'blocked') {
        blockedCount++;
      } else if (node.status === 'open' && node.dependencyCount === 0) {
        readyCount++;
      }
    }
  }

  const totalNodes = graph.totalNodes;
  const avgDependencies = totalNodes > 0 ? totalDeps / totalNodes : 0;
  const avgDependents = totalNodes > 0 ? totalDependents / totalNodes : 0;

  return {
    totalBeads: totalNodes,
    blockedCount,
    readyCount,
    avgDependencies,
    avgDependents,
    maxDepth,
    cycleCount,
    criticalPathLength: graph.globalCriticalPath.length,
    criticalPathBeads: graph.components.reduce(
      (sum, c) => sum + c.nodes.filter(n => n.isCriticalPath).length,
      0
    ),
  };
}

/**
 * Get top blockers (beads that block the most others)
 */
export function getTopBlockers(graph: DependencyGraph, limit: number = 10): BeadNode[] {
  const allNodes: BeadNode[] = [];

  for (const component of graph.components) {
    allNodes.push(...component.nodes);
  }

  // Sort by dependent count (descending)
  allNodes.sort((a, b) => b.dependentCount - a.dependentCount);

  // Filter to only show beads that actually block others
  const blockers = allNodes.filter(n => n.dependentCount > 0);

  return blockers.slice(0, limit);
}

/**
 * Get ready beads (open beads with no blocking dependencies)
 */
export function getReadyBeads(graph: DependencyGraph): BeadNode[] {
  const ready: BeadNode[] = [];

  for (const component of graph.components) {
    for (const node of component.nodes) {
      // Ready = open status + no dependencies
      if (node.status === 'open' && node.dependencyCount === 0) {
        ready.push(node);
      }
    }
  }

  // Sort by priority (P0 first)
  ready.sort((a, b) => a.priority - b.priority);

  return ready;
}

/**
 * Render dependency tree as text
 */
export function renderDependencyTree(
  component: DagComponent,
  options: {
    showPriority?: boolean;
    showStatus?: boolean;
    maxDepth?: number;
  } = {}
): string {
  const { showPriority = true, showStatus = true, maxDepth = 10 } = options;
  const lines: string[] = [];
  const visited = new Set<string>();

  function renderNode(nodeId: string, depth: number, prefix: string, isLast: boolean): void {
    if (depth > maxDepth) return;
    if (visited.has(nodeId)) {
      lines.push(`${prefix}↩ ${nodeId} (cycle)`);
      return;
    }
    visited.add(nodeId);

    const node = component.nodes.find(n => n.id === nodeId);
    if (!node) return;

    // Build line
    const connector = isLast ? '└─' : '├─';
    const statusIcon = showStatus ? getStatusIcon(node.status) : '';
    const statusColor = showStatus ? getStatusColor(node.status) : 'white';
    const priority = showPriority ? `[${getPriorityIndicator(node.priority)}]` : '';
    const critical = node.isCriticalPath ? ' {yellow-fg}⚡{/}' : '';

    const line = `${prefix}${connector} ${statusIcon} {${statusColor}-fg}${node.id}{/} ${priority}${critical}`;
    lines.push(line);

    // Get children (beads this one depends on)
    const children = component.edges
      .filter(e => e.from === nodeId)
      .map(e => e.to);

    // Render children
    const newPrefix = prefix + (isLast ? '  ' : '│ ');
    for (let i = 0; i < children.length; i++) {
      const childId = children[i];
      const isLastChild = i === children.length - 1;
      renderNode(childId, depth + 1, newPrefix, isLastChild);
    }

    visited.delete(nodeId);
  }

  // Render from roots
  if (component.roots.length > 0) {
    for (let i = 0; i < component.roots.length; i++) {
      const rootId = component.roots[i];
      const isLast = i === component.roots.length - 1;
      renderNode(rootId, 0, '', isLast);
    }
  } else {
    // No roots - render all nodes at depth 0
    for (let i = 0; i < component.nodes.length; i++) {
      const node = component.nodes[i];
      const isLast = i === component.nodes.length - 1;
      renderNode(node.id, 0, '', isLast);
    }
  }

  return lines.join('\n');
}
