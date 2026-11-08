import pkg from '../../package.json' with { type: 'json' };
import { DEFAULT_PORT, run } from './program';
import type { StartOptions } from './start';

function harness() {
  const out: string[] = [];
  const err: string[] = [];
  const start = vi.fn<(opts: StartOptions) => Promise<number>>(async () => 0);
  return {
    out,
    err,
    start,
    deps: {
      out: { write: (s: string) => out.push(s) },
      err: { write: (s: string) => err.push(s) },
      start,
    },
  };
}

describe('run', () => {
  it('prints the version without starting', async () => {
    const h = harness();
    expect(await run(['--version'], h.deps)).toBe(0);
    expect(h.out.join('')).toBe(`${pkg.version}\n`);
    expect(h.start).not.toHaveBeenCalled();
  });

  it('prints help without the hidden dev flag', async () => {
    const h = harness();
    expect(await run(['--help'], h.deps)).toBe(0);
    const help = h.out.join('');
    expect(help).toContain('--port <n>');
    expect(help).toContain('--no-open');
    expect(help).not.toContain('--dev-origin');
    expect(h.start).not.toHaveBeenCalled();
  });

  it('starts with defaults', async () => {
    const h = harness();
    expect(await run([], h.deps)).toBe(0);
    expect(h.start).toHaveBeenCalledWith({ port: DEFAULT_PORT, open: true });
  });

  it('passes --port, --no-open and --dev-origin', async () => {
    const h = harness();
    await run(
      ['--port', '0', '--no-open', '--dev-origin', 'http://localhost:5173'],
      h.deps,
    );
    expect(h.start).toHaveBeenCalledWith({
      port: 0,
      open: false,
      devOrigin: new URL('http://localhost:5173'),
    });
  });

  it('returns the start exit code', async () => {
    const h = harness();
    h.start.mockResolvedValueOnce(130);
    expect(await run([], h.deps)).toBe(130);
  });

  it.each([
    ['--port', '70000'],
    ['--port', 'abc'],
    ['--port', '-1'],
    ['--dev-origin', 'http://evil.example:5173'],
    ['--dev-origin', 'http://localhost:5173/path'],
    ['--dev-origin', 'file:///tmp'],
    ['--bogus'],
  ])('rejects %s %s as a usage error', async (...args) => {
    const h = harness();
    expect(await run(args, h.deps)).toBe(2);
    expect(h.start).not.toHaveBeenCalled();
    expect(h.err.join('')).toContain('td --help');
  });
});
