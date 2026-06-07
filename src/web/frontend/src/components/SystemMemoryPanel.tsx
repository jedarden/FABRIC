import React, { useState, useEffect, useCallback } from 'react';

interface SystemMemoryStatus {
  totalMemory: number | null;
  availableMemory: number | null;
  cgroupLimit: number | null;
  cgroupUsage: number | null;
  cgroupHigh: number | null;
  cgroupSwapUsage: number | null;
  swapTotal: number | null;
  swapFree: number | null;
  fabricRss: number;
  cgroupUsagePercent: number | null;
  underPressure: boolean;
  oomRisk: 'none' | 'low' | 'medium' | 'high' | 'critical';
  oomKill: number;
  oom: number;
}

interface FormattedMemory {
  totalMemory: string;
  availableMemory: string;
  cgroupLimit: string;
  cgroupUsage: string;
  cgroupHigh: string;
  cgroupSwapUsage: string;
  swapTotal: string;
  swapFree: string;
  fabricRss: string;
}

interface OomAlert {
  risk: 'none' | 'low' | 'medium' | 'high' | 'critical';
  underPressure: boolean;
  cgroupUsagePercent: number | null;
  cgroupUsage: number | null;
  cgroupLimit: number | null;
  message: string;
  timestamp: number;
}

interface MemoryHistorySample {
  timestamp: number;
  usage: number;
  usagePercent: number;
  swapUsage: number | null;
  formattedUsage: string;
  formattedSwapUsage: string;
}

interface MemoryHistoryResponse {
  samples: MemoryHistorySample[];
  count: number;
  maxSamples: number;
}

interface SystemMemoryPanelProps {
  visible: boolean;
  onClose: () => void;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'N/A';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

function getOomRiskColor(risk: 'none' | 'low' | 'medium' | 'high' | 'critical'): string {
  switch (risk) {
    case 'none': return '#4caf50';
    case 'low': return '#ff9800';
    case 'medium': return '#ff5722';
    case 'high': return '#f44336';
    case 'critical': return '#d32f2f';
  }
}

function getOomRiskLabel(risk: 'none' | 'low' | 'medium' | 'high' | 'critical'): string {
  switch (risk) {
    case 'none': return 'None';
    case 'low': return 'Low';
    case 'medium': return 'Medium';
    case 'high': return 'High';
    case 'critical': return 'CRITICAL';
  }
}

export const SystemMemoryPanel: React.FC<SystemMemoryPanelProps> = ({ visible, onClose }) => {
  const [memoryStatus, setMemoryStatus] = useState<SystemMemoryStatus | null>(null);
  const [formattedMemory, setFormattedMemory] = useState<FormattedMemory | null>(null);
  const [oomAlert, setOomAlert] = useState<OomAlert | null>(null);
  const [memoryHistory, setMemoryHistory] = useState<MemoryHistorySample[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSystemMemory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/system/memory');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      setMemoryStatus(data);
      setFormattedMemory(data.formatted);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch system memory');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchOomAlert = useCallback(async () => {
    try {
      const response = await fetch('/api/alerts/oom');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      setOomAlert(data);
    } catch (err) {
      console.error('Failed to fetch OOM alert:', err);
    }
  }, []);

