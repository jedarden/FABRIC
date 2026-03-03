import React, { useState, useEffect, useCallback } from 'react';
import { LogEvent, WorkerInfo, WebSocketMessage, CollisionAlert as CollisionAlertData, RecoverySuggestion } from './types';
import WorkerGrid from './components/WorkerGrid';
import ActivityStream from './components/ActivityStream';
import WorkerDetail from './components/WorkerDetail';
import CollisionAlert from './components/CollisionAlert';
import FileHeatmap from './components/FileHeatmap';
import DependencyDag from './components/DependencyDag';
import RecoveryPanel from './components/RecoveryPanel';

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
  const [recoverySuggestions, setRecoverySuggestions] = useState<RecoverySuggestion[]>([]);

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
    ? events.filter(e => e.worker === selectedWorker)
    : events;

  const selectedWorkerInfo = selectedWorker
    ? workers.find(w => w.id === selectedWorker)
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

  return (
    <div className="app">
      <header className="header">
        <h1>FABRIC</h1>
        <div className="header-actions">
          <button
            className="dag-toggle"
            onClick={() => setShowDependencyDag(!showDependencyDag)}
            title="View task dependency graph"
          >
            <span className="dag-toggle-icon">🔗</span>
            <span className="dag-toggle-label">DAG</span>
          </button>
          <button
            className="file-heatmap-toggle"
            onClick={() => setShowFileHeatmap(!showFileHeatmap)}
            title="View file heatmap"
          >
            <span className="file-heatmap-icon">🔥</span>
            <span className="file-heatmap-label">Heatmap</span>
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
          workers={workers}
          selectedWorker={selectedWorker}
          onSelectWorker={setSelectedWorker}
        />

        <ActivityStream
          events={filteredEvents}
          selectedWorker={selectedWorker}
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
      </main>
    </div>
  );
};

export default App;
