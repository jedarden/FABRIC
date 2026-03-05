/**
 * Tests for WorkerDetail component
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import WorkerDetail from '../src/components/WorkerDetail';
import { WorkerInfo, LogEvent } from '../src/types';

describe('WorkerDetail', () => {
  const createMockWorker = (overrides: Partial<WorkerInfo> = {}): WorkerInfo => ({
    id: 'worker-alpha',
    lastSeen: new Date().toISOString(),
    eventCount: 10,
    status: 'active',
    recentEvents: [],
    ...overrides,
  });

  const createMockEvent = (overrides: Partial<LogEvent> = {}): LogEvent => ({
    timestamp: '2026-03-05T12:00:00.000Z',
    level: 'info',
    worker: 'worker-alpha',
    message: 'Test event',
    raw: '{"ts":123,"worker":"worker-alpha","level":"info","msg":"Test event"}',
    ...overrides,
  });

  const mockOnClose = vi.fn();

  beforeEach(() => {
    mockOnClose.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  describe('rendering', () => {
    it('should render worker detail panel', () => {
      const worker = createMockWorker({ id: 'worker-alpha' });

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      expect(screen.getByText('worker-alpha')).toBeInTheDocument();
    });

    it('should render close button', () => {
      const worker = createMockWorker();

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      const closeButton = screen.getByTitle('Close details');
      expect(closeButton).toBeInTheDocument();
      expect(closeButton.textContent).toBe('✕');
    });

    it('should call onClose when close button is clicked', () => {
      const worker = createMockWorker();

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      fireEvent.click(screen.getByTitle('Close details'));

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('worker status display', () => {
    it('should display active status with correct icon', () => {
      const worker = createMockWorker({ status: 'active' });

      const { container } = render(
        <WorkerDetail worker={worker} onClose={mockOnClose} />
      );

      expect(screen.getByText('active')).toBeInTheDocument();
      expect(container.querySelector('.worker-status.active')).toBeInTheDocument();
      expect(container.querySelector('.worker-status-icon.active')).toBeInTheDocument();
    });

    it('should display idle status with correct icon', () => {
      const worker = createMockWorker({ status: 'idle' });

      const { container } = render(
        <WorkerDetail worker={worker} onClose={mockOnClose} />
      );

      expect(screen.getByText('idle')).toBeInTheDocument();
      expect(container.querySelector('.worker-status.idle')).toBeInTheDocument();
      expect(container.querySelector('.worker-status-icon.idle')).toBeInTheDocument();
    });

    it('should display error status with correct icon', () => {
      const worker = createMockWorker({ status: 'error' });

      const { container } = render(
        <WorkerDetail worker={worker} onClose={mockOnClose} />
      );

      expect(screen.getByText('error')).toBeInTheDocument();
      expect(container.querySelector('.worker-status.error')).toBeInTheDocument();
      expect(container.querySelector('.worker-status-icon.error')).toBeInTheDocument();
    });
  });

  describe('event count display', () => {
    it('should display event count', () => {
      const worker = createMockWorker({ eventCount: 42 });

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('should display zero event count', () => {
      const worker = createMockWorker({ eventCount: 0 });

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('should display large event count', () => {
      const worker = createMockWorker({ eventCount: 9999 });

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      expect(screen.getByText('9999')).toBeInTheDocument();
    });
  });

  describe('current tool display', () => {
    it('should display current tool when present', () => {
      const worker = createMockWorker({ currentTool: 'Read' });

      const { container } = render(
        <WorkerDetail worker={worker} onClose={mockOnClose} />
      );

      // Current tool appears in the status section
      const toolNameElement = container.querySelector('.detail-value.tool-name');
      expect(toolNameElement).toBeInTheDocument();
      expect(toolNameElement?.textContent).toBe('Read');
    });

    it('should display dash when no current tool', () => {
      const worker = createMockWorker({ currentTool: undefined });

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      expect(screen.getByText('-')).toBeInTheDocument();
    });
  });

  describe('last seen formatting', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-05T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should display seconds ago for recent events', () => {
      const worker = createMockWorker({
        lastSeen: new Date(Date.now() - 30000).toISOString(), // 30 seconds ago
      });

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      expect(screen.getByText(/30s ago/)).toBeInTheDocument();
    });

    it('should display minutes ago for events within an hour', () => {
      const worker = createMockWorker({
        lastSeen: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 minutes ago
      });

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      expect(screen.getByText(/5m ago/)).toBeInTheDocument();
    });

    it('should display hours and minutes for older events', () => {
      const worker = createMockWorker({
        lastSeen: new Date(Date.now() - 2 * 60 * 60 * 1000 - 30 * 60 * 1000).toISOString(), // 2h 30m ago
      });

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      expect(screen.getByText(/2h 30m ago/)).toBeInTheDocument();
    });
  });

  describe('recent events display', () => {
    it('should display "No events recorded" when no events', () => {
      const worker = createMockWorker({ recentEvents: [] });

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      expect(screen.getByText('No events recorded')).toBeInTheDocument();
    });

    it('should display event count in section header', () => {
      const worker = createMockWorker({
        recentEvents: [
          createMockEvent({ message: 'Event 1' }),
          createMockEvent({ message: 'Event 2' }),
          createMockEvent({ message: 'Event 3' }),
        ],
      });

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      expect(screen.getByText('Recent Events (3)')).toBeInTheDocument();
    });

    it('should display event messages', () => {
      const worker = createMockWorker({
        recentEvents: [
          createMockEvent({ message: 'First event' }),
          createMockEvent({ message: 'Second event' }),
        ],
      });

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      expect(screen.getByText('First event')).toBeInTheDocument();
      expect(screen.getByText('Second event')).toBeInTheDocument();
    });

    it('should display event levels', () => {
      const worker = createMockWorker({
        recentEvents: [
          createMockEvent({ message: 'Info event', level: 'info' }),
          createMockEvent({ message: 'Warn event', level: 'warn' }),
          createMockEvent({ message: 'Error event', level: 'error' }),
        ],
      });

      const { container } = render(
        <WorkerDetail worker={worker} onClose={mockOnClose} />
      );

      expect(screen.getByText('INF')).toBeInTheDocument();
      expect(screen.getByText('WAR')).toBeInTheDocument();
      expect(screen.getByText('ERR')).toBeInTheDocument();

      expect(container.querySelector('.detail-event-level.info')).toBeInTheDocument();
      expect(container.querySelector('.detail-event-level.warn')).toBeInTheDocument();
      expect(container.querySelector('.detail-event-level.error')).toBeInTheDocument();
    });

    it('should truncate long messages', () => {
      const longMessage = 'A'.repeat(100);
      const worker = createMockWorker({
        recentEvents: [createMockEvent({ message: longMessage })],
      });

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      // Message should be truncated to 35 chars + '...'
      expect(screen.getByText(/A{35}\.\.\./)).toBeInTheDocument();
    });

    it('should not truncate short messages', () => {
      const worker = createMockWorker({
        recentEvents: [createMockEvent({ message: 'Short message' })],
      });

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      expect(screen.getByText('Short message')).toBeInTheDocument();
    });

    it('should display last 10 events when more than 10', () => {
      const events = Array.from({ length: 20 }, (_, i) =>
        createMockEvent({ message: `Event ${i}` })
      );
      const worker = createMockWorker({ recentEvents: events });

      const { container } = render(
        <WorkerDetail worker={worker} onClose={mockOnClose} />
      );

      // Should show count of all events
      expect(screen.getByText('Recent Events (20)')).toBeInTheDocument();

      // But only render last 10
      const eventItems = container.querySelectorAll('.detail-event-item');
      expect(eventItems).toHaveLength(10);

      // Should show Event 10-19 (last 10)
      expect(screen.getByText('Event 19')).toBeInTheDocument();
      expect(screen.queryByText('Event 0')).not.toBeInTheDocument();
      expect(screen.queryByText('Event 9')).not.toBeInTheDocument();
    });

    it('should use allWorkerEvents when provided', () => {
      const worker = createMockWorker({
        recentEvents: [createMockEvent({ message: 'Worker event' })],
      });

      const allEvents = [
        createMockEvent({ message: 'All event 1' }),
        createMockEvent({ message: 'All event 2' }),
      ];

      render(
        <WorkerDetail
          worker={worker}
          onClose={mockOnClose}
          allWorkerEvents={allEvents}
        />
      );

      expect(screen.getByText('All event 1')).toBeInTheDocument();
      expect(screen.getByText('All event 2')).toBeInTheDocument();
      expect(screen.queryByText('Worker event')).not.toBeInTheDocument();
    });
  });

  describe('collision alert display', () => {
    it('should display collision alert when worker has collision', () => {
      const worker = createMockWorker({ hasCollision: true });

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      expect(screen.getByText('File collision detected!')).toBeInTheDocument();
      expect(screen.getByText('⚠️')).toBeInTheDocument();
    });

    it('should not display collision alert when worker has no collision', () => {
      const worker = createMockWorker({ hasCollision: false });

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      expect(screen.queryByText('File collision detected!')).not.toBeInTheDocument();
    });

    it('should display collision files when provided', () => {
      const worker = createMockWorker({
        hasCollision: true,
        activeFiles: ['/src/file1.ts', '/src/file2.ts', '/src/file3.ts'],
      });

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      expect(screen.getByText('file1.ts')).toBeInTheDocument();
      expect(screen.getByText('file2.ts')).toBeInTheDocument();
      expect(screen.getByText('file3.ts')).toBeInTheDocument();
    });

    it('should display only first 3 collision files', () => {
      const worker = createMockWorker({
        hasCollision: true,
        activeFiles: ['/src/file1.ts', '/src/file2.ts', '/src/file3.ts', '/src/file4.ts', '/src/file5.ts'],
      });

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      expect(screen.getByText('file1.ts')).toBeInTheDocument();
      expect(screen.getByText('file2.ts')).toBeInTheDocument();
      expect(screen.getByText('file3.ts')).toBeInTheDocument();
      expect(screen.getByText('+2 more')).toBeInTheDocument();
      expect(screen.queryByText('file4.ts')).not.toBeInTheDocument();
      expect(screen.queryByText('file5.ts')).not.toBeInTheDocument();
    });

    it('should not display "more" text when exactly 3 files', () => {
      const worker = createMockWorker({
        hasCollision: true,
        activeFiles: ['/src/file1.ts', '/src/file2.ts', '/src/file3.ts'],
      });

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      expect(screen.queryByText(/\+\d+ more/)).not.toBeInTheDocument();
    });
  });

  describe('current activity section', () => {
    it('should display current activity section when tool is present', () => {
      const worker = createMockWorker({ currentTool: 'Edit' });

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      expect(screen.getByText('Current Activity')).toBeInTheDocument();
    });

    it('should not display current activity section when no tool', () => {
      const worker = createMockWorker({ currentTool: undefined });

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      expect(screen.queryByText('Current Activity')).not.toBeInTheDocument();
    });
  });

  describe('CSS classes', () => {
    it('should apply worker-detail class to container', () => {
      const worker = createMockWorker();
      const { container } = render(
        <WorkerDetail worker={worker} onClose={mockOnClose} />
      );

      expect(container.querySelector('.worker-detail')).toBeInTheDocument();
    });

    it('should apply detail-section classes', () => {
      const worker = createMockWorker();
      const { container } = render(
        <WorkerDetail worker={worker} onClose={mockOnClose} />
      );

      expect(container.querySelectorAll('.detail-section').length).toBeGreaterThan(0);
    });

    it('should apply collision-alert class when collision present', () => {
      const worker = createMockWorker({ hasCollision: true });
      const { container } = render(
        <WorkerDetail worker={worker} onClose={mockOnClose} />
      );

      expect(container.querySelector('.collision-alert')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should have title attribute on close button', () => {
      const worker = createMockWorker();

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      const closeButton = screen.getByRole('button');
      expect(closeButton).toHaveAttribute('title', 'Close details');
    });

    it('should have title attribute on file names showing full path', () => {
      const worker = createMockWorker({
        hasCollision: true,
        activeFiles: ['/very/long/path/to/file.ts'],
      });

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      const fileElement = screen.getByText('file.ts');
      expect(fileElement).toHaveAttribute('title', '/very/long/path/to/file.ts');
    });

    it('should have title attribute on lastSeen showing full timestamp', () => {
      const timestamp = '2026-03-05T12:34:56.789Z';
      const worker = createMockWorker({ lastSeen: timestamp });

      const { container } = render(
        <WorkerDetail worker={worker} onClose={mockOnClose} />
      );

      const lastSeenElement = container.querySelector('.detail-row .detail-value[title]');
      expect(lastSeenElement).toHaveAttribute('title', timestamp);
    });

    it('should have title attribute on truncated event messages', () => {
      const longMessage = 'This is a very long message that will be truncated in the display';
      const worker = createMockWorker({
        recentEvents: [createMockEvent({ message: longMessage })],
      });

      const { container } = render(
        <WorkerDetail worker={worker} onClose={mockOnClose} />
      );

      const messageElement = container.querySelector('.detail-event-msg[title]');
      expect(messageElement).toHaveAttribute('title', longMessage);
    });
  });

  describe('edge cases', () => {
    it('should handle worker with all undefined optional fields', () => {
      const worker: WorkerInfo = {
        id: 'minimal-worker',
        lastSeen: new Date().toISOString(),
        eventCount: 0,
        status: 'idle',
        recentEvents: [],
        currentTool: undefined,
        hasCollision: undefined,
        activeFiles: undefined,
      };

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      expect(screen.getByText('minimal-worker')).toBeInTheDocument();
      expect(screen.getByText('0')).toBeInTheDocument();
      expect(screen.getByText('idle')).toBeInTheDocument();
    });

    it('should handle empty active files array with collision flag', () => {
      const worker = createMockWorker({
        hasCollision: true,
        activeFiles: [],
      });

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      expect(screen.getByText('File collision detected!')).toBeInTheDocument();
      expect(screen.queryByText(/\.ts/)).not.toBeInTheDocument();
    });

    it('should handle very old lastSeen timestamp', () => {
      const worker = createMockWorker({
        lastSeen: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 24 hours ago
      });

      render(<WorkerDetail worker={worker} onClose={mockOnClose} />);

      expect(screen.getByText(/24h 0m ago/)).toBeInTheDocument();
    });
  });
});
