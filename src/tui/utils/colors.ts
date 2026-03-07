/**
 * FABRIC TUI Color Scheme
 *
 * Color definitions for terminal UI rendering.
 * Supports dark and light themes via the theme system.
 *
 * This module provides a backward-compatible API while delegating
 * to the theme manager for actual color values.
 *
 * Blessed color options:
 * - Basic: black, red, green, yellow, blue, magenta, cyan, white
 * - Light variants: light-red, light-green, light-yellow, light-blue,
 *   light-magenta, light-cyan, light-white
 * - Gray: light-black (better than 'gray' for consistency)
 */

import { getColors, getThemeManager, ThemeName, ThemeColors } from './theme.js';

// Re-export theme types and functions for convenience
export type { ThemeName, ThemeColors } from './theme.js';
export { getThemeManager, darkTheme, lightTheme } from './theme.js';

/**
 * Colors object that proxies to the current theme
 * This provides backward compatibility with existing code that imports `colors`
 */
export const colors: ThemeColors = new Proxy({} as ThemeColors, {
  get(_target, prop: keyof ThemeColors) {
    return getColors()[prop];
  },
});

export type ColorName = keyof ThemeColors;

/**
 * Get color for worker status
 */
export function getStatusColor(status: 'active' | 'idle' | 'error'): string {
  return getColors()[status];
}

/**
 * Get color for log level
 */
export function getLevelColor(level: 'debug' | 'info' | 'warn' | 'error'): string {
  const colors = getColors();
  switch (level) {
    case 'debug': return colors.debug;
    case 'info': return colors.info;
    case 'warn': return colors.warn;
    case 'error': return colors.error_level;
  }
}

/**
 * Get color for heat level
 */
export function getHeatColor(level: 'cold' | 'warm' | 'hot' | 'critical'): string {
  const colors = getColors();
  switch (level) {
    case 'cold': return colors.heatCold;
    case 'warm': return colors.heatWarm;
    case 'hot': return colors.heatHot;
    case 'critical': return colors.heatCritical;
  }
}

/**
 * Get heat icon
 */
export function getHeatIcon(level: 'cold' | 'warm' | 'hot' | 'critical'): string {
  switch (level) {
    case 'cold': return '○';
    case 'warm': return '◐';
    case 'hot': return '●';
    case 'critical': return '🔥';
  }
}
