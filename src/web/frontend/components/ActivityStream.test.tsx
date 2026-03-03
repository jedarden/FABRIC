/**
 * Tests for ActivityStream component
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

describe('ActivityStream', () => {
  const createMockEvent = (overrides: Partial<LogEvent> = {}): LogEvent => ({
    timestamp: '2026-03-03T12:00:00.000Z',
    level: 'info',
        worker: 'claude-code-glm-5-alpha',
        message: 'Test message',
        raw: '{"ts":123,"worker":"test","level":"info","msg":"Test message"}',
        ...overrides,
      });

  beforeEach(() => {
    mockScrollTo.mockClear();
  });

  describe('rendering', () => {
    it('should render with empty events', () => {
      render(<ActivityStream events={[]} selectedWorker={null} />);

      expect(screen.getByText('All Events')).toBeInTheDocument();
      expect(screen.getByText('(0)')).toBeInTheDocument();
      expect(screen.getByText('No events to display')).toBeInTheDocument();
    });

    it('should render event count correctly', () => {
      const events = [
        createMockEvent({ message: 'Event 1' }),
        createMockEvent({ message: 'Event 2' }),
        createMockEvent({ message: 'Event 3' }),
      ];

      render(<ActivityStream events={events} selectedWorker={null} />);

      expect(screen.getByText('(3)')).toBeInTheDocument();
    });

    it('should render selected worker in title when provided', () => {
      render(<ActivityStream events={[]} selectedWorker="alpha" />);

      expect(screen.getByText('Events for alpha')).toBeInTheDocument();
    });

    it('should display event messages', () => {
      const { container } = render(
        <ActivityStream
          events={[
            createMockEvent({ message: 'First event' }),
            createMockEvent({ message: 'Second event' }),
          ]}
          selectedWorker={null}
        />
      );

      // Use container to find event items and check for message content
      const eventItems = container.querySelectorAll('.event-item');
      expect(eventItems[0].textContent).toContain('First event');
      expect(eventItems[1].textContent).toContain('Second event');
    });

    it('should display tool name when present', () => {
      const events = [
        createMockEvent({ message: 'Tool executed', tool: 'Read' }),
      ];

      render(<ActivityStream events={events} selectedWorker={null} />);

      expect(screen.getByText(/\[Read\] Tool executed/)).toBeInTheDocument();
    });

    it('should not display tool prefix when tool is undefined', () => {
      const events = [
        createMockEvent({ message: 'No tool event' }),
      ];

      render(<ActivityStream events={events} selectedWorker={null} />);

      const eventElement = screen.getByText(/No tool event/);
      expect(eventElement.textContent).toBe('No tool event');
    });
  });

  describe('event levels', () => {
    it('should display info level events', () => {
      const events = [createMockEvent({ level: 'info' })];

      render(<ActivityStream events={events} selectedWorker={null} />);

      const levelElement = screen.getByText('info');
      expect(levelElement).toHaveClass('info');
    });

    it('should display warn level events', () => {
      const events = [createMockEvent({ level: 'warn' })];

      render(<ActivityStream events={events} selectedWorker={null} />);

      const levelElement = screen.getByText('warn');
      expect(levelElement).toHaveClass('warn');
    });

    it('should display error level events', () => {
      const events = [createMockEvent({ level: 'error' })];

      render(<ActivityStream events={events} selectedWorker={null} />);

      const levelElement = screen.getByText('error');
      expect(levelElement).toHaveClass('error');
    });

    it('should display debug level events', () => {
      const events = [createMockEvent({ level: 'debug' })];

      render(<ActivityStream events={events} selectedWorker={null} />);

      const levelElement = screen.getByText('debug');
      expect(levelElement).toHaveClass('debug');
    });
  });

  describe('worker display', () => {
    it('should display truncated worker name when no worker selected', () => {
      const events = [
        createMockEvent({ worker: 'claude-code-glm-5-alpha' }),
      ];

      render(<ActivityStream events={events} selectedWorker={null} />);

      expect(screen.getByText('[alpha]')).toBeInTheDocument();
    });

    it('should extract last part of hyphenated worker names', () => {
      const events = [
        createMockEvent({ worker: 'worker-with-multiple-parts' }),
      ];

      render(<ActivityStream events={events} selectedWorker={null} />);

      expect(screen.getByText('[parts]')).toBeInTheDocument();
    });

    it('should hide worker name when a worker is selected', () => {
      const events = [
        createMockEvent({ worker: 'claude-code-glm-5-alpha' }),
      ];

      render(<ActivityStream events={events} selectedWorker="alpha" />);

      expect(screen.queryByText('[alpha]')).not.toBeInTheDocument();
    });
  });

  describe('time formatting', () => {
    it('should format timestamp to HH:MM:SS', () => {
      // 2026-03-03T12:34:56.000Z
      const events = [
        createMockEvent({ timestamp: '2026-03-03T12:34:56.000Z' }),
      ];

      render(<ActivityStream events={events} selectedWorker={null} />);

      // Time is formatted in local timezone, so just check the pattern
      const timeElements = screen.getAllByText(/\d{2}:\d{2}:\d{2}/);
      expect(timeElements.length).toBeGreaterThan(0);
    });
  });

  describe('event ordering', () => {
    it('should render events in order', () => {
      const { container } = render(
        <ActivityStream
          events={[
            createMockEvent({ message: 'First', timestamp: '2026-03-03T12:00:00.000Z' }),
            createMockEvent({ message: 'Second', timestamp: '2026-03-03T12:01:00.000Z' }),
            createMockEvent({ message: 'Third', timestamp: '2026-03-03T12:02:00.000Z' }),
          ]}
          selectedWorker={null}
        />
      );

      const eventItems = container.querySelectorAll('.event-item');
      expect(eventItems[0].textContent).toContain('First');
      expect(eventItems[1].textContent).toContain('Second');
      expect(eventItems[2].textContent).toContain('Third');
    });
  });

  describe('CSS classes', () => {
    it('should apply activity-stream class to container', () => {
      const { container } = render(
        <ActivityStream events={[]} selectedWorker={null} />
      );

      expect(container.querySelector('.activity-stream')).toBeInTheDocument();
    });

    it('should apply event-list class to list container', () => {
      const { container } = render(
        <ActivityStream events={[]} selectedWorker={null} />
      );

      expect(container.querySelector('.event-list')).toBeInTheDocument();
    });

    it('should apply event-item class to each event', () => {
      const events = [
        createMockEvent({ message: 'Event 1' }),
        createMockEvent({ message: 'Event 2' }),
      ];

      const { container } = render(
        <ActivityStream events={events} selectedWorker={null} />
      );

      const eventItems = container.querySelectorAll('.event-item');
      expect(eventItems).toHaveLength(2);
    });

    it('should apply no-events class to empty message', () => {
      const { container } = render(
        <ActivityStream events={[]} selectedWorker={null} />
      );

      expect(container.querySelector('.no-events')).toBeInTheDocument();
    });
  });

  describe('edge cases', () => {
    it('should handle single event', () => {
      const events = [createMockEvent({ message: 'Only event' })];

      render(<ActivityStream events={events} selectedWorker={null} />);

      expect(screen.getByText('(1)')).toBeInTheDocument();
      expect(screen.getByText(/Only event/)).toBeInTheDocument();
    });

    it('should handle many events', () => {
      const events = Array.from({ length: 100 }, (_, i) =>
        createMockEvent({ message: `Event ${i}` })
      );

      render(<ActivityStream events={events} selectedWorker={null} />);

      expect(screen.getByText('(100)')).toBeInTheDocument();
    });

    it('should handle long messages', () => {
      const longMessage = 'A'.repeat(500);
      const events = [createMockEvent({ message: longMessage })];

      render(<ActivityStream events={events} selectedWorker={null} />);

      expect(screen.getByText(new RegExp(longMessage))).toBeInTheDocument();
    });

    it('should handle special characters in messages', () => {
      const events = [
        createMockEvent({ message: 'Message with <special> & "chars"' }),
      ];

      render(<ActivityStream events={events} selectedWorker={null} />);

      expect(screen.getByText(/Message with <special> & "chars"/)).toBeInTheDocument();
    });

  });
});
