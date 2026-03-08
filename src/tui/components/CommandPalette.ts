/**
 * CommandPalette Component
 *
 * Universal search/command interface triggered by Ctrl+K.
 */

import blessed from 'blessed';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { colors } from '../utils/colors.js';
import { fuzzyMatch, highlightMatches } from '../utils/fuzzyMatch.js';

export interface CommandPaletteOptions {
  /** Parent screen */
  parent: blessed.Widgets.Screen;

  /** Callback when command is submitted */
  onSubmit?: (command: string) => void;

  /** Callback when search changes */
  onSearch?: (query: string) => void;
}

export interface CommandSuggestion {
  /** Display text */
  label: string;

  /** Category */
  category: string;

  /** Action to perform */
  action: string;
}

interface ScoredSuggestion {
  suggestion: CommandSuggestion;
  score: number;
  labelIndices: number[];
}

const MAX_RECENT_COMMANDS = 10;
const RECENT_COMMANDS_FILE = join(homedir(), '.fabric', 'recent-commands.json');

/**
 * Default command suggestions
 */
const DEFAULT_SUGGESTIONS: CommandSuggestion[] = [
  { label: 'Filter by worker', category: 'Filter', action: 'filter:worker:' },
  { label: 'Filter by level', category: 'Filter', action: 'filter:level:' },
  { label: 'Filter by bead', category: 'Filter', action: 'filter:bead:' },
  { label: 'Clear filters', category: 'Action', action: 'clear' },
  { label: 'Toggle pause', category: 'Action', action: 'pause' },
  { label: 'Refresh', category: 'Action', action: 'refresh' },
  { label: 'Toggle theme', category: 'Theme', action: 'theme:toggle' },
  { label: 'Dark theme', category: 'Theme', action: 'theme:dark' },
  { label: 'Light theme', category: 'Theme', action: 'theme:light' },
  { label: 'Save focus preset', category: 'Focus Preset', action: 'preset:save' },
  { label: 'List focus presets', category: 'Focus Preset', action: 'preset:list' },
  { label: 'Help', category: 'Navigation', action: 'help' },
  { label: 'Quit', category: 'Navigation', action: 'quit' },
];

/**
 * CommandPalette provides a searchable command interface
 */
export class CommandPalette {
  private box: blessed.Widgets.BoxElement;
  private input: blessed.Widgets.TextboxElement;
  private suggestionBox: blessed.Widgets.ListElement;
  private onSubmit?: (command: string) => void;
  private onSearch?: (query: string) => void;
  private suggestions: CommandSuggestion[];
  private scoredSuggestions: ScoredSuggestion[];
  private selectedIndex = 0;
  private recentCommands: string[];

  constructor(options: CommandPaletteOptions) {
    this.onSubmit = options.onSubmit;
    this.onSearch = options.onSearch;
    this.suggestions = [...DEFAULT_SUGGESTIONS];
    this.scoredSuggestions = this.suggestions.map(s => ({ suggestion: s, score: 0, labelIndices: [] }));
    this.recentCommands = CommandPalette.loadRecentCommands();

    // Container box
    this.box = blessed.box({
      parent: options.parent,
      tags: true,
      top: 'center',
      left: 'center',
      width: '60%',
      height: 12,
      hidden: true,
      style: {
        bg: 'black',
      },
    });

    // Input textbox
    this.input = blessed.textbox({
      parent: this.box,
      top: 0,
      left: 0,
      right: 0,
      height: 3,
      border: { type: 'line' },
      style: {
        border: { fg: colors.focus },
        focus: {
          border: { fg: colors.focus },
        },
      },
      label: ' Command (Ctrl+K to close) ',
      inputOnFocus: true,
    });

    // Suggestions list
    this.suggestionBox = blessed.list({
      parent: this.box,
      top: 3,
      left: 0,
      right: 0,
      bottom: 0,
      border: { type: 'line' },
      style: {
        border: { fg: colors.border },
        selected: {
          bg: colors.focus,
          fg: 'black',
        },
      },
      keys: true,
      vi: true,
      mouse: true,
    });

    this.bindEvents();
    this.renderSuggestions();
  }

  private bindEvents(): void {
    // Input changes
    this.input.on('keypress', (ch, key) => {
      if (key.name === 'escape') {
        this.hide();
        return;
      }

      if (key.name === 'down') {
        this.selectNext();
        return;
      }

      if (key.name === 'up') {
        this.selectPrevious();
        return;
      }

      if (key.name === 'enter') {
        this.executeSelected();
        return;
      }

      // Filter suggestions based on input
      const value = this.input.getValue();
      this.filterSuggestions(value);
    });

    // Submit on enter
    this.input.on('submit', (value) => {
      if (this.onSubmit) {
        this.onSubmit(value);
      }
      this.hide();
    });

    // Cancel on escape
    this.input.key(['escape'], () => {
      this.hide();
    });
  }

