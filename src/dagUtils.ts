/**
 * FABRIC Dependency DAG Utilities
 *
 * Utilities for parsing and analyzing bead dependency graphs.
 * Integrates with the `br graph` command to visualize task dependencies.
 */

import { execSync } from 'child_process';
import {
  BeadNode,
  DependencyEdge,
  DagComponent,
  DependencyGraph,
  DagOptions,
  DagStats,
  BeadStatus,
  SpanNode,
  SpanDag,
  LogEvent,
} from './types.js';

/**
 * Raw graph output from br graph --json
 */
interface BrGraphOutput {
  components: Array<{
    nodes: Array<{
      id: string;
      title: string;
      status: string;
      priority: number;
      depth: number;
    }>;
    edges: Array<{
      from: string;
      to: string;
    }>;
    roots: string[];
  }>;
  total_nodes: number;
  total_components: number;
}

/**
 * Raw bead output from br show --json
 */
interface BrBeadOutput {
  id: string;
  title: string;
  status: string;
  priority: number;
  description?: string;
  labels?: string[];
}

/**
 * Get the workspace path (where .beads directory is)
 */
function getWorkspacePath(): string {
  return process.env.WORKSPACE || process.cwd();
}

/**
 * Run br graph command and get JSON output
 */
export function getBrGraphJson(options: DagOptions = {}): BrGraphOutput {
  const workspace = getWorkspacePath();
  const args = ['graph', '--all', '--json'];

  if (options.includeClosed) {
    // br graph only shows open/in_progress/blocked by default
    // We'd need to filter after getting all beads for closed ones
  }

  try {
    const result = execSync(`br ${args.join(' ')}`, {
      cwd: workspace,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(result);
  } catch (error) {
    // Return empty graph if br command fails
    return {
      components: [],
      total_nodes: 0,
      total_components: 0,
    };
  }
}

/**
 * Get all beads with full details
 */
export function getAllBeads(): BrBeadOutput[] {
  const workspace = getWorkspacePath();

  try {
    const result = execSync('br list --all --json', {
      cwd: workspace,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(result);
  } catch {
    return [];
  }
}

/**
 * Parse the raw br graph output into our typed structure
 */
export function parseDependencyGraph(
  rawGraph: BrGraphOutput,
  options: DagOptions = {}
): DependencyGraph {
  const components: DagComponent[] = [];
  let totalEdges = 0;
  let globalCriticalPath: string[] = [];
  let maxCriticalLength = 0;

  for (const rawComponent of rawGraph.components) {
    // Build node map for quick lookup
    const nodeMap = new Map<string, BeadNode>();

    // Calculate dependency/dependent counts
    const dependencyCounts = new Map<string, number>();
    const dependentCounts = new Map<string, number>();

    for (const edge of rawComponent.edges) {
      dependencyCounts.set(edge.from, (dependencyCounts.get(edge.from) || 0) + 1);
      dependentCounts.set(edge.to, (dependentCounts.get(edge.to) || 0) + 1);
      totalEdges++;
    }

    // Convert nodes
    for (const rawNode of rawComponent.nodes) {
      // Apply filters
      if (options.status && options.status !== 'all') {
        if (rawNode.status !== options.status) continue;
      }
      if (options.minPriority !== undefined && rawNode.priority < options.minPriority) {
        continue;
      }
      if (options.maxPriority !== undefined && rawNode.priority > options.maxPriority) {
        continue;
      }
      if (options.maxDepth !== undefined && rawNode.depth > options.maxDepth) {
        continue;
      }

      const node: BeadNode = {
        id: rawNode.id,
        title: rawNode.title,
        status: rawNode.status as BeadStatus,
        priority: rawNode.priority,
        depth: rawNode.depth,
        dependentCount: dependentCounts.get(rawNode.id) || 0,
        dependencyCount: dependencyCounts.get(rawNode.id) || 0,
        isCriticalPath: false, // Will be calculated below
      };
      nodeMap.set(rawNode.id, node);
    }

    // Calculate critical path for this component
    const criticalPath = findCriticalPath(rawComponent.nodes, rawComponent.edges);

    // Mark nodes on critical path
    for (const nodeId of criticalPath) {
      const node = nodeMap.get(nodeId);
      if (node) {
        node.isCriticalPath = true;
      }
    }

    // Convert edges
    const edges: DependencyEdge[] = rawComponent.edges
      .filter((e) => nodeMap.has(e.from) && nodeMap.has(e.to))
      .map((e) => ({
        from: e.from,
        to: e.to,
        isCritical: criticalPath.includes(e.from) && criticalPath.includes(e.to),
      }));

    // Detect cycles
    const hasCycle = detectCycle(rawComponent.nodes.map((n) => n.id), rawComponent.edges);

    // Calculate max depth
    const maxDepth = Math.max(...rawComponent.nodes.map((n) => n.depth), 0);

    const component: DagComponent = {
      nodes: Array.from(nodeMap.values()),
      edges,
      roots: rawComponent.roots.filter((r) => nodeMap.has(r)),
      hasCycle,
      criticalPath,
      maxDepth,
    };

    components.push(component);

    // Track global critical path
    if (criticalPath.length > maxCriticalLength) {
      maxCriticalLength = criticalPath.length;
      globalCriticalPath = criticalPath;
    }
  }

  return {
    components,
    totalNodes: rawGraph.total_nodes,
    totalEdges,
    totalComponents: rawGraph.total_components,
    globalCriticalPath,
    generatedAt: Date.now(),
  };
}

/**
 * Find the critical path (longest path) through the graph
 * Uses dynamic programming approach
 */
export function findCriticalPath(
  nodes: Array<{ id: string; depth: number }>,
  edges: Array<{ from: string; to: string }>
): string[] {
  if (nodes.length === 0) return [];

  // Build adjacency list (dependencies -> dependents)
  const dependents = new Map<string, string[]>();
  const dependencies = new Map<string, string[]>();

  for (const node of nodes) {
    dependents.set(node.id, []);
    dependencies.set(node.id, []);
  }

  for (const edge of edges) {
    dependents.get(edge.to)?.push(edge.from);
    dependencies.get(edge.from)?.push(edge.to);
  }

  // Find all roots (nodes with no dependencies)
  const roots = nodes.filter((n) => (dependencies.get(n.id) || []).length === 0);

  // DFS to find longest path
  let longestPath: string[] = [];
  const memo = new Map<string, string[]>();

  function dfs(nodeId: string): string[] {
    if (memo.has(nodeId)) {
      return memo.get(nodeId)!;
    }

    const children = dependents.get(nodeId) || [];
    if (children.length === 0) {
      memo.set(nodeId, [nodeId]);
      return [nodeId];
    }

    let bestChildPath: string[] = [];
    for (const child of children) {
      const childPath = dfs(child);
      if (childPath.length > bestChildPath.length) {
        bestChildPath = childPath;
      }
    }

    const result = [nodeId, ...bestChildPath];
    memo.set(nodeId, result);
    return result;
  }

  // Start from each root
  for (const root of roots) {
    const path = dfs(root.id);
    if (path.length > longestPath.length) {
      longestPath = path;
    }
  }

  return longestPath;
}

/**
 * Detect cycles in the graph using DFS
 */
export function detectCycle(
  nodes: string[],
  edges: Array<{ from: string; to: string }>
): boolean {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  // Build adjacency list
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.from)?.push(edge.to);
  }

  function hasCycleDFS(node: string): boolean {
    visited.add(node);
    recursionStack.add(node);

    const neighbors = adjacency.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (hasCycleDFS(neighbor)) return true;
      } else if (recursionStack.has(neighbor)) {
        return true;
      }
    }

    recursionStack.delete(node);
    return false;
  }

  for (const node of nodes) {
    if (!visited.has(node)) {
      if (hasCycleDFS(node)) return true;
    }
  }

  return false;
}

