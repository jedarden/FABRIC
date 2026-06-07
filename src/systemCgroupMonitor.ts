/**
 * System Cgroup Memory Monitor
 *
 * Reads cgroup memory statistics from /sys/fs/cgroup/user.slice/user-1001.slice/
 * and provides history tracking for sparkline visualization.
 */

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Cgroup v2 memory controller path for user-1001 (uid 1001 is the 'coding' user)
const CGROUP_PATH = '/sys/fs/cgroup/user.slice/user-1001.slice';

// Maximum number of samples to keep (5 minutes @ 10s intervals = 30 samples)
const MAX_HISTORY_SAMPLES = 30;

export interface MemoryHistorySample {
  timestamp: number;
  usage: number | null;
  usagePercent: number | null;
  swapUsage: number | null;
}

export interface SystemMemoryStatus {
  totalMemory: number | null;
  availableMemory: number | null;
  cgroupLimit: number | null;
  cgroupUsage: number | null;
  cgroupHigh: number | null;
  cgroupSwapUsage: number | null;
  swapTotal: number | null;
  swapFree: number | null;
  fabricRss: number;
  cgroupUsagePercent: number | null;
  underPressure: boolean;
  oomRisk: 'none' | 'low' | 'medium' | 'high' | 'critical';
  oomKill: number;
  oom: number;
}

// In-memory history store
const memoryHistory: MemoryHistorySample[] = [];

/**
 * Read a file and return its trimmed content, or null if file doesn't exist.
 */
function readCgroupFile(filename: string): string | null {
  const filepath = join(CGROUP_PATH, filename);
  try {
    if (existsSync(filepath)) {
      const content = readFileSync(filepath, 'utf-8');
      return content.trim();
    }
  } catch (err) {
    // File doesn't exist or isn't readable
    return null;
  }
  return null;
}

/**
 * Parse memory.events file to get oom_kill count.
 * Format: "oom_kill 123" or "oom_kill 0"
 */
