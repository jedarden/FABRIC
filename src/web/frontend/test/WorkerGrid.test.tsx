/**
 * Tests for WorkerGrid component
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import WorkerGrid from '../src/components/WorkerGrid';
import { WorkerInfo } from '../src/types';

describe('WorkerGrid', () => {
  const createMockWorker = (overrides: Partial<WorkerInfo> = {}): WorkerInfo => ({
    id: 'worker-alpha',
    lastSeen: new Date().toISOString(),
    eventCount: 10,
    status: 'active',
    recentEvents: [],
    ...overrides,
  });

  const mockOnSelectWorker = vi.fn();

  beforeEach(() => {
    mockOnSelectWorker.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  describe('rendering', () => {
    it('should render empty state when no workers', () => {
      render(
        <WorkerGrid
          workers={[]}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(screen.getByText('Workers (0)')).toBeInTheDocument();
      expect(screen.getByText('No workers detected')).toBeInTheDocument();
      expect(screen.getByText('Waiting for log events...')).toBeInTheDocument();
    });

    it('should render worker count in header', () => {
      const workers = [
        createMockWorker({ id: 'worker-1' }),
        createMockWorker({ id: 'worker-2' }),
        createMockWorker({ id: 'worker-3' }),
      ];

      render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(screen.getByText('Workers (3)')).toBeInTheDocument();
    });

    it('should render each worker card', () => {
      const workers = [
        createMockWorker({ id: 'worker-alpha' }),
        createMockWorker({ id: 'worker-beta' }),
      ];

      render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(screen.getByText('worker-alpha')).toBeInTheDocument();
      expect(screen.getByText('worker-beta')).toBeInTheDocument();
    });
  });

  describe('worker status display', () => {
    it('should display active status', () => {
      const workers = [
        createMockWorker({ id: 'worker-1', status: 'active' }),
      ];

      const { container } = render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(screen.getByText('active')).toBeInTheDocument();
      expect(container.querySelector('.worker-status.active')).toBeInTheDocument();
    });

    it('should display idle status', () => {
      const workers = [
        createMockWorker({ id: 'worker-1', status: 'idle' }),
      ];

      const { container } = render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(screen.getByText('idle')).toBeInTheDocument();
      expect(container.querySelector('.worker-status.idle')).toBeInTheDocument();
    });

    it('should display error status', () => {
      const workers = [
        createMockWorker({ id: 'worker-1', status: 'error' }),
      ];

      const { container } = render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(screen.getByText('error')).toBeInTheDocument();
      expect(container.querySelector('.worker-status.error')).toBeInTheDocument();
    });
  });

  describe('event count display', () => {
    it('should display event count', () => {
      const workers = [
        createMockWorker({ id: 'worker-1', eventCount: 42 }),
      ];

      render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(screen.getByText(/42 events/)).toBeInTheDocument();
    });

    it('should display zero events', () => {
      const workers = [
        createMockWorker({ id: 'worker-1', eventCount: 0 }),
      ];

      render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(screen.getByText(/0 events/)).toBeInTheDocument();
    });
  });

  describe('last seen formatting', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-03T12:00:00Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should display seconds ago for recent events', () => {
      const workers = [
        createMockWorker({
          id: 'worker-1',
          lastSeen: new Date(Date.now() - 30000).toISOString(), // 30 seconds ago
        }),
      ];

      render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(screen.getByText(/30s ago/)).toBeInTheDocument();
    });

    it('should display minutes ago for events within an hour', () => {
      const workers = [
        createMockWorker({
          id: 'worker-1',
          lastSeen: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 minutes ago
        }),
      ];

      render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(screen.getByText(/5m ago/)).toBeInTheDocument();
    });

    it('should display hours ago for older events', () => {
      const workers = [
        createMockWorker({
          id: 'worker-1',
          lastSeen: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
        }),
      ];

      render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(screen.getByText(/2h ago/)).toBeInTheDocument();
    });
  });

  describe('worker selection', () => {
    it('should call onSelectWorker with worker id when clicking unselected worker', () => {
      const workers = [
        createMockWorker({ id: 'worker-1' }),
      ];

      render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      fireEvent.click(screen.getByText('worker-1'));

      expect(mockOnSelectWorker).toHaveBeenCalledWith('worker-1');
    });

    it('should deselect worker when clicking selected worker', () => {
      const workers = [
        createMockWorker({ id: 'worker-1' }),
      ];

      render(
        <WorkerGrid
          workers={workers}
          selectedWorker="worker-1"
          onSelectWorker={mockOnSelectWorker}
        />
      );

      fireEvent.click(screen.getByText('worker-1'));

      expect(mockOnSelectWorker).toHaveBeenCalledWith(null);
    });

    it('should apply selected class to selected worker card', () => {
      const workers = [
        createMockWorker({ id: 'worker-1' }),
        createMockWorker({ id: 'worker-2' }),
      ];

      const { container } = render(
        <WorkerGrid
          workers={workers}
          selectedWorker="worker-1"
          onSelectWorker={mockOnSelectWorker}
        />
      );

      const cards = container.querySelectorAll('.worker-card');
      expect(cards[0]).toHaveClass('selected');
      expect(cards[1]).not.toHaveClass('selected');
    });
  });

  describe('collision indicators', () => {
    it('should display warning emoji when worker has collision', () => {
      const workers = [
        createMockWorker({ id: 'worker-1', hasCollision: true }),
      ];

      render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(screen.getByText('⚠️')).toBeInTheDocument();
    });

    it('should not display warning emoji when worker has no collision', () => {
      const workers = [
        createMockWorker({ id: 'worker-1', hasCollision: false }),
      ];

      render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(screen.queryByText('⚠️')).not.toBeInTheDocument();
    });

    it('should apply collision class to worker card with collision', () => {
      const workers = [
        createMockWorker({ id: 'worker-1', hasCollision: true }),
        createMockWorker({ id: 'worker-2', hasCollision: false }),
      ];

      const { container } = render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      const cards = container.querySelectorAll('.worker-card');
      expect(cards[0]).toHaveClass('collision');
      expect(cards[1]).not.toHaveClass('collision');
    });

    it('should display collision warning with file count', () => {
      const workers = [
        createMockWorker({
          id: 'worker-1',
          hasCollision: true,
          activeFiles: ['/src/file1.ts', '/src/file2.ts', '/src/file3.ts'],
        }),
      ];

      render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(screen.getByText(/Colliding on: 3 file\(s\)/)).toBeInTheDocument();
    });

    it('should not display collision warning when no active files', () => {
      const workers = [
        createMockWorker({
          id: 'worker-1',
          hasCollision: true,
          activeFiles: [],
        }),
      ];

      render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(screen.queryByText(/Colliding on:/)).not.toBeInTheDocument();
    });

    it('should not display collision warning when activeFiles is undefined', () => {
      const workers = [
        createMockWorker({
          id: 'worker-1',
          hasCollision: true,
          activeFiles: undefined,
        }),
      ];

      render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(screen.queryByText(/Colliding on:/)).not.toBeInTheDocument();
    });
  });

  describe('CSS classes', () => {
    it('should apply worker-grid class to container', () => {
      const { container } = render(
        <WorkerGrid
          workers={[]}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(container.querySelector('.worker-grid')).toBeInTheDocument();
    });

    it('should apply worker-card class to each card', () => {
      const workers = [
        createMockWorker({ id: 'worker-1' }),
        createMockWorker({ id: 'worker-2' }),
      ];

      const { container } = render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(container.querySelectorAll('.worker-card').length).toBe(2);
    });

    it('should apply empty-state class when no workers', () => {
      const { container } = render(
        <WorkerGrid
          workers={[]}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(container.querySelector('.empty-state')).toBeInTheDocument();
    });

    it('should apply worker-card-header class', () => {
      const workers = [createMockWorker({ id: 'worker-1' })];

      const { container } = render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(container.querySelector('.worker-card-header')).toBeInTheDocument();
    });

    it('should apply worker-stats class', () => {
      const workers = [createMockWorker({ id: 'worker-1' })];

      const { container } = render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(container.querySelector('.worker-stats')).toBeInTheDocument();
    });

    it('should apply worker-id class to worker id span', () => {
      const workers = [createMockWorker({ id: 'worker-1' })];

      const { container } = render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(container.querySelector('.worker-id')).toBeInTheDocument();
    });

    it('should apply collision-indicator class to warning emoji', () => {
      const workers = [createMockWorker({ id: 'worker-1', hasCollision: true })];

      const { container } = render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(container.querySelector('.collision-indicator')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should have title attribute on collision indicator', () => {
      const workers = [createMockWorker({ id: 'worker-1', hasCollision: true })];

      render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      const indicator = screen.getByText('⚠️');
      expect(indicator).toHaveAttribute('title', 'File collision detected!');
    });
  });
});