/**
 * Get beads that block the most other beads
 */
export function getTopBlockers(graph: DependencyGraph, limit: number = 10): BeadNode[] {
  const allNodes = graph.components.flatMap((c) => c.nodes);
  return allNodes
    .filter((n) => n.dependentCount > 0)
    .sort((a, b) => b.dependentCount - a.dependentCount)
    .slice(0, limit);
}

/**
 * Get beads that are ready (no blocking dependencies)
 */
export function getReadyBeads(graph: DependencyGraph): BeadNode[] {
  const allNodes = graph.components.flatMap((c) => c.nodes);
  return allNodes.filter(
    (n) =>
      n.dependencyCount === 0 &&
      (n.status === 'open' || n.status === 'in_progress')
  );
}

/**
 * Get statistics about the dependency graph
 */
export function getDagStats(graph: DependencyGraph): DagStats {
  const allNodes = graph.components.flatMap((c) => c.nodes);

  const blockedCount = allNodes.filter(
    (n) => n.status === 'blocked' || n.dependencyCount > 0
  ).length;

  const readyCount = allNodes.filter(
    (n) => n.dependencyCount === 0 && (n.status === 'open' || n.status === 'in_progress')
  ).length;

  const totalDependencies = allNodes.reduce((sum, n) => sum + n.dependencyCount, 0);
  const totalDependents = allNodes.reduce((sum, n) => sum + n.dependentCount, 0);

  const cycleCount = graph.components.filter((c) => c.hasCycle).length;
  const maxDepth = Math.max(...graph.components.map((c) => c.maxDepth), 0);

  const criticalPathBeads = allNodes.filter((n) => n.isCriticalPath).length;

  return {
    totalBeads: allNodes.length,
    blockedCount,
    readyCount,
    avgDependencies: allNodes.length > 0 ? totalDependencies / allNodes.length : 0,
    avgDependents: allNodes.length > 0 ? totalDependents / allNodes.length : 0,
    maxDepth,
    cycleCount,
    criticalPathLength: graph.globalCriticalPath.length,
    criticalPathBeads,
  };
}