  const fetchMemoryHistory = useCallback(async () => {
    try {
      const response = await fetch('/api/system/memory/history');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data: MemoryHistoryResponse = await response.json();
      setMemoryHistory(data.samples);
    } catch (err) {
      console.error('Failed to fetch memory history:', err);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      fetchSystemMemory();
      fetchOomAlert();
      fetchMemoryHistory();
      const interval = setInterval(() => {
        fetchSystemMemory();
        fetchOomAlert();
        fetchMemoryHistory();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [visible, fetchSystemMemory, fetchOomAlert, fetchMemoryHistory]);

  if (!visible) return null;

  const oomRiskColor = memoryStatus ? getOomRiskColor(memoryStatus.oomRisk) : '#ccc';
  const cgroupUsagePercent = memoryStatus?.cgroupUsagePercent ?? 0;
  const underPressure = memoryStatus?.underPressure ?? false;

  return (
    <div className="panel system-memory-panel">
      <div className="panel-header">
        <h2>System Memory</h2>
        <button className="panel-close" onClick={onClose}>&times;</button>
      </div>

      <div className="panel-content">
        {loading && !memoryStatus && (
          <div className="loading-state">Loading system memory data...</div>
        )}

        {error && (
          <div className="error-state">
            <span className="error-icon">!</span>
            {error}
          </div>
        )}

        {memoryStatus && formattedMemory && (
          <>
            {/* OOM Risk Alert Banner */}
            {(memoryStatus.oomRisk !== 'none' || underPressure) && (
              <div className={`oom-alert-banner oom-alert-${memoryStatus.oomRisk}`}>
                <span className="oom-alert-icon">⚠️</span>
                <span className="oom-alert-text">
                  {oomAlert?.message || `OOM Risk: ${getOomRiskLabel(memoryStatus.oomRisk)}`}
                </span>
                {underPressure && (
                  <span className="oom-pressure-badge">Under Pressure</span>
                )}
              </div>
            )}

            {/* Cgroup Memory Section */}
            <div className="memory-section">
              <h3>Cgroup Memory</h3>

              {/* OOM Kill Counter */}
              {(memoryStatus.oomKill > 0 || memoryStatus.oom > 0) && (
                <div className="oom-kill-counter">
                  <span className="oom-kill-icon">💀</span>
                  <span className="oom-kill-text">
                    {memoryStatus.oomKill > 0 && `${memoryStatus.oomKill} OOM kill${memoryStatus.oomKill > 1 ? 's' : ''}`}
                    {memoryStatus.oom > 0 && memoryStatus.oomKill !== memoryStatus.oom && ` · ${memoryStatus.oom} OOM event${memoryStatus.oom > 1 ? 's' : ''}`}
                  </span>
                </div>
              )}

              {/* 5-minute sparkline */}
              {memoryHistory.length > 0 && (
                <div className="memory-sparkline-container">
                  <div className="sparkline-label">5-minute trend</div>
                  <div className="memory-sparkline">
                    {memoryHistory.map((sample, index) => {
                      const maxPercent = Math.max(...memoryHistory.map(s => s.usagePercent), 1);
                      const heightPercent = (sample.usagePercent / maxPercent) * 100;
                      const getColor = (pct: number) => {
                        if (pct >= 98) return '#d32f2f';
                        if (pct >= 95) return '#f44336';
                        if (pct >= 90) return '#ff5722';
                        if (pct >= 80) return '#ff9800';
                        return '#4caf50';
                      };
                      return (
                        <div
                          key={sample.timestamp}
                          className="sparkline-bar"
                          style={{
                            height: `${Math.max(5, heightPercent)}%`,
                            backgroundColor: getColor(sample.usagePercent),
                          }}
                          title={`${new Date(sample.timestamp).toLocaleTimeString()}: ${sample.formattedUsage} (${sample.usagePercent.toFixed(1)}%)`}
                        />
                      );
                    })}
                  </div>
                  <div className="sparkline-legend">
                    <span className="legend-dot" style={{ backgroundColor: '#4caf50' }}></span>
                    <span>&lt;80%</span>
                    <span className="legend-dot" style={{ backgroundColor: '#ff9800' }}></span>
                    <span>80-90%</span>
                    <span className="legend-dot" style={{ backgroundColor: '#ff5722' }}></span>
                    <span>90-95%</span>
                    <span className="legend-dot" style={{ backgroundColor: '#f44336' }}></span>
                    <span>≥95%</span>
                  </div>
                </div>
              )}
              <div className="memory-bar-container">
                <div className="memory-bar-label">
                  <span>Usage</span>
                  <span>{formattedMemory.cgroupUsage} / {formattedMemory.cgroupLimit}</span>
                </div>
                <div className="memory-bar">
                  <div
                    className="memory-bar-fill"
                    style={{
                      width: `${Math.min(100, cgroupUsagePercent)}%`,
                      backgroundColor: oomRiskColor,
                    }}
                  />
                </div>
                <div className="memory-bar-percent">{cgroupUsagePercent.toFixed(1)}%</div>
              </div>

              {memoryStatus.cgroupHigh !== null && (
                <div className="memory-detail">
                  <span className="detail-label">MemoryHigh Threshold:</span>
                  <span className="detail-value">{formattedMemory.cgroupHigh}</span>
                </div>
              )}

              {memoryStatus.cgroupSwapUsage !== null && (
                <div className="memory-detail">
                  <span className="detail-label">Cgroup Swap Usage:</span>
                  <span className="detail-value">{formattedMemory.cgroupSwapUsage}</span>
                </div>
              )}
            </div>

            {/* System Memory Section */}
            <div className="memory-section">
              <h3>System Memory</h3>
              <div className="memory-detail">
                <span className="detail-label">Total Memory:</span>
                <span className="detail-value">{formattedMemory.totalMemory}</span>
              </div>
              <div className="memory-detail">
                <span className="detail-label">Available Memory:</span>
                <span className="detail-value">{formattedMemory.availableMemory}</span>
              </div>
            </div>

            {/* Swap Section */}
            <div className="memory-section">
              <h3>Swap</h3>
              <div className="memory-detail">
                <span className="detail-label">Swap Total:</span>
                <span className="detail-value">{formattedMemory.swapTotal}</span>
              </div>
              <div className="memory-detail">
                <span className="detail-label">Swap Free:</span>
                <span className="detail-value">{formattedMemory.swapFree}</span>
              </div>
              {memoryStatus.swapTotal && memoryStatus.swapFree && (
                <div className="memory-bar-container">
                  <div className="memory-bar-label">
                    <span>Swap Used</span>
                    <span>
                      {formatBytes(memoryStatus.swapTotal - memoryStatus.swapFree)} / {formattedMemory.swapTotal}
                    </span>
                  </div>
                  <div className="memory-bar">
                    <div
                      className="memory-bar-fill memory-bar-fill--swap"
                      style={{
                        width: `${((memoryStatus.swapTotal - memoryStatus.swapFree) / memoryStatus.swapTotal) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* FABRIC Process Section */}
            <div className="memory-section">
              <h3>FABRIC Process</h3>
              <div className="memory-detail">
                <span className="detail-label">RSS Memory:</span>
                <span className="detail-value">{formattedMemory.fabricRss}</span>
              </div>
            </div>

            {/* OOM Risk Legend */}
            <div className="oom-risk-legend">
              <h4>OOM Risk Levels</h4>
              <div className="legend-item">
                <span className="legend-color" style={{ backgroundColor: '#4caf50' }}></span>
                <span>None (&lt;80%)</span>
              </div>
              <div className="legend-item">
                <span className="legend-color" style={{ backgroundColor: '#ff9800' }}></span>
                <span>Low (80-90%)</span>
              </div>
              <div className="legend-item">
                <span className="legend-color" style={{ backgroundColor: '#ff5722' }}></span>
                <span>Medium (90-95%)</span>
              </div>
              <div className="legend-item">
                <span className="legend-color" style={{ backgroundColor: '#f44336' }}></span>
                <span>High (95-98%)</span>
              </div>
              <div className="legend-item">
                <span className="legend-color" style={{ backgroundColor: '#d32f2f' }}></span>
                <span>Critical (&ge;98%)</span>
              </div>
            </div>

            {/* Last Updated */}
            <div className="panel-footer">
              <span className="last-updated">
                Updated {new Date().toLocaleTimeString()}
              </span>
              <button className="refresh-button" onClick={fetchSystemMemory}>
                Refresh
              </button>
            </div>
          </>
        )}
      </div>

      <style>{`
        .system-memory-panel {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 500px;
          max-height: 80vh;
          background: var(--bg-primary);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
          z-index: 1000;
          display: flex;
          flex-direction: column;
        }

        .system-memory-panel .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px;
          border-bottom: 1px solid var(--border-color);
        }

        .system-memory-panel .panel-header h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
        }

        .system-memory-panel .panel-close {
          background: none;
          border: none;
          font-size: 24px;
          cursor: pointer;
          color: var(--text-secondary);
          padding: 0;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
        }

        .system-memory-panel .panel-close:hover {
          background: var(--bg-hover);
          color: var(--text-primary);
        }

        .system-memory-panel .panel-content {
          padding: 16px;
          overflow-y: auto;
          flex: 1;
        }

        .system-memory-panel .loading-state,
        .system-memory-panel .error-state {
          padding: 20px;
          text-align: center;
          color: var(--text-secondary);
        }

        .system-memory-panel .error-state {
          color: #f44336;
        }

        .system-memory-panel .error-icon {
          display: inline-block;
          margin-right: 8px;
          font-weight: bold;
        }

        .system-memory-panel .memory-section {
          margin-bottom: 24px;
        }

        .system-memory-panel .memory-section h3 {
          margin: 0 0 12px 0;
          font-size: 14px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-secondary);
        }

        .system-memory-panel .memory-bar-container {
          margin-bottom: 8px;
        }

        .system-memory-panel .memory-bar-label {
          display: flex;
          justify-content: space-between;
          margin-bottom: 4px;
          font-size: 13px;
          color: var(--text-secondary);
        }

        .system-memory-panel .memory-bar {
          height: 24px;
          background: var(--bg-secondary);
          border-radius: 4px;
          overflow: hidden;
          position: relative;
        }

        .system-memory-panel .memory-bar-fill {
          height: 100%;
          transition: width 0.3s ease, background-color 0.3s ease;
        }

        .system-memory-panel .memory-bar-fill--swap {
          background: linear-gradient(90deg, #ff9800, #ff5722);
        }

        .system-memory-panel .memory-bar-percent {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 12px;
          font-weight: 600;
          color: var(--text-primary);
          text-shadow: 0 0 2px rgba(0, 0, 0, 0.5);
        }

        .system-memory-panel .memory-detail {
          display: flex;
          justify-content: space-between;
          padding: 4px 0;
          font-size: 13px;
        }

        .system-memory-panel .detail-label {
          color: var(--text-secondary);
        }

        .system-memory-panel .detail-value {
          color: var(--text-primary);
          font-weight: 500;
        }

        .system-memory-panel .oom-alert-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px;
          border-radius: 6px;
          margin-bottom: 16px;
          font-size: 14px;
        }

        .system-memory-panel .oom-alert-none {
          background: rgba(76, 175, 80, 0.1);
          border: 1px solid rgba(76, 175, 80, 0.3);
          color: #4caf50;
        }

        .system-memory-panel .oom-alert-low {
          background: rgba(255, 152, 0, 0.1);
          border: 1px solid rgba(255, 152, 0, 0.3);
          color: #ff9800;
        }

        .system-memory-panel .oom-alert-medium {
          background: rgba(255, 87, 34, 0.1);
          border: 1px solid rgba(255, 87, 34, 0.3);
          color: #ff5722;
        }

        .system-memory-panel .oom-alert-high {
          background: rgba(244, 67, 54, 0.1);
          border: 1px solid rgba(244, 67, 54, 0.3);
          color: #f44336;
        }

        .system-memory-panel .oom-alert-critical {
          background: rgba(211, 47, 47, 0.1);
          border: 1px solid rgba(211, 47, 47, 0.3);
          color: #d32f2f;
          font-weight: 600;
        }

        .system-memory-panel .oom-alert-icon {
          font-size: 18px;
        }

        .system-memory-panel .oom-pressure-badge {
          background: currentColor;
          color: white;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
        }

        .system-memory-panel .oom-risk-legend {
          padding: 16px;
          background: var(--bg-secondary);
          border-radius: 6px;
        }

        .system-memory-panel .oom-risk-legend h4 {
          margin: 0 0 12px 0;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary);
        }

        .system-memory-panel .legend-item {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 6px;
          font-size: 12px;
        }

        .system-memory-panel .legend-color {
          width: 12px;
          height: 12px;
          border-radius: 2px;
        }

        .system-memory-panel .panel-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-top: 1px solid var(--border-color);
        }

        .system-memory-panel .last-updated {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .system-memory-panel .refresh-button {
          background: var(--bg-hover);
          border: 1px solid var(--border-color);
          color: var(--text-primary);
          padding: 6px 12px;
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
          transition: background 0.2s;
        }

        .system-memory-panel .refresh-button:hover {
          background: var(--bg-secondary);
        }

        /* OOM Kill Counter */
        .system-memory-panel .oom-kill-counter {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          background: rgba(211, 47, 47, 0.1);
          border: 1px solid rgba(211, 47, 47, 0.3);
          border-radius: 6px;
          margin-bottom: 12px;
          color: #d32f2f;
          font-weight: 600;
          font-size: 13px;
        }

        .system-memory-panel .oom-kill-icon {
          font-size: 18px;
        }

        .system-memory-panel .oom-kill-text {
          flex: 1;
        }

        /* Memory Sparkline */
        .system-memory-panel .memory-sparkline-container {
          margin-bottom: 12px;
          padding: 12px;
          background: var(--bg-secondary);
          border-radius: 6px;
        }

        .system-memory-panel .sparkline-label {
          font-size: 12px;
          color: var(--text-secondary);
          margin-bottom: 8px;
          display: block;
        }

        .system-memory-panel .memory-sparkline {
          display: flex;
          align-items: flex-end;
          gap: 2px;
          height: 60px;
          margin-bottom: 8px;
        }

        .system-memory-panel .sparkline-bar {
          flex: 1;
          min-width: 2px;
          max-width: 12px;
          border-radius: 2px 2px 0 0;
          transition: height 0.3s ease, background-color 0.3s ease;
          cursor: crosshair;
        }

        .system-memory-panel .sparkline-bar:hover {
          opacity: 0.8;
        }

        .system-memory-panel .sparkline-legend {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 10px;
          color: var(--text-secondary);
          flex-wrap: wrap;
        }

        .system-memory-panel .legend-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
      `}</style>
    </div>
  );
};
