/**
 * FilterPanel Component
 *
 * Provides interactive UI controls for filtering ActivityStream.
 */

import blessed from 'blessed';
import { colors } from '../utils/colors.js';
import { ActivityFilter } from './ActivityStream.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface FilterPanelOptions {
  /** Parent screen */
  parent: blessed.Widgets.Screen;

  /** Position from top */
  top: number | string;

  /** Position from left */
  left: number | string;

  /** Width of the panel */
  width: number | string;

  /** Height of the panel */
  height: number | string;

  /** Callback when filter changes */
  onFilterChange?: (filter: ActivityFilter) => void;

  /** Available worker IDs for dropdown */
  workers?: string[];
}

const FILTER_STORAGE_PATH = path.join(os.homedir(), '.fabric-filter-state.json');

/**
 * FilterPanel provides UI controls for filtering
 */
export class FilterPanel {
  private box: blessed.Widgets.BoxElement;
  private filter: ActivityFilter = {};
  private onFilterChange?: (filter: ActivityFilter) => void;
  private workers: string[];
  private form: blessed.Widgets.FormElement<unknown>;
  private workerInput: blessed.Widgets.TextboxElement;
  private levelInput: blessed.Widgets.TextboxElement;
  private searchInput: blessed.Widgets.TextboxElement;
  private sinceInput: blessed.Widgets.TextboxElement;
  private untilInput: blessed.Widgets.TextboxElement;
  private statusText: blessed.Widgets.TextElement;

  constructor(options: FilterPanelOptions) {
    this.onFilterChange = options.onFilterChange;
    this.workers = options.workers || [];

    this.box = blessed.box({
      parent: options.parent,
      tags: true,
      top: options.top,
      left: options.left,
      width: options.width,
      height: options.height,
      label: ' Filters ',
      border: { type: 'line' },
      style: {
        border: { fg: colors.border },
        label: { fg: colors.header },
      },
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
    });

    // Create form with input fields
    this.form = blessed.form({
      parent: this.box,
      top: 0,
      left: 0,
      width: '100%-2',
      height: '100%-3',
      keys: true,
      vi: true,
    });

    // Worker filter
    blessed.text({
      parent: this.form,
      top: 0,
      left: 0,
      content: 'Worker ID:',
    });

    this.workerInput = blessed.textbox({
      parent: this.form,
      name: 'worker',
      top: 1,
      left: 0,
      width: '100%',
      height: 1,
      inputOnFocus: true,
      style: {
        fg: colors.text,
        bg: colors.inputBg,
        focus: {
          fg: colors.text,
          bg: colors.inputFocusBg,
        },
      },
    });

    // Level filter
    blessed.text({
      parent: this.form,
      top: 3,
      left: 0,
      content: 'Level (debug/info/warn/error):',
    });

    this.levelInput = blessed.textbox({
      parent: this.form,
      name: 'level',
      top: 4,
      left: 0,
      width: '100%',
      height: 1,
      inputOnFocus: true,
      style: {
        fg: colors.text,
        bg: colors.inputBg,
        focus: {
          fg: colors.text,
          bg: colors.inputFocusBg,
        },
      },
    });

    // Search filter
    blessed.text({
      parent: this.form,
      top: 6,
      left: 0,
      content: 'Search:',
    });

    this.searchInput = blessed.textbox({
      parent: this.form,
      name: 'search',
      top: 7,
      left: 0,
      width: '100%',
      height: 1,
      inputOnFocus: true,
      style: {
        fg: colors.text,
        bg: colors.inputBg,
        focus: {
          fg: colors.text,
          bg: colors.inputFocusBg,
        },
      },
    });

    // Time range - Since
    blessed.text({
      parent: this.form,
      top: 9,
      left: 0,
      content: 'Since (HH:MM or minutes ago):',
    });

    this.sinceInput = blessed.textbox({
      parent: this.form,
      name: 'since',
      top: 10,
      left: 0,
      width: '100%',
      height: 1,
      inputOnFocus: true,
      style: {
        fg: colors.text,
        bg: colors.inputBg,
        focus: {
          fg: colors.text,
          bg: colors.inputFocusBg,
        },
      },
    });

    // Time range - Until
    blessed.text({
      parent: this.form,
      top: 12,
      left: 0,
      content: 'Until (HH:MM or minutes ago):',
    });

    this.untilInput = blessed.textbox({
      parent: this.form,
      name: 'until',
      top: 13,
      left: 0,
      width: '100%',
      height: 1,
      inputOnFocus: true,
      style: {
        fg: colors.text,
        bg: colors.inputBg,
        focus: {
          fg: colors.text,
          bg: colors.inputFocusBg,
        },
      },
    });

    // Status text
    this.statusText = blessed.text({
      parent: this.box,
      bottom: 1,
      left: 0,
      width: '100%-2',
      height: 1,
      content: '',
      style: {
        fg: colors.dim,
      },
    });

    // Help text
    blessed.text({
      parent: this.box,
      bottom: 0,
      left: 0,
      width: '100%-2',
      height: 1,
      content: 'Enter: Apply | C-x: Clear All | C-s: Save',
      style: {
        fg: colors.dim,
      },
    });

    this.bindKeys();
    this.loadFilterState();
  }

