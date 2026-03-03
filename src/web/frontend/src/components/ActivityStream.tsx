import React, { useEffect, useRef } from 'react';
import { LogEvent } from '../types';

interface ActivityStreamProps {
  events: LogEvent[];
  selectedWorker: string | null;
}

const ActivityStream: React.FC<ActivityStreamProps> = ({ events, selectedWorker }) => {
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events]);

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const truncateWorker = (worker: string) => {
    // Extract just the identifying part (e.g., "alpha" from "claude-code-glm-5-alpha")
    const parts = worker.split('-');
    return parts[parts.length - 1];
  };

  return (
    <div className="activity-stream">
      <h2>
        {selectedWorker ? `Events for ${selectedWorker}` : 'All Events'}
        <span style={{ marginLeft: '1rem', fontWeight: 'normal', color: '#666' }}>
          ({events.length})
        </span>
      </h2>

      <div className="event-list" ref={listRef}>
        {events.length === 0 ? (
          <div className="no-events">
            No events to display
          </div>
        ) : (
          events.map((event, i) => (
            <div key={`${event.timestamp}-${i}`} className="event-item">
              <span className="event-time">{formatTime(event.timestamp)}</span>
              <span className={`event-level ${event.level}`}>{event.level}</span>
              {!selectedWorker && (
                <span className="event-worker">[{truncateWorker(event.worker)}]</span>
              )}
              <span className="event-message">
                {event.tool ? `[${event.tool}] ` : ''}{event.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ActivityStream;
