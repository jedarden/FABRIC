import React, { useState, useEffect, useCallback } from 'react';

interface SessionRecord {
  id: string;
  started_at: number;
  ended_at: number;
  worker_count: number;
  task_count: number;
  total_cost: number;
  total_tokens: number;
  metrics_source?: string;
}

interface WorkerSummary {
  sessionId: string;
  workerId: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  beadsCompleted: number;
  beadsFailed: number;
  errors: number;
  metricsSource: string;
}

interface SessionDetail extends SessionRecord {
  workerSummaries: WorkerSummary[];
}

interface SessionsResponse {
  sessions: SessionRecord[];
  count: number;
}

interface SessionDetailResponse {
  session: SessionRecord;
  workerSummaries: WorkerSummary[];
}

interface HistoricalSessionsPanelProps {
  visible: boolean;
  onClose: () => void;
}

const HistoricalSessionsPanel: React.FC<HistoricalSessionsPanelProps> = ({ visible, onClose }) => {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/sessions?limit=50');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SessionsResponse = await res.json();
      setSessions(data.sessions);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSessionDetail = useCallback(async (sessionId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SessionDetailResponse = await res.json();
      setSelectedSession({
        ...data.session,
        workerSummaries: data.workerSummaries,
      });
    } catch (err) {
      setDetailError(String(err));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) fetchSessions();
  }, [visible, fetchSessions]);

  if (!visible) return null;

  const formatDate = (ts: number): string => {
    return new Date(ts).toLocaleString();
  };

  const formatDuration = (startMs: number, endMs: number): string => {
    const durationMs = endMs - startMs;
    const minutes = Math.floor(durationMs / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  };

  const formatCost = (cost: number): string => {
    if (cost < 0.01) return '<$0.01';
    return `$${cost.toFixed(2)}`;
  };

  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
    return tokens.toString();
  };

  return (
    <div className="analytics-panel sessions-panel">
      <div className="analytics-header">
        <h3>
          Historical Sessions
          {sessions.length > 0 && (
            <span className="analytics-subtitle">{sessions.length} sessions</span>
          )}
        </h3>
        <div className="analytics-header-actions">
          <button className="analytics-refresh" onClick={fetchSessions} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
      </div>

      {error && <div className="analytics-error">{error}</div>}

      <div className="analytics-content">
        {sessions.length === 0 && !loading && !error && (
          <div className="analytics-empty">
            <p>No historical sessions found.</p>
            <p className="analytics-empty-hint">Sessions are recorded when workers complete tasks and metrics are finalized.</p>
          </div>
        )}

        {sessions.length > 0 && (
          <div className="sessions-list">
            <table className="sessions-table">
              <thead>
                <tr>
                  <th>Session ID</th>
                  <th>Duration</th>
                  <th>Workers</th>
                  <th>Tasks</th>
                  <th>Cost</th>
                  <th>Tokens</th>
                  <th>Time Range</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr
                    key={session.id}
                    className={selectedSession?.id === session.id ? 'selected' : ''}
                    onClick={() => fetchSessionDetail(session.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="sessions-id">
                      <code>{session.id.slice(-12)}</code>
                    </td>
                    <td className="sessions-duration">
                      {formatDuration(session.started_at, session.ended_at)}
                    </td>
                    <td className="sessions-workers">{session.worker_count}</td>
                    <td className="sessions-tasks">{session.task_count}</td>
                    <td className="sessions-cost">{formatCost(session.total_cost)}</td>
                    <td className="sessions-tokens">{formatTokens(session.total_tokens)}</td>
                    <td className="sessions-time">
                      <div className="sessions-time-start">{formatDate(session.started_at)}</div>
                      <div className="sessions-time-end">{formatDate(session.ended_at)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selectedSession && (
          <div className="sessions-detail">
            <div className="sessions-detail-header">
              <h4>Session Details: <code>{selectedSession.id.slice(-12)}</code></h4>
              <button
                className="close-button"
                onClick={() => setSelectedSession(null)}
              >
                ×
              </button>
            </div>

            {detailError && <div className="analytics-error">{detailError}</div>}

            {detailLoading && <div className="analytics-loading">Loading session details...</div>}

            {!detailLoading && selectedSession.workerSummaries.length > 0 && (
              <div className="sessions-workers-section">
                <h5>Worker Performance</h5>
                <table className="sessions-workers-table">
                  <thead>
                    <tr>
                      <th>Worker</th>
                      <th>Beads Completed</th>
                      <th>Beads Failed</th>
                      <th>Errors</th>
                      <th>Cost</th>
                      <th>Tokens (In/Out)</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSession.workerSummaries.map((summary) => (
                      <tr key={summary.workerId}>
                        <td className="sessions-worker-id">
                          <code>{summary.workerId}</code>
                        </td>
                        <td className="sessions-beads-completed">{summary.beadsCompleted}</td>
                        <td className="sessions-beads-failed">{summary.beadsFailed}</td>
                        <td className="sessions-errors">{summary.errors}</td>
                        <td className="sessions-cost">{formatCost(summary.costUsd)}</td>
                        <td className="sessions-tokens">
                          {formatTokens(summary.tokensIn)} / {formatTokens(summary.tokensOut)}
                        </td>
                        <td className="sessions-source">
                          <span className={`sessions-source-badge ${summary.metricsSource}`}>
                            {summary.metricsSource}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!detailLoading && selectedSession.workerSummaries.length === 0 && (
              <div className="analytics-empty">
                <p>No worker summaries available for this session.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default HistoricalSessionsPanel;
