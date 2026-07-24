/**
 * FABRIC Log Pruner
 *
 * Retention policy for ~/.needle/logs/ — archives old files into
 * dated tarballs and deletes expired archives. Emits mend.logs_pruned
 * events visible to FABRIC's directory tailer.
 *
 * Policy:
 *   1. Files older than archiveAfterDays → archived into ~/.needle/logs/archive/YYYY-MM-DD.tar.gz
 *   2. Original files deleted after successful archive
 *   3. Archive tarballs older than archiveRetentionDays → deleted
 *   4. Safety net: files older than maxAgeDays deleted directly (even if not archived)
 *
 * The pruner skips the archive/ directory and fabric-mend events file.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

export interface RetentionState {
  fileCount: number;
  totalSizeBytes: number;
  oldestFileAgeDays: number;
  archiveCount: number;
  archiveSizeBytes: number;
  policy: {
    archiveAfterDays: number;
    maxAgeDays: number;
    archiveRetentionDays: number;
  };
}

export interface PruneOptions {
  /** Directory to prune (default: ~/.needle/logs) */
  logDir: string;

  /** Archive files older than this many days (default: 3) */
  archiveAfterDays: number;

  /** Delete archive tarballs older than this many days (default: 30) */
  archiveRetentionDays: number;

  /** Hard maximum age — files older than this are deleted even if not archived (default: 7) */
  maxAgeDays: number;

  /** Dry run — report what would happen without making changes */
  dryRun: boolean;

  /** File patterns to skip (matched against basename) */
  skipPatterns: string[];
}

export interface PruneResult {
  filesScanned: number;
  filesArchived: number;
  filesDeleted: number;
  archivesCreated: number;
  archivesDeleted: number;
  bytesFreed: number;
  fileCountBefore: number;
  fileCountAfter: number;
  archivesBefore: number;
  archivesAfter: number;
  durationMs: number;
  retentionState: RetentionState;
}

export interface FileGroup {
  date: string; // YYYY-MM-DD
  files: string[];
  totalSize: number;
}

const SKIP_NAMES = new Set(['archive', 'fabric-mend.jsonl']);

/** Find the absolute path to the tar binary.
 * Checks PATH entries first, then falls back to common absolute paths.
 * Throws an error if tar cannot be found in any location.
 */
export function resolveTarPath(): string {
  // Common absolute paths where tar might live (in order of preference)
  const COMMON_PATHS = [
    '/run/current-system/sw/bin/tar',  // NixOS/Nix
    '/usr/bin/tar',
    '/bin/tar',
    '/usr/local/bin/tar',
  ];

  // First check PATH if it exists
  const pathEnv = process.env.PATH;
  if (pathEnv) {
    const pathEntries = pathEnv.split(path.delimiter);
    for (const entry of pathEntries) {
      const tarPath = path.join(entry, 'tar');
      if (fs.existsSync(tarPath)) {
        return tarPath;
      }
    }
  }

  // Fall back to common absolute paths
  for (const tarPath of COMMON_PATHS) {
    if (fs.existsSync(tarPath)) {
      return tarPath;
    }
  }

  // If we get here, tar is nowhere to be found
  throw new Error(
    `tar binary not found. Searched PATH: ${pathEnv || '(none)'} and common paths: ${COMMON_PATHS.join(', ')}. ` +
    `Ensure tar is installed and accessible.`
  );
}

function defaultLogDir(): string {
  const home = process.env.HOME || '';
  return path.join(home, '.needle', 'logs');
}

