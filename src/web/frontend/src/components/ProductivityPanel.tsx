import React, { useState, useEffect, useCallback } from 'react';

interface DailyCount {
  date: string;
  count: number;
}

interface WorkerStat {
  id: string;
  beadsCompleted: number;
  beadsPerHour: number;
}

interface ProjectStat {
  name: string;
  prefix: string;
  closedCount: number;
  byAssignee: Record<string, number>;
  lastClosedAt?: string;
}

interface ProductivityData {
  daily: DailyCount[];
  workers: WorkerStat[];
  byProject: ProjectStat[];
}

interface ProductivityPanelProps {
  visible: boolean;
  onClose: () => void;
}

// BarChart: pure SVG bar chart for daily throughput
const BarChart: React.FC<{ data: DailyCount[]; days?: number }> = ({ data, days = 14 }) => {
  const slice = data.slice(-days);
  const max = Math.max(...slice.map((d) => d.count), 1);
  const width = 600;
  const height = 120;
  const barW = Math.floor((width / slice.length) * 0.7);
  const gap = Math.floor((width / slice.length) * 0.3);
  const colW = barW + gap;

  return (
    <div className="productivity-chart-wrap">
      <svg
        viewBox={`0 0 ${width} ${height + 30}`}
        style={{ width: '100%', maxWidth: width, display: 'block' }}
      >
        {slice.map((d, i) => {
          const barH = Math.max((d.count / max) * height, d.count > 0 ? 2 : 0);
          const x = i * colW + gap / 2;
          const y = height - barH;
          const showLabel = i === 0 || i === Math.floor(slice.length / 2) || i === slice.length - 1;
          return (
            <g key={d.date}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                fill="var(--accent-color, #6366f1)"
                opacity={0.85}
              >
                <title>{`${d.date}: ${d.count} beads`}</title>
              </rect>
              {d.count > 0 && (
                <text
                  x={x + barW / 2}
                  y={y - 3}
                  textAnchor="middle"
                  fontSize="9"
                  fill="var(--text-secondary, #aaa)"
                >
                  {d.count}
                </text>
              )}
              {showLabel && (
                <text
                  x={x + barW / 2}
                  y={height + 18}
                  textAnchor="middle"
                  fontSize="9"
                  fill="var(--text-secondary, #aaa)"
                >
                  {d.date.slice(5)}
                </text>
              )}
            </g>
          );
        })}
        <line
          x1={0}
          y1={height}
          x2={width}
          y2={height}
          stroke="var(--border-color, #333)"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
};

const ProductivityPanel: React.FC<ProductivityPanelProps> = ({ visible, onClose }) => {
  const [data, setData] = useState<ProductivityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/productivity');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) fetchData();
  }, [visible, fetchData]);

  if (!visible) return null;

  const totalToday = data?.daily[data.daily.length - 1]?.count ?? 0;
  const total30d = data?.daily.reduce((s, d) => s + d.count, 0) ?? 0;
  const maxProjectCount = Math.max(...(data?.byProject.map(p => p.closedCount) || [0]), 1);

  return (
    <div className="analytics-panel productivity-panel">
      <div className="analytics-header">
        <h3>
          Productivity
          {data && (
            <span className="analytics-subtitle">
              {totalToday} today · {total30d} last 30d
            </span>
          )}
        </h3>
        <div className="analytics-header-actions">
          <button className="analytics-refresh" onClick={fetchData} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button className="close-button" onClick={onClose}>x</button>
        </div>
      </div>

      {error && <div className="analytics-error">{error}</div>}

      {data && (
        <div className="analytics-content">
          <div className="analytics-section">
            <h3 className="analytics-section-title">Daily Throughput (last 14 days)</h3>
            <div className="analytics-section-body">
              {data.daily.every((d) => d.count === 0) ? (
                <p className="analytics-empty">No bead completions recorded yet.</p>
              ) : (
                <BarChart data={data.daily} days={14} />
              )}
            </div>
          </div>

          <div className="analytics-section">
            <h3 className="analytics-section-title">Worker Leaderboard</h3>
            <div className="analytics-section-body">
              {data.workers.filter((w) => w.beadsCompleted > 0).length === 0 ? (
                <p className="analytics-empty">No completions recorded yet.</p>
              ) : (
                <table className="productivity-leaderboard">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Worker</th>
                      <th>Beads</th>
                      <th>Beads/hr</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.workers
                      .filter((w) => w.beadsCompleted > 0)
                      .map((w, i) => (
                        <tr key={w.id}>
                          <td className="productivity-rank">{i + 1}</td>
                          <td className="productivity-worker-id">{w.id}</td>
                          <td className="productivity-count">{w.beadsCompleted}</td>
                          <td className="productivity-rate">{w.beadsPerHour}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="analytics-section">
            <h3 className="analytics-section-title">By Project</h3>
            <div className="analytics-section-body">
              {data.byProject.length === 0 ? (
                <p className="analytics-empty">No project data available.</p>
              ) : (
                <table className="productivity-projects">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Closed Beads</th>
                      <th>Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byProject.map((project) => {
                      const width = (project.closedCount / maxProjectCount) * 100;
                      const assignees = Object.entries(project.byAssignee)
                        .sort(([, a], [, b]) => b - a)
                        .slice(0, 3);
                      return (
                        <tr key={project.name}>
                          <td className="productivity-project-name">
                            {project.name}
                            <span className="productivity-project-prefix"> ({project.prefix}-*)</span>
                          </td>
                          <td className="productivity-count">{project.closedCount}</td>
                          <td className="productivity-bar-cell">
                            <div className="productivity-bar-bg">
                              <div
                                className="productivity-bar-fill"
                                style={{ width: `${width}%` }}
                                title={`${project.closedCount} beads closed`}
                              />
                            </div>
                            {assignees.length > 0 && (
                              <div className="productivity-assignees" title={`Top assignees: ${assignees.map(([a]) => a).join(', ')}`}>
                                {assignees.map(([assignee, count]) => (
                                  <span key={assignee} className="productivity-assignee">
                                    {assignee.split('-').pop()}: {count}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductivityPanel;
