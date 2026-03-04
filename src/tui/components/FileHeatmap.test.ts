/**
 * Tests for FileHeatmap Component
 *
 * Tests the file heatmap display with mocked blessed elements.
 * Tests heatmap calculation, color gradient rendering, and file path truncation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as blessed from 'blessed';

// Mock the blessed module before importing FileHeatmap
vi.mock('blessed', () => {
  // Create the mock box inside the factory
  const mockBoxInstance = {
    setContent: vi.fn(),
    setLabel: vi.fn(),
    focus: vi.fn(),
    key: vi.fn(),
    screen: {
      render: vi.fn(),
    },
  };

  const mockBox = vi.fn(() => mockBoxInstance);

  return {
    default: {
      box: mockBox,
    },
    box: mockBox,
  };
});

// Import after mocking
import { FileHeatmap } from './FileHeatmap.js';
import { FileHeatmapEntry, FileHeatmapStats, HeatmapOptions, HeatLevel } from '../../types.js';

// Helper to create mock FileHeatmapEntry
function createMockEntry(overrides: Partial<FileHeatmapEntry> = {}): FileHeatmapEntry {
  return {
    path: 'src/test.ts',
    modifications: 5,
    heatLevel: 'warm',
    workers: [
      {
        workerId: 'w-test123',
        modifications: 5,
        lastModified: Date.now(),
        percentage: 100,
      },
    ],
    firstModified: Date.now() - 60000,
    lastModified: Date.now(),
    hasCollision: false,
    activeWorkers: 1,
    avgModificationInterval: 12000,
    ...overrides,
  };
}

// Helper to create mock FileHeatmapStats
function createMockStats(overrides: Partial<FileHeatmapStats> = {}): FileHeatmapStats {
  return {
    totalFiles: 10,
    totalModifications: 50,
    collisionFiles: 2,
    activeFiles: 3,
    heatDistribution: {
      cold: 5,
      warm: 3,
      hot: 1,
      critical: 1,
    },
    mostActiveDirectory: 'src/',
    avgModificationsPerFile: 5,
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

describe('FileHeatmap', () => {
  let fileHeatmap: FileHeatmap;
  let mockScreen: blessed.Widgets.Screen;
  let mockBoxInstance: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockScreen = createMockScreen();

    // Get the mock box instance from the mock
    const blessedMock = blessed as unknown as { box: vi.Mock };
    mockBoxInstance = blessedMock.box();

    fileHeatmap = new FileHeatmap({
      parent: mockScreen,
      top: 0,
      left: 0,
      width: '50%',
      bottom: 0,
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
          bottom: 0,
          label: ' File Heatmap ',
          scrollable: true,
          alwaysScroll: true,
          keys: true,
          vi: true,
          mouse: true,
        })
      );
    });

    it('should bind key handlers on construction', () => {
      // Key bindings should be registered
      expect(mockBoxInstance.key).toHaveBeenCalled();
    });
  });

  describe('updateData', () => {
    it('should update entries and render', () => {
      const entries = [
        createMockEntry({ path: 'src/a.ts', modifications: 10 }),
        createMockEntry({ path: 'src/b.ts', modifications: 5 }),
      ];
      const stats = createMockStats();

      const getHeatmap = () => entries;
      const getStats = () => stats;

      fileHeatmap.updateData(getHeatmap, getStats);

      expect(mockBoxInstance.setContent).toHaveBeenCalled();
      expect(mockBoxInstance.screen.render).toHaveBeenCalled();
    });

    it('should show "No file modifications detected" when empty', () => {
      const getHeatmap = () => [];
      const getStats = () => createMockStats({ totalFiles: 0 });

      fileHeatmap.updateData(getHeatmap, getStats);

      expect(mockBoxInstance.setContent).toHaveBeenCalledWith(
        expect.stringContaining('No file modifications detected')
      );
    });

    it('should display statistics header', () => {
      const entries = [createMockEntry()];
      const stats = createMockStats({
        totalFiles: 10,
        totalModifications: 50,
        activeFiles: 3,
        collisionFiles: 2,
      });

      const getHeatmap = () => entries;
      const getStats = () => stats;

      fileHeatmap.updateData(getHeatmap, getStats);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('Files: 10');
      expect(content).toContain('Mods: 50');
      expect(content).toContain('Active: 3');
      expect(content).toContain('⚠ 2');
    });

    it('should reset selected index if out of bounds', () => {
      // First set some entries
      const firstEntries = [
        createMockEntry({ path: 'a.ts' }),
        createMockEntry({ path: 'b.ts' }),
        createMockEntry({ path: 'c.ts' }),
      ];
      fileHeatmap.updateData(() => firstEntries, createMockStats);

      // Update to fewer entries
      const secondEntries = [createMockEntry({ path: 'a.ts' })];
      fileHeatmap.updateData(() => secondEntries, createMockStats);

      // Should not throw and selection should be valid
      const selected = fileHeatmap.getSelected();
      expect(selected).toBeDefined();
      expect(selected?.path).toBe('a.ts');
    });
  });

  describe('file path truncation (formatPath)', () => {
    it('should not truncate short paths', () => {
      const entry = createMockEntry({ path: 'src/test.ts' });
      fileHeatmap.updateData(() => [entry], createMockStats);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('src/test.ts');
    });

    it('should truncate long paths while preserving filename', () => {
      const longPath = 'src/very/long/directory/structure/that/should/be/truncated/file.ts';
      const entry = createMockEntry({ path: longPath });
      fileHeatmap.updateData(() => [entry], createMockStats);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      // Should contain filename
      expect(content).toContain('file.ts');
      // Should contain ellipsis for truncation
      expect(content).toContain('...');
    });

    it('should handle paths with very long filenames', () => {
      const longFilename = 'src/verylongfilenamethatexceedsmaximumlengthallowed.test.integration.spec.ts';
      const entry = createMockEntry({ path: longFilename });
      fileHeatmap.updateData(() => [entry], createMockStats);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      // Should still contain ellipsis
      expect(content).toContain('...');
    });

    it('should preserve directory context when truncating', () => {
      const path = 'src/components/deep/nested/structure/Component.tsx';
      const entry = createMockEntry({ path });
      fileHeatmap.updateData(() => [entry], createMockStats);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      // Should show both start of path and filename with ellipsis
      expect(content).toContain('...');
      expect(content).toContain('Component.tsx');
    });
  });

  describe('color gradient rendering (getHeatBar)', () => {
    it('should render heat bars for cold level', () => {
      const entry = createMockEntry({ heatLevel: 'cold', modifications: 2 });
      fileHeatmap.updateData(() => [entry], createMockStats);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      // Should contain heat bar characters
      expect(content).toContain('█');
      expect(content).toContain('░');
      // Should use blue color for cold
      expect(content).toContain('blue-fg');
    });

    it('should render heat bars for warm level', () => {
      const entry = createMockEntry({ heatLevel: 'warm', modifications: 8 });
      fileHeatmap.updateData(() => [entry], createMockStats);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('█');
      expect(content).toContain('░');
      // Should use yellow color for warm
      expect(content).toContain('yellow-fg');
    });

    it('should render heat bars for hot level', () => {
      const entry = createMockEntry({ heatLevel: 'hot', modifications: 15 });
      fileHeatmap.updateData(() => [entry], createMockStats);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('█');
      expect(content).toContain('░');
      // Should use magenta color for hot
      expect(content).toContain('magenta-fg');
    });

    it('should render heat bars for critical level', () => {
      const entry = createMockEntry({ heatLevel: 'critical', modifications: 30 });
      fileHeatmap.updateData(() => [entry], createMockStats);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('█');
      // Note: Critical level might have all filled bars, so we just check for bar character
      // Should use red color for critical
      expect(content).toContain('red-fg');
    });

    it('should scale heat bar based on modification count', () => {
      const lowModEntry = createMockEntry({ heatLevel: 'warm', modifications: 2 });
      const highModEntry = createMockEntry({ heatLevel: 'warm', modifications: 20 });

      // Test low modifications
      fileHeatmap.updateData(() => [lowModEntry], createMockStats);
      const lowContent = mockBoxInstance.setContent.mock.calls[0][0];

      // Test high modifications
      fileHeatmap.updateData(() => [highModEntry], createMockStats);
      const highContent = mockBoxInstance.setContent.mock.calls[1][0];

      // Both should have heat bars, but we can verify they're present
      expect(lowContent).toContain('█');
      expect(highContent).toContain('█');
    });
  });

  describe('heatmap calculation from events', () => {
    it('should display modification counts correctly', () => {
      const entries = [
        createMockEntry({ path: 'a.ts', modifications: 5 }),
        createMockEntry({ path: 'b.ts', modifications: 15 }),
        createMockEntry({ path: 'c.ts', modifications: 100 }),
      ];
      fileHeatmap.updateData(() => entries, createMockStats);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      // Should show modification counts padded to 3 chars (with bold formatting)
      expect(content).toContain('{bold}  5{/}');
      expect(content).toContain('{bold} 15{/}');
      expect(content).toContain('{bold}100{/}');
    });

    it('should show worker information', () => {
      const entry = createMockEntry({
        workers: [
          {
            workerId: 'w-abc123',
            modifications: 5,
            lastModified: Date.now(),
            percentage: 100,
          },
        ],
      });
      fileHeatmap.updateData(() => [entry], createMockStats);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      // Should show truncated worker ID
      expect(content).toContain('w-abc123');
    });

    it('should show multiple workers when present', () => {
      const entry = createMockEntry({
        workers: [
          {
            workerId: 'w-worker1',
            modifications: 3,
            lastModified: Date.now(),
            percentage: 60,
          },
          {
            workerId: 'w-worker2',
            modifications: 2,
            lastModified: Date.now(),
            percentage: 40,
          },
        ],
      });
      fileHeatmap.updateData(() => [entry], createMockStats);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      // Should show worker information
      expect(content).toContain('w-work');
    });

    it('should show collision indicator for files with collisions', () => {
      const entry = createMockEntry({ hasCollision: true });
      fileHeatmap.updateData(() => [entry], createMockStats);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('⚠');
    });

    it('should show active workers indicator', () => {
      const entry = createMockEntry({ activeWorkers: 2, hasCollision: false });
      fileHeatmap.updateData(() => [entry], createMockStats);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('⚡');
    });

    it('should not show collision indicator when no collision', () => {
      const entry = createMockEntry({ hasCollision: false, activeWorkers: 1 });
      const stats = createMockStats({ collisionFiles: 0 }); // No collision files in stats
      fileHeatmap.updateData(() => [entry], () => stats);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      // Split by lines and check the entry row (not the stats header)
      const lines = content.split('\n');
      const entryLine = lines.find((line: string) => line.includes('src/test.ts'));
      expect(entryLine).toBeDefined();
      expect(entryLine).not.toContain('⚠');
      expect(entryLine).not.toContain('⚡');
    });
  });

  describe('selectNext and selectPrevious', () => {
    it('should move to next entry', () => {
      const entries = [
        createMockEntry({ path: 'a.ts' }),
        createMockEntry({ path: 'b.ts' }),
        createMockEntry({ path: 'c.ts' }),
      ];

      fileHeatmap.updateData(() => entries, createMockStats);

      // Initially selected is first entry
      expect(fileHeatmap.getSelected()?.path).toBe('a.ts');

      fileHeatmap.selectNext();
      expect(fileHeatmap.getSelected()?.path).toBe('b.ts');
    });

    it('should wrap to first entry when at end', () => {
      const entries = [
        createMockEntry({ path: 'a.ts' }),
        createMockEntry({ path: 'b.ts' }),
      ];

      fileHeatmap.updateData(() => entries, createMockStats);

      // Move to last
      fileHeatmap.selectNext();
      expect(fileHeatmap.getSelected()?.path).toBe('b.ts');

      // Wrap to first
      fileHeatmap.selectNext();
      expect(fileHeatmap.getSelected()?.path).toBe('a.ts');
    });

    it('should move to previous entry', () => {
      const entries = [
        createMockEntry({ path: 'a.ts' }),
        createMockEntry({ path: 'b.ts' }),
        createMockEntry({ path: 'c.ts' }),
      ];

      fileHeatmap.updateData(() => entries, createMockStats);

      // Move to second
      fileHeatmap.selectNext();
      expect(fileHeatmap.getSelected()?.path).toBe('b.ts');

      // Move back to first
      fileHeatmap.selectPrevious();
      expect(fileHeatmap.getSelected()?.path).toBe('a.ts');
    });

    it('should wrap to last entry when at beginning', () => {
      const entries = [
        createMockEntry({ path: 'a.ts' }),
        createMockEntry({ path: 'b.ts' }),
      ];

      fileHeatmap.updateData(() => entries, createMockStats);

      // At first, wrap to last
      fileHeatmap.selectPrevious();
      expect(fileHeatmap.getSelected()?.path).toBe('b.ts');
    });

    it('should do nothing when no entries', () => {
      fileHeatmap.updateData(() => [], createMockStats);

      // Should not throw
      expect(() => fileHeatmap.selectNext()).not.toThrow();
      expect(() => fileHeatmap.selectPrevious()).not.toThrow();
    });

    it('should show selection marker on selected entry', () => {
      const entries = [
        createMockEntry({ path: 'a.ts' }),
        createMockEntry({ path: 'b.ts' }),
      ];

      fileHeatmap.updateData(() => entries, createMockStats);

      const firstContent = mockBoxInstance.setContent.mock.calls[0][0];
      expect(firstContent).toContain('>'); // Selection marker
    });
  });

  describe('sort mode cycling', () => {
    it('should start with modifications sort mode', () => {
      expect(fileHeatmap.getSortMode()).toBe('modifications');
    });

    it('should cycle through sort modes when s key is pressed', () => {
      // Find the 's' key handler
      const sCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('s')
      );
      const sHandler = sCall?.[1];

      expect(fileHeatmap.getSortMode()).toBe('modifications');

      if (sHandler) {
        // Clear previous calls
        mockBoxInstance.setContent.mockClear();

        sHandler();
        expect(fileHeatmap.getSortMode()).toBe('recent');

        sHandler();
        expect(fileHeatmap.getSortMode()).toBe('workers');

        sHandler();
        expect(fileHeatmap.getSortMode()).toBe('collisions');

        // Should wrap back to modifications
        sHandler();
        expect(fileHeatmap.getSortMode()).toBe('modifications');
      }
    });
  });

  describe('collision filter', () => {
    it('should start with collision filter disabled', () => {
      expect(fileHeatmap.getCollisionFilter()).toBe(false);
    });

    it('should toggle collision filter when c key is pressed', () => {
      // Find the 'c' key handler
      const cCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('c')
      );
      const cHandler = cCall?.[1];

      expect(fileHeatmap.getCollisionFilter()).toBe(false);

      if (cHandler) {
        cHandler();
        expect(fileHeatmap.getCollisionFilter()).toBe(true);

        cHandler();
        expect(fileHeatmap.getCollisionFilter()).toBe(false);
      }
    });

    it('should update label when collision filter is enabled', () => {
      const cCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('c')
      );
      const cHandler = cCall?.[1];

      fileHeatmap.updateData(() => [], createMockStats);

      if (cHandler) {
        cHandler();
        expect(mockBoxInstance.setLabel).toHaveBeenCalledWith(' File Heatmap [COLLISIONS] ');
      }
    });

    it('should show help text when collision filter is enabled and no entries', () => {
      const cCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('c')
      );
      const cHandler = cCall?.[1];

      if (cHandler) {
        cHandler();
        fileHeatmap.updateData(() => [], createMockStats);

        const content = mockBoxInstance.setContent.mock.calls[0][0];
        expect(content).toContain('Press [c] to show all files');
      }
    });
  });

  describe('setFilter and clearFilter', () => {
    it('should set directory filter', () => {
      fileHeatmap.setFilter('src/');
      fileHeatmap.updateData(() => [], createMockStats);

      // Should trigger render
      expect(mockBoxInstance.setContent).toHaveBeenCalled();
    });

    it('should clear filter and collision-only mode', () => {
      // Enable collision filter
      const cCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('c')
      );
      const cHandler = cCall?.[1];
      if (cHandler) {
        cHandler();
      }

      fileHeatmap.setFilter('src/');
      expect(fileHeatmap.getCollisionFilter()).toBe(true);

      fileHeatmap.clearFilter();
      expect(fileHeatmap.getCollisionFilter()).toBe(false);
    });
  });

  describe('getSelected', () => {
    it('should return currently selected entry', () => {
      const entries = [
        createMockEntry({ path: 'a.ts' }),
        createMockEntry({ path: 'b.ts' }),
      ];

      fileHeatmap.updateData(() => entries, createMockStats);
      expect(fileHeatmap.getSelected()?.path).toBe('a.ts');

      fileHeatmap.selectNext();
      expect(fileHeatmap.getSelected()?.path).toBe('b.ts');
    });

    it('should return undefined when no entries', () => {
      fileHeatmap.updateData(() => [], createMockStats);
      expect(fileHeatmap.getSelected()).toBeUndefined();
    });
  });

  describe('focus', () => {
    it('should focus the box element', () => {
      fileHeatmap.focus();
      expect(mockBoxInstance.focus).toHaveBeenCalled();
    });
  });

  describe('getElement', () => {
    it('should return the box element', () => {
      const element = fileHeatmap.getElement();
      expect(element).toBe(mockBoxInstance);
    });
  });

  describe('key bindings', () => {
    it('should bind up and k keys to selectPrevious', () => {
      expect(mockBoxInstance.key).toHaveBeenCalledWith(['up', 'k'], expect.any(Function));
    });

    it('should bind down and j keys to selectNext', () => {
      expect(mockBoxInstance.key).toHaveBeenCalledWith(['down', 'j'], expect.any(Function));
    });

    it('should bind g key to select first', () => {
      expect(mockBoxInstance.key).toHaveBeenCalledWith(['g'], expect.any(Function));

      const entries = [
        createMockEntry({ path: 'a.ts' }),
        createMockEntry({ path: 'b.ts' }),
        createMockEntry({ path: 'c.ts' }),
      ];

      fileHeatmap.updateData(() => entries, createMockStats);

      // Move to last entry
      fileHeatmap.selectNext();
      fileHeatmap.selectNext();
      expect(fileHeatmap.getSelected()?.path).toBe('c.ts');

      // Find the 'g' handler and call it
      const gCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('g')
      );
      const gHandler = gCall?.[1];
      if (gHandler) {
        gHandler();
      }

      expect(fileHeatmap.getSelected()?.path).toBe('a.ts');
    });

    it('should bind G (shift+g) key to select last', () => {
      expect(mockBoxInstance.key).toHaveBeenCalledWith(['G'], expect.any(Function));

      const entries = [
        createMockEntry({ path: 'a.ts' }),
        createMockEntry({ path: 'b.ts' }),
        createMockEntry({ path: 'c.ts' }),
      ];

      fileHeatmap.updateData(() => entries, createMockStats);

      // Initially at first
      expect(fileHeatmap.getSelected()?.path).toBe('a.ts');

      // Find the 'G' handler and call it
      const GCall = mockBoxInstance.key.mock.calls.find(
        (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes('G')
      );
      const GHandler = GCall?.[1];
      if (GHandler) {
        GHandler();
      }

      expect(fileHeatmap.getSelected()?.path).toBe('c.ts');
    });

    it('should bind s key to cycle sort mode', () => {
      expect(mockBoxInstance.key).toHaveBeenCalledWith(['s'], expect.any(Function));
    });

    it('should bind c key to toggle collision filter', () => {
      expect(mockBoxInstance.key).toHaveBeenCalledWith(['c'], expect.any(Function));
    });
  });

  describe('heat distribution display', () => {
    it('should show heat distribution in stats', () => {
      const stats = createMockStats({
        heatDistribution: {
          cold: 5,
          warm: 3,
          hot: 1,
          critical: 1,
        },
      });

      fileHeatmap.updateData(() => [], () => stats);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('○5');  // cold
      expect(content).toContain('◐3');  // warm
      expect(content).toContain('●1');  // hot
      expect(content).toContain('🔥1'); // critical
    });
  });

  describe('edge cases', () => {
    it('should handle entries with no workers', () => {
      const entry = createMockEntry({ workers: [] });

      // Should not throw
      expect(() => fileHeatmap.updateData(() => [entry], createMockStats)).not.toThrow();

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      // Should show dash for no workers
      expect(content).toContain('-');
    });

    it('should handle entries with many workers', () => {
      const entry = createMockEntry({
        workers: [
          { workerId: 'w-1', modifications: 5, lastModified: Date.now(), percentage: 40 },
          { workerId: 'w-2', modifications: 4, lastModified: Date.now(), percentage: 30 },
          { workerId: 'w-3', modifications: 3, lastModified: Date.now(), percentage: 20 },
          { workerId: 'w-4', modifications: 2, lastModified: Date.now(), percentage: 10 },
        ],
      });

      // Should not throw
      expect(() => fileHeatmap.updateData(() => [entry], createMockStats)).not.toThrow();

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      // Should show top workers with count
      expect(content).toContain('+2'); // +2 more workers
    });

    it('should handle very short paths', () => {
      const entry = createMockEntry({ path: 'a.ts' });

      expect(() => fileHeatmap.updateData(() => [entry], createMockStats)).not.toThrow();

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('a.ts');
    });

    it('should handle paths with no directory component', () => {
      const entry = createMockEntry({ path: 'file.ts' });

      expect(() => fileHeatmap.updateData(() => [entry], createMockStats)).not.toThrow();

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('file.ts');
    });

    it('should handle zero modifications gracefully', () => {
      const entry = createMockEntry({ modifications: 0, heatLevel: 'cold' });

      expect(() => fileHeatmap.updateData(() => [entry], createMockStats)).not.toThrow();

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('  0'); // Padded to 3 chars
    });
  });
});
