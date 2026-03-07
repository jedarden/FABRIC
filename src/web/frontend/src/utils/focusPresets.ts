/**
 * Focus Preset Management for Web
 *
 * Provides save/load/delete functionality for focus mode pin configurations.
 * Web version uses localStorage for persistence.
 */

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

const PRESETS_STORAGE_KEY = 'fabric-focus-presets';

/**
 * Load presets from localStorage
 */
function loadPresets(): FocusPreset[] {
  try {
    const data = localStorage.getItem(PRESETS_STORAGE_KEY);
    if (!data) return [];
    return JSON.parse(data) as FocusPreset[];
  } catch {
    console.error('Failed to load presets from localStorage');
    return [];
  }
}

/**
 * Save presets to localStorage
 */
function savePresets(presets: FocusPreset[]): void {
  try {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
  } catch (err) {
    console.error('Failed to save presets to localStorage:', err);
  }
}

/**
 * FocusPresetManager handles CRUD operations for focus mode presets
 */
export class FocusPresetManager {
  private presets: FocusPreset[];
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.presets = loadPresets();
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
    savePresets(this.presets);
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
  return new FocusPresetManager();
}
