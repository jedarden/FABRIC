/**
 * Focus Preset Management for Web (browser)
 *
 * Persistence is the shared `FocusPresetManager` core (src/focusPresetCore.ts)
 * with a browser localStorage backend. The Node file backend lives in
 * src/focusPresets.ts — that module cannot be imported here because it
 * pulls in `fs`.
 */

import {
  FocusPreset,
  FocusPresetManager,
  PresetStorage,
} from '../../../../focusPresetCore';

export type { FocusPreset, FocusPresetManager, PresetStorage };

const PRESETS_STORAGE_KEY = 'fabric-focus-presets';

/**
 * localStorage-backed preset storage (for web)
 */
export class LocalStoragePresetStorage implements PresetStorage {
  private readonly key: string;

  constructor(key = PRESETS_STORAGE_KEY) {
    this.key = key;
  }

  load(): FocusPreset[] {
    try {
      const data = localStorage.getItem(this.key);
      if (!data) return [];
      return JSON.parse(data) as FocusPreset[];
    } catch {
      console.error('Failed to load presets from localStorage');
      return [];
    }
  }

  save(presets: FocusPreset[]): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(presets));
    } catch (err) {
      console.error('Failed to save presets to localStorage:', err);
    }
  }
}

/**
 * Create a preset manager for web (localStorage)
 */
export function createWebPresetManager(): FocusPresetManager {
  return new FocusPresetManager(new LocalStoragePresetStorage());
}
