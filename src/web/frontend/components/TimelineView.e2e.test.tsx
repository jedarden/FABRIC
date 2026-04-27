/**
 * E2E Tests for TimelineView component
 * Tests real-time WebSocket integration and live updates
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TimelineView from '../src/components/TimelineView';
import { LogEvent, WorkerInfo } from '../src/types';

describe('TimelineView E2E - Real-time Updates', () => {
  const createMockEvent = (overrides: Partial<LogEvent> = {}): LogEvent => ({
    timestamp: new Date().toISOString(),
    level: 'info',
    worker: 'worker-alpha',
    message: 'Test event',
    raw: JSON.stringify({ timestamp: new Date().toISOString(), level: 'info', worker: 'worker-alpha', message: 'Test event' }),
    ...overrides,
  });

  const createMockWorker = (overrides: Partial<WorkerInfo> = {}): WorkerInfo => ({
    id: 'worker-alpha',
    lastSeen: new Date().toISOString(),
    eventCount: 10,
    status: 'active',
    recentEvents: [],
    ...overrides,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-03T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('WebSocket integration', () => {
    it('should update timeline when new events arrive via WebSocket', async () => {
      const now = new Date('2026-03-03T12:00:00Z');
      const initialEvents = [
        createMockEvent({
          timestamp: new Date(now.getTime() - 60000).toISOString(),
          worker: 'worker-alpha',
          level: 'info',
        }),
      ];
      const workers = [createMockWorker({ id: 'worker-alpha' })];

      const { container, rerender } = render(
        <TimelineView
          events={initialEvents}
          workers={workers}
          timelineStyle="bars"
        />
      );

      // Initial state - should have one segment
      let segments = container.querySelectorAll('.timeline-segment');
      expect(segments.length).toBeGreaterThan(0);
      const initialSegmentCount = segments.length;

      // Simulate WebSocket message arriving with new event
      const newEvent = createMockEvent({
        timestamp: new Date(now.getTime() - 30000).toISOString(),
        worker: 'worker-alpha',
        level: 'error',
      });

      rerender(
        <TimelineView
          events={[...initialEvents, newEvent]}
          workers={workers}
          timelineStyle="bars"
        />
      );

      // Should update with new segment
      segments = container.querySelectorAll('.timeline-segment');
      expect(segments.length).toBeGreaterThan(initialSegmentCount);
    });

    it('should highlight worker row when new events arrive', async () => {
      const now = new Date('2026-03-03T12:00:00Z');
      const initialEvents: LogEvent[] = [];
      const workers = [createMockWorker({ id: 'worker-alpha' })];

      const { container, rerender } = render(
        <TimelineView
          events={initialEvents}
          workers={workers}
          timelineStyle="bars"
        />
      );

      // Initially no new-activity class
      expect(container.querySelector('.new-activity')).not.toBeInTheDocument();

      // Simulate WebSocket message with new event
      const newEvent = createMockEvent({
        timestamp: now.toISOString(),
        worker: 'worker-alpha',
        level: 'info',
      });

      rerender(
        <TimelineView
          events={[newEvent]}
          workers={workers}
          timelineStyle="bars"
        />
      );

      // Should have new-activity class
      expect(container.querySelector('.new-activity')).toBeInTheDocument();
    });

    it('should handle multiple workers with different activity patterns', async () => {
      const now = new Date('2026-03-03T12:00:00Z');

      // Worker alpha: continuous activity
      const alphaEvents = Array.from({ length: 10 }, (_, i) =>
        createMockEvent({
          timestamp: new Date(now.getTime() - i * 30000).toISOString(),
          worker: 'worker-alpha',
          level: 'info',
        })
      );

      // Worker bravo: sporadic activity
      const bravoEvents = [
        createMockEvent({
          timestamp: new Date(now.getTime() - 300000).toISOString(),
          worker: 'worker-bravo',
          level: 'warn',
        }),
        createMockEvent({
          timestamp: new Date(now.getTime() - 60000).toISOString(),
          worker: 'worker-bravo',
          level: 'info',
        }),
      ];

      const workers = [
        createMockWorker({ id: 'worker-alpha', eventCount: 10 }),
        createMockWorker({ id: 'worker-bravo', eventCount: 2 }),
      ];

      const { container } = render(
        <TimelineView
          events={[...alphaEvents, ...bravoEvents]}
          workers={workers}
          timelineStyle="bars"
        />
      );

      const rows = container.querySelectorAll('.timeline-row');
      expect(rows.length).toBe(2);

      // Alpha should have more segments than bravo
      const alphaRow = Array.from(rows).find(row =>
        row.textContent?.includes('alpha')
      );
      const bravoRow = Array.from(rows).find(row =>
        row.textContent?.includes('bravo')
      );

      expect(alphaRow).toBeInTheDocument();
      expect(bravoRow).toBeInTheDocument();

      const alphaSegments = alphaRow?.querySelectorAll('.timeline-segment');
      const bravoSegments = bravoRow?.querySelectorAll('.timeline-segment');

      expect(alphaSegments?.length).toBeGreaterThan(bravoSegments?.length || 0);
    });
  });

  describe('Time range interaction', () => {
    it('should filter events based on selected time range', () => {
      const now = new Date('2026-03-03T12:00:00Z');

      // Events spread across different time periods (in different 30-second buckets)
      const events = [
        createMockEvent({
          timestamp: new Date(now.getTime() - 1 * 60 * 1000).toISOString(), // 1 min ago
          worker: 'worker-alpha',
          level: 'info',
        }),
        createMockEvent({
          timestamp: new Date(now.getTime() - 4 * 60 * 1000).toISOString(), // 4 min ago
          worker: 'worker-alpha',
          level: 'warn',
        }),
        createMockEvent({
          timestamp: new Date(now.getTime() - 20 * 60 * 1000).toISOString(), // 20 min ago
          worker: 'worker-alpha',
          level: 'error',
        }),
      ];

      const workers = [createMockWorker({ id: 'worker-alpha' })];

      const { container } = render(
        <TimelineView
          events={events}
          workers={workers}
          defaultTimeRange="5m"
          timelineStyle="bars"
        />
      );

      // With 5m range, should show first 2 events (in different buckets)
      let segments = container.querySelectorAll('.timeline-segment');
      expect(segments.length).toBeGreaterThanOrEqual(2);

      // Switch to 30m range
      const thirtyMinButton = screen.getByText('30 min');
      fireEvent.click(thirtyMinButton);

      // Now should show all 3 events
      segments = container.querySelectorAll('.timeline-segment');
      expect(segments.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Style switching', () => {
    it('should switch between blocks and bars visualization', () => {
      const now = new Date('2026-03-03T12:00:00Z');
      const events = [
        createMockEvent({
          timestamp: new Date(now.getTime() - 30000).toISOString(),
          worker: 'worker-alpha',
          level: 'info',
        }),
      ];
      const workers = [createMockWorker({ id: 'worker-alpha' })];

      const { container } = render(
        <TimelineView
          events={events}
          workers={workers}
          timelineStyle="blocks"
        />
      );

      // Should have block visualization
      expect(container.querySelector('.block-visualization')).toBeInTheDocument();
      expect(container.querySelector('.timeline-segment')).not.toBeInTheDocument();

      // Toggle to bars
      const styleToggle = container.querySelector('.style-toggle');
      if (styleToggle) {
        fireEvent.click(styleToggle);
      }

      // Now should have segments
      expect(container.querySelector('.timeline-segment')).toBeInTheDocument();
    });
  });

  describe('Worker selection and filtering', () => {
    it('should highlight selected worker row', () => {
      const now = new Date('2026-03-03T12:00:00Z');
      const events = [
        createMockEvent({
          timestamp: new Date(now.getTime() - 30000).toISOString(),
          worker: 'worker-alpha',
        }),
        createMockEvent({
          timestamp: new Date(now.getTime() - 30000).toISOString(),
          worker: 'worker-bravo',
        }),
      ];

      const workers = [
        createMockWorker({ id: 'worker-alpha' }),
        createMockWorker({ id: 'worker-bravo' }),
      ];

      const { container } = render(
        <TimelineView
          events={events}
          workers={workers}
          selectedWorker="worker-alpha"
        />
      );

      const rows = container.querySelectorAll('.timeline-row');
      const alphaRow = Array.from(rows).find(row =>
        row.textContent?.includes('alpha')
      );

      expect(alphaRow).toHaveClass('selected');
    });

    it('should call onWorkerClick when worker row is clicked', () => {
      const now = new Date('2026-03-03T12:00:00Z');
      const events = [
        createMockEvent({
          timestamp: new Date(now.getTime() - 30000).toISOString(),
          worker: 'worker-alpha',
        }),
      ];

      const workers = [createMockWorker({ id: 'worker-alpha' })];
      const mockOnWorkerClick = vi.fn();

      const { container } = render(
        <TimelineView
          events={events}
          workers={workers}
          onWorkerClick={mockOnWorkerClick}
        />
      );

      const row = container.querySelector('.timeline-row');
      if (row) {
        fireEvent.click(row);
      }

      expect(mockOnWorkerClick).toHaveBeenCalledWith('worker-alpha');
    });
  });

  describe('Focus Mode integration', () => {
    it('should filter to pinned workers when focus mode is enabled', () => {
      const now = new Date('2026-03-03T12:00:00Z');
      const events = [
        createMockEvent({
          timestamp: new Date(now.getTime() - 30000).toISOString(),
          worker: 'worker-alpha',
        }),
        createMockEvent({
          timestamp: new Date(now.getTime() - 30000).toISOString(),
          worker: 'worker-bravo',
        }),
      ];

      const workers = [
        createMockWorker({ id: 'worker-alpha' }),
        createMockWorker({ id: 'worker-bravo' }),
      ];

      const { container, rerender } = render(
        <TimelineView
          events={events}
          workers={workers}
          focusModeEnabled={false}
        />
      );

      // Should show both workers
      let rows = container.querySelectorAll('.timeline-row');
      expect(rows.length).toBe(2);

      // Enable focus mode with pinned worker
      rerender(
        <TimelineView
          events={events}
          workers={workers}
          focusModeEnabled={true}
          pinnedWorkers={new Set(['worker-alpha'])}
        />
      );

      // Should only show alpha
      rows = container.querySelectorAll('.timeline-row');
      expect(rows.length).toBe(1);
      expect(rows[0].textContent).toContain('alpha');
    });
  });

  describe('Time selection', () => {
    it('should show time selection hint when onTimeSelect is provided', () => {
      const now = new Date('2026-03-03T12:00:00Z');
      const events = [
        createMockEvent({
          timestamp: new Date(now.getTime() - 30000).toISOString(),
          worker: 'worker-alpha',
        }),
      ];

      const workers = [createMockWorker({ id: 'worker-alpha' })];
      const mockOnTimeSelect = vi.fn();

      render(
        <TimelineView
          events={events}
          workers={workers}
          onTimeSelect={mockOnTimeSelect}
          timelineStyle="bars"
        />
      );

      // Should show hint text for bars mode
      expect(screen.getByText('Click on timeline to jump to that time in activity stream')).toBeInTheDocument();
    });

    it('should render clickable timeline content when onTimeSelect is provided', () => {
      const now = new Date('2026-03-03T12:00:00Z');
      const events = [
        createMockEvent({
          timestamp: new Date(now.getTime() - 30000).toISOString(),
          worker: 'worker-alpha',
        }),
      ];

      const workers = [createMockWorker({ id: 'worker-alpha' })];
      const mockOnTimeSelect = vi.fn();

      const { container } = render(
        <TimelineView
          events={events}
          workers={workers}
          onTimeSelect={mockOnTimeSelect}
        />
      );

      const timelineContent = container.querySelector('.timeline-content');
      expect(timelineContent).toBeInTheDocument();
      // Timeline content should exist for click handling
      expect(timelineContent).toHaveClass('timeline-content');
    });
  });

  describe('Real-time auto-refresh', () => {
    it('should update time-based display when currentTime prop changes', () => {
      const baseTime = new Date('2026-03-03T12:00:00Z').getTime();
      const events = [
        createMockEvent({
          timestamp: new Date(baseTime - 30000).toISOString(),
          worker: 'worker-alpha',
        }),
      ];

      const workers = [createMockWorker({ id: 'worker-alpha' })];

      const { rerender, container } = render(
        <TimelineView
          events={events}
          workers={workers}
          currentTime={baseTime}
          timelineStyle="bars"
        />
      );

      const initialSegments = container.querySelectorAll('.timeline-segment');
      expect(initialSegments.length).toBeGreaterThan(0);

      // Advance time by 5 minutes
      const newTime = baseTime + 5 * 60 * 1000;
      rerender(
        <TimelineView
          events={events}
          workers={workers}
          currentTime={newTime}
          timelineStyle="bars"
        />
      );

      // Timeline should still show the event (it's within 10m range)
      const segments = container.querySelectorAll('.timeline-segment');
      expect(segments.length).toBeGreaterThan(0);
    });
  });
});
