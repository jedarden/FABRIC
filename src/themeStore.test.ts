/**
 * Tests for the shared FABRIC theme store
 * (~/.fabric/theme.json — read/written by `fabric config theme`, the TUI,
 * and the web server API)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadConfiguredTheme,
  saveConfiguredTheme,
  getThemeConfigPath,
  isThemeName,
  DEFAULT_THEME,
} from './themeStore.js';

// ESM namespaces can't be spied on, so replace the whole module and keep a
// hoisted switch to force an empty homedir (the CI no-HOME case).
const homedirOverride = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => homedirOverride.value ?? actual.homedir(),
  };
});

describe('themeStore', () => {
  let tmpHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-theme-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    homedirOverride.value = null;
  });

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    homedirOverride.value = null;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  describe('isThemeName', () => {
    it('accepts dark and light', () => {
      expect(isThemeName('dark')).toBe(true);
      expect(isThemeName('light')).toBe(true);
    });

    it('rejects anything else', () => {
      expect(isThemeName('system')).toBe(false);
      expect(isThemeName('')).toBe(false);
      expect(isThemeName(null)).toBe(false);
      expect(isThemeName(undefined)).toBe(false);
      expect(isThemeName(1)).toBe(false);
    });
  });

  describe('getThemeConfigPath', () => {
    it('resolves under HOME/.fabric', () => {
      expect(getThemeConfigPath()).toBe(path.join(tmpHome, '.fabric', 'theme.json'));
    });

    it('returns null when HOME is unset and homedir is empty', () => {
      delete process.env.HOME;
      homedirOverride.value = '';
      expect(getThemeConfigPath()).toBeNull();
    });
  });

  describe('loadConfiguredTheme', () => {
    it('defaults to dark when no config file exists', () => {
      expect(loadConfiguredTheme()).toBe('dark');
      expect(DEFAULT_THEME).toBe('dark');
    });

    it('reads a persisted theme', () => {
      const dir = path.join(tmpHome, '.fabric');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify({ theme: 'light' }));

      expect(loadConfiguredTheme()).toBe('light');
    });

    it('falls back to default on invalid JSON', () => {
      const dir = path.join(tmpHome, '.fabric');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'theme.json'), '{ not json');

      expect(loadConfiguredTheme()).toBe('dark');
    });

    it('falls back to default on an unrecognized theme value', () => {
      const dir = path.join(tmpHome, '.fabric');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify({ theme: 'solarized' }));

      expect(loadConfiguredTheme()).toBe('dark');
    });
  });

  describe('saveConfiguredTheme', () => {
    it('creates the config directory and persists the theme', () => {
      saveConfiguredTheme('light');

      const file = path.join(tmpHome, '.fabric', 'theme.json');
      expect(fs.existsSync(file)).toBe(true);
      expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({ theme: 'light' });
      expect(loadConfiguredTheme()).toBe('light');
    });

    it('overwrites an existing value', () => {
      saveConfiguredTheme('light');
      saveConfiguredTheme('dark');

      expect(loadConfiguredTheme()).toBe('dark');
    });

    it('no-ops without throwing when there is no home directory', () => {
      delete process.env.HOME;
      homedirOverride.value = '';

      expect(() => saveConfiguredTheme('light')).not.toThrow();
      expect(loadConfiguredTheme()).toBe('dark');
    });

    it('no-ops without throwing when the config directory cannot be created', () => {
      // HOME pointing at a regular file: <file>/.fabric can never exist
      const notADir = path.join(tmpHome, 'blocker');
      fs.writeFileSync(notADir, 'x');
      process.env.HOME = notADir;

      expect(() => saveConfiguredTheme('light')).not.toThrow();
      expect(loadConfiguredTheme()).toBe('dark');
    });
  });
});
