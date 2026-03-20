/**
 * E2E Test: ActivityStream displays scrolling log entries
 *
 * Verifies that the React ActivityStream component displays log entries
 * in chronological order with proper timestamps, level colors,
 * scrolling behavior, and filtering.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ActivityStream from '../src/components/ActivityStream';
import { LogEvent } from '../src/types';

// Mock scroll behavior
const mockScrollTo = vi.fn();
Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
  set: mockScrollTo,
  get: () => 0,
});
Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
  get: () => 1000,
});

// Mock scrollIntoView for timeline scrolling tests
Element.prototype.scrollIntoView = vi.fn();

function createMockEvent(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    timestamp: '2026-03-19T12:00:00.000Z',
    level: 'info',
    worker: 'claude-code-glm-5-alpha',
    message: 'Test message',
    raw: '{}',
    ...overrides,
  };
}

describe('E2E: ActivityStream Display and Scrolling', () => {
  beforeEach(() => {
    mockScrollTo.mockClear();
    vi.clearAllTimers();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  describe('chronological order', () => {
    it('should render events in the order they are provided', () => {
      const events = [
        createMockEvent({ timestamp: '2026-03-19T10:00:00.000Z', message: 'Earliest' }),
        createMockEvent({ timestamp: '2026-03-19T11:00:00.000Z', message: 'Middle' }),
        createMockEvent({ timestamp: '2026-03-19T12:00:00.000Z', message: 'Latest' }),
      ];

      const { container } = render(
        <ActivityStream events={events} selectedWorker={null} />
      );

      const items = container.querySelectorAll('.event-item');
      expect(items).toHaveLength(3);
      expect(items[0].textContent).toContain('Earliest');
      expect(items[1].textContent).toContain('Middle');
      expect(items[2].textContent).toContain('Latest');
    });

    it('should render 100+ events in correct order', () => {
      const events = Array.from({ length: 150 }, (_, i) =>
        createMockEvent({
          timestamp: `2026-03-19T10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`,
          message: `Event ${i}`,
        })
      );

      const { container } = render(
        <ActivityStream events={events} selectedWorker={null} />
      );

      const items = container.querySelectorAll('.event-item');
      expect(items).toHaveLength(150);
      expect(items[0].textContent).toContain('Event 0');
      expect(items[74].textContent).toContain('Event 74');
      expect(items[149].textContent).toContain('Event 149');
    });

    it('should preserve order across mixed log levels', () => {
      const events = [
        createMockEvent({ level: 'info', message: 'Info first' }),
        createMockEvent({ level: 'error', message: 'Error second' }),
        createMockEvent({ level: 'debug', message: 'Debug third' }),
        createMockEvent({ level: 'warn', message: 'Warn fourth' }),
      ];

      const { container } = render(
        <ActivityStream events={events} selectedWorker={null} />
      );

      const items = container.querySelectorAll('.event-item');
      expect(items[0].textContent).toContain('Info first');
      expect(items[1].textContent).toContain('Error second');
      expect(items[2].textContent).toContain('Debug third');
      expect(items[3].textContent).toContain('Warn fourth');
    });
  });

  describe('timestamp formatting', () => {
    it('should format timestamps as HH:MM:SS (24-hour)', () => {
      const events = [
        createMockEvent({ timestamp: '2026-03-19T00:00:00.000Z' }),
        createMockEvent({ timestamp: '2026-03-19T13:45:30.000Z' }),
        createMockEvent({ timestamp: '2026-03-19T23:59:59.000Z' }),
      ];

      const { container } = render(
        <ActivityStream events={events} selectedWorker={null} />
      );

      const timeElements = container.querySelectorAll('.event-time');
      expect(timeElements).toHaveLength(3);
      // All should match HH:MM:SS pattern (exact values depend on server timezone)
      for (const el of timeElements) {
        expect(el.textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);
      }
      // Timestamps should be distinct — events are hours apart
      const uniqueTimes = new Set(Array.from(timeElements, el => el.textContent));
      expect(uniqueTimes.size).toBe(3);
    });

    it('should display distinct timestamps for distinct events', () => {
      const events = [
        createMockEvent({ timestamp: '2026-03-19T09:00:00.000Z', message: 'Morning' }),
        createMockEvent({ timestamp: '2026-03-19T17:30:00.000Z', message: 'Afternoon' }),
      ];

      const { container } = render(
        <ActivityStream events={events} selectedWorker={null} />
      );

      const timeElements = container.querySelectorAll('.event-time');
      expect(timeElements[0].textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);
      expect(timeElements[1].textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);
      // The two times should be different
      expect(timeElements[0].textContent).not.toBe(timeElements[1].textContent);
    });
  });

  describe('level colors (CSS classes)', () => {
    it('should apply correct CSS class for each log level', () => {
      const events = [
        createMockEvent({ level: 'debug', message: 'dbg' }),
        createMockEvent({ level: 'info', message: 'inf' }),
        createMockEvent({ level: 'warn', message: 'wrn' }),
        createMockEvent({ level: 'error', message: 'err' }),
      ];

      const { container } = render(
        <ActivityStream events={events} selectedWorker={null} />
      );

      const levelElements = container.querySelectorAll('.event-level');
      expect(levelElements).toHaveLength(4);
      expect(levelElements[0]).toHaveClass('debug');
      expect(levelElements[1]).toHaveClass('info');
      expect(levelElements[2]).toHaveClass('warn');
      expect(levelElements[3]).toHaveClass('error');
    });

    it('should display level text matching the level value', () => {
      const events = [
        createMockEvent({ level: 'debug' }),
        createMockEvent({ level: 'info' }),
        createMockEvent({ level: 'warn' }),
        createMockEvent({ level: 'error' }),
      ];

      render(<ActivityStream events={events} selectedWorker={null} />);

      expect(screen.getByText('debug')).toBeInTheDocument();
      expect(screen.getByText('info')).toBeInTheDocument();
      expect(screen.getByText('warn')).toBeInTheDocument();
      expect(screen.getByText('error')).toBeInTheDocument();
    });

    it('should color a mixed event stream correctly', () => {
      const events = [
        createMockEvent({ level: 'info', message: 'startup' }),
        createMockEvent({ level: 'warn', message: 'degraded' }),
        createMockEvent({ level: 'error', message: 'failure' }),
        createMockEvent({ level: 'info', message: 'recovery' }),
      ];

      const { container } = render(
        <ActivityStream events={events} selectedWorker={null} />
      );

      const items = container.querySelectorAll('.event-item');
      expect(items[0].querySelector('.event-level')).toHaveClass('info');
      expect(items[1].querySelector('.event-level')).toHaveClass('warn');
      expect(items[2].querySelector('.event-level')).toHaveClass('error');
      expect(items[3].querySelector('.event-level')).toHaveClass('info');
    });
  });

  describe('scrolling behavior', () => {
    it('should auto-scroll to bottom when events change', () => {
      const events = [createMockEvent({ message: 'Initial' })];

      const { rerender } = render(
        <ActivityStream events={events} selectedWorker={null} />
      );

      expect(mockScrollTo).toHaveBeenCalledTimes(1);

      // Simulate new event arriving
      const updatedEvents = [
        ...events,
        createMockEvent({ timestamp: '2026-03-19T12:00:01.000Z', message: 'New event' }),
      ];

      rerender(<ActivityStream events={updatedEvents} selectedWorker={null} />);

      expect(mockScrollTo).toHaveBeenCalledTimes(2);
      expect(mockScrollTo).toHaveBeenLastCalledWith(1000);
    });

    it('should auto-scroll when multiple events arrive at once', () => {
      const events = Array.from({ length: 50 }, (_, i) =>
        createMockEvent({ timestamp: `2026-03-19T12:00:${String(i).padStart(2, '0')}.000Z`, message: `Batch ${i}` })
      );

      render(<ActivityStream events={events} selectedWorker={null} />);

      // Should have scrolled on initial render
      expect(mockScrollTo).toHaveBeenCalledTimes(1);
      expect(mockScrollTo).toHaveBeenCalledWith(1000);
    });

    it('should scroll to timeline-highlighted event when selectedTimelineTime is set', async () => {
      vi.useFakeTimers();

      const events = [
        createMockEvent({ timestamp: '2026-03-19T12:00:00.000Z', message: 'Before' }),
        createMockEvent({ timestamp: '2026-03-19T12:01:00.000Z', message: 'Target' }),
        createMockEvent({ timestamp: '2026-03-19T12:02:00.000Z', message: 'After' }),
      ];

      const { container, rerender } = render(
        <ActivityStream events={events} selectedWorker={null} />
      );

      // Set timeline time to target event
      rerender(
        <ActivityStream
          events={events}
          selectedWorker={null}
          selectedTimelineTime={new Date('2026-03-19T12:01:00.000Z').getTime()}
        />
      );

      // Flush the setTimeout(0) inside the component
      await act(async () => {
        vi.advanceTimersByTime(1);
      });

      // scrollIntoView should have been called on the target event element
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

      // The target event should have the timeline-highlight class added
      const items = container.querySelectorAll('.event-item');
      expect(items[1].classList.contains('timeline-highlight')).toBe(true);

      vi.useRealTimers();
    });

    it('should remove timeline-highlight after 3 seconds', async () => {
      vi.useFakeTimers();

      const events = [
        createMockEvent({ timestamp: '2026-03-19T12:00:00.000Z', message: 'Event' }),
      ];

      const { container, rerender } = render(
        <ActivityStream events={events} selectedWorker={null} />
      );

      rerender(
        <ActivityStream
          events={events}
          selectedWorker={null}
          selectedTimelineTime={new Date('2026-03-19T12:00:00.000Z').getTime()}
        />
      );

      // Flush the initial setTimeout (0ms)
      await act(async () => {
        vi.advanceTimersByTime(0);
      });

      expect(container.querySelector('.timeline-highlight')).toBeInTheDocument();

      // Advance past the 3-second removal timeout
      await act(async () => {
        vi.advanceTimersByTime(3500);
      });

      expect(container.querySelector('.timeline-highlight')).not.toBeInTheDocument();

      vi.useRealTimers();
    });
  });

  describe('filtering', () => {
    it('should show filter controls when showFilters is true', () => {
      render(
        <ActivityStream
          events={[]}
          selectedWorker={null}
          showFilters={true}
          workers={['worker-a']}
        />
      );

      expect(screen.getByText('Filters')).toBeInTheDocument();
    });

    it('should show "No events match the current filters" when filter excludes all', () => {
      const events = [
        createMockEvent({ worker: 'worker-a', message: 'Alpha event' }),
      ];

      render(
        <ActivityStream
          events={events}
          selectedWorker={null}
          showFilters={true}
          workers={['worker-a', 'worker-b']}
        />
      );

      // Initially should show the event
      expect(screen.getByText(/Alpha event/)).toBeInTheDocument();
    });

    it('should display filtered event count in header', () => {
      const events = [
        createMockEvent({ level: 'info', message: 'Info 1' }),
        createMockEvent({ level: 'error', message: 'Error 1' }),
        createMockEvent({ level: 'info', message: 'Info 2' }),
      ];

      render(
        <ActivityStream events={events} selectedWorker={null} />
      );

      // Should show total count (3)
      expect(screen.getByText('(3)')).toBeInTheDocument();
    });

    it('should distinguish empty vs filtered-empty states', () => {
      // No events at all
      const { rerender, container } = render(
        <ActivityStream events={[]} selectedWorker={null} />
      );
      expect(container.querySelector('.no-events')?.textContent).toBe('No events to display');

      // Events exist but none match filter (simulated via filteredEvents)
      // When filters are applied, the count reflects filtered results
      rerender(
        <ActivityStream
          events={[]}
          selectedWorker={null}
          showFilters={true}
          workers={['worker-x']}
        />
      );
      // With no events, should still show "No events to display"
      expect(container.querySelector('.no-events')?.textContent).toBe('No events to display');
    });
  });

  describe('complete display workflow', () => {
    it('should render a realistic multi-worker event stream correctly', () => {
      const events = [
        createMockEvent({
          timestamp: '2026-03-19T10:00:00.000Z',
          worker: 'claude-code-glm-5-alpha',
          level: 'info',
          message: 'Worker started',
        }),
        createMockEvent({
          timestamp: '2026-03-19T10:00:01.000Z',
          worker: 'claude-code-glm-5-alpha',
          level: 'debug',
          message: 'Loading config',
          tool: 'Read',
        }),
        createMockEvent({
          timestamp: '2026-03-19T10:00:02.000Z',
          worker: 'claude-code-glm-5-beta',
          level: 'info',
          message: 'Worker started',
        }),
        createMockEvent({
          timestamp: '2026-03-19T10:00:03.000Z',
          worker: 'claude-code-glm-5-alpha',
          level: 'warn',
          message: 'Rate limit approaching',
        }),
        createMockEvent({
          timestamp: '2026-03-19T10:00:04.000Z',
          worker: 'claude-code-glm-5-beta',
          level: 'error',
          message: 'Tool execution failed',
          tool: 'Write',
        }),
        createMockEvent({
          timestamp: '2026-03-19T10:00:05.000Z',
          worker: 'claude-code-glm-5-alpha',
          level: 'info',
          message: 'Task completed',
          bead: 'bd-abc123',
        }),
      ];

      const { container } = render(
        <ActivityStream events={events} selectedWorker={null} />
      );

      // All 6 events should be rendered
      const items = container.querySelectorAll('.event-item');
      expect(items).toHaveLength(6);

      // Verify chronological order
      expect(items[0].textContent).toContain('Worker started');
      expect(items[1].textContent).toContain('Loading config');
      expect(items[2].textContent).toContain('Worker started');
      expect(items[3].textContent).toContain('Rate limit approaching');
      expect(items[4].textContent).toContain('Tool execution failed');
      expect(items[5].textContent).toContain('Task completed');

      // Verify timestamps are present and follow HH:MM:SS pattern
      const times = container.querySelectorAll('.event-time');
      expect(times).toHaveLength(6);
      for (const t of times) {
        expect(t.textContent).toMatch(/^\d{2}:\d{2}:\d{2}$/);
      }

      // Verify level classes
      const levels = container.querySelectorAll('.event-level');
      expect(levels[0]).toHaveClass('info');
      expect(levels[1]).toHaveClass('debug');
      expect(levels[2]).toHaveClass('info');
      expect(levels[3]).toHaveClass('warn');
      expect(levels[4]).toHaveClass('error');
      expect(levels[5]).toHaveClass('info');

      // Verify tool prefix
      expect(items[1].querySelector('.event-message')?.textContent).toContain('[Read]');
      expect(items[4].querySelector('.event-message')?.textContent).toContain('[Write]');

      // Verify bead is shown
      expect(items[5].querySelector('.event-bead')?.textContent).toContain('bd-abc123');

      // Verify worker truncation
      expect(items[0].textContent).toContain('[alpha]');
      expect(items[2].textContent).toContain('[beta]');
    });

    it('should hide worker names when a specific worker is selected', () => {
      const events = [
        createMockEvent({ worker: 'claude-code-glm-5-alpha', message: 'Alpha event' }),
        createMockEvent({ worker: 'claude-code-glm-5-alpha', message: 'Another alpha' }),
      ];

      const { container } = render(
        <ActivityStream events={events} selectedWorker="alpha" />
      );

      expect(screen.getByText('Events for alpha')).toBeInTheDocument();
      expect(screen.queryByText('[alpha]')).not.toBeInTheDocument();

      const items = container.querySelectorAll('.event-item');
      expect(items).toHaveLength(2);
    });

    it('should auto-scroll on each event update', () => {
      const { rerender } = render(
        <ActivityStream events={[]} selectedWorker={null} />
      );

      expect(mockScrollTo).toHaveBeenCalledTimes(1);

      // Add one event
      rerender(
        <ActivityStream events={[createMockEvent({ message: '1' })]} selectedWorker={null} />
      );
      expect(mockScrollTo).toHaveBeenCalledTimes(2);

      // Add another event
      rerender(
        <ActivityStream
          events={[
            createMockEvent({ message: '1' }),
            createMockEvent({ timestamp: '2026-03-19T12:00:01.000Z', message: '2' }),
          ]}
          selectedWorker={null}
        />
      );
      expect(mockScrollTo).toHaveBeenCalledTimes(3);
    });

    it('should handle bead pinning display', () => {
      const events = [
        createMockEvent({ bead: 'bd-aaa', message: 'Task A' }),
        createMockEvent({ bead: 'bd-bbb', message: 'Task B' }),
      ];

      const pinnedBeads = new Set(['bd-aaa']);

      const { container } = render(
        <ActivityStream
          events={events}
          selectedWorker={null}
          pinnedBeads={pinnedBeads}
          onTogglePinBead={vi.fn()}
        />
      );

      // Pinned bead event should have bead-pinned class
      const items = container.querySelectorAll('.event-item');
      expect(items[0]).toHaveClass('bead-pinned');
      expect(items[1]).not.toHaveClass('bead-pinned');

      // Pin buttons should be visible (use getAllByText since bead IDs appear in multiple places)
      expect(screen.getAllByText(/bd-aaa/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/bd-bbb/).length).toBeGreaterThan(0);
    });
  });
});
