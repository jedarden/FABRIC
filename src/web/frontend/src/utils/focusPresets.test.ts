/**
 * Tests for the web (localStorage) focus preset storage backend.
 *
 * Runs in the node environment (jsdom is only mapped to .test.tsx), so
 * globalThis.localStorage is replaced with a minimal in-memory fake.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LocalStoragePresetStorage,
  createWebPresetManager,
} from './focusPresets';

class FakeLocalStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

describe('LocalStoragePresetStorage (web)', () => {
  const originalLocalStorage = globalThis.localStorage;
  let fake: FakeLocalStorage & { store: Map<string, string> };
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fake = new FakeLocalStorage() as FakeLocalStorage & { store: Map<string, string> };
    (globalThis as { localStorage: unknown }).localStorage = fake;
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    (globalThis as { localStorage: unknown }).localStorage = originalLocalStorage;
    errorSpy.mockRestore();
  });

  it('should persist presets under the fabric-focus-presets key', () => {
    const manager = createWebPresetManager();
    manager.savePreset('triage', ['worker-7'], ['fabric-abc'], 'morning triage');

    expect(fake.store.has('fabric-focus-presets')).toBe(true);
    const stored = JSON.parse(fake.getItem('fabric-focus-presets') as string);
    expect(stored).toEqual([
      {
        name: 'triage',
        pinnedWorkers: ['worker-7'],
        pinnedBeads: ['fabric-abc'],
        createdAt: expect.any(Number),
        description: 'morning triage',
      },
    ]);
  });

  it('should round-trip presets through a fresh manager (what App.tsx does on reload)', () => {
    const first = createWebPresetManager();
    first.savePreset('triage', ['worker-7'], ['fabric-abc']);
    first.savePreset('quiet', [], []);

    const second = createWebPresetManager();
    expect(second.getPresetNames()).toEqual(['triage', 'quiet']);
    expect(second.loadPreset('triage')).toEqual({
      pinnedWorkers: ['worker-7'],
      pinnedBeads: ['fabric-abc'],
    });
  });

  it('should delete presets across manager instances', () => {
    const first = createWebPresetManager();
    first.savePreset('temp', [], []);

    const second = createWebPresetManager();
    expect(second.deletePreset('temp')).toBe(true);
    expect(createWebPresetManager().getPresets()).toEqual([]);
  });

  it('should use the same storage shape as the shared core', () => {
    const storage = new LocalStoragePresetStorage();
    const presets = [
      { name: 'a', pinnedWorkers: ['w'], pinnedBeads: ['b'], createdAt: 42 },
    ];

    storage.save(presets);
    expect(storage.load()).toEqual(presets);
  });

  it('should start empty when localStorage has no presets', () => {
    expect(createWebPresetManager().getPresets()).toEqual([]);
  });

  it('should return empty presets when stored JSON is malformed', () => {
    fake.setItem('fabric-focus-presets', '{oops');
    expect(new LocalStoragePresetStorage().load()).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('should not throw when localStorage writes fail (quota, privacy mode)', () => {
    vi.spyOn(fake, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const manager = createWebPresetManager();
    expect(() => manager.savePreset('x', [], [])).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();
  });

  it('should honor a custom storage key', () => {
    const storage = new LocalStoragePresetStorage('fabric-test-key');
    storage.save([{ name: 'a', pinnedWorkers: [], pinnedBeads: [], createdAt: 1 }]);

    expect(fake.store.has('fabric-test-key')).toBe(true);
    expect(fake.store.has('fabric-focus-presets')).toBe(false);
  });
});
