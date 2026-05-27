import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { LogEvent, WorkerInfo } from '../types';

interface BlockEventPopup {
  x: number;
  y: number;
  workerId: string;
  events: LogEvent[];
  time: number;
}

export type TimeRange = '5m' | '10m' | '30m' | '1h';
export type TimelineStyle = 'blocks' | 'bars';

interface TimelineViewProps {
  events: LogEvent[];
  workers: WorkerInfo[];
  onTimeSelect?: (timestamp: number) => void;
  onWorkerClick?: (workerId: string) => void;
  selectedWorker?: string | null;
  focusModeEnabled?: boolean;
  pinnedWorkers?: Set<string>;
  defaultTimeRange?: TimeRange;
  currentTime?: number;
  timelineStyle?: TimelineStyle;
  compactMode?: boolean;
}

interface WorkerTimelineData {
  workerId: string;
  status: 'active' | 'idle' | 'error';
  segments: TimelineSegment[];
  totalEvents: number;
  isActive: boolean;
}

interface TimelineSegment {
  start: number;
  end: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  eventCount: number;
  intensity: number; // 0-1 for block visualization
}

// Events arrive with ts (unix ms) from the server; timestamp (ISO string) is the
// frontend-normalised field. Accept either so the timeline works with both.
const getEventTime = (event: LogEvent): number =>
  event.ts ?? (event.timestamp ? Date.parse(event.timestamp) : 0);

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
  onWorkerClick,
  selectedWorker,
  focusModeEnabled = false,
  pinnedWorkers = new Set(),
  defaultTimeRange = '10m',
  currentTime: propCurrentTime,
  timelineStyle = 'blocks',
  compactMode = false,
}) => {
  const [timeRange, setTimeRange] = useState<TimeRange>(defaultTimeRange);
  const [style, setStyle] = useState<TimelineStyle>(timelineStyle);
  const [hoveredSegment, setHoveredSegment] = useState<{ workerId: string; segment: TimelineSegment } | null>(null);
  const [hoveredBlock, setHoveredBlock] = useState<{ workerId: string; time: number; eventCount: number; level: string } | null>(null);
  const [blockEventPopup, setBlockEventPopup] = useState<BlockEventPopup | null>(null);
  const [focusedBlockIndex, setFocusedBlockIndex] = useState<number | null>(null);
  const [localCurrentTime, setLocalCurrentTime] = useState<number>(Date.now());
  const [newEventHighlights, setNewEventHighlights] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevEventsLengthRef = useRef(0);

  // Use prop time if provided, otherwise use local time with auto-refresh
  const effectiveCurrentTime = propCurrentTime ?? localCurrentTime;

  // Auto-refresh current time every second for real-time feel
  useEffect(() => {
    if (propCurrentTime === undefined) {
      intervalRef.current = setInterval(() => {
        setLocalCurrentTime(Date.now());
      }, 1000);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [propCurrentTime]);

  // Keyboard navigation for blocks
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (focusedBlockIndex !== null && style === 'blocks') {
        const blockCount = 60; // Match the block count in generateBlocksWithMetadata
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          setFocusedBlockIndex(prev => (prev === null ? 0 : Math.min(blockCount - 1, prev + 1)));
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setFocusedBlockIndex(prev => (prev === null ? 0 : Math.max(0, prev - 1)));
        } else if (e.key === 'Enter' && onTimeSelect) {
          e.preventDefault();
          const now = effectiveCurrentTime;
          const rangeStart = now - TIME_RANGE_MS[timeRange];
          const blockTime = rangeStart + (focusedBlockIndex * TIME_RANGE_MS[timeRange]) / blockCount;
          onTimeSelect(blockTime);
        } else if (e.key === 'Escape') {
          setFocusedBlockIndex(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedBlockIndex, style, timeRange, effectiveCurrentTime, onTimeSelect]);

  // Close popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (blockEventPopup && containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setBlockEventPopup(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [blockEventPopup]);

  // Detect new events for highlight animation
  useEffect(() => {
    const currentLength = events.length;
    if (currentLength > prevEventsLengthRef.current) {
      // New events arrived - highlight the affected workers
      const newWorkers = new Set<string>();
      for (let i = prevEventsLengthRef.current; i < currentLength; i++) {
        newWorkers.add(events[i].worker);
      }
      setNewEventHighlights(newWorkers);

      // Clear highlights after animation
      const timeout = setTimeout(() => {
        setNewEventHighlights(new Set());
      }, 2000);

      return () => clearTimeout(timeout);
    }
    prevEventsLengthRef.current = currentLength;
  }, [events]);

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
    const now = effectiveCurrentTime;
    const rangeStart = now - TIME_RANGE_MS[timeRange];

    // Create a map of worker activity
    const workerMap = new Map<string, WorkerTimelineData>();

    // Initialize workers
    filteredWorkers.forEach(worker => {
      workerMap.set(worker.id, {
        workerId: worker.id,
        status: worker.status,
        segments: [],
        totalEvents: 0,
        isActive: worker.status === 'active',
      });
    });

    // Also include workers from events that might not be in filteredWorkers
    filteredEvents.forEach(event => {
      if (!workerMap.has(event.worker)) {
        workerMap.set(event.worker, {
          workerId: event.worker,
          status: 'active',
          segments: [],
          totalEvents: 0,
          isActive: true,
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
        const eventTime = getEventTime(event);
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

      let totalEventCount = 0;

      buckets.forEach((bucket, bucketStart) => {
        totalEventCount += bucket.count;

        // Find the dominant level
        let dominantLevel: 'debug' | 'info' | 'warn' | 'error' = 'info';
        let maxCount = 0;
        bucket.levels.forEach((count, level) => {
          if (count > maxCount) {
            maxCount = count;
            dominantLevel = level as 'debug' | 'info' | 'warn' | 'error';
          }
        });

        // Calculate intensity (0-1) based on event density
        // Higher intensity = more filled blocks
        const intensity = Math.min(1, bucket.count / 10); // 10+ events = full intensity

        workerData.segments.push({
          start: bucketStart,
          end: bucketStart + BUCKET_SIZE,
          level: dominantLevel,
          eventCount: bucket.count,
          intensity,
        });
      });

      workerData.totalEvents = totalEventCount;

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
    const now = effectiveCurrentTime;
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
  // Matches plan mockup: "worker-alpha" -> "alpha", "w-bravo" -> "bravo"
  const truncateWorker = (worker: string) => {
    // Remove common prefixes and get the last meaningful segment
    const parts = worker.split('-');
    const lastSegment = parts[parts.length - 1];

    // If the last segment is a UUID or hash, try the second-to-last
    if (lastSegment && lastSegment.length > 16) {
      return parts.length > 1 ? parts[parts.length - 2] : worker.slice(0, 10);
    }

    return lastSegment || worker.slice(0, 8);
  };

  // Generate block visualization for compact mode with color-coded log levels
  const generateBlocksWithMetadata = useCallback((segments: TimelineSegment[]) => {
    // Divide timeline into blocks (each block represents ~30 seconds)
    const blockCount = 60; // Number of blocks in the timeline
    const blocks: { char: string; level: string; intensity: number }[] = [];
    const now = effectiveCurrentTime;
    const rangeStart = now - TIME_RANGE_MS[timeRange];

    for (let i = 0; i < blockCount; i++) {
      const blockStart = rangeStart + (i * TIME_RANGE_MS[timeRange]) / blockCount;
      const blockEnd = blockStart + TIME_RANGE_MS[timeRange] / blockCount;

      // Find segments that overlap with this block
      const overlappingSegments = segments.filter(
        s => s.start < blockEnd && s.end > blockStart
      );

      if (overlappingSegments.length === 0) {
        blocks.push({ char: '░', level: 'none', intensity: 0 });
      } else {
        // Determine block character and color based on intensity and level
        const totalIntensity = overlappingSegments.reduce((sum, s) => sum + s.intensity, 0);
        const avgIntensity = totalIntensity / overlappingSegments.length;
        const hasError = overlappingSegments.some(s => s.level === 'error');
        const hasWarn = overlappingSegments.some(s => s.level === 'warn');
        const hasInfo = overlappingSegments.some(s => s.level === 'info');

        // Prioritize error > warn > info > debug for color coding
        let dominantLevel = 'debug';
        if (hasError) dominantLevel = 'error';
        else if (hasWarn) dominantLevel = 'warn';
        else if (hasInfo) dominantLevel = 'info';

        // Choose block character based on intensity
        let blockChar = '░';
        if (avgIntensity > 0.7) blockChar = '█';
        else if (avgIntensity > 0.4) blockChar = '▓';
        else if (avgIntensity > 0.1) blockChar = '▒';

        blocks.push({ char: blockChar, level: dominantLevel, intensity: avgIntensity });
      }
    }

    return blocks;
  }, [effectiveCurrentTime, timeRange]);

  // Handle worker click
  const handleWorkerClick = useCallback((workerId: string) => {
    if (onWorkerClick) {
      onWorkerClick(workerId);
    }
  }, [onWorkerClick]);

  // Handle click on individual block to jump to that time and show events
  const handleBlockClick = useCallback((blockIndex: number, workerId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const now = effectiveCurrentTime;
    const rangeStart = now - TIME_RANGE_MS[timeRange];
    const blockCount = 60;
    const blockStart = rangeStart + (blockIndex * TIME_RANGE_MS[timeRange]) / blockCount;
    const blockEnd = blockStart + TIME_RANGE_MS[timeRange] / blockCount;

    // Find events in this time range for this worker
    const blockEvents = filteredEvents.filter(event => {
      const eventTime = getEventTime(event);
      return event.worker === workerId && eventTime >= blockStart && eventTime < blockEnd;
    });

    // Set popup with event details
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setBlockEventPopup({
      x: rect.left + rect.width / 2,
      y: rect.top,
      workerId,
      events: blockEvents,
      time: blockStart,
    });

    // Also trigger time selection if callback provided
    if (onTimeSelect) {
      onTimeSelect(blockStart);
    }
  }, [effectiveCurrentTime, timeRange, filteredEvents, onTimeSelect]);

  return (
    <div className={`timeline-view ${style} ${compactMode ? 'compact' : ''}`}>
      <div className="timeline-header">
        <h3>Timeline (last {TIME_RANGE_LABELS[timeRange]})</h3>
        <div className="timeline-header-controls">
          <button
            className={`style-toggle ${style === 'blocks' ? 'active' : ''}`}
            onClick={() => setStyle(style === 'blocks' ? 'bars' : 'blocks')}
            title={style === 'blocks' ? 'Switch to bar view' : 'Switch to block view'}
          >
            {style === 'blocks' ? '░░' : '▬▬'}
          </button>
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
            timelineData.workers.map(workerData => {
              const blocks = generateBlocksWithMetadata(workerData.segments);
              return (
                <div
                  key={workerData.workerId}
                  className={`timeline-row ${selectedWorker === workerData.workerId ? 'selected' : ''} ${newEventHighlights.has(workerData.workerId) ? 'new-activity' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleWorkerClick(workerData.workerId);
                  }}
                >
                  <div className="timeline-worker-label">
                    <span
                      className={`worker-status-dot ${workerData.status}`}
                      title={workerData.status}
                    ></span>
                    <span className="worker-name" title={workerData.workerId}>
                      {truncateWorker(workerData.workerId)}
                    </span>
                    {workerData.totalEvents > 0 && (
                      <span className="worker-event-count">({workerData.totalEvents})</span>
                    )}
                  </div>
                  <div className="timeline-bar-container">
                    {style === 'blocks' ? (
                      <div className="timeline-blocks">
                        <span className="block-visualization">
                          {blocks.map((block, i) => {
                            const now = effectiveCurrentTime;
                            const rangeStart = now - TIME_RANGE_MS[timeRange];
                            const blockCount = 60;
                            const blockStart = rangeStart + (i * TIME_RANGE_MS[timeRange]) / blockCount;
                            const blockEnd = blockStart + TIME_RANGE_MS[timeRange] / blockCount;

                            // Find events in this time range for this worker
                            const blockEvents = filteredEvents.filter(event => {
                              const eventTime = getEventTime(event);
                              return event.worker === workerData.workerId && eventTime >= blockStart && eventTime < blockEnd;
                            });

                            return (
                              <span
                                key={i}
                                className={`block-char block-level-${block.level} ${focusedBlockIndex === i ? 'block-focused' : ''}`}
                                style={{
                                  color: block.level === 'none' ? 'var(--text-tertiary)' : LEVEL_COLORS[block.level],
                                  opacity: block.level === 'none' ? 0.3 : 0.6 + block.intensity * 0.4,
                                }}
                                title={`Level: ${block.level}, Intensity: ${(block.intensity * 100).toFixed(0)}%${blockEvents.length > 0 ? `, ${blockEvents.length} event${blockEvents.length > 1 ? 's' : ''}` : ''}`}
                                onClick={(e) => handleBlockClick(i, workerData.workerId, e)}
                                onMouseEnter={() => {
                                  if (blockEvents.length > 0) {
                                    setHoveredBlock({
                                      workerId: workerData.workerId,
                                      time: blockStart,
                                      eventCount: blockEvents.length,
                                      level: block.level,
                                    });
                                  }
                                }}
                                onMouseLeave={() => setHoveredBlock(null)}
                                tabIndex={0}
                                role="button"
                                aria-label={`Time block ${i}: ${block.level} level, ${blockEvents.length} events`}
                              >
                                {block.char}
                              </span>
                            );
                          })}
                        </span>
                      </div>
                    ) : (
                      <>
                        {workerData.segments.map((segment, i) => (
                          <div
                            key={i}
                            className="timeline-segment"
                            style={{
                              left: `${((segment.start - timelineData.rangeStart) / TIME_RANGE_MS[timeRange]) * 100}%`,
                              width: `${((segment.end - segment.start) / TIME_RANGE_MS[timeRange]) * 100}%`,
                              backgroundColor: LEVEL_COLORS[segment.level],
                              opacity: STATUS_OPACITY[workerData.status] * (0.6 + segment.intensity * 0.4),
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
                              left: `${Math.min(100, Math.max(0, ((hoveredSegment.segment.start - timelineData.rangeStart) / TIME_RANGE_MS[timeRange]) * 100))}%`,
                              transform: 'translateX(-50%)',
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
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Current time indicator */}
        <div
          className="timeline-current-time"
          style={{
            left: '100%',
          }}
        >
          <span className="current-time-pulse"></span>
        </div>
      </div>

      {onTimeSelect && (
        <div className="timeline-hint">
          {style === 'blocks' ? 'Click blocks to see events • Arrow keys to navigate • Enter to select' : 'Click on timeline to jump to that time in activity stream'}
        </div>
      )}

      {/* Block event popup */}
      {blockEventPopup && (
        <div
          className="timeline-block-popup"
          style={{
            left: `${Math.min(window.innerWidth - 300, Math.max(50, blockEventPopup.x))}px`,
            top: `${Math.max(10, blockEventPopup.y - 20)}px`,
          }}
        >
          <div className="timeline-block-popup-header">
            <span className="popup-worker-name">{truncateWorker(blockEventPopup.workerId)}</span>
            <button
              className="popup-close"
              onClick={() => setBlockEventPopup(null)}
              aria-label="Close popup"
            >
              ×
            </button>
          </div>
          <div className="timeline-block-popup-time">
            {new Date(blockEventPopup.time).toLocaleTimeString()}
          </div>
          <div className="timeline-block-popup-events">
            {blockEventPopup.events.length === 0 ? (
              <div className="popup-no-events">No events in this time block</div>
            ) : (
              blockEventPopup.events.slice(0, 10).map((event, i) => (
                <div
                  key={i}
                  className={`popup-event-item popup-event-${event.level}`}
                  onClick={() => {
                    if (onTimeSelect) {
                      onTimeSelect(getEventTime(event));
                    }
                    setBlockEventPopup(null);
                  }}
                >
                  <span className="popup-event-time">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="popup-event-level">{event.level.toUpperCase()}</span>
                  <span className="popup-event-message">{event.message}</span>
                </div>
              ))
            )}
            {blockEventPopup.events.length > 10 && (
              <div className="popup-more-events">
                +{blockEventPopup.events.length - 10} more events
              </div>
            )}
          </div>
        </div>
      )}

      {/* Hover tooltip for blocks */}
      {hoveredBlock && style === 'blocks' && (
        <div
          className="timeline-block-tooltip"
          style={{
            left: `${((hoveredBlock.time - timelineData.rangeStart) / TIME_RANGE_MS[timeRange]) * 100}%`,
            top: '50%',
          }}
        >
          <div className="tooltip-time">{new Date(hoveredBlock.time).toLocaleTimeString()}</div>
          <div className="tooltip-count">{hoveredBlock.eventCount} events</div>
          <div className={`tooltip-level ${hoveredBlock.level}`}>{hoveredBlock.level}</div>
        </div>
      )}
    </div>
  );
};

export default TimelineView;
