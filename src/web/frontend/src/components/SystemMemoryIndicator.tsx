import React, { useState, useEffect, useCallback } from 'react';

interface SystemMemoryStatus {
  cgroupUsagePercent: number | null;
  cgroupUsage: number | null;
  cgroupLimit: number | null;
  cgroupHigh: number | null;
  cgroupSwapUsage: number | null;
  oomKill: number;
  underPressure: boolean;
  oomRisk: 'none' | 'low' | 'medium' | 'high' | 'critical';
}

interface FormattedMemory {
  cgroupUsage: string;
  cgroupLimit: string;
  cgroupSwapUsage: string;
}

interface MemoryHistorySample {
  timestamp: number;
  usage: number;
  usagePercent: number;
  swapUsage: number | null;
}

interface MemoryHistoryResponse {
  samples: MemoryHistorySample[];
  count: number;
}

interface SystemMemoryIndicatorProps {
  onClick?: () => void;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'N/A';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
}

function getProgressColor(percent: number): string {
  if (percent < 70) return '#4caf50'; // green
  if (percent < 90) return '#ff9800'; // yellow
  return '#f44336'; // red
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

export const SystemMemoryIndicator: React.FC<SystemMemoryIndicatorProps> = ({ onClick }) => {
  const [memoryStatus, setMemoryStatus] = useState<SystemMemoryStatus | null>(null);
  const [formattedMemory, setFormattedMemory] = useState<FormattedMemory | null>(null);
  const [memoryHistory, setMemoryHistory] = useState<MemoryHistorySample[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchMemoryData = useCallback(async () => {
    try {
      const [statusRes, historyRes] = await Promise.all([
        fetch('/api/system/memory'),
        fetch('/api/system/memory/history')
      ]);

      if (!statusRes.ok || !historyRes.ok) {
        throw new Error('Failed to fetch memory data');
      }

      const statusData = await statusRes.json();
      const historyData: MemoryHistoryResponse = await historyRes.json();

      setMemoryStatus(statusData);
      setFormattedMemory(statusData.formatted);
      setMemoryHistory(historyData.samples);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch memory data');
    }
  }, []);

  useEffect(() => {
    fetchMemoryData();
    const interval = setInterval(fetchMemoryData, 10000); // Update every 10s
    return () => clearInterval(interval);
  }, [fetchMemoryData]);

  if (error) {
    return (
      <div className="system-memory-indicator system-memory-error" onClick={onClick}>
        <span className="memory-error-icon">⚠️</span>
        <span className="memory-error-text">Mem Error</span>
      </div>
    );
  }

  if (!memoryStatus || memoryStatus.cgroupUsagePercent === null) {
    return (
      <div className="system-memory-indicator system-memory-loading" onClick={onClick}>
        <span className="memory-loading-text">Loading...</span>
      </div>
    );
  }

  const usagePercent = memoryStatus.cgroupUsagePercent;
  const color = getProgressColor(usagePercent);
  const hasSwap = memoryStatus.cgroupSwapUsage !== null && memoryStatus.cgroupSwapUsage > 0;
  const hasOomKill = memoryStatus.oomKill > 0;

  return (
    <div className="system-memory-indicator" onClick={onClick}>
      {/* Memory progress bar */}
      <div
        className="memory-progress-bar"
        style={{ backgroundColor: color }}
      >
        <div
          className="memory-progress-fill"
          style={{ width: `${Math.min(100, usagePercent)}%` }}
        />
      </div>

      {/* Memory text */}
      <span className="memory-text">
        {formattedMemory?.cgroupUsage || formatBytes(memoryStatus.cgroupUsage)}
      </span>

      {/* Sparkline (last 30 samples = 5 minutes) */}
      {memoryHistory.length > 0 && (
        <div className="memory-sparkline">
          {memoryHistory.slice(-30).map((sample, i) => {
            const maxPercent = Math.max(...memoryHistory.slice(-30).map(s => s.usagePercent), 1);
            const heightPercent = (sample.usagePercent / maxPercent) * 100;
            return (
              <div
                key={`${sample.timestamp}-${i}`}
                className="sparkline-bar"
                style={{
                  height: `${Math.max(10, heightPercent)}%`,
                  backgroundColor: getProgressColor(sample.usagePercent),
                }}
                title={`${new Date(sample.timestamp).toLocaleTimeString()}: ${formatBytes(sample.usage)} (${sample.usagePercent.toFixed(1)}%)`}
              />
            );
          })}
        </div>
      )}

      {/* OOM kill counter */}
      {hasOomKill && (
        <span className="memory-oom-counter" title={`${memoryStatus.oomKill} OOM kill${memoryStatus.oomKill > 1 ? 's' : ''}`}>
          💀 {memoryStatus.oomKill}
        </span>
      )}

      {/* Swap indicator */}
      {hasSwap && (
        <span className="memory-swap-indicator" title={`Swap: ${formatBytes(memoryStatus.cgroupSwapUsage)}`}>
          🔁
        </span>
      )}

      <style>{`
        .system-memory-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 12px;
          border-radius: 4px;
          cursor: pointer;
          transition: background 0.2s;
          user-select: none;
        }

        .system-memory-indicator:hover {
          background: var(--bg-hover, rgba(0, 0, 0, 0.1));
        }

        .system-memory-indicator.system-memory-loading {
          color: var(--text-secondary, #666);
          font-size: 12px;
        }

        .system-memory-indicator.system-memory-error {
          color: #f44336;
          font-size: 12px;
        }

        .memory-progress-bar {
          position: relative;
          width: 80px;
          height: 8px;
          background: var(--bg-secondary, #e0e0e0);
          border-radius: 4px;
          overflow: hidden;
        }

        .memory-progress-fill {
          height: 100%;
          background: currentColor;
          transition: width 0.5s ease;
        }

        .memory-text {
          font-size: 13px;
          font-weight: 500;
          color: var(--text-primary, #333);
          min-width: 50px;
        }

        .memory-sparkline {
          display: flex;
          align-items: flex-end;
          gap: 1px;
          height: 16px;
          width: 60px;
        }

        .sparkline-bar {
          flex: 1;
          min-width: 1px;
          max-width: 3px;
          border-radius: 1px 1px 0 0;
          transition: height 0.5s ease, background-color 0.5s ease;
        }

        .memory-oom-counter {
          font-size: 12px;
          color: #d32f2f;
          font-weight: 600;
          white-space: nowrap;
        }

        .memory-swap-indicator {
          font-size: 14px;
          opacity: 0.8;
        }

        .memory-error-icon {
          margin-right: 4px;
        }

        .memory-error-text {
          font-size: 12px;
        }
      `}</style>
    </div>
  );
};

export default SystemMemoryIndicator;
