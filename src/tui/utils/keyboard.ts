/**
 * FABRIC TUI Keyboard Bindings
 *
 * Key binding definitions for terminal UI navigation.
 */

export interface KeyBinding {
  key: string;
  description: string;
  action: () => void;
}

export const defaultBindings: Record<string, string> = {
  // Navigation
  j: 'scroll-down',
  k: 'scroll-up',
  g: 'scroll-top',
  G: 'scroll-bottom',

  // Panel switching
  tab: 'next-panel',
  'S-tab': 'prev-panel',
  '1': 'panel-workers',
  '2': 'panel-activity',
  '3': 'panel-detail',

  // Actions
  '/': 'search',
  f: 'filter',
  r: 'refresh',
  p: 'pause',
  enter: 'select',

  // General
  q: 'quit',
  '?': 'help',
  escape: 'cancel',
};

/**
 * Format key for display
 */
export function formatKey(key: string): string {
  const displayMap: Record<string, string> = {
    tab: 'Tab',
    'S-tab': 'Shift+Tab',
    enter: 'Enter',
    escape: 'Esc',
    '/': '/',
    '?': '?',
  };
  return displayMap[key] || key.toUpperCase();
}

/**
 * Get help text for key bindings
 */
export function getHelpText(): string {
  return Object.entries(defaultBindings)
    .map(([key, action]) => `{bold}${formatKey(key)}{/bold}: ${action}`)
    .join('\n');
}
