import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/linux-toolchain',
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    name: 'linux-toolchain',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    passWithNoTests: true,
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/linux-toolchain',
      provider: 'v8' as const,
    },
  },
}));
