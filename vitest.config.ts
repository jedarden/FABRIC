import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    exclude: ['node_modules', 'dist'],
    // Keep test-fixture factory ledger rows out of the live ~/.needle/fabric.db
    env: { FABRIC_FACTORY_PERSISTENCE: 'off' },
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'],
    environmentMatchGlobs: [
      ['src/web/frontend/**/*.test.tsx', 'jsdom'],
    ],
    setupFiles: ['./src/web/frontend/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov', 'json-summary'],
      reportsDirectory: './artifacts/coverage',
      exclude: [
        'node_modules/',
        'dist/',
        'src/web/frontend/test/',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.d.ts',
        'src/web/frontend/src/', // Exclude React components from digest coverage
        'tmp/',                  // Test temp directories
        'tests/fixtures/',       // Test fixtures
      ],
      // Digest command specific coverage targets
      include: [
        'src/sessionDigest.ts',
        'src/pathResolver.ts',
        'src/tui/components/SessionDigest.ts',
        'src/errorGrouping.ts',
        'src/analytics.ts',
        'src/cli.ts',            // CLI entry point for digest command
      ],
      // Thresholds for digest command coverage. Restored to 50/50/50/50 on
      // 2026-10-24 (bead fabric-d48e8f7f): dedicated tests for analytics.ts
      // and the TUI SessionDigest component raised the measured digest scope
      // to lines 72.30%, branches 63.96%, functions 77.18%, statements
      // 71.42% — see docs/digest-command-coverage-report.md.
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 50,
        statements: 50,
      },
      // Additional coverage options for digest analysis
      all: true,                 // Cover all files matching the include patterns
      cleanOnRerun: true,        // Clean coverage reports before rerunning
    },
  },
});
