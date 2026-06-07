/**
 * FABRIC Memory Sampler
 *
 * Polls /proc/<pid>/status for active worker processes to sample
 * VmRSS, VmPeak, and VmSwap memory metrics. Provides per-worker memory
 * statistics from the kernel's process accounting.
 *
 * Integration:
 * - Call registerWorkerPid(workerId, pid) when a new worker PID is detected
 * - Call start() to begin periodic sampling (every 10 seconds)
 * - Call getWorkerMemory(workerId) to get current memory stats
 */

import * as fs from 'fs';
import * as path from 'path';

/** Memory statistics for a worker process */
export interface WorkerMemoryStats {
  /** Current RSS in KB */
  rssKb: number;
  /** Peak RSS in KB */
  peakRssKb: number;
  /** Swap usage in KB */
  swapKb: number;
  /** Timestamp when sampled */
  sampledAt: number;
}

/** Internal worker PID tracking */
interface WorkerPidEntry {
  workerId: string;
  pid: number;
  lastSeen: number;
}

/** Sample result with optional null values for missing/unreadable data */
export interface WorkerMemorySample {
  rssKb: number | null;
  peakRssKb: number | null;
  swapKb: number | null;
  sampledAt: number;
}

/**
 * MemorySampler class
 *
 * Tracks worker PIDs and periodically samples /proc/<pid>/status
 * for memory statistics.
 */
export class MemorySampler {
  private workers: Map<string, WorkerPidEntry> = new Map();
  private sampleInterval: NodeJS.Timeout | null = null;
  private intervalMs: number;
  private readonly maxWorkerAgeMs: number;

  constructor(intervalMs: number = 10000, maxWorkerAgeMs: number = 3600000) {
    this.intervalMs = intervalMs;
    this.maxWorkerAgeMs = maxWorkerAgeMs;
  }

  /**
   * Register or update a worker's PID.
   * @param workerId Worker identifier
   * @param pid Process ID
   */
  registerWorkerPid(workerId: string, pid: number): void {
    this.workers.set(workerId, {
      workerId,
      pid,
      lastSeen: Date.now(),
    });
  }

  /**
   * Unregister a worker (e.g., when it exits).
   * @param workerId Worker identifier
   */
  unregisterWorker(workerId: string): void {
    this.workers.delete(workerId);
  }

  /**
   * Get current memory stats for a worker.
   * @param workerId Worker identifier
   * @returns Memory stats or null if not found
   */
  getWorkerMemory(workerId: string): WorkerMemorySample | null {
    const entry = this.workers.get(workerId);
    if (!entry) {
      return null;
    }

    return this.sampleProcStatus(entry.pid);
  }

  /**
   * Get all currently tracked worker IDs.
   */
  getWorkerIds(): string[] {
    return Array.from(this.workers.keys());
  }

  /**
   * Start periodic sampling.
   */
  start(): void {
    if (this.sampleInterval) {
      return; // Already running
    }

    this.sampleInterval = setInterval(() => {
      this.sampleAllWorkers();
    }, this.intervalMs);
  }

  /**
   * Stop periodic sampling.
   */
  stop(): void {
    if (this.sampleInterval) {
      clearInterval(this.sampleInterval);
      this.sampleInterval = null;
    }
  }

  /**
   * Sample all registered workers and clean up stale entries.
   */
  sampleAllWorkers(): Map<string, WorkerMemorySample> {
    const results = new Map<string, WorkerMemorySample>();
    const now = Date.now();
    const stale: string[] = [];

    for (const [workerId, entry] of this.workers) {
      // Check for stale entries (worker hasn't been seen in a while)
      if (now - entry.lastSeen > this.maxWorkerAgeMs) {
        stale.push(workerId);
        continue;
      }

      const sample = this.sampleProcStatus(entry.pid);
      results.set(workerId, sample);
    }

    // Clean up stale entries
    for (const workerId of stale) {
      this.workers.delete(workerId);
    }

    return results;
  }

  /**
   * Sample /proc/<pid>/status for a specific PID.
   * Protected for test override.
   * @param pid Process ID
   * @returns Memory sample with null values if unreadable
   */
  protected sampleProcStatus(pid: number): WorkerMemorySample {
    const statusPath = path.join('/proc', pid.toString(), 'status');

    try {
      const content = fs.readFileSync(statusPath, 'utf-8');
      return this.parseProcStatus(content);
    } catch {
      // Process may have exited or /proc not readable
      return {
        rssKb: null,
        peakRssKb: null,
        swapKb: null,
        sampledAt: Date.now(),
      };
    }
  }

  /**
   * Parse /proc/<pid>/status content to extract memory fields.
   * @param content File content
   * @returns Parsed memory sample
   */
  private parseProcStatus(content: string): WorkerMemorySample {
    let rssKb: number | null = null;
    let peakRssKb: number | null = null;
    let swapKb: number | null = null;

    const lines = content.split('\n');
    for (const line of lines) {
      if (line.startsWith('VmRSS:')) {
        rssKb = this.extractKbValue(line);
      } else if (line.startsWith('VmPeak:')) {
        peakRssKb = this.extractKbValue(line);
      } else if (line.startsWith('VmSwap:')) {
        swapKb = this.extractKbValue(line);
      }
    }

    return {
      rssKb,
      peakRssKb,
      swapKb,
      sampledAt: Date.now(),
    };
  }

  /**
   * Extract KB value from a /proc/<pid>/status line.
   * Expected format: "VmRSS: 12345 kB"
   * @param line Status line
   * @returns KB value or null if parse fails
   */
  private extractKbValue(line: string): number | null {
    try {
      // Format: "VmRSS: 12345 kB"
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        const value = parseInt(parts[1], 10);
        return isNaN(value) ? null : value;
      }
    } catch {
      // Parse failed
    }
    return null;
  }

  /**
   * Get the number of actively tracked workers.
   */
  get workerCount(): number {
    return this.workers.size;
  }

  /**
   * Clear all worker registrations.
   */
  clear(): void {
    this.workers.clear();
  }
}

/**
 * Global singleton instance
 */
let globalSampler: MemorySampler | undefined;

/**
 * Get or create the global MemorySampler instance.
 */
export function getMemorySampler(): MemorySampler {
  if (!globalSampler) {
    globalSampler = new MemorySampler();
  }
  return globalSampler;
}

/**
 * Reset the global sampler (mainly for testing).
 */
export function resetMemorySampler(): void {
  if (globalSampler) {
    globalSampler.stop();
    globalSampler.clear();
  }
  globalSampler = undefined;
}
