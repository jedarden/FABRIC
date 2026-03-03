/**
 * DiffView Component
 *
 * Renders unified diffs from Edit tool calls.
 * Shows additions in green, deletions in red, with line numbers.
 */

import * as blessed from 'blessed';
import { colors } from '../utils/colors.js';

export interface DiffViewOptions {
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

  /** Maximum lines to show before truncation */
  maxLines?: number;
}

export interface DiffLine {
  /** Line type: added, removed, context, header */
  type: 'added' | 'removed' | 'context' | 'header';

  /** Original line number (for removed/context) */
  oldLine?: number;

  /** New line number (for added/context) */
  newLine?: number;

  /** Line content */
  content: string;
}

export interface DiffHunk {
  /** File path being diffed */
  path: string;

  /** Diff lines */
  lines: DiffLine[];

  /** Whether this is truncated */
  truncated?: boolean;
}

/**
 * Parse unified diff format into structured lines
 */
export function parseDiff(diffText: string): DiffLine[] {
  const lines: DiffLine[] = [];
  const rawLines = diffText.split('\n');

  let oldLineNum = 0;
  let newLineNum = 0;

  for (const line of rawLines) {
    // Hunk header @@ -a,b +c,d @@
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLineNum = parseInt(match[1], 10);
        newLineNum = parseInt(match[2], 10);
      }
      lines.push({ type: 'header', content: line });
      continue;
    }

    // File header
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff')) {
      lines.push({ type: 'header', content: line });
      continue;
    }

    // Context line
    if (line.startsWith(' ') || line === '') {
      lines.push({
        type: 'context',
        oldLine: oldLineNum++,
        newLine: newLineNum++,
        content: line.slice(1),
      });
      continue;
    }

    // Added line
    if (line.startsWith('+')) {
      lines.push({
        type: 'added',
        newLine: newLineNum++,
        content: line.slice(1),
      });
      continue;
    }

    // Removed line
    if (line.startsWith('-')) {
      lines.push({
        type: 'removed',
        oldLine: oldLineNum++,
        content: line.slice(1),
      });
      continue;
    }

    // Other lines (e.g., index, mode changes)
    lines.push({ type: 'context', content: line });
  }

  return lines;
}

/**
 * Format a single diff line for blessed display
 */
function formatDiffLine(line: DiffLine, width: number): string {
  const maxContentWidth = width - 12; // Account for line numbers and padding

  switch (line.type) {
    case 'header':
      return `{cyan-fg}${line.content.slice(0, maxContentWidth)}{/}`;

    case 'added':
      const addedNum = line.newLine?.toString().padStart(4) || '    ';
      return `{green-fg}+${addedNum} ${line.content.slice(0, maxContentWidth)}{/}`;

    case 'removed':
      const removedNum = line.oldLine?.toString().padStart(4) || '    ';
      return `{red-fg}-${removedNum} ${line.content.slice(0, maxContentWidth)}{/}`;

    case 'context':
      const oldNum = line.oldLine?.toString().padStart(4) || '    ';
      const newNum = line.newLine?.toString().padStart(4) || '    ';
      const truncatedContent = line.content.slice(0, maxContentWidth - 10);
      return `{gray-fg} ${oldNum} ${newNum} ${truncatedContent}{/}`;

    default:
      return line.content;
  }
}

/**
 * DiffView displays inline diffs from Edit tool calls
 */
export class DiffView {
  private box: blessed.Widgets.BoxElement;
  private currentHunk: DiffHunk | null = null;
  private maxLines: number;

  constructor(options: DiffViewOptions) {
    this.maxLines = options.maxLines || 50;

    this.box = blessed.box({
      parent: options.parent,
      top: options.top,
      left: options.left,
      width: options.width,
      height: options.height,
      label: ' Diff View ',
      border: { type: 'line' },
      style: {
        border: { fg: colors.border },
        label: { fg: colors.header },
      },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      hidden: true,
    });
  }

  /**
   * Set the diff to display
   */
  setDiff(path: string, diffText: string): void {
    const lines = parseDiff(diffText);
    const truncated = lines.length > this.maxLines;

    this.currentHunk = {
      path,
      lines: truncated ? lines.slice(0, this.maxLines) : lines,
      truncated,
    };

    this.render();
  }

  /**
   * Set diff from Edit tool parameters
   */
  setEditDiff(path: string, oldString: string, newString: string): void {
    // Generate a simple unified diff
    const diff = this.generateSimpleDiff(path, oldString, newString);
    this.setDiff(path, diff);
  }

  /**
   * Generate a simple unified diff from old/new strings
   */
  private generateSimpleDiff(path: string, oldString: string, newString: string): string {
    const oldLines = oldString.split('\n');
    const newLines = newString.split('\n');

    let diff = `--- a/${path}\n+++ b/${path}\n@@ -1,${oldLines.length} +1,${newLines.length} @@\n`;

    // Show removed lines
    for (const line of oldLines) {
      diff += `-${line}\n`;
    }

    // Show added lines
    for (const line of newLines) {
      diff += `+${line}\n`;
    }

    return diff;
  }

  /**
   * Render the current diff
   */
  render(): void {
    if (!this.currentHunk) {
      this.box.setContent('{gray-fg}No diff to display{/}');
      this.box.screen.render();
      return;
    }

    const hunk = this.currentHunk;
    const width = (this.box.width as number) - 2; // Account for border
    const lines: string[] = [];

    // Header with file path
    lines.push(`{bold}${hunk.path}{/}`);
    lines.push('{gray-fg}─────────────────────────────────────{/}');
    lines.push('');

    // Diff lines
    for (const line of hunk.lines) {
      lines.push(formatDiffLine(line, width));
    }

    // Truncation notice
    if (hunk.truncated) {
      lines.push('');
      lines.push('{yellow-fg}... truncated (press Enter to expand){/}');
    }

    this.box.setContent(lines.join('\n'));
    this.box.screen.render();
  }

  /**
   * Show the diff view
   */
  show(): void {
    this.box.show();
    this.box.screen.render();
  }

  /**
   * Hide the diff view
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
   * Get current hunk
   */
  getHunk(): DiffHunk | null {
    return this.currentHunk;
  }

  /**
   * Clear the diff
   */
  clear(): void {
    this.currentHunk = null;
    this.box.setContent('{gray-fg}No diff to display{/}');
    this.box.screen.render();
  }

  /**
   * Focus this component
   */
  focus(): void {
    this.box.focus();
  }

  /**
   * Get the underlying blessed element
   */
  getElement(): blessed.Widgets.BoxElement {
    return this.box;
  }
}

export default DiffView;
