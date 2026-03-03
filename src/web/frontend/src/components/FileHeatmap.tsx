import React, { useState, useEffect, useCallback } from 'react';
import {
  FileHeatmapEntry,
  FileHeatmapStats,
  HeatLevel,
  HeatmapSortMode,
} from '../types';

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

  if (!visible) return null;

  return (
    <div className="file-heatmap-panel">
      <div className="file-heatmap-header">
        <h2>
          <span className="heatmap-icon">{'\ud83d\udd25'}</span>
          File Heatmap
          {showCollisionsOnly && <span className="collision-badge">COLLISIONS</span>}
        </h2>
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
        <button
          className="heatmap-btn"
          onClick={cycleSortMode}
          title="Cycle sort mode"
        >
          Sort: {sortMode}
        </button>
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
