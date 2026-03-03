/**
 * SessionReplay Component
 *
 * Provides session replay functionality - ability to replay worker activity
 * history chronologically with playback controls.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LogEvent } from '../types';

export type ReplaySpeed = 0.5 | 1 | 2 | 5 | 10;
export type ReplayState = 'idle' | 'playing' | 'paused' | 'ended';

interface SessionReplayProps {
  /** Events to replay */
  events: LogEvent[];

  /** Initial filter - filter by worker ID */
  filterWorker?: string;

  /** Callback when an event is displayed during playback */
  onEvent?: (event: LogEvent, index: number, total: number) => void;

  /** Callback when state changes */
  onStateChange?: (state: ReplayState) => void;

  /** Optional CSS class */
  className?: string;
}

/**
 * Get color for log level
 */
const getLevelColor = (level: string): string => {
  switch (level) {
    case 'error': return 'var(--error)';
    case 'warn': return 'var(--warning)';
    case 'info': return 'var(--info)';
    case 'debug': return 'var(--text-secondary)';
    default: return 'var(--text-primary)';
  }
};

/**
 * Get icon for playback state
 */
const getStateIcon = (state: ReplayState): string => {
  switch (state) {
    case 'playing': return '▶';
    case 'paused': return '⏸';
    case 'ended': return '⏹';
    default: return '⏵';
  }
};

/**
 * SessionReplay component for replaying worker sessions
 */
