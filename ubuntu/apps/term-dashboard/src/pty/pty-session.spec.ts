import { createActivityBus } from '../exec/activity-bus';
import {
  ProcessCommandRunner,
  type CommandRunner,
} from '../exec/command-runner';
import {
  createSandbox,
  haveBinaries,
  pgrepSession,
  until,
  type Sandbox,
} from '../testing/sandbox';
import { parseProcStat, sessionPids } from './process-tree';
import { ptyArgv, PtySession, SCRIPT_COMMAND } from './pty-session';

const ready = await haveBinaries('script', 'setpriv', 'stty', 'pgrep');

describe('ptyArgv', () => {
  it('never interpolates the shell into the command', () => {
    expect(ptyArgv()).toEqual([
      'setpriv',
      '--pdeathsig',
      'HUP',
      '--',
      'script',
      '-qfec',
      SCRIPT_COMMAND,
      '/dev/null',
    ]);
    expect(SCRIPT_COMMAND).toBe('exec "$TD_SHELL" -il');
  });
});

describe('parseProcStat', () => {
  it('reads ppid, pgrp and session past a command name with spaces', () => {
    expect(parseProcStat('42 (a b) c) S 1 40 41 0 -1')).toEqual({
      pid: 42,
      ppid: 1,
      pgrp: 40,
      session: 41,
    });
    expect(parseProcStat('garbage')).toBeNull();
  });
});

describe.skipIf(!ready)('PtySession (real pty via script)', () => {
  let sbx: Sandbox;
  let session: PtySession | null = null;

  beforeEach(async () => {
    sbx = await createSandbox('td-pty-');
  });
  afterEach(async () => {
    await session?.close();
    session = null;
    await sbx.cleanup();
  });

  function start(onExit = vi.fn(), runner?: CommandRunner) {
    let out = '';
    runner ??= new ProcessCommandRunner(createActivityBus(), sbx.env);
    session = new PtySession({
      shell: '/bin/sh',
      cwd: sbx.home,
      env: { ...sbx.env, PS1: '$ ' },
      cols: 80,
      rows: 24,
      runner,
      onData: (d) => {
        out += d.toString();
      },
      onExit,
    });
    return { s: session, output: () => out, onExit };
  }

  it('runs commands, resizes, and kills background jobs on close', async () => {
    const { s, output } = start();
    const sid = await s.ready;
    expect(s.sid).toBe(sid);
    s.write('echo $((6*7))\n');
    await until(() => /\b42\b/.test(output()), 5000, '42');

    await s.resize(132, 43);
    s.write('stty size\n');
    await until(() => output().includes('43 132'), 5000, 'stty size');

    s.write('sleep 300 &\n');
    await until(
      async () => (await sessionPids(sid)).length >= 2,
      5000,
      'background job',
    );
    expect(pgrepSession(sid)).toBe(0);

    await s.close();
    await until(() => pgrepSession(sid) === 1, 3000, 'session gone');
    expect(pgrepSession(sid)).toBe(1);
  });

  it('cleans up background jobs when the shell exits by itself', async () => {
    const { s, onExit } = start();
    const sid = await s.ready;
    s.write('sleep 300 &\n');
    await until(
      async () => (await sessionPids(sid)).length >= 2,
      5000,
      'background job',
    );
    s.write('exit 3\n');
    await until(() => onExit.mock.calls.length > 0, 5000, 'exit');
    expect(onExit).toHaveBeenCalledWith(3, null);
    await until(() => pgrepSession(sid) === 1, 3000, 'session gone');
  });

  it('rejects invalid sizes', async () => {
    const { s } = start();
    await s.ready;
    await expect(s.resize(0, 10)).rejects.toThrow('invalid terminal size');
    await expect(s.resize(80, 1.5)).rejects.toThrow('invalid terminal size');
  });

  it('coalesces a drag of resizes into a few stty calls ending at the last size', async () => {
    const inner = new ProcessCommandRunner(createActivityBus(), sbx.env);
    const stty: string[][] = [];
    const runner: CommandRunner = {
      run: (argv, opts) => {
        if (argv[0] === 'stty') stty.push([...argv]);
        return inner.run(argv, opts);
      },
    };
    const { s, output } = start(vi.fn(), runner);
    await s.ready;
    const before = stty.length;
    const pending: Promise<void>[] = [];
    // A window drag: a new size every 15 ms for 300 ms.
    for (let cols = 101; cols <= 120; cols++) {
      pending.push(s.resize(cols, 30));
      await new Promise((r) => setTimeout(r, 15));
    }
    await Promise.all(pending);
    expect(stty.length - before).toBeLessThanOrEqual(4);
    expect(stty.at(-1)?.slice(-4)).toEqual(['cols', '120', 'rows', '30']);
    s.write('stty size\n');
    await until(() => output().includes('30 120'), 5000, 'stty size');
  });
});
