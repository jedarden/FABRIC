/**
 * FABRIC Cross-Reference Manager
 *
 * Detects and manages relationships between events, tasks, files, and workers.
 * Enables hyperlinking across the FABRIC dashboard for navigation.
 */

import {
  LogEvent,
  CrossReferenceLink,
  CrossReferenceEntity,
  CrossReferenceEntityType,
  CrossReferenceRelationship,
  CrossReferenceQueryOptions,
  CrossReferenceStats,
  CrossReferencePath,
} from './types.js';

/** Time window (ms) to consider events as temporally related */
const TEMPORAL_WINDOW_MS = 30000; // 30 seconds

/** Minimum strength threshold for links */
const MIN_STRENGTH = 0.1;

/** Maximum links to store */
const MAX_LINKS = 5000;

/**
 * Generate a unique ID for a cross-reference link
 */
function generateLinkId(
  sourceType: CrossReferenceEntityType,
  sourceId: string,
  targetType: CrossReferenceEntityType,
  targetId: string,
  relationship: CrossReferenceRelationship
): string {
  return `${sourceType}:${sourceId}->${relationship}:${targetType}:${targetId}`;
}

/**
 * Generate a unique ID for an entity
 */
function generateEntityId(type: CrossReferenceEntityType, id: string): string {
  return `${type}:${id}`;
}

/**
 * Internal tracking structure for entities
 */
interface InternalEntity {
  type: CrossReferenceEntityType;
  id: string;
  firstSeen: number;
  lastSeen: number;
  occurrenceCount: number;
  label: string;
}

/**
 * Cross-Reference Manager
 *
 * Tracks relationships between events, workers, files, and beads.
 */
export class CrossReferenceManager {
  private links: Map<string, CrossReferenceLink> = new Map();
  private entities: Map<string, InternalEntity> = new Map();
  private eventIndex: Map<string, string[]> = new Map();
  private workerIndex: Map<string, string[]> = new Map();
  private fileIndex: Map<string, string[]> = new Map();
  private beadIndex: Map<string, string[]> = new Map();

  /**
   * Process a log event and extract cross-references
   */
  processEvent(event: LogEvent): void {
    this.registerEntity('event', this.getEventId(event), event.ts, this.getEventLabel(event));

    if (event.worker) {
      this.registerEntity('worker', event.worker, event.ts, `Worker ${event.worker.slice(0, 8)}`);
    }

    if (event.path) {
      const fileName = event.path.split('/').pop() || event.path;
      this.registerEntity('file', event.path, event.ts, fileName);
    }

    if (event.bead) {
      this.registerEntity('bead', event.bead, event.ts, `Task ${event.bead}`);
    }

    if (event.worker) {
      this.createLink('event', this.getEventId(event), 'worker', event.worker, 'same_worker', 1.0, event.ts);
    }

    if (event.path) {
      this.createLink('event', this.getEventId(event), 'file', event.path, 'same_file', 1.0, event.ts);
    }

    if (event.bead) {
      this.createLink('event', this.getEventId(event), 'bead', event.bead, 'same_bead', 1.0, event.ts);
    }

    const eventId = this.getEventId(event);
    if (!this.eventIndex.has(eventId)) {
      this.eventIndex.set(eventId, []);
    }
  }

  /**
   * Process multiple events and find relationships
   */
  processBatch(events: LogEvent[]): void {
    for (const event of events) {
      this.processEvent(event);
    }
    this.findTemporalRelationships(events);
    this.findBeadRelationships(events);
    this.findFileRelationships(events);
    this.findToolSequences(events);
  }

  /**
   * Get human-readable label for an event
   */
  private getEventLabel(event: LogEvent): string {
    const time = new Date(event.ts).toLocaleTimeString();
    const msg = event.msg?.slice(0, 30) || 'Event';
    return `${time} ${msg}`;
  }

  /**
   * Register an entity in the tracking system
   */
  private registerEntity(
    type: CrossReferenceEntityType,
    id: string,
    timestamp: number,
    label: string
  ): void {
    const entityId = generateEntityId(type, id);
    const existing = this.entities.get(entityId);

    if (existing) {
      existing.lastSeen = timestamp;
      existing.occurrenceCount++;
    } else {
      this.entities.set(entityId, {
        type,
        id,
        firstSeen: timestamp,
        lastSeen: timestamp,
        occurrenceCount: 1,
        label,
      });
    }
  }

