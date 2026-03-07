/**
 * GitIntegration Component
 *
 * Displays live git status per workspace including current branch,
 * staged/unstaged files, recent commits, PR preview, and conflict detection.
 */

import blessed from 'blessed';
import { GitEvent, GitStatusEvent, GitCommitEvent, GitFileChange, PRPreview, PRFileChange } from '../../types.js';
import { colors } from '../utils/colors.js';
import { generatePRPreview, formatPRPreview } from '../utils/prPreview.js';

export interface GitIntegrationOptions {
  /** Parent screen */
  parent: blessed.Widgets.Screen;

  /** Position from top */
  top: number | string;

  /** Position from left */
  left: number | string;

  /** Width of the panel */
  width: number | string;

  /** Height of the panel */
  height?: number | string;

  /** Position from bottom */
  bottom?: number | string;

  /** Maximum commits to display */
  maxCommits?: number;

  /** Maximum files to display */
  maxFiles?: number;
}

/**
 * View mode for the git panel
 */
type GitViewMode = 'status' | 'pr-preview' | 'diff';

/**
 * GitIntegration displays live git status and activity with PR preview
 */
export class GitIntegration {
  private box: blessed.Widgets.BoxElement;
  private contentBox: blessed.Widgets.BoxElement;
  private buttonBox: blessed.Widgets.BoxElement;
  private maxCommits: number;
  private maxFiles: number;

  // State tracking
  private gitEvents: GitEvent[] = [];
  private currentStatus?: GitStatusEvent;
  private recentCommits: GitCommitEvent[] = [];
  private conflictDetected = false;
  private prPreview?: PRPreview;
  private viewMode: GitViewMode = 'status';

  // Workspace tracking (worker -> workspace path)
  private workspaces: Map<string, string> = new Map();

  constructor(options: GitIntegrationOptions) {
    this.maxCommits = options.maxCommits || 5;
    this.maxFiles = options.maxFiles || 10;

    this.box = blessed.box({
      parent: options.parent,
      top: options.top,
      left: options.left,
      width: options.width,
      ...(options.bottom !== undefined ? { bottom: options.bottom } : { height: options.height }),
      label: ' Git Integration ',
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
      tags: true,
    });

    // Create content box for scrollable content
    this.contentBox = blessed.box({
      parent: this.box,
      top: 0,
      left: 0,
      right: 0,
      bottom: 1,
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
    });

    // Create button bar at bottom
    this.buttonBox = blessed.box({
      parent: this.box,
      bottom: 0,
      left: 0,
      right: 0,
      height: 1,
      tags: true,
    });

    this.bindKeys();
    this.render();
  }

  /**
   * Bind component-specific keys
   */
  private bindKeys(): void {
    this.box.key(['r'], () => {
      this.refresh();
    });

    this.box.key(['c'], () => {
      this.clearHistory();
    });

    this.box.key(['p'], () => {
      this.togglePRPreview();
    });

    this.box.key(['d'], () => {
      this.toggleDiffView();
    });

    this.box.key(['s'], () => {
      this.toggleStatusView();
    });

    this.box.key(['escape'], () => {
      if (this.viewMode !== 'status') {
        this.viewMode = 'status';
        this.render();
      } else {
        this.hide();
      }
    });
  }

  private get screen(): blessed.Widgets.Screen {
    return this.box.screen;
  }

  /**
   * Toggle PR preview view
   */
  private togglePRPreview(): void {
    this.viewMode = this.viewMode === 'pr-preview' ? 'status' : 'pr-preview';
    this.render();
  }

  /**
   * Toggle diff view
   */
  private toggleDiffView(): void {
    this.viewMode = this.viewMode === 'diff' ? 'status' : 'diff';
    this.render();
  }

  /**
   * Toggle status view
   */
  private toggleStatusView(): void {
    this.viewMode = 'status';
    this.render();
  }

