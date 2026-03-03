import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DependencyGraph,
  DagStats,
  BeadNode,
  BeadStatus,
  DagOptions,
  DagViewMode,
} from '../types';

interface DependencyDagProps {
  visible: boolean;
  onClose: () => void;
}

// Status icons and colors
const getStatusIcon = (status: BeadStatus): string => {
  switch (status) {
    case 'open': return '○';
    case 'in_progress': return '◐';
    case 'blocked': return '⛔';
    case 'completed': return '●';
    case 'closed': return '✓';
    case 'deferred': return '⏸';
    default: return '?';
  }
};

const getStatusColor = (status: BeadStatus): string => {
  switch (status) {
    case 'open': return 'var(--text-secondary)';
    case 'in_progress': return '#00bcd4';
    case 'blocked': return 'var(--error)';
    case 'completed': return 'var(--success)';
    case 'closed': return 'var(--success)';
    case 'deferred': return 'var(--warning)';
    default: return 'var(--text-secondary)';
  }
};

const getStatusClassName = (status: BeadStatus): string => {
  switch (status) {
    case 'open': return 'status-open';
    case 'in_progress': return 'status-progress';
    case 'blocked': return 'status-blocked';
    case 'completed': return 'status-completed';
    case 'closed': return 'status-closed';
    case 'deferred': return 'status-deferred';
    default: return 'status-unknown';
  }
};

const getPriorityLabel = (priority: number): string => {
  switch (priority) {
    case 0: return 'P0';
    case 1: return 'P1';
    case 2: return 'P2';
    case 3: return 'P3';
    case 4: return 'P4';
    default: return 'P?';
  }
};

const getPriorityClassName = (priority: number): string => {
  switch (priority) {
    case 0: return 'priority-critical';
    case 1: return 'priority-high';
    case 2: return 'priority-normal';
    case 3: return 'priority-low';
    case 4: return 'priority-backlog';
    default: return 'priority-unknown';
  }
};

// Helper functions for graph analysis
const getTopBlockers = (graph: DependencyGraph | null, limit: number = 15): BeadNode[] => {
  if (!graph) return [];
  const allNodes: BeadNode[] = [];
  for (const component of graph.components) {
    allNodes.push(...component.nodes);
  }
  allNodes.sort((a, b) => b.dependentCount - a.dependentCount);
  return allNodes.filter(n => n.dependentCount > 0).slice(0, limit);
};

const getReadyBeads = (graph: DependencyGraph | null): BeadNode[] => {
  if (!graph) return [];
  const ready: BeadNode[] = [];
  for (const component of graph.components) {
    for (const node of component.nodes) {
      if (node.status === 'open' && node.dependencyCount === 0) {
        ready.push(node);
      }
    }
  }
  ready.sort((a, b) => a.priority - b.priority);
  return ready;
};

