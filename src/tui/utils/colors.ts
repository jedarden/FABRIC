/**
 * FABRIC TUI Color Scheme
 *
 * Color definitions for terminal UI rendering.
 */

export const colors = {
  // Status colors
  active: 'green',
  idle: 'yellow',
  error: 'red',

  // Log level colors
  debug: 'gray',
  info: 'white',
  warn: 'yellow',
  error_level: 'red',

  // UI colors
  border: 'blue',
  header: 'cyan',
  focus: 'green',
  muted: 'gray',

  // Background colors
  bgPanel: 'black',
  bgFocus: 'blue',

  // Heat level colors
  heatCold: 'blue',
  heatWarm: 'yellow',
  heatHot: 'magenta',
  heatCritical: 'red',
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
