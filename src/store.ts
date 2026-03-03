/**
 * FABRIC In-Memory Event Store
 *
 * Stores and indexes LogEvents for efficient querying.
 */

import { LogEvent, WorkerInfo, WorkerStatus, EventFilter, EventStore } from './types.js';

export class InMemoryEventStore implements EventStore {
  private events: LogEvent[] = [];
  private workers: Map<string, WorkerInfo> = new Map();
  private maxEvents: number;

  constructor(maxEvents: number = 10000) {
    this.maxEvents = maxEvents;
  }

  /**
   * Add an event to the store
   */
  add(event: LogEvent): void {
    this.events.push(event);
    this.updateWorkerInfo(event);

    // Trim if over limit
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  /**
   * Query events with optional filter
   */
  query(filter?: EventFilter): LogEvent[] {
    if (!filter) {
      return [...this.events];
    }

    return this.events.filter((event) => {
      if (filter.worker && event.worker !== filter.worker) return false;
      if (filter.level && event.level !== filter.level) return false;
      if (filter.bead && event.bead !== filter.bead) return false;
      if (filter.path && event.path !== filter.path) return false;
      if (filter.since && event.ts < filter.since) return false;
      if (filter.until && event.ts > filter.until) return false;
      return true;
    });
  }

  /**
   * Get worker info
   */
  getWorker(workerId: string): WorkerInfo | undefined {
    return this.workers.get(workerId);
  }

  /**
   * Get all workers
   */
  getWorkers(): WorkerInfo[] {
    return Array.from(this.workers.values());
  }

  /**
   * Clear all events
   */
  clear(): void {
    this.events = [];
    this.workers.clear();
  }

  /**
   * Get event count
   */
  get size(): number {
    return this.events.length;
  }

  /**
   * Update worker info based on event
   */
  private updateWorkerInfo(event: LogEvent): void {
    let worker = this.workers.get(event.worker);

    if (!worker) {
      worker = {
        id: event.worker,
        status: 'active',
        beadsCompleted: 0,
        firstSeen: event.ts,
        lastActivity: event.ts,
      };
      this.workers.set(event.worker, worker);
    }

    // Update last activity
    worker.lastActivity = event.ts;

    // Update status based on event
    if (event.level === 'error') {
      worker.status = 'error';
    } else if (event.msg.includes('completed') || event.msg.includes('complete')) {
      worker.status = 'idle';
      if (event.bead) {
        worker.beadsCompleted++;
      }
    } else if (event.msg.includes('Starting') || event.msg.includes('starting')) {
      worker.status = 'active';
    }

    // Update last event
    worker.lastEvent = event;
  }
}

/**
 * Create a singleton store instance
 */
let globalStore: InMemoryEventStore | undefined;

export function getStore(): InMemoryEventStore {
  if (!globalStore) {
    globalStore = new InMemoryEventStore();
  }
  return globalStore;
}

export function resetStore(): void {
  globalStore = undefined;
}
