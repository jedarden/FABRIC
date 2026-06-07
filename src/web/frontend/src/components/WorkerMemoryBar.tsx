import React from 'react';

interface WorkerMemoryBarProps {
  rssKb?: number | null;
  peakRssKb?: number | null;
  rssLimitBytes?: number | null;
  rssPercent?: number | null;
  swapKb?: number | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
}

function getProgressColor(percent: number): string {
  if (percent < 70) return '#4caf50'; // green
  if (percent < 90) return '#ff9800'; // yellow
  return '#f44336'; // red
}

export const WorkerMemoryBar: React.FC<WorkerMemoryBarProps> = ({
  rssKb,
  peakRssKb,
  rssLimitBytes,
  rssPercent,
  swapKb,
}) => {
  // Hide bar if no RSS data yet
  if (rssKb === null || rssKb === undefined) {
    return null;
  }

  const currentRssBytes = rssKb * 1024;
  const peakRssBytes = peakRssKb ? peakRssKb * 1024 : null;

  // Determine the ceiling for the bar
  // If per-worker limit is set, use that; otherwise default to 4 GB
  const limitBytes = rssLimitBytes || 4 * 1024 * 1024 * 1024;
  const limitRssKb = limitBytes / 1024;

  // Calculate percentages
  const currentPercent = (currentRssBytes / limitBytes) * 100;
  const peakPercent = peakRssBytes ? (peakRssBytes / limitBytes) * 100 : null;

  const color = rssPercent !== null && rssPercent !== undefined
    ? getProgressColor(rssPercent)
    : getProgressColor(currentPercent);

  const hasSwap = swapKb !== null && swapKb !== undefined && swapKb > 0;

  return (
    <div className="worker-memory-bar">
      <div
        className="worker-memory-bar-track"
        style={{ backgroundColor: 'rgba(255, 255, 255, 0.1)' }}
      >
        <div
          className="worker-memory-bar-fill"
          style={{
            width: `${Math.min(100, currentPercent)}%`,
            backgroundColor: color,
          }}
        />
        {peakPercent !== null && peakPercent !== undefined && peakPercent > currentPercent && (
          <div
            className="worker-memory-bar-peak"
            style={{ left: `${Math.min(100, peakPercent)}%` }}
            title={`Peak: ${formatBytes(peakRssBytes!)}`}
          />
        )}
      </div>
      <div className="worker-memory-bar-info">
        <span className="worker-memory-bar-text">
          {formatBytes(currentRssBytes)} / {formatBytes(limitBytes)}
        </span>
        {hasSwap && (
          <span
            className="worker-memory-bar-swap"
            title={`Swap: ${formatBytes(swapKb! * 1024)}`}
          >
            🔁
          </span>
        )}
      </div>
      <style>{`
        .worker-memory-bar {
          display: flex;
          flex-direction: column;
          gap: 2px;
          margin-top: 0.5rem;
          padding-top: 0.5rem;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        .worker-memory-bar-track {
          position: relative;
          width: 100%;
          height: 6px;
          border-radius: 3px;
          overflow: hidden;
        }

        .worker-memory-bar-fill {
          height: 100%;
          transition: width 0.5s ease, background-color 0.5s ease;
        }

        .worker-memory-bar-peak {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 2px;
          background: rgba(255, 255, 255, 0.8);
          box-shadow: 0 0 4px rgba(255, 255, 255, 0.5);
        }

        .worker-memory-bar-info {
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }

        .worker-memory-bar-text {
          font-size: 0.7rem;
          color: var(--text-secondary, #aaa);
          font-family: 'SF Mono', Monaco, monospace;
        }

        .worker-memory-bar-swap {
          font-size: 0.65rem;
          opacity: 0.7;
        }
      `}</style>
    </div>
  );
};

export default WorkerMemoryBar;
