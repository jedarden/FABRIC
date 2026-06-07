/**
 * FABRIC Needle Worker Memory Limiter
 *
 * Applies per-worker memory limits by writing to cgroup memory.max.
 * Each needle worker is bounded at 4 GB RSS to prevent any single worker
 * from exhausting the cgroup's memory.
 *
 * Integration:
 * - Call applyWorkerMemoryLimit() when a new worker log file is detected
 * - Call applyAllWorkerLimits() at startup to limit existing workers
 */

import * as fs from 'fs';
import * as path from 'path';

/** Default memory limit per worker (4 GB) */
export const DEFAULT_MEMORY_LIMIT_BYTES = 4 * 1024 * 1024 * 1024;

/** Cache of worker IDs we've already applied limits to (avoid repeated work). */
const limitedWorkers = new Set<string>();

/**
 * Extract worker ID from log file name.
 * Expected format: <agent>-<identifier>-<random>.jsonl
 * Returns the full worker ID (agent-identifier) for matching against needle state.
 */
function extractWorkerId(logFileName: string): string | null {
  // Remove .jsonl extension
  const baseName = logFileName.replace(/\.jsonl$/, '');

  // Needle log files are named: <agent>-<identifier>-<random>
  // We need to return the full worker ID format: <agent>-<identifier>
  // The random suffix is 8 hex chars, so we can detect and strip it
  const randomSuffixMatch = baseName.match(/-[a-f0-9]{8}$/);
  if (randomSuffixMatch) {
    return baseName.slice(0, randomSuffixMatch.index);
  }

  // Fallback: remove "needle-" prefix if present
  if (baseName.startsWith('needle-')) {
    return baseName.slice(7);
  }

  return baseName;
}

/**
 * Extract the identifier part from a worker ID.
 * Worker ID format: <agent>-<identifier> (e.g., claude-code-glm-4.7-alpha)
 * Returns just the identifier (e.g., "alpha").
 */
function extractIdentifier(workerId: string): string {
  // The identifier is the last component after the last hyphen
  const parts = workerId.split('-');
  return parts[parts.length - 1];
}

/**
 * Find the process ID for a needle worker by worker ID.
 * Searches for processes matching the needle worker pattern.
 */
