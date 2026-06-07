/**
 * FABRIC System Cgroup Monitor
 *
 * Monitors system-level cgroup memory usage and provides OOM detection.
 * Reads from user.slice cgroup to track overall memory pressure.
 */

import * as fs from 'fs';
import * as path from 'path';

/** System cgroup path (user.slice) */
const SYSTEM_CGROUP_PATH = '/sys/fs/cgroup/user.slice';

/** Fallback to user-1001.slice if user.slice doesn't exist */
const FALLBACK_CGROUP_PATH = '/sys/fs/cgroup/user.slice/user-1001.slice';

/**
 * Read a cgroup memory control file and return its value in bytes.
 * Returns null if the file doesn't exist or cannot be read.
 */
function readCgroupMemoryValue(cgroupPath: string, filename: string): number | null {
  try {
    const filePath = path.join(cgroupPath, filename);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8').trim();
    if (content === 'max') {
      return null; // Unlimited
    }
    return parseInt(content, 10);
  } catch {
    return null;
  }
}

/**
 * Get the system memory limit from the cgroup.
 */
export function getSystemMemoryLimit(): number | null {
  // Try user.slice first, then fallback to user-1001.slice
  let value = readCgroupMemoryValue(SYSTEM_CGROUP_PATH, 'memory.max');
  if (value === null) {
    value = readCgroupMemoryValue(FALLBACK_CGROUP_PATH, 'memory.max');
  }
  return value;
}

/**
 * Get the current memory usage from the cgroup.
 */
export function getSystemMemoryUsage(): number | null {
  // Try user.slice first, then fallback to user-1001.slice
  let value = readCgroupMemoryValue(SYSTEM_CGROUP_PATH, 'memory.current');
  if (value === null) {
    value = readCgroupMemoryValue(FALLBACK_CGROUP_PATH, 'memory.current');
  }
  return value;
}

/**
 * Get the MemoryHigh threshold from the cgroup.
 * This is the soft limit that triggers notifications.
 */
export function getSystemMemoryHigh(): number | null {
  // Try user.slice first, then fallback to user-1001.slice
  let value = readCgroupMemoryValue(SYSTEM_CGROUP_PATH, 'memory.high');
  if (value === null) {
    value = readCgroupMemoryValue(FALLBACK_CGROUP_PATH, 'memory.high');
  }
  // memory.high returns "max" for unlimited, which parseInt handles as NaN
  return value;
}

/**
 * Get swap usage from the cgroup.
 */
export function getSystemSwapUsage(): number | null {
  // Try user.slice first, then fallback to user-1001.slice
  let value = readCgroupMemoryValue(SYSTEM_CGROUP_PATH, 'memory.swap.current');
  if (value === null) {
    value = readCgroupMemoryValue(FALLBACK_CGROUP_PATH, 'memory.swap.current');
  }
  return value;
}

/**
 * Get total system memory from /proc/meminfo.
 */