  /**
   * Convert internal entity to public CrossReferenceEntity format
   */
  private toCrossReferenceEntity(internal: InternalEntity): CrossReferenceEntity {
    const links = this.getLinksForEntity(internal.type, internal.id);
    const outgoingLinks = links.filter(l => l.sourceType === internal.type && l.sourceId === internal.id);
    const incomingLinks = links.filter(l => l.targetType === internal.type && l.targetId === internal.id);

    const relatedEntities = new Map<CrossReferenceEntityType, CrossReferenceLink[]>();
    for (const link of links) {
      const targetType = link.targetType;
      if (!relatedEntities.has(targetType)) {
        relatedEntities.set(targetType, []);
      }
      relatedEntities.get(targetType)!.push(link);
    }

    return {
      type: internal.type,
      id: internal.id,
      label: internal.label,
      outgoingLinks,
      incomingLinks,
      relatedEntities,
      linkCount: links.length,
      lastLinkedAt: links.length > 0 ? Math.max(...links.map(l => l.detectedAt)) : internal.lastSeen,
      firstSeen: internal.firstSeen,
      occurrenceCount: internal.occurrenceCount,
    };
  }

  /**
   * Create a cross-reference link
   */
  private createLink(
    sourceType: CrossReferenceEntityType,
    sourceId: string,
    targetType: CrossReferenceEntityType,
    targetId: string,
    relationship: CrossReferenceRelationship,
    strength: number,
    timestamp: number,
    context?: string
  ): CrossReferenceLink | null {
    if (sourceType === targetType && sourceId === targetId) {
      return null;
    }

    const linkId = generateLinkId(sourceType, sourceId, targetType, targetId, relationship);
    const existing = this.links.get(linkId);

    if (existing) {
      existing.strength = Math.min(1.0, existing.strength + 0.1);
      existing.detectedAt = timestamp;
      return existing;
    }

    const link: CrossReferenceLink = {
      id: linkId,
      sourceType,
      sourceId,
      targetType,
      targetId,
      relationship,
      strength: Math.min(1.0, Math.max(MIN_STRENGTH, strength)),
      detectedAt: timestamp,
      context,
    };

    this.links.set(linkId, link);
    this.addToIndex(sourceType, sourceId, linkId);
    this.addToIndex(targetType, targetId, linkId);

    if (this.links.size > MAX_LINKS) {
      this.trimOldLinks();
    }

    return link;
  }

  /**
   * Add link ID to appropriate index
   */
  private addToIndex(type: CrossReferenceEntityType, key: string, linkId: string): void {
    const indexMap = this.getIndexMap(type);
    if (!indexMap) return;

    if (!indexMap.has(key)) {
      indexMap.set(key, []);
    }
    const linkIds = indexMap.get(key)!;
    if (!linkIds.includes(linkId)) {
      linkIds.push(linkId);
    }
  }

  /**
   * Get the index map for an entity type
   */
  private getIndexMap(type: CrossReferenceEntityType): Map<string, string[]> | null {
    switch (type) {
      case 'event': return this.eventIndex;
      case 'worker': return this.workerIndex;
      case 'file': return this.fileIndex;
      case 'bead': return this.beadIndex;
      default: return null;
    }
  }

  /**
   * Find temporal relationships between events
   */
  private findTemporalRelationships(events: LogEvent[]): void {
    const sorted = [...events].sort((a, b) => a.ts - b.ts);

    for (let i = 0; i < sorted.length; i++) {
      const event = sorted[i];

      for (let j = i + 1; j < sorted.length; j++) {
        const other = sorted[j];
        const timeDiff = other.ts - event.ts;

        if (timeDiff > TEMPORAL_WINDOW_MS) break;
        if (event.worker === other.worker && event.ts === other.ts) continue;

        const strength = 1.0 - (timeDiff / TEMPORAL_WINDOW_MS);
        this.createLink(
          'event',
          this.getEventId(event),
          'event',
          this.getEventId(other),
          'temporal_proximity',
          strength,
          event.ts,
          `${Math.round(timeDiff / 1000)}s apart`
        );
      }
    }
  }

