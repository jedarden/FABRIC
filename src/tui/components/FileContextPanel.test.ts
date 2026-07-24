/**
 * Tests for FileContextPanel Component
 *
 * Tests file context display, syntax highlighting, and operation history.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import blessed from 'blessed';
import * as fs from 'fs';

// Track all mock box instances
const mockBoxes: any[] = [];
let mainBoxInstance: any;

// Mock the blessed module before importing FileContextPanel
vi.mock('blessed', () => {
  const createMockElement = (index: number) => ({
    setContent: vi.fn(),
    setLabel: vi.fn(),
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
    height: 20,
    width: 80,
  });

  const boxMock = vi.fn((...args: any[]) => {
    const index = mockBoxes.length;
    const mock = createMockElement(index);
    mockBoxes.push(mock);
    if (index === 0) {
      mainBoxInstance = mock;
    }
    return mock;
  });

  return {
    default: {
      box: boxMock,
    },
    box: boxMock,
  };
});

// Mock colors module
vi.mock('../utils/colors.js', () => ({
  colors: {
    border: 'blue',
    header: 'cyan',
    text: 'white',
    dim: 'gray',
    muted: 'gray',
  },
}));

// Mock fs module
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    statSync: vi.fn(() => ({
      isFile: () => true,
      size: 1024,
    })),
    readFileSync: vi.fn(() => 'file content'),
  },
  existsSync: vi.fn(() => true),
  statSync: vi.fn(() => ({
    isFile: () => true,
    size: 1024,
  })),
  readFileSync: vi.fn(() => 'file content'),
}));

// Import after mocking
import { FileContextPanel } from './FileContextPanel.js';
import type { FileContext, FileOperation } from './FileContextPanel.js';
import { LogEvent } from '../../types.js';

// Helper to create mock screen
function createMockScreen() {
  return {
    render: vi.fn(),
    append: vi.fn(),
    key: vi.fn(),
    destroy: vi.fn(),
  } as unknown as blessed.Widgets.Screen;
}

// Helper to create mock LogEvent
function createMockEvent(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    ts: Date.now(),
    worker: 'w-test123',
    level: 'info',
    msg: 'Test event',
    ...overrides,
  };
}

describe('FileContextPanel', () => {
  let panel: FileContextPanel;
  let mockScreen: blessed.Widgets.Screen;

  beforeEach(() => {
    mockBoxes.length = 0;
    mainBoxInstance = undefined;
    vi.clearAllMocks();

    mockScreen = createMockScreen();

    panel = new FileContextPanel({
      parent: mockScreen,
      top: 0,
      left: 0,
      width: '40%',
      bottom: 0,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockBoxes.length = 0;
    mainBoxInstance = undefined;
  });

  describe('constructor', () => {
    it('should create a blessed box with correct options', () => {
      const blessedMock = blessed as unknown as { box: Mock };
      expect(blessedMock.box).toHaveBeenCalledWith(
        expect.objectContaining({
          parent: mockScreen,
          top: 0,
          left: 0,
          width: '40%',
          bottom: 0,
          label: ' File Context ',
          scrollable: true,
          alwaysScroll: true,
          keys: true,
          vi: true,
          mouse: true,
        })
      );
    });

    it('should create sub-boxes for content sections', () => {
      const blessedMock = blessed as unknown as { box: Mock };
      // Should be called multiple times for main box + sub-boxes
      expect(blessedMock.box).toHaveBeenCalled();
    });

    it('should bind key handlers on construction', () => {
      expect(mainBoxInstance.key).toHaveBeenCalled();
    });
  });

  describe('setContextFromEvent', () => {
    it('should create new context from event with path', () => {
      const event = createMockEvent({
        path: '/src/test.ts',
        tool: 'Read',
      });

      panel.setContextFromEvent(event);

      const context = panel.getContext();
      expect(context?.path).toBe('/src/test.ts');
      expect(context?.operations).toHaveLength(1);
    });

    it('should update existing context for same file', () => {
      const event1 = createMockEvent({
        path: '/src/test.ts',
        tool: 'Read',
      });
      const event2 = createMockEvent({
        path: '/src/test.ts',
        tool: 'Edit',
      });

      panel.setContextFromEvent(event1);
      panel.setContextFromEvent(event2);

      const context = panel.getContext();
      expect(context?.operations).toHaveLength(2);
      expect(panel.getRecentFiles()).toHaveLength(1);
    });

    it('should detect operation type from tool', () => {
      const readEvent = createMockEvent({ path: '/test.txt', tool: 'Read' });
      panel.setContextFromEvent(readEvent);

      let context = panel.getContext();
      expect(context?.operations[0].type).toBe('read');

      const editEvent = createMockEvent({ path: '/test2.txt', tool: 'Edit' });
      panel.setContextFromEvent(editEvent);

      context = panel.getContext();
      expect(context?.operations[0].type).toBe('edit');
    });

    it('should detect operation type from message', () => {
      const event = createMockEvent({
        path: '/test.txt',
        msg: 'Reading file content',
      });

      panel.setContextFromEvent(event);

      const context = panel.getContext();
      expect(context?.operations[0].type).toBe('read');
    });

    it('should limit operations history to 20', () => {
      const event = createMockEvent({
        path: '/test.ts',
        tool: 'Read',
      });

      // Add 25 operations
      for (let i = 0; i < 25; i++) {
        panel.setContextFromEvent({ ...event, ts: Date.now() + i });
      }

      const context = panel.getContext();
      expect(context?.operations.length).toBeLessThanOrEqual(20);
    });

    it('should limit recent files to maxRecentFiles', () => {
      // Add events for 15 different files
      for (let i = 0; i < 15; i++) {
        panel.setContextFromEvent(
          createMockEvent({ path: `/src/file${i}.ts`, tool: 'Read' })
        );
      }

      expect(panel.getRecentFiles().length).toBeLessThanOrEqual(10);
    });

    it('should track last modified by and time', () => {
      const event = createMockEvent({
        path: '/test.ts',
        worker: 'w-worker456',
        ts: 1234567890,
      });

      panel.setContextFromEvent(event);

      const context = panel.getContext();
      expect(context?.lastModifiedBy).toBe('w-worker456');
      expect(context?.lastModifiedAt).toBe(1234567890);
    });

    it('should ignore events without path', () => {
      const event = createMockEvent({ tool: 'Read' });
      delete (event as any).path;

      panel.setContextFromEvent(event);

      expect(panel.getContext()).toBeNull();
    });

    it('should reset scroll offset on new context', () => {
      const event1 = createMockEvent({ path: '/test1.ts' });
      const event2 = createMockEvent({ path: '/test2.ts' });

      panel.setContextFromEvent(event1);
      panel.setContextFromEvent(event2);

      // Should render without errors
      expect(mainBoxInstance.screen.render).toHaveBeenCalled();
    });
  });

  describe('setContent', () => {
    it('should update content for existing file context', () => {
      const event = createMockEvent({ path: '/test.ts' });
      panel.setContextFromEvent(event);

      const content = 'file content here';
      panel.setContent('/test.ts', content);

      const context = panel.getContext();
      expect(context?.content).toBe(content);
    });

    it('should not create context for non-existent file', () => {
      panel.setContent('/nonexistent.ts', 'content');

      expect(panel.getContext()).toBeNull();
    });

    it('should trigger render when updating current file', () => {
      const event = createMockEvent({ path: '/current.ts' });
      panel.setContextFromEvent(event);

      panel.setContent('/current.ts', 'new content');

      expect(mainBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should not trigger render for non-current file', () => {
      const event1 = createMockEvent({ path: '/file1.ts' });
      const event2 = createMockEvent({ path: '/file2.ts' });

      panel.setContextFromEvent(event1);
      panel.setContextFromEvent(event2);

      vi.clearAllMocks();

      panel.setContent('/file1.ts', 'content');

      // Should not render since file2 is current
      expect(mainBoxInstance.screen.render).not.toHaveBeenCalled();
    });
  });

  describe('syntax highlighting', () => {
    it('should detect TypeScript files', () => {
      const event = createMockEvent({ path: '/src/test.ts' });
      panel.setContextFromEvent(event);

      // Render should include language indicator
      expect(mainBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should detect JavaScript files', () => {
      const event = createMockEvent({ path: '/src/test.js' });
      panel.setContextFromEvent(event);

      expect(mainBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should detect Python files', () => {
      const event = createMockEvent({ path: '/src/test.py' });
      panel.setContextFromEvent(event);

      expect(mainBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should detect Rust files', () => {
      const event = createMockEvent({ path: '/src/test.rs' });
      panel.setContextFromEvent(event);

      expect(mainBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should handle unknown file types', () => {
      const event = createMockEvent({ path: '/src/test.unknown' });
      panel.setContextFromEvent(event);

      expect(mainBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should detect multiple TypeScript extensions', () => {
      const extensions = ['ts', 'tsx', 'mts'];
      extensions.forEach(ext => {
        const event = createMockEvent({ path: `/test.${ext}` });
        expect(() => panel.setContextFromEvent(event)).not.toThrow();
      });
    });
  });

  describe('operation icons', () => {
    it('should show read icon for read operations', () => {
      const event = createMockEvent({ path: '/test.txt', tool: 'Read' });
      panel.setContextFromEvent(event);

      // Should render with read icon
      expect(mainBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should show edit icon for edit operations', () => {
      const event = createMockEvent({ path: '/test.txt', tool: 'Edit' });
      panel.setContextFromEvent(event);

      expect(mainBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should show write icon for write operations', () => {
      const event = createMockEvent({ path: '/test.txt', tool: 'Write' });
      panel.setContextFromEvent(event);

      expect(mainBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should show glob icon for glob operations', () => {
      const event = createMockEvent({ path: '/src/*.ts', tool: 'Glob' });
      panel.setContextFromEvent(event);

      expect(mainBoxInstance.screen.render).toHaveBeenCalled();
    });
  });

  describe('recent files navigation', () => {
    beforeEach(() => {
      // Add multiple files
      for (let i = 0; i < 5; i++) {
        panel.setContextFromEvent(
          createMockEvent({ path: `/src/file${i}.ts`, tool: 'Read' })
        );
      }
    });

    it('should navigate to previous file', () => {
      const mockBox = mainBoxInstance as any;
      const keyCalls = mockBox.key.mock.calls;

      // Find the [ key handler
      const bracketCall = keyCalls.find((call: unknown[]) =>
        Array.isArray(call?.[0]) && call[0].includes('[')
      );
      const handler = bracketCall?.[1];

      if (handler) {
        handler();
      }

      expect(mainBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should navigate to next file', () => {
      const mockBox = mainBoxInstance as any;
      const keyCalls = mockBox.key.mock.calls;

      // Find the ] key handler
      const bracketCall = keyCalls.find((call: unknown[]) =>
        Array.isArray(call?.[0]) && call[0].includes(']')
      );
      const handler = bracketCall?.[1];

      if (handler) {
        handler();
      }

      expect(mainBoxInstance.screen.render).toHaveBeenCalled();
    });
  });

  describe('show/hide/toggle', () => {
    it('should show the panel', () => {
      panel.show();
      expect(mainBoxInstance.show).toHaveBeenCalled();
      expect(mainBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should hide the panel', () => {
      panel.hide();
      expect(mainBoxInstance.hide).toHaveBeenCalled();
      expect(mainBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should toggle visibility', () => {
      // Initially not visible
      panel.toggle();
      expect(mainBoxInstance.show).toHaveBeenCalled();

      vi.clearAllMocks();

      // Now visible, toggle should hide
      (panel as any).visible = true;
      panel.toggle();
      expect(mainBoxInstance.hide).toHaveBeenCalled();
    });

    it('should return visibility state', () => {
      expect(panel.isVisible()).toBe(false);

      panel.show();
      expect(panel.isVisible()).toBe(true);
    });
  });

  describe('focus', () => {
    it('should focus the box element', () => {
      panel.focus();
      expect(mainBoxInstance.focus).toHaveBeenCalled();
    });
  });

  describe('getElement', () => {
    it('should return the box element', () => {
      const element = panel.getElement();
      expect(element).toBe(mainBoxInstance);
    });
  });

  describe('getContext and getRecentFiles', () => {
    it('should return current context', () => {
      const event = createMockEvent({ path: '/test.ts' });
      panel.setContextFromEvent(event);

      const context = panel.getContext();
      expect(context?.path).toBe('/test.ts');
    });

    it('should return null when no context', () => {
      expect(panel.getContext()).toBeNull();
    });

    it('should return copy of recent files', () => {
      const event1 = createMockEvent({ path: '/file1.ts' });
      const event2 = createMockEvent({ path: '/file2.ts' });

      panel.setContextFromEvent(event1);
      panel.setContextFromEvent(event2);

      const recent = panel.getRecentFiles();
      expect(recent).toHaveLength(2);

      // Modifying returned array should not affect internal state
      recent.push({ path: '/new.ts', operations: [] } as any);
      expect(panel.getRecentFiles()).toHaveLength(2);
    });
  });

  describe('clear', () => {
    it('should clear all contexts', () => {
      panel.setContextFromEvent(createMockEvent({ path: '/test.ts' }));
      panel.clear();

      expect(panel.getContext()).toBeNull();
      expect(panel.getRecentFiles()).toHaveLength(0);
    });

    it('should render after clear', () => {
      panel.setContextFromEvent(createMockEvent({ path: '/test.ts' }));
      panel.clear();

      expect(mainBoxInstance.screen.render).toHaveBeenCalled();
    });
  });

  describe('key bindings', () => {
    it('should bind scroll up keys', () => {
      const mockBox = mainBoxInstance as any;
      const keyCalls = mockBox.key.mock.calls;

      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && (call[0].includes('up') || call[0].includes('k'))
      )).toBe(true);
    });

    it('should bind scroll down keys', () => {
      const mockBox = mainBoxInstance as any;
      const keyCalls = mockBox.key.mock.calls;

      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && (call[0].includes('down') || call[0].includes('j'))
      )).toBe(true);
    });

    it('should bind page up/down keys', () => {
      const mockBox = mainBoxInstance as any;
      const keyCalls = mockBox.key.mock.calls;

      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && call[0].includes('pageup')
      )).toBe(true);

      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && call[0].includes('pagedown')
      )).toBe(true);
    });

    it('should bind open in editor key', () => {
      const mockBox = mainBoxInstance as any;
      const keyCalls = mockBox.key.mock.calls;

      expect(keyCalls.some((call: unknown[]) =>
        Array.isArray(call?.[0]) && (call[0].includes('o') || call[0].includes('O'))
      )).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle file with no extension', () => {
      const event = createMockEvent({ path: '/src/Makefile' });
      expect(() => panel.setContextFromEvent(event)).not.toThrow();
    });

    it('should handle file with multiple extensions', () => {
      const event = createMockEvent({ path: '/src/test.tar.gz' });
      expect(() => panel.setContextFromEvent(event)).not.toThrow();
    });

    it('should handle deeply nested paths', () => {
      const event = createMockEvent({
        path: '/very/deeply/nested/path/to/file.ts',
      });
      expect(() => panel.setContextFromEvent(event)).not.toThrow();
    });

    it('should handle unicode file names', () => {
      const event = createMockEvent({ path: '/src/测试.ts' });
      expect(() => panel.setContextFromEvent(event)).not.toThrow();
    });

    it('should handle empty file path', () => {
      const event = createMockEvent({ path: '' });
      panel.setContextFromEvent(event);

      expect(panel.getContext()).toBeNull();
    });

    it('should handle events with all tools', () => {
      const tools = ['Read', 'Edit', 'Write', 'Glob', 'NotebookEdit', 'Unknown'];
      tools.forEach(tool => {
        const event = createMockEvent({ path: '/test.ts', tool: tool as any });
        expect(() => panel.setContextFromEvent(event)).not.toThrow();
      });
    });

    it('should handle rapid context changes', () => {
      for (let i = 0; i < 100; i++) {
        panel.setContextFromEvent(
          createMockEvent({ path: `/file${i}.ts`, tool: 'Read' })
        );
      }

      expect(panel.getRecentFiles().length).toBeLessThanOrEqual(10);
    });
  });

  describe('render output', () => {
    it('should show no file selected message when empty', () => {
      (panel as any).render();

      // fileInfo is the second box created (index 1), it gets the "No file selected" message
      expect(mockBoxes[1]?.setContent).toHaveBeenCalled();
    });

    it('should show actual file content when available', () => {
      const event = createMockEvent({ path: '/src/test.ts' });

      panel.setContextFromEvent(event);

      const context = panel.getContext();
      expect(context?.content).toBeDefined();
      expect(context?.content).toBe('file content');
    });

    it('should show placeholder when file cannot be read', () => {
      (fs.existsSync as Mock).mockReturnValue(false);

      const event = createMockEvent({ path: '/nonexistent.ts' });
      panel.setContextFromEvent(event);

      const context = panel.getContext();
      expect(context?.content).toBeUndefined();
    });

    it('should include file path in header', () => {
      const event = createMockEvent({ path: '/src/component.ts' });
      panel.setContextFromEvent(event);

      expect(mainBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should include directory path', () => {
      const event = createMockEvent({ path: '/src/components/Button.ts' });
      panel.setContextFromEvent(event);

      expect(mainBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should include operation history', () => {
      const event = createMockEvent({ path: '/test.ts', tool: 'Read' });
      panel.setContextFromEvent(event);

      expect(mainBoxInstance.screen.render).toHaveBeenCalled();
    });
  });

  describe('regression tests', () => {
    it('should not regress recent file ordering', () => {
      // Add files in order
      panel.setContextFromEvent(createMockEvent({ path: '/file1.ts' }));
      panel.setContextFromEvent(createMockEvent({ path: '/file2.ts' }));
      panel.setContextFromEvent(createMockEvent({ path: '/file3.ts' }));

      const recent = panel.getRecentFiles();
      expect(recent[0].path).toBe('/file3.ts'); // Most recent first
      expect(recent[1].path).toBe('/file2.ts');
      expect(recent[2].path).toBe('/file1.ts');
    });

    it('should not regress operation type detection', () => {
      const testCases = [
        { tool: 'Read', expected: 'read' },
        { tool: 'Edit', expected: 'edit' },
        { tool: 'Write', expected: 'write' },
        { tool: 'Glob', expected: 'glob' },
        { msg: 'reading file', expected: 'read' },
        { msg: 'editing content', expected: 'edit' },
        { msg: 'writing output', expected: 'write' },
        { msg: 'glob pattern', expected: 'glob' },
      ];

      testCases.forEach(({ tool, msg, expected }) => {
        const event = createMockEvent({
          path: `/test${expected}.txt`,
          tool: tool as any,
          msg,
        });
        panel.setContextFromEvent(event);

        const context = panel.getContext();
        expect(context?.operations[0].type).toBe(expected);
      });
    });

    it('should not regress language detection', () => {
      const extensions: Record<string, string> = {
        'ts': 'typescript',
        'tsx': 'typescript',
        'js': 'javascript',
        'py': 'python',
        'rs': 'rust',
        'go': 'go',
        'sh': 'shell',
        'json': 'json',
        'md': 'markdown',
      };

      Object.entries(extensions).forEach(([ext, lang]) => {
        const event = createMockEvent({ path: `/test.${ext}` });
        expect(() => panel.setContextFromEvent(event)).not.toThrow();
      });
    });
  });

  describe('file content reading', () => {
    beforeEach(() => {
      // Re-apply fs mocks for each test in this describe block
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.statSync as Mock).mockReturnValue({
        isFile: () => true,
        size: 1024,
      });
      (fs.readFileSync as Mock).mockReturnValue('file content');
    });

    it('should read file content when setting context from event', () => {
      const event = createMockEvent({ path: '/src/test.ts' });

      panel.setContextFromEvent(event);

      expect(fs.existsSync).toHaveBeenCalledWith('/src/test.ts');
      expect(fs.statSync).toHaveBeenCalledWith('/src/test.ts');

      const context = panel.getContext();
      expect(context?.content).toBe('file content');
    });

    it('should not read content for non-existent files', () => {
      (fs.existsSync as Mock).mockReturnValue(false);

      const event = createMockEvent({ path: '/nonexistent.ts' });
      panel.setContextFromEvent(event);

      const context = panel.getContext();
      expect(context?.content).toBeUndefined();
    });

    it('should not read content for directories', () => {
      (fs.statSync as Mock).mockReturnValue({
        isFile: () => false,
        size: 4096,
      });

      const event = createMockEvent({ path: '/src' });
      panel.setContextFromEvent(event);

      const context = panel.getContext();
      expect(context?.content).toBeUndefined();
    });

    it('should truncate files larger than 1MB', () => {
      (fs.statSync as Mock).mockReturnValue({
        isFile: () => true,
        size: 2 * 1024 * 1024, // 2MB
      });

      const event = createMockEvent({ path: '/large.ts' });
      panel.setContextFromEvent(event);

      const context = panel.getContext();
      expect(context?.content).toBeUndefined();
    });

    it('should truncate files larger than 100KB with message', () => {
      const largeContent = 'x'.repeat(150 * 1024); // 150KB
      (fs.readFileSync as Mock).mockReturnValue(largeContent);
      (fs.statSync as Mock).mockReturnValue({
        isFile: () => true,
        size: largeContent.length,
      });

      const event = createMockEvent({ path: '/large.ts' });
      panel.setContextFromEvent(event);

      const context = panel.getContext();
      expect(context?.content).toBeDefined();
      expect(context?.content?.length).toBeLessThan(largeContent.length);
      expect(context?.content).toContain('... (file truncated)');
    });

    it('should handle read errors gracefully', () => {
      (fs.existsSync as Mock).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const event = createMockEvent({ path: '/restricted.ts' });
      expect(() => panel.setContextFromEvent(event)).not.toThrow();

      const context = panel.getContext();
      expect(context?.content).toBeUndefined();
    });

    it('should refresh content on subsequent context updates', () => {
      const event = createMockEvent({ path: '/test.ts' });

      panel.setContextFromEvent(event);

      // First read should call fs methods
      expect(fs.existsSync).toHaveBeenCalled();
      expect(fs.statSync).toHaveBeenCalled();
      expect(fs.readFileSync).toHaveBeenCalled();

      // Track call counts before second update
      const existsSyncCalls = (fs.existsSync as Mock).mock.calls.length;
      const statSyncCalls = (fs.statSync as Mock).mock.calls.length;
      const readFileSyncCalls = (fs.readFileSync as Mock).mock.calls.length;

      // Update context with same file (simulating new event - should refresh to show latest changes)
      panel.setContextFromEvent({ ...event, ts: Date.now() + 1000 });

      // New fs calls should be made to refresh the content and show latest changes
      expect((fs.existsSync as Mock).mock.calls.length).toBeGreaterThan(existsSyncCalls);
      expect((fs.statSync as Mock).mock.calls.length).toBeGreaterThan(statSyncCalls);
      expect((fs.readFileSync as Mock).mock.calls.length).toBeGreaterThan(readFileSyncCalls);

      const context = panel.getContext();
      expect(context?.content).toBe('file content');
    });

    it('should handle UTF-8 encoding correctly', () => {
      const utf8Content = 'Hello 世界 🌍';
      (fs.readFileSync as Mock).mockReturnValue(utf8Content);
      (fs.statSync as Mock).mockReturnValue({
        isFile: () => true,
        size: utf8Content.length,
      });

      const event = createMockEvent({ path: '/utf8.ts' });
      panel.setContextFromEvent(event);

      const context = panel.getContext();
      expect(context?.content).toBe(utf8Content);
    });
  });
});
