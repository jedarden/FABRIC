import React, { useState, useEffect, useCallback } from 'react';
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

const FOCUS_MODE_STORAGE_KEY = 'fabric-focus-mode';

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
  const [connected, setConnected] = useState(false);
  const [collisionAlerts, setCollisionAlerts] = useState<CollisionAlertData[]>([]);
  const [showCollisionPanel, setShowCollisionPanel] = useState(false);
  const [showFileHeatmap, setShowFileHeatmap] = useState(false);
  const [showDependencyDag, setShowDependencyDag] = useState(false);
  const [showRecoveryPanel, setShowRecoveryPanel] = useState(false);
  const [showFileContext, setShowFileContext] = useState(false);
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

  useEffect(() => {
    const ws = new WebSocket(`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`);

    ws.onopen = () => {
      setConnected(true);
      console.log('WebSocket connected');
    };

    ws.onclose = () => {
      setConnected(false);
      console.log('WebSocket disconnected');
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WebSocketMessage;
        handleWebSocketMessage(message);
      } catch (err) {
        console.error('Failed to parse message:', err);
      }
    };

    return () => {
      ws.close();
    };
  }, [handleWebSocketMessage]);

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
          <div className="connection-status">
            <span className={`status-dot ${connected ? 'connected' : ''}`}></span>
            {connected ? 'Connected' : 'Disconnected'}
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

        <ActivityStream
          events={filteredEvents}
          selectedWorker={selectedWorker}
          pinnedBeads={pinnedBeads}
          onTogglePinBead={togglePinBead}
          focusModeEnabled={focusModeEnabled}
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