function daysAgo(days: number): number {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

/** Group file paths by their mtime date (YYYY-MM-DD). */
function groupByDate(files: string[], cutoffMs: number): Map<string, FileGroup> {
  const groups = new Map<string, FileGroup>();
  for (const f of files) {
    const stat = fs.statSync(f);
    if (stat.mtimeMs >= cutoffMs) continue;
    const d = stat.mtime.toISOString().slice(0, 10);
    let group = groups.get(d);
    if (!group) {
      group = { date: d, files: [], totalSize: 0 };
      groups.set(d, group);
    }
    group.files.push(f);
    group.totalSize += stat.size;
  }
  return groups;
}

/** Create archive directory if it doesn't exist, return its path. */
function ensureArchiveDir(logDir: string): string {
  const archiveDir = path.join(logDir, 'archive');
  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }
  return archiveDir;
}

/** Create a tar.gz archive from a list of files. Returns the archive path.
 * If archive exists, extracts it, adds new files, and recreates the tarball.
 */
function createTarball(archiveDir: string, date: string, files: string[], dryRun: boolean): string {
  const tarballPath = path.join(archiveDir, `${date}.tar.gz`);
  const extractDir = path.join(archiveDir, `.tmp-${date}`);
  const logDir = path.dirname(files[0]);
  const tarPath = resolveTarPath();

  if (!dryRun) {
    fs.mkdirSync(extractDir, { recursive: true });

    // Extract existing archive if present
    if (fs.existsSync(tarballPath)) {
      try {
        execFileSync(tarPath, ['-xzf', tarballPath, '-C', extractDir], { timeout: 60000 });
      } catch {
        // If extraction fails, archive might be corrupted - start fresh
      }
    }

    // Copy new files into extract dir (preserving relative paths from logDir)
    for (const f of files) {
      const destName = path.basename(f);
      const destPath = path.join(extractDir, destName);
      // Don't fail if file already exists in archive (same file from same date)
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(f, destPath);
      }
    }

    // Create new tarball from merged content
    // Use '.' to archive entire directory (avoids ARG_MAX limit with many files)
    execFileSync(tarPath, ['-czf', tarballPath, '.'], {
      cwd: extractDir,
      timeout: 60000,
    });

    // Clean up extract dir
    fs.rmSync(extractDir, { recursive: true, force: true });
  }

  return tarballPath;
}

/** Compute current retention state for a log directory. */
export function computeRetentionState(logDir: string, policy: RetentionState['policy']): RetentionState {
  const archiveDir = path.join(logDir, 'archive');
  let fileCount = 0;
  let totalSizeBytes = 0;
  let oldestMtimeMs = Infinity;

  if (fs.existsSync(logDir)) {
    for (const entry of fs.readdirSync(logDir)) {
      if (SKIP_NAMES.has(entry)) continue;
      const full = path.join(logDir, entry);
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile()) continue;
        fileCount++;
        totalSizeBytes += stat.size;
        if (stat.mtimeMs < oldestMtimeMs) oldestMtimeMs = stat.mtimeMs;
      } catch { /* skip */ }
    }
  }

  let archiveCount = 0;
  let archiveSizeBytes = 0;
  if (fs.existsSync(archiveDir)) {
    for (const entry of fs.readdirSync(archiveDir)) {
      if (!entry.endsWith('.tar.gz')) continue;
      try {
        const stat = fs.statSync(path.join(archiveDir, entry));
        archiveCount++;
        archiveSizeBytes += stat.size;
      } catch { /* skip */ }
    }
  }

  const oldestFileAgeDays = oldestMtimeMs === Infinity
    ? 0
    : (Date.now() - oldestMtimeMs) / (24 * 60 * 60 * 1000);

  return { fileCount, totalSizeBytes, oldestFileAgeDays, archiveCount, archiveSizeBytes, policy };
}

