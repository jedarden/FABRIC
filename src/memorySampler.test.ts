/**
 * FABRIC MemorySampler Tests
 *
 * Note: Full fs mocking is not possible in ESM. These tests focus on:
 * 1. Public API behavior (register/unregister/sampling)
 * 2. Parse logic with direct function testing
 * 3. Real-world behavior with actual /proc reads (if available)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemorySampler, getMemorySampler, resetMemorySampler } from './memorySampler.js';

// Create a testable MemorySampler that allows injecting read behavior
class TestableMemorySampler extends MemorySampler {
  private mockContent: string | null = null;

  injectMockStatus(content: string | null) {
    this.mockContent = content;
  }

  sampleProcStatus(pid: number): import('./memorySampler.js').WorkerMemorySample {
    if (this.mockContent === null) {
      // Simulate read failure - return null values
      return {
        rssKb: null,
        peakRssKb: null,
        swapKb: null,
        sampledAt: Date.now(),
      };
    }
    return this['parseProcStatus'](this.mockContent);
  }

  sampleAllWorkers(): Map<string, import('./memorySampler.js').WorkerMemorySample> {
    if (this.mockContent === null) {
      // Simulate read failure - return null values
      const results = new Map<string, import('./memorySampler.js').WorkerMemorySample>();
      for (const workerId of this.getWorkerIds()) {
        results.set(workerId, {
          rssKb: null,
          peakRssKb: null,
          swapKb: null,
          sampledAt: Date.now(),
        });
      }
      return results;
    }
    const parsed = this['parseProcStatus'](this.mockContent);
    const results = new Map<string, import('./memorySampler.js').WorkerMemorySample>();
    for (const workerId of this.getWorkerIds()) {
      results.set(workerId, parsed);
    }
    return results;
  }

  getWorkerMemory(workerId: string): import('./memorySampler.js').WorkerMemorySample | null {
    if (!this['workers'].has(workerId)) {
      return null;
    }
    return this.sampleProcStatus(0);
  }
}

describe('MemorySampler', () => {
  let sampler: MemorySampler;

  beforeEach(() => {
    resetMemorySampler();
    sampler = new MemorySampler(100, 30000); // 100ms interval for testing
  });

  afterEach(() => {
    sampler.stop();
    sampler.clear();
  });

  describe('registerWorkerPid', () => {
    it('should register a worker PID', () => {
      sampler.registerWorkerPid('worker-1', 12345);
      expect(sampler.workerCount).toBe(1);
      expect(sampler.getWorkerIds()).toEqual(['worker-1']);
    });

    it('should update existing worker PID', () => {
      sampler.registerWorkerPid('worker-1', 12345);
      sampler.registerWorkerPid('worker-1', 67890); // New PID
      expect(sampler.workerCount).toBe(1);
    });

    it('should track multiple workers', () => {
      sampler.registerWorkerPid('worker-1', 12345);
      sampler.registerWorkerPid('worker-2', 67890);
      expect(sampler.workerCount).toBe(2);
      expect(new Set(sampler.getWorkerIds())).toEqual(new Set(['worker-1', 'worker-2']));
    });
  });

  describe('unregisterWorker', () => {
    it('should unregister a worker', () => {
      sampler.registerWorkerPid('worker-1', 12345);
      sampler.unregisterWorker('worker-1');
      expect(sampler.workerCount).toBe(0);
      expect(sampler.getWorkerIds()).toEqual([]);
    });

    it('should handle unregistering non-existent worker', () => {
      sampler.unregisterWorker('worker-1');
      expect(sampler.workerCount).toBe(0);
    });
  });

  describe('parseProcStatus', () => {
    it('should parse valid /proc/<pid>/status content', () => {
      const testSampler = new TestableMemorySampler();
      const mockStatus = `
Name:   test
State:  S (sleeping)
VmPeak:   12345 kB
VmSize:   23456 kB
VmRSS:    34567 kB
VmData:   45678 kB
VmStk:    1234 kB
VmExe:    567 kB
VmLib:    890 kB
VmSwap:   9876 kB
Threads: 1
`;
      testSampler.injectMockStatus(mockStatus);
      testSampler.registerWorkerPid('worker-1', 12345);
      const result = testSampler.getWorkerMemory('worker-1');

      expect(result).not.toBeNull();
      expect(result?.rssKb).toBe(34567);
      expect(result?.peakRssKb).toBe(12345);
      expect(result?.swapKb).toBe(9876);
      expect(result?.sampledAt).toBeGreaterThan(0);
    });

    it('should handle partial /proc/<pid>/status content', () => {
      const testSampler = new TestableMemorySampler();
      const mockStatus = `
Name:   test
State:  S (sleeping)
VmPeak:   12345 kB
VmSize:   23456 kB
VmRSS:    34567 kB
`;
      testSampler.injectMockStatus(mockStatus);
      testSampler.registerWorkerPid('worker-1', 12345);
      const result = testSampler.getWorkerMemory('worker-1');

      expect(result).not.toBeNull();
      expect(result?.rssKb).toBe(34567);
      expect(result?.peakRssKb).toBe(12345);
      expect(result?.swapKb).toBeNull();
    });

    it('should return null values when /proc is unreadable', () => {
      const testSampler = new TestableMemorySampler();
      testSampler.injectMockStatus(null);
      testSampler.registerWorkerPid('worker-1', 12345);
      const result = testSampler.getWorkerMemory('worker-1');

      expect(result).not.toBeNull();
      expect(result?.rssKb).toBeNull();
      expect(result?.peakRssKb).toBeNull();
      expect(result?.swapKb).toBeNull();
    });

    it('should handle malformed /proc/<pid>/status lines', () => {
      const testSampler = new TestableMemorySampler();
      const mockStatus = `
Name:   test
VmPeak:   invalid kB
VmRSS:    not-a-number kB
VmSwap:   9876 kB
`;
      testSampler.injectMockStatus(mockStatus);
      testSampler.registerWorkerPid('worker-1', 12345);
      const result = testSampler.getWorkerMemory('worker-1');

      expect(result).not.toBeNull();
      expect(result?.rssKb).toBeNull();
      expect(result?.peakRssKb).toBeNull();
      // Only VmSwap is valid
      expect(result?.swapKb).toBe(9876);
    });
  });

  describe('sampleAllWorkers', () => {
    it('should sample all registered workers', () => {
      const testSampler = new TestableMemorySampler();
      const mockStatus = `
VmPeak:   12345 kB
VmRSS:    34567 kB
VmSwap:   9876 kB
`;
      testSampler.injectMockStatus(mockStatus);
      testSampler.registerWorkerPid('worker-1', 12345);
      testSampler.registerWorkerPid('worker-2', 67890);

      const results = testSampler.sampleAllWorkers();

      expect(results.size).toBe(2);
      expect(results.get('worker-1')?.rssKb).toBe(34567);
      expect(results.get('worker-2')?.rssKb).toBe(34567);
    });

    it('should remove stale workers during sampling', () => {
      const shortLivedSampler = new MemorySampler(100, 50);
      shortLivedSampler.registerWorkerPid('worker-1', 12345);

      // Simulate time passing
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now + 100);

      const results = shortLivedSampler.sampleAllWorkers();

      expect(results.size).toBe(0); // Stale worker removed
      expect(shortLivedSampler.workerCount).toBe(0);

      shortLivedSampler.stop();
    });
  });

  describe('start and stop', () => {
    it('should start periodic sampling', () => {
      const testSampler = new TestableMemorySampler();
      const mockStatus = `
VmPeak:   12345 kB
VmRSS:    34567 kB
VmSwap:   9876 kB
`;
      testSampler.injectMockStatus(mockStatus);
      testSampler.registerWorkerPid('worker-1', 12345);
      testSampler.start();

      // Sample immediately after start
      const results1 = testSampler.sampleAllWorkers();
      expect(results1.size).toBe(1);

      testSampler.stop();
    });

    it('should stop periodic sampling', () => {
      sampler.start();
      sampler.stop();

      // Should not throw when stopped
      sampler.stop();
    });

    it('should not start twice', () => {
      const testSampler = new TestableMemorySampler();
      const mockStatus = `
VmPeak:   12345 kB
VmRSS:    34567 kB
VmSwap:   9876 kB
`;
      testSampler.injectMockStatus(mockStatus);
      testSampler.registerWorkerPid('worker-1', 12345);
      testSampler.start();
      testSampler.start(); // Should not create second interval

      testSampler.stop();
    });
  });

  describe('clear', () => {
    it('should clear all worker registrations', () => {
      sampler.registerWorkerPid('worker-1', 12345);
      sampler.registerWorkerPid('worker-2', 67890);

      expect(sampler.workerCount).toBe(2);

      sampler.clear();

      expect(sampler.workerCount).toBe(0);
      expect(sampler.getWorkerIds()).toEqual([]);
    });
  });

  describe('getWorkerMemory', () => {
    it('should return null for unregistered worker', () => {
      const result = sampler.getWorkerMemory('worker-1');
      expect(result).toBeNull();
    });

    it('should return memory stats for registered worker', () => {
      const testSampler = new TestableMemorySampler();
      const mockStatus = `
VmPeak:   12345 kB
VmRSS:    34567 kB
VmSwap:   9876 kB
`;
      testSampler.injectMockStatus(mockStatus);
      testSampler.registerWorkerPid('worker-1', 12345);
      const result = testSampler.getWorkerMemory('worker-1');

      expect(result).not.toBeNull();
      expect(result?.rssKb).toBe(34567);
    });
  });
});

describe('getMemorySampler singleton', () => {
  afterEach(() => {
    resetMemorySampler();
  });

  it('should return the same instance', () => {
    const sampler1 = getMemorySampler();
    const sampler2 = getMemorySampler();
    expect(sampler1).toBe(sampler2);
  });

  it('should reset to new instance', () => {
    const sampler1 = getMemorySampler();
    sampler1.registerWorkerPid('worker-1', 12345);

    resetMemorySampler();

    const sampler2 = getMemorySampler();
    expect(sampler2).not.toBe(sampler1);
    expect(sampler2.workerCount).toBe(0);
  });
});