export function getTotalSystemMemory(): number | null {
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf-8');
    const match = meminfo.match(/MemTotal:\s+(\d+)\s+kB/);
    if (match) {
      return parseInt(match[1], 10) * 1024; // Convert kB to bytes
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get available system memory from /proc/meminfo.
 */
export function getAvailableSystemMemory(): number | null {
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf-8');
    const match = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/);
    if (match) {
      return parseInt(match[1], 10) * 1024; // Convert kB to bytes
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get swap total and free from /proc/meminfo.
 */
export function getSwapInfo(): { total: number | null; free: number | null } | null {
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf-8');
    const swapTotalMatch = meminfo.match(/SwapTotal:\s+(\d+)\s+kB/);
    const swapFreeMatch = meminfo.match(/SwapFree:\s+(\d+)\s+kB/);
    return {
      total: swapTotalMatch ? parseInt(swapTotalMatch[1], 10) * 1024 : null,
      free: swapFreeMatch ? parseInt(swapFreeMatch[1], 10) * 1024 : null,
    };
  } catch {
    return null;
  }
}

/**
 * Get FABRIC process RSS from Node.js.
 */
export function getFabricRss(): number {
  return process.memoryUsage().rss;
}

/**
 * System memory status interface.
 */
export interface SystemMemoryStatus {
  /** Total system memory (bytes) */
  totalMemory: number | null;
  /** Available system memory (bytes) */
  availableMemory: number | null;
  /** Cgroup memory limit (bytes) */
  cgroupLimit: number | null;
  /** Cgroup memory usage (bytes) */
  cgroupUsage: number | null;
  /** Cgroup MemoryHigh threshold (bytes) */
  cgroupHigh: number | null;
  /** Cgroup swap usage (bytes) */
  cgroupSwapUsage: number | null;
  /** System swap total (bytes) */
  swapTotal: number | null;
  /** System swap free (bytes) */
  swapFree: number | null;
  /** FABRIC process RSS (bytes) */
  fabricRss: number;
  /** Usage percentage of cgroup limit */
  cgroupUsagePercent: number | null;
  /** Whether system is under memory pressure */
  underPressure: boolean;
  /** OOM risk level */
  oomRisk: 'none' | 'low' | 'medium' | 'high' | 'critical';
}

/**
 * Get complete system memory status.
 */
export function getSystemMemoryStatus(): SystemMemoryStatus {
  const totalMemory = getTotalSystemMemory();
  const availableMemory = getAvailableSystemMemory();
  const cgroupLimit = getSystemMemoryLimit();
  const cgroupUsage = getSystemMemoryUsage();
  const cgroupHigh = getSystemMemoryHigh();
  const cgroupSwapUsage = getSystemSwapUsage();
  const swapInfo = getSwapInfo();
  const fabricRss = getFabricRss();

  // Calculate cgroup usage percentage
  let cgroupUsagePercent: number | null = null;
  if (cgroupUsage !== null && cgroupLimit !== null && cgroupLimit > 0) {
    cgroupUsagePercent = (cgroupUsage / cgroupLimit) * 100;
  }

  // Determine if under memory pressure
  // Pressure = usage > MemoryHigh threshold or cgroup usage > 90% of limit
  let underPressure = false;
  if (cgroupHigh !== null && cgroupUsage !== null) {
    underPressure = cgroupUsage > cgroupHigh;
  } else if (cgroupUsagePercent !== null) {
    underPressure = cgroupUsagePercent > 90;
  }

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
  // Also consider swap pressure
  if (swapInfo && swapInfo.total !== null && swapInfo.total > 0) {
    const swapPercent = ((swapInfo.total - (swapInfo.free ?? 0)) / swapInfo.total) * 100;
    if (swapPercent >= 90 && oomRisk === 'none') {
      oomRisk = 'medium';
    } else if (swapPercent >= 95 && (oomRisk === 'none' || oomRisk === 'low' || oomRisk === 'medium')) {
      oomRisk = 'high';
    }
  }

  return {
    totalMemory,
    availableMemory,
    cgroupLimit,
    cgroupUsage,
    cgroupHigh,
    cgroupSwapUsage,
    swapTotal: swapInfo?.total ?? null,
    swapFree: swapInfo?.free ?? null,
    fabricRss,
    cgroupUsagePercent,
    underPressure,
    oomRisk,
  };
}

/**
 * Format bytes to human-readable string.
 */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'N/A';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

/**
 * Get a human-readable summary of system memory status.
 */
export function getMemorySummary(): string {
  const status = getSystemMemoryStatus();
  const parts: string[] = [];

  parts.push(`Cgroup: ${formatBytes(status.cgroupUsage)} / ${formatBytes(status.cgroupLimit)}`);
  if (status.cgroupUsagePercent !== null) {
    parts.push(`(${status.cgroupUsagePercent.toFixed(1)}%)`);
  }
  if (status.cgroupSwapUsage !== null) {
    parts.push(`Swap: ${formatBytes(status.cgroupSwapUsage)}`);
  }
  parts.push(`FABRIC: ${formatBytes(status.fabricRss)}`);

  if (status.oomRisk !== 'none') {
    parts.push(`OOM Risk: ${status.oomRisk.toUpperCase()}`);
  }

  return parts.join(' · ');
}
