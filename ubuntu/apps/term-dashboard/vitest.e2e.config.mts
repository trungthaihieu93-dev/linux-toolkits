import { defineConfig } from 'vitest/config';

/** End-to-end tests of the built bundle; run via `nx run term-dashboard:e2e` (builds first). */
export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/term-dashboard-e2e',
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    name: 'term-dashboard-e2e',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['e2e/**/*.e2e.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    reporters: ['default'],
  },
}));
