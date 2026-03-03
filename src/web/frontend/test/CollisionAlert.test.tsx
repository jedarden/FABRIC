/**
 * Tests for CollisionAlert component
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import CollisionAlert from '../src/components/CollisionAlert';
import { CollisionAlert as CollisionAlertData } from '../src/types';

describe('CollisionAlert', () => {
  const createMockAlert = (overrides: Partial<CollisionAlertData> = {}): CollisionAlertData => ({
    id: 'alert-1',
    type: 'file',
    severity: 'warning',
    title: 'Test Alert',
    description: 'Test description',
    workers: ['worker-alpha', 'worker-beta'],
    timestamp: Date.now(),
    acknowledged: false,
    collision: {
      path: '/test/file.ts',
      workers: ['worker-alpha', 'worker-beta'],
      detectedAt: Date.now(),
      isActive: true,
    },
    ...overrides,
  });

  const mockOnAcknowledge = vi.fn();
  const mockOnAcknowledgeAll = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    mockOnAcknowledge.mockClear();
    mockOnAcknowledgeAll.mockClear();
    mockOnClose.mockClear();
  });

  describe('rendering', () => {
    it('should not render when visible is false', () => {
      const { container } = render(
        <CollisionAlert
          alerts={[]}
          visible={false}
        />
      );

      expect(container.querySelector('.collision-alert-panel')).not.toBeInTheDocument();
    });

    it('should render empty state when no alerts', () => {
      const { container } = render(
        <CollisionAlert
          alerts={[]}
          visible={true}
        />
      );

      expect(container.querySelector('.collision-alert-panel')).toBeInTheDocument();
      expect(container.querySelector('.collision-empty')).toBeInTheDocument();
    });

    it('should render alerts count', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', title: 'Alert 1' }),
        createMockAlert({ id: 'alert-2', title: 'Alert 2' }),
      ];

      const { container } = render(
        <CollisionAlert
          alerts={alerts}
          visible={true}
        />
      );

      expect(container.querySelector('.collision-summary')?.textContent).toContain('Alerts: 2');
    });

    it('should render unacknowledged count', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', acknowledged: false }),
        createMockAlert({ id: 'alert-2', acknowledged: true }),
      ];

      const { container } = render(
        <CollisionAlert
          alerts={alerts}
          visible={true}
        />
      );

      expect(container.querySelector('.collision-summary')?.textContent).toContain('1 unacknowledged');
    });
  });

  describe('severity grouping', () => {
    it('should group critical alerts together', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', severity: 'critical', title: 'Critical Alert' }),
        createMockAlert({ id: 'alert-2', severity: 'error', title: 'Error Alert' }),
      ];

      const { container } = render(
        <CollisionAlert
          alerts={alerts}
          visible={true}
        />
      );

      const criticalGroup = container.querySelector('.collision-group-critical');
      expect(criticalGroup).toBeInTheDocument();
      expect(criticalGroup?.textContent).toContain('CRITICAL/ERROR');
      expect(criticalGroup?.textContent).toContain('Critical Alert');
      expect(criticalGroup?.textContent).toContain('Error Alert');
    });

    it('should group warning alerts together', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', severity: 'warning', title: 'Warning Alert' }),
      ];

      const { container } = render(
        <CollisionAlert
          alerts={alerts}
          visible={true}
        />
      );

      const warningGroup = container.querySelector('.collision-group-warning');
      expect(warningGroup).toBeInTheDocument();
      expect(warningGroup?.textContent).toContain('WARNINGS');
      expect(warningGroup?.textContent).toContain('Warning Alert');
    });

    it('should group info alerts together', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', severity: 'info', title: 'Info Alert' }),
      ];

      const { container } = render(
        <CollisionAlert
          alerts={alerts}
          visible={true}
        />
      );

      const infoGroup = container.querySelector('.collision-group-info');
      expect(infoGroup).toBeInTheDocument();
      expect(infoGroup?.textContent).toContain('INFO');
      expect(infoGroup?.textContent).toContain('Info Alert');
    });
  });

  describe('type icons', () => {
    it('should show [F] for file type', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', type: 'file' }),
      ];

      const { container } = render(
        <CollisionAlert
          alerts={alerts}
          visible={true}
        />
      );

      expect(container.querySelector('.collision-item-type')?.textContent).toBe('[F]');
    });

    it('should show [B] for bead type', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', type: 'bead' }),
      ];

      const { container } = render(
        <CollisionAlert
          alerts={alerts}
          visible={true}
        />
      );

      expect(container.querySelector('.collision-item-type')?.textContent).toBe('[B]');
    });

    it('should show [T] for task type', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', type: 'task' }),
      ];

      const { container } = render(
        <CollisionAlert
          alerts={alerts}
          visible={true}
        />
      );

      expect(container.querySelector('.collision-item-type')?.textContent).toBe('[T]');
    });
  });

  describe('severity icons', () => {
    it('should show !!! for critical', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', severity: 'critical' }),
      ];

      const { container } = render(
        <CollisionAlert
          alerts={alerts}
          visible={true}
        />
      );

      expect(container.querySelector('.collision-item-icon')?.textContent).toBe('!!!');
    });

    it('should show !! for error', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', severity: 'error' }),
      ];

      const { container } = render(
        <CollisionAlert
          alerts={alerts}
          visible={true}
        />
      );

      expect(container.querySelector('.collision-item-icon')?.textContent).toBe('!!');
    });

    it('should show ! for warning', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', severity: 'warning' }),
      ];

      const { container } = render(
        <CollisionAlert
          alerts={alerts}
          visible={true}
        />
      );

      expect(container.querySelector('.collision-item-icon')?.textContent).toBe('!');
    });

    it('should show i for info', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', severity: 'info' }),
      ];

      const { container } = render(
        <CollisionAlert
          alerts={alerts}
          visible={true}
        />
      );

      expect(container.querySelector('.collision-item-icon')?.textContent).toBe('i');
    });
  });

  describe('acknowledgment', () => {
    it('should call onAcknowledge when acknowledge button clicked', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', title: 'Test Alert' }),
      ];

      const { container } = render(
        <CollisionAlert
          alerts={alerts}
          visible={true}
          onAcknowledge={mockOnAcknowledge}
        />
      );

      // Click acknowledge button (alert is already selected by default)
      const ackBtn = container.querySelector('.collision-action-btn');
      expect(ackBtn).toBeInTheDocument();
      fireEvent.click(ackBtn!);

      expect(mockOnAcknowledge).toHaveBeenCalledWith('alert-1');
    });

    it('should call onAcknowledgeAll when acknowledge all clicked', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1' }),
        createMockAlert({ id: 'alert-2' }),
      ];

      const { container } = render(
        <CollisionAlert
          alerts={alerts}
          visible={true}
          onAcknowledgeAll={mockOnAcknowledgeAll}
        />
      );

      const ackAllBtn = container.querySelectorAll('.collision-action-btn')[1];
      fireEvent.click(ackAllBtn);

      expect(mockOnAcknowledgeAll).toHaveBeenCalled();
    });

    it('should show [ACK] for acknowledged alerts', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', acknowledged: true, title: 'Acknowledged Alert' }),
      ];

      const { container } = render(
        <CollisionAlert
          alerts={alerts}
          visible={true}
        />
      );

      expect(container.querySelector('.collision-item-ack')?.textContent).toBe('[ACK]');
    });

    it('should disable acknowledge button for acknowledged alerts', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', acknowledged: true, title: 'Acknowledged Alert' }),
      ];

      const { container } = render(
        <CollisionAlert
          alerts={alerts}
          visible={true}
          onAcknowledge={mockOnAcknowledge}
        />
      );

      const acknowledgeBtn = container.querySelector('.collision-action-btn');
      expect(acknowledgeBtn).toBeDisabled();
    });
  });

  describe('detail view', () => {
    it('should show detail section when alert selected', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', title: 'Test Alert', description: 'Detailed description' }),
      ];

      const { container } = render(
        <CollisionAlert
          alerts={alerts}
          visible={true}
        />
      );

      const detailSection = container.querySelector('.collision-detail');
      expect(detailSection).toBeInTheDocument();
      expect(detailSection?.textContent).toContain('Selected Alert Details:');
      expect(detailSection?.textContent).toContain('Detailed description');
    });

    it('should show workers in detail view', () => {
      const alerts = [
        createMockAlert({
          id: 'alert-1',
          workers: ['worker-alpha', 'worker-beta']
        }),
      ];

      const { container } = render(
        <CollisionAlert
          alerts={alerts}
          visible={true}
        />
      );

      const detailSection = container.querySelector('.collision-detail');
      expect(detailSection?.textContent).toContain('worker-alpha');
      expect(detailSection?.textContent).toContain('worker-beta');
    });

    it('should show suggestion when present', () => {
      const alerts = [
        createMockAlert({
          id: 'alert-1',
          suggestion: 'Consider coordinating with other worker'
        }),
      ];

      const { container } = render(
        <CollisionAlert
          alerts={alerts}
          visible={true}
        />
      );

      expect(container.querySelector('.collision-detail-suggestion')?.textContent).toContain('Consider coordinating');
    });
  });

  describe('close button', () => {
    it('should call onClose when close button clicked', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1' }),
      ];

      const { container } = render(
        <CollisionAlert
          alerts={alerts}
          visible={true}
          onClose={mockOnClose}
        />
      );

      const closeBtn = container.querySelector('.collision-alert-close');
      fireEvent.click(closeBtn!);

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe('worker display', () => {
    it('should show worker count when more than 2 workers', () => {
      const alerts = [
        createMockAlert({
          id: 'alert-1',
          workers: ['w1', 'w2', 'w3', 'w4']
        }),
      ];

      const { container } = render(
        <CollisionAlert
          alerts={alerts}
          visible={true}
        />
      );

      expect(container.querySelector('.collision-item-workers')?.textContent).toBe('4 workers');
    });

    it('should show worker names when 2 or fewer workers', () => {
      const alerts = [
        createMockAlert({
          id: 'alert-1',
          workers: ['alpha', 'beta']
        }),
      ];

      const { container } = render(
        <CollisionAlert
          alerts={alerts}
          visible={true}
        />
      );

      expect(container.querySelector('.collision-item-workers')?.textContent).toBe('alpha, beta');
    });
  });

  describe('title truncation', () => {
    it('should truncate long titles', () => {
      const longTitle = 'A'.repeat(50);
      const alerts = [
        createMockAlert({ id: 'alert-1', title: longTitle }),
      ];

      const { container } = render(
        <CollisionAlert
          alerts={alerts}
          visible={true}
        />
      );

      // Title should be truncated to 40 chars + '...'
      const titleEl = container.querySelector('.collision-item-title');
      expect(titleEl?.textContent).toBe('A'.repeat(40) + '...');
    });
  });

  describe('CSS classes', () => {
    it('should apply collision-alert-panel class', () => {
      const { container } = render(
        <CollisionAlert alerts={[]} visible={true} />
      );

      expect(container.querySelector('.collision-alert-panel')).toBeInTheDocument();
    });

    it('should apply severity class to items', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', severity: 'critical' }),
      ];

      const { container } = render(
        <CollisionAlert alerts={alerts} visible={true} />
      );

      expect(container.querySelector('.collision-severity-critical')).toBeInTheDocument();
    });

    it('should apply selected class to selected item', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', title: 'First' }),
        createMockAlert({ id: 'alert-2', title: 'Second' }),
      ];

      const { container } = render(
        <CollisionAlert alerts={alerts} visible={true} />
      );

      // First item should be selected by default
      const selectedItems = container.querySelectorAll('.collision-item.selected');
      expect(selectedItems.length).toBe(1);
    });

    it('should apply acknowledged class', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', acknowledged: true }),
      ];

      const { container } = render(
        <CollisionAlert alerts={alerts} visible={true} />
      );

      expect(container.querySelector('.collision-item.acknowledged')).toBeInTheDocument();
    });
  });

  describe('selection', () => {
    it('should change selection when clicking an alert', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', title: 'First Alert' }),
        createMockAlert({ id: 'alert-2', title: 'Second Alert' }),
      ];

      const { container } = render(
        <CollisionAlert alerts={alerts} visible={true} />
      );

      // Click second item
      const items = container.querySelectorAll('.collision-item');
      fireEvent.click(items[1]);

      // Second item should now be selected
      expect(items[1]).toHaveClass('selected');
      expect(items[0]).not.toHaveClass('selected');
    });
  });
});
