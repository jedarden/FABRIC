/**
 * SessionDigest Component
 *
 * Displays a summary digest of worker session activity including:
 * - Summary statistics
 * - List of completed beads/work
 * - Notable events (errors, warnings)
 * - Export functionality
 */

import * as blessed from 'blessed';
import * as fs from 'fs';
import * as path from 'path';
import {
  SessionDigest,
  BeadCompletion,
  FileModificationSummary,
  ErrorOccurrence,
  WorkerSessionSummary,
  LogEvent,
  ErrorCategory,
} from '../../types.js';
import { colors, getLevelColor } from '../utils/colors.js';

export interface SessionDigestOptions {
  /** Parent screen */
  parent: blessed.Widgets.Screen;

  /** Position options */
  top: number | string;
  left: number | string;
  width: number | string;
  height: number | string;

  /** Callback when digest is exported */
  onExport?: (format: 'json' | 'markdown' | 'text', path: string) => void;
}

export type DigestViewTab = 'summary' | 'beads' | 'files' | 'errors' | 'workers';

export class SessionDigest {
  private container: blessed.Widgets.BoxElement;
  private contentBox: blessed.Widgets.BoxElement;
  private tabBar: blessed.Widgets.BoxElement;
  private headerBox: blessed.Widgets.BoxElement;
  private footerBox: blessed.Widgets.BoxElement;
  private digest: SessionDigest | null = null;
  private currentTab: DigestViewTab = 'summary';
  private scrollOffset = 0;
  private onExport?: (format: 'json' | 'markdown' | 'text', path: string) => void;

  constructor(options: SessionDigestOptions) {
    this.onExport = options.onExport;

    // Main container
    this.container = blessed.box({
      parent: options.parent,
      top: options.top,
      left: options.left,
      width: options.width,
      height: options.height,
      label: ' Session Digest ',
      border: { type: 'line' },
      style: {
        border: { fg: colors.border },
        label: { fg: colors.header },
      },
      hidden: true,
    });

    // Header with session info
    this.headerBox = blessed.box({
      parent: this.container,
      top: 0,
      left: 0,
      right: 0,
      height: 2,
      content: '{gray-fg}No session data loaded{/}',
      tags: true,
    });

    // Tab bar
    this.tabBar = blessed.box({
      parent: this.container,
      top: 2,
      left: 0,
      right: 0,
      height: 1,
      content: this.getTabBarContent(),
      tags: true,
      style: {
        fg: colors.muted,
      },
    });

    // Content area
    this.contentBox = blessed.box({
      parent: this.container,
      top: 3,
      left: 0,
      right: 0,
      bottom: 1,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      tags: true,
      style: {
        fg: colors.text,
      },
    });

    // Footer with controls
    this.footerBox = blessed.box({
      parent: this.container,
      bottom: 0,
      left: 0,
      right: 0,
      height: 1,
      content: ' [1-5] Tabs  [e] Export JSON  [m] Export Markdown  [j/k] Scroll  [Esc] Close',
      style: {
        fg: colors.muted,
      },
    });

    // Bind keyboard events
    this.bindKeys();
  }

  /**
   * Bind keyboard shortcuts
   */
  private bindKeys(): void {
    this.contentBox.key(['1'], () => this.switchTab('summary'));
    this.contentBox.key(['2'], () => this.switchTab('beads'));
    this.contentBox.key(['3'], () => this.switchTab('files'));
    this.contentBox.key(['4'], () => this.switchTab('errors'));
    this.contentBox.key(['5'], () => this.switchTab('workers'));
    this.contentBox.key(['e'], () => this.exportDigest('json'));
    this.contentBox.key(['m'], () => this.exportDigest('markdown'));
    this.contentBox.key(['t'], () => this.exportDigest('text'));
  }

  /**
   * Get tab bar content with current tab highlighted
   */
  private getTabBarContent(): string {
    const tabs: Array<{ key: string; label: string; tab: DigestViewTab }> = [
      { key: '1', label: 'Summary', tab: 'summary' },
      { key: '2', label: 'Beads', tab: 'beads' },
      { key: '3', label: 'Files', tab: 'files' },
      { key: '4', label: 'Errors', tab: 'errors' },
      { key: '5', label: 'Workers', tab: 'workers' },
    ];

    return tabs
      .map((t) => {
        const isActive = t.tab === this.currentTab;
        const color = isActive ? 'cyan' : 'gray';
        const prefix = isActive ? '[' : ' ';
        const suffix = isActive ? ']' : ' ';
        return `{${color}-fg}${prefix}${t.key}:${t.label}${suffix}{/}`;
      })
      .join(' ');
  }

