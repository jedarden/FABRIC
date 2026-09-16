/**
 * Focus Preset Management (Node: TUI + CLI)
 *
 * The preset model and CRUD logic live in the shared core
 * (`focusPresetCore.ts`), which is also bundled into the web frontend.
 * This module adds the Node-only file storage backend and the
 * factory wired to the fabric config directory (~/.fabric).
 *
 * The browser counterpart (LocalStoragePresetStorage) lives in
 * src/web/frontend/src/utils/focusPresets.ts — it cannot live here
 * because importing this module pulls in `fs`.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  FocusPreset,
  FocusPresetManager,
  MemoryPresetStorage,
  PresetStorage,
} from './focusPresetCore.js';

export {
  FocusPreset,
  FocusPresetManager,
  MemoryPresetStorage,
  PresetStorage,
} from './focusPresetCore.js';

/**
 * File-based preset storage (for TUI)
 */
export class FilePresetStorage implements PresetStorage {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  load(): FocusPreset[] {
    try {
      if (!fs.existsSync(this.filePath)) {
        return [];
      }
      const data = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(data) as FocusPreset[];
    } catch (err) {
      console.error('Failed to load presets from file:', err);
      return [];
    }
  }

  save(presets: FocusPreset[]): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(presets, null, 2));
    } catch (err) {
      console.error('Failed to save presets to file:', err);
    }
  }
}

/**
 * Create a preset manager for TUI (file storage under the fabric config dir)
 */
export function createTuiPresetManager(configDir?: string): FocusPresetManager {
  const dir = configDir || path.join(os.homedir(), '.fabric');
  const filePath = path.join(dir, 'focus-presets.json');
  return new FocusPresetManager(new FilePresetStorage(filePath));
}

/**
 * Create a preset manager for testing (in-memory)
 */
export function createTestPresetManager(): FocusPresetManager {
  return new FocusPresetManager(new MemoryPresetStorage());
}
