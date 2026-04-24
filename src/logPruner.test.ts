import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pruneLogs, formatPruneResult, type PruneResult } from './logPruner.js';

function makeDir(tmp: string, ...segments: string[]): string {
  const dir = path.join(tmp, ...segments);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function touch(dir: string, name: string, ageDays: number, sizeBytes = 100): string {
  const f = path.join(dir, name);
  const buf = Buffer.alloc(sizeBytes);
  fs.writeFileSync(f, buf);
  const mtime = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
  fs.utimesSync(f, mtime, mtime);
  return f;
}

describe('logPruner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-prune-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('archives files older than archiveAfterDays', () => {
    const logDir = makeDir(tmpDir, 'logs');

    // Recent file — should be kept
    touch(logDir, 'recent.jsonl', 1, 200);
    // Old file — should be archived
    touch(logDir, 'old-alpha-001.jsonl', 5, 300);

    const result = pruneLogs({
      logDir,
      archiveAfterDays: 3,
      archiveRetentionDays: 30,
      maxAgeDays: 7,
      dryRun: false,
    });

    expect(result.filesScanned).toBe(2);
    expect(result.filesArchived).toBe(1);
    expect(result.filesDeleted).toBe(0);
    expect(result.fileCountBefore).toBe(2);
    expect(result.fileCountAfter).toBe(1); // only recent.jsonl remains
    expect(result.archivesCreated).toBe(1);

    // Archive should exist
    const archiveDir = path.join(logDir, 'archive');
    const archives = fs.readdirSync(archiveDir).filter(f => f.endsWith('.tar.gz'));
    expect(archives.length).toBe(1);
  });

  it('deletes files older than maxAgeDays (safety net)', () => {
    const logDir = makeDir(tmpDir, 'logs');

    // Very old file — past both archive and max age
    touch(logDir, 'ancient-beta-002.jsonl', 10, 400);

    const result = pruneLogs({
      logDir,
      archiveAfterDays: 3,
      archiveRetentionDays: 30,
      maxAgeDays: 7,
      dryRun: false,
    });

    expect(result.filesDeleted).toBe(1);
    expect(result.bytesFreed).toBe(400);
    expect(result.fileCountAfter).toBe(0);
  });

  it('deletes old archive tarballs', () => {
    const logDir = makeDir(tmpDir, 'logs');
    const archiveDir = makeDir(logDir, 'archive');

    // Create a stale archive tarball
    const archive = path.join(archiveDir, '2026-03-01.tar.gz');
    fs.writeFileSync(archive, Buffer.alloc(500));
    const mtime = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    fs.utimesSync(archive, mtime, mtime);

    const result = pruneLogs({
      logDir,
      archiveAfterDays: 3,
      archiveRetentionDays: 30,
      maxAgeDays: 7,
      dryRun: false,
    });

    expect(result.archivesDeleted).toBe(1);
    expect(result.archivesBefore).toBe(1);
    expect(result.archivesAfter).toBe(0);
    expect(result.bytesFreed).toBe(500);
  });

  it('skips fabric-mend.jsonl', () => {
    const logDir = makeDir(tmpDir, 'logs');

    // fabric-mend.jsonl should never be touched
    touch(logDir, 'fabric-mend.jsonl', 100, 200);
    // Regular old file
    touch(logDir, 'old-charlie-003.jsonl', 10, 300);

    const result = pruneLogs({
      logDir,
      archiveAfterDays: 3,
      archiveRetentionDays: 30,
      maxAgeDays: 7,
      dryRun: false,
    });

    // fabric-mend.jsonl excluded from scan
    expect(result.filesScanned).toBe(1);
    expect(fs.existsSync(path.join(logDir, 'fabric-mend.jsonl'))).toBe(true);
  });

  it('dry run makes no changes', () => {
    const logDir = makeDir(tmpDir, 'logs');
    touch(logDir, 'old-delta-004.jsonl', 10, 300);

    const result = pruneLogs({
      logDir,
      archiveAfterDays: 3,
      archiveRetentionDays: 30,
      maxAgeDays: 7,
      dryRun: true,
    });

    // Reports what would happen
    expect(result.filesDeleted).toBe(1);
    expect(result.bytesFreed).toBe(300);

    // But file still exists
    expect(fs.existsSync(path.join(logDir, 'old-delta-004.jsonl'))).toBe(true);
  });

  it('handles empty directory', () => {
    const logDir = makeDir(tmpDir, 'logs');

    const result = pruneLogs({
      logDir,
      archiveAfterDays: 3,
      archiveRetentionDays: 30,
      maxAgeDays: 7,
      dryRun: false,
    });

    expect(result.filesScanned).toBe(0);
    expect(result.filesArchived).toBe(0);
    expect(result.filesDeleted).toBe(0);
  });

  it('handles nonexistent directory', () => {
    const result = pruneLogs({
      logDir: path.join(tmpDir, 'no-such-dir'),
      archiveAfterDays: 3,
      archiveRetentionDays: 30,
      maxAgeDays: 7,
      dryRun: false,
    });

    expect(result.filesScanned).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('emits mend.logs_pruned event to fabric-mend.jsonl', () => {
    const logDir = makeDir(tmpDir, 'logs');
    touch(logDir, 'old-echo-005.jsonl', 10, 200);

    pruneLogs({
      logDir,
      archiveAfterDays: 3,
      archiveRetentionDays: 30,
      maxAgeDays: 7,
      dryRun: false,
    });

    const mendFile = path.join(logDir, 'fabric-mend.jsonl');
    expect(fs.existsSync(mendFile)).toBe(true);

    const content = fs.readFileSync(mendFile, 'utf8').trim();
    const event = JSON.parse(content);
    expect(event.event_type).toBe('mend.logs_pruned');
    expect(event.worker_id).toBe('fabric-prune');
    expect(event.data.files_deleted).toBe(1);
    expect(event.data.bytes_freed).toBe(200);
    expect(event.data.dry_run).toBe(false);
  });

  it('includes retention_state in mend event and result', () => {
    const logDir = makeDir(tmpDir, 'logs');
    // 5 days old — past archiveAfterDays=3 but under maxAgeDays=7
    touch(logDir, 'old-foxtrot-006.jsonl', 5, 300);

    const result = pruneLogs({
      logDir,
      archiveAfterDays: 3,
      archiveRetentionDays: 30,
      maxAgeDays: 7,
      dryRun: false,
    });

    expect(result.retentionState.fileCount).toBe(0);
    expect(result.retentionState.totalSizeBytes).toBe(0);
    expect(result.retentionState.oldestFileAgeDays).toBe(0);
    expect(result.retentionState.archiveCount).toBe(1);
    expect(result.retentionState.archiveSizeBytes).toBeGreaterThan(0);
    expect(result.retentionState.policy).toEqual({
      archiveAfterDays: 3,
      maxAgeDays: 7,
      archiveRetentionDays: 30,
    });

    const mendFile = path.join(logDir, 'fabric-mend.jsonl');
    const event = JSON.parse(fs.readFileSync(mendFile, 'utf8').trim());
    expect(event.data.retention_state).toBeDefined();
    expect(event.data.retention_state.file_count).toBe(0);
    expect(event.data.retention_state.policy.archive_after_days).toBe(3);
    expect(event.data.retention_state.oldest_file_age_days).toBe(0);
  });

  it('formatPruneResult includes retention state', () => {
    const result: PruneResult = {
      filesScanned: 100,
      filesArchived: 20,
      filesDeleted: 50,
      archivesCreated: 3,
      archivesDeleted: 1,
      bytesFreed: 1024 * 1024 * 5,
      fileCountBefore: 100,
      fileCountAfter: 30,
      archivesBefore: 5,
      archivesAfter: 4,
      durationMs: 123,
      retentionState: {
        fileCount: 30,
        totalSizeBytes: 1024 * 1024 * 50,
        oldestFileAgeDays: 2.5,
        archiveCount: 4,
        archiveSizeBytes: 1024 * 1024 * 10,
        policy: { archiveAfterDays: 3, maxAgeDays: 7, archiveRetentionDays: 30 },
      },
    };
    const text = formatPruneResult(result, false);
    expect(text).toContain('Files scanned:  100');
    expect(text).toContain('5.0 MB');
    expect(text).toContain('100 → 30');
    expect(text).toContain('Retention state:');
    expect(text).toContain('50.0 MB');
    expect(text).toContain('archive>3d');
  });
});
