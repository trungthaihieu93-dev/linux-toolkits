import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/term-dashboard-web',
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    name: 'term-dashboard-web',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/term-dashboard-web',
      provider: 'v8' as const,
    },
  },
}));
