/**
 * Tests for ErrorGroupPanel Component
 *
 * Tests error group rendering, navigation, expansion, and severity display.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as blessed from 'blessed';

// Mock the blessed module before importing ErrorGroupPanel
vi.mock('blessed', () => {
  // Create mock instances that will be shared
  const createMockBox = () => ({
    setContent: vi.fn(),
    focus: vi.fn(),
    key: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    visible: true,
    screen: {
      render: vi.fn(),
    },
    scroll: vi.fn(),
  });

  const mockBoxInstance = createMockBox();
  const mockDetailBoxInstance = createMockBox();

  const mockListInstance = {
    setContent: vi.fn(),
    key: vi.fn(),
    focus: vi.fn(),
  };

  const mockBox = vi.fn((options) => {
    // Return detail box instance for detail view
    if (options.label === ' Details ') {
      return mockDetailBoxInstance;
    }
    return mockBoxInstance;
  });

  const mockList = vi.fn(() => mockListInstance);

  // Store instances for test access
  mockBox._mockBoxInstance = mockBoxInstance;
  mockBox._mockDetailBoxInstance = mockDetailBoxInstance;
  mockList._mockListInstance = mockListInstance;

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
import { ErrorGroupPanel } from './ErrorGroupPanel.js';
import { ErrorGroup, ErrorFingerprint, LogEvent } from '../../types.js';

// Helper to create mock error fingerprint
function createMockFingerprint(overrides: Partial<ErrorFingerprint> = {}): ErrorFingerprint {
  return {
    signature: 'ECONNREFUSED *:*',
    category: 'network',
    sampleMessage: 'Error: connect ECONNREFUSED 127.0.0.1:5432',
    hash: '1a2b3c4d',
    ...overrides,
  };
}

// Helper to create mock error event
function createMockEvent(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    ts: Date.now(),
    worker: 'w-alice',
    level: 'error',
    msg: 'Error occurred',
    error: 'Error: connect ECONNREFUSED 127.0.0.1:5432',
    ...overrides,
  };
}

// Helper to create mock error group
function createMockGroup(overrides: Partial<ErrorGroup> = {}): ErrorGroup {
  return {
    id: 'eg-123',
    fingerprint: createMockFingerprint(),
    events: [createMockEvent()],
    firstSeen: Date.now() - 60000, // 1 minute ago
    lastSeen: Date.now() - 10000, // 10 seconds ago
    count: 1,
    affectedWorkers: ['w-alice'],
    isActive: true,
    severity: 'medium',
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

describe('ErrorGroupPanel', () => {
  let errorGroupPanel: ErrorGroupPanel;
  let mockScreen: blessed.Widgets.Screen;
  let mockBoxInstance: any;
  let mockListInstance: any;
  let mockDetailBoxInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockScreen = createMockScreen();

    // Get the mock instances from the mocks
    const blessedMock = blessed as unknown as {
      box: vi.Mock & { _mockBoxInstance: any; _mockDetailBoxInstance: any };
      list: vi.Mock & { _mockListInstance: any };
    };

    mockBoxInstance = blessedMock.box._mockBoxInstance;
    mockDetailBoxInstance = blessedMock.box._mockDetailBoxInstance;
    mockListInstance = blessedMock.list._mockListInstance;

    errorGroupPanel = new ErrorGroupPanel({
      parent: mockScreen,
      top: 0,
      left: 0,
      width: '50%',
      height: 20,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create a blessed box with correct options', () => {
      const blessedMock = blessed as unknown as { box: vi.Mock };
      expect(blessedMock.box).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: mockScreen,
          top: 0,
          left: 0,
          width: '50%',
          height: 20,
          label: ' Error Groups ',
          scrollable: true,
          alwaysScroll: true,
          keys: true,
          vi: true,
          mouse: true,
        })
      );
    });

    it('should create a list inside the box', () => {
      const blessedMock = blessed as unknown as { list: vi.Mock };
      expect(blessedMock.list).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: mockBoxInstance,
          top: 0,
          left: 0,
          right: 0,
          height: '50%',
          keys: true,
          vi: true,
          mouse: true,
        })
      );
    });

    it('should create a detail box for expanded view', () => {
      const blessedMock = blessed as unknown as { box: vi.Mock };
      expect(blessedMock.box).toHaveBeenCalledWith(
        expect.objectContaining({
          label: ' Details ',
          top: '50%',
          scrollable: true,
        })
      );
    });

    it('should bind key handlers on construction', () => {
      // List key bindings should be registered
      expect(mockListInstance.key).toHaveBeenCalled();
    });

    it('should register onSelect callback', () => {
      const onSelect = vi.fn();
      const panel = new ErrorGroupPanel({
        parent: mockScreen,
        top: 0,
        left: 0,
        width: '50%',
        height: 20,
        onSelect,
      });

      const groups = [createMockGroup()];
      panel.updateGroups(groups);
      panel.toggleExpanded();

      expect(onSelect).toHaveBeenCalledWith('eg-123');
    });
  });

  describe('updateGroups', () => {
    it('should update groups list and render', () => {
      const groups = [
        createMockGroup({ id: 'eg-1', severity: 'medium' }),
        createMockGroup({ id: 'eg-2', severity: 'critical' }),
      ];

      errorGroupPanel.updateGroups(groups);

      expect(mockListInstance.setContent).toHaveBeenCalled();
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should show "No errors detected" when empty', () => {
      errorGroupPanel.updateGroups([]);

      expect(mockListInstance.setContent).toHaveBeenCalledWith(
        expect.stringContaining('No errors detected')
      );
    });

    it('should show group count in header', () => {
      const groups = [
        createMockGroup({ id: 'eg-1' }),
        createMockGroup({ id: 'eg-2' }),
        createMockGroup({ id: 'eg-3' }),
      ];

      errorGroupPanel.updateGroups(groups);

      expect(mockListInstance.setContent).toHaveBeenCalledWith(
        expect.stringContaining('Groups: 3')
      );
    });

    it('should reset selected index if out of bounds', () => {
      // First set some groups
      errorGroupPanel.updateGroups([
        createMockGroup({ id: 'eg-1' }),
        createMockGroup({ id: 'eg-2' }),
      ]);

      // Update to fewer groups
      errorGroupPanel.updateGroups([createMockGroup({ id: 'eg-1' })]);

      // Should not throw and selection should be valid
      const selected = errorGroupPanel.getSelected();
      expect(selected).toBeDefined();
      expect(selected?.id).toBe('eg-1');
    });
  });

  describe('selectNext', () => {
    it('should move to next group', () => {
      const groups = [
        createMockGroup({ id: 'eg-1' }),
        createMockGroup({ id: 'eg-2' }),
        createMockGroup({ id: 'eg-3' }),
      ];

      errorGroupPanel.updateGroups(groups);

      // Initially selected is first group
      expect(errorGroupPanel.getSelected()?.id).toBe('eg-1');

      errorGroupPanel.selectNext();
      expect(errorGroupPanel.getSelected()?.id).toBe('eg-2');
    });

    it('should wrap to first group when at end', () => {
      const groups = [
        createMockGroup({ id: 'eg-1' }),
        createMockGroup({ id: 'eg-2' }),
      ];

      errorGroupPanel.updateGroups(groups);

      // Move to last
      errorGroupPanel.selectNext();
      expect(errorGroupPanel.getSelected()?.id).toBe('eg-2');

      // Wrap to first
      errorGroupPanel.selectNext();
      expect(errorGroupPanel.getSelected()?.id).toBe('eg-1');
    });

    it('should do nothing when no groups', () => {
      errorGroupPanel.updateGroups([]);

      // Should not throw
      expect(() => errorGroupPanel.selectNext()).not.toThrow();
    });
  });

  describe('selectPrevious', () => {
    it('should move to previous group', () => {
      const groups = [
        createMockGroup({ id: 'eg-1' }),
        createMockGroup({ id: 'eg-2' }),
        createMockGroup({ id: 'eg-3' }),
      ];

      errorGroupPanel.updateGroups(groups);

      // Move to second
      errorGroupPanel.selectNext();
      expect(errorGroupPanel.getSelected()?.id).toBe('eg-2');

      // Move back to first
      errorGroupPanel.selectPrevious();
      expect(errorGroupPanel.getSelected()?.id).toBe('eg-1');
    });

    it('should wrap to last group when at beginning', () => {
      const groups = [
        createMockGroup({ id: 'eg-1' }),
        createMockGroup({ id: 'eg-2' }),
      ];

      errorGroupPanel.updateGroups(groups);

      // At first, wrap to last
      errorGroupPanel.selectPrevious();
      expect(errorGroupPanel.getSelected()?.id).toBe('eg-2');
    });

    it('should do nothing when no groups', () => {
      errorGroupPanel.updateGroups([]);

      // Should not throw
      expect(() => errorGroupPanel.selectPrevious()).not.toThrow();
    });
  });

  describe('toggleExpanded', () => {
    it('should expand the selected group', () => {
      const groups = [createMockGroup({ id: 'eg-xyz' })];

      errorGroupPanel.updateGroups(groups);
      errorGroupPanel.toggleExpanded();

      // Detail box should show details
      expect(mockDetailBoxInstance.setContent).toHaveBeenCalledWith(
        expect.stringContaining('Error Group: eg-xyz')
      );
    });

    it('should collapse when toggling expanded group', () => {
      const groups = [createMockGroup({ id: 'eg-xyz' })];

      errorGroupPanel.updateGroups(groups);

      // Expand
      errorGroupPanel.toggleExpanded();
      expect(mockDetailBoxInstance.setContent).toHaveBeenCalledWith(
        expect.stringContaining('Error Group: eg-xyz')
      );

      // Collapse
      errorGroupPanel.toggleExpanded();
      expect(mockDetailBoxInstance.setContent).toHaveBeenCalledWith(
        expect.stringContaining('Select an error group and press Enter to view details')
      );
    });

    it('should call onSelect callback when expanding', () => {
      const onSelect = vi.fn();
      const panel = new ErrorGroupPanel({
        parent: mockScreen,
        top: 0,
        left: 0,
        width: '50%',
        height: 20,
        onSelect,
      });

      const groups = [createMockGroup({ id: 'eg-abc' })];
      panel.updateGroups(groups);
      panel.toggleExpanded();

      expect(onSelect).toHaveBeenCalledWith('eg-abc');
    });

    it('should do nothing when no groups', () => {
      errorGroupPanel.updateGroups([]);

      // Should not throw
      expect(() => errorGroupPanel.toggleExpanded()).not.toThrow();
    });
  });

  describe('getActiveErrorCount', () => {
    it('should return count of active error groups', () => {
      const groups = [
        createMockGroup({ isActive: true }),
        createMockGroup({ isActive: true }),
        createMockGroup({ isActive: false }),
        createMockGroup({ isActive: true }),
      ];

      errorGroupPanel.updateGroups(groups);

      expect(errorGroupPanel.getActiveErrorCount()).toBe(3);
    });

    it('should return 0 when all inactive', () => {
      const groups = [
        createMockGroup({ isActive: false }),
        createMockGroup({ isActive: false }),
      ];

      errorGroupPanel.updateGroups(groups);

      expect(errorGroupPanel.getActiveErrorCount()).toBe(0);
    });

    it('should return 0 when no groups', () => {
      errorGroupPanel.updateGroups([]);
      expect(errorGroupPanel.getActiveErrorCount()).toBe(0);
    });
  });

  describe('show and hide', () => {
    it('should show the panel', () => {
      errorGroupPanel.show();

      expect(mockBoxInstance.show).toHaveBeenCalled();
      expect(mockListInstance.focus).toHaveBeenCalled();
    });

    it('should hide the panel', () => {
      errorGroupPanel.hide();

      expect(mockBoxInstance.hide).toHaveBeenCalled();
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should report visibility correctly', () => {
      mockBoxInstance.visible = true;
      expect(errorGroupPanel.isVisible()).toBe(true);

      mockBoxInstance.visible = false;
      expect(errorGroupPanel.isVisible()).toBe(false);
    });
  });

  describe('focus', () => {
    it('should focus the list element', () => {
      errorGroupPanel.focus();
      expect(mockListInstance.focus).toHaveBeenCalled();
    });
  });

  describe('getElement', () => {
    it('should return the box element', () => {
      const element = errorGroupPanel.getElement();
      expect(element).toBe(mockBoxInstance);
    });
  });

  describe('severity display', () => {
    it('should display critical severity with correct icon and color', () => {
      const groups = [
        createMockGroup({ severity: 'critical' }),
      ];

      errorGroupPanel.updateGroups(groups);

      const content = mockListInstance.setContent.mock.calls[0][0];
      expect(content).toContain('!!!'); // Critical icon
      expect(content).toContain('red'); // Critical color
      expect(content).toContain('CRITICAL');
    });

    it('should display high severity with correct icon and color', () => {
      const groups = [
        createMockGroup({ severity: 'high' }),
      ];

      errorGroupPanel.updateGroups(groups);

      const content = mockListInstance.setContent.mock.calls[0][0];
      expect(content).toContain('!!'); // High icon
      expect(content).toContain('red'); // High color
    });

    it('should display medium severity with correct icon and color', () => {
      const groups = [
        createMockGroup({ severity: 'medium' }),
      ];

      errorGroupPanel.updateGroups(groups);

      const content = mockListInstance.setContent.mock.calls[0][0];
      expect(content).toContain('!'); // Medium icon
      expect(content).toContain('yellow'); // Medium color
    });

    it('should display low severity with correct icon and color', () => {
      const groups = [
        createMockGroup({ severity: 'low' }),
      ];

      errorGroupPanel.updateGroups(groups);

      const content = mockListInstance.setContent.mock.calls[0][0];
      expect(content).toContain('i'); // Low icon
      expect(content).toContain('blue'); // Low color
    });
  });

  describe('category display', () => {
    it('should display network category icon', () => {
      const groups = [
        createMockGroup({
          fingerprint: createMockFingerprint({ category: 'network' }),
        }),
      ];

      errorGroupPanel.updateGroups(groups);

      const content = mockListInstance.setContent.mock.calls[0][0];
      expect(content).toContain('⚡'); // Network icon
    });

    it('should display permission category icon', () => {
      const groups = [
        createMockGroup({
          fingerprint: createMockFingerprint({ category: 'permission' }),
        }),
      ];

      errorGroupPanel.updateGroups(groups);

      const content = mockListInstance.setContent.mock.calls[0][0];
      expect(content).toContain('🔒'); // Permission icon
    });

    it('should display validation category icon', () => {
      const groups = [
        createMockGroup({
          fingerprint: createMockFingerprint({ category: 'validation' }),
        }),
      ];

      errorGroupPanel.updateGroups(groups);

      const content = mockListInstance.setContent.mock.calls[0][0];
      expect(content).toContain('✗'); // Validation icon
    });
  });

  describe('error group grouping by severity', () => {
    it('should group errors by severity level', () => {
      const groups = [
        createMockGroup({ id: 'eg-critical-1', severity: 'critical' }),
        createMockGroup({ id: 'eg-high-1', severity: 'high' }),
        createMockGroup({ id: 'eg-medium-1', severity: 'medium' }),
        createMockGroup({ id: 'eg-low-1', severity: 'low' }),
      ];

      errorGroupPanel.updateGroups(groups);

      const content = mockListInstance.setContent.mock.calls[0][0];
      expect(content).toContain('CRITICAL (1)');
      expect(content).toContain('HIGH (1)');
      expect(content).toContain('MEDIUM (1)');
      expect(content).toContain('LOW (1)');
    });

    it('should show multiple critical errors in section', () => {
      const groups = [
        createMockGroup({ severity: 'critical' }),
        createMockGroup({ severity: 'critical' }),
      ];

      errorGroupPanel.updateGroups(groups);

      const content = mockListInstance.setContent.mock.calls[0][0];
      expect(content).toContain('CRITICAL (2)');
    });
  });

  describe('active status display', () => {
    it('should show active marker for active groups', () => {
      const groups = [
        createMockGroup({ isActive: true }),
      ];

      errorGroupPanel.updateGroups(groups);

      const content = mockListInstance.setContent.mock.calls[0][0];
      expect(content).toContain('●'); // Active marker
    });

    it('should show inactive marker for inactive groups', () => {
      const groups = [
        createMockGroup({ isActive: false }),
      ];

      errorGroupPanel.updateGroups(groups);

      const content = mockListInstance.setContent.mock.calls[0][0];
      expect(content).toContain('○'); // Inactive marker
    });

    it('should show active count in header', () => {
      const groups = [
        createMockGroup({ isActive: true }),
        createMockGroup({ isActive: false }),
        createMockGroup({ isActive: true }),
      ];

      errorGroupPanel.updateGroups(groups);

      const content = mockListInstance.setContent.mock.calls[0][0];
      expect(content).toContain('Active: 2');
    });
  });

  describe('worker display', () => {
    it('should show worker names when 2 or fewer workers', () => {
      const groups = [
        createMockGroup({
          affectedWorkers: ['w-alice', 'w-bob'],
        }),
      ];

      errorGroupPanel.updateGroups(groups);

      const content = mockListInstance.setContent.mock.calls[0][0];
      expect(content).toContain('w-alice,w-bob');
    });

    it('should show worker count when more than 2 workers', () => {
      const groups = [
        createMockGroup({
          affectedWorkers: ['w-alice', 'w-bob', 'w-charlie'],
        }),
      ];

      errorGroupPanel.updateGroups(groups);

      const content = mockListInstance.setContent.mock.calls[0][0];
      expect(content).toContain('3w');
    });
  });

  describe('expanded group details', () => {
    it('should show group details when expanded', () => {
      const group = createMockGroup({
        id: 'eg-test',
        fingerprint: createMockFingerprint({
          signature: 'Test signature',
          sampleMessage: 'Test sample message',
        }),
        count: 5,
        affectedWorkers: ['w-alice', 'w-bob'],
      });

      errorGroupPanel.updateGroups([group]);
      vi.clearAllMocks(); // Clear mocks before toggling to get only the expanded content
      errorGroupPanel.toggleExpanded();

      const content = mockDetailBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('Error Group: eg-test');
      expect(content).toContain('Test signature');
      expect(content).toContain('Test sample message');
      expect(content).toContain('5 occurrences');
      expect(content).toContain('w-alice, w-bob');
    });

    it('should show recent events in details', () => {
      const events = [
        createMockEvent({ ts: Date.now() - 1000, worker: 'w-alice' }),
        createMockEvent({ ts: Date.now() - 2000, worker: 'w-bob' }),
      ];

      const group = createMockGroup({ events });

      errorGroupPanel.updateGroups([group]);
      vi.clearAllMocks(); // Clear mocks before toggling
      errorGroupPanel.toggleExpanded();

      const content = mockDetailBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('Recent Events');
      expect(content).toContain('w-alice');
      expect(content).toContain('w-bob');
    });

    it('should show stack trace if available', () => {
      const eventWithStack = createMockEvent({
        error: 'Error: Connection failed\n  at connect (/app/db.js:42:10)\n  at main (/app/index.js:10:5)',
      });

      const group = createMockGroup({ events: [eventWithStack] });

      errorGroupPanel.updateGroups([group]);
      vi.clearAllMocks(); // Clear mocks before toggling
      errorGroupPanel.toggleExpanded();

      const content = mockDetailBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('Stack Trace');
      expect(content).toContain('at connect');
      expect(content).toContain('at main');
    });

    it('should truncate long stack traces', () => {
      const longStack = Array.from({ length: 20 }, (_, i) => `  at function${i} (/app/file.js:${i}:0)`).join('\n');
      const eventWithLongStack = createMockEvent({
        error: `Error: Test\n${longStack}`,
      });

      const group = createMockGroup({ events: [eventWithLongStack] });

      errorGroupPanel.updateGroups([group]);
      vi.clearAllMocks(); // Clear mocks before toggling
      errorGroupPanel.toggleExpanded();

      const content = mockDetailBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('more lines');
    });
  });

  describe('key bindings', () => {
    it('should bind up and k keys to selectPrevious', () => {
      expect(mockListInstance.key).toHaveBeenCalledWith(['up', 'k'], expect.any(Function));
    });

    it('should bind down and j keys to selectNext', () => {
      expect(mockListInstance.key).toHaveBeenCalledWith(['down', 'j'], expect.any(Function));
    });

    it('should bind enter and space to toggleExpanded', () => {
      expect(mockListInstance.key).toHaveBeenCalledWith(['enter', 'space'], expect.any(Function));
    });

    it('should bind escape key to hide', () => {
      expect(mockListInstance.key).toHaveBeenCalledWith(['escape'], expect.any(Function));
    });
  });

  describe('edge cases', () => {
    it('should handle groups with very long signatures', () => {
      const groups = [
        createMockGroup({
          fingerprint: createMockFingerprint({
            signature: 'This is a very long error signature that should be truncated appropriately',
          }),
        }),
      ];

      errorGroupPanel.updateGroups(groups);

      const content = mockListInstance.setContent.mock.calls[0][0];
      // Signature should be truncated (40 chars)
      expect(content).toContain('This is a very long error signature that');
    });

    it('should handle empty worker list', () => {
      const groups = [
        createMockGroup({
          affectedWorkers: [],
        }),
      ];

      // Should not throw
      expect(() => errorGroupPanel.updateGroups(groups)).not.toThrow();
    });

    it('should handle mixed severity levels in one update', () => {
      const groups = [
        createMockGroup({ severity: 'critical' }),
        createMockGroup({ severity: 'high' }),
        createMockGroup({ severity: 'medium' }),
        createMockGroup({ severity: 'low' }),
      ];

      // Should not throw
      expect(() => errorGroupPanel.updateGroups(groups)).not.toThrow();

      const content = mockListInstance.setContent.mock.calls[0][0];
      expect(content).toContain('CRITICAL (1)');
      expect(content).toContain('HIGH (1)');
      expect(content).toContain('MEDIUM (1)');
      expect(content).toContain('LOW (1)');
    });

    it('should handle rapid group updates', () => {
      const groups1 = [createMockGroup({ id: 'eg-1' })];
      const groups2 = [createMockGroup({ id: 'eg-2' })];
      const groups3 = [createMockGroup({ id: 'eg-3' })];

      // Should not throw
      expect(() => {
        errorGroupPanel.updateGroups(groups1);
        errorGroupPanel.updateGroups(groups2);
        errorGroupPanel.updateGroups(groups3);
      }).not.toThrow();

      expect(errorGroupPanel.getSelected()?.id).toBe('eg-3');
    });

    it('should handle zero-count groups gracefully', () => {
      const groups = [
        createMockGroup({ count: 0, events: [] }),
      ];

      // Should not throw
      expect(() => errorGroupPanel.updateGroups(groups)).not.toThrow();
    });
  });

  describe('relative time formatting', () => {
    it('should format recent errors correctly', () => {
      const now = Date.now();
      const groups = [
        createMockGroup({
          lastSeen: now - 5000, // 5 seconds ago
        }),
      ];

      errorGroupPanel.updateGroups(groups);

      const content = mockListInstance.setContent.mock.calls[0][0];
      expect(content).toContain('5s ago');
    });

    it('should format errors from minutes ago', () => {
      const now = Date.now();
      const groups = [
        createMockGroup({
          lastSeen: now - 120000, // 2 minutes ago
        }),
      ];

      errorGroupPanel.updateGroups(groups);

      const content = mockListInstance.setContent.mock.calls[0][0];
      expect(content).toContain('2m ago');
    });
  });
});
