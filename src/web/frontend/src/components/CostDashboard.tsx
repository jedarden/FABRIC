import React, { useState, useEffect, useCallback } from 'react';

// ============================================
// Cost Dashboard Types
// ============================================

interface BudgetStatus {
  limit: number;
  spent: number;
  percentUsed: number;
  isOverBudget: boolean;
  warningLevel: 'none' | 'warning' | 'critical';
  remaining: number;
}

interface BurnRate {
  costPerMinute: number;
  minutesToExhaustion: number | null;
  timeToExhaustion: string | null;
  projectedTotalCost: number;
  windowMinutes: number;
  isHighBurnRate: boolean;
}

interface CostSummary {
  totalCostUsd: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  budget: BudgetStatus;
  burnRate: BurnRate;
  timeRange: { start: number; end: number };
  workerCount: number;
}

interface WorkerCostEntry {
  workerId: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  apiCalls: number;
  currentBead?: string;
  lastActivityTs?: number;
}

interface BeadCostEntry {
  beadId: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  apiCalls: number;
  workerCount: number;
  workers: string[];
  durationMinutes: number;
}

interface TimeSeriesPoint {
  ts: number;
  cost: number;
  apiCalls: number;
  activeWorkers: number;
}

interface BudgetAlert {
  id: string;
  type: 'warning' | 'critical' | 'exhausted';
  message: string;
  timestamp: number;
  spent: number;
  limit: number;
  burnRate: number;
  acknowledged: boolean;
}

// ============================================
// Utility Functions
// ============================================

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${(usd * 100).toFixed(2)}c`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(0)}`;
}

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

