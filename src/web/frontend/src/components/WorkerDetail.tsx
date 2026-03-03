import React from 'react';
import { WorkerInfo, LogEvent } from '../types';

interface WorkerDetailProps {
  /** The worker to display details for */
  worker: WorkerInfo;

  /** Callback when the detail panel should close */
  onClose: () => void;

  /** Optional: all events for this worker (if provided, shows more history) */
  allWorkerEvents?: LogEvent[];
}

/**
 * WorkerDetail Component
 *
 * Displays detailed information about a selected worker including:
 * - Worker ID and status
 * - Activity statistics (event count, current tool)
 * - Timing information (last seen, uptime)
 * - Recent events list
 * - Collision information if applicable
 */
const WorkerDetail: React.FC<WorkerDetailProps> = ({
  worker,
  onClose,
  allWorkerEvents,
}) => {
  const formatLastSeen = (timestamp: string): string => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m ago`;
  };

  const formatTime = (timestamp: string): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const getStatusIcon = (): string => {
    switch (worker.status) {
      case 'active':
        return '●';
      case 'idle':
        return '○';
      case 'error':
        return '✗';
      default:
        return '?';
    }
  };

  const eventsToShow = allWorkerEvents || worker.recentEvents || [];

  return (
    <aside className="worker-detail">
      {/* Header with close button */}
      <div className="worker-detail-header">
        <h2>
          <span className={`worker-status-icon ${worker.status}`}>
            {getStatusIcon()}
          </span>
          {worker.id}
        </h2>
        <button
          className="worker-detail-close"
          onClick={onClose}
          title="Close details"
        >
          ✕
        </button>
      </div>

      {/* Collision warning if applicable */}
      {worker.hasCollision && (
        <div className="collision-alert">
          <span className="collision-alert-icon">⚠️</span>
          <span>File collision detected!</span>
          {worker.activeFiles && worker.activeFiles.length > 0 && (
            <div className="collision-files">
              {worker.activeFiles.slice(0, 3).map((file, i) => (
                <span key={i} className="collision-file" title={file}>
                  {file.split('/').pop()}
                </span>
              ))}
              {worker.activeFiles.length > 3 && (
                <span className="collision-more">
                  +{worker.activeFiles.length - 3} more
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Status Section */}
      <div className="detail-section">
        <h3>Status</h3>
        <div className="detail-row">
          <span className="detail-label">State</span>
          <span className={`detail-value worker-status ${worker.status}`}>
            {worker.status}
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Events</span>
          <span className="detail-value">{worker.eventCount}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Current Tool</span>
          <span className="detail-value tool-name">
            {worker.currentTool || '-'}
          </span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Last Seen</span>
          <span className="detail-value" title={worker.lastSeen}>
            {formatLastSeen(worker.lastSeen)}
          </span>
        </div>
      </div>

      {/* Recent Events Section */}
      <div className="detail-section">
        <h3>Recent Events ({eventsToShow.length})</h3>
        {eventsToShow.length === 0 ? (
          <div className="detail-empty">No events recorded</div>
        ) : (
          <div className="detail-events">
            {eventsToShow.slice(-10).map((event, i) => (
              <div key={i} className="detail-event-item">
                <span className="detail-event-time">
                  {formatTime(event.timestamp)}
                </span>
                <span className={`detail-event-level ${event.level}`}>
                  {event.level.slice(0, 3).toUpperCase()}
                </span>
                <span className="detail-event-msg" title={event.message}>
                  {event.message.length > 35
                    ? event.message.slice(0, 35) + '...'
                    : event.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tool Activity Section */}
      {worker.currentTool && (
        <div className="detail-section">
          <h3>Current Activity</h3>
          <div className="tool-activity">
            <span className="tool-name">{worker.currentTool}</span>
          </div>
        </div>
      )}
    </aside>
  );
};

export default WorkerDetail;
