import React, { useState, useEffect } from 'react';

interface OomState {
  oomKillCount: number;
  lastOomAt: string | null;
  oomDetected: boolean;
  memoryCurrentAtOom: number | null;
  formattedMemoryCurrent?: string | null;
}

interface OomAlertBannerProps {
  onDismiss: () => void;
}

// Local storage key for tracking dismissed alerts
const OOM_DISMISS_KEY = 'fabric-oom-dismissed';

/**
 * OOM Alert Banner
 *
 * Shows a persistent red alert banner at the top of the FABRIC dashboard
 * when an OOM kill is detected. Includes the oom_kill count and memory.current
 * at time of detection. Dismissible via X button; auto-clears after 1 hour.
 */
export const OomAlertBanner: React.FC<OomAlertBannerProps> = ({ onDismiss }) => {
  const [oomState, setOomState] = useState<OomState | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Check for previously dismissed alert (auto-clear after 1 hour)
  useEffect(() => {
    try {
      const dismissedData = localStorage.getItem(OOM_DISMISS_KEY);
      if (dismissedData) {
        const { timestamp } = JSON.parse(dismissedData);
        const oneHour = 60 * 60 * 1000;
        if (Date.now() - timestamp < oneHour) {
          setDismissed(true);
        } else {
          // Expired, clear it
          localStorage.removeItem(OOM_DISMISS_KEY);
        }
      }
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Poll OOM state every 30 seconds
  useEffect(() => {
    const pollOomState = async () => {
      try {
        const res = await fetch('/api/system/oom-state');
        if (res.ok) {
          const data = await res.json();
          setOomState(data);
        }
      } catch (err) {
        console.error('Failed to fetch OOM state:', err);
      }
    };

    // Initial poll
    pollOomState();

    // Poll every 30 seconds
    const interval = setInterval(pollOomState, 30000);
    return () => clearInterval(interval);
  }, []);

  // Handle dismiss
  const handleDismiss = () => {
    setDismissed(true);
    // Save dismissal timestamp to localStorage
    try {
      localStorage.setItem(OOM_DISMISS_KEY, JSON.stringify({ timestamp: Date.now() }));
    } catch {
      // Ignore localStorage errors
    }
    onDismiss();
  };

  // Don't show if dismissed or no OOM detected
  if (dismissed || !oomState || !oomState.oomDetected) {
    return null;
  }

  const timeSinceOom = oomState.lastOomAt
    ? new Date(oomState.lastOomAt).toLocaleTimeString()
    : 'Unknown';

  return (
    <div className="oom-alert-banner">
      <div className="oom-alert-banner-content">
        <span className="oom-alert-banner-icon">⚠️</span>
        <span className="oom-alert-banner-text">
          <strong>OOM kill detected</strong> — check system memory
          {' '}
          <span className="oom-alert-banner-detail">
            (Kill count: {oomState.oomKillCount} at {timeSinceOom}
            {oomState.formattedMemoryCurrent && `, memory: ${oomState.formattedMemoryCurrent}`})
          </span>
        </span>
        <button
          className="oom-alert-banner-dismiss"
          onClick={handleDismiss}
          title="Dismiss (will auto-clear after 1 hour)"
        >
          ×
        </button>
      </div>
    </div>
  );
};

export default OomAlertBanner;