  /**
   * Switch to a different tab
   */
  switchTab(tab: DigestViewTab): void {
    this.currentTab = tab;
    this.scrollOffset = 0;
    this.tabBar.setContent(this.getTabBarContent());
    this.render();
    this.container.screen.render();
  }

  /**
   * Set the session digest data
   */
  setDigest(digest: SessionDigest): void {
    this.digest = digest;
    this.scrollOffset = 0;
    this.updateHeader();
    this.render();
  }

  /**
   * Update the header with session info
   */
  private updateHeader(): void {
    if (!this.digest) {
      this.headerBox.setContent('{gray-fg}No session data loaded{/}');
      return;
    }

    const d = this.digest;
    const duration = this.formatDuration(d.durationMs);
    const startTime = new Date(d.startTime).toLocaleString();
    const endTime = new Date(d.endTime).toLocaleString();

    const header = `{bold}Session:{/} ${d.sessionId.slice(0, 16)}...  ` +
      `{bold}Duration:{/} ${duration}  ` +
      `{bold}Events:{/} ${d.stats.totalEvents}  ` +
      `{bold}Workers:{/} ${d.stats.totalWorkers}`;

    this.headerBox.setContent(header);
  }

  /**
   * Render the current tab content
   */
  render(): void {
    if (!this.digest) {
      this.contentBox.setContent('{gray-fg}No session data loaded{/}');
      this.container.screen.render();
      return;
    }

    let content = '';

    switch (this.currentTab) {
      case 'summary':
        content = this.renderSummary();
        break;
      case 'beads':
        content = this.renderBeads();
        break;
      case 'files':
        content = this.renderFiles();
        break;
      case 'errors':
        content = this.renderErrors();
        break;
      case 'workers':
        content = this.renderWorkers();
        break;
    }

    this.contentBox.setContent(content);
    this.contentBox.setScrollPerc(0);
    this.container.screen.render();
  }

