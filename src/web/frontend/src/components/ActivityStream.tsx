import React, { useEffect, useRef, useMemo } from 'react';
import { LogEvent } from '../types';
import FilterControls, { ActivityFilter } from './FilterControls';

interface ActivityStreamProps {
  events: LogEvent[];
  selectedWorker: string | null;
  workers?: string[];
  showFilters?: boolean;
}

const ActivityStream: React.FC<ActivityStreamProps> = ({
  events,
  selectedWorker,
  workers = [],
  showFilters = false,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = React.useState<ActivityFilter>({});

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events]);

  // Filter events based on filter criteria
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      // Worker filter
      if (filter.workerId && event.worker !== filter.workerId) {
        return false;
      }

      // Level filter
      if (filter.level && event.level !== filter.level) {
        return false;
      }

      // Time range filters
      const eventTime = new Date(event.timestamp).getTime();
      if (filter.since && eventTime < filter.since) {
        return false;
      }
      if (filter.until && eventTime > filter.until) {
        return false;
      }

      // Search filter
      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        const matchesSearch =
          event.message.toLowerCase().includes(searchLower) ||
          event.worker.toLowerCase().includes(searchLower) ||
          (event.tool?.toLowerCase().includes(searchLower) ?? false);
        if (!matchesSearch) {
          return false;
        }
      }

      return true;
    });
  }, [events, filter]);

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
    <div className="activity-stream-container">
      {showFilters && (
        <FilterControls
          onFilterChange={setFilter}
          workers={workers}
          filteredCount={filteredEvents.length}
          totalCount={events.length}
        />
      )}

      <div className="activity-stream">
        <h2>
          {selectedWorker ? `Events for ${selectedWorker}` : 'All Events'}
          <span style={{ marginLeft: '1rem', fontWeight: 'normal', color: '#666' }}>
            ({filteredEvents.length})
          </span>
        </h2>

        <div className="event-list" ref={listRef}>
          {filteredEvents.length === 0 ? (
            <div className="no-events">
              {events.length === 0
                ? 'No events to display'
                : 'No events match the current filters'}
            </div>
          ) : (
            filteredEvents.map((event, i) => (
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
    </div>
  );
};

export default ActivityStream;
