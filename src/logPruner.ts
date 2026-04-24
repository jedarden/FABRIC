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
}

export interface FileGroup {
  date: string; // YYYY-MM-DD
  files: string[];
  totalSize: number;
}

const SKIP_NAMES = new Set(['archive', 'fabric-mend.jsonl']);

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

/** Create a tar.gz archive from a list of files. Returns the archive path. */
function createTarball(archiveDir: string, date: string, files: string[], dryRun: boolean): string {
  const tarballPath = path.join(archiveDir, `${date}.tar.gz`);

  if (fs.existsSync(tarballPath)) {
    // Append to existing tarball — tar -rf doesn't work with compressed archives,
    // so we extract, add, and recompress. Simpler: just add to existing tarball.
    // Since tar --append doesn't work with .tar.gz, create a temporary uncompressed
    // tar, append, then recompress.
    const tmpTar = path.join(archiveDir, `${date}.tmp.tar`);
    try {
      // Decompress existing archive
      if (!dryRun) {
        execFileSync('gzip', ['-d', '-k', '-f', tarballPath], { timeout: 60000 });
        const gzPath = `${tarballPath.slice(0, -3)}`; // remove .gz
        fs.renameSync(gzPath, tmpTar);

        // Append new files
        const fileArgs = files.map(f => path.basename(f));
        execFileSync('tar', ['-rf', tmpTar, ...fileArgs], {
          cwd: path.dirname(files[0]),
          timeout: 60000,
        });

        // Recompress
        execFileSync('gzip', ['-f', tmpTar], { timeout: 60000 });
        fs.renameSync(`${tmpTar}.gz`, tarballPath);
      }
    } catch {
      // If append fails, just overwrite
      if (!dryRun) {
        if (fs.existsSync(tmpTar)) fs.unlinkSync(tmpTar);
        if (fs.existsSync(`${tmpTar}.gz`)) fs.unlinkSync(`${tmpTar}.gz`);
        const fileArgs = files.map(f => path.basename(f));
        execFileSync('tar', ['-czf', tarballPath, ...fileArgs], {
          cwd: path.dirname(files[0]),
          timeout: 60000,
        });
      }
    }
  } else {
    if (!dryRun) {
      const fileArgs = files.map(f => path.basename(f));
      execFileSync('tar', ['-czf', tarballPath, ...fileArgs], {
        cwd: path.dirname(files[0]),
        timeout: 60000,
      });
    }
  }

  return tarballPath;
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

  if (!fs.existsSync(logDir)) {
    return {
      filesScanned: 0, filesArchived: 0, filesDeleted: 0,
      archivesCreated: 0, archivesDeleted: 0, bytesFreed: 0,
      fileCountBefore: 0, fileCountAfter: 0,
      archivesBefore: 0, archivesAfter: 0, durationMs: Date.now() - startMs,
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
  ];
  return lines.join('\n');
}
