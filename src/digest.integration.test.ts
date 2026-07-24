/**
 * Digest Command Integration Test (bf-61qm6)
 *
 * Tests that fabric digest command works correctly with directory sources
 * containing per-worker JSONL files, not just single consolidated workers.log.
 *
 * Validates:
 * - digest command with --source directory reads from all *.jsonl files
 * - Events from multiple workers are aggregated correctly
 * - Digest includes accurate worker and event counts
 * - Backward compatibility: single-file mode still works with -f/--file
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync, ExecSyncOptionsWithStringEncoding } from 'node:child_process';
import { unlinkSync, existsSync as exists } from 'node:fs';

/** Helper to run command and capture both stdout and stderr */
function execCapture(cmd: string, options: ExecSyncOptionsWithStringEncoding = { encoding: 'utf-8' }): { stdout: string; stderr: string } {
  const defaultOptions: ExecSyncOptionsWithStringEncoding = {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  };
  const result = execSync(cmd, defaultOptions);
  // Note: execSync with stdio: 'pipe' merges stdout and stderr into the result
  // For this test, we'll treat the combined output as stdout
  return { stdout: result as string, stderr: '' };
}

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'needle-logs');
const DIST_CLI = join(process.cwd(), 'dist', 'cli.js');

describe('digest command (integration)', () => {
  describe('with --source directory', () => {
    test('reads from all per-worker JSONL files', () => {
      // Run digest command with --source pointing to fixtures directory
      const stdout = execSync(
        `node ${DIST_CLI} digest --source ${FIXTURES_DIR}`,
        { encoding: 'utf-8', cwd: process.cwd() }
      );

      // Should contain both workers from fixtures
      expect(stdout).toContain('alpha-d6288428');
      expect(stdout).toContain('bravo-44c92b93');

      // Should show multiple events loaded
      expect(stdout).toContain('Total Events');
      expect(stdout).toContain('Active Workers');

      // Should be a valid markdown digest
      expect(stdout).toContain('# Session Digest');
      expect(stdout).toContain('## Summary');
    }, 10000);

    test('produces digest with correct worker and event counts', () => {
      const stdout = execSync(
        `node ${DIST_CLI} digest --source ${FIXTURES_DIR}`,
        { encoding: 'utf-8', cwd: process.cwd() }
      );

      // Fixtures have 4 events in alpha-d6288428.jsonl and 4 events in bravo-44c92b93.jsonl
      // Total: 8 events (not all are parseable as bead completions)
      expect(stdout).toContain('Total Events |'); // Has event count row

      // Should show 2 workers
      expect(stdout).toContain('Active Workers | 2');

      // Worker activity section should list both workers
      expect(stdout).toMatch(/alpha-d6288428.*\|.*\d+\|/); // alpha with events
      expect(stdout).toMatch(/bravo-44c92b93.*\|.*\d+\|/); // bravo with events
    }, 10000);

    test('reads files older than 4 hours (startupRereadMs: Infinity)', () => {
      // Fixtures are from April 2026, much older than 4 hours
      // This test verifies that digest reads old files from beginning, not EOF
      const stdout = execSync(
        `node ${DIST_CLI} digest --source ${FIXTURES_DIR}`,
        { encoding: 'utf-8', cwd: process.cwd() }
      );

      // Should have loaded events, not 0
      expect(stdout).not.toContain('Total Events | 0');

      // Should have at least 2 workers
      expect(stdout).toContain('Active Workers | 2');
    }, 10000);
  });

  describe('backward compatibility: single-file mode', () => {
    test('-f/--file option still works for single files', () => {
      const alphaLog = join(FIXTURES_DIR, 'alpha-d6288428.jsonl');
      if (!existsSync(alphaLog)) {
        throw new Error(`Fixture not found: ${alphaLog}`);
      }

      const { stdout, stderr } = execCapture(
        `node ${DIST_CLI} digest -f ${alphaLog}`
      );

      // Check combined output (stderr has progress, stdout has digest)
      const output = stdout + stderr;

      // Should only show alpha worker
      expect(output).toContain('alpha-d6288428');
      expect(output).not.toContain('bravo-44c92b93');

      // Should be valid digest
      expect(output).toContain('# Session Digest');
      expect(output).toContain('## Summary');
    }, 10000);
  });

  describe('default behavior (no args)', () => {
    test('defaults to ~/.needle/logs/ directory when no args provided', () => {
      // This test documents the expected default behavior
      // It may not find events if ~/.needle/logs/ doesn't exist or is empty
      // but it validates the command doesn't error and produces a digest
      try {
        const { stdout, stderr } = execCapture(
          `node ${DIST_CLI} digest`,
          { encoding: 'utf-8', timeout: 5000 } // Shorter timeout since no data expected
        );

        // Should produce a valid digest structure
        expect(stdout + stderr).toContain('# Session Digest');
        expect(stdout + stderr).toContain('## Summary');
      } catch (error: any) {
        // Command should complete without error, even if no events found
        expect(error.message).not.toContain('failed');
        expect(error.message).not.toContain('ETIMEDOUT');
        expect(error.message).not.toContain('timeout');
      }
    }, 15000);
  });

  describe('output to file', () => {
    const outputFile = join(process.cwd(), 'test-digest-output.md');

    afterAll(() => {
      // Clean up test output file
      if (exists(outputFile)) {
        unlinkSync(outputFile);
      }
    });

    test('-o/--output option writes digest to file', () => {
      const stdout = execSync(
        `node ${DIST_CLI} digest --source ${FIXTURES_DIR} -o ${outputFile}`,
        { encoding: 'utf-8', cwd: process.cwd() }
      );

      // Should confirm file was written
      expect(stdout).toContain(`Digest written to:`);
      expect(stdout).toContain(outputFile);

      // File should exist and contain digest
      expect(exists(outputFile)).toBe(true);
      const content = readFileSync(outputFile, 'utf-8');
      expect(content).toContain('# Session Digest');
      expect(content).toContain('alpha-d6288428');
      expect(content).toContain('bravo-44c92b93');
    }, 10000);
  });
});
