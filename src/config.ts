/**
 * FABRIC Config CLI Command
 *
 * Usage:
 *   fabric config              - Show current configuration
 *   fabric config theme        - Show/set theme
 *   fabric config presets      - Manage focus presets
 *   fabric config clear        - Clear all config state
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Command } from 'commander';
import { createTuiPresetManager } from './focusPresets.js';

const HOME = process.env.HOME || '';
const CONFIG_DIR = path.join(HOME, '.fabric');

/**
 * Config file paths
 */
const CONFIG_FILES = {
  theme: path.join(CONFIG_DIR, 'theme.json'),
  presets: path.join(CONFIG_DIR, 'focus-presets.json'),
  recentCommands: path.join(CONFIG_DIR, 'recent-commands.json'),
  filterState: path.join(HOME, '.fabric-filter-state.json'),
};

/**
 * Show current configuration
 */
function showConfig(): void {
  console.log('FABRIC Configuration');
  console.log('===================');
  console.log(`Config directory: ${CONFIG_DIR}`);
  console.log('');

  // Theme
  console.log('Theme:');
  const theme = loadTheme();
  console.log(`  Current: ${theme}`);
  console.log(`  File: ${CONFIG_FILES.theme}`);
  console.log('');

  // Presets
  console.log('Focus Presets:');
  const presetManager = createTuiPresetManager();
  const presets = presetManager.getPresets();
  if (presets.length === 0) {
    console.log('  No presets saved');
  } else {
    console.log(`  Count: ${presets.length}`);
    presets.forEach(p => {
      const createdAt = new Date(p.createdAt).toLocaleString();
      console.log(`  - ${p.name}`);
      console.log(`    Workers: ${p.pinnedWorkers.length}, Beads: ${p.pinnedBeads.length}`);
      console.log(`    Created: ${createdAt}`);
      if (p.description) {
        console.log(`    Description: ${p.description}`);
      }
    });
  }
  console.log(`  File: ${CONFIG_FILES.presets}`);
  console.log('');

  // Recent commands
  console.log('Recent Commands:');
  const recentCommands = loadRecentCommands();
  if (recentCommands.length === 0) {
    console.log('  No recent commands');
  } else {
    console.log(`  Count: ${recentCommands.length}`);
    recentCommands.slice(0, 5).forEach((cmd, i) => {
      console.log(`  ${i + 1}. ${cmd}`);
    });
    if (recentCommands.length > 5) {
      console.log(`  ... and ${recentCommands.length - 5} more`);
    }
  }
  console.log(`  File: ${CONFIG_FILES.recentCommands}`);
  console.log('');

  // Filter state
  console.log('Filter State:');
  const filterState = loadFilterState();
  if (!filterState) {
    console.log('  No saved filter state');
  } else {
    console.log('  Saved filters:');
    for (const [key, value] of Object.entries(filterState)) {
      console.log(`    ${key}: ${value}`);
    }
  }
  console.log(`  File: ${CONFIG_FILES.filterState}`);
}

/**
 * Load current theme from config
 */
function loadTheme(): string {
  try {
    if (fs.existsSync(CONFIG_FILES.theme)) {
      const content = fs.readFileSync(CONFIG_FILES.theme, 'utf-8');
      const config = JSON.parse(content);
      return config.theme || 'dark';
    }
  } catch {
    // Ignore errors
  }
  return 'dark';
}

/**
 * Set theme in config
 */
function setTheme(theme: string): void {
  if (theme !== 'dark' && theme !== 'light') {
    console.error(`Invalid theme: ${theme}. Must be 'dark' or 'light'.`);
    process.exit(1);
  }

  try {
    // Ensure config directory exists
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }

    const config = { theme };
    fs.writeFileSync(CONFIG_FILES.theme, JSON.stringify(config, null, 2), 'utf-8');
    console.log(`Theme set to: ${theme}`);
  } catch (err) {
    console.error(`Failed to set theme: ${(err as Error).message}`);
    process.exit(1);
  }
}

/**
 * Load recent commands from config
 */
