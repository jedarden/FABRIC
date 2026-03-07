/**
 * Focus Preset Management
 *
 * Provides save/load/delete functionality for focus mode pin configurations.
 * Used by both TUI and Web interfaces.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * A saved focus mode configuration
 */
export interface FocusPreset {
  /** Unique name for the preset */
  name: string;

  /** Pinned worker IDs */
  pinnedWorkers: string[];

  /** Pinned bead IDs */
  pinnedBeads: string[];

  /** Timestamp when preset was created */
  createdAt: number;

  /** Optional description */
  description?: string;
}

/**
 * Storage interface for presets
 */
export interface PresetStorage {
  load(): FocusPreset[];
  save(presets: FocusPreset[]): void;
}

/**
 * In-memory storage (for testing)
 */
export class MemoryPresetStorage implements PresetStorage {
  private presets: FocusPreset[] = [];

  load(): FocusPreset[] {
    return [...this.presets];
  }

  save(presets: FocusPreset[]): void {
    this.presets = [...presets];
  }
}

/**
 * LocalStorage-based preset storage (for web)
 * Note: This class is intended for browser environments only.
 * For Node.js/TUI environments, use FilePresetStorage instead.
 */
export class LocalStoragePresetStorage implements PresetStorage {
  private readonly key: string;

  constructor(key = 'fabric-focus-presets') {
    this.key = key;
  }

  load(): FocusPreset[] {
    // This is a no-op in Node.js environments
    // The web version has its own implementation
    return [];
  }

  save(presets: FocusPreset[]): void {
    // This is a no-op in Node.js environments
    // The web version has its own implementation
  }
}

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
 * FocusPresetManager handles CRUD operations for focus mode presets
 */
export class FocusPresetManager {
  private storage: PresetStorage;
  private presets: FocusPreset[];
  private listeners: Set<() => void> = new Set();

  constructor(storage: PresetStorage) {
    this.storage = storage;
    this.presets = this.storage.load();
  }

  /**
   * Get all presets
   */
  getPresets(): FocusPreset[] {
    return [...this.presets];
  }

  /**
   * Get preset by name
   */
  getPreset(name: string): FocusPreset | undefined {
    return this.presets.find(p => p.name === name);
  }

  /**
   * Check if a preset exists
   */
  hasPreset(name: string): boolean {
    return this.presets.some(p => p.name === name);
  }

  /**
   * Save current configuration as a new preset
   */
  savePreset(
    name: string,
    pinnedWorkers: string[],
    pinnedBeads: string[],
    description?: string
  ): boolean {
    // Check if name is valid
    if (!name || name.trim() === '') {
      return false;
    }

    const trimmedName = name.trim();

    // Check for duplicate (update existing)
    const existingIndex = this.presets.findIndex(p => p.name === trimmedName);

    const preset: FocusPreset = {
      name: trimmedName,
      pinnedWorkers: [...pinnedWorkers],
      pinnedBeads: [...pinnedBeads],
      createdAt: existingIndex >= 0 ? this.presets[existingIndex].createdAt : Date.now(),
      description,
    };

    if (existingIndex >= 0) {
      this.presets[existingIndex] = preset;
    } else {
      this.presets.push(preset);
    }

    this.persist();
    this.notifyListeners();
    return true;
  }

  /**
   * Delete a preset by name
   */
  deletePreset(name: string): boolean {
    const index = this.presets.findIndex(p => p.name === name);
    if (index < 0) {
      return false;
    }

    this.presets.splice(index, 1);
    this.persist();
    this.notifyListeners();
    return true;
  }

  /**
   * Load preset configuration (returns the pin data, doesn't apply it)
   */
  loadPreset(name: string): { pinnedWorkers: string[]; pinnedBeads: string[] } | null {
    const preset = this.getPreset(name);
    if (!preset) {
      return null;
    }

    return {
      pinnedWorkers: [...preset.pinnedWorkers],
      pinnedBeads: [...preset.pinnedBeads],
    };
  }

  /**
   * Get preset names as a list
   */
  getPresetNames(): string[] {
    return this.presets.map(p => p.name);
  }

  /**
   * Subscribe to preset changes
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Persist presets to storage
   */
  private persist(): void {
    this.storage.save(this.presets);
  }

  /**
   * Notify all listeners of changes
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => listener());
  }
}

/**
 * Create a preset manager for web (localStorage)
 */
export function createWebPresetManager(): FocusPresetManager {
  return new FocusPresetManager(new LocalStoragePresetStorage());
}

/**
 * Create a preset manager for TUI (file storage)
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
