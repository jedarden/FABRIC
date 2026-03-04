/**
 * Tests for Focus Mode functionality
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import WorkerGrid from '../src/components/WorkerGrid';
import { WorkerInfo } from '../src/types';

describe('Focus Mode', () => {
  const createMockWorker = (overrides: Partial<WorkerInfo> = {}): WorkerInfo => ({
    id: 'worker-alpha',
    lastSeen: new Date().toISOString(),
    eventCount: 10,
    status: 'active',
    recentEvents: [],
    ...overrides,
  });

  const mockOnSelectWorker = vi.fn();
  const mockOnTogglePin = vi.fn();

  beforeEach(() => {
    mockOnSelectWorker.mockClear();
    mockOnTogglePin.mockClear();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  describe('Pin/Unpin Workers', () => {
    it('should render pin button for each worker', () => {
      const workers = [createMockWorker({ id: 'worker-1' })];

      const { container } = render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
          onTogglePin={mockOnTogglePin}
        />
      );

      expect(container.querySelector('.pin-button')).toBeInTheDocument();
    });

    it('should call onTogglePin when clicking pin button', () => {
      const workers = [createMockWorker({ id: 'worker-1' })];

      const { container } = render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
          onTogglePin={mockOnTogglePin}
        />
      );

      const pinButton = container.querySelector('.pin-button');
      expect(pinButton).toBeTruthy();
      fireEvent.click(pinButton!);

      expect(mockOnTogglePin).toHaveBeenCalledWith('worker-1');
      expect(mockOnSelectWorker).not.toHaveBeenCalled(); // Should not select worker
    });

    it('should show pinned state when worker is pinned', () => {
      const workers = [createMockWorker({ id: 'worker-1' })];
      const pinnedWorkers = new Set(['worker-1']);

      const { container } = render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
          pinnedWorkers={pinnedWorkers}
          onTogglePin={mockOnTogglePin}
        />
      );

      const pinButton = container.querySelector('.pin-button.pinned');
      expect(pinButton).toBeInTheDocument();
      expect(pinButton).toHaveTextContent('📌');
    });

    it('should show unpinned state when worker is not pinned', () => {
      const workers = [createMockWorker({ id: 'worker-1' })];
      const pinnedWorkers = new Set<string>();

      const { container } = render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
          pinnedWorkers={pinnedWorkers}
          onTogglePin={mockOnTogglePin}
        />
      );

      const pinButton = container.querySelector('.pin-button');
      expect(pinButton).toBeInTheDocument();
      expect(pinButton).not.toHaveClass('pinned');
      expect(pinButton).toHaveTextContent('📍');
    });

    it('should apply pinned class to worker card when pinned', () => {
      const workers = [
        createMockWorker({ id: 'worker-1' }),
        createMockWorker({ id: 'worker-2' }),
      ];
      const pinnedWorkers = new Set(['worker-1']);

      const { container } = render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
          pinnedWorkers={pinnedWorkers}
          onTogglePin={mockOnTogglePin}
        />
      );

      const cards = container.querySelectorAll('.worker-card');
      expect(cards[0]).toHaveClass('pinned');
      expect(cards[1]).not.toHaveClass('pinned');
    });

    it('should show correct title on pin button', () => {
      const workers = [createMockWorker({ id: 'worker-1' })];

      const { container } = render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
          onTogglePin={mockOnTogglePin}
        />
      );

      const pinButton = container.querySelector('.pin-button');
      expect(pinButton).toHaveAttribute('title', 'Pin worker for Focus Mode');
    });

    it('should show correct title on unpin button', () => {
      const workers = [createMockWorker({ id: 'worker-1' })];
      const pinnedWorkers = new Set(['worker-1']);

      const { container } = render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
          pinnedWorkers={pinnedWorkers}
          onTogglePin={mockOnTogglePin}
        />
      );

      const pinButton = container.querySelector('.pin-button');
      expect(pinButton).toHaveAttribute('title', 'Unpin worker');
    });
  });

  describe('Focus Mode filtering', () => {
    it('should show focus mode indicator when enabled with pinned workers', () => {
      const workers = [
        createMockWorker({ id: 'worker-1' }),
        createMockWorker({ id: 'worker-2' }),
      ];
      const pinnedWorkers = new Set(['worker-1']);

      render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
          pinnedWorkers={pinnedWorkers}
          onTogglePin={mockOnTogglePin}
          focusModeEnabled={true}
        />
      );

      expect(screen.getByText(/Focus: 1 pinned/)).toBeInTheDocument();
    });

    it('should not show focus mode indicator when disabled', () => {
      const workers = [createMockWorker({ id: 'worker-1' })];
      const pinnedWorkers = new Set(['worker-1']);

      render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
          pinnedWorkers={pinnedWorkers}
          onTogglePin={mockOnTogglePin}
          focusModeEnabled={false}
        />
      );

      expect(screen.queryByText(/Focus:/)).not.toBeInTheDocument();
    });

    it('should show empty state message when focus mode enabled with no pinned workers', () => {
      const workers: WorkerInfo[] = [];
      const pinnedWorkers = new Set<string>();

      render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
          pinnedWorkers={pinnedWorkers}
          onTogglePin={mockOnTogglePin}
          focusModeEnabled={true}
        />
      );

      expect(screen.getByText(/No pinned workers/)).toBeInTheDocument();
      expect(screen.getByText(/Pin workers to see them in Focus Mode/)).toBeInTheDocument();
    });

    it('should show helper message to disable focus mode when no pinned workers', () => {
      const workers: WorkerInfo[] = [];
      const pinnedWorkers = new Set<string>();

      render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
          pinnedWorkers={pinnedWorkers}
          onTogglePin={mockOnTogglePin}
          focusModeEnabled={true}
        />
      );

      expect(screen.getByText(/Disable Focus Mode to see all workers/)).toBeInTheDocument();
    });

    it('should show normal empty state when focus mode disabled with no workers', () => {
      const workers: WorkerInfo[] = [];
      const pinnedWorkers = new Set<string>();

      render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
          pinnedWorkers={pinnedWorkers}
          onTogglePin={mockOnTogglePin}
          focusModeEnabled={false}
        />
      );

      expect(screen.getByText('No workers detected')).toBeInTheDocument();
      expect(screen.getByText('Waiting for log events...')).toBeInTheDocument();
    });
  });

  describe('Pin button without onTogglePin callback', () => {
    it('should not render pin button when onTogglePin is not provided', () => {
      const workers = [createMockWorker({ id: 'worker-1' })];

      const { container } = render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
        />
      );

      expect(container.querySelector('.pin-button')).not.toBeInTheDocument();
    });
  });

  describe('Interaction with worker selection', () => {
    it('should select worker when clicking card but not pin button', () => {
      const workers = [createMockWorker({ id: 'worker-1' })];

      render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
          onTogglePin={mockOnTogglePin}
        />
      );

      // Click on the worker ID (part of the card)
      fireEvent.click(screen.getByText('worker-1'));

      expect(mockOnSelectWorker).toHaveBeenCalledWith('worker-1');
      expect(mockOnTogglePin).not.toHaveBeenCalled();
    });

    it('should pin worker without selecting it', () => {
      const workers = [createMockWorker({ id: 'worker-1' })];

      const { container } = render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
          onTogglePin={mockOnTogglePin}
        />
      );

      const pinButton = container.querySelector('.pin-button');
      expect(pinButton).toBeTruthy();
      fireEvent.click(pinButton!);

      expect(mockOnTogglePin).toHaveBeenCalledWith('worker-1');
      expect(mockOnSelectWorker).not.toHaveBeenCalled();
    });
  });

  describe('Multiple pinned workers', () => {
    it('should show correct count for multiple pinned workers in focus mode', () => {
      const workers = [
        createMockWorker({ id: 'worker-1' }),
        createMockWorker({ id: 'worker-2' }),
        createMockWorker({ id: 'worker-3' }),
      ];
      const pinnedWorkers = new Set(['worker-1', 'worker-3']);

      render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
          pinnedWorkers={pinnedWorkers}
          onTogglePin={mockOnTogglePin}
          focusModeEnabled={true}
        />
      );

      expect(screen.getByText(/Focus: 2 pinned/)).toBeInTheDocument();
    });

    it('should apply pinned class to all pinned workers', () => {
      const workers = [
        createMockWorker({ id: 'worker-1' }),
        createMockWorker({ id: 'worker-2' }),
        createMockWorker({ id: 'worker-3' }),
      ];
      const pinnedWorkers = new Set(['worker-1', 'worker-3']);

      const { container } = render(
        <WorkerGrid
          workers={workers}
          selectedWorker={null}
          onSelectWorker={mockOnSelectWorker}
          pinnedWorkers={pinnedWorkers}
          onTogglePin={mockOnTogglePin}
        />
      );

      const cards = container.querySelectorAll('.worker-card');
      expect(cards[0]).toHaveClass('pinned');
      expect(cards[1]).not.toHaveClass('pinned');
      expect(cards[2]).toHaveClass('pinned');
    });
  });
});
