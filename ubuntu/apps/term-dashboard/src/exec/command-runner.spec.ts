import type { ActivityEvent } from '@linux-toolchain/term-config';
import { createActivityBus } from './activity-bus';
import {
  failureText,
  ProcessCommandRunner,
  RecordingCommandRunner,
  succeeded,
} from './command-runner';

function setup() {
  const bus = createActivityBus();
  const events: ActivityEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const runner = new ProcessCommandRunner(bus, {
    PATH: process.env['PATH'] ?? '/usr/bin:/bin',
    LANG: 'C.UTF-8',
  });
  return { bus, events, runner };
}

describe('ProcessCommandRunner', () => {
  it('streams started, output and exited for a successful command', async () => {
    const { events, runner } = setup();
    const result = await runner.run(['sh', '-c', 'printf "hello\\n"'], {
      cwd: '/',
    });
    expect(succeeded(result)).toBe(true);
    expect(result.stdout).toBe('hello\n');
    expect(events.map((e) => e.type)).toEqual(['started', 'output', 'exited']);
    const [start, out, exit] = events;
    expect(start).toMatchObject({
      argv: ['sh', '-c', 'printf "hello\\n"'],
      cwd: '/',
    });
    expect(out).toMatchObject({ stream: 'stdout', chunk: 'hello\n' });
    expect(exit).toMatchObject({ code: 0, signal: null });
    expect(new Set(events.map((e) => e.id)).size).toBe(1);
  });

  it('streams stderr and the exit code of a failing command', async () => {
    const { events, runner } = setup();
    const result = await runner.run(['sh', '-c', 'echo oops >&2; exit 3']);
    expect(result.code).toBe(3);
    expect(succeeded(result)).toBe(false);
    expect(result.stderr).toBe('oops\n');
    expect(events.map((e) => e.type)).toEqual(['started', 'output', 'exited']);
    expect(events[1]).toMatchObject({ stream: 'stderr', chunk: 'oops\n' });
    expect(events[2]).toMatchObject({ type: 'exited', code: 3 });
    expect(failureText(['x'], result)).toContain('exit code 3');
  });

  it('passes argv verbatim without a shell', async () => {
    const { runner } = setup();
    const tricky = '$(echo pwned); `id` | ; > /tmp/x';
    const result = await runner.run(['printf', '%s', tricky]);
    expect(result.stdout).toBe(tricky);
  });

  it('reports a missing binary as notFound with a started/exited pair', async () => {
    const { events, runner } = setup();
    const result = await runner.run(['td-no-such-binary-xyz']);
    expect(result.notFound).toBe(true);
    expect(result.code).toBeNull();
    expect(events.map((e) => e.type)).toEqual(['started', 'exited']);
    expect(events[1]).toMatchObject({
      error: expect.stringContaining('not found'),
    });
  });

  it('kills a command that runs past its timeout', async () => {
    const { runner } = setup();
    const result = await runner.run(['sleep', '5'], { timeoutMs: 100 });
    expect(result.signal).toBe('SIGKILL');
    expect(result.error).toContain('timed out');
  });

  it('writes input to stdin and merges env over the base env', async () => {
    const { runner } = setup();
    const result = await runner.run(['sh', '-c', 'cat; printf "%s" "$TD_X"'], {
      input: 'in-',
      env: { TD_X: 'x' },
    });
    expect(result.stdout).toBe('in-x');
  });

  it('rejects an empty argv', async () => {
    const { runner } = setup();
    await expect(runner.run([])).rejects.toThrow('empty argv');
  });
});

describe('RecordingCommandRunner', () => {
  it('records calls and answers from the responder', async () => {
    const runner = new RecordingCommandRunner((argv) =>
      argv[0] === 'fail' ? { code: 2, stderr: 'no' } : undefined,
    );
    expect(await runner.run(['ok', 'a'])).toMatchObject({
      code: 0,
      stdout: '',
    });
    expect(await runner.run(['fail'], { cwd: '/x' })).toMatchObject({
      code: 2,
      stderr: 'no',
    });
    expect(runner.commands()).toEqual(['ok a', 'fail']);
    expect(runner.calls[1].opts).toEqual({ cwd: '/x' });
  });
});
