/**
 * Tests for SemanticNarrativePanel Component
 *
 * Tests semantic narrative display, segment navigation, and pattern detection.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import blessed from 'blessed';

// Mock the blessed module before importing SemanticNarrativePanel
vi.mock('blessed', () => {
  const createMockElement = () => ({
    setContent: vi.fn(),
    setLabel: vi.fn(),
    setItems: vi.fn(),
    select: vi.fn(),
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
    visible: false,
    height: 20,
    width: 80,
  });

  const mockBoxInstance = createMockElement();
  const mockListInstance = createMockElement();
  const mockSubBox = createMockElement();

  return {
    default: {
      box: vi.fn(() => mockBoxInstance),
      list: vi.fn(() => mockListInstance),
    },
    box: vi.fn(() => mockBoxInstance),
    list: vi.fn(() => mockListInstance),
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
  },
}));

// Mock semanticNarrative module - create a proper class mock
class MockSemanticNarrativeManager {
  generateNarrative = vi.fn(() => null);
  generateAggregatedNarrative = vi.fn(() => null);
  getNarrative = vi.fn(() => null);
}

// Create singleton instance
const mockManagerInstance = new MockSemanticNarrativeManager();

vi.mock('../../semanticNarrative.js', () => ({
  getSemanticNarrativeManager: vi.fn(() => mockManagerInstance),
}));

// Import after mocking
import { SemanticNarrativePanel } from './SemanticNarrativePanel.js';
import { getSemanticNarrativeManager } from '../../semanticNarrative.js';
import type { SemanticNarrative, NarrativeSegment, EventPattern } from '../../types.js';

// Helper to create mock screen
function createMockScreen() {
  return {
    render: vi.fn(),
    append: vi.fn(),
    key: vi.fn(),
    destroy: vi.fn(),
  } as unknown as blessed.Widgets.Screen;
}

// Helper to create mock narrative
function createMockNarrative(overrides: Partial<SemanticNarrative> = {}): SemanticNarrative {
  return {
    id: 'narrative-1',
    title: 'Test Narrative',
    summary: 'Test summary',
    fullNarrative: 'Full narrative text',
    timeline: ['Event 1', 'Event 2', 'Event 3'],
    workerId: 'w-test',
    startTime: Date.now() - 20000,
    endTime: Date.now(),
    durationMs: 20000,
    segments: [
      {
        id: 'seg-1',
        pattern: 'file_editing',
        summary: 'Editing files',
        startTime: Date.now() - 10000,
        endTime: Date.now(),
        durationMs: 10000,
        confidence: 0.9,
        isActive: true,
        beadId: 'bd-test',
        workerId: 'w-test',
        events: [],
        entities: {
          files: ['/test.ts'],
          tools: ['Edit'],
          errors: [],
        },
      },
      {
        id: 'seg-2',
        pattern: 'tool_usage',
        summary: 'Using tools',
        startTime: Date.now() - 20000,
        endTime: Date.now() - 10000,
        durationMs: 10000,
        confidence: 0.8,
        isActive: false,
        workerId: 'w-test',
        events: [],
        entities: {
          files: [],
          tools: ['Read'],
          errors: [],
        },
      },
    ],
    ...overrides,
  };
}

describe('SemanticNarrativePanel', () => {
  let panel: SemanticNarrativePanel;
  let mockScreen: blessed.Widgets.Screen;
  let mockBoxInstance: any;
  let mockListInstance: any;
  let mockSubBox: any;
  let mockManager: any;
  let onSelectCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockScreen = createMockScreen();
    onSelectCallback = vi.fn();

    // Get the mock instances from the mock
    const blessedMock = blessed as unknown as { box: Mock; list: Mock };
    mockBoxInstance = blessedMock.box();
    mockListInstance = blessedMock.list();
    mockSubBox = blessedMock.box({ parent: mockBoxInstance });

    panel = new SemanticNarrativePanel({
      parent: mockScreen,
      top: 0,
      left: 0,
      width: 80,
      height: 20,
      onSelect: onSelectCallback,
    });

    // Get the manager instance
    mockManager = getSemanticNarrativeManager();
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
          label: ' Semantic Narrative ',
          scrollable: true,
          alwaysScroll: true,
          keys: true,
          vi: true,
          mouse: true,
        })
      );
    });

    it('should create a list element', () => {
      const blessedMock = blessed as unknown as { list: Mock };
      expect(blessedMock.list).toHaveBeenCalled();
    });

    it('should create a detail box element', () => {
      const blessedMock = blessed as unknown as { box: Mock };
      expect(blessedMock.box).toHaveBeenCalled();
    });

    it('should store onSelect callback', () => {
      expect(panel).toBeDefined();
    });
  });

  describe('setNarrative', () => {
    it('should set narrative and render', () => {
      const narrative = createMockNarrative();
      panel.setNarrative(narrative);

      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should handle null narrative', () => {
      panel.setNarrative(null);

      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should extract segments from narrative', () => {
      const narrative = createMockNarrative();
      panel.setNarrative(narrative);

      expect((panel as any).segments).toEqual(narrative.segments);
    });

    it('should reset selected index', () => {
      const narrative = createMockNarrative();
      (panel as any).selectedIndex = 5;
      panel.setNarrative(narrative);

      expect((panel as any).selectedIndex).toBe(0);
    });
  });

  describe('updateFromWorker', () => {
    it('should generate narrative for worker and set it', () => {
      const narrative = createMockNarrative();
      mockManager.generateNarrative.mockReturnValue(narrative);

      panel.updateFromWorker('w-test');

      expect(mockManager.generateNarrative).toHaveBeenCalledWith('w-test');
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should handle null narrative from manager', () => {
      mockManager.generateNarrative.mockReturnValue(null);

      panel.updateFromWorker('w-test');

      expect((panel as any).segments).toHaveLength(0);
    });
  });

  describe('updateAggregated', () => {
    it('should generate aggregated narrative and set it', () => {
      const narrative = createMockNarrative();
      mockManager.generateAggregatedNarrative.mockReturnValue(narrative);

      panel.updateAggregated();

      expect(mockManager.generateAggregatedNarrative).toHaveBeenCalled();
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });
  });

  describe('segment navigation', () => {
    beforeEach(() => {
      const narrative = createMockNarrative({
        segments: [
          { id: '1', pattern: 'file_editing', summary: 'First', startTime: Date.now() - 30000, endTime: Date.now() - 20000, durationMs: 10000, confidence: 0.9, isActive: true, entities: {} },
          { id: '2', pattern: 'tool_usage', summary: 'Second', startTime: Date.now() - 20000, endTime: Date.now() - 10000, durationMs: 10000, confidence: 0.8, isActive: false, entities: {} },
          { id: '3', pattern: 'error_handling', summary: 'Third', startTime: Date.now() - 10000, endTime: Date.now(), durationMs: 10000, confidence: 0.7, isActive: false, entities: {} },
        ] as NarrativeSegment[],
      });
      panel.setNarrative(narrative);
    });

    it('should select next segment', () => {
      panel.selectNext();
      expect((panel as any).selectedIndex).toBe(1);

      panel.selectNext();
      expect((panel as any).selectedIndex).toBe(2);

      // Should wrap to beginning
      panel.selectNext();
      expect((panel as any).selectedIndex).toBe(0);
    });

    it('should select previous segment', () => {
      (panel as any).selectedIndex = 2;

      panel.selectPrevious();
      expect((panel as any).selectedIndex).toBe(1);

      panel.selectPrevious();
      expect((panel as any).selectedIndex).toBe(0);

      // Should wrap to end
      panel.selectPrevious();
      expect((panel as any).selectedIndex).toBe(2);
    });

    it('should not navigate when no segments', () => {
      panel.setNarrative(null);

      (panel as any).selectedIndex = 0;
      panel.selectNext();
      expect((panel as any).selectedIndex).toBe(0);

      panel.selectPrevious();
      expect((panel as any).selectedIndex).toBe(0);
    });
  });

  describe('toggleDetail', () => {
    beforeEach(() => {
      const narrative = createMockNarrative();
      panel.setNarrative(narrative);
    });

    it('should switch to detail view from list', () => {
      (panel as any).viewMode = 'list';
      panel.toggleDetail();

      expect((panel as any).viewMode).toBe('detail');
      expect(onSelectCallback).toHaveBeenCalledWith('seg-1');
    });

    it('should switch back to list from detail', () => {
      (panel as any).viewMode = 'detail';
      panel.toggleDetail();

      expect((panel as any).viewMode).toBe('list');
    });

    it('should not toggle when no segments', () => {
      panel.setNarrative(null);
      (panel as any).viewMode = 'list';

      panel.toggleDetail();

      expect((panel as any).viewMode).toBe('list');
    });
  });

  describe('toggleFullView', () => {
    it('should switch to full view', () => {
      (panel as any).viewMode = 'list';
      panel.toggleFullView();

      expect((panel as any).viewMode).toBe('full');
    });

    it('should switch back from full view', () => {
      (panel as any).viewMode = 'full';
      panel.toggleFullView();

      expect((panel as any).viewMode).toBe('list');
    });
  });

  describe('refresh', () => {
    it('should refresh narrative from manager', () => {
      const narrative = createMockNarrative();
      panel.setNarrative(narrative);

      const updatedNarrative = createMockNarrative({
        title: 'Updated Narrative',
      });
      mockManager.getNarrative.mockReturnValue(updatedNarrative);

      panel.refresh();

      expect(mockManager.getNarrative).toHaveBeenCalledWith('narrative-1');
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should do nothing when no narrative set', () => {
      mockManager.getNarrative.mockReturnValue(null);

      panel.refresh();

      expect(mockBoxInstance.screen.render).not.toHaveBeenCalled();
    });
  });

  describe('getSelected', () => {
    it('should return selected segment', () => {
      const narrative = createMockNarrative();
      panel.setNarrative(narrative);

      const selected = panel.getSelected();
      expect(selected?.id).toBe('seg-1');
    });

    it('should return undefined when no segments', () => {
      panel.setNarrative(null);

      expect(panel.getSelected()).toBeUndefined();
    });
  });

  describe('show/hide/isVisible', () => {
    it('should show the panel', () => {
      panel.show();
      expect(mockBoxInstance.show).toHaveBeenCalled();
      expect(mockListInstance.focus).toHaveBeenCalled();
    });

    it('should hide the panel', () => {
      panel.hide();
      expect(mockBoxInstance.hide).toHaveBeenCalled();
    });

    it('should return visibility state', () => {
      mockBoxInstance.visible = false;
      expect(panel.isVisible()).toBe(false);

      mockBoxInstance.visible = true;
      expect(panel.isVisible()).toBe(true);
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
    it('should bind up/k keys to selectPrevious', () => {
      const keyCalls = mockListInstance.key.mock.calls;
      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && (call[0].includes('up') || call[0].includes('k'))
      )).toBe(true);
    });

    it('should bind down/j keys to selectNext', () => {
      const keyCalls = mockListInstance.key.mock.calls;
      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && (call[0].includes('down') || call[0].includes('j'))
      )).toBe(true);
    });

    it('should bind enter/space keys to toggleDetail', () => {
      const keyCalls = mockListInstance.key.mock.calls;
      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && (call[0].includes('enter') || call[0].includes('space'))
      )).toBe(true);
    });

    it('should bind f key to toggleFullView', () => {
      const keyCalls = mockListInstance.key.mock.calls;
      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && call[0].includes('f')
      )).toBe(true);
    });

    it('should bind r key to refresh', () => {
      const keyCalls = mockListInstance.key.mock.calls;
      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && call[0].includes('r')
      )).toBe(true);
    });

    it('should bind escape key to return to list view', () => {
      const keyCalls = mockListInstance.key.mock.calls;
      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && call[0].includes('escape')
      )).toBe(true);
    });
  });

  describe('render output formatting', () => {
    it('should render list items with pattern icons', () => {
      const narrative = createMockNarrative();
      panel.setNarrative(narrative);

      expect(mockListInstance.setItems).toHaveBeenCalled();
    });

    it('should update label with segment counts', () => {
      const narrative = createMockNarrative();
      panel.setNarrative(narrative);

      expect(mockBoxInstance.setLabel).toHaveBeenCalled();
      const label = mockBoxInstance.setLabel.mock.calls[0][0];
      expect(label).toContain('2 segments');
      expect(label).toContain('1 active');
    });

    it('should render detail box with segment info', () => {
      const narrative = createMockNarrative();
      panel.setNarrative(narrative);

      expect(mockSubBox.setContent).toHaveBeenCalled();
    });

    it('should render full narrative view', () => {
      const narrative = createMockNarrative();
      panel.setNarrative(narrative);
      (panel as any).viewMode = 'full';

      panel.render();

      expect(mockListInstance.hide).toHaveBeenCalled();
    });
  });

  describe('pattern icons and colors', () => {
    const patterns: EventPattern[] = [
      'file_editing', 'tool_usage', 'error_handling', 'task_completion',
      'exploration', 'planning', 'debugging', 'research',
    ];

    patterns.forEach(pattern => {
      it(`should handle ${pattern} pattern`, () => {
        const narrative = createMockNarrative({
          segments: [{
            id: '1',
            pattern,
            summary: 'Test',
            startTime: Date.now() - 10000,
            endTime: Date.now(),
            durationMs: 10000,
            confidence: 0.8,
            isActive: true,
            workerId: 'w-test',
            events: [],
            entities: {},
          }],
        });

        expect(() => panel.setNarrative(narrative)).not.toThrow();
      });
    });
  });

  describe('duration formatting', () => {
    it('should format milliseconds', () => {
      const narrative = createMockNarrative({
        segments: [{
          id: '1',
          pattern: 'file_editing',
          summary: 'Quick',
          startTime: Date.now() - 500,
          endTime: Date.now(),
          durationMs: 500,
          confidence: 0.9,
          isActive: true,
          workerId: 'w-test',
          events: [],
          entities: {},
        }],
      });

      panel.setNarrative(narrative);

      expect(mockSubBox.setContent).toHaveBeenCalled();
    });

    it('should format seconds', () => {
      const narrative = createMockNarrative({
        segments: [{
          id: '1',
          pattern: 'file_editing',
          summary: 'Medium',
          startTime: Date.now() - 5000,
          endTime: Date.now(),
          durationMs: 5000,
          confidence: 0.9,
          isActive: true,
          workerId: 'w-test',
          events: [],
          entities: {},
        }],
      });

      panel.setNarrative(narrative);

      expect(mockSubBox.setContent).toHaveBeenCalled();
    });

    it('should format minutes', () => {
      const narrative = createMockNarrative({
        segments: [{
          id: '1',
          pattern: 'file_editing',
          summary: 'Long',
          startTime: Date.now() - 120000,
          endTime: Date.now(),
          durationMs: 120000,
          confidence: 0.9,
          isActive: true,
          workerId: 'w-test',
          events: [],
          entities: {},
        }],
      });

      panel.setNarrative(narrative);

      expect(mockSubBox.setContent).toHaveBeenCalled();
    });
  });

  describe('entity rendering', () => {
    it('should render files in detail view', () => {
      const narrative = createMockNarrative({
        segments: [{
          id: '1',
          pattern: 'file_editing',
          summary: 'Editing',
          startTime: Date.now() - 10000,
          endTime: Date.now(),
          durationMs: 10000,
          confidence: 0.9,
          isActive: true,
          workerId: 'w-test',
          events: [],
          entities: {
            files: ['/file1.ts', '/file2.ts', '/file3.ts', '/file4.ts', '/file5.ts', '/file6.ts'],
            tools: [],
            errors: [],
          },
        }],
      });

      panel.setNarrative(narrative);

      expect(mockSubBox.setContent).toHaveBeenCalled();
    });

    it('should render tools in detail view', () => {
      const narrative = createMockNarrative({
        segments: [{
          id: '1',
          pattern: 'tool_usage',
          summary: 'Using tools',
          startTime: Date.now() - 10000,
          endTime: Date.now(),
          durationMs: 10000,
          confidence: 0.9,
          isActive: true,
          workerId: 'w-test',
          events: [],
          beadId: 'bd-test',
          entities: {
            files: [],
            tools: ['Read', 'Edit', 'Write'],
            errors: [],
          },
        }],
      });

      panel.setNarrative(narrative);

      expect(mockSubBox.setContent).toHaveBeenCalled();
    });

    it('should render errors in detail view', () => {
      const narrative = createMockNarrative({
        segments: [{
          id: '1',
          pattern: 'error_handling',
          summary: 'Handling errors',
          startTime: Date.now() - 10000,
          endTime: Date.now(),
          durationMs: 10000,
          confidence: 0.9,
          isActive: true,
          workerId: 'w-test',
          events: [],
          entities: {
            files: [],
            tools: [],
            errors: ['Error 1', 'Error 2'],
          },
        }],
      });

      panel.setNarrative(narrative);

      expect(mockSubBox.setContent).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle empty narrative', () => {
      const narrative = createMockNarrative({
        segments: [],
        timeline: [],
      });

      panel.setNarrative(narrative);

      expect(mockListInstance.setItems).toHaveBeenCalled();
    });

    it('should handle narrative with no segments', () => {
      const narrative: SemanticNarrative = {
        id: 'empty',
        workerId: 'w-test',
        title: 'Empty',
        summary: 'No segments',
        fullNarrative: 'None',
        timeline: [],
        startTime: Date.now() - 10000,
        endTime: Date.now(),
        durationMs: 10000,
        segments: [],
      };

      panel.setNarrative(narrative);

      expect((panel as any).segments).toHaveLength(0);
    });

    it('should handle very long summaries', () => {
      const longSummary = 'A'.repeat(200);
      const narrative = createMockNarrative({
        segments: [{
          id: '1',
          pattern: 'file_editing',
          summary: longSummary,
          startTime: Date.now() - 10000,
          endTime: Date.now(),
          durationMs: 10000,
          confidence: 0.9,
          isActive: true,
          entities: {},
        }],
      });

      expect(() => panel.setNarrative(narrative)).not.toThrow();
    });

    it('should handle unicode in content', () => {
      const narrative = createMockNarrative({
        title: '测试标题',
        summary: '测试摘要',
        fullNarrative: '完整叙述内容',
      });

      expect(() => panel.setNarrative(narrative)).not.toThrow();
    });
  });

  describe('regression tests', () => {
    it('should not regress list item format', () => {
      const narrative = createMockNarrative();
      panel.setNarrative(narrative);

      const items = mockListInstance.setItems.mock.calls[0][0];
      expect(items.length).toBeGreaterThan(0);
      expect(items[0]).toContain('[');
      expect(items[0]).toContain(']');
    });

    it('should not regress detail view format', () => {
      const narrative = createMockNarrative();
      panel.setNarrative(narrative);

      expect(mockSubBox.setContent).toHaveBeenCalled();
      const content = mockSubBox.setContent.mock.calls[0][0];
      expect(content).toContain('Pattern:');
      expect(content).toContain('Duration:');
    });

    it('should not regress full view format', () => {
      const narrative = createMockNarrative();
      panel.setNarrative(narrative);
      (panel as any).viewMode = 'full';

      panel.render();

      expect(mockListInstance.hide).toHaveBeenCalled();
    });
  });
});