const DependencyDag: React.FC<DependencyDagProps> = ({ visible, onClose }) => {
  const [graph, setGraph] = useState<DependencyGraph | null>(null);
  const [stats, setStats] = useState<DagStats | null>(null);
  const [viewMode, setViewMode] = useState<DagViewMode>('tree');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filterOptions, setFilterOptions] = useState<DagOptions>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedBead, setSelectedBead] = useState<BeadNode | null>(null);

  // Fetch dependency graph from API
  const fetchGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterOptions.status && filterOptions.status !== 'all') {
        params.set('status', filterOptions.status);
      }
      if (filterOptions.criticalOnly) {
        params.set('criticalOnly', 'true');
      }
      if (filterOptions.maxDepth !== undefined) {
        params.set('maxDepth', filterOptions.maxDepth.toString());
      }
      if (filterOptions.includeClosed) {
        params.set('includeClosed', 'true');
      }

      const response = await fetch(`/api/dag?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch DAG: ${response.statusText}`);
      }
      const data = await response.json();
      setGraph(data.graph);
      setStats(data.stats);
      setSelectedIndex(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [filterOptions]);

  useEffect(() => {
    if (visible) {
      fetchGraph();
    }
  }, [visible, fetchGraph]);

  // Get items based on view mode
  const currentItems = useMemo(() => {
    if (!graph) return [];
    switch (viewMode) {
      case 'blockers':
        return getTopBlockers(graph);
      case 'ready':
        return getReadyBeads(graph);
      default:
        const allNodes: BeadNode[] = [];
        for (const component of graph.components) {
          allNodes.push(...component.nodes);
        }
        return allNodes;
    }
  }, [graph, viewMode]);

  // Cycle filter options
  const cycleFilter = useCallback(() => {
    const filters: Array<{ key: keyof DagOptions; value: any }> = [
      { key: 'status', value: undefined },
      { key: 'status', value: 'blocked' as BeadStatus },
      { key: 'status', value: 'in_progress' as BeadStatus },
      { key: 'criticalOnly', value: true },
      { key: 'criticalOnly', value: false },
    ];

    const currentIdx = filters.findIndex(
      (f) =>
        (f.key === 'status' && filterOptions.status === f.value) ||
        (f.key === 'criticalOnly' && filterOptions.criticalOnly === f.value)
    );

    const nextIdx = (currentIdx + 1) % filters.length;
    const nextFilter = filters[nextIdx];

    setFilterOptions({ ...filterOptions, [nextFilter.key]: nextFilter.value });
  }, [filterOptions]);

  // Get filter description
  const getFilterDescription = (): string => {
    const parts: string[] = [];
    if (filterOptions.status) {
      parts.push(`status=${filterOptions.status}`);
    }
    if (filterOptions.criticalOnly) {
      parts.push('critical-only');
    }
    if (filterOptions.maxDepth !== undefined) {
      parts.push(`depth≤${filterOptions.maxDepth}`);
    }
    return parts.length > 0 ? ` [${parts.join(', ')}]` : '';
  };

  // Render tree node recursively
  const renderTreeNode = (
    node: BeadNode,
    componentIndex: number,
    depth: number,
    isLast: boolean,
    visited: Set<string>
  ): React.ReactNode => {
    if (depth > 5) return null;
    if (visited.has(node.id)) {
      return (
        <div key={`${node.id}-cycle`} className="dag-tree-node cycle" style={{ paddingLeft: depth * 16 }}>
          ↩ {node.id} (cycle)
        </div>
      );
    }

    const component = graph?.components[componentIndex];
    if (!component) return null;

    const children = component.edges
      .filter(e => e.from === node.id)
      .map(e => component.nodes.find(n => n.id === e.to))
      .filter((n): n is BeadNode => n !== undefined);

    return (
      <div key={node.id} className="dag-tree-node-wrapper">
        <div
          className={`dag-tree-node ${selectedBead?.id === node.id ? 'selected' : ''}`}
          style={{ paddingLeft: depth * 16 }}
          onClick={() => setSelectedBead(node)}
        >
          <span className="dag-tree-connector">{isLast ? '└─' : '├─'}</span>
          <span className={`dag-status-icon ${getStatusClassName(node.status)}`}>
            {getStatusIcon(node.status)}
          </span>
          <span className="dag-node-id" style={{ color: getStatusColor(node.status) }}>
            {node.id}
          </span>
          <span className={`dag-priority ${getPriorityClassName(node.priority)}`}>
            [{getPriorityLabel(node.priority)}]
          </span>
          {node.isCriticalPath && <span className="dag-critical-icon">⚡</span>}
        </div>
        {children.map((child, i) =>
          renderTreeNode(
            child,
            componentIndex,
            depth + 1,
            i === children.length - 1,
            new Set([...visited, node.id])
          )
        )}
      </div>
    );
  };

  // Render tree view
  const renderTreeView = (): React.ReactNode => {
    if (!graph) return null;

    if (graph.components.length === 0) {
      return (
        <div className="dag-empty">
          <p>No dependencies found</p>
          <p className="dag-empty-hint">Tasks with dependencies will appear here.</p>
        </div>
      );
    }

    return (
      <div className="dag-tree-container">
        {graph.components.map((component, componentIndex) => (
          <div key={`component-${componentIndex}`} className="dag-component">
            {component.hasCycle && (
              <div className="dag-cycle-warning">
                ⚠ Cycle detected in this component!
              </div>
            )}
            {component.criticalPath.length > 0 && (
              <div className="dag-critical-path">
                ⚡ Critical path: {component.criticalPath.map((id, i) => (
                  <React.Fragment key={id}>
                    <span className="dag-critical-node">{id}</span>
                    {i < component.criticalPath.length - 1 && <span className="dag-arrow">→</span>}
                  </React.Fragment>
                ))}
              </div>
            )}
            <div className="dag-tree">
              {component.roots.length > 0
                ? component.roots.map((rootId, i) => {
                    const rootNode = component.nodes.find(n => n.id === rootId);
                    if (!rootNode) return null;
                    return (
                      <React.Fragment key={rootId}>
                        {renderTreeNode(
                          rootNode,
                          componentIndex,
                          0,
                          i === component.roots.length - 1,
                          new Set()
                        )}
                      </React.Fragment>
                    );
                  })
                : component.nodes.map((node, i) =>
                    renderTreeNode(node, componentIndex, 0, i === component.nodes.length - 1, new Set())
                  )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Render blockers view
  const renderBlockersView = (): React.ReactNode => {
    const blockers = getTopBlockers(graph, 15);

    if (blockers.length === 0) {
      return (
        <div className="dag-empty">
          <p className="dag-success-text">No blockers found!</p>
          <p>All tasks are unblocked.</p>
        </div>
      );
    }

    return (
      <div className="dag-list-container">
        <p className="dag-list-header">Tasks blocking the most other tasks:</p>
        <div className="dag-list">
          {blockers.map((node, i) => (
            <div
              key={node.id}
              className={`dag-list-item ${selectedIndex === i ? 'selected' : ''}`}
              onClick={() => {
                setSelectedIndex(i);
                setSelectedBead(node);
              }}
            >
              <span className={`dag-status-icon ${getStatusClassName(node.status)}`}>
                {getStatusIcon(node.status)}
              </span>
              <span className="dag-node-id" style={{ color: getStatusColor(node.status) }}>
                {node.id}
              </span>
              <span className={`dag-priority ${getPriorityClassName(node.priority)}`}>
                [{getPriorityLabel(node.priority)}]
              </span>
              <span className="dag-blocked-count">
                <strong>{node.dependentCount}</strong> blocked
              </span>
              {node.isCriticalPath && <span className="dag-critical-icon">⚡</span>}
              <div className="dag-item-title">{node.title.slice(0, 50)}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Render ready view
  const renderReadyView = (): React.ReactNode => {
    const ready = getReadyBeads(graph);

    if (ready.length === 0) {
      return (
        <div className="dag-empty">
          <p className="dag-warning-text">No ready tasks found.</p>
          <p>All open tasks have blocking dependencies.</p>
          <p>Complete blockers to unlock new work.</p>
        </div>
      );
    }

    return (
      <div className="dag-list-container">
        <p className="dag-list-header">{ready.length} tasks ready to work on:</p>
        <div className="dag-list">
          {ready.map((node, i) => (
            <div
              key={node.id}
              className={`dag-list-item ${selectedIndex === i ? 'selected' : ''}`}
              onClick={() => {
                setSelectedIndex(i);
                setSelectedBead(node);
              }}
            >
              <span className={`dag-status-icon ${getStatusClassName(node.status)}`}>
                {getStatusIcon(node.status)}
              </span>
              <span className="dag-node-id" style={{ color: getStatusColor(node.status) }}>
                {node.id}
              </span>
              <span className={`dag-priority ${getPriorityClassName(node.priority)}`}>
                [{getPriorityLabel(node.priority)}]
              </span>
              {node.isCriticalPath && <span className="dag-critical-icon">⚡</span>}
              <div className="dag-item-title">{node.title.slice(0, 50)}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Render stats view
  const renderStatsView = (): React.ReactNode => {
    if (!stats || !graph) return null;

    return (
      <div className="dag-stats-container">
        <div className="dag-stats-section">
          <h3>Overview</h3>
          <div className="dag-stats-row">
            <span className="dag-stats-label">Total Beads:</span>
            <span className="dag-stats-value">{stats.totalBeads}</span>
          </div>
          <div className="dag-stats-row">
            <span className="dag-stats-label">Components:</span>
            <span className="dag-stats-value">{graph.totalComponents}</span>
          </div>
          <div className="dag-stats-row">
            <span className="dag-stats-label">Total Edges:</span>
            <span className="dag-stats-value">{graph.totalEdges}</span>
          </div>
        </div>

        <div className="dag-stats-section">
          <h3>Status Breakdown</h3>
          <div className="dag-stats-row">
            <span className="dag-stats-label status-ready">Ready:</span>
            <span className="dag-stats-value">{stats.readyCount}</span>
          </div>
          <div className="dag-stats-row">
            <span className="dag-stats-label status-blocked">Blocked:</span>
            <span className="dag-stats-value">{stats.blockedCount}</span>
          </div>
        </div>

        <div className="dag-stats-section">
          <h3>Graph Depth</h3>
          <div className="dag-stats-row">
            <span className="dag-stats-label">Maximum:</span>
            <span className="dag-stats-value">{stats.maxDepth}</span>
          </div>
        </div>

        <div className="dag-stats-section">
          <h3>Critical Path</h3>
          <div className="dag-stats-row">
            <span className="dag-stats-label">Length:</span>
            <span className="dag-stats-value">{stats.criticalPathLength}</span>
          </div>
          <div className="dag-stats-row">
            <span className="dag-stats-label">Beads on path:</span>
            <span className="dag-stats-value">{stats.criticalPathBeads}</span>
          </div>
          {graph.globalCriticalPath.length > 0 && (
            <div className="dag-critical-path-preview">
              <span className="dag-stats-label">Path:</span>
              <div className="dag-path-nodes">
                {graph.globalCriticalPath.slice(0, 5).map((id, i) => (
                  <React.Fragment key={id}>
                    <span className="dag-path-node">→ {id}</span>
                  </React.Fragment>
                ))}
                {graph.globalCriticalPath.length > 5 && (
                  <span className="dag-path-more">
                    ... and {graph.globalCriticalPath.length - 5} more
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="dag-stats-section">
          <h3>Averages</h3>
          <div className="dag-stats-row">
            <span className="dag-stats-label">Dependencies:</span>
            <span className="dag-stats-value">{stats.avgDependencies.toFixed(1)}</span>
          </div>
          <div className="dag-stats-row">
            <span className="dag-stats-label">Dependents:</span>
            <span className="dag-stats-value">{stats.avgDependents.toFixed(1)}</span>
          </div>
        </div>

        {stats.cycleCount > 0 && (
          <div className="dag-cycle-warning-section">
            ⚠ {stats.cycleCount} cycle(s) detected!
            <p>Circular dependencies prevent proper execution.</p>
          </div>
        )}
      </div>
    );
  };

  if (!visible) return null;

  return (
    <div className="dag-panel">
      <div className="dag-header">
        <h2>
          <span className="dag-header-icon">🔗</span>
          Task Dependency DAG
          {graph && <span className="dag-count">{graph.totalNodes}</span>}
        </h2>
        <div className="dag-header-actions">
          <button
            className="dag-btn dag-btn-secondary"
            onClick={cycleFilter}
            title="Cycle filter options"
          >
            🔍 Filter
          </button>
          <button
            className="dag-btn dag-btn-secondary"
            onClick={fetchGraph}
            disabled={loading}
            title="Refresh"
          >
            {loading ? '⏳' : '🔄'} Refresh
          </button>
          <button className="dag-btn dag-btn-close" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      <div className="dag-view-modes">
        <button
          className={`dag-mode-btn ${viewMode === 'tree' ? 'active' : ''}`}
          onClick={() => setViewMode('tree')}
        >
          🌳 Tree
        </button>
        <button
          className={`dag-mode-btn ${viewMode === 'blockers' ? 'active' : ''}`}
          onClick={() => setViewMode('blockers')}
        >
          🚫 Blockers
        </button>
        <button
          className={`dag-mode-btn ${viewMode === 'ready' ? 'active' : ''}`}
          onClick={() => setViewMode('ready')}
        >
          ✅ Ready
        </button>
        <button
          className={`dag-mode-btn ${viewMode === 'stats' ? 'active' : ''}`}
          onClick={() => setViewMode('stats')}
        >
          📊 Stats
        </button>
      </div>

      <div className="dag-content">
        {loading && !graph && (
          <div className="dag-loading">Loading dependency graph...</div>
        )}

        {error && (
          <div className="dag-error">
            <p>Error loading dependency graph</p>
            <p className="dag-error-message">{error}</p>
            <button className="dag-btn dag-btn-primary" onClick={fetchGraph}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="dag-filter-info">
              {viewMode.charAt(0).toUpperCase() + viewMode.slice(1)} View{getFilterDescription()}
            </div>
            <div className="dag-scroll-content">
              {viewMode === 'tree' && renderTreeView()}
              {viewMode === 'blockers' && renderBlockersView()}
              {viewMode === 'ready' && renderReadyView()}
              {viewMode === 'stats' && renderStatsView()}
            </div>
          </>
        )}
      </div>

      {selectedBead && (
        <div className="dag-detail-panel">
          <div className="dag-detail-header">
            <h3>{selectedBead.id}</h3>
            <button
              className="dag-detail-close"
              onClick={() => setSelectedBead(null)}
            >
              ✕
            </button>
          </div>
          <div className="dag-detail-content">
            <div className="dag-detail-row">
              <span className="dag-detail-label">Title:</span>
              <span className="dag-detail-value">{selectedBead.title}</span>
            </div>
            <div className="dag-detail-row">
              <span className="dag-detail-label">Status:</span>
              <span
                className={`dag-detail-value dag-status ${getStatusClassName(selectedBead.status)}`}
              >
                {getStatusIcon(selectedBead.status)} {selectedBead.status}
              </span>
            </div>
            <div className="dag-detail-row">
              <span className="dag-detail-label">Priority:</span>
              <span className={`dag-detail-value ${getPriorityClassName(selectedBead.priority)}`}>
                {getPriorityLabel(selectedBead.priority)}
              </span>
            </div>
            <div className="dag-detail-row">
              <span className="dag-detail-label">Depth:</span>
              <span className="dag-detail-value">{selectedBead.depth}</span>
            </div>
            <div className="dag-detail-row">
              <span className="dag-detail-label">Dependencies:</span>
              <span className="dag-detail-value">{selectedBead.dependencyCount}</span>
            </div>
            <div className="dag-detail-row">
              <span className="dag-detail-label">Blocking:</span>
              <span className="dag-detail-value">{selectedBead.dependentCount}</span>
            </div>
            {selectedBead.isCriticalPath && (
              <div className="dag-detail-critical">
                ⚡ On critical path
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default DependencyDag;
