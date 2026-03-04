/**
 * CrossReferencePanel Component
 *
 * Displays cross-reference links between events, workers, files, and beads.
 * Allows navigation between related entities.
 */

import blessed from 'blessed';
import {
  CrossReferenceLink,
  CrossReferenceEntity,
  CrossReferenceEntityType,
  CrossReferenceRelationship,
  CrossReferenceStats,
} from '../../types.js';
import { CrossReferenceManager } from '../../crossReferenceManager.js';
import { colors } from '../utils/colors.js';

export interface CrossReferencePanelOptions {
  /** Parent screen */
  parent: blessed.Widgets.Screen;

  /** Position options */
  top: number | string;
  left: number | string;
  width: number | string;
  height: number | string;
}

interface LinkDisplay {
  link: CrossReferenceLink;
  displayText: string;
}

/**
 * Relationship type display names and colors
 */
const RELATIONSHIP_CONFIG: Record<CrossReferenceRelationship, { label: string; color: string }> = {
  same_bead: { label: 'Task', color: colors.magenta },
  same_file: { label: 'File', color: colors.cyan },
  same_worker: { label: 'Worker', color: colors.green },
  temporal_proximity: { label: 'Time', color: colors.yellow },
  same_session: { label: 'Session', color: colors.blue },
  dependency: { label: 'Depends', color: colors.orange },
  collision: { label: 'Collision', color: colors.red },
  parent_child: { label: 'Parent', color: colors.purple },
  error_related: { label: 'Error', color: colors.red },
  tool_sequence: { label: 'Tool', color: colors.teal },
};

/**
 * CrossReferencePanel displays and navigates cross-references
 */
export class CrossReferencePanel {
  private box: blessed.Widgets.BoxElement;
  private list: blessed.Widgets.ListElement;
  private manager: CrossReferenceManager;
  private currentEntity: CrossReferenceEntity | null = null;
  private links: LinkDisplay[] = [];
  private selectedLinkIndex: number = 0;
  private viewMode: 'links' | 'stats' | 'navigation' = 'links';

  constructor(options: CrossReferencePanelOptions) {
    this.manager = new CrossReferenceManager();

    this.box = blessed.box({
      parent: options.parent,
      top: options.top,
      left: options.left,
      width: options.width,
      height: options.height,
      label: ' Cross-References ',
      border: { type: 'line' },
      style: {
        border: { fg: colors.border },
        label: { fg: colors.header },
      },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
    });

    this.list = blessed.list({
      parent: this.box,
      top: 0,
      left: 0,
      width: '100%-2',
      height: '100%-2',
      keys: true,
      vi: true,
      mouse: true,
      style: {
        selected: { bg: colors.selected, fg: 'white' },
        item: { fg: colors.text },
      },
    });

    this.bindKeys();
  }

  /**
   * Bind keyboard shortcuts
   */
  private bindKeys(): void {
    this.list.key(['enter'], () => {
      this.navigateSelected();
    });

    this.list.key(['s'], () => {
      this.toggleStats();
    });

    this.list.key(['l'], () => {
      this.toggleLinks();
    });

    this.list.key(['r'], () => {
      this.refresh();
    });

    this.list.key(['escape'], () => {
      if (this.viewMode !== 'links') {
        this.viewMode = 'links';
        this.refresh();
      }
    });
  }

  /**
   * Set the current entity to show cross-references for
   */
  setEntity(entity: CrossReferenceEntity | null): void {
    this.currentEntity = entity;
    this.refresh();
  }

  /**
   * Set entity by type and ID
   */
  setEntityById(type: CrossReferenceEntityType, id: string): void {
    const entity = this.manager.getEntity(type, id);
    this.setEntity(entity || null);
  }

  /**
   * Refresh the display
   */
  refresh(): void {
    if (this.viewMode === 'stats') {
      this.renderStats();
    } else if (this.currentEntity) {
      this.renderLinks();
    } else {
      this.renderOverview();
    }
  }

