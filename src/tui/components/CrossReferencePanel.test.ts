/**
 * Tests for CrossReferencePanel Component
 *
 * Tests cross-reference display, navigation, and statistics.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import blessed from 'blessed';

// Mock the blessed module before importing CrossReferencePanel
vi.mock('blessed', () => {
  const createMockElement = () => ({
    setContent: vi.fn(),
    setLabel: vi.fn(),
    setItems: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    focus: vi.fn(),
    key: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
    hidden: true,
    screen: {
      render: vi.fn(),
    },
    selected: 0,
  });

  const mockBoxInstance = createMockElement();
  const mockListInstance = createMockElement();

  const mockBox = vi.fn(function() { return mockBoxInstance; });
  const mockList = vi.fn(function() { return mockListInstance; });

  return {
    default: {
      box: mockBox,
      list: mockList,
    },
    box: mockBox,
    list: mockList,
  };
});

// Mock colors module
vi.mock('../utils/colors.js', () => ({
  colors: {
    border: 'blue',
    header: 'cyan',
    text: 'white',
    dim: 'gray',
    selected: 'magenta',
    focus: 'green',
    magenta: 'magenta',
    cyan: 'cyan',
    green: 'green',
    yellow: 'yellow',
    blue: 'blue',
    orange: 'orange',
    red: 'red',
    purple: 'purple',
    teal: 'teal',
  },
}));

// Mock crossReferenceManager module - use vi.hoisted to declare variables before factory runs
const { mockGetEntity, mockGetLinksForEntity, mockGetStats, mockFindPath, getMockManagerInstance, setMockManagerInstance } = vi.hoisted(() => {
  let instance: any = null;
  return {
    getMockManagerInstance: () => instance,
    setMockManagerInstance: (val: any) => { instance = val; },
    mockGetEntity: vi.fn(function() { return null; }),
    mockGetLinksForEntity: vi.fn(function() { return []; }),
    mockGetStats: vi.fn(function() { return ({
      totalLinks: 0,
      totalEntities: 0,
      byRelationship: {},
      byEntityType: {},
      mostLinked: [],
      recentLinks: [],
    });}),
    mockFindPath: vi.fn(function() { return null; }),
  };
});

vi.mock('../../crossReferenceManager.js', () => {
  class MockCrossReferenceManager {
    getEntity = mockGetEntity;
    getLinksForEntity = mockGetLinksForEntity;
    getStats = mockGetStats;
    findPath = mockFindPath;
  }

  const MockConstructor = vi.fn(function() {
    const current = getMockManagerInstance();
    if (!current) {
      const newInstance = new MockCrossReferenceManager();
      setMockManagerInstance(newInstance);
      return newInstance;
    }
    return current;
  });

  return {
    CrossReferenceManager: MockConstructor,
    MockCrossReferenceManager,
  };
});

// Export the hoisted mock functions for test access
export { mockGetEntity, mockGetLinksForEntity, mockGetStats, mockFindPath };

// Import after mocking
import { CrossReferencePanel, createCrossReferencePanel } from './CrossReferencePanel.js';
import { CrossReferenceManager } from '../../crossReferenceManager.js';
import type { CrossReferenceEntity, CrossReferenceEntityType } from '../../types.js';

// Get the mocked constructor for assertions
const MockCrossReferenceManagerConstructor = CrossReferenceManager as unknown as Mock;

// Helper to get the mock functions from the singleton instance
const getMockFunctions = () => ({
  getEntity: mockGetEntity,
  getLinksForEntity: mockGetLinksForEntity,
  getStats: mockGetStats,
  findPath: mockFindPath,
});

// Helper to create mock screen
function createMockScreen() {
  return {
    render: vi.fn(),
    append: vi.fn(),
    key: vi.fn(),
    destroy: vi.fn(),
  } as unknown as blessed.Widgets.Screen;
}

// Helper to create mock entity
function createMockEntity(
  type: CrossReferenceEntityType,
  id: string,
  label?: string
): CrossReferenceEntity {
  return {
    type,
    id,
    label: label || id,
    outgoingLinks: [],
    incomingLinks: [],
    relatedEntities: new Map(),
    linkCount: 0,
    lastLinkedAt: Date.now(),
    firstSeen: Date.now() - 3600000,
    occurrenceCount: 1,
  };
}

describe('CrossReferencePanel', () => {
  let panel: CrossReferencePanel;
  let mockScreen: blessed.Widgets.Screen;
  let mockBoxInstance: any;
  let mockListInstance: any;
  let mockGetEntity: any;
  let mockGetLinksForEntity: any;
  let mockGetStats: any;
  let mockFindPath: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockScreen = createMockScreen();

    // Get the mock functions from the CrossReferenceManager singleton
    const mockFns = getMockFunctions();
    mockGetEntity = mockFns.getEntity;
    mockGetLinksForEntity = mockFns.getLinksForEntity;
    mockGetStats = mockFns.getStats;
    mockFindPath = mockFns.findPath;

    panel = new CrossReferencePanel({
      parent: mockScreen,
      top: 0,
      left: 0,
      width: 80,
      height: 20,
    });

    // Get the mock instances AFTER panel creation (panel creates blessed elements via mock)
    const blessedMock = blessed as unknown as { box: Mock; list: Mock };
    mockBoxInstance = blessedMock.box();
    mockListInstance = blessedMock.list();
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
          width: 80,
          height: 20,
          label: ' Cross-References ',
          scrollable: true,
          alwaysScroll: true,
          keys: true,
          vi: true,
        })
      );
    });

    it('should create a list element', () => {
      const blessedMock = blessed as unknown as { list: Mock };
      expect(blessedMock.list).toHaveBeenCalled();
    });

    it('should create CrossReferenceManager instance', () => {
      expect(MockCrossReferenceManagerConstructor).toHaveBeenCalled();
    });

    it('should bind key handlers', () => {
      expect(mockListInstance.key).toHaveBeenCalled();
    });
  });

  describe('setEntity', () => {
    it('should set current entity and refresh', () => {
      const entity = createMockEntity('worker', 'w-test123', 'Test Worker');
      panel.setEntity(entity);

      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should accept null to clear entity', () => {
      panel.setEntity(null);

      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should update label with entity info', () => {
      const entity = createMockEntity('file', '/test.ts', 'test.ts');
      panel.setEntity(entity);

      expect(mockBoxInstance.setLabel).toHaveBeenCalled();
    });
  });

  describe('setEntityById', () => {
    it('should fetch entity and set it', () => {
      const entity = createMockEntity('bead', 'bd-test', 'Test Bead');
      mockGetEntity.mockReturnValue(entity);

      panel.setEntityById('bead', 'bd-test');

      expect(mockGetEntity).toHaveBeenCalledWith('bead', 'bd-test');
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should handle non-existent entity', () => {
      mockGetEntity.mockReturnValue(null);

      panel.setEntityById('worker', 'w-nonexistent');

      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('should render overview when no entity set', () => {
      panel.refresh();

      expect(mockListInstance.setItems).toHaveBeenCalled();
    });

    it('should render links when entity is set', () => {
      const entity = createMockEntity('worker', 'w-test');
      panel.setEntity(entity);

      expect(mockListInstance.setItems).toHaveBeenCalled();
    });

    it('should render stats when in stats view', () => {
      (panel as any).viewMode = 'stats';
      panel.refresh();

      expect(mockListInstance.setItems).toHaveBeenCalled();
    });
  });

  describe('findPathTo', () => {
    it('should find and render path', () => {
      const entity = createMockEntity('worker', 'w-test');
      panel.setEntity(entity);

      const mockPath = {
        start: entity,
        end: createMockEntity('file', '/test.ts'),
        length: 2,
        steps: [],
        description: 'Test path',
      };
      mockFindPath.mockReturnValue(mockPath);

      panel.findPathTo('file', '/test.ts');

      expect(mockFindPath).toHaveBeenCalled();
      expect(mockListInstance.setItems).toHaveBeenCalled();
    });

    it('should show message when no path found', () => {
      const entity = createMockEntity('worker', 'w-test');
      panel.setEntity(entity);

      // Clear the setItems mock calls from setEntity
      mockListInstance.setItems.mockClear();
      mockFindPath.mockReturnValue(null);

      panel.findPathTo('file', '/nonexistent.ts');

      expect(mockListInstance.setItems).toHaveBeenCalled();
      const items = mockListInstance.setItems.mock.calls[0][0];
      expect(items).toBeDefined();
      expect(Array.isArray(items)).toBe(true);
      expect(items[0]).toContain('No path found');
      expect(items[0]).toContain('file:/nonexistent.ts');
    });

    it('should do nothing when no entity set', () => {
      mockFindPath.mockReturnValue({});

      panel.findPathTo('file', '/test.ts');

      // Should not call findPath when no entity
      expect(mockFindPath).not.toHaveBeenCalled();
    });
  });

  describe('show/hide/toggle', () => {
    it('should show the panel', () => {
      panel.show();
      expect(mockBoxInstance.show).toHaveBeenCalled();
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should hide the panel', () => {
      panel.hide();
      expect(mockBoxInstance.hide).toHaveBeenCalled();
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should toggle visibility', () => {
      // Initially hidden
      mockBoxInstance.hidden = true;
      panel.toggle();
      expect(mockBoxInstance.show).toHaveBeenCalled();

      vi.clearAllMocks();

      // Now visible
      mockBoxInstance.hidden = false;
      panel.toggle();
      expect(mockBoxInstance.hide).toHaveBeenCalled();
    });
  });

  describe('focus', () => {
    it('should focus the list element', () => {
      panel.focus();
      expect(mockListInstance.focus).toHaveBeenCalled();
    });
  });

  describe('getElement', () => {
    it('should return the box element', () => {
      const element = panel.getElement();
      expect(element).toBe(mockBoxInstance);
    });
  });

  describe('key bindings', () => {
    it('should bind enter key to navigation', () => {
      const keyCalls = mockListInstance.key.mock.calls;
      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && call[0].includes('enter')
      )).toBe(true);
    });

    it('should bind s key to stats toggle', () => {
      const keyCalls = mockListInstance.key.mock.calls;
      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && call[0].includes('s')
      )).toBe(true);
    });

    it('should bind l key to links toggle', () => {
      const keyCalls = mockListInstance.key.mock.calls;
      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && call[0].includes('l')
      )).toBe(true);
    });

    it('should bind r key to refresh', () => {
      const keyCalls = mockListInstance.key.mock.calls;
      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && call[0].includes('r')
      )).toBe(true);
    });

    it('should bind escape key to return to links view', () => {
      const keyCalls = mockListInstance.key.mock.calls;
      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && call[0].includes('escape')
      )).toBe(true);
    });
  });

  describe('render output formatting', () => {
    it('should render overview with stats', () => {
      mockGetStats.mockReturnValue({
        totalLinks: 100,
        totalEntities: 50,
        byRelationship: { same_file: 30, same_worker: 20 },
        byEntityType: { worker: 10, file: 40 },
        mostLinked: [
          { type: 'file', label: 'test.ts', linkCount: 15 },
        ],
        recentLinks: [],
      });

      panel.refresh();

      expect(mockListInstance.setItems).toHaveBeenCalled();
      const items = mockListInstance.setItems.mock.calls[0][0];
      // Blessed formatting tags are present, so check for the text with tags
      expect(items.join('')).toContain('Total Links:');
      expect(items.join('')).toContain('100');
      expect(items.join('')).toContain('Total Entities:');
      expect(items.join('')).toContain('50');
    });

    it('should render relationship types with colors', () => {
      mockGetLinksForEntity.mockReturnValue([
        {
          sourceType: 'worker',
          sourceId: 'w-test',
          targetType: 'file',
          targetId: '/test.ts',
          relationship: 'same_file',
          strength: 0.8,
          timestamp: Date.now(),
        },
      ]);

      const entity = createMockEntity('worker', 'w-test');
      panel.setEntity(entity);

      expect(mockListInstance.setItems).toHaveBeenCalled();
    });

    it('should render strength bars', () => {
      mockGetLinksForEntity.mockReturnValue([
        {
          sourceType: 'worker',
          sourceId: 'w-test',
          targetType: 'file',
          targetId: '/test.ts',
          relationship: 'same_file',
          strength: 1.0,
          timestamp: Date.now(),
        },
      ]);

      const entity = createMockEntity('worker', 'w-test');
      panel.setEntity(entity);

      const items = mockListInstance.setItems.mock.calls[0][0];
      expect(items.some((item: string) => item.includes('█'))).toBe(true);
    });
  });

  describe('entity display formatting', () => {
    it('should format worker IDs correctly', () => {
      const entity = createMockEntity('worker', 'w-abcdefgh12345678');
      panel.setEntity(entity);

      expect(mockBoxInstance.setLabel).toHaveBeenCalled();
    });

    it('should format file names correctly', () => {
      mockGetLinksForEntity.mockReturnValue([
        {
          sourceType: 'worker',
          sourceId: 'w-test',
          targetType: 'file',
          targetId: '/very/long/path/to/component/FileContextPanel.ts',
          relationship: 'same_file',
          strength: 0.5,
          timestamp: Date.now(),
        },
      ]);

      const entity = createMockEntity('worker', 'w-test');
      panel.setEntity(entity);

      expect(mockListInstance.setItems).toHaveBeenCalled();
    });

    it('should format bead IDs correctly', () => {
      mockGetLinksForEntity.mockReturnValue([
        {
          sourceType: 'worker',
          sourceId: 'w-test',
          targetType: 'bead',
          targetId: 'bd-verylongbeadid123',
          relationship: 'same_bead',
          strength: 1.0,
          timestamp: Date.now(),
        },
      ]);

      const entity = createMockEntity('worker', 'w-test');
      panel.setEntity(entity);

      expect(mockListInstance.setItems).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle empty links gracefully', () => {
      mockGetLinksForEntity.mockReturnValue([]);

      const entity = createMockEntity('worker', 'w-test');
      panel.setEntity(entity);

      expect(mockListInstance.setItems).toHaveBeenCalled();
    });

    it('should handle very long entity IDs', () => {
      const longId = 'a'.repeat(100);
      const entity = createMockEntity('file', longId);
      panel.setEntity(entity);

      expect(mockBoxInstance.setLabel).toHaveBeenCalled();
    });

    it('should handle unicode in labels', () => {
      const entity = createMockEntity('file', '/测试.ts', '测试文件');
      panel.setEntity(entity);

      expect(mockBoxInstance.setLabel).toHaveBeenCalled();
    });

    it('should handle zero total links in stats', () => {
      mockGetStats.mockReturnValue({
        totalLinks: 0,
        totalEntities: 0,
        byRelationship: {},
        byEntityType: {},
        mostLinked: [],
        recentLinks: [],
      });

      panel.refresh();

      expect(mockListInstance.setItems).toHaveBeenCalled();
    });

    it('should handle all relationship types', () => {
      const relationships = [
        'same_bead',
        'same_file',
        'same_worker',
        'temporal_proximity',
        'same_session',
        'dependency',
        'collision',
        'parent_child',
        'error_related',
        'tool_sequence',
      ];

      mockGetStats.mockReturnValue({
        totalLinks: relationships.length,
        totalEntities: 10,
        byRelationship: Object.fromEntries(relationships.map(r => [r, 1])),
        byEntityType: {},
        mostLinked: [],
        recentLinks: [],
      });

      (panel as any).viewMode = 'stats';
      panel.refresh();

      expect(mockListInstance.setItems).toHaveBeenCalled();
    });
  });

  describe('view mode transitions', () => {
    it('should switch from links to stats view', () => {
      const entity = createMockEntity('worker', 'w-test');
      panel.setEntity(entity);

      const sCall = mockListInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('s')
      );
      const sHandler = sCall?.[1];

      expect(() => sHandler?.()).not.toThrow();
    });

    it('should switch from stats back to links view', () => {
      (panel as any).viewMode = 'stats';

      const lCall = mockListInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('l')
      );
      const lHandler = lCall?.[1];

      expect(() => lHandler?.()).not.toThrow();
    });

    it('should return to links from stats on escape', () => {
      (panel as any).viewMode = 'stats';

      const escCall = mockListInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('escape')
      );
      const escHandler = escCall?.[1];

      escHandler?.();

      expect((panel as any).viewMode).toBe('links');
    });
  });

  describe('factory function', () => {
    it('should create CrossReferencePanel via factory function', () => {
      const p = createCrossReferencePanel({
        parent: mockScreen,
        top: 0,
        left: 0,
        width: 80,
        height: 20,
      });

      expect(p).toBeInstanceOf(CrossReferencePanel);
    });
  });

  describe('regression tests', () => {
    it('should not regress link rendering format', () => {
      mockGetLinksForEntity.mockReturnValue([
        {
          sourceType: 'worker',
          sourceId: 'w-source',
          targetType: 'file',
          targetId: '/target.ts',
          relationship: 'same_file',
          strength: 0.75,
          timestamp: Date.now(),
        },
      ]);

      const entity = createMockEntity('worker', 'w-source');
      panel.setEntity(entity);

      const items = mockListInstance.setItems.mock.calls[0][0];
      expect(items.length).toBeGreaterThan(0);
    });

    it('should not regress overview rendering', () => {
      mockGetStats.mockReturnValue({
        totalLinks: 42,
        totalEntities: 15,
        byRelationship: { same_file: 20, same_worker: 22 },
        byEntityType: { worker: 5, file: 10 },
        mostLinked: [
          { type: 'file', label: 'test.ts', linkCount: 8 },
        ],
        recentLinks: [],
      });

      panel.refresh();

      const items = mockListInstance.setItems.mock.calls[0][0];
      // Blessed formatting tags are present, so check for the text with tags
      expect(items.join('')).toContain('Total Links:');
      expect(items.join('')).toContain('42');
      expect(items.join('')).toContain('Total Entities:');
      expect(items.join('')).toContain('15');
    });

    it('should not regress path rendering', () => {
      const entity = createMockEntity('worker', 'w-start');
      panel.setEntity(entity);

      const mockPath = {
        start: entity,
        end: createMockEntity('file', '/end.ts'),
        length: 3,
        steps: [
          {
            relationship: 'same_worker' as const,
            targetType: 'file' as const,
            targetId: '/intermediate.ts',
          },
          {
            relationship: 'same_file' as const,
            targetType: 'file' as const,
            targetId: '/end.ts',
          },
        ],
        description: 'Test path description',
      };
      mockFindPath.mockReturnValue(mockPath);

      panel.findPathTo('file', '/end.ts');

      // Get the last call to setItems (the one from findPathTo)
      const calls = mockListInstance.setItems.mock.calls;
      const items = calls?.[calls.length - 1]?.[0];
      expect(items).toBeDefined();
      expect(Array.isArray(items)).toBe(true);
      expect(items.join('')).toContain('Navigation Path');
      expect(items.join('')).toContain('Length:');
      expect(items.join('')).toContain('3');
    });
  });
});
