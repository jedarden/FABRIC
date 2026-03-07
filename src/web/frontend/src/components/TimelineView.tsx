import React, { useMemo, useState, useRef, useCallback } from 'react';
import { LogEvent, WorkerInfo } from '../types';

export type TimeRange = '5m' | '10m' | '30m' | '1h';

interface TimelineViewProps {
  events: LogEvent[];
  workers: WorkerInfo[];
  onTimeSelect?: (timestamp: number) => void;
  selectedWorker?: string | null;
  focusModeEnabled?: boolean;
  pinnedWorkers?: Set<string>;
  defaultTimeRange?: TimeRange;
}

interface WorkerTimelineData {
  workerId: string;
  status: 'active' | 'idle' | 'error';
  segments: TimelineSegment[];
}

interface TimelineSegment {
  start: number;
  end: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  eventCount: number;
}

const TIME_RANGE_MS: Record<TimeRange, number> = {
  '5m': 5 * 60 * 1000,
  '10m': 10 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
};

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  '5m': '5 min',
  '10m': '10 min',
  '30m': '30 min',
  '1h': '1 hour',
};

const LEVEL_COLORS: Record<string, string> = {
  'debug': 'var(--info)',
  'info': 'var(--success)',
  'warn': 'var(--warning)',
  'error': 'var(--error)',
};

const STATUS_OPACITY: Record<string, number> = {
  'active': 1,
  'idle': 0.4,
  'error': 0.8,
};

