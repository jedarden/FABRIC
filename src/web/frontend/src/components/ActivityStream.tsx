import React, { useEffect, useRef, useMemo } from 'react';
import { LogEvent } from '../types';
import FilterControls, { ActivityFilter } from './FilterControls';

interface ActivityStreamProps {
  events: LogEvent[];
  selectedWorker: string | null;
  workers?: string[];
  showFilters?: boolean;
  pinnedBeads?: Set<string>;
  onTogglePinBead?: (beadId: string) => void;
  focusModeEnabled?: boolean;
}

const ActivityStream: React.FC<ActivityStreamProps> = ({
  events,
  selectedWorker,
  workers = [],
  showFilters = false,
  pinnedBeads = new Set(),
  onTogglePinBead,
  focusModeEnabled = false,
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

  const handlePinBead = (e: React.MouseEvent, beadId: string) => {
    e.stopPropagation();
    if (onTogglePinBead) {
      onTogglePinBead(beadId);
    }
  };

  // Get unique beads from events
  const uniqueBeads = useMemo(() => {
    const beadSet = new Set<string>();
    filteredEvents.forEach(e => {
      if (e.bead) {
        beadSet.add(e.bead);
      }
    });
    return Array.from(beadSet);
  }, [filteredEvents]);

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
        <div className="activity-stream-header">
          <h2>
            {selectedWorker ? `Events for ${selectedWorker}` : 'All Events'}
            <span style={{ marginLeft: '1rem', fontWeight: 'normal', color: '#666' }}>
              ({filteredEvents.length})
            </span>
          </h2>
          {onTogglePinBead && uniqueBeads.length > 0 && (
            <div className="bead-pins">
              <span className="bead-pins-label">Beads:</span>
              {uniqueBeads.slice(0, 5).map(beadId => {
                const isPinned = pinnedBeads.has(beadId);
                return (
                  <button
                    key={beadId}
                    className={`bead-pin-button ${isPinned ? 'pinned' : ''}`}
                    onClick={(e) => handlePinBead(e, beadId)}
                    title={isPinned ? `Unpin ${beadId}` : `Pin ${beadId} for Focus Mode`}
                  >
                    {isPinned ? '📌' : '📍'} {beadId}
                  </button>
                );
              })}
              {uniqueBeads.length > 5 && (
                <span className="bead-more-indicator">
                  +{uniqueBeads.length - 5} more
                </span>
              )}
            </div>
          )}
        </div>

        <div className="event-list" ref={listRef}>
          {filteredEvents.length === 0 ? (
            <div className="no-events">
              {events.length === 0
                ? 'No events to display'
                : 'No events match the current filters'}
            </div>
          ) : (
            filteredEvents.map((event, i) => {
              const eventBeadPinned = event.bead && pinnedBeads.has(event.bead);
              return (
                <div
                  key={`${event.timestamp}-${i}`}
                  className={`event-item ${eventBeadPinned ? 'bead-pinned' : ''}`}
                >
                  <span className="event-time">{formatTime(event.timestamp)}</span>
                  <span className={`event-level ${event.level}`}>{event.level}</span>
                  {!selectedWorker && (
                    <span className="event-worker">[{truncateWorker(event.worker)}]</span>
                  )}
                  {event.bead && (
                    <span className="event-bead" title={`Bead: ${event.bead}`}>
                      [{event.bead}]
                    </span>
                  )}
                  <span className="event-message">
                    {event.tool ? `[${event.tool}] ` : ''}{event.message}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default ActivityStream;
