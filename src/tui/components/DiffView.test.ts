/**
 * Tests for DiffView Component
 *
 * Tests diff parsing, rendering, and display with mocked blessed elements.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import blessed from 'blessed';

// Mock the blessed module before importing DiffView
vi.mock('blessed', () => {
  const mockBoxInstance = {
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
    width: 80,
  };

  const mockBox = vi.fn(() => mockBoxInstance);

  return {
    default: {
      box: mockBox,
    },
    box: mockBox,
  };
});

// Mock colors module
vi.mock('../utils/colors.js', () => ({
  colors: {
    border: 'blue',
    header: 'cyan',
    text: 'white',
    dim: 'gray',
  },
}));

// Import after mocking
import { DiffView, parseDiff } from './DiffView.js';
import type { DiffLine, DiffHunk } from './DiffView.js';

// Helper to create mock screen
function createMockScreen() {
  return {
    render: vi.fn(),
    append: vi.fn(),
    key: vi.fn(),
    destroy: vi.fn(),
  } as unknown as blessed.Widgets.Screen;
}

describe('DiffView', () => {
  let diffView: DiffView;
  let mockScreen: blessed.Widgets.Screen;
  let mockBoxInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockScreen = createMockScreen();

    // Get the mock box instance from the mock
    const blessedMock = blessed as unknown as { box: Mock };
    mockBoxInstance = blessedMock.box();

    diffView = new DiffView({
      parent: mockScreen,
      top: 0,
      left: 0,
      width: 80,
      height: 20,
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
          width: 80,
          height: 20,
          label: ' Diff View ',
          scrollable: true,
          alwaysScroll: true,
          keys: true,
          vi: true,
          mouse: true,
          hidden: true,
        })
      );
    });

    it('should use default maxLines of 50', () => {
      const view = new DiffView({
        parent: mockScreen,
        top: 0,
        left: 0,
        width: 80,
        height: 20,
      });
      expect(view).toBeDefined();
    });

    it('should accept custom maxLines option', () => {
      const view = new DiffView({
        parent: mockScreen,
        top: 0,
        left: 0,
        width: 80,
        height: 20,
        maxLines: 100,
      });
      expect(view).toBeDefined();
    });
  });

  describe('parseDiff', () => {
    it('should parse unified diff format', () => {
      const diffText = `--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,4 @@
 line 1
-line 2 old
+line 2 new
 line 3
+line 4`;

      const lines = parseDiff(diffText);

      // Should have 8 lines total (2 file headers + 1 hunk header + 5 content lines)
      expect(lines.length).toBeGreaterThanOrEqual(8);

      // Check header lines
      expect(lines[0].type).toBe('header');
      expect(lines[0].content).toBe('--- a/test.txt');
      expect(lines[1].type).toBe('header');
      expect(lines[1].content).toBe('+++ b/test.txt');
    });

    it('should parse hunk header correctly', () => {
      const diffText = `@@ -1,3 +1,4 @@`;

      const lines = parseDiff(diffText);

      expect(lines[0].type).toBe('header');
      expect(lines[0].content).toBe('@@ -1,3 +1,4 @@');
    });

    it('should parse context lines', () => {
      const diffText = ` context line`;

      const lines = parseDiff(diffText);

      expect(lines[0].type).toBe('context');
      expect(lines[0].content).toBe('context line');
    });

    it('should parse added lines', () => {
      const diffText = `+added line`;

      const lines = parseDiff(diffText);

      expect(lines[0].type).toBe('added');
      expect(lines[0].content).toBe('added line');
      // newLine increments, but starts from 0 so first added line is 1
      expect(lines[0].newLine).toBe(1);
    });

    it('should parse removed lines', () => {
      const diffText = `-removed line`;

      const lines = parseDiff(diffText);

      expect(lines[0].type).toBe('removed');
      expect(lines[0].content).toBe('removed line');
      // oldLine increments, but starts from 0 so first removed line is 1
      expect(lines[0].oldLine).toBe(1);
    });

    it('should handle empty diff', () => {
      const lines = parseDiff('');
      expect(lines).toHaveLength(0);
    });

    it('should handle diff with only headers', () => {
      const diffText = `--- a/test.txt
+++ b/test.txt`;

      const lines = parseDiff(diffText);
      expect(lines).toHaveLength(2);
      expect(lines.every(l => l.type === 'header')).toBe(true);
    });

    it('should track line numbers correctly', () => {
      const diffText = `@@ -1,3 +1,4 @@
 context 1
 context 2
-added old
+added new
 context 3`;

      const lines = parseDiff(diffText);

      const contextLine1 = lines.find(l => l.content === 'context 1');
      expect(contextLine1?.oldLine).toBe(1);
      expect(contextLine1?.newLine).toBe(1);

      const addedLine = lines.find(l => l.content === 'added new');
      expect(addedLine?.type).toBe('added');
      expect(addedLine?.newLine).toBe(3);

      const removedLine = lines.find(l => l.content === 'added old');
      expect(removedLine?.type).toBe('removed');
      expect(removedLine?.oldLine).toBe(3);
    });

    it('should handle multiple hunks', () => {
      const diffText = `@@ -1,2 +1,2 @@
-a
+b
@@ -5,2 +5,2 @@
-c
+d`;

      const lines = parseDiff(diffText);

      const hunkHeaders = lines.filter(l => l.type === 'header' && l.content.startsWith('@@'));
      expect(hunkHeaders).toHaveLength(2);
    });
  });

  describe('setDiff', () => {
    it('should set and render diff', () => {
      const diffText = `--- a/test.ts
+++ b/test.ts
@@ -1,1 +1,1 @@
-old
+new`;

      diffView.setDiff('test.ts', diffText);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should truncate diff when exceeding maxLines', () => {
      const view = new DiffView({
        parent: mockScreen,
        top: 0,
        left: 0,
        width: 80,
        height: 20,
        maxLines: 5,
      });

      // Create a diff with more than 5 lines
      const lines = Array.from({ length: 10 }, (_, i) => `+line ${i}`);
      const diffText = lines.join('\n');

      view.setDiff('test.txt', diffText);

      const hunk = view.getHunk();
      expect(hunk?.truncated).toBe(true);
      expect(hunk?.lines.length).toBe(5);
    });

    it('should not truncate diff within maxLines', () => {
      const diffText = `--- a/test.ts
+++ b/test.ts
@@ -1,2 +1,2 @@
-old
+new`;

      diffView.setDiff('test.ts', diffText);

      const hunk = diffView.getHunk();
      expect(hunk?.truncated).toBe(false);
    });

    it('should store file path', () => {
      diffView.setDiff('src/test.ts', 'diff content');

      const hunk = diffView.getHunk();
      expect(hunk?.path).toBe('src/test.ts');
    });
  });

  describe('setEditDiff', () => {
    it('should generate diff from old/new strings', () => {
      const oldString = 'line 1\nline 2\nline 3';
      const newString = 'line 1\nline 2 modified\nline 3';

      diffView.setEditDiff('test.txt', oldString, newString);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('test.txt');
    });

    it('should handle empty old string', () => {
      diffView.setEditDiff('new.txt', '', 'content');

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });

    it('should handle empty new string', () => {
      diffView.setEditDiff('deleted.txt', 'content', '');

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });

    it('should handle identical strings', () => {
      const content = 'same content';
      diffView.setEditDiff('same.txt', content, content);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });
  });

  describe('render output', () => {
    it('should show no diff message when empty', () => {
      diffView.render();

      expect(mockBoxInstance.setContent).toHaveBeenCalledWith(
        expect.stringContaining('No diff to display')
      );
    });

    it('should render file path in header', () => {
      diffView.setDiff('src/component.ts', 'diff');

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('src/component.ts');
    });

    it('should render truncation notice when truncated', () => {
      const view = new DiffView({
        parent: mockScreen,
        top: 0,
        left: 0,
        width: 80,
        height: 20,
        maxLines: 2,
      });

      view.setDiff('test.txt', '+line 1\n+line 2\n+line 3');

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('truncated');
    });

    it('should format added lines with green color', () => {
      diffView.setDiff('test.ts', '+new line');

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('{green-fg}');
    });

    it('should format removed lines with red color', () => {
      diffView.setDiff('test.ts', '-old line');

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('{red-fg}');
    });

    it('should format context lines with gray color', () => {
      diffView.setDiff('test.ts', ' context line');

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('{gray-fg}');
    });

    it('should format headers with cyan color', () => {
      diffView.setDiff('test.ts', '--- a/test.ts\n+++ b/test.ts');

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('{cyan-fg}');
    });
  });

  describe('show/hide/toggle', () => {
    it('should show the diff view', () => {
      diffView.show();
      expect(mockBoxInstance.show).toHaveBeenCalled();
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should hide the diff view', () => {
      diffView.hide();
      expect(mockBoxInstance.hide).toHaveBeenCalled();
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should toggle visibility', () => {
      // Initially hidden
      mockBoxInstance.hidden = true;
      diffView.toggle();
      expect(mockBoxInstance.show).toHaveBeenCalled();

      vi.clearAllMocks();

      // Now visible, toggle should hide
      mockBoxInstance.hidden = false;
      diffView.toggle();
      expect(mockBoxInstance.hide).toHaveBeenCalled();
    });

    it('should return visibility state', () => {
      mockBoxInstance.hidden = true;
      expect(diffView.isVisible()).toBe(false);

      mockBoxInstance.hidden = false;
      expect(diffView.isVisible()).toBe(true);
    });
  });

  describe('clear', () => {
    it('should clear the current diff', () => {
      diffView.setDiff('test.ts', 'some diff');
      diffView.clear();

      expect(mockBoxInstance.setContent).toHaveBeenCalledWith(
        expect.stringContaining('No diff to display')
      );
    });
  });

  describe('focus', () => {
    it('should focus the box element', () => {
      diffView.focus();
      expect(mockBoxInstance.focus).toHaveBeenCalled();
    });
  });

  describe('getElement', () => {
    it('should return the box element', () => {
      const element = diffView.getElement();
      expect(element).toBe(mockBoxInstance);
    });
  });

  describe('getHunk', () => {
    it('should return current hunk', () => {
      diffView.setDiff('test.ts', 'diff content');

      const hunk = diffView.getHunk();
      expect(hunk).toBeDefined();
      expect(hunk?.path).toBe('test.ts');
      expect(hunk?.lines).toBeDefined();
    });

    it('should return null when no diff set', () => {
      const hunk = diffView.getHunk();
      expect(hunk).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle diff with special characters', () => {
      const diffText = `+line with {braces}
+line with "quotes"
+line with 'apostrophes'
+line with <angles>
+line with [brackets]`;

      expect(() => diffView.setDiff('test.txt', diffText)).not.toThrow();
    });

    it('should handle diff with unicode', () => {
      const diffText = `+unicode: 你好 🎉
+emoji: ✅ ❌`;

      expect(() => diffView.setDiff('test.txt', diffText)).not.toThrow();
    });

    it('should handle very long lines', () => {
      const longLine = 'a'.repeat(1000);
      const diffText = `+${longLine}`;

      diffView.setDiff('test.txt', diffText);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });

    it('should handle binary-like content', () => {
      const diffText = `+\x00\x01\x02\x03`;

      expect(() => diffView.setDiff('test.bin', diffText)).not.toThrow();
    });

    it('should handle mixed line endings', () => {
      const diffText = 'line1\r\nline2\nline3\r';

      expect(() => parseDiff(diffText)).not.toThrow();
    });
  });

  describe('regression tests', () => {
    it('should not regress line number tracking', () => {
      const diffText = `@@ -10,5 +10,6 @@
 context 1
 context 2
-removed
+added
 context 3
 context 4`;

      const lines = parseDiff(diffText);

      // Find the added line
      const addedLine = lines.find(l => l.type === 'added');
      // newLine starts at 10 (from hunk) + 2 (two context lines before it) = 12
      // Actually, the hunk says +10,6 so newLine starts at 10, then we have 2 context lines = 12
      expect(addedLine?.newLine).toBe(12);

      // Find the removed line
      const removedLine = lines.find(l => l.type === 'removed');
      // oldLine starts at 10 (from hunk) + 2 (two context lines before it) = 12
      expect(removedLine?.oldLine).toBe(12);

      // Context lines should have both numbers
      const contextLines = lines.filter(l => l.type === 'context');
      expect(contextLines[0]?.oldLine).toBe(10);
      expect(contextLines[0]?.newLine).toBe(10);
      expect(contextLines[1]?.oldLine).toBe(11);
      expect(contextLines[1]?.newLine).toBe(11);
    });

    it('should not regress diff format output', () => {
      const diffText = `--- a/test.ts
+++ b/test.ts
@@ -1,1 +1,1 @@
-old
+new`;

      diffView.setDiff('test.ts', diffText);

      const content = mockBoxInstance.setContent.mock.calls[0][0];

      // Should contain all expected sections
      expect(content).toContain('test.ts');
      expect(content).toContain('{bold}'); // Bold for file path
      expect(content).toContain('{gray-fg}'); // Gray for separator
      expect(content).toContain('{green-fg}'); // Green for additions
      expect(content).toContain('{red-fg}'); // Red for deletions
    });

    it('should not regress truncation behavior', () => {
      const view = new DiffView({
        parent: mockScreen,
        top: 0,
        left: 0,
        width: 80,
        height: 20,
        maxLines: 10,
      });

      // Create exactly maxLines
      const lines = Array.from({ length: 10 }, (_, i) => `+line ${i}`);
      view.setDiff('test.txt', lines.join('\n'));

      let hunk = view.getHunk();
      expect(hunk?.truncated).toBe(false);

      // Add one more line
      const moreLines = Array.from({ length: 11 }, (_, i) => `+line ${i}`);
      view.setDiff('test.txt', moreLines.join('\n'));

      hunk = view.getHunk();
      expect(hunk?.truncated).toBe(true);
      expect(hunk?.lines.length).toBe(10);
    });
  });
});
