/**
 * SemanticNarrativePanel Component
 *
 * TUI component to display semantic narrative summaries of worker activity.
 * Shows natural language descriptions of what workers are doing.
 */

import blessed from 'blessed';
import { SemanticNarrative, NarrativeSegment, EventPattern } from '../../types.js';
import { colors } from '../utils/colors.js';
import { getSemanticNarrativeManager } from '../../semanticNarrative.js';

export interface SemanticNarrativePanelOptions {
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

  /** Position from bottom (alternative to height) */
  bottom?: number | string;

  /** Callback when a segment is selected */
  onSelect?: (segmentId: string) => void;
}

/**
 * Get pattern icon
 */
function getPatternIcon(pattern: EventPattern): string {
  switch (pattern) {
    case 'file_editing':
      return 'E';
    case 'tool_usage':
      return 'T';
    case 'error_handling':
      return '!';
    case 'task_completion':
      return 'C';
    case 'exploration':
      return '?';
    case 'planning':
      return 'P';
    case 'debugging':
      return 'D';
    case 'research':
      return 'R';
    default:
      return '·';
  }
}

/**
 * Get pattern color
 */
function getPatternColor(pattern: EventPattern): string {
  switch (pattern) {
    case 'file_editing':
      return 'green';
    case 'tool_usage':
      return 'cyan';
    case 'error_handling':
      return 'red';
    case 'task_completion':
      return 'blue';
    case 'exploration':
      return 'magenta';
    case 'planning':
      return 'yellow';
    case 'debugging':
      return 'red';
    case 'research':
      return 'blue';
    default:
      return 'white';
  }
}

/**
 * Format duration in human-readable form
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

/**
 * Format timestamp
 */
