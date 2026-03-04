/**
 * ConversationTranscript Component
 *
 * Displays a full Claude conversation for a worker session including:
 * - User prompts with role indicators
 * - Assistant responses with syntax highlighting
 * - Collapsible tool calls with arguments
 * - Tool results with success/error indicators
 * - Thinking blocks
 * - Search functionality
 * - Scrolling support
 */

import * as blessed from 'blessed';
import {
  ConversationEvent,
  ConversationSession,
  PromptEvent,
  ResponseEvent,
  ThinkingEvent,
  ToolCallEvent,
  ToolResultEvent,
} from '../../types.js';
import { colors } from '../utils/colors.js';

export interface ConversationTranscriptOptions {
  /** Parent screen */
  parent: blessed.Widgets.Screen;

  /** Position options */
  top: number | string;
  left: number | string;
  width: number | string;
  height: number | string;

  /** Callback when search is triggered */
  onSearch?: (query: string) => void;

  /** Callback when export is triggered */
  onExport?: (format: 'json' | 'markdown' | 'text', path: string) => void;
}

export class ConversationTranscript {
  private container: blessed.Widgets.BoxElement;
  private contentBox: blessed.Widgets.BoxElement;
  private headerBox: blessed.Widgets.BoxElement;
  private footerBox: blessed.Widgets.BoxElement;
  private searchBox: blessed.Widgets.TextboxElement;
  private session: ConversationSession | null = null;
  private events: ConversationEvent[] = [];
  private collapsedToolCalls: Set<string> = new Set();
  private searchQuery = '';
  private searchMode = false;
  private highlightedIndices: number[] = [];
  private currentHighlight = 0;
  private onSearch?: (query: string) => void;
  private onExport?: (format: 'json' | 'markdown' | 'text', path: string) => void;

  constructor(options: ConversationTranscriptOptions) {
    this.onSearch = options.onSearch;
    this.onExport = options.onExport;

    // Main container
    this.container = blessed.box({
      parent: options.parent,
      top: options.top,
      left: options.left,
      width: options.width,
      height: options.height,
      label: ' Conversation Transcript ',
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
      content: '{gray-fg}No conversation loaded{/}',
      tags: true,
    });

    // Content area (scrollable)
    this.contentBox = blessed.box({
      parent: this.container,
      top: 2,
      left: 0,
      right: 0,
      bottom: 2,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
      scrollbar: {
        style: {
          bg: colors.muted,
        },
      },
      style: {
        fg: colors.text,
      },
    });

    // Search box (hidden by default)
    this.searchBox = blessed.textbox({
      parent: this.container,
      bottom: 1,
      left: 0,
      right: 0,
      height: 1,
      hidden: true,
      style: {
        fg: colors.text,
        bg: colors.muted,
      },
    });

    // Footer with controls
    this.footerBox = blessed.box({
      parent: this.container,
      bottom: 0,
      left: 0,
      right: 0,
      height: 1,
      content: ' [/] Search  [t] Toggle Tools  [c] Collapse All  [e] Expand All  [j/k] Scroll  [Esc] Close',
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
    // Search mode
    this.contentBox.key(['/'], () => this.enterSearchMode());
    this.contentBox.key(['escape'], () => this.exitSearchMode());

    // Navigation in search results
    this.contentBox.key(['n'], () => this.nextSearchResult());
    this.contentBox.key(['N'], () => this.prevSearchResult());

    // Tool call toggling
    this.contentBox.key(['t'], () => this.toggleNearestToolCall());
    this.contentBox.key(['c'], () => this.collapseAllToolCalls());
    this.contentBox.key(['e'], () => this.expandAllToolCalls());

    // Export
    this.contentBox.key(['x'], () => this.exportTranscript('markdown'));

    // Search box events
    this.searchBox.on('submit', (text) => {
      this.searchQuery = text;
      this.performSearch();
      this.exitSearchMode();
    });

    this.searchBox.key(['escape'], () => {
      this.exitSearchMode();
    });
  }

  /**
   * Set the conversation session data
   */
  setSession(session: ConversationSession): void {
    this.session = session;
    this.events = session.events;
    this.collapsedToolCalls.clear();
    this.searchQuery = '';
    this.highlightedIndices = [];
    this.currentHighlight = 0;
    this.updateHeader();
    this.render();
  }

  /**
   * Update the header with session info
   */
  private updateHeader(): void {
    if (!this.session) {
      this.headerBox.setContent('{gray-fg}No conversation loaded{/}');
      return;
    }

    const s = this.session;
    const eventCount = s.events.length;
    const duration = s.endTime ? this.formatDuration(s.endTime - s.startTime) : 'ongoing';
    const tokens = s.totalTokens.toLocaleString();

    const header = `{bold}Worker:{/} ${s.workerId}  ` +
      `{bold}Bead:{/} ${s.beadId || 'none'}  ` +
      `{bold}Events:{/} ${eventCount}  ` +
      `{bold}Tokens:{/} ${tokens}  ` +
      `{bold}Duration:{/} ${duration}`;

    this.headerBox.setContent(header);
  }

  /**
   * Render the conversation transcript
   */
  render(): void {
    if (!this.session || this.events.length === 0) {
      this.contentBox.setContent('{gray-fg}No conversation events to display{/}');
      this.container.screen.render();
      return;
    }

    const lines: string[] = [];

    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i];
      const isHighlighted = this.highlightedIndices.includes(i);
      const highlightPrefix = isHighlighted ? '{inverse}' : '';
      const highlightSuffix = isHighlighted ? '{/inverse}' : '';

      switch (event.type) {
        case 'prompt':
          lines.push(...this.renderPrompt(event as PromptEvent, highlightPrefix, highlightSuffix));
          break;
        case 'response':
          lines.push(...this.renderResponse(event as ResponseEvent, highlightPrefix, highlightSuffix));
          break;
        case 'thinking':
          lines.push(...this.renderThinking(event as ThinkingEvent, highlightPrefix, highlightSuffix));
          break;
        case 'tool_call':
          lines.push(...this.renderToolCall(event as ToolCallEvent, highlightPrefix, highlightSuffix));
          break;
        case 'tool_result':
          lines.push(...this.renderToolResult(event as ToolResultEvent, highlightPrefix, highlightSuffix));
          break;
      }

      lines.push(''); // Blank line between events
    }

    this.contentBox.setContent(lines.join('\n'));
    this.container.screen.render();
  }

