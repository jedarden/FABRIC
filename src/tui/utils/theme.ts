/**
 * FABRIC TUI Theme System
 *
 * Provides dark and light theme support for the terminal UI.
 * Themes are persisted to a config file for session persistence.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type ThemeName = 'dark' | 'light';

export interface ThemeColors {
  // Status colors
  active: string;
  idle: string;
  error: string;

  // Log level colors
  debug: string;
  info: string;
  warn: string;
  warning: string;
  error_level: string;

  // UI colors
  border: string;
  header: string;
  focus: string;
  muted: string;
  text: string;
  selected: string;

  // Background colors
  bgPanel: string;
  bgFocus: string;

  // Input colors
  inputBg: string;
  inputFocusBg: string;
  dim: string;

  // Heat level colors
  heatCold: string;
  heatWarm: string;
  heatHot: string;
  heatCritical: string;

  // Named colors
  green: string;
  yellow: string;
  blue: string;
  red: string;
  cyan: string;
  magenta: string;
  orange: string;
  purple: string;
  teal: string;
  white: string;
  black: string;
  gray: string;
}

/**
 * Dark theme - optimized for dark terminal backgrounds
 * Uses light variants for visibility
 */
export const darkTheme: ThemeColors = {
  // Status colors - using bright variants for visibility
  active: 'light-green',
  idle: 'light-yellow',
  error: 'light-red',

  // Log level colors - optimized for readability
  debug: 'light-black',      // Muted but visible
  info: 'light-cyan',         // Distinct from text
  warn: 'light-yellow',       // High visibility warning
  warning: 'light-yellow',    // Alias for warn
  error_level: 'light-red',   // High visibility error

  // UI colors - improved contrast
  border: 'light-blue',
  header: 'light-cyan',
  focus: 'light-green',
  muted: 'light-black',       // Consistent muted color
  text: 'light-white',        // Bright readable text
  selected: 'light-green',

  // Background colors - transparent/none for theme compatibility
  bgPanel: 'default',         // Use terminal's default background
  bgFocus: 'blue',            // Distinct but not too bright

  // Input colors
  inputBg: 'default',         // Use terminal's default background
  inputFocusBg: 'blue',
  dim: 'light-black',

  // Heat level colors - progressive intensity
  heatCold: 'light-blue',
  heatWarm: 'light-yellow',
  heatHot: 'light-magenta',
  heatCritical: 'light-red',

  // Named colors (for components that reference by name)
  green: 'light-green',
  yellow: 'light-yellow',
  blue: 'light-blue',
  red: 'light-red',
  cyan: 'light-cyan',
  magenta: 'light-magenta',
  orange: 'yellow',           // Orange not widely supported, use yellow
  purple: 'light-magenta',
  teal: 'light-cyan',
  white: 'light-white',
  black: 'black',
  gray: 'light-black',
};

/**
 * Light theme - optimized for light terminal backgrounds
 * Uses dark variants for contrast
 */
export const lightTheme: ThemeColors = {
  // Status colors - using dark variants for contrast
  active: 'green',
  idle: 'yellow',
  error: 'red',

  // Log level colors - optimized for light background readability
  debug: 'black',             // Dark for visibility on light bg
  info: 'blue',               // Distinct from text
  warn: 'yellow',             // High visibility warning
  warning: 'yellow',          // Alias for warn
  error_level: 'red',         // High visibility error

  // UI colors - dark colors for contrast
  border: 'blue',
  header: 'cyan',
  focus: 'green',
  muted: 'black',             // Dark muted color
  text: 'black',              // Dark readable text
  selected: 'green',

  // Background colors
  bgPanel: 'default',         // Use terminal's default background
  bgFocus: 'white',           // Light focus background

  // Input colors
  inputBg: 'default',
  inputFocusBg: 'white',
  dim: 'black',

  // Heat level colors - progressive intensity
  heatCold: 'blue',
  heatWarm: 'yellow',
  heatHot: 'magenta',
  heatCritical: 'red',

  // Named colors (for components that reference by name)
  green: 'green',
  yellow: 'yellow',
  blue: 'blue',
  red: 'red',
  cyan: 'cyan',
  magenta: 'magenta',
  orange: 'yellow',
  purple: 'magenta',
  teal: 'cyan',
  white: 'white',
  black: 'black',
  gray: 'black',
};

/**
 * Theme manager class for managing theme state and persistence
 */
export class ThemeManager {
  private currentTheme: ThemeName;
  private configPath: string;
  private listeners: Set<(theme: ThemeName) => void> = new Set();

  constructor() {
    this.configPath = this.getConfigPath();
    this.currentTheme = this.loadTheme();
  }

  /**
   * Get the config file path for theme persistence
   */
  private getConfigPath(): string {
    const configDir = path.join(os.homedir(), '.fabric');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    return path.join(configDir, 'theme.json');
  }

  /**
   * Load theme from config file
   */
  private loadTheme(): ThemeName {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        const config = JSON.parse(content);
        if (config.theme === 'dark' || config.theme === 'light') {
          return config.theme;
        }
      }
    } catch (error) {
      // Ignore errors, fall back to default
    }
    return 'dark'; // Default to dark theme
  }

  /**
   * Save theme to config file
   */
  private saveTheme(): void {
    try {
      const config = { theme: this.currentTheme };
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
      // Ignore save errors
    }
  }

  /**
   * Get the current theme name
   */
  getTheme(): ThemeName {
    return this.currentTheme;
  }

  /**
   * Set the current theme
   */
  setTheme(theme: ThemeName): void {
    if (this.currentTheme !== theme) {
      this.currentTheme = theme;
      this.saveTheme();
      this.notifyListeners();
    }
  }

  /**
   * Toggle between dark and light themes
   */
  toggleTheme(): ThemeName {
    const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
    this.setTheme(newTheme);
    return newTheme;
  }

  /**
   * Get the colors for the current theme
   */
  getColors(): ThemeColors {
    return this.currentTheme === 'dark' ? darkTheme : lightTheme;
  }

  /**
   * Subscribe to theme changes
   */
  subscribe(listener: (theme: ThemeName) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners of theme change
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.currentTheme);
    }
  }
}

// Global theme manager instance
let themeManager: ThemeManager | null = null;

/**
 * Get the global theme manager instance
 */
export function getThemeManager(): ThemeManager {
  if (!themeManager) {
    themeManager = new ThemeManager();
  }
  return themeManager;
}

/**
 * Get current theme colors (convenience function)
 */
export function getColors(): ThemeColors {
  return getThemeManager().getColors();
}

/**
 * Get current theme name (convenience function)
 */
export function getCurrentTheme(): ThemeName {
  return getThemeManager().getTheme();
}
