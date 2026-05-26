import React, { useState, useEffect, useCallback } from 'react';

// ============================================
// Types (mirror backend types)
// ============================================

interface WorkerMetrics {
  workerId: string;
  periodStart: number;
  periodEnd: number;
  beadsCompleted: number;
  beadsPerHour: number;
  avgCompletionTimeMs: number;
  errorCount: number;
  errorRate: number;
  totalCostUsd: number;
  costPerBead: number;
  activeTimeMs: number;
  idleTimeMs: number;
  idlePercentage: number;
  totalEvents: number;
  totalTokens: number;
  tokensPerBead: number;
  efficiencyScore: number;
}

interface WorkerComparison {
  worker1: WorkerMetrics;
  worker2: WorkerMetrics;
  differences: {
    beadsCompleted: number;
    beadsPerHour: number;
    avgCompletionTimeMs: number;
    errorRate: number;
    costPerBead: number;
    efficiencyScore: number;
  };
  percentDifferences: {
    beadsCompleted: number;
    beadsPerHour: number;
    avgCompletionTimeMs: number;
    errorRate: number;
    costPerBead: number;
    efficiencyScore: number;
  };
  betterWorker: {
    beadsCompleted: 'worker1' | 'worker2' | 'tie';
    beadsPerHour: 'worker1' | 'worker2' | 'tie';
    avgCompletionTimeMs: 'worker1' | 'worker2' | 'tie';
    errorRate: 'worker1' | 'worker2' | 'tie';
    costPerBead: 'worker1' | 'worker2' | 'tie';
    efficiencyScore: 'worker1' | 'worker2' | 'tie';
  };
  overallWinner: 'worker1' | 'worker2' | 'tie';
  score: {
    worker1: number;
    worker2: number;
  };
}

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

interface WorkerAnalyticsPanelProps {
  visible: boolean;
  onClose: () => void;
}

// ============================================
// Utility Functions
// ============================================

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${(usd * 100).toFixed(2)}c`;
  return `$${usd.toFixed(2)}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

// ============================================
// Comparison Row Component
// ============================================

const ComparisonRow: React.FC<{
  label: string;
  value1: string | number;
  value2: string | number;
  diff: number;
  percentDiff: number;
  better: 'worker1' | 'worker2' | 'tie';
  lowerIsBetter: boolean;
}> = ({ label, value1, value2, diff, percentDiff, better, lowerIsBetter }) => {
  const v1Str = String(value1);
  const v2Str = String(value2);

  const formatDiffValue = (d: number, pd: number): { diff: string; percent: string; color: string } => {
    if (Math.abs(d) < 0.001 && Math.abs(pd) < 0.1) {
      return { diff: '0', percent: '0.0%', color: 'text-gray-500' };
    }
    const sign = d > 0 ? '+' : '';
    const color = (lowerIsBetter ? d < 0 : d > 0) ? 'text-green-600' : 'text-red-600';
    return {
      diff: `${sign}${d.toFixed(2)}`,
      percent: `${sign}${pd.toFixed(1)}%`,
      color,
    };
  };

  const { diff: diffStr, percent, color } = formatDiffValue(diff, percentDiff);
  const winner = better === 'worker1' ? '←' : better === 'worker2' ? '→' : '=';

  return (
    <tr className="comparison-row">
      <td className="comparison-label">{label}</td>
      <td className="comparison-value">{v1Str}</td>
      <td className="comparison-value">{v2Str}</td>
      <td className={`comparison-diff ${color}`}>{diffStr}</td>
      <td className={`comparison-percent ${color}`}>{percent}</td>
      <td className="comparison-winner">{winner}</td>
    </tr>
  );
};

// ============================================
// Worker Leaderboard Table Component
// ============================================