function formatBurnRate(rate: number): string {
  if (rate < 0.01) return `$${(rate * 100).toFixed(2)}c/min`;
  return `$${rate.toFixed(2)}/min`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ============================================
// Components
// ============================================

interface BudgetProgressBarProps {
  spent: number;
  limit: number;
  percentUsed: number;
  warningLevel: string;
}

const BudgetProgressBar: React.FC<BudgetProgressBarProps> = ({ spent, limit, percentUsed, warningLevel }) => {
  const getColor = () => {
    if (warningLevel === 'critical') return 'var(--error)';
    if (warningLevel === 'warning') return 'var(--warning)';
    return 'var(--success)';
  };

  return (
    <div className="budget-progress-container">
      <div className="budget-progress-label">
        <span>{formatCost(spent)} / {formatCost(limit)}</span>
        <span>{Math.round(percentUsed)}%</span>
      </div>
      <div className="budget-progress-bar">
        <div
          className="budget-progress-fill"
          style={{
            width: `${Math.min(100, percentUsed)}%`,
            backgroundColor: getColor(),
          }}
        />
      </div>
    </div>
  );
};

interface MiniChartProps {
  data: TimeSeriesPoint[];
  height?: number;
  color?: string;
}

const MiniChart: React.FC<MiniChartProps> = ({ data, height = 60, color = 'var(--accent)' }) => {
  if (data.length < 2) {
    return <div className="mini-chart-empty">No data yet</div>;
  }

  const maxCost = Math.max(...data.map(d => d.cost), 0.001);
  const width = 100;
  const step = width / (data.length - 1);

  const points = data.map((d, i) => {
    const x = i * step;
    const y = height - (d.cost / maxCost) * (height - 4) - 2;
    return `${x},${y}`;
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mini-chart" preserveAspectRatio="none">
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};

interface CostDashboardProps {
  visible: boolean;
  onClose: () => void;
}

const CostDashboard: React.FC<CostDashboardProps> = ({ visible, onClose }) => {
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [workers, setWorkers] = useState<WorkerCostEntry[]>([]);
  const [beads, setBeads] = useState<BeadCostEntry[]>([]);
  const [timeSeries, setTimeSeries] = useState<TimeSeriesPoint[]>([]);
  const [alerts, setAlerts] = useState<BudgetAlert[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'workers' | 'beads' | 'trends'>('overview');
  const [loading, setLoading] = useState(false);

  const fetchCostData = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryRes, workersRes, beadsRes, historyRes, alertsRes] = await Promise.all([
        fetch('/api/cost/summary'),
        fetch('/api/cost/workers'),
        fetch('/api/cost/beads'),
        fetch('/api/cost/history?since=60&bucket=5'),
        fetch('/api/cost/alerts'),
      ]);

      if (summaryRes.ok) setSummary(await summaryRes.json());
      if (workersRes.ok) {
        const data = await workersRes.json();
        setWorkers(data.workers || []);
      }
      if (beadsRes.ok) {
        const data = await beadsRes.json();
        setBeads(data.beads || []);
      }
      if (historyRes.ok) {
        const data = await historyRes.json();
        setTimeSeries(data.timeSeries || []);
      }
      if (alertsRes.ok) {
        const data = await alertsRes.json();
        setAlerts(data.active || []);
      }
    } catch (err) {
      console.error('Failed to fetch cost data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      fetchCostData();
      const interval = setInterval(fetchCostData, 10000);
      return () => clearInterval(interval);
    }
  }, [visible, fetchCostData]);

  const handleAcknowledge = useCallback(async (alertId: string) => {
    try {
      await fetch(`/api/cost/alerts/${alertId}/acknowledge`, { method: 'POST' });
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, acknowledged: true } : a));
    } catch (err) {
      console.error('Failed to acknowledge alert:', err);
    }
  }, []);

  if (!visible) return null;

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'workers' as const, label: 'Workers' },
    { id: 'beads' as const, label: 'Tasks' },
    { id: 'trends' as const, label: 'Trends' },
  ];

  return (
    <div className="cost-dashboard-overlay">
      <div className="cost-dashboard">
        <div className="cost-dashboard-header">
          <h3>Budget Dashboard</h3>
          <div className="cost-dashboard-header-actions">
            {alerts.filter(a => !a.acknowledged).length > 0 && (
              <span className="cost-alert-badge">
                {alerts.filter(a => !a.acknowledged).length} alert{alerts.filter(a => !a.acknowledged).length > 1 ? 's' : ''}
              </span>
            )}
            <button className="close-button" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="cost-dashboard-tabs">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`cost-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="cost-dashboard-content">
          {loading && !summary && (
            <div className="cost-loading">Loading cost data...</div>
          )}

          {activeTab === 'overview' && summary && (
            <div className="cost-overview">
              {/* Session Cost */}
              <div className="cost-card">
                <div className="cost-card-title">Session Cost</div>
                <div className="cost-card-value">{formatCost(summary.totalCostUsd)}</div>
                <div className="cost-card-subtitle">
                  {formatTokens(summary.totalTokens)} tokens ({formatTokens(summary.inputTokens)} in / {formatTokens(summary.outputTokens)} out)
                </div>
                {summary.budget.limit > 0 && (
                  <BudgetProgressBar
                    spent={summary.budget.spent}
                    limit={summary.budget.limit}
                    percentUsed={summary.budget.percentUsed}
                    warningLevel={summary.budget.warningLevel}
                  />
                )}
              </div>

              {/* Burn Rate */}
              <div className="cost-card">
                <div className="cost-card-title">Burn Rate</div>
                <div className={`cost-card-value ${summary.burnRate.isHighBurnRate ? 'cost-high' : ''}`}>
                  {formatBurnRate(summary.burnRate.costPerMinute)}
                </div>
                <div className="cost-card-subtitle">
                  Window: {summary.burnRate.windowMinutes} min avg
                </div>
                {summary.burnRate.timeToExhaustion && (
                  <div className="cost-exhaustion">
                    Time to exhaustion: <strong>{summary.burnRate.timeToExhaustion}</strong>
                  </div>
                )}
                <div className="cost-projected">
                  Projected session total: {formatCost(summary.burnRate.projectedTotalCost)}
                </div>
              </div>

              {/* Alerts */}
              {alerts.filter(a => !a.acknowledged).length > 0 && (
                <div className="cost-card cost-alerts-card">
                  <div className="cost-card-title">Active Alerts</div>
                  {alerts.filter(a => !a.acknowledged).map(alert => (
                    <div key={alert.id} className={`cost-alert-item cost-alert-${alert.type}`}>
                      <div className="cost-alert-header">
                        <span className="cost-alert-type">{alert.type.toUpperCase()}</span>
                        <span className="cost-alert-time">{new Date(alert.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <div className="cost-alert-details">
                        {formatCost(alert.spent)} / {formatCost(alert.limit)} at {formatBurnRate(alert.burnRate)}
                      </div>
                      <button className="cost-alert-ack" onClick={() => handleAcknowledge(alert.id)}>
                        Acknowledge
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Quick Workers Summary */}
              <div className="cost-card">
                <div className="cost-card-title">Top Workers ({summary.workerCount} total)</div>
                {workers.slice(0, 5).map(w => (
                  <div key={w.workerId} className="cost-worker-row">
                    <span className="cost-worker-id">{w.workerId}</span>
                    <span className="cost-worker-cost">{formatCost(w.costUsd)}</span>
                    <span className="cost-worker-tokens">{formatTokens(w.totalTokens)} tok</span>
                  </div>
                ))}
                {workers.length === 0 && <div className="cost-empty">No cost data yet</div>}
              </div>
            </div>
          )}

          {activeTab === 'workers' && (
            <div className="cost-workers-view">
              <table className="cost-table">
                <thead>
                  <tr>
                    <th>Worker</th>
                    <th>Cost</th>
                    <th>Input Tokens</th>
                    <th>Output Tokens</th>
                    <th>Calls</th>
                    <th>Current Task</th>
                  </tr>
                </thead>
                <tbody>
                  {workers.map(w => (
                    <tr key={w.workerId}>
                      <td className="cost-worker-id-cell">{w.workerId}</td>
                      <td className="cost-number">{formatCost(w.costUsd)}</td>
                      <td className="cost-number">{formatTokens(w.inputTokens)}</td>
                      <td className="cost-number">{formatTokens(w.outputTokens)}</td>
                      <td className="cost-number">{w.apiCalls}</td>
                      <td className="cost-bead-cell">{w.currentBead || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {workers.length === 0 && <div className="cost-empty">No worker cost data yet</div>}
            </div>
          )}

          {activeTab === 'beads' && (
            <div className="cost-beads-view">
              <table className="cost-table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Cost</th>
                    <th>Tokens</th>
                    <th>Calls</th>
                    <th>Workers</th>
                    <th>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {beads.map(b => (
                    <tr key={b.beadId}>
                      <td className="cost-bead-id-cell">{b.beadId}</td>
                      <td className="cost-number">{formatCost(b.costUsd)}</td>
                      <td className="cost-number">{formatTokens(b.inputTokens + b.outputTokens)}</td>
                      <td className="cost-number">{b.apiCalls}</td>
                      <td className="cost-number">{b.workerCount}</td>
                      <td className="cost-number">{b.durationMinutes < 1 ? '<1m' : `~${Math.round(b.durationMinutes)}m`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {beads.length === 0 && <div className="cost-empty">No task cost data yet</div>}
            </div>
          )}

          {activeTab === 'trends' && (
            <div className="cost-trends-view">
              <div className="cost-card">
                <div className="cost-card-title">Cost Trend (last 60 min, 5-min buckets)</div>
                <MiniChart data={timeSeries} height={120} />
                <div className="cost-trend-summary">
                  {timeSeries.length > 0 ? (
                    <>
                      <span>Latest: {formatCost(timeSeries[timeSeries.length - 1].cost)}/bucket</span>
                      <span>Peak: {formatCost(Math.max(...timeSeries.map(d => d.cost)))}/bucket</span>
                      <span>Buckets: {timeSeries.length}</span>
                    </>
                  ) : (
                    <span>No trend data yet</span>
                  )}
                </div>
              </div>

              <div className="cost-card">
                <div className="cost-card-title">Cost History</div>
                <div className="cost-trend-list">
                  {timeSeries.slice(-12).reverse().map((point, i) => (
                    <div key={i} className="cost-trend-row">
                      <span className="cost-trend-time">{formatTime(point.ts)}</span>
                      <div className="cost-trend-bar-container">
                        <div
                          className="cost-trend-bar"
                          style={{
                            width: `${Math.min(100, (point.cost / (Math.max(...timeSeries.map(d => d.cost)) || 1)) * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="cost-trend-cost">{formatCost(point.cost)}</span>
                      <span className="cost-trend-workers">{point.activeWorkers}w</span>
                    </div>
                  ))}
                  {timeSeries.length === 0 && <div className="cost-empty">No trend data yet</div>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CostDashboard;
