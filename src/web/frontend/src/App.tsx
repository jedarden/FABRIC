import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LogEvent, WorkerInfo, WebSocketMessage, CollisionAlert as CollisionAlertData, RecoverySuggestion } from './types';
import { ThemeProvider, useTheme } from './ThemeContext';
import WorkerGrid from './components/WorkerGrid';
import ActivityStream from './components/ActivityStream';
import WorkerDetail from './components/WorkerDetail';
import CollisionAlert from './components/CollisionAlert';
import FileHeatmap from './components/FileHeatmap';
import DependencyDag from './components/DependencyDag';
import RecoveryPanel from './components/RecoveryPanel';
import FileContextPanel from './components/FileContextPanel';
import TimelineView from './components/TimelineView';

const FOCUS_MODE_STORAGE_KEY = 'fabric-focus-mode';

// WebSocket reconnection configuration
const RECONNECT_BASE_DELAY = 1000; // 1 second
const RECONNECT_MAX_DELAY = 30000; // 30 seconds
const RECONNECT_MAX_RETRIES = 10;  // Max retries before manual intervention

// Connection states
type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';

interface ReconnectState {
  state: ConnectionState;
  attemptCount: number;
  nextRetryIn: number | null;
}

/**
 * Custom hook for WebSocket with auto-reconnect and exponential backoff
 */
function useWebSocketReconnect(
  onMessage: (message: WebSocketMessage) => void
): {
  reconnectState: ReconnectState;
  connect: () => void;
  disconnect: () => void;
  resetAndReconnect: () => void;
} {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptCountRef = useRef(0);

  const [reconnectState, setReconnectState] = useState<ReconnectState>({
    state: 'disconnected',
    attemptCount: 0,
    nextRetryIn: null,
  });

  const getReconnectDelay = useCallback((attempt: number): number => {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)
    const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, attempt), RECONNECT_MAX_DELAY);
    return delay;
  }, []);

  const clearTimers = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    clearTimers();

    if (attemptCountRef.current >= RECONNECT_MAX_RETRIES) {
      // Max retries reached - require manual intervention
      setReconnectState({
        state: 'disconnected',
        attemptCount: attemptCountRef.current,
        nextRetryIn: null,
      });
      return;
    }

    const delay = getReconnectDelay(attemptCountRef.current);
    const targetTime = Date.now() + delay;

    setReconnectState(prev => ({
      ...prev,
      state: 'reconnecting',
      attemptCount: attemptCountRef.current,
      nextRetryIn: Math.ceil(delay / 1000),
    }));

    // Countdown interval
    countdownIntervalRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((targetTime - Date.now()) / 1000));
      setReconnectState(prev => ({
        ...prev,
        nextRetryIn: remaining,
      }));
    }, 1000);

    // Schedule reconnect
    reconnectTimeoutRef.current = setTimeout(() => {
      attemptCountRef.current++;
      connectInternal();
    }, delay);
  }, [getReconnectDelay, clearTimers]);

  const connectInternal = useCallback(() => {
    clearTimers();

    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      attemptCountRef.current = 0;
      setReconnectState({
        state: 'connected',
        attemptCount: 0,
        nextRetryIn: null,
      });
      console.log('WebSocket connected');
    };

    ws.onclose = (event) => {
      console.log('WebSocket disconnected', event.code, event.reason);
      // Only attempt reconnect if not manually closed (1000 = normal closure)
      if (event.code !== 1000) {
        scheduleReconnect();
      } else {
        setReconnectState({
          state: 'disconnected',
          attemptCount: attemptCountRef.current,
          nextRetryIn: null,
        });
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WebSocketMessage;
        onMessage(message);
      } catch (err) {
        console.error('Failed to parse message:', err);
      }
    };
  }, [onMessage, clearTimers, scheduleReconnect]);

  const connect = useCallback(() => {
    connectInternal();
  }, [connectInternal]);

  const disconnect = useCallback(() => {
    clearTimers();
    if (wsRef.current) {
      wsRef.current.close(1000, 'Manual disconnect');
      wsRef.current = null;
    }
    setReconnectState({
      state: 'disconnected',
      attemptCount: 0,
      nextRetryIn: null,
    });
  }, [clearTimers]);

  const resetAndReconnect = useCallback(() => {
    clearTimers();
    attemptCountRef.current = 0;
    connectInternal();
  }, [clearTimers, connectInternal]);

  // Auto-connect on mount
  useEffect(() => {
    connectInternal();
    return () => {
      disconnect();
    };
  }, [connectInternal, disconnect]);

  return { reconnectState, connect, disconnect, resetAndReconnect };
}