/**
 * Format a bead ID for display (truncate if needed)
 */
export function formatBeadId(id: string, maxLength: number = 8): string {
  if (id.length <= maxLength) return id;
  return id.slice(0, maxLength);
}

/**
 * Get status icon for a bead
 */
export function getStatusIcon(status: BeadStatus): string {
  switch (status) {
    case 'open':
      return '○';
    case 'in_progress':
      return '●';
    case 'blocked':
      return '⊘';
    case 'completed':
    case 'closed':
      return '✓';
    case 'deferred':
      return '◷';
    default:
      return '?';
  }
}

/**
 * Get color for bead status
 */
export function getStatusColor(status: BeadStatus): string {
  switch (status) {
    case 'open':
      return 'white';
    case 'in_progress':
      return 'green';
    case 'blocked':
      return 'red';
    case 'completed':
    case 'closed':
      return 'gray';
    case 'deferred':
      return 'yellow';
    default:
      return 'white';
  }
}

/**
 * Get priority indicator string
 */
export function getPriorityIndicator(priority: number): string {
  const indicators = ['P0', 'P1', 'P2', 'P3', 'P4'];
  return indicators[priority] || `P${priority}`;
}

/**
 * Create a text representation of a component's dependency tree
 */
export function renderDependencyTree(
  component: DagComponent,
  options: { showPriority?: boolean; showStatus?: boolean; maxDepth?: number } = {}
): string {
  const lines: string[] = [];
  const { showPriority = true, showStatus = true, maxDepth = 10 } = options;

  // Build adjacency list (dependencies -> dependents)
  const dependents = new Map<string, string[]>();
  const nodeMap = new Map<string, BeadNode>();

  for (const node of component.nodes) {
    dependents.set(node.id, []);
    nodeMap.set(node.id, node);
  }

  for (const edge of component.edges) {
    dependents.get(edge.to)?.push(edge.from);
  }

  // Render tree from roots
  function renderNode(nodeId: string, depth: number, prefix: string, isLast: boolean): void {
    if (depth > maxDepth) return;

    const node = nodeMap.get(nodeId);
    if (!node) return;

    const connector = isLast ? '└─' : '├─';
    const icon = getStatusIcon(node.status);
    const priority = showPriority ? ` [${getPriorityIndicator(node.priority)}]` : '';
    const critical = node.isCriticalPath ? ' ⚡' : '';
    const blocked = node.dependencyCount > 0 ? ` (${node.dependencyCount} deps)` : '';

    if (depth === 0) {
      lines.push(`${icon} ${node.id}${priority}: ${node.title}${critical}${blocked}`);
    } else {
      lines.push(
        `${prefix}${connector} ${icon} ${node.id}${priority}: ${node.title}${critical}${blocked}`
      );
    }

    const children = dependents.get(nodeId) || [];
    const newPrefix = prefix + (isLast ? '  ' : '│ ');

    children.forEach((childId, index) => {
      renderNode(childId, depth + 1, newPrefix, index === children.length - 1);
    });
  }

  // Render from each root
  for (const rootId of component.roots) {
    renderNode(rootId, 0, '', true);
    lines.push(''); // Empty line between trees
  }

  return lines.join('\n');
}

