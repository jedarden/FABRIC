import React from 'react';
import { WorkerInfo, NeedleState } from '../types';
import WorkerMemoryBar from './WorkerMemoryBar';

const NEEDLE_STATE_LABELS: Record<NeedleState, string> = {
  BOOTING: 'BOOTING',
  SELECTING: 'SELECTING',
  CLAIMING: 'CLAIMING',
  BUILDING: 'WORKING',
  DISPATCHING: 'WORKING',
  EXECUTING: 'WORKING',
  HANDLING: 'WORKING',
  LOGGING: 'WORKING',
  WORKING: 'WORKING',
  CLOSING: 'CLOSING',
  EXHAUSTED_IDLE: 'EXHAUSTED',
  STOPPED: 'STOPPED',
};

const NEEDLE_STATE_COLORS: Record<NeedleState, string> = {
  BOOTING: '#5bc0de',
  SELECTING: '#f0ad4e',
  CLAIMING: '#9b59b6',
  BUILDING: '#5cb85c',
  DISPATCHING: '#5cb85c',
  EXECUTING: '#5cb85c',
  HANDLING: '#5cb85c',
  LOGGING: '#5cb85c',
  WORKING: '#5cb85c',
  CLOSING: '#f0ad4e',
  EXHAUSTED_IDLE: '#95a5a6',
  STOPPED: '#777',
};

// Lower number = higher priority (shown first)
const NEEDLE_STATE_PRIORITY: Partial<Record<string, number>> = {
  EXECUTING: 0,
  WORKING: 0,
  BUILDING: 0,
  DISPATCHING: 0,
  HANDLING: 0,
  LOGGING: 0,
  CLAIMING: 1,
  SELECTING: 2,
  BOOTING: 3,
  CLOSING: 4,
  EXHAUSTED_IDLE: 5,
  STOPPED: 6,
};

const TEST_WORKER_PATTERNS: RegExp[] = [
  /^test-/,
  /^claude-test-/,
  /^nonexistent-/,
  /^needle-test$/,
  /^strand-runner$/,
  /-test-worker$/,
];

function isTestWorker(id: string): boolean {
  return TEST_WORKER_PATTERNS.some(pattern => pattern.test(id));
}

function stateSort(a: WorkerInfo, b: WorkerInfo): number {
  const pa = a.needleState != null ? (NEEDLE_STATE_PRIORITY[a.needleState] ?? 7) : 7;
  const pb = b.needleState != null ? (NEEDLE_STATE_PRIORITY[b.needleState] ?? 7) : 7;
  if (pa !== pb) return pa - pb;
  return a.id.localeCompare(b.id);
}

interface WorkerGridProps {
  workers: WorkerInfo[];
  selectedWorker: string | null;
  onSelectWorker: (id: string | null) => void;
  pinnedWorkers?: Set<string>;
  onTogglePin?: (workerId: string) => void;
  focusModeEnabled?: boolean;
  hideTestWorkers?: boolean;
}

const WorkerGrid: React.FC<WorkerGridProps> = ({
  workers,
  selectedWorker,
  onSelectWorker,
  pinnedWorkers = new Set(),
  onTogglePin,
  focusModeEnabled = false,
  hideTestWorkers = true,
}) => {
  const formatLastActivity = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  const handlePinClick = (e: React.MouseEvent, workerId: string) => {
    e.stopPropagation();
    if (onTogglePin) {
      onTogglePin(workerId);
    }
  };

  const visibleWorkers = [...workers]
    .filter(w => !hideTestWorkers || !isTestWorker(w.id))
    .sort(stateSort);

  return (
    <div className="worker-grid">
      <h2>
        Workers ({visibleWorkers.length})
        {focusModeEnabled && pinnedWorkers.size > 0 && (
          <span style={{ marginLeft: '0.5rem', fontSize: '0.9rem', color: '#666' }}>
            (Focus: {pinnedWorkers.size} pinned)
          </span>
        )}
      </h2>

      {visibleWorkers.length === 0 ? (
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
        visibleWorkers.map(worker => {
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
                  {worker.host && (
                    <span className="host-badge" title={`Host: ${worker.host}`}>
                      @{worker.host}
                    </span>
                  )}
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
                  <span
                    className={`worker-status ${worker.status}${worker.stuck ? ' stuck' : ''}`}
                    style={worker.needleState ? { backgroundColor: NEEDLE_STATE_COLORS[worker.needleState] } : undefined}
                    title={worker.stuck ? worker.stuckReason : undefined}
                  >
                    {worker.stuck && '⚡'}
                    {worker.needleState ? NEEDLE_STATE_LABELS[worker.needleState] : worker.status}
                  </span>
                </div>
              </div>
              <div className="worker-stats">
                <span>
                  {worker.needleState === 'WORKING' && worker.currentBead
                    ? `bead: ${worker.currentBead} / ${worker.beadsCompleted} completed`
                    : `${worker.beadsCompleted} completed`}
                </span>
                <span>{formatLastActivity(worker.lastActivity)}</span>
              </div>
              <WorkerMemoryBar
                rssKb={worker.rssKb}
                peakRssKb={worker.peakRssKb}
                rssLimitBytes={worker.rssLimitBytes}
                rssPercent={worker.rssPercent}
                swapKb={worker.swapKb}
              />
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
