import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['node_modules', 'dist'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environmentMatchGlobs: [
      ['src/web/frontend/**/*.test.tsx', 'jsdom'],
    ],
    setupFiles: ['./src/web/frontend/test/setup.ts'],
  },
});
