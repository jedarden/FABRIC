import React from 'react';
import { WorkerInfo } from '../types';

interface WorkerGridProps {
  workers: WorkerInfo[];
  selectedWorker: string | null;
  onSelectWorker: (id: string | null) => void;
}

const WorkerGrid: React.FC<WorkerGridProps> = ({ workers, selectedWorker, onSelectWorker }) => {
  const formatLastSeen = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  return (
    <div className="worker-grid">
      <h2>Workers ({workers.length})</h2>

      {workers.length === 0 ? (
        <div className="empty-state">
          <p>No workers detected</p>
          <p style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>
            Waiting for log events...
          </p>
        </div>
      ) : (
        workers.map(worker => (
          <div
            key={worker.id}
            className={`worker-card ${selectedWorker === worker.id ? 'selected' : ''} ${worker.hasCollision ? 'collision' : ''}`}
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
              <span className={`worker-status ${worker.status}`}>
                {worker.status}
              </span>
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
        ))
      )}
    </div>
  );
};

export default WorkerGrid;
