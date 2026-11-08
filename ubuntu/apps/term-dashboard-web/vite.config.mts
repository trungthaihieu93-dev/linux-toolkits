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
    // The Monaco chunk (~4 MB, editor + shell language) loads only when an
    // editor or diff opens; the main chunk stays far below 500 kB. The plan
    // accepts Monaco's size for a local tool.
    chunkSizeWarningLimit: 4500,
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
