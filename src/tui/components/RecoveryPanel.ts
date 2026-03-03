/**
 * FABRIC Recovery Panel Component
 *
 * Displays recovery suggestions when workers encounter errors.
 * Shows actionable steps based on error patterns.
 */

import {
  RecoverySuggestion,
  RecoveryAction,
  RecoveryPriority,
  RecoveryActionType,
  ErrorCategory,
} from '../../types.js';
import { formatRecoveryAction } from '../utils/recoveryPlaybook.js';
import { colors } from '../utils/colors.js';

// blessed is imported dynamically

// ============================================
// Constants
// ============================================

const PRIORITY_COLORS: Record<RecoveryPriority, string> = {
  immediate: 'red',
  high: 'yellow',
  normal: 'blue',
  low: 'green',
};

const ACTION_TYPE_ICONS: Record<RecoveryActionType, string> = {
  retry: '🔄',
  backoff: '⏳',
  alternative: '🔀',
  escalate: '👤',
  skip: '⏭️',
  fix_config: '⚙️',
  install_dep: '📦',
  fix_permissions: '🔐',
  cleanup: '🧹',
  restart: '🔁',
  investigate: '🔍',
};

const CATEGORY_ICONS: Record<ErrorCategory, string> = {
  network: '🌐',
  permission: '🔐',
  validation: '✓',
  resource: '💾',
  not_found: '❓',
  timeout: '⏱️',
  syntax: '📝',
  tool: '🔧',
  unknown: '❗',
};

const CATEGORY_LABELS: Record<ErrorCategory, string> = {
  network: 'Network Error',
  permission: 'Permission Denied',
  validation: 'Validation Error',
  resource: 'Resource Limit',
  not_found: 'Not Found',
  timeout: 'Timeout',
  syntax: 'Syntax Error',
  tool: 'Tool Error',
  unknown: 'Unknown Error',
};

// ============================================
// Helper Functions
// ============================================

/**
 * Format confidence as percentage
 */
function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

/**
 * Get priority badge
 */
function getPriorityBadge(priority: RecoveryPriority): string {
  const badges: Record<RecoveryPriority, string> = {
    immediate: '[!!!]',
    high: '[!!]',
    normal: '[!]',
    low: '[.]',
  };
  return badges[priority];
}

/**
 * Format estimated time
 */
