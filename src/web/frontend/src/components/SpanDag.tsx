import React, { useState, useEffect, useCallback, useRef } from 'react';
import { SpanNode, SpanDagResponse } from '../types';

interface SpanDagProps {
  visible: boolean;
  onClose: () => void;
}

/** Zoom limits */
const MIN_ZOOM = 25;
const MAX_ZOOM = 400;
const ZOOM_STEP = 25;

const getSpanStatusColor = (status: string): string => {
  switch (status) {
    case 'ok': return 'var(--success)';
    case 'error': return 'var(--error)';
    default: return 'var(--text-secondary)';
  }
};

const getSpanStatusIcon = (status: string): string => {
  switch (status) {
    case 'ok': return '●';
    case 'error': return '✕';
    default: return '○';
  }
};

const formatDuration = (ms: number | null): string => {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
};

/** Recursively count total spans in a tree */
const countSpans = (nodes: SpanNode[]): number => {
  let count = 0;
  for (const node of nodes) {
    count += 1 + countSpans(node.children);
  }
  return count;
};

/** Render a single span tree node and its children */
const SpanTreeNode: React.FC<{
  node: SpanNode;
  depth: number;
  isLast: boolean;
  selectedSpanId: string | null;
  onSelect: (id: string) => void;
}> = ({ node, depth, isLast, selectedSpanId, onSelect }) => {
  const isExpanded = depth < 2;
  const isSelected = selectedSpanId === node.span_id;
  const indent = '  '.repeat(depth);
  const connector = depth === 0 ? '' : (isLast ? '└─ ' : '├─ ');

  return (
    <>
      <div
        className={`span-dag-node ${isSelected ? 'span-dag-node-selected' : ''}`}
        onClick={() => onSelect(node.span_id)}
        style={{ paddingLeft: `${depth * 20 + 8}px` }}
      >
        <span className="span-dag-tree-connector">{indent}{connector}</span>
        <span style={{ color: getSpanStatusColor(node.status) }}>
          {getSpanStatusIcon(node.status)}
        </span>
        <span className="span-dag-node-name">{node.name}</span>
        {node.duration_ms !== null && (
          <span className="span-dag-duration">{formatDuration(node.duration_ms)}</span>
        )}
        {node.bead_id && (
          <span className="span-dag-bead-id">{node.bead_id}</span>
        )}
        {node.children.length > 0 && (
          <span className="span-dag-child-count">({node.children.length})</span>
        )}
      </div>
      {node.children.map((child, i) => (
        <SpanTreeNode
          key={child.span_id}
          node={child}
          depth={depth + 1}
          isLast={i === node.children.length - 1}
          selectedSpanId={selectedSpanId}
          onSelect={onSelect}
        />
      ))}
    </>
  );
};

