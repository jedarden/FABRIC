/**
 * Tests for FocusPresetManager
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  FocusPresetManager,
  MemoryPresetStorage,
  FilePresetStorage,
  createTuiPresetManager,
} from './focusPresets.js';

describe('FocusPresetManager', () => {
  let manager: FocusPresetManager;
  let storage: MemoryPresetStorage;

  beforeEach(() => {
    storage = new MemoryPresetStorage();
    manager = new FocusPresetManager(storage);
  });

  describe('savePreset', () => {
    it('should save a new preset', () => {
      const result = manager.savePreset('test-preset', ['worker1'], ['bead1']);
      expect(result).toBe(true);

      const presets = manager.getPresets();
      expect(presets).toHaveLength(1);
      expect(presets[0].name).toBe('test-preset');
      expect(presets[0].pinnedWorkers).toEqual(['worker1']);
      expect(presets[0].pinnedBeads).toEqual(['bead1']);
    });

    it('should not save preset with empty name', () => {
      const result = manager.savePreset('', ['worker1'], []);
      expect(result).toBe(false);
      expect(manager.getPresets()).toHaveLength(0);
    });

    it('should update existing preset with same name', () => {
      manager.savePreset('test-preset', ['worker1'], []);
      manager.savePreset('test-preset', ['worker2'], ['bead2']);

      const presets = manager.getPresets();
      expect(presets).toHaveLength(1);
      expect(presets[0].pinnedWorkers).toEqual(['worker2']);
      expect(presets[0].pinnedBeads).toEqual(['bead2']);
    });

    it('should trim preset name', () => {
      manager.savePreset('  trimmed-name  ', ['worker1'], []);
      expect(manager.hasPreset('trimmed-name')).toBe(true);
    });
  });

  describe('loadPreset', () => {
    it('should load an existing preset', () => {
      manager.savePreset('test-preset', ['worker1', 'worker2'], ['bead1']);

      const config = manager.loadPreset('test-preset');
      expect(config).not.toBeNull();
      expect(config?.pinnedWorkers).toEqual(['worker1', 'worker2']);
      expect(config?.pinnedBeads).toEqual(['bead1']);
    });

    it('should return null for non-existent preset', () => {
      const config = manager.loadPreset('non-existent');
      expect(config).toBeNull();
    });

    it('should return a copy of the arrays', () => {
      manager.savePreset('test-preset', ['worker1'], []);

      const config = manager.loadPreset('test-preset');
      config?.pinnedWorkers.push('worker2');

      const config2 = manager.loadPreset('test-preset');
      expect(config2?.pinnedWorkers).toEqual(['worker1']);
    });
  });

  describe('deletePreset', () => {
    it('should delete an existing preset', () => {
      manager.savePreset('test-preset', ['worker1'], []);
      const result = manager.deletePreset('test-preset');

      expect(result).toBe(true);
      expect(manager.getPresets()).toHaveLength(0);
    });

    it('should return false for non-existent preset', () => {
      const result = manager.deletePreset('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('getPresetNames', () => {
    it('should return all preset names', () => {
      manager.savePreset('preset1', [], []);
      manager.savePreset('preset2', [], []);
      manager.savePreset('preset3', [], []);

      const names = manager.getPresetNames();
      expect(names).toEqual(['preset1', 'preset2', 'preset3']);
    });

    it('should return empty array when no presets', () => {
      expect(manager.getPresetNames()).toEqual([]);
    });
  });

  describe('hasPreset', () => {
    it('should return true for existing preset', () => {
      manager.savePreset('test-preset', [], []);
      expect(manager.hasPreset('test-preset')).toBe(true);
    });

    it('should return false for non-existent preset', () => {
      expect(manager.hasPreset('non-existent')).toBe(false);
    });
  });

  describe('subscribe', () => {
    it('should notify listeners when preset is saved', () => {
      let callCount = 0;
      manager.subscribe(() => callCount++);

      manager.savePreset('test-preset', [], []);
      expect(callCount).toBe(1);
    });

    it('should notify listeners when preset is deleted', () => {
      manager.savePreset('test-preset', [], []);

      let callCount = 0;
      manager.subscribe(() => callCount++);

      manager.deletePreset('test-preset');
      expect(callCount).toBe(1);
    });

    it('should unsubscribe correctly', () => {
      let callCount = 0;
      const unsubscribe = manager.subscribe(() => callCount++);

      unsubscribe();
      manager.savePreset('test-preset', [], []);

      expect(callCount).toBe(0);
    });
  });
});

describe('FilePresetStorage (fabric config)', () => {
  let configDir: string;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-presets-'));
    // FilePresetStorage logs (and degrades) on I/O and parse errors — keep
    // that out of the test output.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it('should persist presets across manager instances via focus-presets.json', () => {
    const first = createTuiPresetManager(configDir);
    first.savePreset('work', ['worker-alpha'], ['fabric-1234'], 'alpha only');

    const second = createTuiPresetManager(configDir);
    expect(second.hasPreset('work')).toBe(true);

    const loaded = second.loadPreset('work');
    expect(loaded).toEqual({
      pinnedWorkers: ['worker-alpha'],
      pinnedBeads: ['fabric-1234'],
    });

    const preset = second.getPreset('work');
    expect(preset?.description).toBe('alpha only');
  });

  it('should store presets in the fabric config file the CLI reads', () => {
    const manager = createTuiPresetManager(configDir);
    manager.savePreset('cli-visible', [], []);

    // src/config.ts (`fabric config presets`) reads this exact file
    const presetsFile = path.join(configDir, 'focus-presets.json');
    expect(fs.existsSync(presetsFile)).toBe(true);
    expect(JSON.parse(fs.readFileSync(presetsFile, 'utf-8'))).toHaveLength(1);
  });

  it('should start empty when no preset file exists', () => {
    const manager = createTuiPresetManager(configDir);
    expect(manager.getPresets()).toEqual([]);
  });

  it('should return empty presets when the file contains invalid JSON', () => {
    fs.writeFileSync(path.join(configDir, 'focus-presets.json'), '{not json');
    const manager = createTuiPresetManager(configDir);
    expect(manager.getPresets()).toEqual([]);
  });

  it('should apply changes made by a later manager instance', () => {
    const first = createTuiPresetManager(configDir);
    first.savePreset('shared', ['w1'], []);

    const second = createTuiPresetManager(configDir);
    second.deletePreset('shared');

    expect(createTuiPresetManager(configDir).hasPreset('shared')).toBe(false);
  });

  it('should round-trip through FilePresetStorage directly', () => {
    const file = path.join(configDir, 'direct.json');
    const storage = new FilePresetStorage(file);
    const presets = [
      { name: 'a', pinnedWorkers: ['w'], pinnedBeads: [], createdAt: 42 },
    ];

    storage.save(presets);
    expect(new FilePresetStorage(file).load()).toEqual(presets);
  });
});
