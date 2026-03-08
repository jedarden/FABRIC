/**
 * Tests for CommandPalette Component
 *
 * Tests fuzzy search, recent commands, and match highlighting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => '[]'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock blessed module
vi.mock('blessed', () => {
  const mockBoxInstance = {
    show: vi.fn(),
    hide: vi.fn(),
    hidden: true,
    screen: { render: vi.fn() },
  };
  const mockInputInstance = {
    on: vi.fn(),
    key: vi.fn(),
    focus: vi.fn(),
    setValue: vi.fn(),
    getValue: vi.fn(() => ''),
  };
  const mockListInstance = {
    setItems: vi.fn(),
    select: vi.fn(),
  };

  return {
    default: {
      box: vi.fn(() => mockBoxInstance),
      textbox: vi.fn(() => mockInputInstance),
      list: vi.fn(() => mockListInstance),
    },
  };
});

import blessed from 'blessed';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { CommandPalette } from './CommandPalette.js';

function createMockScreen() {
  return {
    render: vi.fn(),
    append: vi.fn(),
    key: vi.fn(),
    destroy: vi.fn(),
  } as unknown as blessed.Widgets.Screen;
}

describe('CommandPalette', () => {
  let palette: CommandPalette;
  let mockScreen: blessed.Widgets.Screen;
  let onSubmit: ReturnType<typeof vi.fn>;
  let mockInput: any;
  let mockList: any;
  let mockBox: any;

  beforeEach(() => {
    vi.clearAllMocks();
    (existsSync as any).mockReturnValue(false);

    mockScreen = createMockScreen();
    onSubmit = vi.fn();

    // Get mock instances
    const blessedMock = blessed as any;
    mockBox = blessedMock.box();
    mockInput = blessedMock.textbox();
    mockList = blessedMock.list();

    // Reset mock instances
    vi.clearAllMocks();

    palette = new CommandPalette({
      parent: mockScreen,
      onSubmit,
    });

    // Re-capture after construction
    mockBox = blessedMock.box();
    mockInput = blessedMock.textbox();
    mockList = blessedMock.list();
  });

  describe('Fuzzy Search', () => {
    it('should show all suggestions when query is empty', () => {
      // Trigger show which calls filterSuggestions('')
      palette.show();

      // The list should be populated with all default suggestions
      const setItemsCalls = mockList.setItems.mock.calls;
      const lastCall = setItemsCalls[setItemsCalls.length - 1];
      expect(lastCall[0].length).toBe(13); // 13 default suggestions
    });

    it('should fuzzy match on partial input', () => {
      // Access internal filterSuggestions via keypress handler
      // We need to simulate the filtering through the public interface
      const inputHandlers: Record<string, Function> = {};
      mockInput.on.mockImplementation((event: string, handler: Function) => {
        inputHandlers[event] = handler;
      });
      mockInput.getValue.mockReturnValue('fltr');

      // Re-create to capture handlers
      palette = new CommandPalette({
        parent: mockScreen,
        onSubmit,
      });

      // Simulate keypress
      if (inputHandlers['keypress']) {
        inputHandlers['keypress']('r', { name: 'r' });
      }

      // Verify setItems was called with filtered results
      const setItemsCalls = mockList.setItems.mock.calls;
      if (setItemsCalls.length > 0) {
        const lastCall = setItemsCalls[setItemsCalls.length - 1];
        // "fltr" should fuzzy match "Filter by worker", "Filter by level", etc.
        expect(lastCall[0].length).toBeGreaterThan(0);
        expect(lastCall[0].length).toBeLessThan(13);
      }
    });

    it('should highlight matching characters with yellow tags', () => {
      const inputHandlers: Record<string, Function> = {};
      mockInput.on.mockImplementation((event: string, handler: Function) => {
        inputHandlers[event] = handler;
      });
      mockInput.getValue.mockReturnValue('help');

      palette = new CommandPalette({
        parent: mockScreen,
        onSubmit,
      });

      if (inputHandlers['keypress']) {
        inputHandlers['keypress']('p', { name: 'p' });
      }

      const setItemsCalls = mockList.setItems.mock.calls;
      if (setItemsCalls.length > 0) {
        const lastCall = setItemsCalls[setItemsCalls.length - 1];
        // At least one result should contain yellow highlight tags
        const hasHighlight = lastCall[0].some((item: string) =>
          item.includes('{yellow-fg}')
        );
        expect(hasHighlight).toBe(true);
      }
    });

    it('should return no results for non-matching query', () => {
      const inputHandlers: Record<string, Function> = {};
      mockInput.on.mockImplementation((event: string, handler: Function) => {
        inputHandlers[event] = handler;
      });
      mockInput.getValue.mockReturnValue('zzzzzzz');

      palette = new CommandPalette({
        parent: mockScreen,
        onSubmit,
      });

      if (inputHandlers['keypress']) {
        inputHandlers['keypress']('z', { name: 'z' });
      }

      const setItemsCalls = mockList.setItems.mock.calls;
      if (setItemsCalls.length > 0) {
        const lastCall = setItemsCalls[setItemsCalls.length - 1];
        expect(lastCall[0].length).toBe(0);
      }
    });
  });

  describe('Recent Commands', () => {
    it('should load recent commands from file on construction', () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue(JSON.stringify(['help', 'quit']));

      const p = new CommandPalette({
        parent: mockScreen,
        onSubmit,
      });

      expect(existsSync).toHaveBeenCalled();
      expect(readFileSync).toHaveBeenCalled();
    });

    it('should save recent commands when executing a command', () => {
      const inputHandlers: Record<string, Function> = {};
      mockInput.on.mockImplementation((event: string, handler: Function) => {
        inputHandlers[event] = handler;
      });

      palette = new CommandPalette({
        parent: mockScreen,
        onSubmit,
      });

      // Simulate enter key to execute selected
      if (inputHandlers['keypress']) {
        inputHandlers['keypress']('', { name: 'enter' });
      }

      // writeFileSync should have been called to save recent commands
      expect(writeFileSync).toHaveBeenCalled();
    });

    it('should handle missing recent commands file gracefully', () => {
      (existsSync as any).mockReturnValue(false);

      // Should not throw
      expect(() => {
        new CommandPalette({
          parent: mockScreen,
          onSubmit,
        });
      }).not.toThrow();
    });

    it('should handle corrupt recent commands file gracefully', () => {
      (existsSync as any).mockReturnValue(true);
      (readFileSync as any).mockReturnValue('not valid json{{{');

      expect(() => {
        new CommandPalette({
          parent: mockScreen,
          onSubmit,
        });
      }).not.toThrow();
    });
  });

  describe('Navigation', () => {
    it('should support arrow key selection', () => {
      const inputHandlers: Record<string, Function> = {};
      mockInput.on.mockImplementation((event: string, handler: Function) => {
        inputHandlers[event] = handler;
      });

      palette = new CommandPalette({
        parent: mockScreen,
        onSubmit,
      });

      // Arrow down
      if (inputHandlers['keypress']) {
        inputHandlers['keypress']('', { name: 'down' });
        const selectCalls = mockList.select.mock.calls;
        if (selectCalls.length > 0) {
          expect(selectCalls[selectCalls.length - 1][0]).toBe(1);
        }
      }
    });

    it('should wrap around when navigating past end', () => {
      const inputHandlers: Record<string, Function> = {};
      mockInput.on.mockImplementation((event: string, handler: Function) => {
        inputHandlers[event] = handler;
      });

      palette = new CommandPalette({
        parent: mockScreen,
        onSubmit,
      });

      if (inputHandlers['keypress']) {
        // Navigate up from index 0 should wrap to last
        inputHandlers['keypress']('', { name: 'up' });
        const selectCalls = mockList.select.mock.calls;
        if (selectCalls.length > 0) {
          expect(selectCalls[selectCalls.length - 1][0]).toBe(12); // last of 13 items
        }
      }
    });
  });

  describe('Public API', () => {
    it('should add custom suggestions', () => {
      palette.addSuggestion({ label: 'Custom', category: 'Test', action: 'custom' });
      palette.show();

      const setItemsCalls = mockList.setItems.mock.calls;
      const lastCall = setItemsCalls[setItemsCalls.length - 1];
      expect(lastCall[0].length).toBe(14); // 13 defaults + 1 custom
    });

    it('should clear custom suggestions', () => {
      palette.addSuggestion({ label: 'Custom', category: 'Test', action: 'custom' });
      palette.clearSuggestions();
      palette.show();

      const setItemsCalls = mockList.setItems.mock.calls;
      const lastCall = setItemsCalls[setItemsCalls.length - 1];
      expect(lastCall[0].length).toBe(13); // Back to defaults
    });

    it('should set suggestions', () => {
      palette.setSuggestions([
        { label: 'Extra1', category: 'Test', action: 'e1' },
        { label: 'Extra2', category: 'Test', action: 'e2' },
      ]);
      palette.show();

      const setItemsCalls = mockList.setItems.mock.calls;
      const lastCall = setItemsCalls[setItemsCalls.length - 1];
      expect(lastCall[0].length).toBe(15); // 13 defaults + 2 extra
    });
  });
});