const SpanDag: React.FC<SpanDagProps> = ({ visible, onClose }) => {
  const [dagData, setDagData] = useState<SpanDagResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [selectedSpan, setSelectedSpan] = useState<SpanNode | null>(null);

  // Zoom and pan state
  const [zoom, setZoom] = useState(100);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const treeContainerRef = useRef<HTMLDivElement>(null);

  const fetchSpanDag = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedTraceId) {
        params.set('trace_id', selectedTraceId);
      }
      const response = await fetch(`/api/spans/dag?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch span DAG: ${response.statusText}`);
      }
      const data = await response.json();
      setDagData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [selectedTraceId]);

  useEffect(() => {
    if (visible) {
      fetchSpanDag();
    }
  }, [visible, fetchSpanDag]);

  // Find a span by ID in the tree
  const findSpanById = (nodes: SpanNode[], id: string): SpanNode | null => {
    for (const node of nodes) {
      if (node.span_id === id) return node;
      const found = findSpanById(node.children, id);
      if (found) return found;
    }
    return null;
  };

  const handleSelectSpan = (spanId: string) => {
    setSelectedSpanId(spanId);
    if (dagData) {
      setSelectedSpan(findSpanById(dagData.roots, spanId));
    }
  };

  // Reset zoom and pan to default
  const resetZoomPan = useCallback(() => {
    setZoom(100);
    setPan({ x: 0, y: 0 });
  }, []);

  // Zoom in handler
  const zoomIn = useCallback(() => {
    setZoom(prev => Math.min(MAX_ZOOM, prev + ZOOM_STEP));
  }, []);

  // Zoom out handler
  const zoomOut = useCallback(() => {
    setZoom(prev => Math.max(MIN_ZOOM, prev - ZOOM_STEP));
  }, []);

  // Mouse wheel zoom handler
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      zoomIn();
    } else {
      zoomOut();
    }
  }, [zoomIn, zoomOut]);

  // Mouse down - start dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Allow dragging with left mouse button (button 0) or middle mouse button (button 1)
    if (e.button === 0 || e.button === 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  }, [pan]);

  // Mouse move - pan
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  }, [isDragging, dragStart]);

  // Mouse up or leave - stop dragging
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Get cursor style based on zoom/pan state
  const getCursorStyle = (): string => {
    if (isDragging) return 'grabbing';
    if (zoom !== 100 || pan.x !== 0 || pan.y !== 0) return 'grab';
    return 'default';
  };

  // Check if reset button should be visible
  const showResetButton = zoom !== 100 || pan.x !== 0 || pan.y !== 0;

  if (!visible) return null;

  const totalSpans = dagData ? countSpans(dagData.roots) : 0;

  return (
    <div className="dag-panel">
      <div className="dag-header">
        <h2>
          <span className="dag-header-icon">🔗</span>
          Span DAG
          {dagData && <span className="dag-count">{totalSpans}</span>}
        </h2>
        <div className="dag-header-actions">
          {/* Zoom controls */}
          <div className="dag-zoom-controls">
            <button
              className="dag-btn dag-btn-secondary"
              onClick={zoomOut}
              disabled={zoom <= MIN_ZOOM}
              title="Zoom out (- or − key)"
            >
              −
            </button>
            <span className="dag-zoom-level">{zoom}%</span>
            <button
              className="dag-btn dag-btn-secondary"
              onClick={zoomIn}
              disabled={zoom >= MAX_ZOOM}
              title="Zoom in (+ or = key)"
            >
              +
            </button>
            {showResetButton && (
              <button
                className="dag-btn dag-btn-secondary"
                onClick={resetZoomPan}
                title="Reset zoom and pan (0 key)"
              >
                ↺
              </button>
            )}
          </div>
          <button className="dag-btn dag-btn-secondary" onClick={fetchSpanDag}>
            Refresh
          </button>
          <button className="dag-btn dag-btn-secondary" onClick={() => {
            setSelectedTraceId(null);
            setSelectedSpanId(null);
            setSelectedSpan(null);
          }}>
            All Traces
          </button>
          <button className="dag-btn dag-btn-close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className="dag-content">
        {loading && <div className="dag-loading">Loading span DAG...</div>}
        {error && <div className="dag-error">Error: {error}</div>}

        {!loading && !error && dagData && (
          <>
            {/* Trace filter */}
            {dagData.traces.length > 1 && (
              <div className="span-dag-trace-filter">
                <span className="span-dag-trace-label">Filter:</span>
                <button
                  className={`span-dag-trace-btn ${!selectedTraceId ? 'active' : ''}`}
                  onClick={() => setSelectedTraceId(null)}
                >
                  All ({dagData.totalSpans})
                </button>
                {dagData.traces.slice(0, 10).map(t => (
                  <button
                    key={t.trace_id}
                    className={`span-dag-trace-btn ${selectedTraceId === t.trace_id ? 'active' : ''}`}
                    onClick={() => setSelectedTraceId(t.trace_id)}
                  >
                    {t.trace_id.slice(0, 8)} ({t.span_count})
                  </button>
                ))}
              </div>
            )}

            {/* Stats bar */}
            <div className="dag-stats-bar">
              <div className="dag-stat">
                <span className="dag-stats-label">Total Spans:</span>
                <span className="dag-stats-value">{dagData.totalSpans}</span>
              </div>
              <div className="dag-stat">
                <span className="dag-stats-label">Traces:</span>
                <span className="dag-stats-value">{dagData.traces.length}</span>
              </div>
              <div className="dag-stat">
                <span className="dag-stats-label">Root Spans:</span>
                <span className="dag-stats-value">{dagData.roots.length}</span>
              </div>
            </div>

            {/* Span tree */}
            <div
              ref={treeContainerRef}
              className="dag-tree-container"
              style={{
                transform: `scale(${zoom / 100}) translate(${pan.x}px, ${pan.y}px)`,
                transformOrigin: 'top left',
                cursor: getCursorStyle(),
              }}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
            >
              {dagData.roots.length === 0 ? (
                <div className="dag-empty">
                  No OTLP spans received yet. Start an instrumented worker to see span data.
                </div>
              ) : (
                dagData.roots.map((root, i) => (
                  <SpanTreeNode
                    key={root.span_id}
                    node={root}
                    depth={0}
                    isLast={i === dagData.roots.length - 1}
                    selectedSpanId={selectedSpanId}
                    onSelect={handleSelectSpan}
                  />
                ))
              )}
            </div>

            {/* Span detail panel */}
            {selectedSpan && (
              <div className="dag-detail-panel">
                <h3>Span Detail</h3>
                <div className="dag-detail-row">
                  <span className="dag-detail-label">Name:</span>
                  <span className="dag-detail-value">{selectedSpan.name}</span>
                </div>
                <div className="dag-detail-row">
                  <span className="dag-detail-label">Span ID:</span>
                  <span className="dag-detail-value">{selectedSpan.span_id}</span>
                </div>
                {selectedSpan.parent_span_id && (
                  <div className="dag-detail-row">
                    <span className="dag-detail-label">Parent:</span>
                    <span className="dag-detail-value">{selectedSpan.parent_span_id}</span>
                  </div>
                )}
                <div className="dag-detail-row">
                  <span className="dag-detail-label">Trace:</span>
                  <span className="dag-detail-value">{selectedSpan.trace_id}</span>
                </div>
                <div className="dag-detail-row">
                  <span className="dag-detail-label">Worker:</span>
                  <span className="dag-detail-value">{selectedSpan.worker_id}</span>
                </div>
                {selectedSpan.bead_id && (
                  <div className="dag-detail-row">
                    <span className="dag-detail-label">Bead:</span>
                    <span className="dag-detail-value">{selectedSpan.bead_id}</span>
                  </div>
                )}
                <div className="dag-detail-row">
                  <span className="dag-detail-label">Status:</span>
                  <span className="dag-detail-value" style={{ color: getSpanStatusColor(selectedSpan.status) }}>
                    {selectedSpan.status}
                  </span>
                </div>
                <div className="dag-detail-row">
                  <span className="dag-detail-label">Duration:</span>
                  <span className="dag-detail-value">{formatDuration(selectedSpan.duration_ms)}</span>
                </div>
                <div className="dag-detail-row">
                  <span className="dag-detail-label">Children:</span>
                  <span className="dag-detail-value">{selectedSpan.children.length}</span>
                </div>
                {Object.keys(selectedSpan.attributes).length > 0 && (
                  <div className="dag-detail-row">
                    <span className="dag-detail-label">Attributes:</span>
                    <span className="dag-detail-value">
                      <pre className="span-dag-attrs">
                        {JSON.stringify(selectedSpan.attributes, null, 2)}
                      </pre>
                    </span>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {!loading && !error && !dagData && (
          <div className="dag-empty">No span data available.</div>
        )}
      </div>
    </div>
  );
};

export default SpanDag;