  /**
   * Render summary tab
   */
  private renderSummary(): string {
    if (!this.digest) return '';

    const d = this.digest;
    const lines: string[] = [];

    lines.push('{bold}{cyan-fg}══════════════════════════════════════════════════{/}');
    lines.push('{bold}{cyan-fg}              SESSION SUMMARY{/}');
    lines.push('{bold}{cyan-fg}══════════════════════════════════════════════════{/}');
    lines.push('');

    // Session info
    lines.push('{bold}Session ID:{/} ' + d.sessionId);
    lines.push('{bold}Start Time:{/} ' + new Date(d.startTime).toLocaleString());
    lines.push('{bold}End Time:{/} ' + new Date(d.endTime).toLocaleString());
    lines.push('{bold}Duration:{/} ' + this.formatDuration(d.durationMs));
    lines.push('');

    // Statistics
    lines.push('{bold}{green-fg}─── Statistics ───{/}');
    lines.push(`  {bold}Total Events:{/}     ${d.stats.totalEvents}`);
    lines.push(`  {bold}Total Workers:{/}    ${d.stats.totalWorkers}`);
    lines.push(`  {bold}Total Beads:{/}      ${d.stats.totalBeads}`);
    lines.push(`  {bold}Total Files:{/}      ${d.stats.totalFiles}`);
    lines.push(`  {bold}Total Errors:{/}     {red-fg}${d.stats.totalErrors}{/}`);
    lines.push(`  {bold}Avg Events/Worker:{/} ${d.stats.avgEventsPerWorker.toFixed(1)}`);
    lines.push(`  {bold}Avg Beads/Worker:{/}  ${d.stats.avgBeadsPerWorker.toFixed(1)}`);
    lines.push('');

    // Cost breakdown
    if (d.cost) {
      lines.push('{bold}{yellow-fg}─── Cost Breakdown ───{/}');
      lines.push(`  {bold}Input Tokens:{/}     ${d.cost.inputTokens.toLocaleString()}`);
      lines.push(`  {bold}Output Tokens:{/}    ${d.cost.outputTokens.toLocaleString()}`);
      lines.push(`  {bold}Total Tokens:{/}     ${d.cost.totalTokens.toLocaleString()}`);
      lines.push(`  {bold}Est. Cost:{/}        {green-fg}$${d.cost.estimatedCostUsd.toFixed(4)}{/}`);
      lines.push('');
    }

    // Quick stats
    lines.push('{bold}{magenta-fg}─── Completed Work ───{/}');
    lines.push(`  {bold}Beads Completed:{/}  {green-fg}${d.beadsCompleted.length}{/}`);
    lines.push(`  {bold}Files Modified:{/}   {cyan-fg}${d.filesModified.length}{/}`);
    lines.push(`  {bold}Workers Active:{/}   ${d.workers.length}`);
    lines.push('');

    // Error summary
    if (d.errors.length > 0) {
      lines.push('{bold}{red-fg}─── Errors ({/}' + d.errors.length + '{bold}{red-fg}) ───{/}');

      // Group errors by category
      const errorsByCategory: Record<ErrorCategory, number> = {
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

      for (const err of d.errors) {
        errorsByCategory[err.category]++;
      }

      for (const [category, count] of Object.entries(errorsByCategory)) {
        if (count > 0) {
          lines.push(`  {red-fg}${category}:{/} ${count}`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Render beads tab
   */
  private renderBeads(): string {
    if (!this.digest) return '';

    const d = this.digest;
    const lines: string[] = [];

    lines.push('{bold}{cyan-fg}══════════════════════════════════════════════════{/}');
    lines.push('{bold}{cyan-fg}              COMPLETED BEADS ({/}' + d.beadsCompleted.length + '{bold}{cyan-fg}){/}');
    lines.push('{bold}{cyan-fg}══════════════════════════════════════════════════{/}');
    lines.push('');

    if (d.beadsCompleted.length === 0) {
      lines.push('{gray-fg}No beads completed in this session{/}');
      return lines.join('\n');
    }

    // Sort by completion time (most recent first)
    const sorted = [...d.beadsCompleted].sort((a, b) => b.completedAt - a.completedAt);

    for (const bead of sorted) {
      const time = new Date(bead.completedAt).toLocaleTimeString();
      const duration = bead.durationMs ? ` (${this.formatDuration(bead.durationMs)})` : '';
      const worker = bead.workerId.slice(0, 8);

      lines.push(`{magenta-fg}${bead.beadId}{/} {gray-fg}by{/} {cyan-fg}${worker}{/} {gray-fg}at{/} ${time}${duration}`);
    }

    return lines.join('\n');
  }

  /**
   * Render files tab
   */
  private renderFiles(): string {
    if (!this.digest) return '';

    const d = this.digest;
    const lines: string[] = [];

    lines.push('{bold}{cyan-fg}══════════════════════════════════════════════════{/}');
    lines.push('{bold}{cyan-fg}              FILES MODIFIED ({/}' + d.filesModified.length + '{bold}{cyan-fg}){/}');
    lines.push('{bold}{cyan-fg}══════════════════════════════════════════════════{/}');
    lines.push('');

    if (d.filesModified.length === 0) {
      lines.push('{gray-fg}No files modified in this session{/}');
      return lines.join('\n');
    }

    // Sort by modification count (most modified first)
    const sorted = [...d.filesModified].sort((a, b) => b.modifications - a.modifications);

    for (const file of sorted) {
      const mods = file.modifications;
      const modStr = mods === 1 ? '1 mod' : `${mods} mods`;
      const workers = file.workers.length === 1 ? '1 worker' : `${file.workers.length} workers`;

      // Color based on modification count
      let color = 'green';
      if (mods >= 10) color = 'red';
      else if (mods >= 5) color = 'yellow';
      else if (mods >= 3) color = 'cyan';

      lines.push(`{${color}-fg}${modStr}{/} {gray-fg}by{/} ${workers}`);
      lines.push(`  {white-fg}${file.path}{/}`);

      if (file.tools.length > 0) {
        lines.push(`  {gray-fg}Tools: ${file.tools.join(', ')}{/}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Render errors tab
   */
  private renderErrors(): string {
    if (!this.digest) return '';

    const d = this.digest;
    const lines: string[] = [];

    lines.push('{bold}{cyan-fg}══════════════════════════════════════════════════{/}');
    lines.push('{bold}{cyan-fg}              ERRORS ({/}' + d.errors.length + '{bold}{cyan-fg}){/}');
    lines.push('{bold}{cyan-fg}══════════════════════════════════════════════════{/}');
    lines.push('');

    if (d.errors.length === 0) {
      lines.push('{green-fg}✓ No errors encountered in this session{/}');
      return lines.join('\n');
    }

    // Sort by timestamp (most recent first)
    const sorted = [...d.errors].sort((a, b) => b.timestamp - a.timestamp);

    for (const err of sorted) {
      const time = new Date(err.timestamp).toLocaleTimeString();
      const worker = err.workerId.slice(0, 8);
      const category = err.category.toUpperCase();

      lines.push(`{red-fg}[${category}]{/} {gray-fg}${time}{/} {cyan-fg}${worker}{/}`);
      lines.push(`  {white-fg}${err.message.slice(0, 100)}${err.message.length > 100 ? '...' : ''}{/}`);
      if (err.fingerprint) {
        lines.push(`  {gray-fg}Fingerprint: ${err.fingerprint}{/}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Render workers tab
   */
  private renderWorkers(): string {
    if (!this.digest) return '';

    const d = this.digest;
    const lines: string[] = [];

    lines.push('{bold}{cyan-fg}══════════════════════════════════════════════════{/}');
    lines.push('{bold}{cyan-fg}              WORKERS ({/}' + d.workers.length + '{bold}{cyan-fg}){/}');
    lines.push('{bold}{cyan-fg}══════════════════════════════════════════════════{/}');
    lines.push('');

    if (d.workers.length === 0) {
      lines.push('{gray-fg}No workers in this session{/}');
      return lines.join('\n');
    }

    // Sort by beads completed (most productive first)
    const sorted = [...d.workers].sort((a, b) => b.beadsCompleted - a.beadsCompleted);

    for (const worker of sorted) {
      const activeTime = this.formatDuration(worker.activeTimeMs);
      const firstActivity = new Date(worker.firstActivity).toLocaleTimeString();
      const lastActivity = new Date(worker.lastActivity).toLocaleTimeString();

      lines.push(`{bold}{cyan-fg}${worker.workerId}{/}`);
      lines.push(`  {bold}Beads Completed:{/} {green-fg}${worker.beadsCompleted}{/}`);
      lines.push(`  {bold}Files Modified:{/}  ${worker.filesModified}`);
      lines.push(`  {bold}Errors:{/}         {red-fg}${worker.errorsEncountered}{/}`);
      lines.push(`  {bold}Total Events:{/}   ${worker.totalEvents}`);
      lines.push(`  {bold}Active Time:{/}    ${activeTime}`);
      lines.push(`  {bold}First Activity:{/} ${firstActivity}`);
      lines.push(`  {bold}Last Activity:{/}  ${lastActivity}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Format duration for display
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) {
      const mins = Math.floor(ms / 60000);
      const secs = Math.floor((ms % 60000) / 1000);
      return `${mins}m ${secs}s`;
    }
    const hours = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    return `${hours}h ${mins}m`;
  }

  /**
   * Export digest to file
   */
  exportDigest(format: 'json' | 'markdown' | 'text'): void {
    if (!this.digest) {
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = `session-digest-${timestamp}`;
    let filePath: string;
    let content: string;

    switch (format) {
      case 'json':
        filePath = `${baseName}.json`;
        content = JSON.stringify(this.digest, null, 2);
        break;
      case 'markdown':
        filePath = `${baseName}.md`;
        content = this.formatAsMarkdown();
        break;
      case 'text':
        filePath = `${baseName}.txt`;
        content = this.formatAsText();
        break;
    }

    // Write to current directory or temp
    const outputPath = path.join(process.cwd(), filePath);

    try {
      fs.writeFileSync(outputPath, content, 'utf-8');

      // Show success message
      const successMsg = `{green-fg}✓ Exported to ${outputPath}{/}`;
      this.footerBox.setContent(successMsg);
      this.container.screen.render();

      // Reset footer after 3 seconds
      setTimeout(() => {
        this.footerBox.setContent(' [1-5] Tabs  [e] Export JSON  [m] Export Markdown  [j/k] Scroll  [Esc] Close');
        this.container.screen.render();
      }, 3000);

      if (this.onExport) {
        this.onExport(format, outputPath);
      }
    } catch (error) {
      const errorMsg = `{red-fg}✗ Export failed: ${error}{/}`;
      this.footerBox.setContent(errorMsg);
      this.container.screen.render();
    }
  }

  /**
   * Format digest as markdown
   */
  private formatAsMarkdown(): string {
    if (!this.digest) return '';

    const d = this.digest;
    const lines: string[] = [];

    lines.push('# Session Digest');
    lines.push('');
    lines.push(`**Session ID:** ${d.sessionId}`);
    lines.push(`**Start Time:** ${new Date(d.startTime).toLocaleString()}`);
    lines.push(`**End Time:** ${new Date(d.endTime).toLocaleString()}`);
    lines.push(`**Duration:** ${this.formatDuration(d.durationMs)}`);
    lines.push('');

    lines.push('## Statistics');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Total Events | ${d.stats.totalEvents} |`);
    lines.push(`| Total Workers | ${d.stats.totalWorkers} |`);
    lines.push(`| Total Beads | ${d.stats.totalBeads} |`);
    lines.push(`| Total Files | ${d.stats.totalFiles} |`);
    lines.push(`| Total Errors | ${d.stats.totalErrors} |`);
    lines.push('');

    if (d.cost) {
      lines.push('## Cost Breakdown');
      lines.push('');
      lines.push(`- **Input Tokens:** ${d.cost.inputTokens.toLocaleString()}`);
      lines.push(`- **Output Tokens:** ${d.cost.outputTokens.toLocaleString()}`);
      lines.push(`- **Total Tokens:** ${d.cost.totalTokens.toLocaleString()}`);
      lines.push(`- **Estimated Cost:** $${d.cost.estimatedCostUsd.toFixed(4)}`);
      lines.push('');
    }

    lines.push('## Completed Beads');
    lines.push('');
    if (d.beadsCompleted.length === 0) {
      lines.push('_No beads completed_');
    } else {
      lines.push('| Bead ID | Worker | Completed At | Duration |');
      lines.push('|---------|--------|--------------|----------|');
      for (const bead of d.beadsCompleted) {
        const time = new Date(bead.completedAt).toLocaleString();
        const duration = bead.durationMs ? this.formatDuration(bead.durationMs) : '-';
        lines.push(`| ${bead.beadId} | ${bead.workerId.slice(0, 8)} | ${time} | ${duration} |`);
      }
    }
    lines.push('');

    lines.push('## Files Modified');
    lines.push('');
    if (d.filesModified.length === 0) {
      lines.push('_No files modified_');
    } else {
      lines.push('| Path | Modifications | Workers |');
      lines.push('|------|---------------|---------|');
      for (const file of d.filesModified) {
        lines.push(`| \`${file.path}\` | ${file.modifications} | ${file.workers.length} |`);
      }
    }
    lines.push('');

    lines.push('## Errors');
    lines.push('');
    if (d.errors.length === 0) {
      lines.push('_No errors encountered_');
    } else {
      lines.push('| Time | Category | Worker | Message |');
      lines.push('|------|----------|--------|---------|');
      for (const err of d.errors) {
        const time = new Date(err.timestamp).toLocaleTimeString();
        const msg = err.message.slice(0, 50).replace(/\n/g, ' ');
        lines.push(`| ${time} | ${err.category} | ${err.workerId.slice(0, 8)} | ${msg} |`);
      }
    }
    lines.push('');

    lines.push('## Worker Summary');
    lines.push('');
    lines.push('| Worker ID | Beads | Files | Errors | Active Time |');
    lines.push('|-----------|-------|-------|--------|-------------|');
    for (const worker of d.workers) {
      lines.push(`| ${worker.workerId.slice(0, 8)} | ${worker.beadsCompleted} | ${worker.filesModified} | ${worker.errorsEncountered} | ${this.formatDuration(worker.activeTimeMs)} |`);
    }
    lines.push('');

    lines.push('---');
    lines.push(`*Generated by FABRIC at ${new Date().toLocaleString()}*`);

    return lines.join('\n');
  }

  /**
   * Format digest as plain text
   */
  private formatAsText(): string {
    if (!this.digest) return '';

    const d = this.digest;
    const lines: string[] = [];

    lines.push('SESSION DIGEST');
    lines.push('='.repeat(50));
    lines.push('');
    lines.push(`Session ID: ${d.sessionId}`);
    lines.push(`Start Time: ${new Date(d.startTime).toLocaleString()}`);
    lines.push(`End Time: ${new Date(d.endTime).toLocaleString()}`);
    lines.push(`Duration: ${this.formatDuration(d.durationMs)}`);
    lines.push('');

    lines.push('STATISTICS');
    lines.push('-'.repeat(30));
    lines.push(`Total Events: ${d.stats.totalEvents}`);
    lines.push(`Total Workers: ${d.stats.totalWorkers}`);
    lines.push(`Total Beads: ${d.stats.totalBeads}`);
    lines.push(`Total Files: ${d.stats.totalFiles}`);
    lines.push(`Total Errors: ${d.stats.totalErrors}`);
    lines.push('');

    if (d.cost) {
      lines.push('COST BREAKDOWN');
      lines.push('-'.repeat(30));
      lines.push(`Input Tokens: ${d.cost.inputTokens.toLocaleString()}`);
      lines.push(`Output Tokens: ${d.cost.outputTokens.toLocaleString()}`);
      lines.push(`Total Tokens: ${d.cost.totalTokens.toLocaleString()}`);
      lines.push(`Estimated Cost: $${d.cost.estimatedCostUsd.toFixed(4)}`);
      lines.push('');
    }

    lines.push('COMPLETED BEADS');
    lines.push('-'.repeat(30));
    for (const bead of d.beadsCompleted) {
      const time = new Date(bead.completedAt).toLocaleString();
      const duration = bead.durationMs ? ` (${this.formatDuration(bead.durationMs)})` : '';
      lines.push(`${bead.beadId} by ${bead.workerId.slice(0, 8)} at ${time}${duration}`);
    }
    if (d.beadsCompleted.length === 0) {
      lines.push('No beads completed');
    }
    lines.push('');

    lines.push('FILES MODIFIED');
    lines.push('-'.repeat(30));
    for (const file of d.filesModified) {
      lines.push(`${file.path} (${file.modifications} mods by ${file.workers.length} workers)`);
    }
    if (d.filesModified.length === 0) {
      lines.push('No files modified');
    }
    lines.push('');

    lines.push('ERRORS');
    lines.push('-'.repeat(30));
    for (const err of d.errors) {
      const time = new Date(err.timestamp).toLocaleTimeString();
      lines.push(`[${err.category.toUpperCase()}] ${time} ${err.workerId.slice(0, 8)}: ${err.message.slice(0, 100)}`);
    }
    if (d.errors.length === 0) {
      lines.push('No errors encountered');
    }
    lines.push('');

    lines.push('---');
    lines.push(`Generated by FABRIC at ${new Date().toLocaleString()}`);

    return lines.join('\n');
  }

  /**
   * Show the digest panel
   */
  show(): void {
    this.container.show();
    this.contentBox.focus();
    this.container.screen.render();
  }

  /**
   * Hide the digest panel
   */
  hide(): void {
    this.container.hide();
    this.container.screen.render();
  }

  /**
   * Toggle visibility
   */
  toggle(): void {
    if (this.container.hidden) {
      this.show();
    } else {
      this.hide();
    }
  }

  /**
   * Check if visible
   */
  isVisible(): boolean {
    return !this.container.hidden;
  }

  /**
   * Focus this component
   */
  focus(): void {
    this.contentBox.focus();
  }

  /**
   * Get the underlying blessed element
   */
  getElement(): blessed.Widgets.BoxElement {
    return this.container;
  }

  /**
   * Get current tab
   */
  getCurrentTab(): DigestViewTab {
    return this.currentTab;
  }
}

/**
 * Generate a session digest from events and worker data
 */
export function generateSessionDigest(
  events: LogEvent[],
  workers: WorkerSessionSummary[],
  options: {
    sessionId?: string;
    startTime?: number;
    endTime?: number;
    includeCost?: boolean;
  } = {}
): SessionDigest {
  const startTime = options.startTime || (events.length > 0 ? events[0].ts : Date.now());
  const endTime = options.endTime || (events.length > 0 ? events[events.length - 1].ts : Date.now());
  const sessionId = options.sessionId || `session-${Date.now()}`;

  // Extract bead completions
  const beadsCompleted: BeadCompletion[] = [];
  const completedEvents = events.filter(e =>
    e.msg.toLowerCase().includes('completed') ||
    e.msg.toLowerCase().includes('complete')
  );

  for (const event of completedEvents) {
    if (event.bead) {
      beadsCompleted.push({
        beadId: event.bead,
        workerId: event.worker,
        completedAt: event.ts,
        durationMs: event.duration_ms,
      });
    }
  }

  // Extract file modifications
  const fileModMap = new Map<string, {
    modifications: number;
    workers: Set<string>;
    tools: Set<string>;
  }>();

  const fileEvents = events.filter(e => e.path && e.tool);
  for (const event of fileEvents) {
    const existing = fileModMap.get(event.path!);
    if (existing) {
      existing.modifications++;
      existing.workers.add(event.worker);
      if (event.tool) existing.tools.add(event.tool);
    } else {
      fileModMap.set(event.path!, {
        modifications: 1,
        workers: new Set([event.worker]),
        tools: new Set(event.tool ? [event.tool] : []),
      });
    }
  }

  const filesModified: FileModificationSummary[] = [];
  for (const [path, data] of fileModMap) {
    filesModified.push({
      path,
      modifications: data.modifications,
      workers: Array.from(data.workers),
      tools: Array.from(data.tools),
    });
  }

  // Extract errors
  const errors: ErrorOccurrence[] = events
    .filter(e => e.level === 'error')
    .map(e => ({
      message: e.error || e.msg,
      category: categorizeError(e.error || e.msg) as ErrorCategory,
      workerId: e.worker,
      timestamp: e.ts,
      fingerprint: e.error ? generateFingerprint(e.error) : undefined,
    }));

  // Calculate totals
  const totalEvents = events.length;
  const totalWorkers = workers.length;
  const totalBeads = beadsCompleted.length;
  const totalFiles = filesModified.length;
  const totalErrors = errors.length;

  // Calculate cost (placeholder - would need actual token tracking)
  const cost = {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
  };

  // If we have token info in events, aggregate it
  for (const event of events) {
    const tokens = (event as any).tokens;
    if (tokens) {
      cost.totalTokens += tokens;
    }
  }

  return {
    sessionId,
    startTime,
    endTime,
    durationMs: endTime - startTime,
    beadsCompleted,
    filesModified,
    errors,
    workers,
    cost,
    stats: {
      totalEvents,
      totalWorkers,
      totalBeads,
      totalFiles,
      totalErrors,
      avgEventsPerWorker: totalWorkers > 0 ? totalEvents / totalWorkers : 0,
      avgBeadsPerWorker: totalWorkers > 0 ? totalBeads / totalWorkers : 0,
    },
  };
}

/**
 * Categorize an error message
 */
function categorizeError(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('econnrefused') || lower.includes('enotfound') ||
      lower.includes('network') || lower.includes('dns') ||
      lower.includes('socket') || lower.includes('connection')) {
    return 'network';
  }
  if (lower.includes('permission') || lower.includes('access denied') ||
      lower.includes('unauthorized') || lower.includes('forbidden') ||
      lower.includes('auth')) {
    return 'permission';
  }
  if (lower.includes('validation') || lower.includes('invalid') ||
      lower.includes('schema') || lower.includes('type error')) {
    return 'validation';
  }
  if (lower.includes('out of memory') || lower.includes('disk full') ||
      lower.includes('quota') || lower.includes('resource')) {
    return 'resource';
  }
  if (lower.includes('not found') || lower.includes('enoent') ||
      lower.includes('404')) {
    return 'not_found';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'timeout';
  }
  if (lower.includes('syntax') || lower.includes('parse') ||
      lower.includes('unexpected token')) {
    return 'syntax';
  }
  if (lower.includes('tool') || lower.includes('command failed')) {
    return 'tool';
  }
  return 'unknown';
}

/**
 * Generate a fingerprint for error grouping
 */
function generateFingerprint(message: string): string {
  // Simple fingerprint based on first 50 chars normalized
  const normalized = message
    .toLowerCase()
    .replace(/\d+/g, 'N')
    .replace(/['"]/g, '')
    .slice(0, 50);
  return normalized;
}

export function createSessionDigest(options: SessionDigestOptions): SessionDigest {
  return new SessionDigest(options);
}