/** Emit a mend.logs_pruned event to the fabric-mend events file. */
function emitMendEvent(logDir: string, result: PruneResult, dryRun: boolean): void {
  const eventPath = path.join(logDir, 'fabric-mend.jsonl');
  const event = {
    timestamp: new Date().toISOString(),
    event_type: 'mend.logs_pruned',
    worker_id: 'fabric-prune',
    session_id: `prune-${Date.now().toString(36)}`,
    sequence: 0,
    schema_version: 1,
    data: {
      files_scanned: result.filesScanned,
      files_archived: result.filesArchived,
      files_deleted: result.filesDeleted,
      archives_created: result.archivesCreated,
      archives_deleted: result.archivesDeleted,
      bytes_freed: result.bytesFreed,
      file_count_before: result.fileCountBefore,
      file_count_after: result.fileCountAfter,
      dry_run: dryRun,
      retention_state: {
        file_count: result.retentionState.fileCount,
        total_size_bytes: result.retentionState.totalSizeBytes,
        oldest_file_age_days: Math.round(result.retentionState.oldestFileAgeDays * 10) / 10,
        archive_count: result.retentionState.archiveCount,
        archive_size_bytes: result.retentionState.archiveSizeBytes,
        policy: {
          archive_after_days: result.retentionState.policy.archiveAfterDays,
          max_age_days: result.retentionState.policy.maxAgeDays,
          archive_retention_days: result.retentionState.policy.archiveRetentionDays,
        },
      },
    },
  };

  if (!dryRun) {
    fs.appendFileSync(eventPath, JSON.stringify(event) + '\n');
  }
}

/** Format bytes as human-readable string. */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

/**
 * Run the log pruning policy.
 *
 * @returns PruneResult with statistics about what was done
 */
export function pruneLogs(options: Partial<PruneOptions> = {}): PruneResult {
  const startMs = Date.now();
  const logDir = options.logDir || defaultLogDir();
  const archiveAfterDays = options.archiveAfterDays ?? 3;
  const archiveRetentionDays = options.archiveRetentionDays ?? 30;
  const maxAgeDays = options.maxAgeDays ?? 7;
  const dryRun = options.dryRun ?? false;
  const skipPatterns = options.skipPatterns ?? [];
  const skipRegexes = skipPatterns.map(p => new RegExp(p));
  const policy = { archiveAfterDays, maxAgeDays, archiveRetentionDays };

  if (!fs.existsSync(logDir)) {
    return {
      filesScanned: 0, filesArchived: 0, filesDeleted: 0,
      archivesCreated: 0, archivesDeleted: 0, bytesFreed: 0,
      fileCountBefore: 0, fileCountAfter: 0,
      archivesBefore: 0, archivesAfter: 0, durationMs: Date.now() - startMs,
      retentionState: { fileCount: 0, totalSizeBytes: 0, oldestFileAgeDays: 0, archiveCount: 0, archiveSizeBytes: 0, policy },
    };
  }

  // Phase 0: Count current state
  const allEntries = fs.readdirSync(logDir);
  const logFiles = allEntries.filter(e => {
    if (SKIP_NAMES.has(e)) return false;
    if (skipRegexes.some(r => r.test(e))) return false;
    const full = path.join(logDir, e);
    try { return fs.statSync(full).isFile(); } catch { return false; }
  });
  const fileCountBefore = logFiles.length;

  const archiveDir = ensureArchiveDir(logDir);
  const existingArchives = fs.readdirSync(archiveDir).filter(e => e.endsWith('.tar.gz'));
  const archivesBefore = existingArchives.length;

  let filesArchived = 0;
  let filesDeleted = 0;
  let archivesCreated = 0;
  let archivesDeleted = 0;
  let bytesFreed = 0;

  // Phase 1: Archive old files (older than archiveAfterDays)
  const archiveCutoff = daysAgo(archiveAfterDays);
  const fullPaths = logFiles.map(f => path.join(logDir, f));
  const groups = groupByDate(fullPaths, archiveCutoff);

  for (const [date, group] of groups) {
    // Skip files that are also past maxAgeDays — they'll be deleted in phase 3
    const maxCutoff = daysAgo(maxAgeDays);
    const toArchive = group.files.filter(f => {
      const stat = fs.statSync(f);
      return stat.mtimeMs >= maxCutoff;
    });

    if (toArchive.length === 0) continue;

    if (!dryRun) {
      createTarball(archiveDir, date, toArchive, dryRun);
    }
    archivesCreated++;

    // Delete archived originals
    for (const f of toArchive) {
      const size = fs.statSync(f).size;
      if (!dryRun) fs.unlinkSync(f);
      filesArchived++;
      bytesFreed += size;
    }
  }

  // Phase 2: Delete old archive tarballs
  const archiveAgeCutoff = daysAgo(archiveRetentionDays);
  for (const archive of existingArchives) {
    const archivePath = path.join(archiveDir, archive);
    const stat = fs.statSync(archivePath);
    if (stat.mtimeMs < archiveAgeCutoff) {
      if (!dryRun) fs.unlinkSync(archivePath);
      archivesDeleted++;
      bytesFreed += stat.size;
    }
  }

  // Phase 3: Safety net — delete files older than maxAgeDays
  const maxCutoff = daysAgo(maxAgeDays);
  const remainingEntries = fs.existsSync(logDir) ? fs.readdirSync(logDir) : [];
  for (const entry of remainingEntries) {
    if (SKIP_NAMES.has(entry)) continue;
    if (skipRegexes.some(r => r.test(entry))) continue;
    const fullPath = path.join(logDir, entry);
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;
      if (stat.mtimeMs < maxCutoff) {
        if (!dryRun) fs.unlinkSync(fullPath);
        filesDeleted++;
        bytesFreed += stat.size;
      }
    } catch { /* skip */ }
  }

  // Count final state
  const finalEntries = fs.existsSync(logDir) ? fs.readdirSync(logDir) : [];
  const fileCountAfter = finalEntries.filter(e => {
    if (SKIP_NAMES.has(e)) return false;
    try {
      return fs.statSync(path.join(logDir, e)).isFile();
    } catch { return false; }
  }).length;

  const finalArchives = fs.existsSync(archiveDir) ? fs.readdirSync(archiveDir).filter(e => e.endsWith('.tar.gz')) : [];

  const result: PruneResult = {
    filesScanned: fileCountBefore,
    filesArchived,
    filesDeleted,
    archivesCreated,
    archivesDeleted,
    bytesFreed,
    fileCountBefore,
    fileCountAfter,
    archivesBefore,
    archivesAfter: finalArchives.length,
    durationMs: Date.now() - startMs,
    retentionState: computeRetentionState(logDir, policy),
  };

  // Phase 4: Emit mend.logs_pruned event
  if (!dryRun) {
    emitMendEvent(logDir, result, dryRun);
  }

  return result;
}