  /**
   * Render links for the current entity
   */
  private renderLinks(): void {
    if (!this.currentEntity) return;

    this.links = [];
    const items: string[] = [];

    const allLinks = this.manager.getLinksForEntity(
      this.currentEntity.type,
      this.currentEntity.id
    );

    for (const link of allLinks) {
      const config = RELATIONSHIP_CONFIG[link.relationship] || {
        label: link.relationship,
        color: colors.text,
      };

      const isSource = link.sourceType === this.currentEntity.type &&
        link.sourceId === this.currentEntity.id;
      const arrow = isSource ? '→' : '←';
      const targetDisplay = this.getEntityDisplay(link.targetType, link.targetId);

      const displayText = `{${config.color}-fg}${config.label}{/} ${arrow} ${targetDisplay}`;
      const strengthBar = this.getStrengthBar(link.strength);

      items.push(`${displayText} ${strengthBar}`);
      this.links.push({ link, displayText });
    }

    this.list.setItems(items);
    this.box.setLabel(` Cross-References: ${this.currentEntity.label} `);
    this.box.screen.render();
  }

  /**
   * Render overview of all cross-references
   */
  private renderOverview(): void {
    const stats = this.manager.getStats();
    const items: string[] = [];

    items.push('{bold}Cross-Reference Overview{/}');
    items.push('');
    items.push(`Total Links: {cyan-fg}${stats.totalLinks}{/}`);
    items.push(`Total Entities: {green-fg}${stats.totalEntities}{/}`);
    items.push('');
    items.push('{bold}By Relationship Type:{/}');

    for (const [rel, count] of Object.entries(stats.byRelationship)) {
      if (count > 0) {
        const config = RELATIONSHIP_CONFIG[rel as CrossReferenceRelationship];
        const color = config?.color || colors.text;
        items.push(`  {${color}-fg}${config?.label || rel}{/}: ${count}`);
      }
    }

    items.push('');
    items.push('{bold}Most Linked Entities:{/}');
    for (const entity of stats.mostLinked.slice(5)) {
      items.push(`  {bold}${entity.type}{/}: ${entity.label} (${entity.linkCount} links)`);
    }

    this.list.setItems(items);
    this.box.setLabel(' Cross-References ');
    this.box.screen.render();
  }

  /**
   * Render statistics view
   */
  private renderStats(): void {
    const stats = this.manager.getStats();
    const items: string[] = [];

    items.push('{bold}Cross-Reference Statistics{/}');
    items.push('');
    items.push('{bold}Links by Type:{/}');

    const sortedRels = Object.entries(stats.byRelationship)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);

    for (const [rel, count] of sortedRels) {
      const config = RELATIONSHIP_CONFIG[rel as CrossReferenceRelationship];
      const color = config?.color || colors.text;
      const bar = this.getBar(count, stats.totalLinks);
      items.push(`  {${color}-fg}${(config?.label || rel).padEnd(12)}{/} ${bar} ${count}`);
    }

    items.push('');
    items.push('{bold}Entities by Type:{/}');

    for (const [type, count] of Object.entries(stats.byEntityType)) {
      if (count > 0) {
        items.push(`  {bold}${type.padEnd(10)}{/}: ${count}`);
      }
    }

    items.push('');
    items.push('{bold}Recent Links:{/}');
    for (const link of stats.recentLinks.slice(5)) {
      const config = RELATIONSHIP_CONFIG[link.relationship];
      const color = config?.color || colors.text;
      const sourceDisplay = this.getEntityDisplay(link.sourceType, link.sourceId);
      items.push(`  {${color}-fg}${config?.label || link.relationship}{/}: ${sourceDisplay}`);
    }

