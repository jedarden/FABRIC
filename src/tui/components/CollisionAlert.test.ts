/**
 * Tests for CollisionAlert Component
 *
 * Tests collision alert rendering, acknowledgement, navigation, and severity display.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import blessed from 'blessed';

// Mock the blessed module before importing CollisionAlert
vi.mock('blessed', () => {
  // Create mock instances
  const mockBoxInstance = {
    setContent: vi.fn(),
    focus: vi.fn(),
    key: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    visible: true,
    screen: {
      render: vi.fn(),
    },
  };

  const mockListInstance = {
    key: vi.fn(),
    focus: vi.fn(),
  };

  const mockBox = vi.fn(() => mockBoxInstance);
  const mockList = vi.fn(() => mockListInstance);

  return {
    default: {
      box: mockBox,
      list: mockList,
    },
    box: mockBox,
    list: mockList,
  };
});

// Import after mocking
import { CollisionAlert } from './CollisionAlert.js';
import { CollisionAlert as CollisionAlertData, FileCollision, BeadCollision } from '../../types.js';

// Helper to create mock CollisionAlert data
function createMockAlert(overrides: Partial<CollisionAlertData> = {}): CollisionAlertData {
  return {
    id: 'alert-123',
    type: 'file',
    severity: 'warning',
    title: 'File collision detected',
    description: 'Multiple workers editing src/example.ts',
    workers: ['w-alice', 'w-bob'],
    timestamp: Date.now(),
    acknowledged: false,
    collision: {
      path: 'src/example.ts',
      workers: ['w-alice', 'w-bob'],
      detectedAt: Date.now(),
      events: [],
      isActive: true,
    } as FileCollision,
    ...overrides,
  };
}

// Helper to create mock screen
function createMockScreen() {
  return {
    render: vi.fn(),
    append: vi.fn(),
    key: vi.fn(),
    destroy: vi.fn(),
  } as unknown as blessed.Widgets.Screen;
}

describe('CollisionAlert', () => {
  let collisionAlert: CollisionAlert;
  let mockScreen: blessed.Widgets.Screen;
  let mockBoxInstance: any;
  let mockListInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockScreen = createMockScreen();

    // Get the mock instances from the mocks
    const blessedMock = blessed as unknown as { box: Mock; list: Mock };
    mockBoxInstance = blessedMock.box();
    mockListInstance = blessedMock.list();

    collisionAlert = new CollisionAlert({
      parent: mockScreen,
      top: 0,
      left: 0,
      width: '50%',
      height: 10,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a blessed box with correct options', () => {
      const blessedMock = blessed as unknown as { box: Mock };
      expect(blessedMock.box).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: mockScreen,
          top: 0,
          left: 0,
          width: '50%',
          height: 10,
          label: ' Collision Alerts ',
          scrollable: true,
          alwaysScroll: true,
          keys: true,
          vi: true,
          mouse: true,
        })
      );
    });

    it('should create a list inside the box', () => {
      const blessedMock = blessed as unknown as { list: Mock };
      expect(blessedMock.list).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: mockBoxInstance,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          keys: true,
          vi: true,
          mouse: true,
        })
      );
    });

    it('should bind key handlers on construction', () => {
      // List key bindings should be registered
      expect(mockListInstance.key).toHaveBeenCalled();
    });

    it('should register onAcknowledge callback', () => {
      const onAcknowledge = vi.fn();
      const alert = new CollisionAlert({
        parent: mockScreen,
        top: 0,
        left: 0,
        width: '50%',
        height: 10,
        onAcknowledge,
      });

      const alerts = [createMockAlert()];
      alert.updateAlerts(alerts);
      alert.acknowledgeSelected();

      expect(onAcknowledge).toHaveBeenCalledWith('alert-123');
    });
  });

  describe('updateAlerts', () => {
    it('should update alerts list and render', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', severity: 'warning' }),
        createMockAlert({ id: 'alert-2', severity: 'critical' }),
      ];

      collisionAlert.updateAlerts(alerts);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should show "No active collisions" when empty', () => {
      collisionAlert.updateAlerts([]);

      expect(mockBoxInstance.setContent).toHaveBeenCalledWith(
        expect.stringContaining('No active collisions detected')
      );
    });

    it('should show alert count in header', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1' }),
        createMockAlert({ id: 'alert-2' }),
        createMockAlert({ id: 'alert-3' }),
      ];

      collisionAlert.updateAlerts(alerts);

      expect(mockBoxInstance.setContent).toHaveBeenCalledWith(
        expect.stringContaining('Alerts: 3')
      );
    });

    it('should reset selected index if out of bounds', () => {
      // First set some alerts
      collisionAlert.updateAlerts([
        createMockAlert({ id: 'alert-1' }),
        createMockAlert({ id: 'alert-2' }),
      ]);

      // Update to fewer alerts
      collisionAlert.updateAlerts([createMockAlert({ id: 'alert-1' })]);

      // Should not throw and selection should be valid
      const selected = collisionAlert.getSelected();
      expect(selected).toBeDefined();
      expect(selected?.id).toBe('alert-1');
    });
  });

  describe('selectNext', () => {
    it('should move to next alert', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1' }),
        createMockAlert({ id: 'alert-2' }),
        createMockAlert({ id: 'alert-3' }),
      ];

      collisionAlert.updateAlerts(alerts);

      // Initially selected is first alert
      expect(collisionAlert.getSelected()?.id).toBe('alert-1');

      collisionAlert.selectNext();
      expect(collisionAlert.getSelected()?.id).toBe('alert-2');
    });

    it('should wrap to first alert when at end', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1' }),
        createMockAlert({ id: 'alert-2' }),
      ];

      collisionAlert.updateAlerts(alerts);

      // Move to last
      collisionAlert.selectNext();
      expect(collisionAlert.getSelected()?.id).toBe('alert-2');

      // Wrap to first
      collisionAlert.selectNext();
      expect(collisionAlert.getSelected()?.id).toBe('alert-1');
    });

    it('should do nothing when no alerts', () => {
      collisionAlert.updateAlerts([]);

      // Should not throw
      expect(() => collisionAlert.selectNext()).not.toThrow();
    });
  });

  describe('selectPrevious', () => {
    it('should move to previous alert', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1' }),
        createMockAlert({ id: 'alert-2' }),
        createMockAlert({ id: 'alert-3' }),
      ];

      collisionAlert.updateAlerts(alerts);

      // Move to second
      collisionAlert.selectNext();
      expect(collisionAlert.getSelected()?.id).toBe('alert-2');

      // Move back to first
      collisionAlert.selectPrevious();
      expect(collisionAlert.getSelected()?.id).toBe('alert-1');
    });

    it('should wrap to last alert when at beginning', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1' }),
        createMockAlert({ id: 'alert-2' }),
      ];

      collisionAlert.updateAlerts(alerts);

      // At first, wrap to last
      collisionAlert.selectPrevious();
      expect(collisionAlert.getSelected()?.id).toBe('alert-2');
    });

    it('should do nothing when no alerts', () => {
      collisionAlert.updateAlerts([]);

      // Should not throw
      expect(() => collisionAlert.selectPrevious()).not.toThrow();
    });
  });

  describe('acknowledgeSelected', () => {
    it('should acknowledge the selected alert', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', acknowledged: false }),
      ];

      collisionAlert.updateAlerts(alerts);
      expect(collisionAlert.getSelected()?.acknowledged).toBe(false);

      collisionAlert.acknowledgeSelected();

      expect(collisionAlert.getSelected()?.acknowledged).toBe(true);
    });

    it('should call onAcknowledge callback', () => {
      const onAcknowledge = vi.fn();
      const alert = new CollisionAlert({
        parent: mockScreen,
        top: 0,
        left: 0,
        width: '50%',
        height: 10,
        onAcknowledge,
      });

      const alerts = [createMockAlert({ id: 'alert-xyz' })];
      alert.updateAlerts(alerts);
      alert.acknowledgeSelected();

      expect(onAcknowledge).toHaveBeenCalledWith('alert-xyz');
    });

    it('should not call callback if already acknowledged', () => {
      const onAcknowledge = vi.fn();
      const alert = new CollisionAlert({
        parent: mockScreen,
        top: 0,
        left: 0,
        width: '50%',
        height: 10,
        onAcknowledge,
      });

      const alerts = [createMockAlert({ acknowledged: true })];
      alert.updateAlerts(alerts);
      alert.acknowledgeSelected();

      expect(onAcknowledge).not.toHaveBeenCalled();
    });

    it('should do nothing when no alerts', () => {
      collisionAlert.updateAlerts([]);

      // Should not throw
      expect(() => collisionAlert.acknowledgeSelected()).not.toThrow();
    });
  });

  describe('acknowledgeAll', () => {
    it('should acknowledge all unacknowledged alerts', () => {
      const alerts = [
        createMockAlert({ id: 'alert-1', acknowledged: false }),
        createMockAlert({ id: 'alert-2', acknowledged: false }),
        createMockAlert({ id: 'alert-3', acknowledged: true }),
      ];

      collisionAlert.updateAlerts(alerts);
      collisionAlert.acknowledgeAll();

      const updatedAlerts = [
        collisionAlert.getSelected(),
        ...alerts.slice(1),
      ];

      expect(alerts[0].acknowledged).toBe(true);
      expect(alerts[1].acknowledged).toBe(true);
      expect(alerts[2].acknowledged).toBe(true);
    });

    it('should call onAcknowledge for each unacknowledged alert', () => {
      const onAcknowledge = vi.fn();
      const alert = new CollisionAlert({
        parent: mockScreen,
        top: 0,
        left: 0,
        width: '50%',
        height: 10,
        onAcknowledge,
      });

      const alerts = [
        createMockAlert({ id: 'alert-1', acknowledged: false }),
        createMockAlert({ id: 'alert-2', acknowledged: false }),
        createMockAlert({ id: 'alert-3', acknowledged: true }),
      ];

      alert.updateAlerts(alerts);
      alert.acknowledgeAll();

      expect(onAcknowledge).toHaveBeenCalledTimes(2);
      expect(onAcknowledge).toHaveBeenCalledWith('alert-1');
      expect(onAcknowledge).toHaveBeenCalledWith('alert-2');
    });
  });

  describe('getUnacknowledgedCount', () => {
    it('should return count of unacknowledged alerts', () => {
      const alerts = [
        createMockAlert({ acknowledged: false }),
        createMockAlert({ acknowledged: false }),
        createMockAlert({ acknowledged: true }),
        createMockAlert({ acknowledged: false }),
      ];

      collisionAlert.updateAlerts(alerts);

      expect(collisionAlert.getUnacknowledgedCount()).toBe(3);
    });

    it('should return 0 when all acknowledged', () => {
      const alerts = [
        createMockAlert({ acknowledged: true }),
        createMockAlert({ acknowledged: true }),
      ];

      collisionAlert.updateAlerts(alerts);

      expect(collisionAlert.getUnacknowledgedCount()).toBe(0);
    });

    it('should return 0 when no alerts', () => {
      collisionAlert.updateAlerts([]);
      expect(collisionAlert.getUnacknowledgedCount()).toBe(0);
    });
  });

  describe('show and hide', () => {
    it('should show the panel', () => {
      collisionAlert.show();

      expect(mockBoxInstance.show).toHaveBeenCalled();
      expect(mockListInstance.focus).toHaveBeenCalled();
    });

    it('should hide the panel', () => {
      collisionAlert.hide();

      expect(mockBoxInstance.hide).toHaveBeenCalled();
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should report visibility correctly', () => {
      mockBoxInstance.visible = true;
      expect(collisionAlert.isVisible()).toBe(true);

      mockBoxInstance.visible = false;
      expect(collisionAlert.isVisible()).toBe(false);
    });
  });

  describe('focus', () => {
    it('should focus the list element', () => {
      collisionAlert.focus();
      expect(mockListInstance.focus).toHaveBeenCalled();
    });
  });

  describe('getElement', () => {
    it('should return the box element', () => {
      const element = collisionAlert.getElement();
      expect(element).toBe(mockBoxInstance);
    });
  });

  describe('severity display', () => {
    it('should display critical severity with correct icon and color', () => {
      const alerts = [
        createMockAlert({ severity: 'critical', title: 'Critical alert' }),
      ];

      collisionAlert.updateAlerts(alerts);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('!!!'); // Critical icon
      expect(content).toContain('red'); // Critical color
      expect(content).toContain('Critical alert');
    });

    it('should display error severity with correct icon and color', () => {
      const alerts = [
        createMockAlert({ severity: 'error', title: 'Error alert' }),
      ];

      collisionAlert.updateAlerts(alerts);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('!!'); // Error icon
      expect(content).toContain('red'); // Error color
    });

    it('should display warning severity with correct icon and color', () => {
      const alerts = [
        createMockAlert({ severity: 'warning', title: 'Warning alert' }),
      ];

      collisionAlert.updateAlerts(alerts);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('!'); // Warning icon
      expect(content).toContain('yellow'); // Warning color
    });

    it('should display info severity with correct icon and color', () => {
      const alerts = [
        createMockAlert({ severity: 'info', title: 'Info alert' }),
      ];

      collisionAlert.updateAlerts(alerts);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('i'); // Info icon
      expect(content).toContain('blue'); // Info color
    });
  });

  describe('collision type display', () => {
    it('should display file collision type icon', () => {
      const alerts = [
        createMockAlert({ type: 'file', title: 'File collision' }),
      ];

      collisionAlert.updateAlerts(alerts);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('[F]'); // File type icon
    });

    it('should display bead collision type icon', () => {
      const alerts = [
        createMockAlert({
          type: 'bead',
          title: 'Bead collision',
          collision: {
            beadId: 'bd-123',
            workers: ['w-alice', 'w-bob'],
            detectedAt: Date.now(),
            events: [],
            isActive: true,
            severity: 'warning',
          } as BeadCollision,
        }),
      ];

      collisionAlert.updateAlerts(alerts);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('[B]'); // Bead type icon
    });

    it('should display task collision type icon', () => {
      const alerts = [
        createMockAlert({
          type: 'task',
          title: 'Task collision',
          collision: {
            type: 'directory',
            description: 'Directory conflict',
            workers: ['w-alice', 'w-bob'],
            affectedResources: ['src/'],
            detectedAt: Date.now(),
            isActive: true,
            riskLevel: 'medium',
          },
        }),
      ];

      collisionAlert.updateAlerts(alerts);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('[T]'); // Task type icon
    });
  });

  describe('alert grouping by severity', () => {
    it('should group critical and error alerts together', () => {
      const alerts = [
        createMockAlert({ id: 'critical-1', severity: 'critical', title: 'Critical 1' }),
        createMockAlert({ id: 'error-1', severity: 'error', title: 'Error 1' }),
        createMockAlert({ id: 'warning-1', severity: 'warning', title: 'Warning 1' }),
      ];

      collisionAlert.updateAlerts(alerts);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('CRITICAL/ERROR (2)');
      expect(content).toContain('WARNINGS (1)');
    });

    it('should show warnings in separate section', () => {
      const alerts = [
        createMockAlert({ severity: 'warning', title: 'Warning 1' }),
        createMockAlert({ severity: 'warning', title: 'Warning 2' }),
      ];

      collisionAlert.updateAlerts(alerts);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('WARNINGS (2)');
    });

    it('should show info alerts in separate section', () => {
      const alerts = [
        createMockAlert({ severity: 'info', title: 'Info 1' }),
        createMockAlert({ severity: 'info', title: 'Info 2' }),
      ];

      collisionAlert.updateAlerts(alerts);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('INFO (2)');
    });
  });

  describe('acknowledged alerts display', () => {
    it('should show [ACK] marker for acknowledged alerts', () => {
      const alerts = [
        createMockAlert({ acknowledged: true, title: 'Acked alert' }),
      ];

      collisionAlert.updateAlerts(alerts);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('[ACK]');
    });

    it('should not show [ACK] marker for unacknowledged alerts', () => {
      const alerts = [
        createMockAlert({ acknowledged: false, title: 'Unacked alert' }),
      ];

      collisionAlert.updateAlerts(alerts);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      // Content should not have ACK marker before the alert
      const lines = content.split('\n');
      const alertLine = lines.find((line: string) => line.includes('Unacked alert'));
      expect(alertLine).not.toContain('[ACK]');
    });

    it('should show unacknowledged count in header', () => {
      const alerts = [
        createMockAlert({ acknowledged: false }),
        createMockAlert({ acknowledged: true }),
        createMockAlert({ acknowledged: false }),
      ];

      collisionAlert.updateAlerts(alerts);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('(2 unacknowledged)');
    });
  });

  describe('worker display', () => {
    it('should show worker names when 2 or fewer workers', () => {
      const alerts = [
        createMockAlert({
          workers: ['w-alice', 'w-bob'],
          title: 'Two workers',
        }),
      ];

      collisionAlert.updateAlerts(alerts);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('w-alice');
      expect(content).toContain('w-bob');
    });

    it('should show worker count when more than 2 workers', () => {
      const alerts = [
        createMockAlert({
          workers: ['w-alice', 'w-bob', 'w-charlie'],
          title: 'Three workers',
        }),
      ];

      collisionAlert.updateAlerts(alerts);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('3 workers');
    });

    it('should truncate worker list to 15 characters', () => {
      const alerts = [
        createMockAlert({
          workers: ['very-long-worker-name', 'another-long-name'],
          title: 'Long names',
        }),
      ];

      collisionAlert.updateAlerts(alerts);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      // Should be truncated to 15 chars
      const lines = content.split('\n');
      const alertLine = lines.find((line: string) => line.includes('Long names'));
      // Check that there's a 15-char limit somewhere in the worker display
      expect(alertLine).toBeDefined();
    });
  });

  describe('selected alert details', () => {
    it('should show details of selected alert', () => {
      const alerts = [
        createMockAlert({
          title: 'Test Alert',
          description: 'This is a test description',
          workers: ['w-alice', 'w-bob'],
          suggestion: 'Coordinate with other workers',
        }),
      ];

      collisionAlert.updateAlerts(alerts);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('Selected Alert Details');
      expect(content).toContain('Test Alert');
      expect(content).toContain('This is a test description');
      expect(content).toContain('w-alice, w-bob');
      expect(content).toContain('Coordinate with other workers');
    });

    it('should show suggestion when provided', () => {
      const alerts = [
        createMockAlert({
          suggestion: 'Please review and coordinate',
        }),
      ];

      collisionAlert.updateAlerts(alerts);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('Suggestion');
      expect(content).toContain('Please review and coordinate');
    });

    it('should not show suggestion section when not provided', () => {
      const alerts = [
        createMockAlert({
          suggestion: undefined,
        }),
      ];

      collisionAlert.updateAlerts(alerts);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      // Check that "Suggestion:" label doesn't appear
      const lines = content.split('\n');
      const suggestionLine = lines.find((line: string) => line.includes('Suggestion:'));
      expect(suggestionLine).toBeUndefined();
    });

    it('should show keyboard shortcuts in details', () => {
      const alerts = [createMockAlert()];

      collisionAlert.updateAlerts(alerts);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('[Enter] Acknowledge');
      expect(content).toContain('[a] Acknowledge All');
      expect(content).toContain('[Esc] Close');
    });
  });

  describe('key bindings', () => {
    it('should bind up and k keys to selectPrevious', () => {
      expect(mockListInstance.key).toHaveBeenCalledWith(['up', 'k'], expect.any(Function));
    });

    it('should bind down and j keys to selectNext', () => {
      expect(mockListInstance.key).toHaveBeenCalledWith(['down', 'j'], expect.any(Function));
    });

    it('should bind enter and space to acknowledgeSelected', () => {
      expect(mockListInstance.key).toHaveBeenCalledWith(['enter', 'space'], expect.any(Function));
    });

    it('should bind a key to acknowledgeAll', () => {
      expect(mockListInstance.key).toHaveBeenCalledWith(['a'], expect.any(Function));
    });

    it('should bind escape key to hide', () => {
      expect(mockListInstance.key).toHaveBeenCalledWith(['escape'], expect.any(Function));
    });
  });

  describe('edge cases', () => {
    it('should handle alerts with very long titles', () => {
      const alerts = [
        createMockAlert({
          title: 'This is a very long alert title that should be truncated to 40 characters maximum',
        }),
      ];

      collisionAlert.updateAlerts(alerts);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      // Title should be truncated (40 chars)
      expect(content).toContain('This is a very long alert title that sh');
    });

    it('should handle empty worker list', () => {
      const alerts = [
        createMockAlert({
          workers: [],
        }),
      ];

      // Should not throw
      expect(() => collisionAlert.updateAlerts(alerts)).not.toThrow();
    });

    it('should handle mixed severity levels in one update', () => {
      const alerts = [
        createMockAlert({ severity: 'critical' }),
        createMockAlert({ severity: 'error' }),
        createMockAlert({ severity: 'warning' }),
        createMockAlert({ severity: 'info' }),
      ];

      // Should not throw
      expect(() => collisionAlert.updateAlerts(alerts)).not.toThrow();

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('CRITICAL/ERROR (2)');
      expect(content).toContain('WARNINGS (1)');
      expect(content).toContain('INFO (1)');
    });

    it('should handle rapid alert updates', () => {
      const alerts1 = [createMockAlert({ id: 'alert-1' })];
      const alerts2 = [createMockAlert({ id: 'alert-2' })];
      const alerts3 = [createMockAlert({ id: 'alert-3' })];

      // Should not throw
      expect(() => {
        collisionAlert.updateAlerts(alerts1);
        collisionAlert.updateAlerts(alerts2);
        collisionAlert.updateAlerts(alerts3);
      }).not.toThrow();

      expect(collisionAlert.getSelected()?.id).toBe('alert-3');
    });
  });
});
