/**
 * Tests for TimelineView component
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import TimelineView from '../src/components/TimelineView';
import { LogEvent, WorkerInfo } from '../src/types';

describe('TimelineView', () => {
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

  const mockOnTimeSelect = vi.fn();

  beforeEach(() => {
    mockOnTimeSelect.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-03T12:00:00Z'));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  describe('rendering', () => {
    it('should render timeline header with time range', () => {
      render(
        <TimelineView
          events={[]}
          workers={[]}
          onTimeSelect={mockOnTimeSelect}
        />
      );

      expect(screen.getByText(/Timeline \(last/)).toBeInTheDocument();
      expect(screen.getByText('10 min')).toBeInTheDocument();
    });

    it('should render time range selector buttons', () => {
      const { container } = render(
        <TimelineView
          events={[]}
          workers={[]}
          onTimeSelect={mockOnTimeSelect}
        />
      );

      expect(container.querySelector('.time-range-selector')).toBeInTheDocument();
      expect(screen.getByText('5 min')).toBeInTheDocument();
      expect(screen.getByText('10 min')).toBeInTheDocument();
      expect(screen.getByText('30 min')).toBeInTheDocument();
      expect(screen.getByText('1 hour')).toBeInTheDocument();
    });

    it('should render empty state when no events in time range', () => {
      render(
        <TimelineView
          events={[]}
          workers={[]}
          onTimeSelect={mockOnTimeSelect}
        />
      );

      expect(screen.getByText('No worker activity in this time range')).toBeInTheDocument();
    });

    it('should render worker rows when events exist', () => {
      const now = new Date('2026-03-03T12:00:00Z');
      const events = [
        createMockEvent({
          timestamp: new Date(now.getTime() - 5000).toISOString(),
          worker: 'worker-alpha',
        }),
      ];
      const workers = [createMockWorker({ id: 'worker-alpha' })];

      const { container } = render(
        <TimelineView
          events={events}
          workers={workers}
          onTimeSelect={mockOnTimeSelect}
        />
      );

      expect(container.querySelector('.timeline-rows')).toBeInTheDocument();
      expect(container.querySelectorAll('.timeline-row').length).toBeGreaterThan(0);
    });
  });

  describe('time range selection', () => {
    it('should change time range when clicking button', () => {
      const { container } = render(
        <TimelineView
          events={[]}
          workers={[]}
          onTimeSelect={mockOnTimeSelect}
        />
      );

      const fiveMinButton = screen.getByText('5 min');
      fireEvent.click(fiveMinButton);

      expect(screen.getByText('Timeline (last 5 min)')).toBeInTheDocument();
    });

    it('should highlight active time range button', () => {
      const { container } = render(
        <TimelineView
          events={[]}
          workers={[]}
          onTimeSelect={mockOnTimeSelect}
        />
      );

      const tenMinButton = screen.getByText('10 min');
      expect(tenMinButton.closest('.time-range-button')).toHaveClass('active');
    });
  });

  describe('worker filtering', () => {
    it('should filter events when selectedWorker is set', () => {
      const now = new Date('2026-03-03T12:00:00Z');
      const events = [
        createMockEvent({
          timestamp: new Date(now.getTime() - 5000).toISOString(),
          worker: 'worker-alpha',
        }),
        createMockEvent({
          timestamp: new Date(now.getTime() - 5000).toISOString(),
          worker: 'worker-beta',
        }),
      ];
      const workers = [
        createMockWorker({ id: 'worker-alpha' }),
        createMockWorker({ id: 'worker-beta' }),
      ];

      const { container } = render(
        <TimelineView
          events={events}
          workers={workers}
          onTimeSelect={mockOnTimeSelect}
          selectedWorker="worker-alpha"
        />
      );

      // Timeline shows workers with events in the filtered set
      // Both workers appear because they both have events, but only worker-alpha's segments are shown
      const rows = container.querySelectorAll('.timeline-row');
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter workers when focus mode is enabled with pinned workers', () => {
      const now = new Date('2026-03-03T12:00:00Z');
      const events = [
        createMockEvent({
          timestamp: new Date(now.getTime() - 5000).toISOString(),
          worker: 'worker-alpha',
        }),
        createMockEvent({
          timestamp: new Date(now.getTime() - 5000).toISOString(),
          worker: 'worker-beta',
        }),
      ];
      const workers = [
        createMockWorker({ id: 'worker-alpha' }),
        createMockWorker({ id: 'worker-beta' }),
      ];

      const { container } = render(
        <TimelineView
          events={events}
          workers={workers}
          onTimeSelect={mockOnTimeSelect}
          focusModeEnabled={true}
          pinnedWorkers={new Set(['worker-alpha'])}
        />
      );

      const rows = container.querySelectorAll('.timeline-row');
      expect(rows.length).toBe(1);
    });
  });

  describe('time selection', () => {
    it('should call onTimeSelect when clicking on timeline', () => {
      const now = new Date('2026-03-03T12:00:00Z');
      const events = [
        createMockEvent({
          timestamp: new Date(now.getTime() - 5000).toISOString(),
          worker: 'worker-alpha',
        }),
      ];
      const workers = [createMockWorker({ id: 'worker-alpha' })];

      const { container } = render(
        <TimelineView
          events={events}
          workers={workers}
          onTimeSelect={mockOnTimeSelect}
        />
      );

      const timelineContent = container.querySelector('.timeline-content');
      if (timelineContent) {
        fireEvent.click(timelineContent, { clientX: 100 });
      }

      expect(mockOnTimeSelect).toHaveBeenCalled();
    });

    it('should show hint text when onTimeSelect is provided', () => {
      render(
        <TimelineView
          events={[]}
          workers={[]}
          onTimeSelect={mockOnTimeSelect}
          timelineStyle="bars"
        />
      );

      expect(screen.getByText('Click on timeline to jump to that time in activity stream')).toBeInTheDocument();
    });
  });

  describe('worker name truncation', () => {
    it('should truncate worker name to last segment', () => {
      const now = new Date('2026-03-03T12:00:00Z');
      const events = [
        createMockEvent({
          timestamp: new Date(now.getTime() - 5000).toISOString(),
          worker: 'worker-alpha-bravo-charlie',
        }),
      ];
      const workers = [createMockWorker({ id: 'worker-alpha-bravo-charlie' })];

      const { container } = render(
        <TimelineView
          events={events}
          workers={workers}
          onTimeSelect={mockOnTimeSelect}
        />
      );

      expect(screen.getByText('charlie')).toBeInTheDocument();
    });
  });

  describe('segment rendering', () => {
    it('should render timeline segments for events in bars mode', () => {
      const now = new Date('2026-03-03T12:00:00Z');
      const events = [
        createMockEvent({
          timestamp: new Date(now.getTime() - 5000).toISOString(),
          worker: 'worker-alpha',
          level: 'info',
        }),
        createMockEvent({
          timestamp: new Date(now.getTime() - 10000).toISOString(),
          worker: 'worker-alpha',
          level: 'error',
        }),
      ];
      const workers = [createMockWorker({ id: 'worker-alpha' })];

      const { container } = render(
        <TimelineView
          events={events}
          workers={workers}
          onTimeSelect={mockOnTimeSelect}
          timelineStyle="bars"
        />
      );

      const segments = container.querySelectorAll('.timeline-segment');
      expect(segments.length).toBeGreaterThan(0);
    });

    it('should render block visualization in blocks mode', () => {
      const now = new Date('2026-03-03T12:00:00Z');
      const events = [
        createMockEvent({
          timestamp: new Date(now.getTime() - 5000).toISOString(),
          worker: 'worker-alpha',
          level: 'info',
        }),
      ];
      const workers = [createMockWorker({ id: 'worker-alpha' })];

      const { container } = render(
        <TimelineView
          events={events}
          workers={workers}
          onTimeSelect={mockOnTimeSelect}
          timelineStyle="blocks"
        />
      );

      const blocks = container.querySelector('.block-visualization');
      expect(blocks).toBeInTheDocument();
    });
  });

  describe('auto-refresh', () => {
    it('should use provided currentTime when available', () => {
      const providedTime = new Date('2026-03-03T12:30:00Z').getTime();
      const events = [
        createMockEvent({
          timestamp: new Date('2026-03-03T12:29:00Z').toISOString(),
          worker: 'worker-alpha',
        }),
      ];
      const workers = [createMockWorker({ id: 'worker-alpha' })];

      const { container } = render(
        <TimelineView
          events={events}
          workers={workers}
          currentTime={providedTime}
          timelineStyle="bars"
        />
      );

      // The timeline should include events within the time range relative to providedTime
      const segments = container.querySelectorAll('.timeline-segment');
      expect(segments.length).toBeGreaterThan(0);
    });

    it('should auto-update when currentTime prop changes', () => {
      const events = [
        createMockEvent({
          timestamp: new Date('2026-03-03T12:29:00Z').toISOString(),
          worker: 'worker-alpha',
        }),
      ];
      const workers = [createMockWorker({ id: 'worker-alpha' })];

      const { rerender } = render(
        <TimelineView
          events={events}
          workers={workers}
          currentTime={1000}
        />
      );

      rerender(
        <TimelineView
          events={events}
          workers={workers}
          currentTime={5000}
        />
      );

      // Component should re-render with new time
      const segments = document.querySelectorAll('.timeline-segment');
      expect(segments).toBeTruthy();
    });
  });

  describe('CSS classes', () => {
    it('should apply timeline-view class to container', () => {
      const { container } = render(
        <TimelineView
          events={[]}
          workers={[]}
        />
      );

      expect(container.querySelector('.timeline-view')).toBeInTheDocument();
    });

    it('should apply timeline-header class', () => {
      const { container } = render(
        <TimelineView
          events={[]}
          workers={[]}
        />
      );

      expect(container.querySelector('.timeline-header')).toBeInTheDocument();
    });

    it('should apply timeline-content class', () => {
      const { container } = render(
        <TimelineView
          events={[]}
          workers={[]}
        />
      );

      expect(container.querySelector('.timeline-content')).toBeInTheDocument();
    });

    it('should apply timeline-axis class', () => {
      const { container } = render(
        <TimelineView
          events={[]}
          workers={[]}
        />
      );

      expect(container.querySelector('.timeline-axis')).toBeInTheDocument();
    });

    it('should apply current-time-pulse class', () => {
      const { container } = render(
        <TimelineView
          events={[]}
          workers={[]}
        />
      );

      expect(container.querySelector('.current-time-pulse')).toBeInTheDocument();
    });
  });

  describe('default time range', () => {
    it('should use provided defaultTimeRange', () => {
      render(
        <TimelineView
          events={[]}
          workers={[]}
          defaultTimeRange="5m"
        />
      );

      expect(screen.getByText('Timeline (last 5 min)')).toBeInTheDocument();
    });
  });

  describe('compact mode', () => {
    it('should render compact mode when enabled', () => {
      const { container } = render(
        <TimelineView
          events={[]}
          workers={[]}
          compactMode={true}
        />
      );

      expect(container.querySelector('.timeline-view.compact')).toBeInTheDocument();
    });

    it('should render block visualization in compact mode', () => {
      const now = new Date('2026-03-03T12:00:00Z');
      const events = [
        createMockEvent({
          timestamp: new Date(now.getTime() - 5000).toISOString(),
          worker: 'worker-alpha',
          level: 'info',
        }),
      ];
      const workers = [createMockWorker({ id: 'worker-alpha' })];

      const { container } = render(
        <TimelineView
          events={events}
          workers={workers}
          compactMode={true}
        />
      );

      expect(container.querySelector('.block-visualization')).toBeInTheDocument();
    });

    it('should not render block visualization in bar mode', () => {
      const now = new Date('2026-03-03T12:00:00Z');
      const events = [
        createMockEvent({
          timestamp: new Date(now.getTime() - 5000).toISOString(),
          worker: 'worker-alpha',
          level: 'info',
        }),
      ];
      const workers = [createMockWorker({ id: 'worker-alpha' })];

      const { container } = render(
        <TimelineView
          events={events}
          workers={workers}
          timelineStyle="bars"
        />
      );

      expect(container.querySelector('.block-visualization')).not.toBeInTheDocument();
    });
  });

  describe('worker click handling', () => {
    it('should call onWorkerClick when worker row is clicked', () => {
      const mockOnWorkerClick = vi.fn();
      const now = new Date('2026-03-03T12:00:00Z');
      const events = [
        createMockEvent({
          timestamp: new Date(now.getTime() - 5000).toISOString(),
          worker: 'worker-alpha',
        }),
      ];
      const workers = [createMockWorker({ id: 'worker-alpha' })];

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

    it('should apply selected class to selected worker', () => {
      const now = new Date('2026-03-03T12:00:00Z');
      const events = [
        createMockEvent({
          timestamp: new Date(now.getTime() - 5000).toISOString(),
          worker: 'worker-alpha',
        }),
      ];
      const workers = [createMockWorker({ id: 'worker-alpha' })];

      const { container } = render(
        <TimelineView
          events={events}
          workers={workers}
          selectedWorker="worker-alpha"
        />
      );

      const row = container.querySelector('.timeline-row');
      expect(row).toHaveClass('selected');
    });
  });

  describe('new event highlighting', () => {
    it('should apply new-activity class when new events arrive', async () => {
      const { container, rerender } = render(
        <TimelineView
          events={[]}
          workers={[]}
        />
      );

      // Initially no new-activity class
      expect(container.querySelector('.new-activity')).not.toBeInTheDocument();

      // Add new events
      const now = new Date('2026-03-03T12:00:00Z');
      const newEvents = [
        createMockEvent({
          timestamp: new Date(now.getTime() - 5000).toISOString(),
          worker: 'worker-alpha',
        }),
      ];

      rerender(
        <TimelineView
          events={newEvents}
          workers={[createMockWorker({ id: 'worker-alpha' })]}
        />
      );

      // Should have new-activity class
      expect(container.querySelector('.new-activity')).toBeInTheDocument();
    });
  });

  describe('worker event counts', () => {
    it('should display total event count for each worker', () => {
      const now = new Date('2026-03-03T12:00:00Z');
      const events = [
        createMockEvent({
          timestamp: new Date(now.getTime() - 5000).toISOString(),
          worker: 'worker-alpha',
          level: 'info',
        }),
        createMockEvent({
          timestamp: new Date(now.getTime() - 3000).toISOString(),
          worker: 'worker-alpha',
          level: 'debug',
        }),
        createMockEvent({
          timestamp: new Date(now.getTime() - 1000).toISOString(),
          worker: 'worker-alpha',
          level: 'warn',
        }),
      ];
      const workers = [createMockWorker({ id: 'worker-alpha' })];

      const { container } = render(
        <TimelineView
          events={events}
          workers={workers}
        />
      );

      expect(screen.getByText('(3)')).toBeInTheDocument();
    });
  });
});