  /**
   * Find relationships between events on the same bead
   */
  private findBeadRelationships(events: LogEvent[]): void {
    const beadEvents = new Map<string, LogEvent[]>();

    for (const event of events) {
      if (event.bead) {
        if (!beadEvents.has(event.bead)) {
          beadEvents.set(event.bead, []);
        }
        beadEvents.get(event.bead)!.push(event);
      }
    }

    for (const [beadId, beadEventList] of beadEvents) {
      const workers = [...new Set(beadEventList.map(e => e.worker))];

      for (let i = 0; i < workers.length; i++) {
        for (let j = i + 1; j < workers.length; j++) {
          if (workers[i] !== workers[j]) {
            const firstEvent = beadEventList.find(e => e.worker === workers[i])!;
            this.createLink(
              'worker',
              workers[i],
              'worker',
              workers[j],
              'same_bead',
              0.8,
              firstEvent.ts,
              `Both worked on ${beadId}`
            );
          }
        }
      }
    }
  }

  /**
   * Find relationships between events on the same file
   */
  private findFileRelationships(events: LogEvent[]): void {
    const fileGroups = new Map<string, LogEvent[]>();

    for (const event of events) {
      if (event.path) {
        if (!fileGroups.has(event.path)) {
          fileGroups.set(event.path, []);
        }
        fileGroups.get(event.path)!.push(event);
      }
    }

    for (const [filePath, fileEvents] of fileGroups) {
      const workers = [...new Set(fileEvents.map(e => e.worker))];
      const fileName = filePath.split('/').pop() || filePath;

      for (let i = 0; i < workers.length; i++) {
        for (let j = i + 1; j < workers.length; j++) {
          if (workers[i] !== workers[j]) {
            const sorted = [...fileEvents].sort((a, b) => a.ts - b.ts);
            const firstEvent = sorted[0];
            this.createLink(
              'worker',
              workers[i],
              'worker',
              workers[j],
              'same_file',
              0.7,
              firstEvent.ts,
              `Both modified ${fileName}`
            );
          }
        }
      }

      const sorted = [...fileEvents].sort((a, b) => a.ts - b.ts);
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const timeDiff = sorted[j].ts - sorted[i].ts;
          if (timeDiff < TEMPORAL_WINDOW_MS && sorted[i].worker !== sorted[j].worker) {
            this.createLink(
              'worker',
              sorted[i].worker,
              'worker',
              sorted[j].worker,
              'collision',
              0.9,
              sorted[i].ts,
              `Collision on ${fileName}`
            );
          }
        }
      }
    }
  }

  /**
   * Find tool sequence relationships
   */
  private findToolSequences(events: LogEvent[]): void {
    const workerEvents = new Map<string, LogEvent[]>();

    for (const event of events) {
      if (!workerEvents.has(event.worker)) {
        workerEvents.set(event.worker, []);
      }
      workerEvents.get(event.worker)!.push(event);
    }

    for (const [, workerEventList] of workerEvents) {
      const sorted = [...workerEventList].sort((a, b) => a.ts - b.ts);

      for (let i = 0; i < sorted.length - 1; i++) {
        const current = sorted[i];
        const next = sorted[i + 1];

        if (current.tool && next.tool) {
          const timeDiff = next.ts - current.ts;

          if (timeDiff < 60000) {
            this.createLink(
              'event',
              this.getEventId(current),
              'event',
              this.getEventId(next),
              'tool_sequence',
              0.6,
              current.ts,
              `${current.tool} -> ${next.tool}`
            );
          }
        }
      }
    }
  }

  /**
   * Get unique event ID for an event
   */
  private getEventId(event: LogEvent): string {
    return `${event.ts}-${event.worker}`;
  }

  /**
   * Query cross-references with optional filter
   */
  query(filter?: CrossReferenceQueryOptions): CrossReferenceLink[] {
    let results = Array.from(this.links.values());

    if (!filter) return results;

    if (filter.sourceType) {
      results = results.filter(l => l.sourceType === filter.sourceType);
    }
    if (filter.targetType) {
      results = results.filter(l => l.targetType === filter.targetType);
    }
    if (filter.relationship) {
      results = results.filter(l => l.relationship === filter.relationship);
    }
    if (filter.minStrength !== undefined) {
      results = results.filter(l => l.strength >= filter.minStrength!);
    }
    if (filter.since !== undefined) {
      results = results.filter(l => l.detectedAt >= filter.since!);
    }
    if (filter.until !== undefined) {
      results = results.filter(l => l.detectedAt <= filter.until!);
    }

    results.sort((a, b) => {
      if (b.strength !== a.strength) return b.strength - a.strength;
      return b.detectedAt - a.detectedAt;
    });

    if (filter.limit !== undefined) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  /**
   * Get all links for a specific entity
   */
  getLinksForEntity(type: CrossReferenceEntityType, id: string): CrossReferenceLink[] {
    const indexMap = this.getIndexMap(type);
    if (!indexMap) return [];

    const linkIds = indexMap.get(id) || [];
    return linkIds
      .map(linkId => this.links.get(linkId))
      .filter((link): link is CrossReferenceLink => link !== undefined);
  }

  /**
   * Get linked entities for a specific entity
   */
  getLinkedEntities(type: CrossReferenceEntityType, id: string): CrossReferenceEntity[] {
    const links = this.getLinksForEntity(type, id);
    const internalEntities: InternalEntity[] = [];

    for (const link of links) {
      const targetEntityId = generateEntityId(link.targetType, link.targetId);
      const targetEntity = this.entities.get(targetEntityId);
      if (targetEntity) {
        internalEntities.push(targetEntity);
      }

      if (link.sourceType !== type || link.sourceId !== id) {
        const sourceEntityId = generateEntityId(link.sourceType, link.sourceId);
        const sourceEntity = this.entities.get(sourceEntityId);
        if (sourceEntity) {
          internalEntities.push(sourceEntity);
        }
      }
    }

    const seen = new Set<string>();
    return internalEntities.filter(e => {
      const key = generateEntityId(e.type, e.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(e => this.toCrossReferenceEntity(e));
  }

  /**
   * Find a navigation path between two entities
   */
  findPath(
    sourceType: CrossReferenceEntityType,
    sourceId: string,
    targetType: CrossReferenceEntityType,
    targetId: string,
    maxDepth: number = 5
  ): CrossReferencePath | null {
    const sourceEntityId = generateEntityId(sourceType, sourceId);
    const targetEntityId = generateEntityId(targetType, targetId);

    const sourceInternal = this.entities.get(sourceEntityId);
    const targetInternal = this.entities.get(targetEntityId);

    if (!sourceInternal || !targetInternal) return null;

    const queue: { entityId: string; path: CrossReferenceLink[] }[] = [
      { entityId: sourceEntityId, path: [] },
    ];
    const visited = new Set<string>();
    visited.add(sourceEntityId);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.path.length > maxDepth) continue;

      const [currentType, currentId] = current.entityId.split(':') as [CrossReferenceEntityType, string];
      const links = this.getLinksForEntity(currentType, currentId);

      for (const link of links) {
        const nextEntityId = generateEntityId(link.targetType, link.targetId);

        if (nextEntityId === targetEntityId) {
          const sourceEntity = this.toCrossReferenceEntity(sourceInternal);
          const targetEntity = this.toCrossReferenceEntity(targetInternal);
          return {
            start: sourceEntity,
            end: targetEntity,
            steps: [...current.path, link],
            length: current.path.length + 1,
            description: this.describePath([...current.path, link]),
          };
        }

        if (!visited.has(nextEntityId)) {
          visited.add(nextEntityId);
          queue.push({
            entityId: nextEntityId,
            path: [...current.path, link],
          });
        }
      }
    }

    return null;
  }

  /**
   * Generate a human-readable description of a path
   */
  private describePath(path: CrossReferenceLink[]): string {
    if (path.length === 0) return 'Direct link';

    const parts: string[] = [];
    for (const link of path) {
      switch (link.relationship) {
        case 'same_bead':
          parts.push(`same task (${link.targetId})`);
          break;
        case 'same_file':
          parts.push(`file: ${link.targetId.split('/').pop()}`);
          break;
        case 'same_worker':
          parts.push(`worker: ${link.targetId.slice(0, 8)}`);
          break;
        case 'temporal_proximity':
          parts.push('around same time');
          break;
        case 'collision':
          parts.push('collision');
          break;
        case 'tool_sequence':
          parts.push('tool sequence');
          break;
        default:
          parts.push(link.relationship);
      }
    }

    return parts.join(' -> ');
  }

  /**
   * Get statistics about cross-references
   */
  getStats(): CrossReferenceStats {
    const byRelationship: Record<CrossReferenceRelationship, number> = {
      same_bead: 0,
      same_file: 0,
      same_worker: 0,
      temporal_proximity: 0,
      same_session: 0,
      dependency: 0,
      collision: 0,
      parent_child: 0,
      error_related: 0,
      tool_sequence: 0,
    };

    const byEntityType: Record<CrossReferenceEntityType, number> = {
      event: 0,
      worker: 0,
      file: 0,
      bead: 0,
      session: 0,
    };

    for (const link of this.links.values()) {
      byRelationship[link.relationship]++;
    }

    for (const entity of this.entities.values()) {
      byEntityType[entity.type]++;
    }

    const entityLinkCounts = new Map<string, number>();
    for (const link of this.links.values()) {
      const sourceKey = generateEntityId(link.sourceType, link.sourceId);
      const targetKey = generateEntityId(link.targetType, link.targetId);
      entityLinkCounts.set(sourceKey, (entityLinkCounts.get(sourceKey) || 0) + 1);
      entityLinkCounts.set(targetKey, (entityLinkCounts.get(targetKey) || 0) + 1);
    }

    const sortedEntities = Array.from(entityLinkCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([entityId]) => this.entities.get(entityId))
      .filter((e): e is InternalEntity => e !== undefined)
      .map(e => this.toCrossReferenceEntity(e));

    const recentLinks = Array.from(this.links.values())
      .sort((a, b) => b.detectedAt - a.detectedAt)
      .slice(0, 10);

    return {
      totalLinks: this.links.size,
      totalEntities: this.entities.size,
      byRelationship,
      byEntityType,
      mostLinked: sortedEntities,
      recentLinks,
    };
  }

  /**
   * Trim old links when over limit
   */
  private trimOldLinks(): void {
    const sorted = Array.from(this.links.entries())
      .sort((a, b) => b[1].detectedAt - a[1].detectedAt);

    const toKeep = new Map(sorted.slice(0, MAX_LINKS / 2));
    this.links = toKeep;
    this.rebuildIndices();
  }

  /**
   * Rebuild all indices from current links
   */
  private rebuildIndices(): void {
    this.eventIndex.clear();
    this.workerIndex.clear();
    this.fileIndex.clear();
    this.beadIndex.clear();

    for (const [linkId, link] of this.links) {
      this.addToIndex(link.sourceType, link.sourceId, linkId);
      this.addToIndex(link.targetType, link.targetId, linkId);
    }
  }

  /**
   * Clear all cross-references
   */
  clear(): void {
    this.links.clear();
    this.entities.clear();
    this.eventIndex.clear();
    this.workerIndex.clear();
    this.fileIndex.clear();
    this.beadIndex.clear();
  }

  /**
   * Get entity by type and ID
   */
  getEntity(type: CrossReferenceEntityType, id: string): CrossReferenceEntity | undefined {
    const internal = this.entities.get(generateEntityId(type, id));
    return internal ? this.toCrossReferenceEntity(internal) : undefined;
  }

  /**
   * Get link by ID
   */
  getLink(linkId: string): CrossReferenceLink | undefined {
    return this.links.get(linkId);
  }

  /**
   * Get all entities
   */
  getAllEntities(): CrossReferenceEntity[] {
    return Array.from(this.entities.values()).map(e => this.toCrossReferenceEntity(e));
  }

  /**
   * Get all links
   */
  getAllLinks(): CrossReferenceLink[] {
    return Array.from(this.links.values());
  }
}

let globalManager: CrossReferenceManager | undefined;

export function getCrossReferenceManager(): CrossReferenceManager {
  if (!globalManager) {
    globalManager = new CrossReferenceManager();
  }
  return globalManager;
}

export function resetCrossReferenceManager(): void {
  globalManager = undefined;
}

export default CrossReferenceManager;