const WorkerLeaderboard: React.FC<{ workers: WorkerMetrics[]; onSelectWorker: (workerId: string) => void }> = ({ workers, onSelectWorker }) => {
  const [sortBy, setSortBy] = useState<keyof WorkerMetrics>('beadsCompleted');
  const [sortAsc, setSortAsc] = useState(false);

  const sortedWorkers = [...workers].sort((a, b) => {
    const aVal = a[sortBy];
    const bVal = b[sortBy];
    const lowerIsBetter = ['errorRate', 'costPerBead', 'avgCompletionTimeMs', 'idlePercentage'].includes(sortBy);
    const comparison = typeof aVal === 'number' && typeof bVal === 'number'
      ? (lowerIsBetter ? aVal - bVal : bVal - aVal)
      : String(aVal).localeCompare(String(bVal));
    return sortAsc ? (comparison > 0 ? 1 : -1) : (comparison > 0 ? -1 : 1);
  });

  const handleSort = (key: keyof WorkerMetrics) => {
    if (sortBy === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(key);
      setSortAsc(false);
    }
  };

  const formatCellValue = (key: keyof WorkerMetrics, value: any): string => {
    if (key === 'avgCompletionTimeMs') return formatDuration(value);
    if (key === 'totalCostUsd' || key === 'costPerBead') return formatCost(value);
    if (key === 'errorRate' || key === 'efficiencyScore' || key === 'idlePercentage') return formatPercent(value);
    if (key === 'beadsPerHour') return value.toFixed(2);
    if (key === 'tokensPerBead') return value.toFixed(0);
    return String(value);
  };

  const columns: { key: keyof WorkerMetrics; label: string; className?: string }[] = [
    { key: 'workerId', label: 'Worker' },
    { key: 'beadsCompleted', label: 'Beads' },
    { key: 'beadsPerHour', label: 'Beads/Hr' },
    { key: 'avgCompletionTimeMs', label: 'Avg Time' },
    { key: 'errorRate', label: 'Error Rate' },
    { key: 'costPerBead', label: 'Cost/Bead' },
    { key: 'efficiencyScore', label: 'Efficiency' },
  ];

  return (
    <div className="worker-leaderboard">
      <table className="leaderboard-table">
        <thead>
          <tr>
            {columns.map(col => (
              <th
                key={String(col.key)}
                onClick={() => handleSort(col.key)}
                className={sortBy === col.key ? `sorted ${sortAsc ? 'asc' : 'desc'}` : ''}
              >
                {col.label}
                {sortBy === col.key && <span className="sort-indicator">{sortAsc ? ' ↑' : ' ↓'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedWorkers.map(worker => (
            <tr
              key={worker.workerId}
              onClick={() => onSelectWorker(worker.workerId)}
              className="worker-row"
            >
              {columns.map(col => (
                <td key={String(col.key)} className={col.className || ''}>
                  {formatCellValue(col.key, worker[col.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ============================================
// Historical Sessions List Component
// ============================================

const HistoricalSessions: React.FC<{ sessions: SessionRecord[] }> = ({ sessions }) => {
  if (sessions.length === 0) {
    return <div className="no-sessions">No historical sessions available</div>;
  }

  return (
    <div className="historical-sessions">
      <table className="sessions-table">
        <thead>
          <tr>
            <th>Session ID</th>
            <th>Started</th>
            <th>Duration</th>
            <th>Workers</th>
            <th>Tasks</th>
            <th>Cost</th>
            <th>Tokens</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map(session => {
            const duration = session.ended_at - session.started_at;
            return (
              <tr key={session.id}>
                <td className="session-id">{session.id.slice(0, 20)}...</td>
                <td>{formatTimestamp(session.started_at)}</td>
                <td>{formatDuration(duration)}</td>
                <td>{session.worker_count}</td>
                <td>{session.task_count}</td>
                <td>{formatCost(session.total_cost)}</td>
                <td>{session.total_tokens.toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// ============================================
// Main Component
// ============================================

const WorkerAnalyticsPanel: React.FC<WorkerAnalyticsPanelProps> = ({ visible, onClose }) => {
  const [activeTab, setActiveTab] = useState<'leaderboard' | 'comparison' | 'sessions'>('leaderboard');
  const [workers, setWorkers] = useState<WorkerMetrics[]>([]);
  const [comparison, setComparison] = useState<WorkerComparison | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selectedWorker1, setSelectedWorker1] = useState<string>('');
  const [selectedWorker2, setSelectedWorker2] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWorkers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/analytics/workers?limit=50&sortBy=beadsCompleted');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setWorkers(data.workers || []);
      // Auto-select first two workers for comparison
      if (data.workers && data.workers.length >= 2 && !selectedWorker1) {
        setSelectedWorker1(data.workers[0].workerId);
        setSelectedWorker2(data.workers[1].workerId);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedWorker1]);

  const fetchComparison = useCallback(async () => {
    if (!selectedWorker1 || !selectedWorker2) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/workers/compare?worker1=${encodeURIComponent(selectedWorker1)}&worker2=${encodeURIComponent(selectedWorker2)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: WorkerComparison = await res.json();
      setComparison(data);
    } catch (err) {
      setError(String(err));
      setComparison(null);
    } finally {
      setLoading(false);
    }
  }, [selectedWorker1, selectedWorker2]);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/analytics/sessions?limit=50');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch data when tab changes
  useEffect(() => {
    if (!visible) return;
    if (activeTab === 'leaderboard' && workers.length === 0) {
      fetchWorkers();
    } else if (activeTab === 'comparison') {
      if (workers.length === 0) fetchWorkers();
      else fetchComparison();
    } else if (activeTab === 'sessions' && sessions.length === 0) {
      fetchSessions();
    }
  }, [visible, activeTab, fetchWorkers, fetchComparison, fetchSessions, workers.length, sessions.length]);

  // Handle worker selection in leaderboard
  const handleSelectWorker = useCallback((workerId: string) => {
    if (!selectedWorker1) {
      setSelectedWorker1(workerId);
    } else if (!selectedWorker2 && workerId !== selectedWorker1) {
      setSelectedWorker2(workerId);
    } else {
      // Both selected, swap to comparison tab
      if (workerId !== selectedWorker1) {
        setSelectedWorker2(workerId);
      }
      setActiveTab('comparison');
    }
  }, [selectedWorker1, selectedWorker2]);

  if (!visible) return null;

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="panel-content worker-analytics-panel" onClick={e => e.stopPropagation()}>
        <div className="panel-header">
          <h2>Worker Analytics</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="panel-tabs">
          <button
            className={`tab-button ${activeTab === 'leaderboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('leaderboard')}
          >
            Leaderboard
          </button>
          <button
            className={`tab-button ${activeTab === 'comparison' ? 'active' : ''}`}
            onClick={() => setActiveTab('comparison')}
          >
            Compare Workers
          </button>
          <button
            className={`tab-button ${activeTab === 'sessions' ? 'active' : ''}`}
            onClick={() => setActiveTab('sessions')}
          >
            Historical Sessions
          </button>
        </div>

        <div className="panel-body">
          {error && (
            <div className="error-message">
              {error}
              <button onClick={() => { setError(null); }}>Dismiss</button>
            </div>
          )}

          {loading && <div className="loading-indicator">Loading...</div>}

          {activeTab === 'leaderboard' && !loading && (
            <WorkerLeaderboard
              workers={workers}
              onSelectWorker={handleSelectWorker}
            />
          )}

          {activeTab === 'comparison' && (
            <div className="comparison-view">
              <div className="worker-selectors">
                <div className="worker-selector">
                  <label>Worker 1:</label>
                  <select
                    value={selectedWorker1}
                    onChange={e => setSelectedWorker1(e.target.value)}
                  >
                    <option value="">Select worker...</option>
                    {workers.map(w => (
                      <option key={w.workerId} value={w.workerId}>{w.workerId}</option>
                    ))}
                  </select>
                </div>
                <div className="worker-selector">
                  <label>Worker 2:</label>
                  <select
                    value={selectedWorker2}
                    onChange={e => setSelectedWorker2(e.target.value)}
                  >
                    <option value="">Select worker...</option>
                    {workers.map(w => (
                      <option key={w.workerId} value={w.workerId}>{w.workerId}</option>
                    ))}
                  </select>
                </div>
              </div>

              {comparison && !loading && (
                <div className="comparison-results">
                  <h3>Comparison Results</h3>

                  <div className="comparison-header">
                    <div className={`worker-card ${comparison.overallWinner === 'worker1' ? 'winner' : ''}`}>
                      <h4>Worker 1</h4>
                      <p className="worker-id">{comparison.worker1.workerId}</p>
                    </div>
                    <div className="vs-badge">VS</div>
                    <div className={`worker-card ${comparison.overallWinner === 'worker2' ? 'winner' : ''}`}>
                      <h4>Worker 2</h4>
                      <p className="worker-id">{comparison.worker2.workerId}</p>
                    </div>
                  </div>

                  <table className="comparison-table">
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th>Worker 1</th>
                        <th>Worker 2</th>
                        <th>Diff</th>
                        <th>%</th>
                        <th>Winner</th>
                      </tr>
                    </thead>
                    <tbody>
                      <ComparisonRow
                        label="Beads Completed"
                        value1={comparison.worker1.beadsCompleted}
                        value2={comparison.worker2.beadsCompleted}
                        diff={comparison.differences.beadsCompleted}
                        percentDiff={comparison.percentDifferences.beadsCompleted}
                        better={comparison.betterWorker.beadsCompleted}
                        lowerIsBetter={false}
                      />
                      <ComparisonRow
                        label="Beads/Hour"
                        value1={comparison.worker1.beadsPerHour.toFixed(2)}
                        value2={comparison.worker2.beadsPerHour.toFixed(2)}
                        diff={comparison.differences.beadsPerHour}
                        percentDiff={comparison.percentDifferences.beadsPerHour}
                        better={comparison.betterWorker.beadsPerHour}
                        lowerIsBetter={false}
                      />
                      <ComparisonRow
                        label="Avg Completion"
                        value1={formatDuration(comparison.worker1.avgCompletionTimeMs)}
                        value2={formatDuration(comparison.worker2.avgCompletionTimeMs)}
                        diff={comparison.differences.avgCompletionTimeMs}
                        percentDiff={comparison.percentDifferences.avgCompletionTimeMs}
                        better={comparison.betterWorker.avgCompletionTimeMs}
                        lowerIsBetter={true}
                      />
                      <ComparisonRow
                        label="Error Rate"
                        value1={formatPercent(comparison.worker1.errorRate)}
                        value2={formatPercent(comparison.worker2.errorRate)}
                        diff={comparison.differences.errorRate}
                        percentDiff={comparison.percentDifferences.errorRate}
                        better={comparison.betterWorker.errorRate}
                        lowerIsBetter={true}
                      />
                      <ComparisonRow
                        label="Cost Per Bead"
                        value1={formatCost(comparison.worker1.costPerBead)}
                        value2={formatCost(comparison.worker2.costPerBead)}
                        diff={comparison.differences.costPerBead}
                        percentDiff={comparison.percentDifferences.costPerBead}
                        better={comparison.betterWorker.costPerBead}
                        lowerIsBetter={true}
                      />
                      <ComparisonRow
                        label="Efficiency"
                        value1={formatPercent(comparison.worker1.efficiencyScore)}
                        value2={formatPercent(comparison.worker2.efficiencyScore)}
                        diff={comparison.differences.efficiencyScore}
                        percentDiff={comparison.percentDifferences.efficiencyScore}
                        better={comparison.betterWorker.efficiencyScore}
                        lowerIsBetter={false}
                      />
                    </tbody>
                  </table>

                  <div className="comparison-summary">
                    <p>Score: Worker 1 won <strong>{comparison.score.worker1}</strong> metrics, Worker 2 won <strong>{comparison.score.worker2}</strong> metrics.</p>
                    <p className="overall-winner">
                      Overall: {comparison.overallWinner === 'worker1'
                        ? 'Worker 1 wins!'
                        : comparison.overallWinner === 'worker2'
                        ? 'Worker 2 wins!'
                        : 'It\'s a tie!'}
                    </p>
                  </div>
                </div>
              )}

              {!comparison && !loading && selectedWorker1 && selectedWorker2 && (
                <div className="no-comparison">
                  <p>Click "Compare" to see the comparison</p>
                  <button onClick={fetchComparison}>Compare</button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'sessions' && !loading && (
            <HistoricalSessions sessions={sessions} />
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkerAnalyticsPanel;
