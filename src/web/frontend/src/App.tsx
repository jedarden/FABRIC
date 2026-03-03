import React, { useState, useEffect, useCallback } from 'react';
import { LogEvent, WorkerInfo, WebSocketMessage } from './types';
import WorkerGrid from './components/WorkerGrid';
import ActivityStream from './components/ActivityStream';
import WorkerDetail from './components/WorkerDetail';

const App: React.FC = () => {
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const handleWebSocketMessage = useCallback((message: WebSocketMessage) => {
    if (message.type === 'init') {
      const data = message.data as { workers?: WorkerInfo[]; recentEvents?: LogEvent[] };
      if (data.workers) setWorkers(data.workers);
      if (data.recentEvents) setEvents(data.recentEvents);
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

  return (
    <div className="app">
      <header className="header">
        <h1>FABRIC</h1>
        <div className="connection-status">
          <span className={`status-dot ${connected ? 'connected' : ''}`}></span>
          {connected ? 'Connected' : 'Disconnected'}
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
      </main>
    </div>
  );
};

export default App;
