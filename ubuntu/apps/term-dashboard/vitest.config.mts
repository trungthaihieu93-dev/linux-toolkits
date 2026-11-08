import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/term-dashboard',
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    name: 'term-dashboard',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    passWithNoTests: true,
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/term-dashboard',
      provider: 'v8' as const,
    },
  },
}));
