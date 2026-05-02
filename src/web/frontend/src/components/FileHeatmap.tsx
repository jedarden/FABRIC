import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileHeatmapEntry,
  FileHeatmapStats,
  HeatLevel,
  HeatmapSortMode,
  HeatmapTimelapse,
  HeatmapSnapshot,
} from '../types';

type ViewMode = 'list' | 'treemap' | 'timelapse';

interface FileHeatmapProps {
  visible: boolean;
  onClose: () => void;
}

const FileHeatmap: React.FC<FileHeatmapProps> = ({ visible, onClose }) => {
  const [entries, setEntries] = useState<FileHeatmapEntry[]>([]);
  const [stats, setStats] = useState<FileHeatmapStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<HeatmapSortMode>('modifications');
  const [showCollisionsOnly, setShowCollisionsOnly] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<FileHeatmapEntry | null>(null);
  const [filter, setFilter] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  // Treemap state
  const [hoveredTreemapNode, setHoveredTreemapNode] = useState<string | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);

  // Timelapse state
  const [timelapse, setTimelapse] = useState<HeatmapTimelapse | null>(null);
  const [timelapseLoading, setTimelapseLoading] = useState(false);
  const [timelapseError, setTimelapseError] = useState<string | null>(null);
  const [currentSnapshotIndex, setCurrentSnapshotIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const timelapseIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchHeatmap = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        sortBy: sortMode,
        collisionsOnly: String(showCollisionsOnly),
        ...(filter && { directoryFilter: filter }),
      });

      const [entriesRes, statsRes] = await Promise.all([
        fetch(`/api/heatmap?${params}`),
        fetch('/api/heatmap/stats'),
      ]);

      if (!entriesRes.ok || !statsRes.ok) {
        throw new Error('Failed to fetch heatmap data');
      }

      const entriesData = await entriesRes.json();
      const statsData = await statsRes.json();

      setEntries(entriesData);
      setStats(statsData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [sortMode, showCollisionsOnly, filter]);

  useEffect(() => {
    if (visible) {
      fetchHeatmap();
    }
  }, [visible, fetchHeatmap]);

  const getHeatColor = (level: HeatLevel): string => {
    switch (level) {
      case 'cold': return '#4fc3f7';
      case 'warm': return '#ffb74d';
      case 'hot': return '#f06292';
      case 'critical': return '#e53935';
    }
  };

  const getHeatIcon = (level: HeatLevel): string => {
    switch (level) {
      case 'cold': return '\u25cb';
      case 'warm': return '\u25d0';
      case 'hot': return '\u25cf';
      case 'critical': return '\ud83d\udd25';
    }
  };

  const getHeatBar = (level: HeatLevel, modifications: number): number => {
    const maxBars = 10;
    let bars: number;

    switch (level) {
      case 'cold': bars = Math.min(2, modifications); break;
      case 'warm': bars = Math.min(4, Math.floor(modifications / 2) + 2); break;
      case 'hot': bars = Math.min(7, Math.floor(modifications / 2) + 4); break;
      case 'critical': bars = Math.min(10, Math.floor(modifications / 2) + 6); break;
    }

    return Math.min(bars, maxBars);
  };

  const formatPath = (path: string, maxLength: number = 40): string => {
    if (path.length <= maxLength) return path;

    const fileName = path.substring(path.lastIndexOf('/') + 1);
    const dir = path.substring(0, path.lastIndexOf('/'));

    if (fileName.length >= maxLength - 3) {
      return '...' + fileName.substring(0, maxLength - 3);
    }

    const available = maxLength - fileName.length - 4;
    if (available > 0 && dir.length > available) {
      return dir.substring(0, available) + '.../' + fileName;
    }

    return '...' + path.substring(path.length - maxLength + 3);
  };

  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatWorkers = (workers: FileHeatmapEntry['workers']): string => {
    if (workers.length === 0) return '-';
    if (workers.length === 1) {
      const id = workers[0].workerId;
      return id.length > 8 ? id.slice(0, 8) + '...' : id;
    }
    const top = workers.slice(0, 2).map(w => {
      const id = w.workerId;
      return id.length > 6 ? id.slice(0, 6) : id;
    }).join(', ');
    const extra = workers.length > 2 ? ` +${workers.length - 2}` : '';
    return `${top}${extra}`;
  };

  const cycleSortMode = () => {
    const modes: HeatmapSortMode[] = ['modifications', 'recent', 'workers', 'collisions'];
    const currentIndex = modes.indexOf(sortMode);
    setSortMode(modes[(currentIndex + 1) % modes.length]);
  };

  // Fetch timelapse data when switching to timelapse mode
  const fetchTimelapse = useCallback(async () => {
    setTimelapseLoading(true);
    setTimelapseError(null);
    try {
      const params = new URLSearchParams({
        snapshotCount: '30',
        sortBy: sortMode,
        collisionsOnly: String(showCollisionsOnly),
        ...(filter && { directoryFilter: filter }),
      });

      const response = await fetch(`/api/heatmap/timelapse?${params}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch timelapse: ${response.statusText}`);
      }
      const data = await response.json();
      setTimelapse(data);
      setCurrentSnapshotIndex(0);
      setIsPlaying(false);
    } catch (err) {
      setTimelapseError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setTimelapseLoading(false);
    }
  }, [sortMode, showCollisionsOnly, filter]);

  // Handle view mode change
  const handleViewModeChange = useCallback((newMode: ViewMode) => {
    setViewMode(newMode);
    if (newMode === 'timelapse' && !timelapse) {
      fetchTimelapse();
    }
    // Stop playback if switching away from timelapse
    if (newMode !== 'timelapse' && timelapseIntervalRef.current) {
      clearInterval(timelapseIntervalRef.current);
      timelapseIntervalRef.current = null;
      setIsPlaying(false);
    }
  }, [timelapse, fetchTimelapse]);

  // Timelapse playback controls
  const togglePlayback = useCallback(() => {
    setIsPlaying(prev => {
      const newValue = !prev;
      if (newValue && timelapse) {
        const intervalMs = 1000 / playbackSpeed;
        timelapseIntervalRef.current = setInterval(() => {
          setCurrentSnapshotIndex(prevIndex => {
            const nextIndex = prevIndex + 1;
            if (nextIndex >= timelapse.snapshots.length) {
              if (loop) {
                return 0;
              } else {
                timelapseIntervalRef.current && clearInterval(timelapseIntervalRef.current);
                timelapseIntervalRef.current = null;
                return prevIndex;
              }
            }
            return nextIndex;
          });
        }, intervalMs);
      } else if (timelapseIntervalRef.current) {
        clearInterval(timelapseIntervalRef.current);
        timelapseIntervalRef.current = null;
      }
      return newValue;
    });
  }, [timelapse, playbackSpeed, loop]);

  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (timelapseIntervalRef.current) {
        clearInterval(timelapseIntervalRef.current);
      }
    };
  }, []);

  // Reset playback when timelapse data changes
  useEffect(() => {
    setCurrentSnapshotIndex(0);
    setIsPlaying(false);
    if (timelapseIntervalRef.current) {
      clearInterval(timelapseIntervalRef.current);
      timelapseIntervalRef.current = null;
    }
  }, [timelapse]);

  // Calculate treemap layout
  const calculateTreemapLayout = useCallback((entries: FileHeatmapEntry[], width: number, height: number) => {
    const nodes: Array<{
      entry: FileHeatmapEntry;
      x: number;
      y: number;
      width: number;
      height: number;
    }> = [];

    const totalMods = entries.reduce((sum, e) => sum + e.modifications, 0);
    if (totalMods === 0) return nodes;

    let currentX = 0;
    let currentY = 0;
    let rowHeight = 0;
    let rowWidth = 0;

    for (const entry of entries) {
      const area = (entry.modifications / totalMods) * width * height;
      const nodeWidth = Math.min(width - currentX, Math.sqrt(area * (width / height)));
      const nodeHeight = area / nodeWidth;

      if (currentX + nodeWidth > width) {
        currentX = 0;
        currentY += rowHeight;
        rowHeight = 0;
      }

      nodes.push({
        entry,
        x: currentX,
        y: currentY,
        width: nodeWidth,
        height: nodeHeight,
      });

      currentX += nodeWidth;
      rowHeight = Math.max(rowHeight, nodeHeight);
    }

    return nodes;
  }, []);

  // Get current snapshot for timelapse mode
  const currentSnapshot = timelapse?.snapshots[currentSnapshotIndex] || null;

  if (!visible) return null;

  return (
    <div className="file-heatmap-panel">
      <div className="file-heatmap-header">
        <h2>
          <span className="heatmap-icon">{'\ud83d\udd25'}</span>
          File Heatmap
          {showCollisionsOnly && <span className="collision-badge">COLLISIONS</span>}
        </h2>
        <div className="view-mode-toggle">
          <button
            className={`heatmap-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('list')}
            title="List view"
          >
            List
          </button>
          <button
            className={`heatmap-btn ${viewMode === 'treemap' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('treemap')}
            title="Treemap view"
          >
            Treemap
          </button>
          <button
            className={`heatmap-btn ${viewMode === 'timelapse' ? 'active' : ''}`}
            onClick={() => handleViewModeChange('timelapse')}
            title="Timelapse view"
          >
            Timelapse
          </button>
        </div>
        <button className="file-heatmap-close" onClick={onClose}>
          {'\u00d7'}
        </button>
      </div>

      {stats && (
        <div className="file-heatmap-stats">
          <div className="stats-row">
            <span className="stat">
              <strong>Files:</strong> {stats.totalFiles}
            </span>
            <span className="stat">
              <strong>Mods:</strong> {stats.totalModifications}
            </span>
            <span className="stat">
              <strong>Active:</strong> {stats.activeFiles}
            </span>
            <span className="stat collision-stat">
              <strong>{'\u26a0'}</strong> {stats.collisionFiles}
            </span>
          </div>
          <div className="heat-distribution">
            <span style={{ color: getHeatColor('cold') }}>{'\u25cb'}{stats.heatDistribution.cold}</span>
            <span style={{ color: getHeatColor('warm') }}>{'\u25d0'}{stats.heatDistribution.warm}</span>
            <span style={{ color: getHeatColor('hot') }}>{'\u25cf'}{stats.heatDistribution.hot}</span>
            <span style={{ color: getHeatColor('critical') }}>{'\ud83d\udd25'}{stats.heatDistribution.critical}</span>
          </div>
        </div>
      )}

      <div className="file-heatmap-controls">
        <button
          className={`heatmap-btn ${showCollisionsOnly ? 'active' : ''}`}
          onClick={() => setShowCollisionsOnly(!showCollisionsOnly)}
          title="Toggle collisions only"
        >
          {'\u26a0'} Collisions
        </button>
        {viewMode === 'list' && (
          <button
            className="heatmap-btn"
            onClick={cycleSortMode}
            title="Cycle sort mode"
          >
            Sort: {sortMode}
          </button>
        )}
        <input
          type="text"
          className="heatmap-filter"
          placeholder="Filter by directory..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          className="heatmap-btn"
          onClick={fetchHeatmap}
          title="Refresh"
        >
          {'\u21bb'}
        </button>
      </div>

      <div className="file-heatmap-content">
        {viewMode === 'list' && (
          <>
            {loading ? (
              <div className="heatmap-empty">Loading heatmap data...</div>
            ) : error ? (
              <div className="heatmap-error">{error}</div>
            ) : entries.length === 0 ? (
              <div className="heatmap-empty">
                No file modifications detected
                {showCollisionsOnly && (
                  <p className="hint">Press the Collisions button to show all files</p>
                )}
              </div>
            ) : (
              <div className="heatmap-entries">
                {entries.map((entry, index) => (
                  <div
                    key={`${entry.path}-${index}`}
                    className={`heatmap-entry ${selectedEntry === entry ? 'selected' : ''} ${entry.hasCollision ? 'collision' : ''}`}
                    onClick={() => setSelectedEntry(selectedEntry === entry ? null : entry)}
                  >
                    <span
                      className="heat-icon"
                      style={{ color: getHeatColor(entry.heatLevel) }}
                      title={entry.heatLevel}
                    >
                      {getHeatIcon(entry.heatLevel)}
                    </span>
                    <div className="heat-bar-container">
                      <div
                        className="heat-bar-fill"
                        style={{
                          width: `${getHeatBar(entry.heatLevel, entry.modifications) * 10}%`,
                          backgroundColor: getHeatColor(entry.heatLevel),
                        }}
                      />
                    </div>
                    <span className="mod-count">{entry.modifications.toString().padStart(3, ' ')}</span>
                    <span className="file-path" title={entry.path}>
                      {formatPath(entry.path)}
                    </span>
                    <span className="file-workers">{formatWorkers(entry.workers)}</span>
                    <span className={`collision-indicator ${entry.hasCollision ? 'active' : ''} ${entry.activeWorkers > 1 ? 'warning' : ''}`}>
                      {entry.hasCollision ? '\u26a0' : entry.activeWorkers > 1 ? '\u26a1' : ' '}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {viewMode === 'treemap' && (
          <div className="heatmap-treemap-container">
            {loading ? (
              <div className="heatmap-empty">Loading heatmap data...</div>
            ) : error ? (
              <div className="heatmap-error">{error}</div>
            ) : entries.length === 0 ? (
              <div className="heatmap-empty">
                No file modifications detected
                {showCollisionsOnly && (
                  <p className="hint">Press the Collisions button to show all files</p>
                )}
              </div>
            ) : (
              <div className="heatmap-treemap">
                {calculateTreemapLayout(entries, 800, 400).map((node, index) => (
                  <div
                    key={`${node.entry.path}-${index}`}
                    className="treemap-node"
                    style={{
                      position: 'absolute',
                      left: `${node.x}px`,
                      top: `${node.y}px`,
                      width: `${node.width}px`,
                      height: `${node.height}px`,
                      backgroundColor: getHeatColor(node.entry.heatLevel),
                      border: node.entry.hasCollision ? '2px solid #ff9800' : '1px solid rgba(255,255,255,0.3)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                    }}
                    onMouseEnter={(e) => {
                      setHoveredTreemapNode(node.entry.path);
                      setTooltipPosition({ x: e.clientX, y: e.clientY });
                    }}
                    onMouseLeave={() => {
                      setHoveredTreemapNode(null);
                      setTooltipPosition(null);
                    }}
                    onClick={() => setSelectedEntry(selectedEntry === node.entry ? null : node.entry)}
                    title={node.entry.path}
                  >
                    <span style={{
                      color: '#fff',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                      textAlign: 'center',
                      padding: '4px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {node.entry.modifications}
                    </span>
                  </div>
                ))}
                {hoveredTreemapNode && tooltipPosition && (
                  <div
                    className="treemap-tooltip"
                    style={{
                      position: 'fixed',
                      left: `${tooltipPosition.x + 10}px`,
                      top: `${tooltipPosition.y + 10}px`,
                      backgroundColor: 'rgba(0, 0, 0, 0.9)',
                      color: '#fff',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      zIndex: 1000,
                      pointerEvents: 'none',
                    }}
                  >
                    {entries.find(e => e.path === hoveredTreemapNode)?.path}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {viewMode === 'timelapse' && (
          <div className="heatmap-timelapse-container">
            {timelapseLoading ? (
              <div className="heatmap-empty">Generating timelapse...</div>
            ) : timelapseError ? (
              <div className="heatmap-error">Failed to fetch timelapse</div>
            ) : !timelapse || timelapse.snapshots.length === 0 ? (
              <div className="heatmap-empty">No timelapse data available</div>
            ) : (
              <>
                <div className="timelapse-controls">
                  <div className="timelapse-playback">
                    <button
                      className={isPlaying ? 'primary' : ''}
                      onClick={togglePlayback}
                    >
                      {isPlaying ? '\u23f8' : '\u25b6'}
                    </button>
                    <button onClick={() => setCurrentSnapshotIndex(Math.max(0, currentSnapshotIndex - 1))}>
                      {'\u23ee'}
                    </button>
                    <button onClick={() => setCurrentSnapshotIndex(Math.min(timelapse.snapshots.length - 1, currentSnapshotIndex + 1))}>
                      {'\u23ed'}
                    </button>
                  </div>
                  <div className="timelapse-speed">
                    <span>Speed:</span>
                    {[0.5, 1, 2, 5].map(speed => (
                      <button
                        key={speed}
                        className={playbackSpeed === speed ? 'active' : ''}
                        onClick={() => setPlaybackSpeed(speed)}
                      >
                        {speed}x
                      </button>
                    ))}
                  </div>
                  <div className="timelapse-loop">
                    <label>
                      <input
                        type="checkbox"
                        checked={loop}
                        onChange={(e) => setLoop(e.target.checked)}
                      />
                      Loop
                    </label>
                  </div>
                </div>
                <div className="timelapse-slider">
                  <input
                    type="range"
                    min="0"
                    max={timelapse.snapshots.length - 1}
                    value={currentSnapshotIndex}
                    onChange={(e) => {
                      setCurrentSnapshotIndex(Number(e.target.value));
                      setIsPlaying(false);
                    }}
                  />
                  <div className="timelapse-labels">
                    <span>
                      {new Date(timelapse.snapshots[currentSnapshotIndex].timestamp).toLocaleTimeString('en-US', {
                        hour12: false,
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <span>
                      {currentSnapshotIndex + 1} / {timelapse.snapshots.length}
                    </span>
                  </div>
                </div>
                <div className="timelapse-snapshot">
                  {currentSnapshot && (
                    <>
                      {currentSnapshot.entries.length === 0 ? (
                        <div className="heatmap-empty">No files at this point in time</div>
                      ) : (
                        <div className="heatmap-entries">
                          {currentSnapshot.entries.map((entry, index) => (
                            <div
                              key={`${entry.path}-${index}`}
                              className={`heatmap-entry ${entry.hasCollision ? 'collision' : ''}`}
                            >
                              <span
                                className="heat-icon"
                                style={{ color: getHeatColor(entry.heatLevel) }}
                                title={entry.heatLevel}
                              >
                                {getHeatIcon(entry.heatLevel)}
                              </span>
                              <div className="heat-bar-container">
                                <div
                                  className="heat-bar-fill"
                                  style={{
                                    width: `${getHeatBar(entry.heatLevel, entry.modifications) * 10}%`,
                                    backgroundColor: getHeatColor(entry.heatLevel),
                                  }}
                                />
                              </div>
                              <span className="mod-count">{entry.modifications.toString().padStart(3, ' ')}</span>
                              <span className="file-path" title={entry.path}>
                                {formatPath(entry.path)}
                              </span>
                              <span className="file-workers">{formatWorkers(entry.workers)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {selectedEntry && (
        <div className="file-heatmap-detail">
          <div className="detail-header">
            <h3>{formatPath(selectedEntry.path, 60)}</h3>
            <button className="detail-close" onClick={() => setSelectedEntry(null)}>
              {'\u00d7'}
            </button>
          </div>
          <div className="detail-content">
            <div className="detail-row">
              <span className="label">Modifications:</span>
              <span className="value">{selectedEntry.modifications}</span>
            </div>
            <div className="detail-row">
              <span className="label">Heat Level:</span>
              <span className="value" style={{ color: getHeatColor(selectedEntry.heatLevel) }}>
                {selectedEntry.heatLevel.toUpperCase()}
              </span>
            </div>
            <div className="detail-row">
              <span className="label">First Modified:</span>
              <span className="value">{formatTime(selectedEntry.firstModified)}</span>
            </div>
            <div className="detail-row">
              <span className="label">Last Modified:</span>
              <span className="value">{formatTime(selectedEntry.lastModified)}</span>
            </div>
            <div className="detail-row">
              <span className="label">Active Workers:</span>
              <span className="value">{selectedEntry.activeWorkers}</span>
            </div>
            <div className="detail-row">
              <span className="label">Collision:</span>
              <span className={`value ${selectedEntry.hasCollision ? 'warning' : ''}`}>
                {selectedEntry.hasCollision ? 'Yes' : 'No'}
              </span>
            </div>
            {selectedEntry.workers.length > 0 && (
              <div className="detail-workers">
                <h4>Workers ({selectedEntry.workers.length})</h4>
                {selectedEntry.workers.map((w, i) => (
                  <div key={i} className="worker-row">
                    <span className="worker-id">{w.workerId}</span>
                    <span className="worker-mods">{w.modifications} mods ({w.percentage}%)</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="file-heatmap-footer">
        <span className="help">[s] Sort | [c] Collisions only | Click entry for details</span>
      </div>
    </div>
  );
};

export default FileHeatmap;