function findNeedleWorkerPid(workerId: string): number | null {
  try {
    // Read /proc to find needle processes
    const procDir = '/proc';
    const entries = fs.readdirSync(procDir);

    // Extract just the identifier (last part of worker ID)
    // e.g., "claude-code-glm-4.7-alpha" -> "alpha"
    const identifier = extractIdentifier(workerId);

    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;

      const pid = parseInt(entry, 10);
      const cmdlinePath = path.join(procDir, entry, 'cmdline');

      try {
        const cmdline = fs.readFileSync(cmdlinePath, 'utf-8');
        // Check if this is a needle run process for our worker
        // Match: "needle run ... --identifier <value>"
        if (cmdline.includes('needle run')) {
          // Extract the identifier value from cmdline
          const identMatch = cmdline.match(/--identifier\s+(\S+)/);
          if (identMatch && identMatch[1] === identifier) {
            return pid;
          }
        }
      } catch {
        // Process may have exited
        continue;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get the cgroup path for a process.
 * Returns the cgroup v2 path (e.g., /user.slice/user-1001.slice/session-X.scope)
 */
function getProcessCgroupPath(pid: number): string | null {
  try {
    const cgroupPath = path.join('/proc', pid.toString(), 'cgroup');
    const cgroupContent = fs.readFileSync(cgroupPath, 'utf-8');

    // Parse cgroup v2 format (line starting with "0::")
    const lines = cgroupContent.split('\n');
    for (const line of lines) {
      if (line.startsWith('0::')) {
        const cgroupPath = line.slice(4); // Remove "0::"
        return `/sys/fs/cgroup${cgroupPath}`;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Apply memory limit to a cgroup by writing to memory.max.
 */
function applyMemoryLimitToCgroup(cgroupPath: string, limitBytes: number): boolean {
  try {
    const memoryMaxPath = path.join(cgroupPath, 'memory.max');

    // Check if file exists and is writable
    if (!fs.existsSync(memoryMaxPath)) {
      return false;
    }

    // Write the memory limit
    fs.writeFileSync(memoryMaxPath, limitBytes.toString(), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply memory limit to a needle worker.
 * Returns true if the limit was applied successfully.
 */
export function applyWorkerMemoryLimit(
  workerId: string,
  limitBytes: number = DEFAULT_MEMORY_LIMIT_BYTES
): boolean {
  // Skip if we've already limited this worker
  if (limitedWorkers.has(workerId)) {
    return true;
  }

  try {
    // Find the worker's PID
    const pid = findNeedleWorkerPid(workerId);
    if (!pid) {
      return false;
    }

    // Get the cgroup path
    const cgroupPath = getProcessCgroupPath(pid);
    if (!cgroupPath) {
      return false;
    }

    // Apply the memory limit
    const success = applyMemoryLimitToCgroup(cgroupPath, limitBytes);

    if (success) {
      limitedWorkers.add(workerId);
    }

    return success;
  } catch {
    return false;
  }
}

/**
 * Apply memory limit by log file name.
 * Convenience function for DirectoryTailer integration.
 */
export function applyLimitForLogFile(logFileName: string): boolean {
  const workerId = extractWorkerId(logFileName);
  if (!workerId) {
    return false;
  }

  return applyWorkerMemoryLimit(workerId);
}

/**
 * Apply memory limits to all currently running needle workers.
 * Scan the needle state file to find active workers.
 */
export function applyAllWorkerLimits(
  limitBytes: number = DEFAULT_MEMORY_LIMIT_BYTES
): number {
  let appliedCount = 0;

  try {
    // Read needle state file
    const needleStateDir = path.join(process.env.HOME || '', '.needle', 'state');
    const stateFiles = fs.readdirSync(needleStateDir).filter(f => f.endsWith('.json'));

    for (const stateFile of stateFiles) {
      try {
        const statePath = path.join(needleStateDir, stateFile);
        const stateContent = fs.readFileSync(statePath, 'utf-8');
        const state = JSON.parse(stateContent);

        // Apply limits to each worker
        for (const worker of state.workers || []) {
          // If we have the PID directly from state, use it
          if (worker.pid) {
            if (applyMemoryLimitToPid(worker.pid, limitBytes)) {
              limitedWorkers.add(worker.id);
              appliedCount++;
            }
          } else if (worker.id && applyWorkerMemoryLimit(worker.id, limitBytes)) {
            appliedCount++;
          }
        }
      } catch {
        // Skip invalid state files
        continue;
      }
    }
  } catch {
    // Needle state directory not accessible
  }

  return appliedCount;
}

/**
 * Apply memory limit directly to a process by PID.
 * Returns true if the limit was applied successfully.
 */
function applyMemoryLimitToPid(pid: number, limitBytes: number): boolean {
  try {
    const cgroupPath = getProcessCgroupPath(pid);
    if (!cgroupPath) {
      return false;
    }

    return applyMemoryLimitToCgroup(cgroupPath, limitBytes);
  } catch {
    return false;
  }
}

/**
 * Clear the cache of limited workers.
 * Useful if workers have been restarted and you want to re-apply limits.
 */
export function clearLimitedWorkerCache(): void {
  limitedWorkers.clear();
}

/**
 * Get the current memory limit for a worker's cgroup.
 * Returns the limit in bytes, or null if not found.
 */
export function getWorkerMemoryLimit(workerId: string): number | null {
  try {
    const pid = findNeedleWorkerPid(workerId);
    if (!pid) {
      return null;
    }

    const cgroupPath = getProcessCgroupPath(pid);
    if (!cgroupPath) {
      return null;
    }

    const memoryMaxPath = path.join(cgroupPath, 'memory.max');
    if (!fs.existsSync(memoryMaxPath)) {
      return null;
    }

    const content = fs.readFileSync(memoryMaxPath, 'utf-8').trim();

    // Parse the value (may be "max" for unlimited)
    if (content === 'max') {
      return null;
    }

    return parseInt(content, 10);
  } catch {
    return null;
  }
}

/**
 * Get the current memory usage for a worker's cgroup.
 * Returns the usage in bytes, or null if not found.
 */
export function getWorkerMemoryUsage(workerId: string): number | null {
  try {
    const pid = findNeedleWorkerPid(workerId);
    if (!pid) {
      return null;
    }

    const cgroupPath = getProcessCgroupPath(pid);
    if (!cgroupPath) {
      return null;
    }

    const memoryCurrentPath = path.join(cgroupPath, 'memory.current');
    if (!fs.existsSync(memoryCurrentPath)) {
      return null;
    }

    const content = fs.readFileSync(memoryCurrentPath, 'utf-8').trim();
    return parseInt(content, 10);
  } catch {
    return null;
  }
}
