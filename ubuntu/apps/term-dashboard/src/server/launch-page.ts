import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function launchUrl(origin: string, code: string): string {
  return `${origin}/#c=${code}`;
}

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/**
 * A page that sends the browser on to `url`. `JSON.stringify` plus escaping
 * `<` keeps the URL inside the script string.
 */
export function launchPageHtml(url: string): string {
  const attr = escapeHtml(url);
  const js = JSON.stringify(url).replace(/</g, '\\u003c');
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="referrer" content="no-referrer">',
    `<meta http-equiv="refresh" content="0;url=${attr}">`,
    '<title>term-dashboard</title>',
    '</head>',
    '<body>',
    `<script>location.replace(${js})</script>`,
    `<p>Opening <a href="${attr}">term-dashboard</a>…</p>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

const PAGE_NAME = /^launch-[0-9a-f]{32}\.html$/;

/** True for a path `LaunchPages` could have created in `dir`. */
export function isLaunchPagePath(dir: string, path: string): boolean {
  return (
    path.startsWith(`${dir}/`) && PAGE_NAME.test(path.slice(dir.length + 1))
  );
}

/**
 * Private redirect pages that carry a launch code to the browser. Passing a
 * `file://` path to `xdg-open` instead of the launch URL keeps the code out
 * of every process argument list (`/proc/<pid>/cmdline` is world-readable).
 * The folder is 0700 and each page 0600; a page is deleted when its code is
 * redeemed, when the code expires, and when td stops.
 */
export class LaunchPages {
  private readonly pages = new Map<
    string,
    { path: string; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(
    readonly dir: string,
    private readonly ttlMs: number,
  ) {}

  /** Write a page that redirects to `url`; returns its absolute path. */
  async create(code: string, url: string): Promise<string> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await chmod(this.dir, 0o700);
    const info = await lstat(this.dir);
    if (!info.isDirectory()) throw new Error(`${this.dir} is not a folder`);
    const path = join(
      this.dir,
      `launch-${randomBytes(16).toString('hex')}.html`,
    );
    await writeFile(path, launchPageHtml(url), { mode: 0o600, flag: 'wx' });
    const timer = setTimeout(() => void this.spent(code), this.ttlMs);
    timer.unref();
    this.pages.set(code, { path, timer });
    return path;
  }

  /** Delete the page of `code` (redeemed or expired); no-op when unknown. */
  async spent(code: string): Promise<void> {
    const page = this.pages.get(code);
    if (!page) return;
    this.pages.delete(code);
    clearTimeout(page.timer);
    await rm(page.path, { force: true });
  }

  async removeAll(): Promise<void> {
    await Promise.all([...this.pages.keys()].map((code) => this.spent(code)));
  }
}
