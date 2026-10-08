import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';

const DIST_CLI = join(process.cwd(), 'dist', 'cli.js');
const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'needle-logs');

type DigestResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

function fixtureFiles(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((file) => file.endsWith('.jsonl'))
    .sort();
}

function fixtureStats(files: string[]): { events: number; workers: string[] } {
  const workers = new Set<string>();
  let events = 0;

  for (const file of files) {
    const lines = readFileSync(join(FIXTURES_DIR, file), 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0);
    events += lines.length;
    for (const line of lines) {
      const event = JSON.parse(line) as { worker_id: string };
      workers.add(event.worker_id);
    }
  }

  return { events, workers: [...workers].sort() };
}

function runDigest(args: string[], env: NodeJS.ProcessEnv = process.env): DigestResult {
  const result = spawnSync('node', [DIST_CLI, 'digest', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env,
  });

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function copyFixtures(destination: string, files: string[]): void {
  mkdirSync(destination, { recursive: true });
  for (const file of files) {
    copyFileSync(join(FIXTURES_DIR, file), join(destination, file));
  }
}

describe('fabric digest directory sources', () => {
  const files = fixtureFiles();
  const stats = fixtureStats(files);

  test('reads every per-worker JSONL in a temporary source directory', () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'fabric-digest-directory-'));

    try {
      copyFixtures(sourceDir, files);
      const result = runDigest(['--source', sourceDir]);

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).not.toBe('');
      expect(result.stdout).toContain('# Session Digest');
      expect(result.stderr).toContain(`Loaded ${stats.events} events`);
      expect(result.stdout).toContain(`| Total Events | ${stats.events} |`);
      expect(result.stdout).toContain(`| Active Workers | ${stats.workers.length} |`);
      for (const worker of stats.workers) {
        expect(result.stdout).toContain(`| ${worker} |`);
      }
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
    }
  }, 15000);

  test('--file still digests one JSONL source', () => {
    const sourceDir = mkdtempSync(join(tmpdir(), 'fabric-digest-file-'));
    const file = files[0];
    const singleFile = join(sourceDir, file);

    try {
      copyFileSync(join(FIXTURES_DIR, file), singleFile);
      const result = runDigest(['--file', singleFile]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('# Session Digest');
      expect(result.stderr).toContain('Loaded 4 events');
      expect(result.stdout).toContain('| Total Events | 4 |');
      expect(result.stdout).toContain('| Active Workers | 1 |');
      expect(result.stdout).toContain('| alpha-d6288428 |');
      expect(result.stdout).not.toContain('bravo-44c92b93');
    } finally {
      rmSync(sourceDir, { recursive: true, force: true });
    }
  }, 15000);

  test('uses the ~/.needle/logs directory when no source arguments are given', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'fabric-digest-home-'));
    const defaultLogsDir = join(homeDir, '.needle', 'logs');

    try {
      copyFixtures(defaultLogsDir, files);
      const result = runDigest([], { ...process.env, HOME: homeDir });

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).not.toBe('');
      expect(result.stderr).toContain(`Analyzing: ${defaultLogsDir} (directory)`);
      expect(result.stderr).toContain(`Loaded ${stats.events} events`);
      expect(result.stdout).toContain(`| Total Events | ${stats.events} |`);
      expect(result.stdout).toContain(`| Active Workers | ${stats.workers.length} |`);
      for (const worker of stats.workers) {
        expect(result.stdout).toContain(`| ${worker} |`);
      }
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  }, 15000);
});
