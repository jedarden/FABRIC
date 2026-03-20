import React, { useState, useEffect, useCallback } from 'react';

// ============================================
// Types (mirror backend FleetAnalytics)
// ============================================

interface DurationBucket {
  label: string;
  range: string;
  count: number;
}

interface ModelMetrics {
  model: string;
  beadsCompleted: number;
  avgDurationMs: number;
  medianDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  durationBuckets: DurationBucket[];
  shallowCount: number;
  shallowPercent: number;
}

interface StrandMetrics {
  strand: string;
  invocations: number;
  successCount: number;
  failCount: number;
  successRate: number;
  totalDurationMs: number;
  avgDurationMs: number;
}

interface ShallowCompletion {
  beadId: string;
  worker: string;
  model: string;
  durationMs: number;
  timestamp: number;
  session: string;
}

interface FleetTimePoint {
  hour: string;
  activeWorkers: number;
  beadsCompleted: number;
  timestamp: number;
}

interface WorkspaceEntry {
  workspace: string;
  workerCount: number;
  beadCount: number;
}

interface ClaimRace {
  beadId: string;
  workers: string[];
  claimCount: number;
}

interface FleetAnalytics {
  periodStart: number;
  periodEnd: number;
  totalEvents: number;
  logFiles: string[];
  modelMetrics: ModelMetrics[];
  strandMetrics: StrandMetrics[];
  shallowCompletions: ShallowCompletion[];
  totalCompletions: number;
  shallowPercent: number;
  claimRaces: ClaimRace[];
  fleetTimeSeries: FleetTimePoint[];
  workerRelaunchCount: number;
  workspaceCoverage: WorkspaceEntry[];
  beadsPerHour: number;
}

interface AnalyticsDashboardProps {
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

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString();
}