function formatEstimatedTime(seconds?: number): string {
  if (!seconds) return '';
  if (seconds < 60) return `~${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `~${minutes}m ${secs}s` : `~${minutes}m`;
}

/**
 * Truncate string with ellipsis
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

// ============================================
// Recovery Panel Component
// ============================================

export interface RecoveryPanelOptions {
  /** Parent blessed box */
  parent: any;
  /** Panel width */
  width?: number | string;
  /** Panel height */
  height?: number | string;
  /** Top position */
  top?: number | string;
  /** Left position */
  left?: number | string;
  /** Show only active suggestions */
  activeOnly?: boolean;
  /** Maximum suggestions to show */
  maxSuggestions?: number;
  /** Maximum actions per suggestion */
  maxActions?: number;
  /** Show automated only */
  automatedOnly?: boolean;
}

export class RecoveryPanel {
  private options: Required<RecoveryPanelOptions>;
  private container: any;
  private headerBox: any;
  private contentBox: any;
  private suggestions: RecoverySuggestion[] = [];
  private selectedIndex = 0;
  private expandedIndex = -1;

  constructor(options: RecoveryPanelOptions) {
    this.options = {
      parent: options.parent,
      width: options.width ?? '100%',
      height: options.height ?? '100%',
      top: options.top ?? 0,
      left: options.left ?? 0,
      activeOnly: options.activeOnly ?? true,
      maxSuggestions: options.maxSuggestions ?? 10,
      maxActions: options.maxActions ?? 5,
      automatedOnly: options.automatedOnly ?? false,
    };

    this.createWidgets();
  }

  /**
   * Create blessed widgets
   */
  private createWidgets(): void {
    const blessed = require('blessed');

    // Main container
    this.container = blessed.box({
      parent: this.options.parent,
      width: this.options.width,
      height: this.options.height,
      top: this.options.top,
      left: this.options.left,
      style: {
        border: { fg: 'blue' },
      },
    });

    // Header
    this.headerBox = blessed.box({
      parent: this.container,
      top: 0,
      left: 0,
      right: 0,
      height: 3,
      content: ' Recovery Playbook ',
      tags: true,
      style: {
        bg: 'blue',
        fg: 'white',
        bold: true,
      },
    });

    // Content area
    this.contentBox = blessed.box({
      parent: this.container,
      top: 3,
      left: 0,
      right: 0,
      bottom: 0,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
      style: {
        fg: 'white',
        bg: 'black',
      },
    });

    // Key bindings
    this.contentBox.key(['up', 'k'], () => this.navigateUp());
    this.contentBox.key(['down', 'j'], () => this.navigateDown());
    this.contentBox.key(['enter', 'space'], () => this.toggleExpand());
    this.contentBox.key(['escape'], () => this.collapse());
  }

  /**
   * Update suggestions
   */
  updateSuggestions(suggestions: RecoverySuggestion[]): void {
    let filtered = suggestions;

    if (this.options.activeOnly) {
      filtered = filtered.filter((s) => s.isActive);
    }

    if (this.options.automatedOnly) {
      filtered = filtered.filter((s) =>
        s.actions.some((a) => a.automated)
      );
    }

    this.suggestions = filtered.slice(0, this.options.maxSuggestions);
    this.selectedIndex = Math.min(this.selectedIndex, this.suggestions.length - 1);
    this.selectedIndex = Math.max(0, this.selectedIndex);

    this.render();
  }

  /**
   * Render the panel
   */
  private render(): void {
    if (this.suggestions.length === 0) {
      this.renderEmpty();
      return;
    }

    const lines: string[] = [];

    // Header line
    const activeCount = this.suggestions.filter((s) => s.isActive).length;
    lines.push(
      `{bold}${this.suggestions.length}{/bold} suggestions (${activeCount} active)`
    );
    lines.push('');

    for (let i = 0; i < this.suggestions.length; i++) {
      const suggestion = this.suggestions[i];
      const isSelected = i === this.selectedIndex;
      const isExpanded = i === this.expandedIndex;

      lines.push(this.renderSuggestion(suggestion, isSelected, isExpanded));

      if (isExpanded) {
        lines.push('');
        lines.push(this.renderActions(suggestion));
      }

      lines.push('');
    }

    // Footer
    lines.push('{gray-fg}↑↓ Navigate | Enter Expand | Esc Collapse{/}');

    this.contentBox.setContent(lines.join('\n'));
    this.contentBox.screen.render();
  }

  /**
   * Render empty state
   */
  private renderEmpty(): void {
    const lines = [
      '{center}{bold}No Recovery Suggestions{/}{/center}',
      '',
      '{center}No active errors requiring recovery actions.{/}',
      '',
      '{center}{gray-fg}Errors will appear here when workers encounter issues.{/}{/}',
    ];

    this.contentBox.setContent(lines.join('\n'));
    this.contentBox.screen.render();
  }

  /**
   * Render a single suggestion
   */
  private renderSuggestion(
    suggestion: RecoverySuggestion,
    isSelected: boolean,
    isExpanded: boolean
  ): string {
    const icon = CATEGORY_ICONS[suggestion.category];
    const categoryLabel = CATEGORY_LABELS[suggestion.category];
    const confidence = formatConfidence(suggestion.confidence);
    const workers = suggestion.affectedWorkers.length;
    const activeBadge = suggestion.isActive ? '{green-fg}[ACTIVE]{/}' : '{gray-fg}[RESOLVED]{/}';
    const expandIcon = isExpanded ? '▼' : '▶';
    const selectPrefix = isSelected ? '{bold}▸{/} ' : '  ';

    const header = `${selectPrefix}${expandIcon} ${icon} ${suggestion.title}`;
    const meta = `${activeBadge} Confidence: ${confidence} | Workers: ${workers}`;

    const lines = [
      header,
      `    ${truncate(suggestion.errorSummary, 80)}`,
      `    ${meta}`,
    ];

    return lines.join('\n');
  }

  /**
   * Render actions for a suggestion
   */
  private renderActions(suggestion: RecoverySuggestion): string {
    const lines: string[] = ['    {bold}Recovery Actions:{/}'];

    const actions = suggestion.actions.slice(0, this.options.maxActions);

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const badge = getPriorityBadge(action.priority);
      const autoBadge = action.automated ? '{green-fg}[AUTO]{/}' : '{yellow-fg}[MANUAL]{/}';
      const icon = ACTION_TYPE_ICONS[action.type];

      lines.push(
        `      ${badge} ${icon} ${autoBadge} ${action.title}`
      );

      if (action.description) {
        lines.push(`          {gray-fg}${truncate(action.description, 70)}{/}`);
      }

      if (action.command) {
        lines.push(`          {cyan-fg}$ ${truncate(action.command, 60)}{/}`);
      }

      if (action.estimatedTime) {
        lines.push(`          {blue-fg}Est. time: ${formatEstimatedTime(action.estimatedTime)}{/}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Navigate up
   */
  private navigateUp(): void {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
      this.render();
    }
  }

  /**
   * Navigate down
   */
  private navigateDown(): void {
    if (this.selectedIndex < this.suggestions.length - 1) {
      this.selectedIndex++;
      this.render();
    }
  }

  /**
   * Toggle expand selected suggestion
   */
  private toggleExpand(): void {
    if (this.expandedIndex === this.selectedIndex) {
      this.expandedIndex = -1;
    } else {
      this.expandedIndex = this.selectedIndex;
    }
    this.render();
  }

  /**
   * Collapse expanded suggestion
   */
  private collapse(): void {
    this.expandedIndex = -1;
    this.render();
  }

  /**
   * Get selected suggestion
   */
  getSelected(): RecoverySuggestion | null {
    return this.suggestions[this.selectedIndex] ?? null;
  }

  /**
   * Focus the panel
   */
  focus(): void {
    this.contentBox.focus();
  }

  /**
   * Destroy the panel
   */
  destroy(): void {
    this.container.destroy();
  }
}

