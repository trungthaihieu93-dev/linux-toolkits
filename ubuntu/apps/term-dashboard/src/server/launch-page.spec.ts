import { chmod, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LaunchPages, launchPageHtml, launchUrl } from './launch-page';

const URL_ = launchUrl('http://127.0.0.1:4777', 'A'.repeat(43));
const missing = (path: string) =>
  stat(path).then(
    () => false,
    (e: NodeJS.ErrnoException) => e.code === 'ENOENT',
  );

describe('launchPageHtml', () => {
  it('redirects to the launch URL with a meta refresh and location.replace', () => {
    const html = launchPageHtml(URL_);
    expect(html).toContain(
      `<meta http-equiv="refresh" content="0;url=${URL_}">`,
    );
    expect(html).toContain(`location.replace(${JSON.stringify(URL_)})`);
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
  });

  it('escapes markup in the URL', () => {
    const html = launchPageHtml('http://x/#c="><script>');
    expect(html).not.toContain('"><script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });
});

describe('LaunchPages', () => {
  let root: string;
  let dir: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'td-pages-'));
    dir = join(root, 'term-dashboard');
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('writes a private page in a private folder and deletes it once the code is spent', async () => {
    const pages = new LaunchPages(dir, 60_000);
    const path = await pages.create('code-1', URL_);
    expect(path.startsWith(`${dir}/`)).toBe(true);
    expect(path).toMatch(/\/launch-[0-9a-f]{32}\.html$/);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readFile(path, 'utf8')).toBe(launchPageHtml(URL_));
    await pages.spent('code-1');
    expect(await missing(path)).toBe(true);
    await pages.spent('unknown');
  });

  it('tightens an existing folder and deletes pages when their code expires', async () => {
    await mkdir(dir, { recursive: true });
    await chmod(dir, 0o755);
    const pages = new LaunchPages(dir, 30);
    const path = await pages.create('code-2', URL_);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    await new Promise((r) => setTimeout(r, 120));
    expect(await missing(path)).toBe(true);
  });

  it('removes every pending page on shutdown', async () => {
    const pages = new LaunchPages(dir, 60_000);
    const a = await pages.create('a', URL_);
    const b = await pages.create('b', URL_);
    await pages.removeAll();
    expect(await missing(a)).toBe(true);
    expect(await missing(b)).toBe(true);
  });
});
