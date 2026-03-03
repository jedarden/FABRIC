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