// ============================================
// Quick Recovery Display Function
// ============================================

/**
 * Format recovery suggestions for console output
 */
export function formatRecoveryForConsole(suggestions: RecoverySuggestion[]): string {
  if (suggestions.length === 0) {
    return 'No recovery suggestions available.';
  }

  const lines: string[] = [];

  lines.push('╔══════════════════════════════════════════════════════════════╗');
  lines.push('║                    RECOVERY PLAYBOOK                          ║');
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  lines.push('');

  for (const suggestion of suggestions.slice(0, 5)) {
    const icon = CATEGORY_ICONS[suggestion.category];
    const activeBadge = suggestion.isActive ? '✓' : '○';

    lines.push(`${activeBadge} ${icon} ${suggestion.title}`);
    lines.push(`   ${truncate(suggestion.errorSummary, 60)}`);
    lines.push(`   Confidence: ${formatConfidence(suggestion.confidence)}`);

    if (suggestion.actions.length > 0) {
      const topAction = suggestion.actions[0];
      const actionIcon = ACTION_TYPE_ICONS[topAction.type];
      const autoBadge = topAction.automated ? '[AUTO]' : '[MANUAL]';

      lines.push(`   → ${actionIcon} ${autoBadge} ${topAction.title}`);
    }

    lines.push('');
  }

  if (suggestions.length > 5) {
    lines.push(`... and ${suggestions.length - 5} more suggestions`);
  }

  return lines.join('\n');
}

/**
 * Get a quick summary of recovery suggestions
 */
export function getRecoverySummary(suggestions: RecoverySuggestion[]): {
  total: number;
  active: number;
  byCategory: Record<ErrorCategory, number>;
  automatedAvailable: number;
} {
  const byCategory: Record<ErrorCategory, number> = {
    network: 0,
    permission: 0,
    validation: 0,
    resource: 0,
    not_found: 0,
    timeout: 0,
    syntax: 0,
    tool: 0,
    unknown: 0,
  };

  let automatedAvailable = 0;

  for (const suggestion of suggestions) {
    byCategory[suggestion.category]++;
    if (suggestion.actions.some((a) => a.automated)) {
      automatedAvailable++;
    }
  }

  return {
    total: suggestions.length,
    active: suggestions.filter((s) => s.isActive).length,
    byCategory,
    automatedAvailable,
  };
}