    this.list.setItems(items);
    this.box.setLabel(' Cross-Reference Statistics ');
    this.box.screen.render();
  }

  /**
   * Get a display string for an entity
   */
  private getEntityDisplay(type: CrossReferenceEntityType, id: string): string {
    switch (type) {
      case 'worker':
        return `{green-fg}${id.slice(0, 8)}{/}`;
      case 'file':
        const fileName = id.split('/').pop() || id;
        return `{cyan-fg}${fileName}{/}`;
      case 'bead':
        return `{magenta-fg}${id}{/}`;
      case 'event':
        return `{yellow-fg}${id.slice(0, 12)}...{/}`;
      default:
        return id.slice(0, 15);
    }
  }

  /**
   * Get a visual strength bar
   */
  private getStrengthBar(strength: number): string {
    const filled = Math.round(strength * 5);
    const empty = 5 - filled;
    return `{green-fg}${'█'.repeat(filled)}{/}{gray-fg}${'░'.repeat(empty)}{/}`;
  }

  /**
   * Get a proportional bar for statistics
   */
  private getBar(value: number, total: number): string {
    if (total === 0) return '';
    const percent = Math.round((value / total) * 20);
    return '█'.repeat(percent) + '░'.repeat(20 - percent);
  }

  /**
   * Navigate to the selected link's target entity
   */
  private navigateSelected(): void {
    const selected = (this.list as any).selected;
    if (selected < 0 || selected >= this.links.length) return;

    const linkDisplay = this.links[selected];
    const targetEntity = this.manager.getEntity(
      linkDisplay.link.targetType,
      linkDisplay.link.targetId
    );

    if (targetEntity) {
      this.setEntity(targetEntity);
    }
  }

  /**
   * Toggle statistics view
   */
  private toggleStats(): void {
    if (this.viewMode === 'stats') {
      this.viewMode = 'links';
    } else {
      this.viewMode = 'stats';
    }
    this.refresh();
  }

  /**
   * Toggle links view
   */
  private toggleLinks(): void {
    this.viewMode = 'links';
    this.refresh();
  }

  /**
   * Find a path to another entity
   */
  findPathTo(
    targetType: CrossReferenceEntityType,
    targetId: string
  ): void {
    if (!this.currentEntity) return;

    const path = this.manager.findPath(
      this.currentEntity.type,
      this.currentEntity.id,
      targetType,
      targetId
    );

    if (path) {
      this.renderPath(path);
    } else {
      this.list.setItems([
        `{red-fg}No path found to ${targetType}:${targetId}{/}`,
      ]);
      this.box.screen.render();
    }
  }

  /**
   * Render a navigation path
   */
  private renderPath(path: import('../../types.js').CrossReferencePath): void {
    const items: string[] = [];

    items.push('{bold}Navigation Path{/}');
    items.push('');
    items.push(`From: ${this.getEntityDisplay(path.start.type, path.start.id)}`);
    items.push(`To: ${this.getEntityDisplay(path.end.type, path.end.id)}`);
    items.push(`Length: ${path.length} steps`);
    items.push('');
    items.push('{bold}Steps:{/}');

    for (let i = 0; i < path.steps.length; i++) {
      const step = path.steps[i];
      const config = RELATIONSHIP_CONFIG[step.relationship];
      const color = config?.color || colors.text;
      const targetDisplay = this.getEntityDisplay(step.targetType, step.targetId);
      items.push(`  ${i + 1}. {${color}-fg}${config?.label || step.relationship}{/} → ${targetDisplay}`);
    }

    items.push('');
    items.push(`Description: ${path.description}`);

    this.list.setItems(items);
    this.box.setLabel(' Navigation Path ');
    this.box.screen.render();
  }

  /**
   * Focus this component
   */
  focus(): void {
    this.list.focus();
  }

  /**
   * Get the underlying blessed element
   */
  getElement(): blessed.Widgets.BoxElement {
    return this.box;
  }

  /**
   * Show the panel
   */
  show(): void {
    this.box.show();
    this.refresh();
  }

  /**
   * Hide the panel
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
}

export function createCrossReferencePanel(
  options: CrossReferencePanelOptions
): CrossReferencePanel {
  return new CrossReferencePanel(options);
}

export default CrossReferencePanel;