/**
 * Refresh and get the current dependency graph
 */
export function refreshDependencyGraph(options: DagOptions = {}): DependencyGraph {
  const rawGraph = getBrGraphJson(options);
  return parseDependencyGraph(rawGraph, options);
}

// ── Span-based DAG (OTLP parent_span_id linkage) ──────────────

/** Fields on LogEvent that are standard and should not be copied to SpanNode.attributes */
const SPAN_RESERVED_KEYS = new Set([
  'ts', 'worker', 'level', 'msg', 'sequence', 'session', 'bead',
  'duration_ms', 'error', 'tool', 'path', 'provider', 'model',
  'span_id', 'parent_span_id', 'trace_id', 'span_name',
]);

/**
 * Build a span hierarchy DAG from a stream of LogEvents that carry
 * `span_id` / `parent_span_id` (set by the OTLP normalizer).
 *
 * Each span_id produces one SpanNode. The `.started` event seeds the node
 * (timestamp, name), and the matching `.finished` event closes it
 * (duration, status). Parent-child edges come from `parent_span_id`.
 */
export function buildSpanDag(events: LogEvent[]): SpanDag {
  const allSpans = new Map<string, SpanNode>();
  const traces = new Map<string, SpanNode[]>();

  for (const event of events) {
    const spanId = event.span_id as string | undefined;
    if (!spanId) continue;

    let node = allSpans.get(spanId);
    if (!node) {
      const newNode: SpanNode = {
        span_id: spanId,
        trace_id: (event.trace_id as string) || '',
        parent_span_id: (event.parent_span_id as string | null) || null,
        name: (event.span_name as string) || event.msg.replace(/\.(started|finished)$/, ''),
        worker_id: event.worker,
        bead_id: event.bead || null,
        start_ts: null,
        end_ts: null,
        duration_ms: null,
        status: 'unknown',
        children: [],
        attributes: {},
      };
      allSpans.set(spanId, newNode);
      node = newNode;
    }

    // Update from .started / .finished events
    const isStarted = event.msg.endsWith('.started');
    const isFinished = event.msg.endsWith('.finished');

    if (isStarted) {
      node.start_ts = event.ts || null;
      if (event.span_name) node.name = event.span_name as string;
    } else if (isFinished) {
      node.end_ts = event.ts || null;
      node.duration_ms = event.duration_ms || null;
      node.status = event.error ? 'error' : 'ok';
    }

    // Track by trace_id
    if (node.trace_id) {
      const traceSpans = traces.get(node.trace_id) || [];
      if (!traceSpans.some(s => s.span_id === spanId)) {
        traceSpans.push(node);
      }
      traces.set(node.trace_id, traceSpans);
    }

    // Copy non-reserved fields into attributes
    for (const [key, value] of Object.entries(event)) {
      if (!SPAN_RESERVED_KEYS.has(key) && !(key in node.attributes)) {
        node.attributes[key] = value;
      }
    }
  }

  // Build parent-child tree
  const roots: SpanNode[] = [];
  for (const node of allSpans.values()) {
    if (node.parent_span_id) {
      const parent = allSpans.get(node.parent_span_id);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  return { roots, allSpans, traces };
}

/**
 * Find spans for a specific bead ID within a SpanDag.
 */
export function findSpansForBead(dag: SpanDag, beadId: string): SpanNode[] {
  const result: SpanNode[] = [];
  for (const node of dag.allSpans.values()) {
    if (node.bead_id === beadId) {
      result.push(node);
    }
  }
  return result;
}
