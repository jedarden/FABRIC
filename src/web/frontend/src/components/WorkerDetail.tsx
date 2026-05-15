import React, { useState, useMemo, useEffect } from 'react';
import { WorkerInfo, LogEvent, NeedleState } from '../types';
import ConversationTranscriptPanel from './ConversationTranscriptPanel';
import { WorkerNarrativeInline } from './SemanticNarrativePanel';
import { logEventsToTurns } from '../utils/conversationTurns';

const NEEDLE_STATE_ICONS: Record<NeedleState, string> = {
  BOOTING: '⏳',
  SELECTING: '🔍',
  CLAIMING: '🎯',
  WORKING: '●',
  CLOSING: '⏹',
  EXHAUSTED_IDLE: '💤',
  STOPPED: '○',
};

const NEEDLE_STATE_COLORS: Record<NeedleState, string> = {
  BOOTING: '#5bc0de',
  SELECTING: '#f0ad4e',
  CLAIMING: '#9b59b6',
  WORKING: '#5cb85c',
  CLOSING: '#f0ad4e',
  EXHAUSTED_IDLE: '#95a5a6',
  STOPPED: '#777',
};

type WorkerTab = 'overview' | 'conversation' | 'narrative';

interface WorkerDetailProps {
  worker: WorkerInfo;
  onClose: () => void;
  allWorkerEvents?: LogEvent[];
  highlightSequence?: number | null;
}

const WorkerDetail: React.FC<WorkerDetailProps> = ({
  worker,
  onClose,
  allWorkerEvents,
  highlightSequence,
}) => {
  const [activeTab, setActiveTab] = useState<WorkerTab>('overview');

  // Auto-switch to conversation tab when highlighting a turn
  useEffect(() => {
    if (highlightSequence != null) {
      setActiveTab('conversation');
    }
  }, [highlightSequence]);

  const conversationTurns = useMemo(
    () => logEventsToTurns(allWorkerEvents || worker.recentEvents || []),
    [allWorkerEvents, worker.recentEvents],
  );

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

  const stateIcon = worker.needleState
    ? NEEDLE_STATE_ICONS[worker.needleState]
    : worker.status === 'active' ? '●' : worker.status === 'idle' ? '○' : '✗';
  const stateLabel = worker.needleState ?? worker.status.toUpperCase();
  const stateColor = worker.needleState
    ? NEEDLE_STATE_COLORS[worker.needleState]
    : undefined;
  const stateCssClass = worker.needleState ? undefined : worker.status;

  const eventsToShow = allWorkerEvents || worker.recentEvents || [];

  return (
    <aside className="worker-detail">
      {/* Header with close button */}
      <div className="worker-detail-header">
        <h2>
          <span
            className={`worker-status-icon ${stateCssClass ?? ''}`}
            style={stateColor ? { color: stateColor } : undefined}
          >
            {stateIcon}
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

      {/* Tab bar */}
      <div className="worker-detail-tabs">
        <button
          className={`worker-detail-tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button
          className={`worker-detail-tab ${activeTab === 'conversation' ? 'active' : ''}`}
          onClick={() => setActiveTab('conversation')}
        >
          Conversation
          {conversationTurns.length > 0 && (
            <span className="worker-detail-tab-count">{conversationTurns.length}</span>
          )}
        </button>
        <button
          className={`worker-detail-tab ${activeTab === 'narrative' ? 'active' : ''}`}
          onClick={() => setActiveTab('narrative')}
        >
          Narrative
        </button>
      </div>

      {/* Tab content */}
      <div className="worker-detail-tab-content">
        {activeTab === 'overview' && (
          <>
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
                <span
                  className={`detail-value worker-status ${stateCssClass ?? ''}`}
                  style={stateColor ? { color: stateColor } : undefined}
                >
                  {stateLabel}
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
          </>
        )}

        {activeTab === 'conversation' && (
          <ConversationTranscriptPanel turns={conversationTurns} highlightSequence={highlightSequence} />
        )}

        {activeTab === 'narrative' && (
          <WorkerNarrativeInline workerId={worker.id} />
        )}
      </div>
    </aside>
  );
};

export default WorkerDetail;
