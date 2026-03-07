/**
 * FileContextPanel Component
 *
 * Displays file contents in a split view alongside the activity stream.
 * Shows syntax highlighting, line numbers, and file operation history.
 */

import blessed from 'blessed';
import { LogEvent } from '../../types.js';
import { colors } from '../utils/colors.js';

export interface FileContextPanelOptions {
  /** Parent screen */
  parent: blessed.Widgets.Screen;

  /** Position from top */
  top: number | string;

  /** Position from left */
  left: number | string;

  /** Width of the panel */
  width: number | string;

  /** Position from bottom */
  bottom: number | string;
}

export interface FileContext {
  /** File path */
  path: string;

  /** File content (if available) */
  content?: string;

  /** Operations on this file */
  operations: FileOperation[];

  /** Currently highlighted line */
  highlightedLine?: number;

  /** Worker who last modified */
  lastModifiedBy?: string;

  /** Last modification time */
  lastModifiedAt?: number;
}

export interface FileOperation {
  /** Event that triggered the operation */
  event: LogEvent;

  /** Operation type */
  type: 'read' | 'edit' | 'write' | 'glob' | 'other';

  /** Timestamp */
  ts: number;

  /** Worker who performed the operation */
  worker: string;
}

/** File extension to syntax highlighting map */
const SYNTAX_COLORS: Record<string, string[]> = {
  typescript: ['ts', 'tsx'],
  javascript: ['js', 'jsx', 'mjs'],
  python: ['py'],
  rust: ['rs'],
  go: ['go'],
  java: ['java'],
  c: ['c', 'h'],
  cpp: ['cpp', 'cc', 'cxx', 'hpp'],
  css: ['css', 'scss', 'sass'],
  html: ['html', 'htm'],
  json: ['json', 'jsonl'],
  yaml: ['yaml', 'yml'],
  markdown: ['md', 'markdown'],
  shell: ['sh', 'bash', 'zsh'],
  sql: ['sql'],
  toml: ['toml'],
  dockerfile: ['dockerfile'],
};

