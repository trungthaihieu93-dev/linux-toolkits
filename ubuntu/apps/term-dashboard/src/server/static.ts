import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import type { Context } from 'hono';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

export function contentType(path: string): string {
  return (
    CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
  );
}

async function readRegularFile(path: string): Promise<Buffer | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? await readFile(path) : null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') {
      return null;
    }
    throw error;
  }
}

/**
 * Serves the built web UI from `webRoot`. Paths without a file extension that
 * match no file fall back to `index.html` (client-side routing); missing files
 * with an extension are 404. Requests never leave `webRoot`.
 */
export function createStaticHandler(webRoot: string) {
  const root = resolve(webRoot);
  return async (c: Context): Promise<Response> => {
    let relative: string;
    try {
      relative = decodeURIComponent(c.req.path);
    } catch {
      return c.text('bad request', 400);
    }
    if (relative.includes('\0')) return c.text('bad request', 400);
    const target = resolve(join(root, relative));
    if (target !== root && !target.startsWith(root + sep)) {
      return c.text('not found', 404);
    }

    const file = target === root ? null : await readRegularFile(target);
    if (file) {
      const immutable = relative.startsWith('/assets/');
      return c.body(new Uint8Array(file), 200, {
        'content-type': contentType(target),
        'cache-control': immutable
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
        'x-content-type-options': 'nosniff',
      });
    }
    if (extname(relative) !== '') return c.text('not found', 404);

    const index = await readRegularFile(join(root, 'index.html'));
    if (!index) {
      return c.text('web UI not built (expected index.html in web/)', 503);
    }
    return c.body(new Uint8Array(index), 200, {
      'content-type': CONTENT_TYPES['.html'],
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
  };
}
