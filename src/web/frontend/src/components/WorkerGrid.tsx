import React from 'react';
import { WorkerInfo } from '../types';

interface WorkerGridProps {
  workers: WorkerInfo[];
  selectedWorker: string | null;
  onSelectWorker: (id: string | null) => void;
  pinnedWorkers?: Set<string>;
  onTogglePin?: (workerId: string) => void;
  focusModeEnabled?: boolean;
}

const WorkerGrid: React.FC<WorkerGridProps> = ({
  workers,
  selectedWorker,
  onSelectWorker,
  pinnedWorkers = new Set(),
  onTogglePin,
  focusModeEnabled = false,
}) => {
  const formatLastSeen = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  const handlePinClick = (e: React.MouseEvent, workerId: string) => {
    e.stopPropagation(); // Prevent card selection when clicking pin
    if (onTogglePin) {
      onTogglePin(workerId);
    }
  };

  return (
    <div className="worker-grid">
      <h2>
        Workers ({workers.length})
        {focusModeEnabled && pinnedWorkers.size > 0 && (
          <span style={{ marginLeft: '0.5rem', fontSize: '0.9rem', color: '#666' }}>
            (Focus: {pinnedWorkers.size} pinned)
          </span>
        )}
      </h2>

      {workers.length === 0 ? (
        <div className="empty-state">
          <p>{focusModeEnabled && pinnedWorkers.size === 0
            ? 'No pinned workers. Pin workers to see them in Focus Mode.'
            : 'No workers detected'}</p>
          <p style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>
            {focusModeEnabled && pinnedWorkers.size === 0
              ? 'Disable Focus Mode to see all workers'
              : 'Waiting for log events...'}
          </p>
        </div>
      ) : (
        workers.map(worker => {
          const isPinned = pinnedWorkers.has(worker.id);
          return (
            <div
              key={worker.id}
              className={`worker-card ${selectedWorker === worker.id ? 'selected' : ''} ${worker.hasCollision ? 'collision' : ''} ${isPinned ? 'pinned' : ''}`}
              onClick={() => onSelectWorker(selectedWorker === worker.id ? null : worker.id)}
            >
              <div className="worker-card-header">
                <span className="worker-id">
                  {worker.id}
                  {worker.hasCollision && (
                    <span className="collision-indicator" title="File collision detected!">
                      ⚠️
                    </span>
                  )}
                </span>
                <div className="worker-card-actions">
                  {onTogglePin && (
                    <button
                      className={`pin-button ${isPinned ? 'pinned' : ''}`}
                      onClick={(e) => handlePinClick(e, worker.id)}
                      title={isPinned ? 'Unpin worker' : 'Pin worker for Focus Mode'}
                    >
                      {isPinned ? '📌' : '📍'}
                    </button>
                  )}
                  <span className={`worker-status ${worker.status}`}>
                    {worker.status}
                  </span>
                </div>
              </div>
              <div className="worker-stats">
                <span>{worker.eventCount} events</span>
                <span>{formatLastSeen(worker.lastSeen)}</span>
              </div>
              {worker.hasCollision && worker.activeFiles && worker.activeFiles.length > 0 && (
                <div className="collision-warning">
                  <span style={{ fontSize: '0.7rem', color: '#ff9800' }}>
                    Colliding on: {worker.activeFiles.length} file(s)
                  </span>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

export default WorkerGrid;
