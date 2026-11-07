import { EventEmitter } from 'node:events';
import type { Context } from './context';
import { USER_ENV } from './context';
import {
  DryRunRunner,
  ProcessRunner,
  RecordingRunner,
  StepError,
  type SpawnFn,
  rootScript,
  userScript,
} from './runner';

interface Call {
  command: string;
  args: string[];
  stdio: string;
}

/** Fake spawn: records calls and exits with the code chosen per call. */
function fakeSpawn(exitCode: (call: Call) => number | Error = () => 0) {
  const calls: Call[] = [];
  const spawn: SpawnFn = (command, args, options) => {
    const call = { command, args, stdio: options.stdio };
    calls.push(call);
    const child = new EventEmitter();
    const result = exitCode(call);
    queueMicrotask(() => {
      if (result instanceof Error) child.emit('error', result);
      else child.emit('close', result, null);
    });
    return child;
  };
  return { spawn, calls };
}

const user: Context = { isRoot: false, user: 'alice', home: '/home/alice' };
const root: Context = { isRoot: true, user: 'alice', home: '/home/alice' };

describe('script wrappers', () => {
  it('wrap root and user scripts like the bash script', () => {
    expect(rootScript('echo hi')).toBe('export DEBIAN_FRONTEND=noninteractive; set -e; echo hi');
    expect(userScript('echo hi')).toBe(`cd "$HOME"; ${USER_ENV} set -e; echo hi`);
  });
});

describe('ProcessRunner as a normal user', () => {
  afterEach(() => vi.useRealTimers());

  it('runs user steps in a login bash shell', async () => {
    const { spawn, calls } = fakeSpawn();
    await new ProcessRunner(user, { spawn }).asUser('echo hi', 'greet');
    expect(calls).toEqual([{ command: 'bash', args: ['-lc', userScript('echo hi')], stdio: 'inherit' }]);
  });

  it('validates sudo once, then runs root steps through sudo bash -c', async () => {
    const { spawn, calls } = fakeSpawn();
    const runner = new ProcessRunner(user, { spawn });
    await runner.asRoot('apt-get update', 'update');
    await runner.asRoot('true', 'second');
    runner.close();
    expect(calls).toEqual([
      { command: 'sudo', args: ['-v'], stdio: 'inherit' },
      { command: 'sudo', args: ['bash', '-c', rootScript('apt-get update')], stdio: 'inherit' },
      { command: 'sudo', args: ['bash', '-c', rootScript('true')], stdio: 'inherit' },
    ]);
  });

  it('refreshes the sudo timestamp every 60s until closed', async () => {
    vi.useFakeTimers();
    const { spawn, calls } = fakeSpawn();
    const runner = new ProcessRunner(user, { spawn });
    await runner.asRoot('true', 'step');
    calls.length = 0;
    vi.advanceTimersByTime(60_000);
    expect(calls).toEqual([{ command: 'sudo', args: ['-n', '-v'], stdio: 'ignore' }]);
    vi.advanceTimersByTime(60_000);
    expect(calls).toHaveLength(2);
    runner.close();
    runner.close();
    vi.advanceTimersByTime(180_000);
    expect(calls).toHaveLength(2);
  });

  it('ignores refresh failures', async () => {
    vi.useFakeTimers();
    let refreshThrows = false;
    const { spawn: base } = fakeSpawn((c) => (c.args[0] === '-n' ? new Error('ENOENT') : 0));
    const spawn: SpawnFn = (cmd, args, o) => {
      if (refreshThrows) throw new Error('spawn failed');
      return base(cmd, args, o);
    };
    const runner = new ProcessRunner(user, { spawn });
    await runner.asRoot('true', 'step');
    vi.advanceTimersByTime(60_000);
    await Promise.resolve();
    refreshThrows = true;
    expect(() => vi.advanceTimersByTime(60_000)).not.toThrow();
    runner.close();
  });

  it('fails the step when sudo authentication fails, and retries next time', async () => {
    let sudoOk = false;
    const { spawn, calls } = fakeSpawn((c) => (c.args[0] === '-v' && !sudoOk ? 1 : 0));
    const runner = new ProcessRunner(user, { spawn });
    await expect(runner.asRoot('true', 'step')).rejects.toMatchObject({
      label: 'sudo authentication',
      exitCode: 1,
    });
    sudoOk = true;
    await runner.asRoot('true', 'step');
    runner.close();
    expect(calls.map((c) => c.args[0])).toEqual(['-v', '-v', 'bash']);
  });
});

describe('ProcessRunner as root', () => {
  it('runs root steps with plain bash -c, no sudo', async () => {
    const { spawn, calls } = fakeSpawn();
    await new ProcessRunner(root, { spawn }).asRoot('apt-get update', 'update');
    expect(calls).toEqual([{ command: 'bash', args: ['-c', rootScript('apt-get update')], stdio: 'inherit' }]);
  });

  it('runs user steps through runuser with the target env', async () => {
    const { spawn, calls } = fakeSpawn();
    await new ProcessRunner(root, { spawn }).asUser('echo hi', 'greet');
    expect(calls).toEqual([
      {
        command: 'runuser',
        args: [
          '-u', 'alice', '--', 'env', 'HOME=/home/alice', 'USER=alice', 'LOGNAME=alice',
          'bash', '-lc', userScript('echo hi'),
        ],
        stdio: 'inherit',
      },
    ]);
  });
});

describe('ProcessRunner failures', () => {
  it('rejects with StepError carrying label and exit code', async () => {
    const { spawn } = fakeSpawn(() => 3);
    const err = await new ProcessRunner(root, { spawn }).asRoot('false', 'install go').catch((e) => e);
    expect(err).toBeInstanceOf(StepError);
    expect(err).toMatchObject({ label: 'install go', exitCode: 3 });
    expect(err.message).toBe('step failed: install go (exit code 3)');
  });

  it('reports spawn errors and signals', async () => {
    const { spawn } = fakeSpawn(() => new Error('spawn runuser ENOENT'));
    await expect(new ProcessRunner(root, { spawn }).asUser('x', 'u')).rejects.toThrow(
      'step failed: u (could not start: spawn runuser ENOENT)',
    );

    const throwing: SpawnFn = () => {
      throw new Error('boom');
    };
    await expect(new ProcessRunner(root, { spawn: throwing }).asRoot('x', 'r')).rejects.toMatchObject({
      exitCode: null,
    });

    const killed: SpawnFn = () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('close', null, 'SIGINT'));
      return child;
    };
    await expect(new ProcessRunner(root, { spawn: killed }).asRoot('x', 'r')).rejects.toThrow(
      'step failed: r (killed by SIGINT)',
    );
  });
});

describe('DryRunRunner', () => {
  it('prints labelled scripts and runs nothing', async () => {
    let out = '';
    const runner = new DryRunRunner({ write: (s: string) => (out += s) });
    await runner.asRoot('apt-get update\n', 'update apt');
    await runner.asUser('echo hi', 'greet');
    expect(out).toBe('[root] update apt\napt-get update\n\n[user] greet\necho hi\n\n');
  });
});

describe('RecordingRunner', () => {
  it('records calls and fails chosen labels', async () => {
    const runner = new RecordingRunner(new Set(['bad']));
    await runner.asRoot('a', 'one');
    await runner.asUser('b', 'two');
    await expect(runner.asUser('c', 'bad')).rejects.toBeInstanceOf(StepError);
    expect(runner.calls).toEqual([
      { as: 'root', script: 'a', label: 'one' },
      { as: 'user', script: 'b', label: 'two' },
      { as: 'user', script: 'c', label: 'bad' },
    ]);
  });
});
