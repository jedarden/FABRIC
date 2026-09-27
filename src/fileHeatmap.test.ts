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

  describe('heatmap stats aggregates (deterministic values)', () => {
    it('names the directory with the most modifications as mostActiveDirectory', () => {
      const now = Date.now();
      // /src accumulates 4 modifications across two files, /lib only 1
      store.add(createFileEvent('/src/a.ts', 'w-aaa', 'Edit', now));
      store.add(createFileEvent('/src/a.ts', 'w-aaa', 'Edit', now + 1000));
      store.add(createFileEvent('/src/b.ts', 'w-aaa', 'Edit', now + 2000));
      store.add(createFileEvent('/src/b.ts', 'w-aaa', 'Edit', now + 3000));
      store.add(createFileEvent('/lib/c.ts', 'w-aaa', 'Edit', now + 4000));

      expect(store.getFileHeatmapStats().mostActiveDirectory).toBe('/src');
    });

    it('falls back to "/" for the most active directory when no files exist', () => {
      expect(store.getFileHeatmapStats().mostActiveDirectory).toBe('/');
    });

    it('counts files with currently-active workers in activeFiles', () => {
      const now = Date.now();
      // Two workers on one file (spaced beyond the collision window) plus a
      // single-worker file: both entries have activeWorkers > 0.
      store.add(createFileEvent('/src/shared.ts', 'w-aaa', 'Edit', now));
      store.add(createFileEvent('/src/shared.ts', 'w-bbb', 'Edit', now + 10000));
      store.add(createFileEvent('/src/solo.ts', 'w-ccc', 'Edit', now + 20000));

      const stats = store.getFileHeatmapStats();
      expect(stats.activeFiles).toBe(2);
    });

    it('reports zero active files for an empty store', () => {
      expect(store.getFileHeatmapStats().activeFiles).toBe(0);
    });

    it('grows aggregate totals as new files and events arrive', () => {
      store.add(createFileEvent('/src/a.ts', 'w-aaa', 'Edit'));
      let stats = store.getFileHeatmapStats();
      expect(stats.totalFiles).toBe(1);
      expect(stats.totalModifications).toBe(1);

      store.add(createFileEvent('/src/a.ts', 'w-aaa', 'Edit'));
      store.add(createFileEvent('/src/b.ts', 'w-bbb', 'Edit'));
      stats = store.getFileHeatmapStats();
      expect(stats.totalFiles).toBe(2);
      expect(stats.totalModifications).toBe(3);
    });
  });

  describe('avgModificationInterval', () => {
    it('averages the gaps between modification timestamps', () => {
      const now = Date.now();
      const path = '/src/interval.ts';
      store.add(createFileEvent(path, 'w-aaa', 'Edit', now));
      store.add(createFileEvent(path, 'w-aaa', 'Edit', now + 1000));
      store.add(createFileEvent(path, 'w-aaa', 'Edit', now + 3000)); // gaps: 1000 + 2000

      const entry = store.getFileHeatmap().find(e => e.path === path);
      expect(entry?.avgModificationInterval).toBe(1500);
    });

    it('is zero for a file modified only once', () => {
      store.add(createFileEvent('/src/once.ts', 'w-aaa', 'Edit'));

      const entry = store.getFileHeatmap().find(e => e.path === '/src/once.ts');
      expect(entry?.avgModificationInterval).toBe(0);
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

  describe('heat level boundaries', () => {
    // Documented levels: cold 1-2, warm 3-5, hot 6-10, critical 11+
    it.each([
      [1, 'cold'],
      [2, 'cold'],
      [3, 'warm'],
      [5, 'warm'],
      [6, 'hot'],
      [10, 'hot'],
      [11, 'critical'],
      [15, 'critical'],
    ])('classifies %d modifications as %s', (mods, expected) => {
      const now = Date.now();
      const path = `/src/heat-${mods}.ts`;
      for (let i = 0; i < mods; i++) {
        store.add(createFileEvent(path, 'w-abc123', 'Edit', now + i * 1000));
      }

      const entry = store.getFileHeatmap().find(e => e.path === path);
      expect(entry).toBeDefined();
      expect(entry!.heatLevel).toBe(expected);
    });
  });

  describe('sort modes', () => {
    let now: number;

    beforeEach(() => {
      now = Date.now();
      // Multi-worker file: 3 workers spaced beyond the 5s collision window
      store.add(createFileEvent('/src/multi.ts', 'w-aaa', 'Edit', now));
      store.add(createFileEvent('/src/multi.ts', 'w-bbb', 'Edit', now + 10000));
      store.add(createFileEvent('/src/multi.ts', 'w-ccc', 'Edit', now + 20000));
      // Single-worker hot file: 10 modifications
      for (let i = 0; i < 10; i++) {
        store.add(createFileEvent('/src/hot.ts', 'w-aaa', 'Edit', now + 30000 + i * 1000));
      }
      // Collided file: two workers within the 5s collision window
      store.add(createFileEvent('/src/collided.ts', 'w-aaa', 'Edit', now + 60000));
      store.add(createFileEvent('/src/collided.ts', 'w-bbb', 'Edit', now + 61000));
    });

    it('sorts by modification count by default', () => {
      const heatmap = store.getFileHeatmap();
      expect(heatmap[0].path).toBe('/src/hot.ts');
    });

    it('sorts by most recently modified', () => {
      const heatmap = store.getFileHeatmap({ sortBy: 'recent' });
      expect(heatmap[0].path).toBe('/src/collided.ts');
    });

    it('sorts by worker count', () => {
      const heatmap = store.getFileHeatmap({ sortBy: 'workers' });
      expect(heatmap[0].path).toBe('/src/multi.ts');
      expect(heatmap[0].workers).toHaveLength(3);
    });

    it('sorts collided files first by collision priority', () => {
      const heatmap = store.getFileHeatmap({ sortBy: 'collisions' });
      expect(heatmap[0].path).toBe('/src/collided.ts');
      expect(heatmap[0].hasCollision).toBe(true);
      // Non-collided files follow, ordered by modification count
      expect(heatmap[1].path).toBe('/src/hot.ts');
      expect(heatmap[2].path).toBe('/src/multi.ts');
    });
  });

  describe('collision detection and filtering', () => {
    it('flags files touched by multiple workers within the collision window', () => {
      const now = Date.now();
      store.add(createFileEvent('/src/shared.ts', 'w-aaa', 'Edit', now));
      store.add(createFileEvent('/src/shared.ts', 'w-bbb', 'Edit', now + 1000));
      store.add(createFileEvent('/src/quiet.ts', 'w-aaa', 'Edit', now + 2000));

      const heatmap = store.getFileHeatmap();
      const shared = heatmap.find(e => e.path === '/src/shared.ts');
      const quiet = heatmap.find(e => e.path === '/src/quiet.ts');

      expect(shared?.hasCollision).toBe(true);
      expect(quiet?.hasCollision).toBe(false);
    });

    it('counts active workers on a collided file', () => {
      const now = Date.now();
      store.add(createFileEvent('/src/shared.ts', 'w-aaa', 'Edit', now));
      store.add(createFileEvent('/src/shared.ts', 'w-bbb', 'Edit', now + 1000));

      const shared = store.getFileHeatmap().find(e => e.path === '/src/shared.ts');
      expect(shared?.activeWorkers).toBe(2);
    });

    it('collisionsOnly filter returns only collided files', () => {
      const now = Date.now();
      store.add(createFileEvent('/src/shared.ts', 'w-aaa', 'Edit', now));
      store.add(createFileEvent('/src/shared.ts', 'w-bbb', 'Edit', now + 1000));
      store.add(createFileEvent('/src/quiet.ts', 'w-aaa', 'Edit', now + 2000));

      const heatmap = store.getFileHeatmap({ collisionsOnly: true });
      expect(heatmap).toHaveLength(1);
      expect(heatmap[0].path).toBe('/src/shared.ts');

      const stats = store.getFileHeatmapStats();
      expect(stats.collisionFiles).toBe(1);
    });

    it('does not flag workers editing the same file outside the window', () => {
      const now = Date.now();
      store.add(createFileEvent('/src/serial.ts', 'w-aaa', 'Edit', now));
      store.add(createFileEvent('/src/serial.ts', 'w-bbb', 'Edit', now + 10000));

      const serial = store.getFileHeatmap().find(e => e.path === '/src/serial.ts');
      expect(serial?.hasCollision).toBe(false);
      expect(serial?.workers).toHaveLength(2);
    });
  });

  describe('live updates as events arrive', () => {
    it('picks up a newly-touched file in a subsequent query', () => {
      store.add(createFileEvent('/src/first.ts', 'w-aaa', 'Edit'));
      expect(store.getFileHeatmap().map(e => e.path)).toEqual(['/src/first.ts']);

      store.add(createFileEvent('/src/second.ts', 'w-bbb', 'Edit'));
      const heatmap = store.getFileHeatmap();
      expect(heatmap).toHaveLength(2);
      expect(heatmap.map(e => e.path)).toContain('/src/second.ts');
    });

    it('increments counts and upgrades heat level as more events arrive', () => {
      const path = '/src/growing.ts';
      const now = Date.now();

      store.add(createFileEvent(path, 'w-aaa', 'Edit', now));
      let entry = store.getFileHeatmap().find(e => e.path === path);
      expect(entry?.modifications).toBe(1);
      expect(entry?.heatLevel).toBe('cold');

      for (let i = 1; i <= 5; i++) {
        store.add(createFileEvent(path, 'w-aaa', 'Edit', now + i * 1000));
      }
      entry = store.getFileHeatmap().find(e => e.path === path);
      expect(entry?.modifications).toBe(6);
      expect(entry?.heatLevel).toBe('hot');
    });

    it('moves a file to the front of the recent sort after a new event', () => {
      const now = Date.now();
      store.add(createFileEvent('/src/older.ts', 'w-aaa', 'Edit', now));
      store.add(createFileEvent('/src/newer.ts', 'w-aaa', 'Edit', now + 60000));

      expect(store.getFileHeatmap({ sortBy: 'recent' })[0].path).toBe('/src/newer.ts');

      store.add(createFileEvent('/src/older.ts', 'w-aaa', 'Edit', now + 120000));
      expect(store.getFileHeatmap({ sortBy: 'recent' })[0].path).toBe('/src/older.ts');
    });

    it('attributes a new worker joining a file in a later event', () => {
      const now = Date.now();
      const path = '/src/joined.ts';
      store.add(createFileEvent(path, 'w-aaa', 'Edit', now));
      store.add(createFileEvent(path, 'w-aaa', 'Edit', now + 1000));

      let entry = store.getFileHeatmap()[0];
      expect(entry.workers).toHaveLength(1);
      expect(entry.workers[0]).toMatchObject({ workerId: 'w-aaa', modifications: 2, percentage: 100 });

      // Second worker joins outside the 5s collision window
      store.add(createFileEvent(path, 'w-bbb', 'Edit', now + 7000));

      entry = store.getFileHeatmap()[0];
      expect(entry.modifications).toBe(3);
      expect(entry.workers).toHaveLength(2);
      expect(entry.workers.find(w => w.workerId === 'w-bbb')).toMatchObject({
        modifications: 1,
        percentage: 33,
      });
    });
  });

  describe('getFileAnomalies', () => {
    it('returns no anomalies for an empty store', () => {
      expect(store.getFileAnomalies()).toEqual([]);
    });

    it('flags unexpected config file activity', () => {
      store.add(createFileEvent('/app/config/settings.yaml', 'w-aaa', 'Edit'));

      const anomalies = store.getFileAnomalies();
      expect(
        anomalies.some(a => a.path === '/app/config/settings.yaml' && a.type === 'config_modification')
      ).toBe(true);
    });

    it('grows as new suspicious events arrive', () => {
      expect(store.getFileAnomalies()).toHaveLength(0);

      store.add(createFileEvent('/project/.env', 'w-aaa', 'Edit'));
      store.add(createFileEvent('/project/deploy.sh', 'w-aaa', 'Edit'));

      const anomalies = store.getFileAnomalies();
      expect(anomalies.some(a => a.path === '/project/.env')).toBe(true);
      expect(anomalies.some(a => a.path === '/project/deploy.sh')).toBe(false);
    });
  });

  describe('directory filter semantics', () => {
    it('returns no entries when the filter matches nothing', () => {
      const now = Date.now();
      store.add(createFileEvent('/src/auth/login.ts', 'w-aaa', 'Edit', now));

      expect(store.getFileHeatmap({ directoryFilter: '/nope/' })).toEqual([]);
    });

    // getFileHeatmap filters with String.startsWith, so a filter is a raw
    // path prefix, not a directory-segment boundary. Pin that contract so a
    // future switch to segment matching is a conscious change, not an
    // unnoticed behavior break.
    it('matches by raw path prefix, not directory-segment boundary', () => {
      const now = Date.now();
      store.add(createFileEvent('/src/authx/login.ts', 'w-aaa', 'Edit', now));
      store.add(createFileEvent('/docs/readme.md', 'w-aaa', 'Edit', now + 1000));

      const heatmap = store.getFileHeatmap({ directoryFilter: '/src/auth' });
      expect(heatmap.map(e => e.path)).toEqual(['/src/authx/login.ts']);
    });

    it('combines with the collisionsOnly filter', () => {
      const now = Date.now();
      // Collided file inside the directory
      store.add(createFileEvent('/src/api/shared.ts', 'w-aaa', 'Edit', now));
      store.add(createFileEvent('/src/api/shared.ts', 'w-bbb', 'Edit', now + 1000));
      // Quiet file inside the directory
      store.add(createFileEvent('/src/api/quiet.ts', 'w-aaa', 'Edit', now + 2000));
      // Collided file outside the directory
      store.add(createFileEvent('/other/shared.ts', 'w-aaa', 'Edit', now + 3000));
      store.add(createFileEvent('/other/shared.ts', 'w-bbb', 'Edit', now + 4000));

      const heatmap = store.getFileHeatmap({
        directoryFilter: '/src/api',
        collisionsOnly: true,
      });
      expect(heatmap.map(e => e.path)).toEqual(['/src/api/shared.ts']);
    });
  });

  describe('entry limits', () => {
    it('caps at the documented default of 50 entries', () => {
      const now = Date.now();
      for (let i = 0; i < 60; i++) {
        store.add(createFileEvent(`/src/file-${i}.ts`, 'w-aaa', 'Edit', now + i));
      }

      expect(store.getFileHeatmap()).toHaveLength(50);
      expect(store.getFileHeatmap({ maxEntries: 60 })).toHaveLength(60);
    });
  });

  describe('getHeatmapTimelapse', () => {
    // Anchor every timeline to Date.now(): the collision detector compares
    // event timestamps against the wall clock, so far-past timestamps would
    // shed their collisions before the timelapse is built.
    let base: number;

    beforeEach(() => {
      base = Date.now();
    });

    it('builds a snapshot envelope honoring explicit start, end, and snapshot count', () => {
      store.add(createFileEvent('/src/a.ts', 'w-aaa', 'Edit', base));

      const timelapse = store.getHeatmapTimelapse({
        startTimestamp: base - 1000,
        endTimestamp: base + 5000,
        snapshotCount: 5,
      });

      expect(timelapse.startTimestamp).toBe(base - 1000);
      expect(timelapse.endTimestamp).toBe(base + 5000);
      // floor(6000ms / 5 snapshots) = 1200ms, and the loop walks i = 0..5
      // inclusive while timestamp <= end, so the end lands exactly on a frame
      expect(timelapse.interval).toBe(1200);
      expect(timelapse.totalSnapshots).toBe(timelapse.snapshots.length);
      expect(timelapse.snapshots.map(s => s.timestamp)).toEqual([
        base - 1000,
        base + 200,
        base + 1400,
        base + 2600,
        base + 3800,
        base + 5000,
      ]);
    });

    it('only includes a file in snapshots at or after its first modification', () => {
      store.add(createFileEvent('/src/early.ts', 'w-aaa', 'Edit', base));
      store.add(createFileEvent('/src/late.ts', 'w-bbb', 'Edit', base + 30000));

      const timelapse = store.getHeatmapTimelapse({
        startTimestamp: base,
        endTimestamp: base + 40000,
        snapshotCount: 4,
      });

      const pathsAt = (i: number) => timelapse.snapshots[i].entries.map(e => e.path);

      expect(pathsAt(0)).toEqual(['/src/early.ts']);
      expect(pathsAt(1)).toEqual(['/src/early.ts']);
      expect(pathsAt(2)).toEqual(['/src/early.ts']);
      expect(pathsAt(3)).toContain('/src/late.ts');
      expect(pathsAt(4)).toEqual(['/src/early.ts', '/src/late.ts']);
    });

    // The timelapse computes heat from the as-of-snapshot modification total
    // using its own thresholds (warm >= 5, hot >= 10, critical >= 20) — not
    // the live heatmap's 3/6/11. A file with 8 modifications is therefore
    // 'hot' live but only 'warm' in its snapshots. Pin both sides.
    it('counts a worker\'s full contribution at the first snapshot at or after their last edit', () => {
      const path = '/src/solo.ts';
      for (let i = 0; i < 8; i++) {
        store.add(createFileEvent(path, 'w-solo', 'Edit', base + i * 5000));
      }

      const timelapse = store.getHeatmapTimelapse({
        startTimestamp: base,
        endTimestamp: base + 40000,
        snapshotCount: 8,
      });

      // w-solo's last edit lands at base + 35000. Snapshots before it show
      // nothing (a worker contributes from their last edit onward, never
      // partially); from base + 35000 the full count of 8 appears.
      const entryAt = (i: number) =>
        timelapse.snapshots[i].entries.find(e => e.path === path);

      expect(entryAt(5)).toBeUndefined();
      const entry = entryAt(7);
      expect(entry).toBeDefined();
      expect(entry!.modifications).toBe(8);
      expect(entry!.heatLevel).toBe('warm');
      expect(entry!.workers[0]).toMatchObject({ workerId: 'w-solo', modifications: 8, percentage: 100 });

      // Same store, live heatmap: 8 modifications sits in the hot band.
      expect(store.getFileHeatmap().find(e => e.path === path)?.heatLevel).toBe('hot');
    });

    it('splits worker percentages once every contributor has touched the file', () => {
      const path = '/src/paired.ts';
      store.add(createFileEvent(path, 'w-aaa', 'Edit', base));
      store.add(createFileEvent(path, 'w-bbb', 'Edit', base + 15000));

      const timelapse = store.getHeatmapTimelapse({
        startTimestamp: base,
        endTimestamp: base + 20000,
        snapshotCount: 4,
      });

      // Snapshot at base + 10000: only w-aaa has edited
      const solo = timelapse.snapshots[2].entries.find(e => e.path === path);
      expect(solo?.workers).toHaveLength(1);
      expect(solo?.workers[0]).toMatchObject({ workerId: 'w-aaa', percentage: 100 });

      // Snapshot at base + 15000: both have edited, one modification each
      const paired = timelapse.snapshots[3].entries.find(e => e.path === path);
      expect(paired?.workers.map(w => w.percentage).sort()).toEqual([50, 50]);
    });

    it('honors the directory filter inside snapshots', () => {
      store.add(createFileEvent('/app/one.ts', 'w-aaa', 'Edit', base));
      store.add(createFileEvent('/lib/two.ts', 'w-aaa', 'Edit', base + 1000));

      const timelapse = store.getHeatmapTimelapse({
        startTimestamp: base,
        endTimestamp: base + 10000,
        snapshotCount: 5,
        directoryFilter: '/app',
      });

      for (const snapshot of timelapse.snapshots) {
        expect(snapshot.entries.map(e => e.path)).not.toContain('/lib/two.ts');
      }
      expect(timelapse.snapshots[timelapse.snapshots.length - 1].entries.map(e => e.path))
        .toEqual(['/app/one.ts']);
    });

    it('honors collisionsOnly inside snapshots', () => {
      // Two workers within the 5s collision window -> active collision
      store.add(createFileEvent('/src/shared.ts', 'w-aaa', 'Edit', base));
      store.add(createFileEvent('/src/shared.ts', 'w-bbb', 'Edit', base + 1000));
      store.add(createFileEvent('/src/quiet.ts', 'w-aaa', 'Edit', base + 2000));

      const timelapse = store.getHeatmapTimelapse({
        startTimestamp: base,
        endTimestamp: base + 10000,
        snapshotCount: 5,
        collisionsOnly: true,
      });

      for (const snapshot of timelapse.snapshots) {
        expect(snapshot.entries.map(e => e.path)).not.toContain('/src/quiet.ts');
      }
      expect(timelapse.snapshots[timelapse.snapshots.length - 1].entries.map(e => e.path))
        .toEqual(['/src/shared.ts']);
    });
  });

  describe('collision lifecycle', () => {
    // The doc pins "active collisions (⚠ red)" as same-file edits from
    // multiple workers inside a 5s window; the collision view's own query
    // (getCollisions) is what retires collisions older than its 30s stale
    // threshold, and the heatmap's highlighting follows that state.
    it('retires collision highlighting once the collision goes stale', () => {
      const now = Date.now();
      // Two workers, 2s apart, but both in the past: inside the 5s
      // collision window relative to each other, yet old enough that the
      // stale threshold (30s) has already elapsed.
      store.add(createFileEvent('/src/stale.ts', 'w-aaa', 'Edit', now - 40_000));
      store.add(createFileEvent('/src/stale.ts', 'w-bbb', 'Edit', now - 38_000));

      // Before any cleanup runs the collision is formed and highlighted.
      expect(store.getFileHeatmap()[0].hasCollision).toBe(true);
      expect(store.getFileHeatmap({ collisionsOnly: true }).map(e => e.path))
        .toEqual(['/src/stale.ts']);

      // The collision view's query performs the staleness sweep and no
      // longer reports it as active.
      expect(store.getCollisions()).toEqual([]);

      // Highlighting follows: the file drops out of collisions-only and
      // loses its flag in the unfiltered heatmap.
      expect(store.getFileHeatmap({ collisionsOnly: true })).toEqual([]);
      expect(store.getFileHeatmap()[0].hasCollision).toBe(false);
      // The modification history itself is untouched by the retirement.
      expect(store.getFileHeatmap()[0].modifications).toBe(2);
      expect(store.getFileHeatmap()[0].workers.map(w => w.workerId).sort())
        .toEqual(['w-aaa', 'w-bbb']);
    });

    it('keeps highlighting while the collision is still fresh', () => {
      const now = Date.now();
      store.add(createFileEvent('/src/fresh.ts', 'w-aaa', 'Edit', now - 1_000));
      store.add(createFileEvent('/src/fresh.ts', 'w-bbb', 'Edit', now));

      // A cleanup pass runs; the collision is well inside the 30s window.
      store.getCollisions();

      const entry = store.getFileHeatmap({ collisionsOnly: true })[0];
      expect(entry?.path).toBe('/src/fresh.ts');
      expect(entry?.hasCollision).toBe(true);
      expect(entry?.activeWorkers).toBe(2);
    });
  });
});