/** Keywords for syntax highlighting */
const KEYWORDS: Record<string, string[]> = {
  typescript: ['import', 'export', 'from', 'const', 'let', 'var', 'function', 'class', 'interface', 'type', 'enum', 'async', 'await', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new', 'this', 'super', 'extends', 'implements', 'private', 'public', 'protected', 'readonly', 'static', 'abstract', 'as', 'typeof', 'instanceof', 'in', 'of', 'null', 'undefined', 'true', 'false'],
  python: ['import', 'from', 'def', 'class', 'async', 'await', 'return', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'raise', 'with', 'as', 'lambda', 'yield', 'global', 'nonlocal', 'pass', 'break', 'continue', 'True', 'False', 'None', 'and', 'or', 'not', 'in', 'is'],
  rust: ['fn', 'let', 'mut', 'const', 'static', 'pub', 'mod', 'use', 'crate', 'self', 'super', 'struct', 'enum', 'impl', 'trait', 'type', 'where', 'for', 'loop', 'while', 'if', 'else', 'match', 'return', 'async', 'await', 'move', 'ref', 'Some', 'None', 'Ok', 'Err', 'true', 'false'],
  go: ['package', 'import', 'func', 'var', 'const', 'type', 'struct', 'interface', 'map', 'chan', 'go', 'defer', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'break', 'continue', 'goto', 'fallthrough', 'select', 'true', 'false', 'nil', 'error'],
  shell: ['if', 'then', 'else', 'elif', 'fi', 'for', 'do', 'done', 'while', 'until', 'case', 'esac', 'function', 'return', 'exit', 'export', 'source', 'alias', 'unset', 'readonly', 'local', 'declare', 'echo', 'printf', 'read', 'test', 'true', 'false'],
};

/**
 * FileContextPanel displays file contents with syntax highlighting
 */
export class FileContextPanel {
  private box: blessed.Widgets.BoxElement;
  private fileContent: blessed.Widgets.BoxElement;
  private fileInfo: blessed.Widgets.BoxElement;
  private fileHistory: blessed.Widgets.BoxElement;
  private currentContext: FileContext | null = null;
  private recentFiles: FileContext[] = [];
  private maxRecentFiles = 10;
  private scrollOffset = 0;
  private visible = false;

  constructor(options: FileContextPanelOptions) {
    // Main container
    this.box = blessed.box({
      parent: options.parent,
      top: options.top,
      left: options.left,
      width: options.width,
      bottom: options.bottom,
      label: ' File Context ',
      tags: true,
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
    });

    // File path and info header
    this.fileInfo = blessed.box({
      parent: this.box,
      top: 0,
      left: 0,
      right: 0,
      height: 2,
      tags: true,
      style: {
        fg: colors.text,
      },
    });

    // File content area
    this.fileContent = blessed.box({
      parent: this.box,
      top: 2,
      left: 0,
      right: 0,
      bottom: 5,
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      style: {
        fg: colors.text,
      },
    });

    // File history footer
    this.fileHistory = blessed.box({
      parent: this.box,
      bottom: 0,
      left: 0,
      right: 0,
      height: 5,
      tags: true,
      style: {
        fg: colors.muted,
      },
    });

    this.bindKeys();
    this.hide();
  }

  /**
   * Bind component-specific keys
   */
  private bindKeys(): void {
    this.box.key(['['], () => {
      this.navigateRecent(-1);
    });

    this.box.key([']'], () => {
      this.navigateRecent(1);
    });

    this.box.key(['o', 'O'], () => {
      this.openInEditor();
    });

    this.box.key(['up', 'k'], () => {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.render();
    });

    this.box.key(['down', 'j'], () => {
      this.scrollOffset++;
      this.render();
    });

    this.box.key(['pageup'], () => {
      const height = this.fileContent.height as number || 20;
      this.scrollOffset = Math.max(0, this.scrollOffset - height);
      this.render();
    });

    this.box.key(['pagedown'], () => {
      const height = this.fileContent.height as number || 20;
      this.scrollOffset += height;
      this.render();
    });
  }

  /**
   * Get language from file extension
   */
  private getLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    for (const [lang, extensions] of Object.entries(SYNTAX_COLORS)) {
      if (extensions.includes(ext)) {
        return lang;
      }
    }
    return 'text';
  }

  /**
   * Apply basic syntax highlighting
   */
  private highlightCode(content: string, language: string): string {
    const keywords = KEYWORDS[language] || [];
    let result = content;

    // Escape blessed tags first
    result = result.replace(/{/g, '\\{').replace(/}/g, '\\}');

    // Highlight strings (basic)
    result = result.replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/g, '{green-fg}$&{/}');

    // Highlight comments (basic)
    if (['typescript', 'javascript', 'rust', 'go', 'java', 'cpp', 'c'].includes(language)) {
      result = result.replace(/(\/\/.*$)/gm, '{gray-fg}$1{/}');
      result = result.replace(/(\/\*[\s\S]*?\*\/)/g, '{gray-fg}$1{/}');
    } else if (['python', 'shell'].includes(language)) {
      result = result.replace(/(#.*$)/gm, '{gray-fg}$1{/}');
    }

    // Highlight keywords
    for (const keyword of keywords) {
      const regex = new RegExp(`\\b(${keyword})\\b`, 'g');
      result = result.replace(regex, '{cyan-fg}$1{/}');
    }

    // Highlight numbers
    result = result.replace(/\b(\d+)\b/g, '{yellow-fg}$1{/}');

    return result;
  }

  /**
   * Detect operation type from event
   */
  private getOperationType(event: LogEvent): FileOperation['type'] {
    const tool = event.tool?.toLowerCase() || '';
    const msg = event.msg.toLowerCase();

    if (tool === 'read') return 'read';
    if (['edit', 'notebookedit'].includes(tool)) return 'edit';
    if (tool === 'write') return 'write';
    if (tool === 'glob') return 'glob';

    if (msg.includes('reading') || msg.includes('read file')) return 'read';
    if (msg.includes('editing') || msg.includes('modified')) return 'edit';
    if (msg.includes('writing') || msg.includes('wrote')) return 'write';
    if (msg.includes('glob')) return 'glob';

    return 'other';
  }

  /**
   * Get operation icon
   */
  private getOperationIcon(type: FileOperation['type']): string {
    switch (type) {
      case 'read': return '📖';
      case 'edit': return '✏️';
      case 'write': return '📝';
      case 'glob': return '🔍';
      default: return '📄';
    }
  }

  /**
   * Format timestamp
   */
  private formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  /**
   * Set file context from event
   */
  setContextFromEvent(event: LogEvent): void {
    if (!event.path) return;

    // Check if we already have this file in recent
    const existing = this.recentFiles.find(f => f.path === event.path);
    if (existing) {
      // Update existing context
      const operation: FileOperation = {
        event,
        type: this.getOperationType(event),
        ts: event.ts,
        worker: event.worker,
      };
      existing.operations.unshift(operation);
      existing.lastModifiedBy = event.worker;
      existing.lastModifiedAt = event.ts;

      // Limit operations history
      existing.operations = existing.operations.slice(0, 20);

      this.currentContext = existing;
    } else {
      // Create new context
      const context: FileContext = {
        path: event.path,
        operations: [{
          event,
          type: this.getOperationType(event),
          ts: event.ts,
          worker: event.worker,
        }],
        lastModifiedBy: event.worker,
        lastModifiedAt: event.ts,
      };

      this.recentFiles.unshift(context);
      if (this.recentFiles.length > this.maxRecentFiles) {
        this.recentFiles.pop();
      }

      this.currentContext = context;
    }

    this.scrollOffset = 0;
    this.render();
  }

  /**
   * Set file content
   */
  setContent(path: string, content: string): void {
    const context = this.recentFiles.find(f => f.path === path);
    if (context) {
      context.content = content;
      if (this.currentContext?.path === path) {
        this.render();
      }
    }
  }

  /**
   * Navigate through recent files
   */
  private navigateRecent(direction: number): void {
    if (this.recentFiles.length === 0) return;

    const currentIndex = this.currentContext
      ? this.recentFiles.findIndex(f => f.path === this.currentContext!.path)
      : -1;

    let newIndex = currentIndex + direction;
    if (newIndex < 0) newIndex = this.recentFiles.length - 1;
    if (newIndex >= this.recentFiles.length) newIndex = 0;

    this.currentContext = this.recentFiles[newIndex];
    this.scrollOffset = 0;
    this.render();
  }

  /**
   * Open current file in editor
   */
  private openInEditor(): void {
    if (!this.currentContext) return;

    const editor = process.env.EDITOR || process.env.VISUAL || 'vim';
    const path = this.currentContext.path;
    const line = this.currentContext.highlightedLine || 1;

    // Log the command (in real implementation, this would spawn the editor)
    const command = `${editor} +${line} "${path}"`;
    this.fileInfo.setContent(`{yellow-fg}Opening in editor:{/} ${command}`);
    this.box.screen.render();

    // In a real implementation, we would spawn the editor process
    // For now, just display the command
  }

  /**
   * Render the panel
   */
  private render(): void {
    if (!this.currentContext) {
      this.fileInfo.setContent('{gray-fg}No file selected{/}');
      this.fileContent.setContent('{gray-fg}Click on a file event to see context{/}');
      this.fileHistory.setContent('');
      this.box.screen.render();
      return;
    }

    const ctx = this.currentContext;
    const language = this.getLanguage(ctx.path);
    const filename = ctx.path.split('/').pop() || ctx.path;
    const directory = ctx.path.substring(0, ctx.path.lastIndexOf('/')) || '/';

    // File info header
    const lastMod = ctx.lastModifiedAt
      ? `modified ${this.formatTime(ctx.lastModifiedAt)} by ${ctx.lastModifiedBy?.slice(0, 8)}`
      : '';
    this.fileInfo.setContent(
      `{bold}${filename}{/}\n{gray-fg}${directory}{/} {cyan-fg}[${language}]{/} ${lastMod}`
    );

    // File content
    let contentLines: string[] = [];
    if (ctx.content) {
      contentLines = ctx.content.split('\n');
    } else {
      // Simulated content placeholder
      contentLines = [
        '{gray-fg}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{/}',
        `{yellow-fg}File content not available{/}`,
        '{gray-fg}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{/}',
        '',
        '{gray-fg}Recent operations on this file:{/}',
      ];
    }

    // Apply syntax highlighting and line numbers
    const displayLines = contentLines.slice(this.scrollOffset, this.scrollOffset + 30);
    const lineNumberWidth = String(contentLines.length).length + 1;
    const formattedLines = displayLines.map((line, i) => {
      const lineNum = this.scrollOffset + i + 1;
      const highlighted = lineNum === ctx.highlightedLine;
      const lineNumStr = String(lineNum).padStart(lineNumberWidth);

      if (highlighted) {
        return `{bg-blue}{white-fg}${lineNumStr}|{/}{/} ${line}`;
      }
      return `{gray-fg}${lineNumStr}|{/} ${line}`;
    });

    this.fileContent.setContent(formattedLines.join('\n'));

    // File history footer
    const historyLines: string[] = [];
    historyLines.push('{gray-fg}─────────────────────────────────────────────────{/}');
    historyLines.push('{bold}Recent operations:{/}');

    const recentOps = ctx.operations.slice(0, 5);
    for (const op of recentOps) {
      const icon = this.getOperationIcon(op.type);
      const time = this.formatTime(op.ts);
      const worker = op.worker.slice(0, 8);
      const typeStr = op.type.charAt(0).toUpperCase() + op.type.slice(1);

      historyLines.push(` ${icon} {cyan-fg}${typeStr}{/} by {bold}${worker}{/} at {gray-fg}${time}{/}`);
    }

    if (ctx.operations.length > 5) {
      historyLines.push(`{gray-fg}  ... and ${ctx.operations.length - 5} more operations{/}`);
    }

    // Quick actions
    historyLines.push('');
    historyLines.push('{gray-fg}[o] Open in Editor  [/] Navigate recent files  [[]/[] Prev/Next file{/}');

    this.fileHistory.setContent(historyLines.join('\n'));
    this.box.screen.render();
  }

  /**
   * Show the panel
   */
  show(): void {
    this.visible = true;
    this.box.show();
    this.render();
  }

  /**
   * Hide the panel
   */
  hide(): void {
    this.visible = false;
    this.box.hide();
    this.box.screen.render();
  }

  /**
   * Toggle visibility
   */
  toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Check if visible
   */
  isVisible(): boolean {
    return this.visible;
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
   * Get current context
   */
  getContext(): FileContext | null {
    return this.currentContext;
  }

  /**
   * Get recent files
   */
  getRecentFiles(): FileContext[] {
    return [...this.recentFiles];
  }

  /**
   * Clear all contexts
   */
  clear(): void {
    this.currentContext = null;
    this.recentFiles = [];
    this.scrollOffset = 0;
    this.render();
  }
}

export default FileContextPanel;