const TimelineView: React.FC<TimelineViewProps> = ({
  events,
  workers,
  onTimeSelect,
  selectedWorker,
  focusModeEnabled = false,
  pinnedWorkers = new Set(),
  defaultTimeRange = '10m',
}) => {
  const [timeRange, setTimeRange] = useState<TimeRange>(defaultTimeRange);
  const [hoveredSegment, setHoveredSegment] = useState<{ workerId: string; segment: TimelineSegment } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter workers based on focus mode
  const filteredWorkers = useMemo(() => {
    if (focusModeEnabled && pinnedWorkers.size > 0) {
      return workers.filter(w => pinnedWorkers.has(w.id));
    }
    return workers;
  }, [workers, focusModeEnabled, pinnedWorkers]);

  // Filter events based on focus mode
  const filteredEvents = useMemo(() => {
    let filtered = events;
    if (focusModeEnabled && pinnedWorkers.size > 0) {
      filtered = events.filter(e => pinnedWorkers.has(e.worker));
    }
    if (selectedWorker) {
      filtered = filtered.filter(e => e.worker === selectedWorker);
    }
    return filtered;
  }, [events, focusModeEnabled, pinnedWorkers, selectedWorker]);

  // Calculate timeline data
  const timelineData = useMemo(() => {
    const now = Date.now();
    const rangeStart = now - TIME_RANGE_MS[timeRange];

    // Create a map of worker activity
    const workerMap = new Map<string, WorkerTimelineData>();

    // Initialize workers
    filteredWorkers.forEach(worker => {
      workerMap.set(worker.id, {
        workerId: worker.id,
        status: worker.status,
        segments: [],
      });
    });

    // Also include workers from events that might not be in filteredWorkers
    filteredEvents.forEach(event => {
      if (!workerMap.has(event.worker)) {
        workerMap.set(event.worker, {
          workerId: event.worker,
          status: 'active',
          segments: [],
        });
      }
    });

    // Process events into timeline segments
    // Group events by worker and time buckets (30 second buckets)
    const BUCKET_SIZE = 30 * 1000; // 30 seconds
    const workerBuckets = new Map<string, Map<number, { count: number; levels: Map<string, number> }>>();

    filteredEvents
      .filter(e => new Date(e.timestamp).getTime() >= rangeStart)
      .forEach(event => {
        const eventTime = new Date(event.timestamp).getTime();
        const bucketStart = Math.floor(eventTime / BUCKET_SIZE) * BUCKET_SIZE;

        if (!workerBuckets.has(event.worker)) {
          workerBuckets.set(event.worker, new Map());
        }

        const buckets = workerBuckets.get(event.worker)!;
        if (!buckets.has(bucketStart)) {
          buckets.set(bucketStart, { count: 0, levels: new Map() });
        }

        const bucket = buckets.get(bucketStart)!;
        bucket.count++;
        bucket.levels.set(event.level, (bucket.levels.get(event.level) || 0) + 1);
      });

    // Convert buckets to segments
    workerBuckets.forEach((buckets, workerId) => {
      const workerData = workerMap.get(workerId);
      if (!workerData) return;

      buckets.forEach((bucket, bucketStart) => {
        // Find the dominant level
        let dominantLevel: 'debug' | 'info' | 'warn' | 'error' = 'info';
        let maxCount = 0;
        bucket.levels.forEach((count, level) => {
          if (count > maxCount) {
            maxCount = count;
            dominantLevel = level as 'debug' | 'info' | 'warn' | 'error';
          }
        });

        workerData.segments.push({
          start: bucketStart,
          end: bucketStart + BUCKET_SIZE,
          level: dominantLevel,
          eventCount: bucket.count,
        });
      });

      // Sort segments by time
      workerData.segments.sort((a, b) => a.start - b.start);
    });

    return {
      workers: Array.from(workerMap.values()),
      rangeStart,
      rangeEnd: now,
    };
  }, [filteredEvents, filteredWorkers, timeRange]);

  // Generate time axis labels
  const timeLabels = useMemo(() => {
    const labels: { time: number; label: string }[] = [];
    const now = Date.now();
    const rangeMs = TIME_RANGE_MS[timeRange];

    // Determine appropriate interval based on range
    let interval: number;
    if (timeRange === '5m') {
      interval = 60 * 1000; // 1 minute
    } else if (timeRange === '10m') {
      interval = 2 * 60 * 1000; // 2 minutes
    } else if (timeRange === '30m') {
      interval = 5 * 60 * 1000; // 5 minutes
    } else {
      interval = 10 * 60 * 1000; // 10 minutes
    }

    const start = now - rangeMs;
    for (let t = Math.ceil(start / interval) * interval; t <= now; t += interval) {
      labels.push({
        time: t,
        label: new Date(t).toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
        }),
      });
    }

    return labels;
  }, [timeRange]);

  // Handle click on timeline to select time
  const handleTimelineClick = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current || !onTimeSelect) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const rangeMs = TIME_RANGE_MS[timeRange];
    const clickedTime = timelineData.rangeStart + (percentage * rangeMs);

    onTimeSelect(clickedTime);
  }, [onTimeSelect, timeRange, timelineData.rangeStart]);

  // Truncate worker name for display
  const truncateWorker = (worker: string) => {
    const parts = worker.split('-');
    return parts[parts.length - 1];
  };

  return (
    <div className="timeline-view">
      <div className="timeline-header">
        <h3>Timeline (last {TIME_RANGE_LABELS[timeRange]})</h3>
        <div className="time-range-selector">
          {(Object.keys(TIME_RANGE_MS) as TimeRange[]).map(range => (
            <button
              key={range}
              className={`time-range-button ${timeRange === range ? 'active' : ''}`}
              onClick={() => setTimeRange(range)}
            >
              {TIME_RANGE_LABELS[range]}
            </button>
          ))}
        </div>
      </div>

      <div className="timeline-content" ref={containerRef} onClick={handleTimelineClick}>
        {/* Time axis */}
        <div className="timeline-axis">
          <div className="timeline-worker-label-spacer"></div>
          <div className="timeline-time-labels">
            {timeLabels.map((label, i) => (
              <span
                key={i}
                className="timeline-time-label"
                style={{
                  position: 'absolute',
                  left: `${((label.time - timelineData.rangeStart) / TIME_RANGE_MS[timeRange]) * 100}%`,
                  transform: 'translateX(-50%)',
                }}
              >
                {label.label}
              </span>
            ))}
          </div>
        </div>

        {/* Worker rows */}
        <div className="timeline-rows">
          {timelineData.workers.length === 0 ? (
            <div className="timeline-empty">
              No worker activity in this time range
            </div>
          ) : (
            timelineData.workers.map(workerData => (
              <div key={workerData.workerId} className="timeline-row">
                <div className="timeline-worker-label">
                  <span
                    className={`worker-status-dot ${workerData.status}`}
                    title={workerData.status}
                  ></span>
                  <span className="worker-name">{truncateWorker(workerData.workerId)}</span>
                </div>
                <div className="timeline-bar-container">
                  {workerData.segments.map((segment, i) => (
                    <div
                      key={i}
                      className="timeline-segment"
                      style={{
                        left: `${((segment.start - timelineData.rangeStart) / TIME_RANGE_MS[timeRange]) * 100}%`,
                        width: `${((segment.end - segment.start) / TIME_RANGE_MS[timeRange]) * 100}%`,
                        backgroundColor: LEVEL_COLORS[segment.level],
                        opacity: STATUS_OPACITY[workerData.status],
                      }}
                      onMouseEnter={() => setHoveredSegment({ workerId: workerData.workerId, segment })}
                      onMouseLeave={() => setHoveredSegment(null)}
                      title={`${workerData.workerId}: ${segment.eventCount} events at ${new Date(segment.start).toLocaleTimeString()}`}
                    />
                  ))}

                  {/* Hovered segment tooltip */}
                  {hoveredSegment && hoveredSegment.workerId === workerData.workerId && (
                    <div
                      className="timeline-tooltip"
                      style={{
                        left: `${((hoveredSegment.segment.start - timelineData.rangeStart) / TIME_RANGE_MS[timeRange]) * 100}%`,
                      }}
                    >
                      <div className="tooltip-time">
                        {new Date(hoveredSegment.segment.start).toLocaleTimeString()}
                      </div>
                      <div className="tooltip-count">
                        {hoveredSegment.segment.eventCount} events
                      </div>
                      <div className={`tooltip-level ${hoveredSegment.segment.level}`}>
                        {hoveredSegment.segment.level}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Current time indicator */}
        <div
          className="timeline-current-time"
          style={{
            left: '100%',
          }}
        ></div>
      </div>

      {onTimeSelect && (
        <div className="timeline-hint">
          Click on timeline to jump to that time in activity stream
        </div>
      )}
    </div>
  );
};

export default TimelineView;