  /**
   * Render a user prompt event
   */
  private renderPrompt(event: PromptEvent, prefix: string, suffix: string): string[] {
    const lines: string[] = [];
    const timestamp = this.formatTimestamp(event.ts);
    const tokenInfo = event.tokens ? ` (${event.tokens} tokens)` : '';
    const continuationMark = event.isContinuation ? ' [continued]' : '';

    lines.push(`${prefix}{blue-fg}{bold}┌─ USER PROMPT{/} {gray-fg}${timestamp}${tokenInfo}${continuationMark}{/}${suffix}`);

    // Split content into lines and indent
    const contentLines = event.content.split('\n');
    for (const line of contentLines) {
      // Detect and highlight code blocks
      if (line.trim().startsWith('```')) {
        lines.push(`{cyan-fg}│ ${line}{/}`);
      } else if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        lines.push(`{yellow-fg}│{/} ${line}`);
      } else {
        lines.push(`{blue-fg}│{/} ${line}`);
      }
    }

    lines.push(`{blue-fg}└─{/}`);
    return lines;
  }

  /**
   * Render an assistant response event
   */
  private renderResponse(event: ResponseEvent, prefix: string, suffix: string): string[] {
    const lines: string[] = [];
    const timestamp = this.formatTimestamp(event.ts);
    const tokenInfo = event.tokens ? ` (${event.tokens} tokens)` : '';
    const modelInfo = event.model ? ` [${event.model}]` : '';
    const truncated = event.isTruncated ? ' {red-fg}[TRUNCATED]{/}' : '';

    lines.push(`${prefix}{green-fg}{bold}┌─ ASSISTANT{/} {gray-fg}${timestamp}${tokenInfo}${modelInfo}${truncated}{/}${suffix}`);

    // Split content and detect code blocks
    const contentLines = event.content.split('\n');
    let inCodeBlock = false;
    let codeLanguage = '';

    for (const line of contentLines) {
      if (line.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        if (inCodeBlock) {
          codeLanguage = line.trim().slice(3);
        }
        lines.push(`{cyan-fg}│ ${line}{/}`);
      } else if (inCodeBlock) {
        // Syntax highlighting for code blocks
        lines.push(`{yellow-fg}│{/} {white-fg}${this.highlightCode(line, codeLanguage)}{/}`);
      } else if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        lines.push(`{green-fg}│{/} {cyan-fg}${line}{/}`);
      } else if (line.trim().startsWith('#')) {
        lines.push(`{green-fg}│{/} {bold}${line}{/}`);
      } else {
        lines.push(`{green-fg}│{/} ${line}`);
      }
    }

    lines.push(`{green-fg}└─{/}`);
    return lines;
  }

  /**
   * Render a thinking block event
   */
  private renderThinking(event: ThinkingEvent, prefix: string, suffix: string): string[] {
    const lines: string[] = [];
    const timestamp = this.formatTimestamp(event.ts);
    const durationInfo = event.durationMs ? ` (${this.formatDuration(event.durationMs)})` : '';
    const truncated = event.isTruncated ? ' {red-fg}[TRUNCATED]{/}' : '';

    lines.push(`${prefix}{magenta-fg}{bold}┌─ THINKING{/} {gray-fg}${timestamp}${durationInfo}${truncated}{/}${suffix}`);

    // Thinking content (often internal reasoning)
    const contentLines = event.content.split('\n');
    for (const line of contentLines) {
      lines.push(`{magenta-fg}│{/} {gray-fg}${line}{/}`);
    }

    lines.push(`{magenta-fg}└─{/}`);
    return lines;
  }

  /**
   * Render a tool call event
   */
  private renderToolCall(event: ToolCallEvent, prefix: string, suffix: string): string[] {
    const lines: string[] = [];
    const timestamp = this.formatTimestamp(event.ts);
    const summary = event.summary || `${event.tool}()`;
    const isCollapsed = this.collapsedToolCalls.has(event.id);
    const collapseIndicator = isCollapsed ? ' [+]' : ' [-]';

    lines.push(`${prefix}{cyan-fg}{bold}┌─ TOOL CALL{/} {yellow-fg}${event.tool}{/} {gray-fg}${timestamp}${collapseIndicator}{/}${suffix}`);
    lines.push(`{cyan-fg}│{/} {bold}${summary}{/}`);

    if (!isCollapsed) {
      // Show arguments
      const argsJson = JSON.stringify(event.args, null, 2);
      const argsLines = argsJson.split('\n');

      lines.push(`{cyan-fg}│{/} {gray-fg}Arguments:{/}`);
      for (const line of argsLines) {
        lines.push(`{cyan-fg}│{/}   {yellow-fg}${line}{/}`);
      }

      if (event.toolCallId) {
        lines.push(`{cyan-fg}│{/} {gray-fg}Call ID: ${event.toolCallId}{/}`);
      }
    }

    lines.push(`{cyan-fg}└─{/}`);
    return lines;
  }

  /**
   * Render a tool result event
   */
  private renderToolResult(event: ToolResultEvent, prefix: string, suffix: string): string[] {
    const lines: string[] = [];
    const timestamp = this.formatTimestamp(event.ts);
    const durationInfo = event.durationMs ? ` (${this.formatDuration(event.durationMs)})` : '';
    const statusIcon = event.success ? '{green-fg}✓{/}' : '{red-fg}✗{/}';
    const truncated = event.isTruncated ? ' {red-fg}[TRUNCATED]{/}' : '';
    const sizeInfo = event.resultSize ? ` {gray-fg}(${this.formatBytes(event.resultSize)}){/}` : '';

    lines.push(`${prefix}{cyan-fg}{bold}┌─ TOOL RESULT{/} ${statusIcon} {yellow-fg}${event.tool}{/} {gray-fg}${timestamp}${durationInfo}${sizeInfo}${truncated}{/}${suffix}`);

    if (event.error) {
      lines.push(`{cyan-fg}│{/} {red-fg}Error: ${event.error}{/}`);
    } else {
      // Show first few lines of result
      const contentLines = event.content.split('\n').slice(0, 10);
      for (const line of contentLines) {
        lines.push(`{cyan-fg}│{/} ${line}`);
      }

      if (event.isTruncated) {
        lines.push(`{cyan-fg}│{/} {gray-fg}... (truncated){/}`);
      }
    }

    lines.push(`{cyan-fg}└─{/}`);
    return lines;
  }

  /**
   * Basic syntax highlighting for code
   */
  private highlightCode(line: string, language: string): string {
    // Simple keyword highlighting for common languages
    const keywords: Record<string, string[]> = {
      typescript: ['function', 'const', 'let', 'var', 'if', 'else', 'return', 'import', 'export', 'class', 'interface', 'type'],
      javascript: ['function', 'const', 'let', 'var', 'if', 'else', 'return', 'import', 'export', 'class'],
      python: ['def', 'class', 'if', 'else', 'elif', 'return', 'import', 'from', 'for', 'while'],
      bash: ['echo', 'cd', 'ls', 'grep', 'awk', 'sed', 'if', 'then', 'else', 'fi'],
    };

    const langKeywords = keywords[language.toLowerCase()] || [];
    let highlighted = line;

    for (const keyword of langKeywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'g');
      highlighted = highlighted.replace(regex, `{cyan-fg}${keyword}{/cyan-fg}`);
    }

    return highlighted;
  }

  /**
   * Enter search mode
   */
  private enterSearchMode(): void {
    this.searchMode = true;
    this.searchBox.show();
    this.searchBox.focus();
    this.footerBox.setContent(' [Enter] Search  [Esc] Cancel');
    this.container.screen.render();
  }

  /**
   * Exit search mode
   */
  private exitSearchMode(): void {
    this.searchMode = false;
    this.searchBox.hide();
    this.contentBox.focus();
    this.footerBox.setContent(' [/] Search  [t] Toggle Tools  [c] Collapse All  [e] Expand All  [j/k] Scroll  [Esc] Close');
    this.container.screen.render();
  }

  /**
   * Perform search across conversation events
   */
  private performSearch(): void {
    this.highlightedIndices = [];

    if (!this.searchQuery) {
      this.render();
      return;
    }

    const query = this.searchQuery.toLowerCase();

    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i];

      // Search in content fields
      let found = false;

      if ('content' in event && typeof event.content === 'string') {
        found = event.content.toLowerCase().includes(query);
      }

      if (!found && 'summary' in event && event.summary) {
        found = event.summary.toLowerCase().includes(query);
      }

      if (!found && 'tool' in event && event.tool) {
        found = event.tool.toLowerCase().includes(query);
      }

      if (found) {
        this.highlightedIndices.push(i);
      }
    }

    this.currentHighlight = 0;
    this.render();

    // Update footer with search results
    const resultCount = this.highlightedIndices.length;
    this.footerBox.setContent(` Found ${resultCount} results for "${this.searchQuery}" [n] Next  [N] Prev  [/] New Search  [Esc] Clear`);
    this.container.screen.render();

    if (this.onSearch) {
      this.onSearch(this.searchQuery);
    }
  }

  /**
   * Navigate to next search result
   */
  private nextSearchResult(): void {
    if (this.highlightedIndices.length === 0) return;

    this.currentHighlight = (this.currentHighlight + 1) % this.highlightedIndices.length;
    this.scrollToHighlight();
  }

  /**
   * Navigate to previous search result
   */
  private prevSearchResult(): void {
    if (this.highlightedIndices.length === 0) return;

    this.currentHighlight = (this.currentHighlight - 1 + this.highlightedIndices.length) % this.highlightedIndices.length;
    this.scrollToHighlight();
  }

  /**
   * Scroll to current highlighted result
   */
  private scrollToHighlight(): void {
    // This is a simplified version - in practice you'd calculate the line number
    // and use contentBox.setScrollPerc() or scrollTo()
    this.render();
  }

  /**
   * Toggle the nearest tool call collapse state
   */
  private toggleNearestToolCall(): void {
    // Find the nearest tool call event
    // In a real implementation, this would track the current scroll position
    // For now, just toggle all tool calls
    const toolCallEvents = this.events.filter(e => e.type === 'tool_call');

    if (toolCallEvents.length > 0) {
      const firstToolCall = toolCallEvents[0];
      if (this.collapsedToolCalls.has(firstToolCall.id)) {
        this.collapsedToolCalls.delete(firstToolCall.id);
      } else {
        this.collapsedToolCalls.add(firstToolCall.id);
      }
      this.render();
    }
  }

  /**
   * Collapse all tool calls
   */
  collapseAllToolCalls(): void {
    for (const event of this.events) {
      if (event.type === 'tool_call') {
        this.collapsedToolCalls.add(event.id);
      }
    }
    this.render();
  }

  /**
   * Expand all tool calls
   */
  expandAllToolCalls(): void {
    this.collapsedToolCalls.clear();
    this.render();
  }

  /**
   * Export transcript to file
   */
  exportTranscript(format: 'json' | 'markdown' | 'text'): void {
    if (!this.session) return;

    // Implementation would write to file
    // For now, just trigger callback
    if (this.onExport) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `conversation-${this.session.id}-${timestamp}.${format}`;
      this.onExport(format, filename);
    }
  }

  /**
   * Format timestamp for display
   */
  private formatTimestamp(ts: number): string {
    const date = new Date(ts);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  /**
   * Format duration for display
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  }

  /**
   * Format bytes for display
   */
  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  /**
   * Show the transcript panel
   */
  show(): void {
    this.container.show();
    this.contentBox.focus();
    this.container.screen.render();
  }

  /**
   * Hide the transcript panel
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
}

/**
 * Create a ConversationTranscript component
 */
export function createConversationTranscript(options: ConversationTranscriptOptions): ConversationTranscript {
  return new ConversationTranscript(options);
}
