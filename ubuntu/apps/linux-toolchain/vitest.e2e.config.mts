import { defineConfig } from 'vitest/config';

/** End-to-end tests of the built bundle; run via `nx run linux-toolchain:e2e` (builds first). */
export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/linux-toolchain-e2e',
  test: {
    name: 'linux-toolchain-e2e',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['e2e/**/*.e2e.ts'],
    testTimeout: 180_000,
    reporters: ['default'],
  },
}));
