import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Port of the td server started by `dev:td` (apps/term-dashboard serve). */
const TD_DEV_SERVER = 'http://127.0.0.1:4777';

const fromRoot = (path: string) =>
  fileURLToPath(new URL(`../../${path}`, import.meta.url));

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/term-dashboard-web',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Exact matches only, so the core barrel (Node-only) never resolves here.
      '@linux-toolchain/core/shell': fromRoot('libs/core/src/shell.ts'),
      '@linux-toolchain/term-config': fromRoot('libs/term-config/src/index.ts'),
    },
  },
  build: {
    outDir: '../../dist/apps/term-dashboard-web',
    emptyOutDir: true,
    reportCompressedSize: false,
  },
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: {
      // changeOrigin stays false: td checks that Host/Origin match the dev
      // origin it was started with (--dev-origin).
      '/api': { target: TD_DEV_SERVER, changeOrigin: false },
      '/ws': { target: TD_DEV_SERVER, changeOrigin: false, ws: true },
    },
  },
});