function formatTime(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * SemanticNarrativePanel displays narrative summaries
 */
export class SemanticNarrativePanel {
  private box: blessed.Widgets.BoxElement;
  private list: blessed.Widgets.ListElement;
  private detailBox: blessed.Widgets.BoxElement;
  private narrative: SemanticNarrative | null = null;
  private segments: NarrativeSegment[] = [];
  private selectedIndex = 0;
  private viewMode: 'list' | 'detail' | 'full' = 'list';
  private onSelect?: (segmentId: string) => void;
  private narrativeManager = getSemanticNarrativeManager();

  constructor(options: SemanticNarrativePanelOptions) {
    this.onSelect = options.onSelect;

    // Main container
    this.box = blessed.box({
      parent: options.parent,
      tags: true,
      top: options.top,
      left: options.left,
      width: options.width,
      height: options.height,
      label: ' Semantic Narrative ',
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

    // List for segments
    this.list = blessed.list({
      parent: this.box,
      top: 0,
      left: 0,
      width: '100%-2',
      height: '40%',
      keys: true,
      vi: true,
      mouse: true,
      style: {
        selected: { fg: colors.focus, bold: true },
        item: { fg: colors.text },
      },
    });

    // Detail box for selected segment
    this.detailBox = blessed.box({
      parent: this.box,
      tags: true,
      bottom: 0,
      left: 0,
      width: '100%-2',
      height: '60%-1',
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      style: {
        fg: colors.text,
      },
    });

    this.bindKeys();
  }

  /**
   * Bind component-specific keys
   */
  private bindKeys(): void {
    this.list.key(['up', 'k'], () => {
      this.selectPrevious();
    });

    this.list.key(['down', 'j'], () => {
      this.selectNext();
    });

    this.list.key(['enter', 'space'], () => {
      this.toggleDetail();
    });

    this.list.key(['f'], () => {
      this.toggleFullView();
    });

    this.list.key(['r'], () => {
      this.refresh();
    });

    this.list.key(['escape'], () => {
      if (this.viewMode !== 'list') {
        this.viewMode = 'list';
        this.render();
      }
    });
  }

  /**
   * Set narrative data
   */
  setNarrative(narrative: SemanticNarrative | null): void {
    this.narrative = narrative;
    this.segments = narrative?.segments || [];
    this.selectedIndex = 0;
    this.render();
  }

  /**
   * Update with worker events
   */
  updateFromWorker(workerId: string): void {
    const narrative = this.narrativeManager.generateNarrative(workerId);
    this.setNarrative(narrative);
  }

  /**
   * Update with aggregated narrative
   */
  updateAggregated(): void {
    const narrative = this.narrativeManager.generateAggregatedNarrative();
    this.setNarrative(narrative);
  }

  /**
   * Select next segment
   */
  selectNext(): void {
    if (this.segments.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.segments.length;
    this.render();
  }

  /**
   * Select previous segment
   */
  selectPrevious(): void {
    if (this.segments.length === 0) return;
    this.selectedIndex = this.selectedIndex === 0
      ? this.segments.length - 1
      : this.selectedIndex - 1;
    this.render();
  }

  /**
   * Toggle detail view for selected segment
   */
  toggleDetail(): void {
    if (this.segments.length === 0) return;
    if (this.viewMode === 'detail') {
      this.viewMode = 'list';
    } else {
      this.viewMode = 'detail';
      this.onSelect?.(this.segments[this.selectedIndex].id);
    }
    this.render();
  }

  /**
   * Toggle full narrative view
   */
  toggleFullView(): void {
    if (this.viewMode === 'full') {
      this.viewMode = 'list';
    } else {
      this.viewMode = 'full';
    }
    this.render();
  }

  /**
   * Refresh narrative data
   */
  refresh(): void {
    if (this.narrative) {
      const updated = this.narrativeManager.getNarrative(this.narrative.id);
      if (updated) {
        this.setNarrative(updated);
      }
    }
  }

  /**
   * Get selected segment
   */
  getSelected(): NarrativeSegment | undefined {
    return this.segments[this.selectedIndex];
  }

  /**
   * Show the panel
   */
  show(): void {
    this.box.show();
    this.list.focus();
    this.render();
  }

  /**
   * Hide the panel
   */
  hide(): void {
    this.box.hide();
    this.box.screen.render();
  }

  /**
   * Check if visible
   */
  isVisible(): boolean {
    return this.box.visible;
  }

  /**
   * Render list items
   */
  private renderList(): void {
    const items: string[] = [];

    if (this.segments.length === 0) {
      items.push('{gray-fg}No narrative segments available{/}');
    } else {
      for (let i = 0; i < this.segments.length; i++) {
        const segment = this.segments[i];
        const icon = getPatternIcon(segment.pattern);
        const color = getPatternColor(segment.pattern);
        const activeMarker = segment.isActive ? '{green-fg}●{/} ' : '{gray-fg}○{/} ';
        const duration = formatDuration(segment.durationMs);
        const confidence = Math.round(segment.confidence * 100);

        const title = segment.summary.slice(0, 60);
        items.push(`${activeMarker}{${color}-fg}[${icon}]{/} ${title} {gray-fg}(${duration}, ${confidence}%){/}`);
      }
    }

    this.list.setItems(items);
    this.list.select(this.selectedIndex);
  }

  /**
   * Render detail view
   */
  private renderDetail(): void {
    if (this.segments.length === 0) {
      this.detailBox.setContent('{gray-fg}Select a segment to view details{/}');
      return;
    }

    const segment = this.segments[this.selectedIndex];
    const lines: string[] = [];

    lines.push(`{bold}Pattern:{/} {${getPatternColor(segment.pattern)}-fg}${segment.pattern}{/}`);
    lines.push(`{bold}Duration:{/} ${formatDuration(segment.durationMs)}`);
    lines.push(`{bold}Time:{/} ${formatTime(segment.startTime)} - ${formatTime(segment.endTime)}`);
    lines.push(`{bold}Confidence:{/} ${Math.round(segment.confidence * 100)}%`);
    lines.push(`{bold}Status:{/} ${segment.isActive ? '{green-fg}Active{/}' : '{gray-fg}Completed{/}'}`);

    if (segment.beadId) {
      lines.push(`{bold}Bead:{/} {cyan-fg}${segment.beadId}{/}`);
    }

    lines.push('');
    lines.push(`{bold}Summary:{/}`);
    lines.push(`  ${segment.summary}`);

    if (segment.details) {
      lines.push('');
      lines.push(`{bold}Details:{/}`);
      lines.push(`  ${segment.details}`);
    }

    // Entities
    if (segment.entities.files?.length) {
      lines.push('');
      lines.push(`{bold}Files:{/} ${segment.entities.files.length}`);
      for (const file of segment.entities.files.slice(0, 5)) {
        lines.push(`  {blue-fg}${file}{/}`);
      }
      if (segment.entities.files.length > 5) {
        lines.push(`  {gray-fg}... and ${segment.entities.files.length - 5} more{/}`);
      }
    }

    if (segment.entities.tools?.length) {
      lines.push('');
      lines.push(`{bold}Tools:{/} ${segment.entities.tools.join(', ')}`);
    }

    if (segment.entities.errors?.length) {
      lines.push('');
      lines.push(`{bold}Errors:{/} {red-fg}${segment.entities.errors.length}{/}`);
    }

    lines.push('');
    lines.push('{gray-fg}[Enter] Toggle  [f] Full View  [r] Refresh  [Esc] Back{/}');

    this.detailBox.setContent(lines.join('\n'));
  }

  /**
   * Render full narrative view
   */
  private renderFull(): void {
    if (!this.narrative) {
      this.detailBox.setContent('{gray-fg}No narrative available{/}');
      return;
    }

    const lines: string[] = [];

    lines.push(`{bold}${this.narrative.title}{/}`);
    lines.push('');
    lines.push(this.narrative.summary);
    lines.push('');

    if (this.narrative.timeline.length > 0) {
      lines.push('{bold}Timeline:{/}');
      for (const event of this.narrative.timeline.slice(0, 10)) {
        lines.push(`  • ${event}`);
      }
      if (this.narrative.timeline.length > 10) {
        lines.push(`  {gray-fg}... and ${this.narrative.timeline.length - 10} more events{/}`);
      }
      lines.push('');
    }

    lines.push('{bold}Full Narrative:{/}');
    lines.push(this.narrative.fullNarrative);

    lines.push('');
    lines.push('{gray-fg}[Esc] Back to List{/}');

    // Hide list in full view, show detail box full height
    this.list.hide();
    this.detailBox.top = 0;
    this.detailBox.height = '100%-2';

    this.detailBox.setContent(lines.join('\n'));
  }

  /**
   * Render the component
   */
  render(): void {
    // Update box label with narrative info
    if (this.narrative) {
      const segmentCount = this.segments.length;
      const activeCount = this.segments.filter(s => s.isActive).length;
      this.box.setLabel(` Semantic Narrative (${segmentCount} segments, ${activeCount} active) `);
    } else {
      this.box.setLabel(' Semantic Narrative ');
    }

    if (this.viewMode === 'full') {
      this.renderFull();
    } else {
      // Show list and detail side by side
      this.list.show();
      this.list.top = 0;
      this.list.height = '40%';
      this.detailBox.top = '40%';
      this.detailBox.height = '60%-1';

      this.renderList();
      this.renderDetail();
    }

    this.box.screen.render();
  }

  /**
   * Focus this component
   */
  focus(): void {
    this.list.focus();
  }

  /**
   * Get the underlying box element
   */
  getElement(): blessed.Widgets.BoxElement {
    return this.box;
  }
}

export default SemanticNarrativePanel;