const SessionReplay: React.FC<SessionReplayProps> = ({
  events,
  filterWorker,
  onEvent,
  onStateChange,
  className = '',
}) => {
  // Playback state
  const [state, setState] = useState<ReplayState>('idle');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const [displayedEvents, setDisplayedEvents] = useState<LogEvent[]>([]);

  // Refs
  const playbackTimerRef = useRef<NodeJS.Timeout | null>(null);
  const eventListRef = useRef<HTMLDivElement>(null);

  // Filter events
  const filteredEvents = React.useMemo(() => {
    let filtered = [...events].sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    if (filterWorker) {
      filtered = filtered.filter(e => e.worker === filterWorker);
    }

    return filtered;
  }, [events, filterWorker]);

  // Progress calculation
  const progress = {
    current: currentIndex,
    total: filteredEvents.length,
    percent: filteredEvents.length > 0 ? Math.round((currentIndex / filteredEvents.length) * 100) : 0,
  };

  // Time range
  const timeRange = React.useMemo(() => {
    if (filteredEvents.length === 0) return null;
    return {
      start: new Date(filteredEvents[0].timestamp).toLocaleTimeString(),
      end: new Date(filteredEvents[filteredEvents.length - 1].timestamp).toLocaleTimeString(),
    };
  }, [filteredEvents]);

  // Clear playback timer
  const clearTimer = useCallback(() => {
    if (playbackTimerRef.current) {
      clearTimeout(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
  }, []);

  // Update state and notify
  const updateState = useCallback((newState: ReplayState) => {
    setState(newState);
    onStateChange?.(newState);
  }, [onStateChange]);

  // Schedule next event playback
  const scheduleNextEvent = useCallback(() => {
    if (state !== 'playing') return;

    if (currentIndex >= filteredEvents.length) {
      updateState('ended');
      return;
    }

    // Calculate delay based on time difference and speed
    let delay = 100; // Default 100ms between events

    if (currentIndex > 0 && currentIndex < filteredEvents.length) {
      const prevEvent = filteredEvents[currentIndex - 1];
      const currEvent = filteredEvents[currentIndex];
      const timeDiff = new Date(currEvent.timestamp).getTime() - new Date(prevEvent.timestamp).getTime();
      delay = Math.max(10, Math.min(5000, timeDiff / speed));
    }

    playbackTimerRef.current = setTimeout(() => {
      const event = filteredEvents[currentIndex];
      if (event) {
        setDisplayedEvents(prev => [...prev, event]);
        onEvent?.(event, currentIndex + 1, filteredEvents.length);
      }
      setCurrentIndex(prev => prev + 1);
    }, delay);
  }, [state, currentIndex, filteredEvents, speed, onEvent, updateState]);

  // Effect for playback scheduling
  useEffect(() => {
    if (state === 'playing') {
      scheduleNextEvent();
    }
    return () => clearTimer();
  }, [state, currentIndex, scheduleNextEvent, clearTimer]);

  // Reset when events change
  useEffect(() => {
    reset();
  }, [events, filterWorker]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (eventListRef.current && state === 'playing') {
      eventListRef.current.scrollTop = eventListRef.current.scrollHeight;
    }
  }, [displayedEvents, state]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          toggle();
          break;
        case 'ArrowRight':
        case 'n':
          stepForward();
          break;
        case 'ArrowLeft':
        case 'b':
          stepBackward();
          break;
        case 'ArrowUp':
          increaseSpeed();
          break;
        case 'ArrowDown':
          decreaseSpeed();
          break;
        case 'Home':
          seekTo(0);
          break;
        case 'End':
          seekTo(filteredEvents.length - 1);
          break;
        case 'r':
          reset();
          break;
        case '1':
          setSpeed(0.5);
          break;
        case '2':
          setSpeed(1);
          break;
        case '3':
          setSpeed(2);
          break;
        case '4':
          setSpeed(5);
          break;
        case '5':
          setSpeed(10);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredEvents.length, state, currentIndex, speed]);

  // Playback controls
  const play = useCallback(() => {
    if (state === 'ended' || filteredEvents.length === 0) return;
    updateState('playing');
  }, [state, filteredEvents.length, updateState]);

  const pause = useCallback(() => {
    if (state !== 'playing') return;
    clearTimer();
    updateState('paused');
  }, [state, clearTimer, updateState]);

  const toggle = useCallback(() => {
    if (state === 'playing') {
      pause();
    } else {
      play();
    }
  }, [state, play, pause]);

  const stepForward = useCallback(() => {
    if (currentIndex >= filteredEvents.length - 1) return;
    pause();
    const newIndex = currentIndex + 1;
    setCurrentIndex(newIndex);
    const event = filteredEvents[newIndex];
    if (event) {
      setDisplayedEvents(prev => [...prev, event]);
      onEvent?.(event, newIndex + 1, filteredEvents.length);
    }
  }, [currentIndex, filteredEvents, pause, onEvent]);

  const stepBackward = useCallback(() => {
    if (currentIndex <= 0) return;
    pause();
    const newIndex = currentIndex - 1;
    setCurrentIndex(newIndex);
    // Rebuild displayed events up to new index
    setDisplayedEvents(filteredEvents.slice(0, newIndex + 1));
    const event = filteredEvents[newIndex];
    if (event) {
      onEvent?.(event, newIndex + 1, filteredEvents.length);
    }
  }, [currentIndex, filteredEvents, pause, onEvent]);

  const seekTo = useCallback((index: number) => {
    const safeIndex = Math.max(0, Math.min(index, filteredEvents.length - 1));
    if (safeIndex === currentIndex) return;
    pause();
    setCurrentIndex(safeIndex);
    // Rebuild displayed events up to new index
    setDisplayedEvents(filteredEvents.slice(0, safeIndex + 1));
    const event = filteredEvents[safeIndex];
    if (event) {
      onEvent?.(event, safeIndex + 1, filteredEvents.length);
    }
  }, [currentIndex, filteredEvents, pause, onEvent]);

  const seekToPercent = useCallback((percent: number) => {
    const index = Math.floor((percent / 100) * (filteredEvents.length - 1));
    seekTo(index);
  }, [filteredEvents.length, seekTo]);

  const increaseSpeed = useCallback(() => {
    const speeds: ReplaySpeed[] = [0.5, 1, 2, 5, 10];
    const currentIdx = speeds.indexOf(speed);
    if (currentIdx < speeds.length - 1) {
      setSpeed(speeds[currentIdx + 1]);
    }
  }, [speed]);

  const decreaseSpeed = useCallback(() => {
    const speeds: ReplaySpeed[] = [0.5, 1, 2, 5, 10];
    const currentIdx = speeds.indexOf(speed);
    if (currentIdx > 0) {
      setSpeed(speeds[currentIdx - 1]);
    }
  }, [speed]);

  const reset = useCallback(() => {
    pause();
    setCurrentIndex(0);
    setDisplayedEvents([]);
    updateState('idle');
  }, [pause, updateState]);

  // Handle timeline click
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = ((e.clientX - rect.left) / rect.width) * 100;
    seekToPercent(percent);
  };

  // Format event for display
  const formatEvent = (event: LogEvent): React.ReactNode => {
    const time = new Date(event.timestamp).toLocaleTimeString();
    const workerShort = event.worker.slice(0, 8);

    return (
      <>
        <span className="replay-event-time">{time}</span>
        <span className="replay-event-worker">{workerShort}</span>
        <span className="replay-event-level" style={{ color: getLevelColor(event.level) }}>
          {event.level.toUpperCase()}
        </span>
        {event.tool && <span className="replay-event-tool">[{event.tool}]</span>}
        <span className="replay-event-message">{event.message}</span>
      </>
    );
  };

  return (
    <div className={`session-replay ${className}`}>
      {/* Timeline bar */}
      <div className="replay-timeline">
        <span className="replay-state-icon">{getStateIcon(state)}</span>
        <div className="replay-progress-bar" onClick={handleTimelineClick}>
          <div
            className="replay-progress-fill"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        <span className="replay-progress-text">
          {progress.percent}% ({progress.current}/{progress.total})
        </span>
        {timeRange && (
          <span className="replay-time-range">
            {timeRange.start} - {timeRange.end}
          </span>
        )}
      </div>

      {/* Event log */}
      <div className="replay-event-list" ref={eventListRef}>
        {displayedEvents.length === 0 ? (
          <div className="replay-empty">
            {filteredEvents.length === 0
              ? 'No events to replay'
              : 'Press Space or click Play to start replay'}
          </div>
        ) : (
          displayedEvents.map((event, idx) => (
            <div key={idx} className="replay-event-item">
              {formatEvent(event)}
            </div>
          ))
        )}
      </div>

      {/* Controls bar */}
      <div className="replay-controls">
        <div className="replay-controls-left">
          <button
            className="replay-btn"
            onClick={() => seekTo(0)}
            disabled={currentIndex === 0}
            title="Go to start (Home)"
          >
            ⏮
          </button>
          <button
            className="replay-btn"
            onClick={stepBackward}
            disabled={currentIndex === 0}
            title="Step backward (←)"
          >
            ⏪
          </button>
          <button
            className="replay-btn replay-btn-primary"
            onClick={toggle}
            disabled={filteredEvents.length === 0 || state === 'ended'}
            title="Play/Pause (Space)"
          >
            {state === 'playing' ? '⏸' : '▶'}
          </button>
          <button
            className="replay-btn"
            onClick={stepForward}
            disabled={currentIndex >= filteredEvents.length - 1}
            title="Step forward (→)"
          >
            ⏩
          </button>
          <button
            className="replay-btn"
            onClick={() => seekTo(filteredEvents.length - 1)}
            disabled={currentIndex >= filteredEvents.length - 1}
            title="Go to end (End)"
          >
            ⏭
          </button>
          <button
            className="replay-btn"
            onClick={reset}
            title="Reset (r)"
          >
            🔄
          </button>
        </div>

        <div className="replay-controls-center">
          <span className="replay-speed-label">Speed:</span>
          {[0.5, 1, 2, 5, 10].map((s) => (
            <button
              key={s}
              className={`replay-btn replay-btn-speed ${speed === s ? 'active' : ''}`}
              onClick={() => setSpeed(s as ReplaySpeed)}
              title={`Set speed to ${s}x (${[0.5, 1, 2, 5, 10].indexOf(s) + 1})`}
            >
              {s}x
            </button>
          ))}
        </div>

        <div className="replay-controls-right">
          <span className="replay-help">
            [Space] Play/Pause | [←/→] Step | [↑/↓] Speed | [r] Reset
          </span>
        </div>
      </div>
    </div>
  );
};

export default SessionReplay;
