/**
 * Tests for FileHeatmap Component
 *
 * Tests the file heatmap display with mocked blessed elements.
 * Tests heatmap calculation, color gradient rendering, and file path truncation.
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import blessed from 'blessed';

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
import { getHeatColor } from '../utils/colors.js';
import { FileHeatmapEntry, FileHeatmapStats, HeatmapOptions, HeatLevel, FileAnomaly } from '../../types.js';

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
    const blessedMock = blessed as unknown as { box: Mock };
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
      const blessedMock = blessed as unknown as { box: Mock };
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

  // Helper shared by the behavior suites below: invoke a bound key handler
  const getKeyHandler = (k: string): (() => void) | undefined => {
    const call = mockBoxInstance.key.mock.calls.find(
      (call: unknown[]) => Array.isArray(call?.[0]) && call[0].includes(k)
    );
    return call?.[1] as () => void;
  };

  describe('anomaly filter (a key)', () => {
    it('should bind a key to toggle anomaly view', () => {
      expect(mockBoxInstance.key).toHaveBeenCalledWith(['a'], expect.any(Function));
    });

    it('should start with anomaly filter disabled', () => {
      expect(fileHeatmap.getAnomalyFilter()).toBe(false);
    });

    it('should toggle anomaly filter when a key is pressed', () => {
      const aHandler = getKeyHandler('a');

      aHandler?.();
      expect(fileHeatmap.getAnomalyFilter()).toBe(true);

      aHandler?.();
      expect(fileHeatmap.getAnomalyFilter()).toBe(false);
    });

    it('should show [ANOMALIES] label when anomaly filter is enabled', () => {
      const aHandler = getKeyHandler('a');

      aHandler?.();
      fileHeatmap.updateData(() => [], createMockStats);

      expect(mockBoxInstance.setLabel).toHaveBeenCalledWith(' File Heatmap [ANOMALIES] ');
    });

    it('should allow only one of collisions/anomalies mode at a time', () => {
      const aHandler = getKeyHandler('a');
      const cHandler = getKeyHandler('c');

      // Enabling anomalies resets collision mode
      cHandler?.();
      expect(fileHeatmap.getCollisionFilter()).toBe(true);
      aHandler?.();
      expect(fileHeatmap.getAnomalyFilter()).toBe(true);
      expect(fileHeatmap.getCollisionFilter()).toBe(false);

      // And enabling collisions resets anomaly mode
      cHandler?.();
      expect(fileHeatmap.getCollisionFilter()).toBe(true);
      expect(fileHeatmap.getAnomalyFilter()).toBe(false);
    });
  });

  describe('anomaly view rendering', () => {
    const makeAnomaly = (overrides: Partial<FileAnomaly> = {}): FileAnomaly => ({
      path: 'src/config/settings.yaml',
      type: 'config_modification',
      severity: 'warning',
      message: 'Configuration file modified outside of config-related task',
      detectedAt: Date.now(),
      details: {},
      ...overrides,
    });

    it('should show the anomaly summary section when anomalies exist', () => {
      const anomalies = [makeAnomaly()];
      fileHeatmap.updateData(() => [createMockEntry()], createMockStats, () => anomalies);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('Unexpected Activity');
      expect(content).toContain('settings.yaml');
    });

    it('should not show the anomaly summary when no anomalies are provided', () => {
      fileHeatmap.updateData(() => [createMockEntry()], createMockStats, () => []);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).not.toContain('Unexpected Activity');
    });

    it('should list anomalies in anomalies-only mode', () => {
      getKeyHandler('a')?.();

      const anomalies = [
        makeAnomaly({ path: 'src/config/settings.yaml' }),
        makeAnomaly({ path: 'deploy/.env', type: 'sensitive_file', severity: 'critical' }),
      ];
      fileHeatmap.updateData(() => [], createMockStats, () => anomalies);

      // The [a] handler renders once before updateData lands; check the latest render
      const calls = mockBoxInstance.setContent.mock.calls;
      const content = calls[calls.length - 1][0];
      expect(content).toContain('Unexpected Activity');
      expect(content).toContain('CONFIG');
      expect(content).toContain('SENSITIVE');
      // The file list is replaced by the anomaly list in this mode
      expect(content).not.toContain('No file modifications detected');
    });

    it('should show a clear message when anomalies-only mode has no anomalies', () => {
      getKeyHandler('a')?.();
      fileHeatmap.updateData(() => [], createMockStats, () => []);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('No anomalies detected');
      expect(content).toContain('Press [a] to return to file view');
    });

    it('should navigate anomalies in anomalies-only mode', () => {
      getKeyHandler('a')?.();

      const anomalies = [
        makeAnomaly({ path: 'a.yaml' }),
        makeAnomaly({ path: 'b.yaml' }),
      ];
      fileHeatmap.updateData(() => [], createMockStats, () => anomalies);

      expect(fileHeatmap.getSelectedAnomaly()?.path).toBe('a.yaml');

      fileHeatmap.selectNext();
      expect(fileHeatmap.getSelectedAnomaly()?.path).toBe('b.yaml');

      fileHeatmap.selectPrevious();
      expect(fileHeatmap.getSelectedAnomaly()?.path).toBe('a.yaml');
    });

    it('should cap the summary section to three anomalies with an overflow hint', () => {
      const anomalies = [
        makeAnomaly({ path: '1.yaml' }),
        makeAnomaly({ path: '2.yaml' }),
        makeAnomaly({ path: '3.yaml' }),
        makeAnomaly({ path: '4.yaml' }),
        makeAnomaly({ path: '5.yaml' }),
      ];
      fileHeatmap.updateData(() => [createMockEntry()], createMockStats, () => anomalies);

      const content = mockBoxInstance.setContent.mock.calls[0][0];
      expect(content).toContain('+2 more (press [a] to view)');
    });
  });

  describe('data getter wiring (sort/filter options)', () => {
    it('should request entries sorted by the current sort mode', () => {
      const getHeatmap = vi.fn(() => []);
      fileHeatmap.updateData(getHeatmap, createMockStats);

      expect(getHeatmap).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'modifications' })
      );

      getKeyHandler('s')?.();
      fileHeatmap.updateData(getHeatmap, createMockStats);
      expect(getHeatmap).toHaveBeenLastCalledWith(
        expect.objectContaining({ sortBy: 'recent' })
      );
    });

    it('should request collision-filtered entries when collisions-only is on', () => {
      getKeyHandler('c')?.();

      const getHeatmap = vi.fn(() => []);
      fileHeatmap.updateData(getHeatmap, createMockStats);

      expect(getHeatmap).toHaveBeenLastCalledWith(
        expect.objectContaining({ collisionsOnly: true })
      );
    });

    it('should pass the directory filter to the getter', () => {
      fileHeatmap.setFilter('src/auth');

      const getHeatmap = vi.fn(() => []);
      fileHeatmap.updateData(getHeatmap, createMockStats);

      expect(getHeatmap).toHaveBeenLastCalledWith(
        expect.objectContaining({ directoryFilter: 'src/auth' })
      );
    });

    it('should pass an undefined directory filter when none is set', () => {
      const getHeatmap = vi.fn(() => []);
      fileHeatmap.updateData(getHeatmap, createMockStats);

      expect(getHeatmap).toHaveBeenLastCalledWith(
        expect.objectContaining({ directoryFilter: undefined })
      );
    });

    it('should fetch anomalies when an anomaly getter is provided', () => {
      const getAnomalies = vi.fn(() => []);
      fileHeatmap.updateData(() => [], createMockStats, getAnomalies);

      expect(getAnomalies).toHaveBeenCalled();
    });
  });

  describe('sort mode header display', () => {
    it('should show the active sort mode in the stats header', () => {
      fileHeatmap.updateData(() => [createMockEntry()], createMockStats);

      const calls = mockBoxInstance.setContent.mock.calls;
      expect(calls[0][0]).toContain('Sort: modifications');

      getKeyHandler('s')?.();
      const content = calls[calls.length - 1][0];
      expect(content).toContain('Sort: recent');
    });
  });

  // --- interaction and rendering regression coverage (fabric-9cf938df) ---

  // Latest content handed to the box (key handlers render mid-test, so the
  // first call is not always the interesting one).
  const lastRenderedContent = (): string => {
    const calls = mockBoxInstance.setContent.mock.calls;
    return calls[calls.length - 1][0];
  };

  // The rendered row for a given path (paths never appear in header/footer).
  const rowForPath = (content: string, path: string): string | undefined =>
    content.split('\n').find((line: string) => line.includes(path));

  // Filled/empty cell counts of the heat bar rendered for a heat level.
  // The color comes from getHeatColor so the assertion tracks the active
  // theme; the level icon shares the color tag, so require at least one
  // filled cell.
  const heatBarCells = (content: string, level: HeatLevel): { filled: number; empty: number } => {
    const match = content.match(new RegExp(`\\{${getHeatColor(level)}-fg\\}(█+)\\{/\\}(░*)`));
    return { filled: match ? match[1].length : 0, empty: match ? match[2].length : 0 };
  };

  describe('heat bar rendering (exact cell counts per level)', () => {
    it('renders 1 filled cell for cold at the 1-modification boundary', () => {
      fileHeatmap.updateData(
        () => [createMockEntry({ heatLevel: 'cold', modifications: 1 })],
        createMockStats
      );
      expect(heatBarCells(lastRenderedContent(), 'cold')).toEqual({ filled: 1, empty: 9 });
    });

    it('renders 2 filled cells for cold at the 2-modification boundary', () => {
      fileHeatmap.updateData(
        () => [createMockEntry({ heatLevel: 'cold', modifications: 2 })],
        createMockStats
      );
      expect(heatBarCells(lastRenderedContent(), 'cold')).toEqual({ filled: 2, empty: 8 });
    });

    it('renders 3 filled cells for warm at the 3-modification boundary', () => {
      fileHeatmap.updateData(
        () => [createMockEntry({ heatLevel: 'warm', modifications: 3 })],
        createMockStats
      );
      expect(heatBarCells(lastRenderedContent(), 'warm')).toEqual({ filled: 3, empty: 7 });
    });

    it('caps warm at 4 filled cells at the top of its band', () => {
      fileHeatmap.updateData(
        () => [createMockEntry({ heatLevel: 'warm', modifications: 5 })],
        createMockStats
      );
      expect(heatBarCells(lastRenderedContent(), 'warm')).toEqual({ filled: 4, empty: 6 });
    });

    it('caps hot at 7 filled cells across its whole band', () => {
      fileHeatmap.updateData(
        () => [createMockEntry({ heatLevel: 'hot', modifications: 6 })],
        createMockStats
      );
      expect(heatBarCells(lastRenderedContent(), 'hot')).toEqual({ filled: 7, empty: 3 });

      fileHeatmap.updateData(
        () => [createMockEntry({ heatLevel: 'hot', modifications: 10 })],
        createMockStats
      );
      expect(heatBarCells(lastRenderedContent(), 'hot')).toEqual({ filled: 7, empty: 3 });
    });

    it('caps critical at 10 filled cells with no empty cells left', () => {
      fileHeatmap.updateData(
        () => [createMockEntry({ heatLevel: 'critical', modifications: 11 })],
        createMockStats
      );
      expect(heatBarCells(lastRenderedContent(), 'critical')).toEqual({ filled: 10, empty: 0 });

      fileHeatmap.updateData(
        () => [createMockEntry({ heatLevel: 'critical', modifications: 100 })],
        createMockStats
      );
      expect(heatBarCells(lastRenderedContent(), 'critical')).toEqual({ filled: 10, empty: 0 });
    });
  });

  describe('entry row rendering (level icons and collision indicators)', () => {
    it('renders the heat icon for each level on its entry row', () => {
      const levels: Array<[HeatLevel, string]> = [
        ['cold', '○'],
        ['warm', '◐'],
        ['hot', '●'],
        ['critical', '🔥'],
      ];
      for (const [level, icon] of levels) {
        fileHeatmap.updateData(
          () => [createMockEntry({ path: 'row-icon.ts', heatLevel: level })],
          createMockStats
        );
        expect(rowForPath(lastRenderedContent(), 'row-icon.ts')).toContain(icon);
      }
    });

    it('gives the collision warning precedence over the active-workers bolt', () => {
      fileHeatmap.updateData(
        () => [createMockEntry({ path: 'both.ts', hasCollision: true, activeWorkers: 3 })],
        createMockStats
      );
      const row = rowForPath(lastRenderedContent(), 'both.ts');
      expect(row).toContain('{red-fg}⚠{/}');
      expect(row).not.toContain('⚡');
    });

    it('renders the potential-collision bolt in yellow for multi-worker files', () => {
      fileHeatmap.updateData(
        () => [createMockEntry({ path: 'bolt.ts', hasCollision: false, activeWorkers: 2 })],
        createMockStats
      );
      expect(rowForPath(lastRenderedContent(), 'bolt.ts')).toContain('{yellow-fg}⚡{/}');
    });
  });

  describe('worker tracking display', () => {
    it('truncates a long single worker id to 8 characters', () => {
      fileHeatmap.updateData(
        () => [
          createMockEntry({
            path: 'single-worker.ts',
            workers: [
              { workerId: 'claude-code-glm-roam-21', modifications: 5, lastModified: Date.now(), percentage: 100 },
            ],
          }),
        ],
        createMockStats
      );
      const row = rowForPath(lastRenderedContent(), 'single-worker.ts');
      expect(row).toContain('claude-c');
      expect(row).not.toContain('claude-code-glm-roam-21');
    });

    it('shows 6-character prefixes for two workers without an overflow count', () => {
      fileHeatmap.updateData(
        () => [
          createMockEntry({
            path: 'two-workers.ts',
            workers: [
              { workerId: 'alpha-worker-one', modifications: 3, lastModified: Date.now(), percentage: 60 },
              { workerId: 'bravo-worker-two', modifications: 2, lastModified: Date.now(), percentage: 40 },
            ],
          }),
        ],
        createMockStats
      );
      const row = rowForPath(lastRenderedContent(), 'two-workers.ts');
      expect(row).toContain('alpha-, bravo-');
      expect(row).not.toMatch(/\+\d/);
    });

    it('shows the +N overflow count for three or more workers', () => {
      const workers = ['alpha-one', 'bravo-two', 'charlie-three'].map((workerId, i) => ({
        workerId,
        modifications: 3 - i,
        lastModified: Date.now(),
        percentage: 40 - i * 10,
      }));
      fileHeatmap.updateData(
        () => [createMockEntry({ path: 'many-workers.ts', workers })],
        createMockStats
      );
      expect(rowForPath(lastRenderedContent(), 'many-workers.ts')).toContain('+1');
    });
  });

  describe('stats header mode labels', () => {
    it('omits filter labels in the default mode', () => {
      fileHeatmap.updateData(() => [createMockEntry()], createMockStats);
      const content = lastRenderedContent();
      expect(content).not.toContain('Collisions Only');
      expect(content).not.toContain('Anomalies Only');
    });

    it('shows the collisions-only label when c is toggled on', () => {
      getKeyHandler('c')?.();
      fileHeatmap.updateData(() => [createMockEntry()], createMockStats);
      expect(lastRenderedContent()).toContain('| Collisions Only');
    });

    it('shows the anomalies-only label (and not collisions) when a is toggled on', () => {
      getKeyHandler('a')?.();
      fileHeatmap.updateData(() => [createMockEntry()], createMockStats);
      const content = lastRenderedContent();
      expect(content).toContain('| Anomalies Only');
      expect(content).not.toContain('Collisions Only');
    });

    it('shows the live anomaly count in the header', () => {
      const anomalies: FileAnomaly[] = [
        { path: 'a.yaml', type: 'config_modification', severity: 'warning', message: 'm', detectedAt: Date.now(), details: {} },
        { path: 'b.yaml', type: 'sensitive_file', severity: 'critical', message: 'm', detectedAt: Date.now(), details: {} },
      ];
      fileHeatmap.updateData(() => [createMockEntry()], createMockStats, () => anomalies);
      expect(lastRenderedContent()).toContain('⚠ 2 anomalies');
    });
  });

  describe('anomaly summary suppression', () => {
    it('hides the Unexpected Activity section while collisions-only is active', () => {
      const anomalies: FileAnomaly[] = [
        { path: 'a.yaml', type: 'config_modification', severity: 'warning', message: 'm', detectedAt: Date.now(), details: {} },
      ];
      fileHeatmap.updateData(() => [createMockEntry()], createMockStats, () => anomalies);
      expect(lastRenderedContent()).toContain('Unexpected Activity');

      getKeyHandler('c')?.();
      const content = lastRenderedContent();
      expect(content).not.toContain('Unexpected Activity');
      // The file list itself remains visible in collisions-only mode
      expect(rowForPath(content, 'src/test.ts')).toBeDefined();
    });
  });

  describe('footer help lines', () => {
    it('renders the sort/collisions/anomalies/scroll hints in the file view', () => {
      fileHeatmap.updateData(() => [createMockEntry()], createMockStats);
      expect(lastRenderedContent()).toContain('[s] Sort  [c] Collisions  [a] Anomalies  [j/k] Scroll');
    });

    it('renders the back-to-files hint in a populated anomaly view', () => {
      getKeyHandler('a')?.();
      const anomalies: FileAnomaly[] = [
        { path: 'a.yaml', type: 'config_modification', severity: 'warning', message: 'm', detectedAt: Date.now(), details: {} },
      ];
      fileHeatmap.updateData(() => [], createMockStats, () => anomalies);
      expect(lastRenderedContent()).toContain('[a] Back to files  [j/k] Scroll');
    });
  });

  describe('selection marker rendering', () => {
    const threeEntries = () => [
      createMockEntry({ path: 'first-file.ts' }),
      createMockEntry({ path: 'middle-file.ts' }),
      createMockEntry({ path: 'last-file.ts' }),
    ];

    it('marks exactly the selected row', () => {
      fileHeatmap.updateData(threeEntries, createMockStats);
      const content = lastRenderedContent();
      expect(rowForPath(content, 'first-file.ts')).toMatch(/^>/);
      expect(rowForPath(content, 'middle-file.ts')).toMatch(/^ /);
      expect(rowForPath(content, 'last-file.ts')).toMatch(/^ /);
    });

    it('moves the marker to the newly selected row on j/k', () => {
      fileHeatmap.updateData(threeEntries, createMockStats);
      fileHeatmap.selectNext();
      const content = lastRenderedContent();
      expect(rowForPath(content, 'first-file.ts')).toMatch(/^ /);
      expect(rowForPath(content, 'middle-file.ts')).toMatch(/^>/);
    });

    it('jumps the marker to the last row on G', () => {
      fileHeatmap.updateData(threeEntries, createMockStats);
      getKeyHandler('G')?.();
      const content = lastRenderedContent();
      expect(rowForPath(content, 'last-file.ts')).toMatch(/^>/);
      expect(rowForPath(content, 'first-file.ts')).toMatch(/^ /);
    });

    it('keeps the marker on the same position across a live refresh', () => {
      fileHeatmap.updateData(threeEntries, createMockStats);
      fileHeatmap.selectNext();

      const refreshedEntries = [
        createMockEntry({ path: 'fresh-a.ts' }),
        createMockEntry({ path: 'fresh-b.ts' }),
        createMockEntry({ path: 'fresh-c.ts' }),
      ];
      fileHeatmap.updateData(() => refreshedEntries, createMockStats);

      expect(fileHeatmap.getSelected()?.path).toBe('fresh-b.ts');
      expect(rowForPath(lastRenderedContent(), 'fresh-b.ts')).toMatch(/^>/);
    });
  });

  describe('anomaly navigation wrap-around and clamping', () => {
    const makeAnomaly = (path: string): FileAnomaly => ({
      path,
      type: 'config_modification',
      severity: 'warning',
      message: 'm',
      detectedAt: Date.now(),
      details: {},
    });

    const enterAnomalyModeWith = (paths: string[]): void => {
      getKeyHandler('a')?.();
      fileHeatmap.updateData(() => [], createMockStats, () => paths.map(makeAnomaly));
    };

    it('wraps selectNext from the last anomaly back to the first', () => {
      enterAnomalyModeWith(['a.yaml', 'b.yaml']);
      fileHeatmap.selectNext();
      expect(fileHeatmap.getSelectedAnomaly()?.path).toBe('b.yaml');
      fileHeatmap.selectNext();
      expect(fileHeatmap.getSelectedAnomaly()?.path).toBe('a.yaml');
    });

    it('wraps selectPrevious from the first anomaly to the last', () => {
      enterAnomalyModeWith(['a.yaml', 'b.yaml']);
      fileHeatmap.selectPrevious();
      expect(fileHeatmap.getSelectedAnomaly()?.path).toBe('b.yaml');
    });

    it('does nothing (and does not throw) with zero anomalies', () => {
      enterAnomalyModeWith([]);
      expect(() => {
        fileHeatmap.selectNext();
        fileHeatmap.selectPrevious();
      }).not.toThrow();
      expect(fileHeatmap.getSelectedAnomaly()).toBeUndefined();
    });

    it('clamps the anomaly selection when the list shrinks on refresh', () => {
      enterAnomalyModeWith(['a.yaml', 'b.yaml', 'c.yaml']);
      fileHeatmap.selectNext();
      fileHeatmap.selectNext();
      expect(fileHeatmap.getSelectedAnomaly()?.path).toBe('c.yaml');

      fileHeatmap.updateData(() => [], createMockStats, () => [makeAnomaly('only.yaml')]);
      expect(fileHeatmap.getSelectedAnomaly()?.path).toBe('only.yaml');
    });
  });

  describe('clearFilter resets every filter axis', () => {
    it('clears anomaly mode, collision mode, and the directory filter together', () => {
      getKeyHandler('a')?.();
      expect(fileHeatmap.getAnomalyFilter()).toBe(true);

      fileHeatmap.setFilter('src/auth');
      fileHeatmap.clearFilter();

      expect(fileHeatmap.getAnomalyFilter()).toBe(false);
      expect(fileHeatmap.getCollisionFilter()).toBe(false);

      const getHeatmap = vi.fn(() => []);
      fileHeatmap.updateData(getHeatmap, createMockStats);
      expect(getHeatmap).toHaveBeenLastCalledWith(
        expect.objectContaining({ directoryFilter: undefined, collisionsOnly: false })
      );
    });

    it('treats an explicitly empty filter as no filter', () => {
      fileHeatmap.setFilter('src/');
      fileHeatmap.setFilter('');

      const getHeatmap = vi.fn(() => []);
      fileHeatmap.updateData(getHeatmap, createMockStats);
      expect(getHeatmap).toHaveBeenLastCalledWith(
        expect.objectContaining({ directoryFilter: undefined })
      );
    });
  });

  describe('data getter contract', () => {
    it('passes the complete default option set to the heatmap getter', () => {
      const getHeatmap = vi.fn(() => []);
      fileHeatmap.updateData(getHeatmap, createMockStats);

      expect(getHeatmap).toHaveBeenCalledWith({
        sortBy: 'modifications',
        maxEntries: 100,
        collisionsOnly: false,
        directoryFilter: undefined,
      });
    });

    it('calls the anomaly getter with empty options', () => {
      const getAnomalies = vi.fn(() => []);
      fileHeatmap.updateData(() => [], createMockStats, getAnomalies);

      expect(getAnomalies).toHaveBeenCalledWith({});
    });
  });
});