function loadRecentCommands(): string[] {
  try {
    if (fs.existsSync(CONFIG_FILES.recentCommands)) {
      const data = fs.readFileSync(CONFIG_FILES.recentCommands, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    // Ignore errors
  }
  return [];
}

/**
 * Load filter state from config
 */
function loadFilterState(): Record<string, unknown> | null {
  try {
    if (fs.existsSync(CONFIG_FILES.filterState)) {
      const data = fs.readFileSync(CONFIG_FILES.filterState, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    // Ignore errors
  }
  return null;
}

/**
 * List focus presets
 */
function listPresets(): void {
  const presetManager = createTuiPresetManager();
  const presets = presetManager.getPresets();

  console.log('Focus Presets');
  console.log('=============');

  if (presets.length === 0) {
    console.log('No presets saved.');
    console.log('');
    console.log('Create a preset from the TUI by:');
    console.log('  1. Pin workers and beads in focus mode');
    console.log('  2. Open command palette (Ctrl+P)');
    console.log('  3. Select "Save current view as preset"');
    return;
  }

  presets.forEach(preset => {
    const createdAt = new Date(preset.createdAt).toLocaleString();
    console.log('');
    console.log(`Name: ${preset.name}`);
    console.log(`  Workers: ${preset.pinnedWorkers.length > 0 ? preset.pinnedWorkers.join(', ') : 'none'}`);
    console.log(`  Beads: ${preset.pinnedBeads.length > 0 ? preset.pinnedBeads.join(', ') : 'none'}`);
    console.log(`  Created: ${createdAt}`);
    if (preset.description) {
      console.log(`  Description: ${preset.description}`);
    }
  });
}

/**
 * Delete a focus preset
 */
function deletePreset(name: string): void {
  const presetManager = createTuiPresetManager();

  if (!presetManager.hasPreset(name)) {
    console.error(`Preset not found: ${name}`);
    console.log('');
    console.log('Available presets:');
    const presets = presetManager.getPresetNames();
    if (presets.length === 0) {
      console.log('  (none)');
    } else {
      presets.forEach(p => console.log(`  - ${p}`));
    }
    process.exit(1);
  }

  if (presetManager.deletePreset(name)) {
    console.log(`Deleted preset: ${name}`);
  } else {
    console.error(`Failed to delete preset: ${name}`);
    process.exit(1);
  }
}

/**
 * Clear all config state
 */
function clearConfig(options: { theme?: boolean; presets?: boolean; commands?: boolean; filters?: boolean; all?: boolean }): void {
  const filesToDelete: string[] = [];

  if (options.all || options.theme) {
    filesToDelete.push(CONFIG_FILES.theme);
  }
  if (options.all || options.presets) {
    filesToDelete.push(CONFIG_FILES.presets);
  }
  if (options.all || options.commands) {
    filesToDelete.push(CONFIG_FILES.recentCommands);
  }
  if (options.all || options.filters) {
    filesToDelete.push(CONFIG_FILES.filterState);
  }

  if (filesToDelete.length === 0) {
    console.log('Nothing to clear. Use --all or specify what to clear.');
    console.log('');
    console.log('Options:');
    console.log('  --theme     Clear theme preference');
    console.log('  --presets   Clear focus presets');
    console.log('  --commands  Clear recent commands');
    console.log('  --filters   Clear filter state');
    console.log('  --all       Clear all config');
    return;
  }

  let deletedCount = 0;
  for (const file of filesToDelete) {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        console.log(`Deleted: ${file}`);
        deletedCount++;
      } else {
        console.log(`Not found (skipped): ${file}`);
      }
    } catch (err) {
      console.error(`Failed to delete ${file}: ${(err as Error).message}`);
    }
  }

  if (deletedCount === 0) {
    console.log('');
    console.log('No files were deleted.');
  } else {
    console.log('');
    console.log(`Deleted ${deletedCount} config file(s).`);
  }
}

/**
 * Create the config command
 */
export function createConfigCommand(): Command {
  const cmd = new Command('config')
    .description('Manage FABRIC configuration')
    .action(() => {
      showConfig();
    });

  // Theme subcommand
  cmd.command('theme')
    .description('Show or set theme')
    .argument('[theme]', 'Theme to set (dark or light)')
    .action((theme?: string) => {
      if (theme) {
        setTheme(theme);
      } else {
        console.log(`Current theme: ${loadTheme()}`);
      }
    });

  // Presets subcommand
  const presetsCmd = cmd.command('presets')
    .description('Manage focus presets');

  presetsCmd.command('list')
    .alias('ls')
    .description('List all focus presets')
    .action(() => {
      listPresets();
    });

  presetsCmd.command('delete')
    .alias('rm')
    .description('Delete a focus preset')
    .argument('<name>', 'Preset name to delete')
    .action((name: string) => {
      deletePreset(name);
    });

  // Clear subcommand
  cmd.command('clear')
    .description('Clear configuration state')
    .option('--theme', 'Clear theme preference')
    .option('--presets', 'Clear focus presets')
    .option('--commands', 'Clear recent commands')
    .option('--filters', 'Clear filter state')
    .option('--all', 'Clear all config')
    .action((options) => {
      clearConfig(options);
    });

  return cmd;
}