/** Format a PruneResult as a human-readable summary. */
export function formatPruneResult(result: PruneResult, dryRun: boolean): string {
  const prefix = dryRun ? '[DRY RUN] ' : '';
  const rs = result.retentionState;
  const lines = [
    `${prefix}Prune complete (${result.durationMs}ms)`,
    `  Files scanned:  ${result.filesScanned}`,
    `  Files archived: ${result.filesArchived}`,
    `  Files deleted:  ${result.filesDeleted}`,
    `  Bytes freed:    ${formatBytes(result.bytesFreed)}`,
    `  Archives created: ${result.archivesCreated}`,
    `  Archives deleted: ${result.archivesDeleted}`,
    `  File count:     ${result.fileCountBefore} → ${result.fileCountAfter}`,
    `  Archive count:  ${result.archivesBefore} → ${result.archivesAfter}`,
    `  Retention state:`,
    `    Current files: ${rs.fileCount} (${formatBytes(rs.totalSizeBytes)})`,
    `    Oldest file:   ${rs.oldestFileAgeDays.toFixed(1)} days`,
    `    Archives:      ${rs.archiveCount} (${formatBytes(rs.archiveSizeBytes)})`,
    `    Policy:        archive>${rs.policy.archiveAfterDays}d, max>${rs.policy.maxAgeDays}d, retain>${rs.policy.archiveRetentionDays}d`,
  ];
  return lines.join('\n');
}
