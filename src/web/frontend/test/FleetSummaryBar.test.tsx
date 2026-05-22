/**
 * Tests for FleetSummaryBar component
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import FleetSummaryBar from '../src/components/FleetSummaryBar';
import { WorkerInfo } from '../src/types';

describe('FleetSummaryBar', () => {
  const createMockWorker = (overrides: Partial<WorkerInfo> = {}): WorkerInfo => ({
    id: 'worker-alpha',
    lastSeen: new Date().toISOString(),
    eventCount: 10,
    status: 'active',
    recentEvents: [],
    ...overrides,
  });

  afterEach(() => {
    cleanup();
  });

  describe('rendering', () => {
    it('should render empty state when no workers', () => {
      render(<FleetSummaryBar workers={[]} />);

      expect(screen.getByText('0 WORKING')).toBeInTheDocument();
      expect(screen.getByText('0 SELECTING')).toBeInTheDocument();
      expect(screen.getByText('0 EXHAUSTED')).toBeInTheDocument();
      expect(screen.getByText('0 beads today')).toBeInTheDocument();
      expect(screen.getByText('0 stuck')).toBeInTheDocument();
    });

    it('should render worker counts by needle state', () => {
      const workers = [
        createMockWorker({ id: 'worker-1', needleState: 'WORKING' }),
        createMockWorker({ id: 'worker-2', needleState: 'WORKING' }),
        createMockWorker({ id: 'worker-3', needleState: 'SELECTING' }),
        createMockWorker({ id: 'worker-4', needleState: 'EXHAUSTED_IDLE' }),
        createMockWorker({ id: 'worker-5', needleState: 'STOPPED' }),
      ];

      render(<FleetSummaryBar workers={workers} />);

      expect(screen.getByText('2 WORKING')).toBeInTheDocument();
      expect(screen.getByText('1 SELECTING')).toBeInTheDocument();
      expect(screen.getByText('2 EXHAUSTED')).toBeInTheDocument();
    });

    it('should count EXHAUSTED_IDLE and STOPPED as exhausted', () => {
      const workers = [
        createMockWorker({ id: 'worker-1', needleState: 'EXHAUSTED_IDLE' }),
        createMockWorker({ id: 'worker-2', needleState: 'STOPPED' }),
        createMockWorker({ id: 'worker-3', needleState: 'EXHAUSTED_IDLE' }),
      ];

      render(<FleetSummaryBar workers={workers} />);

      expect(screen.getByText('3 EXHAUSTED')).toBeInTheDocument();
    });

    it('should display total beads completed today', () => {
      const workers = [
        createMockWorker({ id: 'worker-1' }),
        createMockWorker({ id: 'worker-2' }),
        createMockWorker({ id: 'worker-3' }),
      ];
      // Add beadsCompleted via type extension
      (workers[0] as any).beadsCompleted = 5;
      (workers[1] as any).beadsCompleted = 3;
      (workers[2] as any).beadsCompleted = 7;

      render(<FleetSummaryBar workers={workers} />);

      expect(screen.getByText('15 beads today')).toBeInTheDocument();
    });

    it('should display zero beads when none completed', () => {
      const workers = [
        createMockWorker({ id: 'worker-1' }),
        createMockWorker({ id: 'worker-2' }),
      ];

      render(<FleetSummaryBar workers={workers} />);

      expect(screen.getByText('0 beads today')).toBeInTheDocument();
    });

    it('should count stuck workers', () => {
      const workers = [
        createMockWorker({ id: 'worker-1', stuck: true }),
        createMockWorker({ id: 'worker-2', stuck: false }),
        createMockWorker({ id: 'worker-3', stuck: true }),
        createMockWorker({ id: 'worker-4', stuck: true }),
      ];

      render(<FleetSummaryBar workers={workers} />);

      expect(screen.getByText('3 stuck')).toBeInTheDocument();
    });

    it('should display zero stuck when none are stuck', () => {
      const workers = [
        createMockWorker({ id: 'worker-1', stuck: false }),
        createMockWorker({ id: 'worker-2', stuck: false }),
      ];

      render(<FleetSummaryBar workers={workers} />);

      expect(screen.getByText('0 stuck')).toBeInTheDocument();
    });
  });

  describe('CSS classes', () => {
    it('should apply fleet-summary-bar class to container', () => {
      const { container } = render(<FleetSummaryBar workers={[]} />);

      expect(container.querySelector('.fleet-summary-bar')).toBeInTheDocument();
    });

    it('should apply working class to WORKING count', () => {
      const workers = [createMockWorker({ id: 'worker-1', needleState: 'WORKING' })];
      const { container } = render(<FleetSummaryBar workers={workers} />);

      expect(container.querySelector('.fleet-summary-item.working')).toBeInTheDocument();
    });

    it('should apply selecting class to SELECTING count', () => {
      const workers = [createMockWorker({ id: 'worker-1', needleState: 'SELECTING' })];
      const { container } = render(<FleetSummaryBar workers={workers} />);

      expect(container.querySelector('.fleet-summary-item.selecting')).toBeInTheDocument();
    });

    it('should apply exhausted class to EXHAUSTED count', () => {
      const workers = [createMockWorker({ id: 'worker-1', needleState: 'EXHAUSTED_IDLE' })];
      const { container } = render(<FleetSummaryBar workers={workers} />);

      expect(container.querySelector('.fleet-summary-item.exhausted')).toBeInTheDocument();
    });

    it('should apply beads-today class to beads count', () => {
      const { container } = render(<FleetSummaryBar workers={[]} />);

      expect(container.querySelector('.fleet-summary-item.beads-today')).toBeInTheDocument();
    });

    it('should apply stuck class without has-stuck when zero stuck', () => {
      const { container } = render(<FleetSummaryBar workers={[]} />);

      const stuckEl = container.querySelector('.fleet-summary-item.stuck');
      expect(stuckEl).toBeInTheDocument();
      expect(stuckEl).not.toHaveClass('has-stuck');
    });

    it('should apply stuck class with has-stuck when workers are stuck', () => {
      const workers = [createMockWorker({ id: 'worker-1', stuck: true })];
      const { container } = render(<FleetSummaryBar workers={workers} />);

      const stuckEl = container.querySelector('.fleet-summary-item.stuck');
      expect(stuckEl).toBeInTheDocument();
      expect(stuckEl).toHaveClass('has-stuck');
    });

    it('should apply fleet-summary-separator class to separators', () => {
      const { container } = render(<FleetSummaryBar workers={[]} />);

      const separators = container.querySelectorAll('.fleet-summary-separator');
      expect(separators.length).toBe(5);
    });
  });

  describe('comprehensive fleet state', () => {
    it('should accurately reflect complex fleet state', () => {
      const workers = [
        createMockWorker({ id: 'worker-1', needleState: 'WORKING', stuck: false }),
        createMockWorker({ id: 'worker-2', needleState: 'WORKING', stuck: false }),
        createMockWorker({ id: 'worker-3', needleState: 'WORKING', stuck: true }),
        createMockWorker({ id: 'worker-4', needleState: 'SELECTING', stuck: false }),
        createMockWorker({ id: 'worker-5', needleState: 'SELECTING', stuck: false }),
        createMockWorker({ id: 'worker-6', needleState: 'CLAIMING', stuck: false }),
        createMockWorker({ id: 'worker-7', needleState: 'EXHAUSTED_IDLE', stuck: false }),
        createMockWorker({ id: 'worker-8', needleState: 'STOPPED', stuck: false }),
        createMockWorker({ id: 'worker-9', needleState: 'BOOTING', stuck: false }),
      ];
      // Add beadsCompleted
      (workers[0] as any).beadsCompleted = 10;
      (workers[1] as any).beadsCompleted = 5;
      (workers[3] as any).beadsCompleted = 3;
      (workers[6] as any).beadsCompleted = 2;

      render(<FleetSummaryBar workers={workers} />);

      expect(screen.getByText('3 WORKING')).toBeInTheDocument();
      expect(screen.getByText('2 SELECTING')).toBeInTheDocument();
      expect(screen.getByText('2 EXHAUSTED')).toBeInTheDocument();
      expect(screen.getByText('20 beads today')).toBeInTheDocument();
      expect(screen.getByText('1 stuck')).toBeInTheDocument();

      const stuckEl = screen.getByText('1 stuck');
      expect(stuckEl).toHaveClass('has-stuck');
    });

    it('should only show needle states that exist in the fleet', () => {
      const workers = [
        createMockWorker({ id: 'worker-1', needleState: 'WORKING' }),
        createMockWorker({ id: 'worker-2', needleState: 'WORKING' }),
      ];

      render(<FleetSummaryBar workers={workers} />);

      expect(screen.getByText('2 WORKING')).toBeInTheDocument();
      expect(screen.getByText('0 SELECTING')).toBeInTheDocument();
      expect(screen.getByText('0 EXHAUSTED')).toBeInTheDocument();
      // All states should still be displayed with zero counts
    });
  });

  describe('reactivity', () => {
    it('should update counts when workers change', () => {
      const { rerender } = render(<FleetSummaryBar workers={[]} />);

      expect(screen.getByText('0 WORKING')).toBeInTheDocument();

      const workers = [
        createMockWorker({ id: 'worker-1', needleState: 'WORKING' }),
        createMockWorker({ id: 'worker-2', needleState: 'WORKING' }),
      ];

      rerender(<FleetSummaryBar workers={workers} />);

      expect(screen.getByText('2 WORKING')).toBeInTheDocument();
    });
  });
});