interface FocusModeState {
  enabled: boolean;
  pinnedWorkers: string[];
  pinnedBeads: string[];
}

/**
 * Theme toggle button component
 */
const ThemeToggle: React.FC = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      className="theme-toggle"
      onClick={toggleTheme}
      title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      <span className="theme-toggle-icon">{theme === 'dark' ? '☀️' : '🌙'}</span>
      <span className="theme-toggle-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  );
};

const App: React.FC = () => {
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);
  const [collisionAlerts, setCollisionAlerts] = useState<CollisionAlertData[]>([]);
  const [showCollisionPanel, setShowCollisionPanel] = useState(false);
  const [showFileHeatmap, setShowFileHeatmap] = useState(false);
  const [showDependencyDag, setShowDependencyDag] = useState(false);
  const [showRecoveryPanel, setShowRecoveryPanel] = useState(false);
  const [showFileContext, setShowFileContext] = useState(false);
  const [showTimeline, setShowTimeline] = useState(true);
  const [selectedTimelineTime, setSelectedTimelineTime] = useState<number | null>(null);
  const [recoverySuggestions, setRecoverySuggestions] = useState<RecoverySuggestion[]>([]);

  // Focus Mode state
  const [focusModeEnabled, setFocusModeEnabled] = useState(false);
  const [pinnedWorkers, setPinnedWorkers] = useState<Set<string>>(new Set());
  const [pinnedBeads, setPinnedBeads] = useState<Set<string>>(new Set());

  // Load Focus Mode state from localStorage on mount
  useEffect(() => {
    const savedState = localStorage.getItem(FOCUS_MODE_STORAGE_KEY);
    if (savedState) {
      try {
        const parsed: FocusModeState = JSON.parse(savedState);
        setFocusModeEnabled(parsed.enabled);
        setPinnedWorkers(new Set(parsed.pinnedWorkers));
        setPinnedBeads(new Set(parsed.pinnedBeads));
      } catch (error) {
        console.error('Failed to parse Focus Mode state:', error);
      }
    }
  }, []);

  // Save Focus Mode state to localStorage whenever it changes
  useEffect(() => {
    const state: FocusModeState = {
      enabled: focusModeEnabled,
      pinnedWorkers: Array.from(pinnedWorkers),
      pinnedBeads: Array.from(pinnedBeads),
    };
    localStorage.setItem(FOCUS_MODE_STORAGE_KEY, JSON.stringify(state));
  }, [focusModeEnabled, pinnedWorkers, pinnedBeads]);

  const handleWebSocketMessage = useCallback((message: WebSocketMessage) => {
    if (message.type === 'init') {
      const data = message.data as { workers?: WorkerInfo[]; recentEvents?: LogEvent[]; alerts?: CollisionAlertData[] };
      if (data.workers) setWorkers(data.workers);
      if (data.recentEvents) setEvents(data.recentEvents);
      if (data.alerts) setCollisionAlerts(data.alerts);
    } else if (message.type === 'event') {
      const event = message.data as LogEvent;
      setEvents(prev => [...prev.slice(-199), event]);

      // Update worker info
      setWorkers(prev => {
        const existing = prev.find(w => w.id === event.worker);
        if (existing) {
          return prev.map(w => w.id === event.worker ? {
            ...w,
            lastSeen: event.timestamp,
            eventCount: w.eventCount + 1,
            status: 'active' as const,
            currentTool: event.tool,
            recentEvents: [...w.recentEvents.slice(-9), event],
          } : w);
        } else {
          return [...prev, {
            id: event.worker,
            lastSeen: event.timestamp,
            eventCount: 1,
            status: 'active' as const,
            currentTool: event.tool,
            recentEvents: [event],
          }];
        }
      });
    } else if (message.type === 'collision-alert') {
      const alert = message.data as CollisionAlertData;
      setCollisionAlerts(prev => {
        // Avoid duplicates
        if (prev.some(a => a.id === alert.id)) {
          return prev.map(a => a.id === alert.id ? alert : a);
        }
        return [...prev, alert];
      });
    }
  }, []);

  // Use the auto-reconnect hook
  const { reconnectState, resetAndReconnect } = useWebSocketReconnect(handleWebSocketMessage);

  const filteredEvents = selectedWorker
    ? filteredEventsByFocusMode.filter(e => e.worker === selectedWorker)
    : filteredEventsByFocusMode;

  const selectedWorkerInfo = selectedWorker
    ? filteredWorkers.find(w => w.id === selectedWorker)
    : null;

  const handleAcknowledgeAlert = useCallback((alertId: string) => {
    setCollisionAlerts(prev =>
      prev.map(a => a.id === alertId ? { ...a, acknowledged: true } : a)
    );
  }, []);

  const handleAcknowledgeAllAlerts = useCallback(() => {
    setCollisionAlerts(prev =>
      prev.map(a => ({ ...a, acknowledged: true }))
    );
  }, []);

  const unacknowledgedAlertCount = collisionAlerts.filter(a => !a.acknowledged).length;

  // Focus Mode callbacks
  const toggleFocusMode = useCallback(() => {
    setFocusModeEnabled(prev => !prev);
  }, []);

  const togglePinWorker = useCallback((workerId: string) => {
    setPinnedWorkers(prev => {
      const newSet = new Set(prev);
      if (newSet.has(workerId)) {
        newSet.delete(workerId);
      } else {
        newSet.add(workerId);
      }
      return newSet;
    });
  }, []);

  const togglePinBead = useCallback((beadId: string) => {
    setPinnedBeads(prev => {
      const newSet = new Set(prev);
      if (newSet.has(beadId)) {
        newSet.delete(beadId);
      } else {
        newSet.add(beadId);
      }
      return newSet;
    });
  }, []);

  // Timeline time selection handler
  const handleTimelineTimeSelect = useCallback((timestamp: number) => {
    setSelectedTimelineTime(timestamp);
    // Clear the selection after 5 seconds
    setTimeout(() => setSelectedTimelineTime(null), 5000);
  }, []);

  // Filter workers and events based on Focus Mode
  const filteredWorkers = focusModeEnabled && pinnedWorkers.size > 0
    ? workers.filter(w => pinnedWorkers.has(w.id))
    : workers;

  const filteredEventsByFocusMode = focusModeEnabled && (pinnedWorkers.size > 0 || pinnedBeads.size > 0)
    ? events.filter(e => {
        const matchesPinnedWorker = pinnedWorkers.size === 0 || pinnedWorkers.has(e.worker);
        const matchesPinnedBead = pinnedBeads.size === 0 || (e.bead && pinnedBeads.has(e.bead));
        return matchesPinnedWorker || matchesPinnedBead;
      })
    : events;

  return (
    <div className="app">
      <header className="header">
        <h1>FABRIC</h1>
        <div className="header-actions">
          <ThemeToggle />
          <button
            className={`focus-mode-toggle ${focusModeEnabled ? 'active' : ''}`}
            onClick={toggleFocusMode}
            title={focusModeEnabled ? 'Focus Mode: ON (showing pinned only)' : 'Focus Mode: OFF (showing all)'}
          >
            <span className="focus-mode-icon">{focusModeEnabled ? '📌' : '📍'}</span>
            <span className="focus-mode-label">Focus</span>
            {focusModeEnabled && (pinnedWorkers.size > 0 || pinnedBeads.size > 0) && (
              <span className="focus-mode-count">
                {pinnedWorkers.size + pinnedBeads.size}
              </span>
            )}
          </button>
          <button
            className="dag-toggle"
            onClick={() => setShowDependencyDag(!showDependencyDag)}
            title="View task dependency graph"
          >
            <span className="dag-toggle-icon">🔗</span>
            <span className="dag-toggle-label">DAG</span>
          </button>
          <button
            className="recovery-toggle"
            onClick={() => setShowRecoveryPanel(!showRecoveryPanel)}
            title="View recovery suggestions"
          >
            <span className="recovery-toggle-icon">💊</span>
            <span className="recovery-toggle-label">Recovery</span>
          </button>
          <button
            className="file-heatmap-toggle"
            onClick={() => setShowFileHeatmap(!showFileHeatmap)}
            title="View file heatmap"
          >
            <span className="file-heatmap-icon">🔥</span>
            <span className="file-heatmap-label">Heatmap</span>
          </button>
          <button
            className="file-context-toggle"
            onClick={() => setShowFileContext(!showFileContext)}
            title="Toggle file context panel"
          >
            <span className="file-context-icon">📄</span>
            <span className="file-context-label">Context</span>
          </button>
          <button
            className={`timeline-toggle ${showTimeline ? 'active' : ''}`}
            onClick={() => setShowTimeline(!showTimeline)}
            title={showTimeline ? 'Hide timeline' : 'Show timeline'}
          >
            <span className="timeline-toggle-icon">📊</span>
            <span className="timeline-toggle-label">Timeline</span>
          </button>
          {unacknowledgedAlertCount > 0 && (
            <button
              className="collision-alert-toggle"
              onClick={() => setShowCollisionPanel(!showCollisionPanel)}
              title="View collision alerts"
            >
              <span className="collision-alert-icon">!</span>
              <span className="collision-alert-count">{unacknowledgedAlertCount}</span>
            </button>
          )}
          <div className={`connection-status ${reconnectState.state}`}>
            <span className={`status-dot ${reconnectState.state}`}></span>
            {reconnectState.state === 'connected' && 'Connected'}
            {reconnectState.state === 'reconnecting' && (
              <span className="reconnecting-text">
                Reconnecting...
                {reconnectState.nextRetryIn !== null && (
                  <span className="retry-countdown"> ({reconnectState.nextRetryIn}s)</span>
                )}
                <span className="attempt-count">[{reconnectState.attemptCount + 1}]</span>
              </span>
            )}
            {reconnectState.state === 'disconnected' && (
              <>
                <span>Disconnected</span>
                <button
                  className="reconnect-button"
                  onClick={resetAndReconnect}
                  title="Click to reconnect"
                >
                  Retry
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="main-content">
        <WorkerGrid
          workers={filteredWorkers}
          selectedWorker={selectedWorker}
          onSelectWorker={setSelectedWorker}
          pinnedWorkers={pinnedWorkers}
          onTogglePin={togglePinWorker}
          focusModeEnabled={focusModeEnabled}
        />

        {showTimeline && (
          <TimelineView
            events={filteredEvents}
            workers={filteredWorkers}
            onTimeSelect={handleTimelineTimeSelect}
            selectedWorker={selectedWorker}
            focusModeEnabled={focusModeEnabled}
            pinnedWorkers={pinnedWorkers}
          />
        )}

        <ActivityStream
          events={filteredEvents}
          selectedWorker={selectedWorker}
          pinnedBeads={pinnedBeads}
          onTogglePinBead={togglePinBead}
          focusModeEnabled={focusModeEnabled}
          selectedTimelineTime={selectedTimelineTime}
        />

        {selectedWorkerInfo && (
          <WorkerDetail
            worker={selectedWorkerInfo}
            onClose={() => setSelectedWorker(null)}
            allWorkerEvents={selectedWorker ? filteredEvents : undefined}
          />
        )}

        {showCollisionPanel && (
          <CollisionAlert
            alerts={collisionAlerts}
            onAcknowledge={handleAcknowledgeAlert}
            onAcknowledgeAll={handleAcknowledgeAllAlerts}
            visible={showCollisionPanel}
            onClose={() => setShowCollisionPanel(false)}
          />
        )}

        {showFileHeatmap && (
          <FileHeatmap
            visible={showFileHeatmap}
            onClose={() => setShowFileHeatmap(false)}
          />
        )}

        {showDependencyDag && (
          <DependencyDag
            visible={showDependencyDag}
            onClose={() => setShowDependencyDag(false)}
          />
        )}

        {showRecoveryPanel && (
          <RecoveryPanel
            suggestions={recoverySuggestions}
            visible={showRecoveryPanel}
            onClose={() => setShowRecoveryPanel(false)}
          />
        )}

        {showFileContext && (
          <FileContextPanel
            visible={showFileContext}
            onClose={() => setShowFileContext(false)}
            events={filteredEvents}
            onOpenInEditor={(path, line) => {
              console.log(`Opening ${path}:${line || 1} in editor...`);
              // In a real implementation, this would trigger the editor
            }}
          />
        )}
      </main>
    </div>
  );
};

// Wrap with ThemeProvider for theme support
const AppWithTheme: React.FC = () => (
  <ThemeProvider>
    <App />
  </ThemeProvider>
);

export default AppWithTheme;
