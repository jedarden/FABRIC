/**
 * Tests for File Heatmap functionality
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryEventStore } from './store.js';
import { LogEvent } from './types.js';

describe('File Heatmap', () => {
  let store: InMemoryEventStore;

  beforeEach(() => {
    store = new InMemoryEventStore();
  });

  const createFileEvent = (
    path: string,
    worker: string,
    tool: string = 'Edit',
    ts: number = Date.now()
  ): LogEvent => ({
    ts,
    worker,
    level: 'info',
    msg: `Modifying ${path}`,
    path,
    tool,
  });

  describe('getFileHeatmap', () => {
    it('should return empty array when no file modifications', () => {
      const heatmap = store.getFileHeatmap();
      expect(heatmap).toHaveLength(0);
    });

    it('should track single file modification', () => {
      store.add(createFileEvent('/src/index.ts', 'w-abc123'));

      const heatmap = store.getFileHeatmap();
      expect(heatmap).toHaveLength(1);
      expect(heatmap[0].path).toBe('/src/index.ts');
      expect(heatmap[0].modifications).toBe(1);
      expect(heatmap[0].heatLevel).toBe('cold');
    });

    it('should track multiple modifications to same file', () => {
      const now = Date.now();
      store.add(createFileEvent('/src/index.ts', 'w-abc123', 'Edit', now));
      store.add(createFileEvent('/src/index.ts', 'w-abc123', 'Edit', now + 1000));
      store.add(createFileEvent('/src/index.ts', 'w-abc123', 'Edit', now + 2000));

      const heatmap = store.getFileHeatmap();
      expect(heatmap).toHaveLength(1);
      expect(heatmap[0].modifications).toBe(3);
      expect(heatmap[0].heatLevel).toBe('warm');
    });

    it('should track modifications by multiple workers', () => {
      const now = Date.now();
      store.add(createFileEvent('/src/index.ts', 'w-abc123', 'Edit', now));
      store.add(createFileEvent('/src/index.ts', 'w-def456', 'Edit', now + 1000));
      store.add(createFileEvent('/src/index.ts', 'w-ghi789', 'Edit', now + 2000));

      const heatmap = store.getFileHeatmap();
      expect(heatmap).toHaveLength(1);
      expect(heatmap[0].workers).toHaveLength(3);
      expect(heatmap[0].workers.map(w => w.workerId)).toContain('w-abc123');
      expect(heatmap[0].workers.map(w => w.workerId)).toContain('w-def456');
      expect(heatmap[0].workers.map(w => w.workerId)).toContain('w-ghi789');
    });

    it('should ignore non-modification tools', () => {
      store.add(createFileEvent('/src/index.ts', 'w-abc123', 'Read'));
      store.add(createFileEvent('/src/index.ts', 'w-abc123', 'Bash'));

      const heatmap = store.getFileHeatmap();
      expect(heatmap).toHaveLength(0);
    });

    it('should track Edit, Write, and NotebookEdit tools', () => {
      store.add(createFileEvent('/src/a.ts', 'w-abc123', 'Edit'));
      store.add(createFileEvent('/src/b.ts', 'w-abc123', 'Write'));
      store.add(createFileEvent('/src/c.ipynb', 'w-abc123', 'NotebookEdit'));

      const heatmap = store.getFileHeatmap();
      expect(heatmap).toHaveLength(3);
    });

    it('should calculate correct heat levels', () => {
      const now = Date.now();
      for (let i = 0; i < 15; i++) {
        store.add(createFileEvent('/src/hot.ts', 'w-abc123', 'Edit', now + i * 1000));
      }
      for (let i = 0; i < 5; i++) {
        store.add(createFileEvent('/src/warm.ts', 'w-abc123', 'Edit', now + i * 1000));
      }

      const heatmap = store.getFileHeatmap();
      const hotFile = heatmap.find(e => e.path === '/src/hot.ts');
      const warmFile = heatmap.find(e => e.path === '/src/warm.ts');

      expect(hotFile?.heatLevel).toBe('critical');
      expect(warmFile?.heatLevel).toBe('warm');
    });
  });

  describe('getFileHeatmap options', () => {
    beforeEach(() => {
      const now = Date.now();
      // Create files in different directories
      store.add(createFileEvent('/src/index.ts', 'w-abc123', 'Edit', now));
      store.add(createFileEvent('/src/utils.ts', 'w-abc123', 'Edit', now + 1000));
      store.add(createFileEvent('/test/test.ts', 'w-abc123', 'Edit', now + 2000));
      store.add(createFileEvent('/lib/main.ts', 'w-abc123', 'Edit', now + 3000));
    });

    it('should filter by directory', () => {
      const heatmap = store.getFileHeatmap({ directoryFilter: '/src' });
      expect(heatmap).toHaveLength(2);
      expect(heatmap.every(e => e.path.startsWith('/src'))).toBe(true);
    });

    it('should respect minModifications filter', () => {
      // Add more modifications to one file
      const now = Date.now();
      store.add(createFileEvent('/src/index.ts', 'w-abc123', 'Edit', now + 4000));
      store.add(createFileEvent('/src/index.ts', 'w-abc123', 'Edit', now + 5000));

      const heatmap = store.getFileHeatmap({ minModifications: 2 });
      expect(heatmap).toHaveLength(1);
      expect(heatmap[0].path).toBe('/src/index.ts');
    });

    it('should respect maxEntries limit', () => {
      const heatmap = store.getFileHeatmap({ maxEntries: 2 });
      expect(heatmap).toHaveLength(2);
    });

    it('should sort by modifications (default)', () => {
      // Add more modifications to index.ts
      const now = Date.now();
      store.add(createFileEvent('/src/index.ts', 'w-abc123', 'Edit', now + 4000));
      store.add(createFileEvent('/src/index.ts', 'w-abc123', 'Edit', now + 5000));

      const heatmap = store.getFileHeatmap({ sortBy: 'modifications' });
      expect(heatmap[0].path).toBe('/src/index.ts');
    });

    it('should sort by recent', () => {
      const heatmap = store.getFileHeatmap({ sortBy: 'recent' });
      expect(heatmap[0].path).toBe('/lib/main.ts'); // Last modified
    });
  });

  describe('getFileHeatmapStats', () => {
    it('should return empty stats when no modifications', () => {
      const stats = store.getFileHeatmapStats();
      expect(stats.totalFiles).toBe(0);
      expect(stats.totalModifications).toBe(0);
    });

    it('should calculate correct statistics', () => {
      const now = Date.now();
      store.add(createFileEvent('/src/a.ts', 'w-abc123', 'Edit', now));
      store.add(createFileEvent('/src/a.ts', 'w-def456', 'Edit', now + 1000));
      store.add(createFileEvent('/src/b.ts', 'w-abc123', 'Edit', now + 2000));

      const stats = store.getFileHeatmapStats();
      expect(stats.totalFiles).toBe(2);
      expect(stats.totalModifications).toBe(3);
      expect(stats.avgModificationsPerFile).toBe(1.5);
    });

    it('should calculate heat distribution', () => {
      const now = Date.now();
      // Create 1 cold file (1 mod)
      store.add(createFileEvent('/src/cold.ts', 'w-abc123', 'Edit', now));
      // Create 1 warm file (3 mods)
      for (let i = 0; i < 3; i++) {
        store.add(createFileEvent('/src/warm.ts', 'w-abc123', 'Edit', now + i * 1000));
      }
      // Create 1 hot file (8 mods)
      for (let i = 0; i < 8; i++) {
        store.add(createFileEvent('/src/hot.ts', 'w-abc123', 'Edit', now + i * 1000));
      }
      // Create 1 critical file (15 mods)
      for (let i = 0; i < 15; i++) {
        store.add(createFileEvent('/src/critical.ts', 'w-abc123', 'Edit', now + i * 1000));
      }

      const stats = store.getFileHeatmapStats();
      expect(stats.heatDistribution.cold).toBe(1);
      expect(stats.heatDistribution.warm).toBe(1);
      expect(stats.heatDistribution.hot).toBe(1);
      expect(stats.heatDistribution.critical).toBe(1);
    });
  });

  describe('getWorkerFiles', () => {
    it('should return files modified by specific worker', () => {
      const now = Date.now();
      store.add(createFileEvent('/src/a.ts', 'w-abc123', 'Edit', now));
      store.add(createFileEvent('/src/b.ts', 'w-abc123', 'Edit', now + 1000));
      store.add(createFileEvent('/src/c.ts', 'w-def456', 'Edit', now + 2000));

      const workerFiles = store.getWorkerFiles('w-abc123');
      expect(workerFiles).toHaveLength(2);
      expect(workerFiles.map(f => f.path)).toContain('/src/a.ts');
      expect(workerFiles.map(f => f.path)).toContain('/src/b.ts');
    });

    it('should return empty array for unknown worker', () => {
      store.add(createFileEvent('/src/a.ts', 'w-abc123', 'Edit'));
      const workerFiles = store.getWorkerFiles('w-unknown');
      expect(workerFiles).toHaveLength(0);
    });
  });

  describe('getCollisionRiskFiles', () => {
    it('should identify high-risk files with multiple workers', () => {
      const now = Date.now();
      // Create a high-risk file with 4 workers
      store.add(createFileEvent('/src/hot.ts', 'w-abc123', 'Edit', now));
      store.add(createFileEvent('/src/hot.ts', 'w-def456', 'Edit', now + 1000));
      store.add(createFileEvent('/src/hot.ts', 'w-ghi789', 'Edit', now + 2000));
      store.add(createFileEvent('/src/hot.ts', 'w-jkl012', 'Edit', now + 3000));

      // Create a lower-risk file with 2 workers
      store.add(createFileEvent('/src/warm.ts', 'w-abc123', 'Edit', now));
      store.add(createFileEvent('/src/warm.ts', 'w-def456', 'Edit', now + 1000));

      const riskFiles = store.getCollisionRiskFiles(3);
      expect(riskFiles).toHaveLength(1);
      expect(riskFiles[0].path).toBe('/src/hot.ts');
    });

    it('should return empty array when no high-risk files', () => {
      store.add(createFileEvent('/src/a.ts', 'w-abc123', 'Edit'));
      store.add(createFileEvent('/src/b.ts', 'w-abc123', 'Edit'));

      const riskFiles = store.getCollisionRiskFiles(3);
      expect(riskFiles).toHaveLength(0);
    });
  });

  describe('worker contribution percentages', () => {
    it('should calculate correct percentages', () => {
      const now = Date.now();
      store.add(createFileEvent('/src/index.ts', 'w-abc123', 'Edit', now));
      store.add(createFileEvent('/src/index.ts', 'w-abc123', 'Edit', now + 1000));
      store.add(createFileEvent('/src/index.ts', 'w-abc123', 'Edit', now + 2000));
      store.add(createFileEvent('/src/index.ts', 'w-def456', 'Edit', now + 3000));

      const heatmap = store.getFileHeatmap();
      const abc123 = heatmap[0].workers.find(w => w.workerId === 'w-abc123');
      const def456 = heatmap[0].workers.find(w => w.workerId === 'w-def456');

      expect(abc123?.percentage).toBe(75);
      expect(def456?.percentage).toBe(25);
    });
  });
});
