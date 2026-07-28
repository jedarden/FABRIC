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
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { execSync, ExecSyncOptionsWithStringEncoding } from 'node:child_process';
import { createTempLogFile } from './testHelpers.js';

/** Helper to run command and capture both stdout and stderr */
function execCaptureStderr(cmd: string): { stdout: string; stderr: string } {
  try {
    const { spawnSync } = require('child_process');
    const result = spawnSync('sh', ['-c', cmd], {
      cwd: process.cwd(),
      encoding: 'utf-8' as const,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error: any) {
    return { stdout: '', stderr: error.message || '' };
  }
}

/** Helper to run command and capture both stdout and stderr */
function execCapture(cmd: string, options: ExecSyncOptionsWithStringEncoding = { encoding: 'utf-8' }): { stdout: string; stderr: string } {
  const defaultOptions: ExecSyncOptionsWithStringEncoding = {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  };
  try {
    const result = execSync(cmd, defaultOptions);
    // execSync with stdio: 'pipe' returns stdout as the result
    return { stdout: result as string, stderr: '' };
  } catch (error: any) {
    // Handle commands that fail or timeout
    return { stdout: error.stdout || '', stderr: error.stderr || '' };
  }
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
      expect(stdout).toMatch(/\| alpha-d6288428 \|/); // alpha in table
      expect(stdout).toMatch(/\| bravo-44c92b93 \|/); // bravo in table
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

  describe('--source option edge cases', () => {
    test('handles non-existent file path gracefully', () => {
      const nonExistentPath = join(FIXTURES_DIR, 'does-not-exist.jsonl');

      // Should exit with error message
      expect(() => {
        execSync(`node ${DIST_CLI} digest --source ${nonExistentPath}`, {
          encoding: 'utf-8',
          stdio: 'pipe',
        });
      }).toThrow();
    }, 10000);

    test('handles relative file paths correctly', () => {
      // Create a temp file in current directory
      const tempFileName = 'test-relative-path.jsonl';
      const testEvent = '{"ts":1709337600,"worker":"test-worker","level":"info","msg":"Test event"}\n';

      try {
        writeFileSync(tempFileName, testEvent, 'utf8');

        // Test with relative path (just filename, no directory)
        const { stdout, stderr } = execCaptureStderr(
          `node ${DIST_CLI} digest --source ${tempFileName}`
        );

        // Should successfully process the file
        expect(stderr).toContain('Loaded 1 events');
        expect(stdout).toContain('test-worker');
        expect(stdout).toContain('# Session Digest');
      } finally {
        // Clean up
        if (existsSync(tempFileName)) {
          unlinkSync(tempFileName);
        }
      }
    }, 10000);

    test('handles absolute file paths correctly', () => {
      // Create a temp file with absolute path
      const tempFile = join(process.cwd(), 'test-absolute-path.jsonl');
      const testEvent = '{"ts":1709337600,"worker":"test-worker-abs","level":"info","msg":"Test event"}\n';

      try {
        writeFileSync(tempFile, testEvent, 'utf8');

        // Test with absolute path
        const { stdout, stderr } = execCaptureStderr(
          `node ${DIST_CLI} digest --source ${tempFile}`
        );

        // Should successfully process the file
        expect(stderr).toContain('Loaded 1 events');
        expect(stdout).toContain('test-worker-abs');
        expect(stdout).toContain('# Session Digest');

        // Verify the absolute path is logged correctly
        expect(stderr).toContain(tempFile);
      } finally {
        // Clean up
        if (existsSync(tempFile)) {
          unlinkSync(tempFile);
        }
      }
    }, 10000);

    test('handles paths with tilde home expansion', () => {
      // This test verifies that paths starting with ~ are expanded correctly
      // We'll use a temp directory in home and access it via ~/path
      const homeDir = process.env.HOME || process.env.USERPROFILE || '';
      if (!homeDir) {
        console.log('Skipping test: HOME directory not found');
        return;
      }

      const tempFileName = 'test-tilde-expansion.jsonl';
      const tempFilePath = join(homeDir, tempFileName);
      const testEvent = '{"ts":1709337600,"worker":"test-worker-tilde","level":"info","msg":"Test event"}\n';

      try {
        writeFileSync(tempFilePath, testEvent, 'utf8');

        // Test with tilde path
        const { stdout, stderr } = execCaptureStderr(
          `node ${DIST_CLI} digest --source ~/${tempFileName}`
        );

        // Should successfully process the file
        expect(stderr).toContain('Loaded 1 events');
        expect(stdout).toContain('test-worker-tilde');
        expect(stdout).toContain('# Session Digest');
      } finally {
        // Clean up
        if (existsSync(tempFilePath)) {
          unlinkSync(tempFilePath);
        }
      }
    }, 10000);

    test('handles empty string as source path', () => {
      // Empty string should trigger default behavior (use ~/.needle/logs/)
      const { stdout, stderr } = execCaptureStderr(
        `node ${DIST_CLI} digest --source ""`
      );

      // Should produce a valid digest with default source
      const output = stdout + stderr;
      expect(output).toContain('# Session Digest');

      // Should indicate it's using the default logs directory
      expect(stderr).toContain('.needle/logs');
    }, 10000);

    test('handles file paths with special characters', () => {
      // Test paths with spaces, parentheses, and other special chars
      const specialCases = [
        'test file with spaces.jsonl',
        'test-file-with(parentheses).jsonl',
        'test-file-with[brackets].jsonl',
        "test-file-with'quotes'.jsonl",
      ];

      for (const filename of specialCases) {
        const tempFile = join(process.cwd(), filename);
        const testEvent = '{"ts":1709337600,"worker":"test-worker-special","level":"info","msg":"Test event"}\n';

        try {
          writeFileSync(tempFile, testEvent, 'utf8');

          // Test with special character filename (properly quoted)
          const { stdout, stderr } = execCaptureStderr(
            `node ${DIST_CLI} digest --source "${tempFile}"`
          );

          // Should successfully process the file
          expect(stderr).toContain('Loaded 1 events');
          expect(stdout).toContain('test-worker-special');
          expect(stdout).toContain('# Session Digest');
        } finally {
          // Clean up
          if (existsSync(tempFile)) {
            unlinkSync(tempFile);
          }
        }
      }
    }, 15000);

    test('handles directory path with trailing slash', () => {
      // Test that directory paths with trailing slashes work correctly
      const { stdout, stderr } = execCaptureStderr(
        `node ${DIST_CLI} digest --source "${FIXTURES_DIR}/"`
      );

      // Should process directory correctly despite trailing slash
      expect(stderr).toContain('(directory)');
      expect(stdout).toContain('alpha-d6288428');
      expect(stdout).toContain('bravo-44c92b93');
      expect(stdout).toContain('# Session Digest');
    }, 10000);

    test('handles relative directory paths correctly', () => {
      // Change to a different directory and use relative path
      const originalDir = process.cwd();

      try {
        // Navigate to tests directory
        process.chdir(join(process.cwd(), 'tests'));

        const { stdout, stderr } = execCaptureStderr(
          `node ${join(originalDir, 'dist', 'cli.js')} digest --source fixtures/needle-logs`
        );

        // Should successfully process the directory with relative path
        expect(stderr).toContain('(directory)');
        expect(stdout).toContain('alpha-d6288428');
        expect(stdout).toContain('# Session Digest');
      } finally {
        // Restore original directory
        process.chdir(originalDir);
      }
    }, 10000);
  });

  describe('--source option with file path', () => {
    test('resolves file path: resolved.kind is file and resolved.path matches input', () => {
      // Create a temporary log file for this test
      const tempFile = join(process.cwd(), 'test-temp-log-file.jsonl');
      const testEvent = '{"ts":1709337600,"worker":"test-worker","level":"info","msg":"Test event"}\n';

      try {
        // Write test event to temporary file
        writeFileSync(tempFile, testEvent, 'utf8');

        // Run digest command with --source pointing to the temporary file
        const { stdout, stderr } = execCaptureStderr(
          `node ${DIST_CLI} digest --source ${tempFile}`
        );

        // Verify resolved.kind === 'file' (logged to stderr)
        expect(stderr).toContain('(file)');

        // Verify resolved.path matches the input file path
        expect(stderr).toContain(tempFile);

        // Verify the command processes the file correctly
        expect(stderr).toContain('Loaded 1 events');
        expect(stdout).toContain('test-worker');

        // Verify digest structure is valid
        expect(stdout).toContain('# Session Digest');
        expect(stdout).toContain('## Summary');
      } finally {
        // Clean up temporary file
        if (existsSync(tempFile)) {
          unlinkSync(tempFile);
        }
      }
    }, 10000);

    test('resolves file path using createTempLogFile helper (bf-5qe4z)', () => {
      // Create a temp log file using the helper from testHelpers.ts (bead bf-4xotm)
      const { filePath, cleanup } = createTempLogFile({
        filename: 'test-digest-source.jsonl',
        eventCount: 2,
        workerId: 'test-worker-resolver',
      });

      try {
        // Call digest command with --source pointing to the temp file
        const { stdout, stderr } = execCaptureStderr(
          `node ${DIST_CLI} digest --source ${filePath}`
        );

        // Assert resolved.kind === 'file' (logged to stderr as '(file)')
        expect(stderr).toContain('(file)');

        // Assert resolved.path matches the input file path
        expect(stderr).toContain(filePath);

        // Verify the command processes the file correctly
        expect(stderr).toContain('Loaded 2 events');
        expect(stdout).toContain('test-worker-resolver');

        // Verify digest structure is valid
        expect(stdout).toContain('# Session Digest');
        expect(stdout).toContain('## Summary');
      } finally {
        // Clean up the temp file using the provided cleanup function
        cleanup();
      }
    }, 10000);

    test('correctly processes file source and shows kind=file', () => {
      const alphaLog = join(FIXTURES_DIR, 'alpha-d6288428.jsonl');
      if (!existsSync(alphaLog)) {
        throw new Error(`Fixture not found: ${alphaLog}`);
      }

      const { stdout, stderr } = execCaptureStderr(
        `node ${DIST_CLI} digest --source ${alphaLog}`
      );

      // Verify resolved.kind is 'file' (shown in stderr)
      expect(stderr).toContain('(file)');

      // Verify resolved.path matches the input
      expect(stderr).toContain(alphaLog);

      // Verify command processes the file correctly (loaded events)
      expect(stderr).toContain('Loaded 4 events');

      // Verify digest output includes events from the specified file
      expect(stdout).toContain('alpha-d6288428');
      expect(stdout).toContain('bd-a1b2'); // Bead from the file
      expect(stdout).not.toContain('bravo-44c92b93'); // Other worker not included

      // Should be valid digest
      expect(stdout).toContain('# Session Digest');
      expect(stdout).toContain('## Summary');
      expect(stdout).toContain('Total Events | 4');
    }, 10000);

    test('validates path exists and exits with error for non-existent file', () => {
      const nonExistentPath = join(FIXTURES_DIR, 'does-not-exist.jsonl');

      // Should exit with error message
      expect(() => {
        execSync(`node ${DIST_CLI} digest --source ${nonExistentPath}`, {
          encoding: 'utf-8',
          stdio: 'pipe',
        });
      }).toThrow();
    }, 10000);
  });

  describe('backward compatibility: single-file mode', () => {
    test('-f/--file option still works for single files', () => {
      const alphaLog = join(FIXTURES_DIR, 'alpha-d6288428.jsonl');
      if (!existsSync(alphaLog)) {
        throw new Error(`Fixture not found: ${alphaLog}`);
      }

      const stdout = execSync(
        `node ${DIST_CLI} digest -f ${alphaLog}`,
        { encoding: 'utf-8', cwd: process.cwd() }
      );

      // Should only show alpha worker
      expect(stdout).toContain('alpha-d6288428');
      expect(stdout).not.toContain('bravo-44c92b93');

      // Should be valid digest
      expect(stdout).toContain('# Session Digest');
      expect(stdout).toContain('## Summary');
      expect(stdout).toContain('Total Events | 4'); // File has 4 events
    }, 10000);
  });

  describe('default behavior (no args)', () => {
    test('defaults to ~/.needle/logs/ directory when no args provided', () => {
      // This test documents the expected default behavior
      // Skip if ~/.needle/logs/ has too many files (would take too long)
      try {
        const { execSync: execSync2 } = require('child_process');
        const fileCount = execSync2(`ls -1 ~/.needle/logs/*.jsonl 2>/dev/null | wc -l`, {
          encoding: 'utf-8',
          timeout: 2000,
        }).trim();

        // If there are more than 10 files, skip this test to avoid long runs
        const count = parseInt(fileCount, 10);
        if (count > 10) {
          console.log(`Skipping test: ${count} files in ~/.needle/logs/ (too many)`);
          return;
        }
      } catch (error) {
        // If we can't check, assume it's okay to run
      }

      const { stdout, stderr } = execCaptureStderr(`node ${DIST_CLI} digest`);

      // Should produce a valid digest structure (even if empty)
      const output = stdout + stderr;
      expect(output).toContain('# Session Digest');
      expect(output).toContain('## Summary');
    }, 30000);
  });

  describe('output to file', () => {
    const outputFile = join(process.cwd(), 'test-digest-output.md');

    afterAll(() => {
      // Clean up test output file
      if (existsSync(outputFile)) {
        unlinkSync(outputFile);
      }
    });

    test('-o/--output option writes digest to file', () => {
      const { stdout, stderr } = execCaptureStderr(
        `node ${DIST_CLI} digest --source ${FIXTURES_DIR} -o ${outputFile}`
      );

      // Should confirm file was written (message goes to stderr)
      expect(stderr).toContain(`Digest written to:`);
      expect(stderr).toContain(outputFile);

      // stdout should be empty (digest goes to file, not stdout)
      expect(stdout).toBe('');

      // File should exist and contain digest
      expect(existsSync(outputFile)).toBe(true);
      const content = readFileSync(outputFile, 'utf-8');
      expect(content).toContain('# Session Digest');
      expect(content).toContain('alpha-d6288428');
      expect(content).toContain('bravo-44c92b93');
    }, 10000);
  });
});
