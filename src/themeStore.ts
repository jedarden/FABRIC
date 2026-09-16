/**
 * FABRIC Theme Store
 *
 * Single source of truth for the FABRIC theme setting, shared by:
 *   - `fabric config theme` (src/config.ts)
 *   - the TUI theme manager (src/tui/utils/theme.ts)
 *   - the web server theme API (src/web/server.ts GET/POST /api/theme)
 *
 * Persisted to ~/.fabric/theme.json as `{ "theme": "dark" | "light" }`,
 * so switching the theme on one surface is picked up by the others
 * (web clients fetch it on load; the TUI and CLI read it at startup).
 *
 * Path resolution happens per call so tests can redirect HOME, and so a
 * missing HOME (CI containers) degrades to non-persistent defaults instead
 * of throwing.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type ThemeName = 'dark' | 'light';

export const DEFAULT_THEME: ThemeName = 'dark';

/**
 * Type guard for a theme name read from untrusted input
 * (config files, HTTP request bodies).
 */
export function isThemeName(value: unknown): value is ThemeName {
  return value === 'dark' || value === 'light';
}

/**
 * Resolve the theme config file path, or null when there is no usable
 * home directory (CI) — in which case persistence is skipped.
 */
export function getThemeConfigPath(): string | null {
  const home = process.env.HOME || os.homedir();
  if (!home) {
    return null;
  }
  return path.join(home, '.fabric', 'theme.json');
}

/**
 * Load the persisted theme. Falls back to DEFAULT_THEME when the file is
 * missing, unreadable, or holds anything other than 'dark' | 'light'.
 */
export function loadConfiguredTheme(): ThemeName {
  try {
    const configPath = getThemeConfigPath();
    if (configPath && fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);
      if (isThemeName(config.theme)) {
        return config.theme;
      }
    }
  } catch {
    // Ignore parse/read errors, fall back to default
  }
  return DEFAULT_THEME;
}

/**
 * Persist the theme. Silently no-ops when there is no usable home
 * directory (CI); save errors are swallowed by design — a failed theme
 * write must never take down the caller (TUI startup, HTTP request
 * handling). Callers that need confirmation can read the value back.
 */
export function saveConfiguredTheme(theme: ThemeName): void {
  try {
    const configPath = getThemeConfigPath();
    if (!configPath) return;

    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify({ theme }, null, 2), 'utf-8');
  } catch {
    // Ignore save errors
  }
}