  /**
   * Bind component-specific keys
   */
  private bindKeys(): void {
    // Apply filter on submit (Enter key in any input)
    this.workerInput.on('submit', () => this.applyFilter());
    this.levelInput.on('submit', () => this.applyFilter());
    this.searchInput.on('submit', () => this.applyFilter());
    this.sinceInput.on('submit', () => this.applyFilter());
    this.untilInput.on('submit', () => this.applyFilter());

    // Clear all filters
    this.box.key(['C-x'], () => {
      this.clearAllFilters();
    });

    // Save filter state
    this.box.key(['C-s'], () => {
      this.saveFilterState();
      this.showStatus('Filter state saved');
    });
  }

  /**
   * Parse time input (HH:MM or minutes ago)
   */
  private parseTimeInput(input: string): number | undefined {
    if (!input || input.trim() === '') {
      return undefined;
    }

    const trimmed = input.trim();

    // Check if it's a relative time (e.g., "5m" or "5")
    const minutesMatch = trimmed.match(/^(\d+)m?$/);
    if (minutesMatch) {
      const minutes = parseInt(minutesMatch[1], 10);
      return Date.now() - minutes * 60 * 1000;
    }

    // Check if it's HH:MM format
    const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})$/);
    if (timeMatch) {
      const hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const now = new Date();
      const targetTime = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        hours,
        minutes,
        0,
        0
      );
      return targetTime.getTime();
    }

    return undefined;
  }

  /**
   * Apply current filter values
   */
  private applyFilter(): void {
    const workerValue = this.workerInput.getValue().trim();
    const levelValue = this.levelInput.getValue().trim();
    const searchValue = this.searchInput.getValue().trim();
    const sinceValue = this.sinceInput.getValue().trim();
    const untilValue = this.untilInput.getValue().trim();

    this.filter = {
      workerId: workerValue || undefined,
      level: levelValue || undefined,
      search: searchValue || undefined,
      since: this.parseTimeInput(sinceValue),
      until: this.parseTimeInput(untilValue),
    };

    if (this.onFilterChange) {
      this.onFilterChange(this.filter);
    }

    this.showStatus('Filter applied');
  }

  /**
   * Clear all filters
   */
  clearAllFilters(): void {
    this.filter = {};
    this.workerInput.setValue('');
    this.levelInput.setValue('');
    this.searchInput.setValue('');
    this.sinceInput.setValue('');
    this.untilInput.setValue('');

    if (this.onFilterChange) {
      this.onFilterChange(this.filter);
    }

    this.showStatus('All filters cleared');
    this.box.screen.render();
  }

  /**
   * Show status message
   */
  private showStatus(message: string): void {
    this.statusText.setContent(message);
    this.box.screen.render();

    // Clear status after 3 seconds
    setTimeout(() => {
      this.statusText.setContent('');
      this.box.screen.render();
    }, 3000);
  }

  /**
   * Save filter state to disk
   */
  private saveFilterState(): void {
    try {
      const state = {
        workerId: this.workerInput.getValue(),
        level: this.levelInput.getValue(),
        search: this.searchInput.getValue(),
        since: this.sinceInput.getValue(),
        until: this.untilInput.getValue(),
      };
      fs.writeFileSync(FILTER_STORAGE_PATH, JSON.stringify(state, null, 2));
    } catch (error) {
      // Silently fail - not critical
    }
  }

  /**
   * Load filter state from disk
   */
  private loadFilterState(): void {
    try {
      if (fs.existsSync(FILTER_STORAGE_PATH)) {
        const data = fs.readFileSync(FILTER_STORAGE_PATH, 'utf-8');
        const state = JSON.parse(data);

        if (state.workerId) this.workerInput.setValue(state.workerId);
        if (state.level) this.levelInput.setValue(state.level);
        if (state.search) this.searchInput.setValue(state.search);
        if (state.since) this.sinceInput.setValue(state.since);
        if (state.until) this.untilInput.setValue(state.until);
      }
    } catch (error) {
      // Silently fail - not critical
    }
  }

  /**
   * Set filter programmatically
   */
  setFilter(filter: ActivityFilter): void {
    this.filter = filter;

    this.workerInput.setValue(filter.workerId || '');
    this.levelInput.setValue(filter.level || '');
    this.searchInput.setValue(filter.search || '');
    // Note: For time inputs, we'd need to convert back to display format
    // For now, leaving them empty when set programmatically

    this.box.screen.render();
  }

  /**
   * Update available workers list
   */
  setWorkers(workers: string[]): void {
    this.workers = workers;
  }

  /**
   * Focus this component
   */
  focus(): void {
    this.workerInput.focus();
  }

  /**
   * Get the underlying box element
   */
  getElement(): blessed.Widgets.BoxElement {
    return this.box;
  }
}

export default FilterPanel;