  /**
   * Get status icon for file change
   */
  private getFileStatusIcon(status: string): { icon: string; color: string } {
    switch (status) {
      case 'added':
        return { icon: '+', color: 'green' };
      case 'modified':
        return { icon: 'M', color: 'yellow' };
      case 'deleted':
        return { icon: '-', color: 'red' };
      case 'renamed':
        return { icon: 'R', color: 'cyan' };
      case 'copied':
        return { icon: 'C', color: 'cyan' };
      case 'untracked':
        return { icon: '?', color: 'gray' };
      case 'unmerged':
        return { icon: 'U', color: 'red' };
      default:
        return { icon: '•', color: 'white' };
    }
  }

  /**
   * Format file change for display with line counts
   */
  private formatFileChange(file: PRFileChange | GitFileChange, maxLength: number = 50): string {
    const statusInfo = this.getFileStatusIcon(file.status);
    const path = file.path.length > maxLength
      ? '...' + file.path.slice(-maxLength + 3)
      : file.path;

    let line = `{${statusInfo.color}-fg}${statusInfo.icon}{/} ${path}`;

    // Add line counts if available (PRFileChange)
    const prFile = file as PRFileChange;
    if (prFile.linesAdded !== undefined || prFile.linesDeleted !== undefined) {
      const added = prFile.linesAdded || 0;
      const deleted = prFile.linesDeleted || 0;
      if (added > 0 || deleted > 0) {
        line += ` {green-fg}+${added}{/}/{red-fg}-${deleted}{/}`;
      }
    }

    if (file.originalPath) {
      line += ` {gray-fg}(from ${file.originalPath}){/}`;
    }

    return line;
  }

  /**
   * Format commit for display
   */
  private formatCommit(commit: GitCommitEvent): string {
    const hash = commit.hash.slice(0, 7);
    const time = new Date(commit.ts).toLocaleTimeString();
    const message = commit.message.split('\n')[0].slice(0, 60);
    const author = commit.author ? ` - ${commit.author.split(' ')[0]}` : '';

    return `{yellow-fg}${hash}{/} {gray-fg}${time}{/} ${message}${author}`;
  }

