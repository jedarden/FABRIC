import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    exclude: ['node_modules', 'dist'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
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
      // Thresholds for digest command coverage
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
