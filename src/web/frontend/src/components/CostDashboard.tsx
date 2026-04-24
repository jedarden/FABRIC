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
        <div className="budget-threshold-marker" style={{ left: '80%' }} title="Warning (80%)" />
        <div className="budget-threshold-marker budget-threshold-critical" style={{ left: '95%' }} title="Critical (95%)" />
      </div>
      <div className="budget-progress-markers">
        <span className="budget-marker" style={{ left: '80%' }}>80%</span>
        <span className="budget-marker" style={{ left: '95%' }}>95%</span>
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
  const [activeTab, setActiveTab] = useState<'overview' | 'workers' | 'beads' | 'trends' | 'alerts'>('overview');
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
    { id: 'alerts' as const, label: 'Alerts', badge: alerts.filter(a => !a.acknowledged).length || undefined },
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
              {tab.badge && tab.badge > 0 && (
                <span className="cost-tab-badge">{tab.badge}</span>
              )}
            </button>
          ))}
        </div>

        <div className="cost-dashboard-content">
          {loading && !summary && (
            <div className="cost-loading">Loading cost data...</div>
          )}

          {activeTab === 'overview' && summary && (
            <div className="cost-overview">
              {/* Budget Alert Banner (when >= 80%) */}
              {summary.budget.limit > 0 && summary.budget.warningLevel !== 'none' && (
                <div className={`cost-dashboard-alert-banner ${summary.budget.warningLevel === 'critical' || summary.budget.isOverBudget ? 'cost-dashboard-alert-critical' : 'cost-dashboard-alert-warning'}`}>
                  <span className="cost-dashboard-alert-icon">
                    {summary.budget.isOverBudget ? '!!' : summary.budget.warningLevel === 'critical' ? '!!' : '!'}
                  </span>
                  <span className="cost-dashboard-alert-text">
                    {summary.budget.isOverBudget
                      ? `Budget exceeded: ${formatCost(summary.budget.spent)} / ${formatCost(summary.budget.limit)} (${Math.round(summary.budget.percentUsed)}%)`
                      : `${summary.budget.warningLevel === 'critical' ? 'Critical' : 'Warning'}: ${formatCost(summary.budget.spent)} / ${formatCost(summary.budget.limit)} (${Math.round(summary.budget.percentUsed)}% used)`}
                  </span>
                  <span className="cost-dashboard-alert-burn">
                    {formatBurnRate(summary.burnRate.costPerMinute)}
                    {summary.burnRate.timeToExhaustion && ` | ETA: ${summary.burnRate.timeToExhaustion}`}
                  </span>
                  <div className="cost-dashboard-alert-bar">
                    <div
                      className="cost-dashboard-alert-bar-fill"
                      style={{ width: `${Math.min(100, summary.budget.percentUsed)}%` }}
                    />
                  </div>
                </div>
              )}

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

              {/* Burn Rate & ETA */}
              <div className="cost-card">
                <div className="cost-card-title">Burn Rate & ETA</div>
                <div className="budget-alert-summary-row">
                  <div className="budget-alert-stat">
                    <span className="budget-alert-stat-label">Rate</span>
                    <span className={`budget-alert-stat-value ${summary.burnRate.isHighBurnRate ? 'cost-high' : ''}`}>
                      {formatBurnRate(summary.burnRate.costPerMinute)}
                    </span>
                  </div>
                  <div className="budget-alert-stat">
                    <span className="budget-alert-stat-label">ETA to Exhaust</span>
                    <span className="budget-alert-stat-value">
                      {summary.burnRate.timeToExhaustion || 'N/A'}
                    </span>
                  </div>
                  <div className="budget-alert-stat">
                    <span className="budget-alert-stat-label">Projected Total</span>
                    <span className="budget-alert-stat-value">{formatCost(summary.burnRate.projectedTotalCost)}</span>
                  </div>
                </div>
                {summary.burnRate.isHighBurnRate && (
                  <div className="budget-burn-warning">High burn rate detected</div>
                )}
              </div>

              {/* Top Consumers */}
              <div className="cost-card">
                <div className="cost-card-title">Top Consumers ({summary.workerCount} workers)</div>
                <div className="budget-consumers-list">
                  {workers.slice(0, 10).length === 0 && (
                    <div className="cost-empty">No cost data yet</div>
                  )}
                  {workers.slice(0, 10).map(w => (
                    <div key={w.workerId} className="budget-consumer-row">
                      <div className="budget-consumer-info">
                        <span className="budget-consumer-id">{w.workerId}</span>
                        {w.currentBead && <span className="budget-consumer-bead">{w.currentBead}</span>}
                      </div>
                      <div className="budget-consumer-bar-container">
                        <div
                          className="budget-consumer-bar"
                          style={{ width: `${(w.costUsd / (Math.max(...workers.slice(0, 10).map(wc => wc.costUsd)) || 0.001)) * 100}%` }}
                        />
                      </div>
                      <span className="budget-consumer-cost">{formatCost(w.costUsd)}</span>
                      <span className="budget-consumer-tokens">{formatTokens(w.totalTokens)} tok | {w.apiCalls} calls</span>
                    </div>
                  ))}
                </div>
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

          {activeTab === 'alerts' && summary && (
            <div className="cost-alerts-view">
              {/* Budget Status */}
              {summary.budget.limit > 0 && (
                <div className="cost-card">
                  <div className="cost-card-title">Budget Status</div>
                  <div className="budget-alert-summary-row">
                    <div className="budget-alert-stat">
                      <span className="budget-alert-stat-label">Spent</span>
                      <span className={`budget-alert-stat-value ${summary.budget.warningLevel === 'critical' || summary.budget.isOverBudget ? 'cost-high' : summary.budget.warningLevel === 'warning' ? 'cost-warn' : ''}`}>
                        {formatCost(summary.budget.spent)}
                      </span>
                    </div>
                    <div className="budget-alert-stat">
                      <span className="budget-alert-stat-label">Limit</span>
                      <span className="budget-alert-stat-value">{formatCost(summary.budget.limit)}</span>
                    </div>
                    <div className="budget-alert-stat">
                      <span className="budget-alert-stat-label">Remaining</span>
                      <span className="budget-alert-stat-value">{formatCost(Math.max(0, summary.budget.remaining))}</span>
                    </div>
                    <div className="budget-alert-stat">
                      <span className="budget-alert-stat-label">Usage</span>
                      <span className={`budget-alert-stat-value ${summary.budget.warningLevel === 'critical' || summary.budget.isOverBudget ? 'cost-high' : summary.budget.warningLevel === 'warning' ? 'cost-warn' : ''}`}>
                        {Math.round(summary.budget.percentUsed)}%
                      </span>
                    </div>
                  </div>
                  <BudgetProgressBar
                    spent={summary.budget.spent}
                    limit={summary.budget.limit}
                    percentUsed={summary.budget.percentUsed}
                    warningLevel={summary.budget.warningLevel}
                  />
                </div>
              )}

              {/* Burn Rate & ETA */}
              <div className="cost-card">
                <div className="cost-card-title">Burn Rate & ETA</div>
                <div className="budget-alert-summary-row">
                  <div className="budget-alert-stat">
                    <span className="budget-alert-stat-label">Rate</span>
                    <span className={`budget-alert-stat-value ${summary.burnRate.isHighBurnRate ? 'cost-high' : ''}`}>
                      {formatBurnRate(summary.burnRate.costPerMinute)}
                    </span>
                  </div>
                  <div className="budget-alert-stat">
                    <span className="budget-alert-stat-label">ETA to Exhaust</span>
                    <span className="budget-alert-stat-value">
                      {summary.burnRate.timeToExhaustion || 'N/A'}
                    </span>
                  </div>
                  <div className="budget-alert-stat">
                    <span className="budget-alert-stat-label">Projected Total</span>
                    <span className="budget-alert-stat-value">{formatCost(summary.burnRate.projectedTotalCost)}</span>
                  </div>
                </div>
                {summary.burnRate.isHighBurnRate && (
                  <div className="budget-burn-warning">High burn rate detected</div>
                )}
              </div>

              {/* Active Alerts */}
              {alerts.length > 0 ? (
                <div className="cost-card cost-alerts-card">
                  <div className="cost-card-title">Alerts ({alerts.filter(a => !a.acknowledged).length} active)</div>
                  {alerts.map(alert => (
                    <div key={alert.id} className={`cost-alert-item cost-alert-${alert.type}${alert.acknowledged ? ' cost-alert-acked' : ''}`}>
                      <div className="cost-alert-header">
                        <span className="cost-alert-type">{alert.type.toUpperCase()}</span>
                        <span className="cost-alert-time">{new Date(alert.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <div className="cost-alert-details">
                        {formatCost(alert.spent)} / {formatCost(alert.limit)} at {formatBurnRate(alert.burnRate)}
                      </div>
                      {!alert.acknowledged && (
                        <button className="cost-alert-ack" onClick={() => handleAcknowledge(alert.id)}>
                          Acknowledge
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="cost-card">
                  <div className="cost-card-title">Alerts</div>
                  <div className="cost-empty">No budget alerts</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CostDashboard;