  private filterSuggestions(query: string): void {
    if (!query) {
      // No query: show recent commands first, then all suggestions
      const recentSet = new Set(this.recentCommands);
      const recentSuggestions: ScoredSuggestion[] = [];
      const otherSuggestions: ScoredSuggestion[] = [];

      for (const s of this.suggestions) {
        const entry: ScoredSuggestion = { suggestion: s, score: 0, labelIndices: [] };
        if (recentSet.has(s.action)) {
          // Order by recency (index in recentCommands)
          recentSuggestions.push(entry);
        } else {
          otherSuggestions.push(entry);
        }
      }

      // Sort recent by recency order
      recentSuggestions.sort((a, b) =>
        this.recentCommands.indexOf(a.suggestion.action) -
        this.recentCommands.indexOf(b.suggestion.action)
      );

      this.scoredSuggestions = [...recentSuggestions, ...otherSuggestions];
    } else {
      // Fuzzy match each suggestion across label, category, and action
      const scored: ScoredSuggestion[] = [];

      for (const s of this.suggestions) {
        const labelMatch = fuzzyMatch(s.label, query);
        const catMatch = fuzzyMatch(s.category, query);
        const actionMatch = fuzzyMatch(s.action, query);

        // Pick the best match across all fields
        let bestScore = -Infinity;
        let labelIndices: number[] = [];

        if (labelMatch) {
          bestScore = labelMatch.score;
          labelIndices = labelMatch.matchIndices;
        }
        if (catMatch && catMatch.score > bestScore) {
          bestScore = catMatch.score;
          labelIndices = []; // Matched on category, no label highlights
        }
        if (actionMatch && actionMatch.score > bestScore) {
          bestScore = actionMatch.score;
          labelIndices = []; // Matched on action, no label highlights
        }

        if (bestScore > -Infinity) {
          // Boost recently-used commands
          const recentIdx = this.recentCommands.indexOf(s.action);
          if (recentIdx >= 0) {
            bestScore += (MAX_RECENT_COMMANDS - recentIdx);
          }
          scored.push({ suggestion: s, score: bestScore, labelIndices });
        }
      }

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score);
      this.scoredSuggestions = scored;
    }

    this.selectedIndex = 0;
    this.renderSuggestions();
  }

  private renderSuggestions(): void {
    const items = this.scoredSuggestions.map((entry, i) => {
      const s = entry.suggestion;
      const label = entry.labelIndices.length > 0
        ? highlightMatches(s.label, entry.labelIndices, '{yellow-fg}', '{/}')
        : s.label;
      const prefix = `${s.category}: `;
      const selected = i === this.selectedIndex ? '{green-fg}' : '';
      const end = i === this.selectedIndex ? '{/}' : '';
      return `${selected}${prefix}${label}${end}`;
    });

    this.suggestionBox.setItems(items);
    this.suggestionBox.select(this.selectedIndex);
    this.box.screen.render();
  }

  private selectNext(): void {
    if (this.scoredSuggestions.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.scoredSuggestions.length;
    this.renderSuggestions();
  }

  private selectPrevious(): void {
    if (this.scoredSuggestions.length === 0) return;
    this.selectedIndex = this.selectedIndex === 0
      ? this.scoredSuggestions.length - 1
      : this.selectedIndex - 1;
    this.renderSuggestions();
  }

  private executeSelected(): void {
    const entry = this.scoredSuggestions[this.selectedIndex];
    if (entry && this.onSubmit) {
      this.addRecentCommand(entry.suggestion.action);
      this.onSubmit(entry.suggestion.action);
    }
    this.hide();
  }

  private addRecentCommand(action: string): void {
    this.recentCommands = [action, ...this.recentCommands.filter(c => c !== action)]
      .slice(0, MAX_RECENT_COMMANDS);
    CommandPalette.saveRecentCommands(this.recentCommands);
  }

  private static loadRecentCommands(): string[] {
    try {
      if (existsSync(RECENT_COMMANDS_FILE)) {
        const data = readFileSync(RECENT_COMMANDS_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) return parsed.slice(0, MAX_RECENT_COMMANDS);
      }
    } catch {
      // Ignore read errors
    }
    return [];
  }

  private static saveRecentCommands(commands: string[]): void {
    try {
      const dir = join(homedir(), '.fabric');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(RECENT_COMMANDS_FILE, JSON.stringify(commands));
    } catch {
      // Ignore write errors
    }
  }

  /**
   * Show the command palette
   */
  show(): void {
    this.box.show();
    this.input.setValue('');
    this.filterSuggestions('');
    this.selectedIndex = 0;
    this.input.focus();
    this.box.screen.render();
  }

  /**
   * Hide the command palette
   */
  hide(): void {
    this.box.hide();
    this.box.screen.render();
  }

  /**
   * Toggle visibility
   */
  toggle(): void {
    if (this.box.hidden) {
      this.show();
    } else {
      this.hide();
    }
  }

  /**
   * Check if visible
   */
  isVisible(): boolean {
    return !this.box.hidden;
  }

  /**
   * Add custom suggestion
   */
  addSuggestion(suggestion: CommandSuggestion): void {
    this.suggestions.push(suggestion);
  }

  /**
   * Add multiple suggestions at once
   */
  addSuggestions(suggestions: CommandSuggestion[]): void {
    this.suggestions.push(...suggestions);
  }

  /**
   * Clear custom suggestions (keep defaults)
   */
  clearSuggestions(): void {
    this.suggestions = [...DEFAULT_SUGGESTIONS];
  }

  /**
   * Set suggestions to defaults plus additional ones
   */
  setSuggestions(suggestions: CommandSuggestion[]): void {
    this.suggestions = [...DEFAULT_SUGGESTIONS, ...suggestions];
  }
}

export function createCommandPalette(options: CommandPaletteOptions): CommandPalette {
  return new CommandPalette(options);
}
