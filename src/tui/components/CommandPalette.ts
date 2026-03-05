/**
 * CommandPalette Component
 *
 * Universal search/command interface triggered by Ctrl+K.
 */

import blessed from 'blessed';
import { colors } from '../utils/colors.js';

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
  private filteredSuggestions: CommandSuggestion[];
  private selectedIndex = 0;

  constructor(options: CommandPaletteOptions) {
    this.onSubmit = options.onSubmit;
    this.onSearch = options.onSearch;
    this.suggestions = [...DEFAULT_SUGGESTIONS];
    this.filteredSuggestions = [...this.suggestions];

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
    const q = query.toLowerCase();
    this.filteredSuggestions = this.suggestions.filter(s =>
      s.label.toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q) ||
      s.action.toLowerCase().includes(q)
    );
    this.selectedIndex = 0;
    this.renderSuggestions();
  }

  private renderSuggestions(): void {
    const items = this.filteredSuggestions.map((s, i) => {
      const selected = i === this.selectedIndex ? '{green-fg}' : '';
      const end = i === this.selectedIndex ? '{/}' : '';
      return `${selected}${s.category}: ${s.label}${end}`;
    });

    this.suggestionBox.setItems(items);
    this.suggestionBox.select(this.selectedIndex);
    this.box.screen.render();
  }

  private selectNext(): void {
    if (this.filteredSuggestions.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.filteredSuggestions.length;
    this.renderSuggestions();
  }

  private selectPrevious(): void {
    if (this.filteredSuggestions.length === 0) return;
    this.selectedIndex = this.selectedIndex === 0
      ? this.filteredSuggestions.length - 1
      : this.selectedIndex - 1;
    this.renderSuggestions();
  }

  private executeSelected(): void {
    const selected = this.filteredSuggestions[this.selectedIndex];
    if (selected && this.onSubmit) {
      this.onSubmit(selected.action);
    }
    this.hide();
  }

  /**
   * Show the command palette
   */
  show(): void {
    this.box.show();
    this.input.setValue('');
    this.filteredSuggestions = [...this.suggestions];
    this.selectedIndex = 0;
    this.renderSuggestions();
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
   * Clear custom suggestions
   */
  clearSuggestions(): void {
    this.suggestions = [...DEFAULT_SUGGESTIONS];
  }
}

export function createCommandPalette(options: CommandPaletteOptions): CommandPalette {
  return new CommandPalette(options);
}
