/**
 * FABRIC TUI Color Scheme
 *
 * Color definitions for terminal UI rendering.
 * Uses bright/light color variants for better contrast and
 * readability in both light and dark terminal themes.
 *
 * Blessed color options:
 * - Basic: black, red, green, yellow, blue, magenta, cyan, white
 * - Light variants: light-red, light-green, light-yellow, light-blue,
 *   light-magenta, light-cyan, light-white
 * - Gray: light-black (better than 'gray' for consistency)
 */

export const colors = {
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
  // Using light variants for better contrast
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
  gray: 'light-black',        // Consistent gray using light-black
} as const;

export type ColorName = keyof typeof colors;

/**
 * Get color for worker status
 */
export function getStatusColor(status: 'active' | 'idle' | 'error'): string {
  return colors[status];
}

/**
 * Get color for log level
 */
export function getLevelColor(level: 'debug' | 'info' | 'warn' | 'error'): string {
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
