import { resolveSelection } from './selection';
import type { Choices, Probes, Toolchain } from './types';

function probes(opts: { bun?: boolean; jdk?: boolean } = {}): Probes & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    ctx: { isRoot: true, user: 'alice', home: '/home/alice' },
    exists: (path) => {
      calls.push(`exists ${path}`);
      return opts.bun === true && path === '/home/alice/.bun/bin/bun';
    },
    listDir: (path) => {
      calls.push(`listDir ${path}`);
      return path === '/usr/lib/jvm' && opts.jdk ? ['default-java', 'java-21-openjdk-amd64'] : ['default-java'];
    },
  };
}

const none = new Map<string, Choices>();

describe('resolveSelection', () => {
  it('returns catalog order without duplicates', async () => {
    const sel = await resolveSelection(['docker', 'go', 'go', 'claude'], none, probes());
    expect(sel).toEqual({ ids: ['go', 'docker', 'claude'], notes: [] });
  });

  it('adds nvm-bun for bun-tools when bun is missing', async () => {
    const p = probes();
    const sel = await resolveSelection(['bun-tools'], none, p);
    expect(sel.ids).toEqual(['nvm-bun', 'bun-tools']);
    expect(sel.notes).toEqual(['adding nvm-bun (required by bun-tools, not found for alice)']);
    expect(p.calls).toContain('exists /home/alice/.bun/bin/bun');
  });

  it('skips nvm-bun when bun exists in the target home', async () => {
    const sel = await resolveSelection(['bun-tools'], none, probes({ bun: true }));
    expect(sel).toEqual({ ids: ['bun-tools'], notes: [] });
  });

  it('adds java for jenv only when no JDK is in /usr/lib/jvm', async () => {
    expect((await resolveSelection(['jenv'], none, probes())).ids).toEqual(['java', 'jenv']);
    expect((await resolveSelection(['jenv'], none, probes({ jdk: true }))).ids).toEqual(['jenv']);
  });

  it('does not probe when the requirement is already selected', async () => {
    const p = probes();
    const sel = await resolveSelection(['jenv', 'java'], none, p);
    expect(sel).toEqual({ ids: ['java', 'jenv'], notes: [] });
    expect(p.calls).toEqual([]);
  });

  it('flutter add-on android-sdk selects android', async () => {
    const choices = new Map<string, Choices>([['flutter', { addons: ['android-sdk', 'fvm'] }]]);
    const sel = await resolveSelection(['flutter'], choices, probes());
    expect(sel.ids).toEqual(['flutter', 'android']);
    expect(sel.notes).toEqual(['adding android (selected by the flutter add-on android-sdk)']);
  });

  it('java add-on jenv selects jenv', async () => {
    const choices = new Map<string, Choices>([['java', { addons: ['jenv'] }]]);
    const sel = await resolveSelection(['java'], choices, probes());
    expect(sel.ids).toEqual(['java', 'jenv']);
  });

  it('default add-ons do not pull in extra components', async () => {
    const sel = await resolveSelection(['flutter', 'java'], none, probes());
    expect(sel).toEqual({ ids: ['java', 'flutter'], notes: [] });
  });

  it('rejects unknown ids, listing valid ones', async () => {
    await expect(resolveSelection(['kotlin'], none, probes())).rejects.toThrow(
      'unknown component: kotlin (valid: nvm-bun, bun-tools, go,',
    );
  });

  it('cascades through a custom catalog and reports bad requires', async () => {
    const stub = { label: 'x', description: 'x', options: [], install: async () => undefined };
    const custom: Toolchain[] = [
      { ...stub, id: 'a' },
      { ...stub, id: 'b', requires: ['a'] },
      {
        ...stub,
        id: 'c',
        addonImplies: { extra: 'b' },
        options: [
          { key: 'addons', kind: 'multi', label: 'x', choices: [{ value: 'extra', label: 'x' }], default: ['extra'] },
        ],
      },
    ];
    expect((await resolveSelection(['c'], none, probes(), custom)).ids).toEqual(['a', 'b', 'c']);
    await expect(
      resolveSelection(['z'], none, probes(), [{ ...stub, id: 'z', requires: ['y'] }]),
    ).rejects.toThrow('z requires unknown component y');
  });
});
