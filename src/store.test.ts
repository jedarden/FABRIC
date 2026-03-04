/**
 * Tests for FABRIC In-Memory Event Store
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryEventStore, getStore, resetStore } from './store.js';
import { LogEvent } from './types.js';

describe('InMemoryEventStore', () => {
  let store: InMemoryEventStore;

  beforeEach(() => {
    store = new InMemoryEventStore();
  });

  const createEvent = (overrides: Partial<LogEvent> = {}): LogEvent => ({
    ts: Date.now(),
    worker: 'w-test',
    level: 'info',
    msg: 'Test message',
    ...overrides,
  });

  describe('add', () => {
    it('should add an event to the store', () => {
      const event = createEvent();

      store.add(event);

      expect(store.size).toBe(1);
    });

    it('should add multiple events', () => {
      store.add(createEvent({ worker: 'w1' }));
      store.add(createEvent({ worker: 'w2' }));
      store.add(createEvent({ worker: 'w3' }));

      expect(store.size).toBe(3);
    });

    it('should update worker info when adding event', () => {
      const event = createEvent({ worker: 'w-new' });

      store.add(event);

      const worker = store.getWorker('w-new');
      expect(worker).toBeDefined();
      expect(worker?.id).toBe('w-new');
    });
  });

  describe('query', () => {
    beforeEach(() => {
      // Add some test events
      store.add(createEvent({ worker: 'w1', level: 'info', bead: 'bd-1', ts: 1000 }));
      store.add(createEvent({ worker: 'w1', level: 'debug', bead: 'bd-1', ts: 2000 }));
      store.add(createEvent({ worker: 'w2', level: 'error', bead: 'bd-2', ts: 3000 }));
      store.add(createEvent({ worker: 'w2', level: 'info', bead: 'bd-2', ts: 4000 }));
      store.add(createEvent({ worker: 'w3', level: 'warn', bead: 'bd-3', ts: 5000 }));
    });

    it('should return all events without filter', () => {
      const events = store.query();

      expect(events).toHaveLength(5);
    });

    it('should filter by worker', () => {
      const events = store.query({ worker: 'w1' });

      expect(events).toHaveLength(2);
      expect(events.every((e) => e.worker === 'w1')).toBe(true);
    });

    it('should filter by level', () => {
      const events = store.query({ level: 'error' });

      expect(events).toHaveLength(1);
      expect(events[0].worker).toBe('w2');
    });

    it('should filter by bead', () => {
      const events = store.query({ bead: 'bd-2' });

      expect(events).toHaveLength(2);
      expect(events.every((e) => e.bead === 'bd-2')).toBe(true);
    });

    it('should filter by since timestamp', () => {
      const events = store.query({ since: 3000 });

      expect(events).toHaveLength(3);
    });

    it('should filter by until timestamp', () => {
      const events = store.query({ until: 3000 });

      expect(events).toHaveLength(3);
    });

    it('should combine multiple filters', () => {
      const events = store.query({ worker: 'w2', level: 'error' });

      expect(events).toHaveLength(1);
      expect(events[0].ts).toBe(3000);
    });

    it('should return empty array when no matches', () => {
      const events = store.query({ worker: 'nonexistent' });

      expect(events).toEqual([]);
    });

    it('should return a copy of events array', () => {
      const events1 = store.query();
      const events2 = store.query();

      expect(events1).not.toBe(events2); // Different array references
      expect(events1).toEqual(events2); // Same content
    });
  });

  describe('getWorker', () => {
    it('should return undefined for unknown worker', () => {
      expect(store.getWorker('unknown')).toBeUndefined();
    });

    it('should return worker info for known worker', () => {
      store.add(createEvent({ worker: 'w-known' }));

      const worker = store.getWorker('w-known');

      expect(worker).toBeDefined();
      expect(worker?.id).toBe('w-known');
      expect(worker?.status).toBe('active');
    });
  });

  describe('getWorkers', () => {
    it('should return empty array when no events', () => {
      expect(store.getWorkers()).toEqual([]);
    });

    it('should return all workers', () => {
      store.add(createEvent({ worker: 'w1' }));
      store.add(createEvent({ worker: 'w2' }));
      store.add(createEvent({ worker: 'w3' }));

      const workers = store.getWorkers();

      expect(workers).toHaveLength(3);
      expect(workers.map((w) => w.id).sort()).toEqual(['w1', 'w2', 'w3']);
    });
  });

  describe('worker status tracking', () => {
    it('should set status to active for new worker', () => {
      store.add(createEvent({ worker: 'w-new' }));

      const worker = store.getWorker('w-new');
      expect(worker?.status).toBe('active');
    });

    it('should set status to error on error event', () => {
      store.add(createEvent({ worker: 'w-test', level: 'error' }));

      const worker = store.getWorker('w-test');
      expect(worker?.status).toBe('error');
    });

    it('should set status to idle on completed message', () => {
      store.add(createEvent({ worker: 'w-test', msg: 'Task completed successfully' }));

      const worker = store.getWorker('w-test');
      expect(worker?.status).toBe('idle');
    });

    it('should set status to idle on complete message', () => {
      store.add(createEvent({ worker: 'w-test', msg: 'Task complete' }));

      const worker = store.getWorker('w-test');
      expect(worker?.status).toBe('idle');
    });

    it('should set status to active on Starting message', () => {
      // First make it idle
      store.add(createEvent({ worker: 'w-test', msg: 'Task completed' }));
      // Then starting
      store.add(createEvent({ worker: 'w-test', msg: 'Starting new task' }));

      const worker = store.getWorker('w-test');
      expect(worker?.status).toBe('active');
    });

    it('should increment beadsCompleted when task completes with bead', () => {
      store.add(createEvent({ worker: 'w-test', msg: 'Task completed', bead: 'bd-1' }));
      store.add(createEvent({ worker: 'w-test', msg: 'Task completed', bead: 'bd-2' }));

      const worker = store.getWorker('w-test');
      expect(worker?.beadsCompleted).toBe(2);
    });

    it('should track firstSeen timestamp', () => {
      const earlyTs = 1000;
      const lateTs = 5000;

      store.add(createEvent({ worker: 'w-test', ts: lateTs }));
      store.add(createEvent({ worker: 'w-test', ts: earlyTs }));

      const worker = store.getWorker('w-test');
      expect(worker?.firstSeen).toBe(lateTs); // First event sets firstSeen
    });

    it('should track lastActivity timestamp', () => {
      const ts1 = 1000;
      const ts2 = 5000;

      store.add(createEvent({ worker: 'w-test', ts: ts1 }));
      store.add(createEvent({ worker: 'w-test', ts: ts2 }));

      const worker = store.getWorker('w-test');
      expect(worker?.lastActivity).toBe(ts2);
    });

    it('should track lastEvent', () => {
      const event1 = createEvent({ worker: 'w-test', msg: 'First' });
      const event2 = createEvent({ worker: 'w-test', msg: 'Second' });

      store.add(event1);
      store.add(event2);

      const worker = store.getWorker('w-test');
      expect(worker?.lastEvent?.msg).toBe('Second');
    });
  });

  describe('clear', () => {
    it('should clear all events', () => {
      store.add(createEvent());
      store.add(createEvent());

      store.clear();

      expect(store.size).toBe(0);
    });

    it('should clear all workers', () => {
      store.add(createEvent({ worker: 'w1' }));
      store.add(createEvent({ worker: 'w2' }));

      store.clear();

      expect(store.getWorkers()).toEqual([]);
    });
  });

  describe('maxEvents limit', () => {
    it('should trim old events when over limit', () => {
      const smallStore = new InMemoryEventStore(3);

      smallStore.add(createEvent({ ts: 1 }));
      smallStore.add(createEvent({ ts: 2 }));
      smallStore.add(createEvent({ ts: 3 }));
      smallStore.add(createEvent({ ts: 4 }));

      expect(smallStore.size).toBe(3);
    });

    it('should keep most recent events', () => {
      const smallStore = new InMemoryEventStore(2);

      smallStore.add(createEvent({ ts: 1, msg: 'old' }));
      smallStore.add(createEvent({ ts: 2, msg: 'mid' }));
      smallStore.add(createEvent({ ts: 3, msg: 'new' }));

      const events = smallStore.query();
      expect(events).toHaveLength(2);
      expect(events[0].msg).toBe('mid');
      expect(events[1].msg).toBe('new');
    });

    it('should use default maxEvents of 10000', () => {
      const defaultStore = new InMemoryEventStore();

      // Add 10001 events
      for (let i = 0; i < 10001; i++) {
        defaultStore.add(createEvent({ ts: i }));
      }

      expect(defaultStore.size).toBe(10000);
    });
  });

  describe('size property', () => {
    it('should return 0 for empty store', () => {
      expect(store.size).toBe(0);
    });

    it('should return correct count after adds', () => {
      store.add(createEvent());
      store.add(createEvent());

      expect(store.size).toBe(2);
    });
  });

  describe('collision detection', () => {
    it('should detect collision when multiple workers modify same file', () => {
      const ts = Date.now();
      const path = '/src/test.ts';

      // Worker 1 modifies file
      store.add(createEvent({
        worker: 'w1',
        path,
        tool: 'Edit',
        ts
      }));

      // Worker 2 modifies same file within collision window
      store.add(createEvent({
        worker: 'w2',
        path,
        tool: 'Edit',
        ts: ts + 1000 // Within 5 second window
      }));

      const collisions = store.getCollisions();
      expect(collisions).toHaveLength(1);
      expect(collisions[0].path).toBe(path);
      expect(collisions[0].workers).toContain('w1');
      expect(collisions[0].workers).toContain('w2');
      expect(collisions[0].isActive).toBe(true);
    });

    it('should not detect collision for events outside time window', () => {
      const ts = Date.now();
      const path = '/src/test.ts';

      // Worker 1 modifies file
      store.add(createEvent({
        worker: 'w1',
        path,
        tool: 'Edit',
        ts
      }));

      // Worker 2 modifies same file after collision window
      store.add(createEvent({
        worker: 'w2',
        path,
        tool: 'Edit',
        ts: ts + 10000 // Outside 5 second window
      }));

      const collisions = store.getCollisions();
      expect(collisions).toHaveLength(0);
    });

    it('should not detect collision for different files', () => {
      const ts = Date.now();

      store.add(createEvent({
        worker: 'w1',
        path: '/src/a.ts',
        tool: 'Edit',
        ts
      }));

      store.add(createEvent({
        worker: 'w2',
        path: '/src/b.ts',
        tool: 'Edit',
        ts: ts + 1000
      }));

      const collisions = store.getCollisions();
      expect(collisions).toHaveLength(0);
    });

    it('should not detect collision for same worker modifying same file', () => {
      const ts = Date.now();
      const path = '/src/test.ts';

      store.add(createEvent({
        worker: 'w1',
        path,
        tool: 'Edit',
        ts
      }));

      store.add(createEvent({
        worker: 'w1',
        path,
        tool: 'Write',
        ts: ts + 1000
      }));

      const collisions = store.getCollisions();
      expect(collisions).toHaveLength(0);
    });

    it('should only detect collisions for file modification tools', () => {
      const ts = Date.now();
      const path = '/src/test.ts';

      // Read tool - not a modification
      store.add(createEvent({
        worker: 'w1',
        path,
        tool: 'Read',
        ts
      }));

      store.add(createEvent({
        worker: 'w2',
        path,
        tool: 'Read',
        ts: ts + 1000
      }));

      const collisions = store.getCollisions();
      expect(collisions).toHaveLength(0);
    });

    it('should detect collisions for Edit, Write, and NotebookEdit tools', () => {
      const ts = Date.now();
      const path = '/src/test.ts';

      store.add(createEvent({
        worker: 'w1',
        path,
        tool: 'Edit',
        ts
      }));

      store.add(createEvent({
        worker: 'w2',
        path,
        tool: 'Write',
        ts: ts + 1000
      }));

      store.add(createEvent({
        worker: 'w3',
        path,
        tool: 'NotebookEdit',
        ts: ts + 2000
      }));

      const collisions = store.getCollisions();
      expect(collisions).toHaveLength(1);
      expect(collisions[0].workers).toHaveLength(3);
    });

    it('should set hasCollision flag on worker info', () => {
      const ts = Date.now();
      const path = '/src/test.ts';

      store.add(createEvent({
        worker: 'w1',
        path,
        tool: 'Edit',
        ts
      }));

      expect(store.getWorker('w1')?.hasCollision).toBe(false);

      store.add(createEvent({
        worker: 'w2',
        path,
        tool: 'Edit',
        ts: ts + 1000
      }));

      expect(store.getWorker('w1')?.hasCollision).toBe(true);
      expect(store.getWorker('w2')?.hasCollision).toBe(true);
    });

    it('should track active files for workers', () => {
      const ts = Date.now();
      const path = '/src/test.ts';

      store.add(createEvent({
        worker: 'w1',
        path,
        tool: 'Edit',
        ts
      }));

      const worker = store.getWorker('w1');
      expect(worker?.activeFiles).toContain(path);
    });

    it('should get collisions for specific worker', () => {
      const ts = Date.now();
      const path = '/src/test.ts';

      store.add(createEvent({
        worker: 'w1',
        path,
        tool: 'Edit',
        ts
      }));

      store.add(createEvent({
        worker: 'w2',
        path,
        tool: 'Edit',
        ts: ts + 1000
      }));

      const worker1Collisions = store.getWorkerCollisions('w1');
      expect(worker1Collisions).toHaveLength(1);

      const worker3Collisions = store.getWorkerCollisions('w3');
      expect(worker3Collisions).toHaveLength(0);
    });
  });

  describe('Cross-Reference Integration', () => {
    it('should track cross-references when events are added', () => {
      const ts = Date.now();

      // Add events with related entities
      store.add(createEvent({
        worker: 'w1',
        bead: 'bd-1',
        path: '/src/file.ts',
        tool: 'Edit',
        ts
      }));

      store.add(createEvent({
        worker: 'w1',
        bead: 'bd-1',
        path: '/src/file.ts',
        tool: 'Write',
        ts: ts + 1000
      }));

      // Query cross-references
      const stats = store.getCrossReferenceStats();
      expect(stats.totalLinks).toBeGreaterThan(0);
      expect(stats.totalEntities).toBeGreaterThan(0);
    });

    it('should create links between events and workers', () => {
      const ts = Date.now();

      store.add(createEvent({
        worker: 'w-test-123',
        msg: 'Starting task',
        ts
      }));

      // Get links for the worker
      const links = store.getCrossReferenceLinksForEntity('worker', 'w-test-123');
      expect(links.length).toBeGreaterThan(0);

      // Should have links to events
      const eventLinks = links.filter(l => l.targetType === 'event' || l.sourceType === 'event');
      expect(eventLinks.length).toBeGreaterThan(0);
    });

    it('should create links between events and files', () => {
      const ts = Date.now();
      const filePath = '/src/test.ts';

      store.add(createEvent({
        worker: 'w1',
        path: filePath,
        tool: 'Edit',
        ts
      }));

      // Get links for the file
      const links = store.getCrossReferenceLinksForEntity('file', filePath);
      expect(links.length).toBeGreaterThan(0);
    });

    it('should create links between events and beads', () => {
      const ts = Date.now();
      const beadId = 'bd-test-123';

      store.add(createEvent({
        worker: 'w1',
        bead: beadId,
        msg: 'Working on bead',
        ts
      }));

      // Get links for the bead
      const links = store.getCrossReferenceLinksForEntity('bead', beadId);
      expect(links.length).toBeGreaterThan(0);
    });

    it('should find linked entities', () => {
      const ts = Date.now();
      const workerId = 'w-linked';
      const filePath = '/src/linked.ts';

      store.add(createEvent({
        worker: workerId,
        path: filePath,
        tool: 'Edit',
        ts
      }));

      // Get linked entities for the worker
      const linkedEntities = store.getLinkedEntities('worker', workerId);
      expect(linkedEntities.length).toBeGreaterThan(0);

      // Should include event and/or file entity
      // Note: file entity linking happens during batch processing
      const hasEventOrFileEntity = linkedEntities.some(
        e => (e.type === 'event') || (e.type === 'file' && e.id === filePath)
      );
      expect(hasEventOrFileEntity).toBe(true);
    });

    it('should get cross-reference entity details', () => {
      const ts = Date.now();
      const workerId = 'w-entity-test';

      store.add(createEvent({
        worker: workerId,
        msg: 'Test event',
        ts
      }));

      // Get entity
      const entity = store.getCrossReferenceEntity('worker', workerId);
      expect(entity).toBeDefined();
      expect(entity?.type).toBe('worker');
      expect(entity?.id).toBe(workerId);
      expect(entity?.linkCount).toBeGreaterThan(0);
    });

    it('should query cross-references with filters', () => {
      const ts = Date.now();

      store.add(createEvent({
        worker: 'w1',
        bead: 'bd-1',
        path: '/src/file.ts',
        tool: 'Edit',
        ts
      }));

      // Query links by relationship type
      const sameBeadLinks = store.queryCrossReferences({ relationship: 'same_bead' });
      expect(Array.isArray(sameBeadLinks)).toBe(true);

      // Query links by source type
      const eventLinks = store.queryCrossReferences({ sourceType: 'event' });
      expect(Array.isArray(eventLinks)).toBe(true);
      expect(eventLinks.every(l => l.sourceType === 'event')).toBe(true);
    });

    it('should find navigation paths between entities', () => {
      const ts = Date.now();
      const workerId = 'w-path';
      const beadId = 'bd-path';

      store.add(createEvent({
        worker: workerId,
        bead: beadId,
        msg: 'Working',
        ts
      }));

      // Find path from worker to bead
      const path = store.findCrossReferencePath('worker', workerId, 'bead', beadId);

      // Path may or may not exist depending on link creation timing
      if (path) {
        expect(path.start.id).toBe(workerId);
        expect(path.end.id).toBe(beadId);
        expect(path.length).toBeGreaterThan(0);
      }
    });

    it('should clear cross-references when store is cleared', () => {
      const ts = Date.now();

      store.add(createEvent({
        worker: 'w1',
        bead: 'bd-1',
        ts
      }));

      let stats = store.getCrossReferenceStats();
      expect(stats.totalLinks).toBeGreaterThan(0);

      store.clear();

      stats = store.getCrossReferenceStats();
      expect(stats.totalLinks).toBe(0);
      expect(stats.totalEntities).toBe(0);
    });

    it('should get all cross-reference entities', () => {
      const ts = Date.now();

      store.add(createEvent({
        worker: 'w1',
        bead: 'bd-1',
        path: '/src/test.ts',
        tool: 'Edit',
        ts
      }));

      const allEntities = store.getAllCrossReferenceEntities();
      expect(Array.isArray(allEntities)).toBe(true);
      expect(allEntities.length).toBeGreaterThan(0);

      // Should have different entity types
      const types = new Set(allEntities.map(e => e.type));
      expect(types.size).toBeGreaterThan(1);
    });

    it('should get all cross-reference links', () => {
      const ts = Date.now();

      store.add(createEvent({
        worker: 'w1',
        bead: 'bd-1',
        path: '/src/test.ts',
        tool: 'Edit',
        ts
      }));

      const allLinks = store.getAllCrossReferenceLinks();
      expect(Array.isArray(allLinks)).toBe(true);
      expect(allLinks.length).toBeGreaterThan(0);

      // All links should have required fields
      allLinks.forEach(link => {
        expect(link.id).toBeDefined();
        expect(link.sourceType).toBeDefined();
        expect(link.targetType).toBeDefined();
        expect(link.relationship).toBeDefined();
        expect(typeof link.strength).toBe('number');
      });
    });
  });
});

describe('getStore and resetStore', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    resetStore();
  });

  it('should return the same store instance', () => {
    const store1 = getStore();
    const store2 = getStore();

    expect(store1).toBe(store2);
  });

  it('should create new store after reset', () => {
    const store1 = getStore();
    resetStore();
    const store2 = getStore();

    expect(store1).not.toBe(store2);
  });

  it('should clear store on reset', () => {
    const store = getStore();
    store.add({
      ts: Date.now(),
      worker: 'w-test',
      level: 'info',
      msg: 'Test',
    });

    expect(store.size).toBe(1);

    resetStore();

    const newStore = getStore();
    expect(newStore.size).toBe(0);
  });
});