  /**
   * Format relative timestamp
   */
  private formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return `${seconds}s ago`;
  }

  /**
   * Update git events
   */
  updateGitEvents(events: GitEvent[]): void {
    this.gitEvents = events;

    // Extract latest status
    const statusEvents = events.filter((e): e is GitStatusEvent => e.type === 'status');
    if (statusEvents.length > 0) {
      this.currentStatus = statusEvents[statusEvents.length - 1];

      // Check for conflicts
      this.conflictDetected = this.currentStatus.staged.some(f => f.status === 'unmerged') ||
                             this.currentStatus.unstaged.some(f => f.status === 'unmerged');
    }

    // Extract recent commits
    const commitEvents = events.filter((e): e is GitCommitEvent => e.type === 'commit');
    this.recentCommits = commitEvents.slice(-this.maxCommits);

    // Generate PR preview
    this.prPreview = generatePRPreview(events);

    this.render();
  }

  /**
   * Set workspace for a worker
   */
  setWorkspace(workerId: string, workspacePath: string): void {
    this.workspaces.set(workerId, workspacePath);
    this.render();
  }

  /**
   * Refresh the display
   */
  refresh(): void {
    this.render();
  }

  /**
   * Clear git history
   */
  clearHistory(): void {
    this.gitEvents = [];
    this.currentStatus = undefined;
    this.recentCommits = [];
    this.conflictDetected = false;
    this.prPreview = undefined;
    this.render();
  }

  /**
   * Show the panel
   */
  show(): void {
    this.box.show();
    this.box.focus();
    this.render();
  }

  /**
   * Hide the panel
   */
  hide(): void {
    this.box.hide();
    this.screen.render();
  }

  /**
   * Check if visible
   */
  isVisible(): boolean {
    return this.box.visible;
  }

  /**
   * Render status section
   */
  private renderStatus(): string {
    if (!this.currentStatus) {
      return '{gray-fg}No git status available{/}\n';
    }

    const lines: string[] = [];

    // Branch info
    const branchColor = this.conflictDetected ? 'red' : 'cyan';
    const conflictWarning = this.conflictDetected ? ' {red-fg}⚠ CONFLICTS{/}' : '';
    lines.push(`{bold}Branch:{/} {${branchColor}-fg}${this.currentStatus.branch}{/}${conflictWarning}`);

    // Tracking info
    if (this.currentStatus.tracking) {
      const ahead = this.currentStatus.ahead || 0;
      const behind = this.currentStatus.behind || 0;

      let trackingInfo = `{gray-fg}tracking ${this.currentStatus.tracking}{/}`;
      if (ahead > 0) {
        trackingInfo += ` {green-fg}↑${ahead}{/}`;
      }
      if (behind > 0) {
        trackingInfo += ` {red-fg}↓${behind}{/}`;
      }
      lines.push(`  ${trackingInfo}`);
    }

    // Commit hash
    if (this.currentStatus.commit) {
      lines.push(`{bold}Commit:{/} {yellow-fg}${this.currentStatus.commit.slice(0, 7)}{/}`);
    }

    // Last updated
    const lastUpdated = this.formatRelativeTime(this.currentStatus.ts);
    lines.push(`{gray-fg}Updated ${lastUpdated}{/}`);

    return lines.join('\n') + '\n';
  }

  /**
   * Render files section with line counts
   */
  private renderFiles(): string {
    if (!this.currentStatus) {
      return '';
    }

    const lines: string[] = [];
    const staged = this.currentStatus.staged.slice(0, this.maxFiles);
    const unstaged = this.currentStatus.unstaged.slice(0, this.maxFiles);
    const untracked = this.currentStatus.untracked.slice(0, this.maxFiles);

    // Calculate totals
    const stagedAdded = staged.length;
    const unstagedCount = unstaged.length;
    const untrackedCount = untracked.length;

    // Summary line
    if (stagedAdded > 0 || unstagedCount > 0 || untrackedCount > 0) {
      lines.push(`\n{bold}Changes:{/} {green-fg}${stagedAdded} staged{/}, {yellow-fg}${unstagedCount} unstaged{/}, {gray-fg}${untrackedCount} untracked{/}`);
    }

    // Staged files
    if (staged.length > 0) {
      lines.push(`\n{bold}{green-fg}Staged:{/}`);
      for (const file of staged) {
        lines.push(`  ${this.formatFileChange(file)}`);
      }
      if (this.currentStatus.staged.length > this.maxFiles) {
        lines.push(`  {gray-fg}... and ${this.currentStatus.staged.length - this.maxFiles} more{/}`);
      }
    }

    // Unstaged files
    if (unstaged.length > 0) {
      lines.push(`\n{bold}{yellow-fg}Unstaged:{/}`);
      for (const file of unstaged) {
        lines.push(`  ${this.formatFileChange(file)}`);
      }
      if (this.currentStatus.unstaged.length > this.maxFiles) {
        lines.push(`  {gray-fg}... and ${this.currentStatus.unstaged.length - this.maxFiles} more{/}`);
      }
    }

    // Untracked files
    if (untracked.length > 0) {
      lines.push(`\n{bold}{gray-fg}Untracked:{/}`);
      for (const file of untracked.slice(0, this.maxFiles)) {
        lines.push(`  {gray-fg}? ${file}{/}`);
      }
      if (this.currentStatus.untracked.length > this.maxFiles) {
        lines.push(`  {gray-fg}... and ${this.currentStatus.untracked.length - this.maxFiles} more{/}`);
      }
    }

    // Show clean state if no files
    if (staged.length === 0 && unstaged.length === 0 && untracked.length === 0) {
      lines.push('\n{green-fg}Working tree clean{/}');
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Render commits section
   */
  private renderCommits(): string {
    if (this.recentCommits.length === 0) {
      return '{gray-fg}No recent commits{/}';
    }

    const lines: string[] = [];
    lines.push(`\n{bold}Recent Commits (${this.recentCommits.length}):{/}`);

    for (const commit of this.recentCommits.slice().reverse()) {
      lines.push(`  ${this.formatCommit(commit)}`);
    }

    return lines.join('\n');
  }

  /**
   * Render PR preview section
   */
  private renderPRPreview(): string {
    if (!this.prPreview) {
      return '{gray-fg}No PR preview available{/}';
    }

    return formatPRPreview(this.prPreview);
  }

  /**
   * Render potential conflicts section
   */
  private renderConflicts(): string {
    if (!this.prPreview || !this.prPreview.conflicts) {
      return '';
    }

    const conflicts = this.prPreview.conflicts;
    const lines: string[] = [];

    if (conflicts.hasUpstreamCommits || conflicts.rebaseRecommended) {
      lines.push('\n{bold}{yellow-fg}⚠ Potential Conflicts{/}');
      lines.push('');

      if (conflicts.upstreamCommitCount > 0) {
        lines.push(`  {yellow-fg}main has ${conflicts.upstreamCommitCount} new commit${conflicts.upstreamCommitCount !== 1 ? 's' : ''} since branch creation{/}`);
      }

      if (conflicts.conflictingFiles.length > 0) {
        lines.push('  {gray-fg}Files that may conflict:{/}');
        for (const file of conflicts.conflictingFiles.slice(0, 3)) {
          lines.push(`    {red-fg}• ${file}{/}`);
        }
        if (conflicts.conflictingFiles.length > 3) {
          lines.push(`    {gray-fg}... and ${conflicts.conflictingFiles.length - 3} more{/}`);
        }
      }

      if (conflicts.rebaseRecommended) {
        lines.push('');
        lines.push(`  {cyan-fg}Recommendation: rebase before merging{/}`);
        if (conflicts.rebaseReason) {
          lines.push(`  {gray-fg}${conflicts.rebaseReason}{/}`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Render the button bar
   */
  private renderButtons(): string {
    const modeIndicator = this.viewMode === 'pr-preview' ? '{green-fg}[PR Preview]{/} '
                      : this.viewMode === 'diff' ? '{cyan-fg}[Diff View]{/} '
                      : '';

    return `${modeIndicator}{gray-fg}[p] Preview PR  [d] Diff  [s] Status  [r] Refresh  [c] Clear  [Esc] Back{/}`;
  }

  /**
   * Render the component
   */
  render(): void {
    let content: string;

    switch (this.viewMode) {
      case 'pr-preview':
        content = this.renderPRPreview() + '\n' + this.renderConflicts();
        break;
      case 'diff':
        content = this.renderFiles() + '\n' + this.renderCommits();
        break;
      default:
        content = this.renderStatus() + this.renderFiles() + this.renderCommits();
    }

    this.contentBox.setContent(content);
    this.buttonBox.setContent(this.renderButtons());

    // Update label
    const modeLabel = this.viewMode === 'pr-preview' ? ' PR Preview '
                    : this.viewMode === 'diff' ? ' Git Diff '
                    : ' Git Integration ';
    const conflictLabel = this.conflictDetected ? ' {red-fg}⚠ CONFLICTS{/} ' : '';
    this.box.setLabel(` ${modeLabel}${conflictLabel}`);

    this.screen.render();
  }

  /**
   * Focus this component
   */
  focus(): void {
    this.box.focus();
  }

  /**
   * Get the underlying box element
   */
  getElement(): blessed.Widgets.BoxElement {
    return this.box;
  }

  /**
   * Get conflict status
   */
  hasConflicts(): boolean {
    return this.conflictDetected;
  }

  /**
   * Get current branch name
   */
  getCurrentBranch(): string | undefined {
    return this.currentStatus?.branch;
  }

  /**
   * Get file change counts
   */
  getFileCounts(): { staged: number; unstaged: number; untracked: number } {
    if (!this.currentStatus) {
      return { staged: 0, unstaged: 0, untracked: 0 };
    }

    return {
      staged: this.currentStatus.staged.length,
      unstaged: this.currentStatus.unstaged.length,
      untracked: this.currentStatus.untracked.length,
    };
  }

  /**
   * Get recent commits count
   */
  getCommitsCount(): number {
    return this.recentCommits.length;
  }

  /**
   * Get current PR preview
   */
  getPRPreview(): PRPreview | undefined {
    return this.prPreview;
  }

  /**
   * Get current view mode
   */
  getViewMode(): GitViewMode {
    return this.viewMode;
  }
}

export default GitIntegration;