function parseOomKill(content: string | null): number {
  if (!content) return 0;
  const match = content.match(/oom_kill\s+(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Parse memory.stat file to get specific stats.
 */
function parseMemoryStat(content: string | null): Record<string, number> {
  if (!content) return {};
  const stats: Record<string, number> = {};
  for (const line of content.split('\n')) {
    const [key, value] = line.split(/\s+/);
    if (key && value) {
      stats[key] = parseInt(value, 10);
    }
  }
  return stats;
}

/**
 * Format bytes to human readable string.
 */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return 'N/A';
  if (bytes < 0) return 'N/A';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

/**
 * Get current cgroup memory status.
 */
export function getSystemMemoryStatus(): SystemMemoryStatus {
  // Read cgroup memory.current (in bytes)
  const memoryCurrentStr = readCgroupFile('memory.current');
  const cgroupUsage = memoryCurrentStr ? parseInt(memoryCurrentStr, 10) : null;

  // Read cgroup memory.max (limit, in bytes; "max" means unlimited)
  const memoryMaxStr = readCgroupFile('memory.max');
  let cgroupLimit = null;
  if (memoryMaxStr && memoryMaxStr !== 'max') {
    cgroupLimit = parseInt(memoryMaxStr, 10);
  }

  // Read cgroup memory.high (soft limit, in bytes; "max" means not set)
  const memoryHighStr = readCgroupFile('memory.high');
  let cgroupHigh = null;
  if (memoryHighStr && memoryHighStr !== 'max') {
    cgroupHigh = parseInt(memoryHighStr, 10);
  }

  // Read cgroup memory.swap.current (swap usage, in bytes)
  const swapCurrentStr = readCgroupFile('memory.swap.current');
  const cgroupSwapUsage = swapCurrentStr ? parseInt(swapCurrentStr, 10) : null;

  // Read memory.events for oom_kill count
  const memoryEvents = readCgroupFile('memory.events');
  const oomKill = parseOomKill(memoryEvents);

  // Read memory.stat for additional stats
  const memoryStatContent = readCgroupFile('memory.stat');
  const memoryStat = parseMemoryStat(memoryStatContent);

  // Get system memory info from /proc/meminfo
  let totalMemory = null;
  let availableMemory = null;
  let swapTotal = null;
  let swapFree = null;
  try {
    const meminfo = readFileSync('/proc/meminfo', 'utf-8');
    const meminfoMap: Record<string, number> = {};
    for (const line of meminfo.split('\n')) {
      const match = line.match(/^(\w+):\s+(\d+)\s+kB$/);
      if (match) {
        meminfoMap[match[1]] = parseInt(match[2], 10) * 1024; // Convert kB to bytes
      }
    }
    totalMemory = meminfoMap['MemTotal'] || null;
    // Use MemAvailable if present (kernel 3.14+), otherwise estimate
    if (meminfoMap['MemAvailable']) {
      availableMemory = meminfoMap['MemAvailable'];
    } else if (meminfoMap['MemFree'] && memoryStat) {
      // Rough estimate: MemFree + active_file + inactive_file
      availableMemory = meminfoMap['MemFree'] + (memoryStat['active_file'] || 0) + (memoryStat['inactive_file'] || 0);
    }
    swapTotal = meminfoMap['SwapTotal'] || null;
    swapFree = meminfoMap['SwapFree'] || null;
  } catch (err) {
    // /proc/meminfo not available
  }

  // Get FABRIC process RSS from /proc/self/status
  let fabricRss = 0;
  try {
    const status = readFileSync('/proc/self/status', 'utf-8');
    const match = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
    if (match) {
      fabricRss = parseInt(match[1], 10) * 1024; // Convert kB to bytes
    }
  } catch (err) {
    // /proc/self/status not available
  }

  // Calculate usage percentage
  let cgroupUsagePercent = null;
  if (cgroupUsage !== null && cgroupLimit !== null && cgroupLimit > 0) {
    cgroupUsagePercent = (cgroupUsage / cgroupLimit) * 100;
  }

  // Check if under memory pressure
  // memory.pressure shows pressure in stall time (cgroup v2)
  // For simplicity, we'll infer pressure from usage percentage
  const underPressure = cgroupUsagePercent !== null && cgroupUsagePercent > 90;

  // Determine OOM risk level
  let oomRisk: 'none' | 'low' | 'medium' | 'high' | 'critical' = 'none';
  if (cgroupUsagePercent !== null) {
    if (cgroupUsagePercent >= 98) {
      oomRisk = 'critical';
    } else if (cgroupUsagePercent >= 95) {
      oomRisk = 'high';
    } else if (cgroupUsagePercent >= 90) {
      oomRisk = 'medium';
    } else if (cgroupUsagePercent >= 80) {
      oomRisk = 'low';
    }
  }

  // Add current sample to history
  const now = Date.now();
  if (cgroupUsage !== null) {
    memoryHistory.push({
      timestamp: now,
      usage: cgroupUsage,
      usagePercent: cgroupUsagePercent,
      swapUsage: cgroupSwapUsage,
    });

    // Keep only the last MAX_HISTORY_SAMPLES
    while (memoryHistory.length > MAX_HISTORY_SAMPLES) {
      memoryHistory.shift();
    }
  }

  return {
    totalMemory,
    availableMemory,
    cgroupLimit,
    cgroupUsage,
    cgroupHigh,
    cgroupSwapUsage,
    swapTotal,
    swapFree,
    fabricRss,
    cgroupUsagePercent,
    underPressure,
    oomRisk,
    oomKill,
    oom: oomKill, // Alias for compatibility
  };
}

/**
 * Get memory history for sparkline.
 */
export function getMemoryHistory(): MemoryHistorySample[] {
  return [...memoryHistory]; // Return a copy
}

/**
 * Get a human-readable memory summary string.
 */
export function getMemorySummary(): string {
  const status = getSystemMemoryStatus();
  return formatBytes(status.cgroupUsage) + ' / ' + formatBytes(status.cgroupLimit);
}

/**
 * Start the background memory sampler.
 * This should be called once when the server starts.
 */
let samplerInterval: ReturnType<typeof setInterval> | null = null;

export function startMemorySampler(intervalMs: number = 10000): void {
  if (samplerInterval !== null) {
    return; // Already running
  }

  // Take an initial sample
  getSystemMemoryStatus();

  // Then sample at the requested interval
  samplerInterval = setInterval(() => {
    getSystemMemoryStatus();
  }, intervalMs);
}

/**
 * Stop the background memory sampler.
 */
export function stopMemorySampler(): void {
  if (samplerInterval !== null) {
    clearInterval(samplerInterval);
    samplerInterval = null;
  }
}