function formatHour(isoHour: string): string {
  const d = new Date(isoHour);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:00`;
}

// ============================================
// Sparkline Component (pure CSS, no library)
// ============================================

const Sparkline: React.FC<{ values: number[]; width?: number; height?: number; color?: string; label?: string }> = ({
  values,
  width = 120,
  height = 30,
  color = 'var(--accent-color, #6366f1)',
  label,
}) => {
  if (values.length === 0) return <span className="sparkline-empty">no data</span>;

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1 || 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  const areaPoints = `0,${height} ${points} ${width},${height}`;

  return (
    <span className="sparkline" title={label || `${values.length} points`}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <polygon points={areaPoints} fill={color} opacity="0.15" />
        <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
      </svg>
    </span>
  );
};

// ============================================
// Duration Histogram Bar
// ============================================

const DurationHistogram: React.FC<{ buckets: DurationBucket[]; total: number }> = ({ buckets, total }) => {
  const maxCount = Math.max(...buckets.map(b => b.count), 1);
  return (
    <div className="duration-histogram">
      {buckets.map((b) => (
        <div key={b.range} className="duration-bar-row">
          <span className="duration-bar-label">{b.range}</span>
          <div className="duration-bar-track">
            <div
              className="duration-bar-fill"
              style={{ width: `${(b.count / maxCount) * 100}%` }}
              title={`${b.count} beads (${total > 0 ? Math.round((b.count / total) * 100) : 0}%)`}
            />
          </div>
          <span className="duration-bar-count">{b.count}</span>
        </div>
      ))}
    </div>
  );
};

// ============================================
// Section Component
// ============================================

const Section: React.FC<{ title: string; children: React.ReactNode; className?: string }> = ({ title, children, className }) => (
  <div className={`analytics-section ${className || ''}`}>
    <h3 className="analytics-section-title">{title}</h3>
    <div className="analytics-section-body">{children}</div>
  </div>
);

// ============================================
// Main Component
// ============================================

const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({ visible, onClose }) => {
  const [analytics, setAnalytics] = useState<FleetAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'models' | 'strands' | 'quality' | 'fleet'>('models');

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/analytics');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: FleetAnalytics = await res.json();
      setAnalytics(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) fetchAnalytics();
  }, [visible, fetchAnalytics]);

  if (!visible) return null;

  return (
    <div className="analytics-panel">
      <div className="analytics-header">
        <h3>
          Fleet Analytics
          {analytics && (
            <span className="analytics-subtitle">
              {analytics.totalEvents.toLocaleString()} events | {analytics.totalCompletions} beads | {analytics.logFiles.length} logs
            </span>
          )}
        </h3>
        <div className="analytics-header-actions">
          <button className="analytics-refresh" onClick={fetchAnalytics} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button className="close-button" onClick={onClose}>x</button>
        </div>
      </div>

      {error && <div className="analytics-error">{error}</div>}

      {analytics && (
        <>
          {/* Summary Stats */}
          <div className="analytics-summary">
            <div className="analytics-stat">
              <span className="analytics-stat-value">{analytics.beadsPerHour}</span>
              <span className="analytics-stat-label">Beads/Hour</span>
            </div>
            <div className="analytics-stat">
              <span className="analytics-stat-value">{analytics.totalCompletions}</span>
              <span className="analytics-stat-label">Beads Done</span>
            </div>
            <div className="analytics-stat">
              <span className="analytics-stat-value analytics-stat-warning">{analytics.shallowPercent}%</span>
              <span className="analytics-stat-label">Shallow (&lt;10s)</span>
            </div>
            <div className="analytics-stat">
              <span className="analytics-stat-value">{analytics.workerRelaunchCount}</span>
              <span className="analytics-stat-label">Relaunches</span>
            </div>
            <div className="analytics-stat">
              <span className="analytics-stat-value">{analytics.workspaceCoverage.length}</span>
              <span className="analytics-stat-label">Workspaces</span>
            </div>
            <div className="analytics-stat">
              <span className="analytics-stat-value">{analytics.claimRaces.length}</span>
              <span className="analytics-stat-label">Claim Races</span>
            </div>
          </div>

          {/* Tabs */}
          <div className="analytics-tabs">
            <button className={`analytics-tab ${activeTab === 'models' ? 'active' : ''}`} onClick={() => setActiveTab('models')}>
              Models
            </button>
            <button className={`analytics-tab ${activeTab === 'strands' ? 'active' : ''}`} onClick={() => setActiveTab('strands')}>
              Strands
            </button>
            <button className={`analytics-tab ${activeTab === 'quality' ? 'active' : ''}`} onClick={() => setActiveTab('quality')}>
              Quality
            </button>
            <button className={`analytics-tab ${activeTab === 'fleet' ? 'active' : ''}`} onClick={() => setActiveTab('fleet')}>
              Fleet
            </button>
          </div>

          {/* Tab Content */}
          <div className="analytics-content">
            {activeTab === 'models' && (
              <>
                {analytics.modelMetrics.length === 0 ? (
                  <div className="analytics-empty">No bead completions found.</div>
                ) : (
                  analytics.modelMetrics.map(model => (
                    <Section key={model.model} title={model.model} className="analytics-model-section">
                      <div className="analytics-model-stats">
                        <div className="analytics-model-stat">
                          <span className="analytics-model-stat-value">{model.beadsCompleted}</span>
                          <span className="analytics-model-stat-label">Beads</span>
                        </div>
                        <div className="analytics-model-stat">
                          <span className="analytics-model-stat-value">{formatDuration(model.avgDurationMs)}</span>
                          <span className="analytics-model-stat-label">Avg Duration</span>
                        </div>
                        <div className="analytics-model-stat">
                          <span className="analytics-model-stat-value">{formatDuration(model.medianDurationMs)}</span>
                          <span className="analytics-model-stat-label">Median</span>
                        </div>
                        <div className="analytics-model-stat">
                          <span className="analytics-model-stat-value analytics-stat-warning">{model.shallowPercent}%</span>
                          <span className="analytics-model-stat-label">Shallow</span>
                        </div>
                        <div className="analytics-model-stat">
                          <span className="analytics-model-stat-value">{formatDuration(model.minDurationMs)}</span>
                          <span className="analytics-model-stat-label">Min</span>
                        </div>
                        <div className="analytics-model-stat">
                          <span className="analytics-model-stat-value">{formatDuration(model.maxDurationMs)}</span>
                          <span className="analytics-model-stat-label">Max</span>
                        </div>
                      </div>
                      <div className="analytics-histogram-container">
                        <span className="analytics-histogram-title">Duration Distribution</span>
                        <DurationHistogram buckets={model.durationBuckets} total={model.beadsCompleted} />
                      </div>
                    </Section>
                  ))
                )}
              </>
            )}

            {activeTab === 'strands' && (
              <>
                {analytics.strandMetrics.length === 0 ? (
                  <div className="analytics-empty">No strand events found.</div>
                ) : (
                  <div className="analytics-strand-table-wrapper">
                    <table className="analytics-strand-table">
                      <thead>
                        <tr>
                          <th>Strand</th>
                          <th>Invocations</th>
                          <th>Success</th>
                          <th>Fail</th>
                          <th>Success Rate</th>
                          <th>Avg Duration</th>
                          <th>Total Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.strandMetrics.map(s => (
                          <tr key={s.strand}>
                            <td className="analytics-strand-name">{s.strand}</td>
                            <td>{s.invocations}</td>
                            <td>{s.successCount}</td>
                            <td>{s.failCount}</td>
                            <td>
                              <span className={`analytics-rate ${s.successRate >= 80 ? 'rate-good' : s.successRate >= 50 ? 'rate-warn' : 'rate-bad'}`}>
                                {s.successRate}%
                              </span>
                            </td>
                            <td>{s.avgDurationMs > 0 ? formatDuration(s.avgDurationMs) : '-'}</td>
                            <td>{s.totalDurationMs > 0 ? formatDuration(s.totalDurationMs) : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {activeTab === 'quality' && (
              <>
                {/* Shallow Completions */}
                <Section title={`Suspicious Shallow Completions (${analytics.shallowCompletions.length})`} className="analytics-quality-section">
                  {analytics.shallowCompletions.length === 0 ? (
                    <div className="analytics-empty">No shallow completions detected.</div>
                  ) : (
                    <>
                      <div className="analytics-shallow-summary">
                        {analytics.shallowPercent}% of all completions were under 10 seconds.
                      </div>
                      <div className="analytics-shallow-list">
                        {analytics.shallowCompletions.slice(0, 50).map(sc => (
                          <div key={`${sc.beadId}-${sc.worker}-${sc.timestamp}`} className="analytics-shallow-item">
                            <span className="analytics-shallow-bead">{sc.beadId}</span>
                            <span className="analytics-shallow-worker">{sc.worker}</span>
                            <span className="analytics-shallow-model">{sc.model}</span>
                            <span className="analytics-shallow-duration">{formatDuration(sc.durationMs)}</span>
                            <span className="analytics-shallow-time">{formatTime(sc.timestamp)}</span>
                          </div>
                        ))}
                        {analytics.shallowCompletions.length > 50 && (
                          <div className="analytics-shallow-more">
                            ... and {analytics.shallowCompletions.length - 50} more
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </Section>

                {/* Claim Races */}
                <Section title={`Claim Races (${analytics.claimRaces.length})`}>
                  {analytics.claimRaces.length === 0 ? (
                    <div className="analytics-empty">No claim races detected.</div>
                  ) : (
                    <div className="analytics-shallow-list">
                      {analytics.claimRaces.slice(0, 30).map(cr => (
                        <div key={cr.beadId} className="analytics-shallow-item">
                          <span className="analytics-shallow-bead">{cr.beadId}</span>
                          <span className="analytics-shallow-workers">
                            {cr.workers.join(', ')}
                          </span>
                          <span className="analytics-shallow-claims">{cr.claimCount} claims</span>
                        </div>
                      ))}
                      {analytics.claimRaces.length > 30 && (
                        <div className="analytics-shallow-more">
                          ... and {analytics.claimRaces.length - 30} more
                        </div>
                      )}
                    </div>
                  )}
                </Section>
              </>
            )}

            {activeTab === 'fleet' && (
              <>
                {/* Fleet Time Series */}
                <Section title="Worker Activity Over Time">
                  {analytics.fleetTimeSeries.length === 0 ? (
                    <div className="analytics-empty">No time series data.</div>
                  ) : (
                    <>
                      <div className="analytics-fleet-sparklines">
                        <div className="analytics-sparkline-row">
                          <span className="analytics-sparkline-label">Active Workers</span>
                          <Sparkline
                            values={analytics.fleetTimeSeries.map(p => p.activeWorkers)}
                            color="var(--success-color, #22c55e)"
                            label="Active workers over time"
                          />
                        </div>
                        <div className="analytics-sparkline-row">
                          <span className="analytics-sparkline-label">Beads Completed</span>
                          <Sparkline
                            values={analytics.fleetTimeSeries.map(p => p.beadsCompleted)}
                            color="var(--accent-color, #6366f1)"
                            label="Beads completed per hour"
                          />
                        </div>
                      </div>
                      <div className="analytics-fleet-table-wrapper">
                        <table className="analytics-strand-table">
                          <thead>
                            <tr>
                              <th>Hour</th>
                              <th>Active Workers</th>
                              <th>Beads Completed</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...analytics.fleetTimeSeries].reverse().map(p => (
                              <tr key={p.hour}>
                                <td>{formatHour(p.hour)}</td>
                                <td>{p.activeWorkers}</td>
                                <td>{p.beadsCompleted}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </Section>

                {/* Workspace Coverage */}
                <Section title={`Workspace Coverage (${analytics.workspaceCoverage.length} workspaces)`}>
                  {analytics.workspaceCoverage.length === 0 ? (
                    <div className="analytics-empty">No workspace data.</div>
                  ) : (
                    <div className="analytics-shallow-list">
                      {analytics.workspaceCoverage.slice(0, 30).map(ws => (
                        <div key={ws.workspace} className="analytics-shallow-item">
                          <span className="analytics-shallow-bead">{ws.workspace}</span>
                          <span className="analytics-shallow-workers">{ws.workerCount} workers</span>
                          <span className="analytics-shallow-claims">{ws.beadCount} beads</span>
                        </div>
                      ))}
                      {analytics.workspaceCoverage.length > 30 && (
                        <div className="analytics-shallow-more">
                          ... and {analytics.workspaceCoverage.length - 30} more
                        </div>
                      )}
                    </div>
                  )}
                </Section>

                {/* Period Info */}
                <Section title="Period Info">
                  <div className="analytics-period-info">
                    <div><strong>Start:</strong> {formatTime(analytics.periodStart)}</div>
                    <div><strong>End:</strong> {formatTime(analytics.periodEnd)}</div>
                    <div><strong>Duration:</strong> {formatDuration(analytics.periodEnd - analytics.periodStart)}</div>
                    <div><strong>Total Events:</strong> {analytics.totalEvents.toLocaleString()}</div>
                    <div><strong>Log Files:</strong> {analytics.logFiles.length}</div>
                    <div><strong>Worker Relaunches:</strong> {analytics.workerRelaunchCount}</div>
                  </div>
                </Section>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default AnalyticsDashboard;
