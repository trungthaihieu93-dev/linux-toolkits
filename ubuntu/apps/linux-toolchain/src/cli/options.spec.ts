import { catalog } from '@linux-toolchain/toolchains';
import { parseRunConfig, UsageError } from './options';

const allIds = catalog.map((t) => t.id);

describe('parseRunConfig', () => {
  it('returns no ids (ask) when nothing is selected', () => {
    const config = parseRunConfig([], {});
    expect(config).toMatchObject({
      ids: [],
      defaults: false,
      yes: false,
      dryRun: false,
      user: undefined,
    });
    expect(config.overrides.size).toBe(0);
  });

  it('selects every toolchain with --all', () => {
    expect(parseRunConfig([], { all: true }).ids).toEqual(allIds);
  });

  it('treats --only and positional ids the same, in catalog order', () => {
    const fromOnly = parseRunConfig([], { only: 'java,go' }).ids;
    const fromPositional = parseRunConfig(['java', 'go'], {}).ids;
    const fromCommaPositional = parseRunConfig(['java,go'], {}).ids;
    expect(fromOnly).toEqual(['go', 'java']);
    expect(fromPositional).toEqual(fromOnly);
    expect(fromCommaPositional).toEqual(fromOnly);
  });

  it('merges positional ids with --only and drops duplicates', () => {
    expect(parseRunConfig(['docker', 'go'], { only: 'go,rust' }).ids).toEqual([
      'go',
      'rust',
      'docker',
    ]);
  });

  it('rejects --all combined with ids or --only', () => {
    expect(() => parseRunConfig(['go'], { all: true })).toThrow(UsageError);
    expect(() => parseRunConfig([], { all: true, only: 'go' })).toThrow(
      /--all cannot be combined/,
    );
  });

  it('rejects unknown ids and lists the valid ones', () => {
    const run = () => parseRunConfig(['go', 'cobol'], {});
    expect(run).toThrow(UsageError);
    expect(run).toThrow(
      `unknown toolchain: cobol (valid: ${allIds.join(', ')})`,
    );
  });

  it('rejects an empty --only', () => {
    expect(() => parseRunConfig([], { only: ' , ' })).toThrow(
      /--only needs a comma-separated list/,
    );
  });

  it('parses repeatable --opt values into overrides', () => {
    const config = parseRunConfig(['java'], {
      opt: ['java.jdk=17,21', 'java.addons=maven,gradle', 'docker.group=no'],
    });
    expect(config.overrides.get('java')).toEqual({
      jdk: ['17', '21'],
      addons: ['maven', 'gradle'],
    });
    expect(config.overrides.get('docker')).toEqual({ group: false });
  });

  it('turns --opt errors into usage errors', () => {
    expect(() => parseRunConfig([], { opt: ['java.jdk=11'] })).toThrow(
      UsageError,
    );
    expect(() => parseRunConfig([], { opt: ['nope'] })).toThrow(
      /expected id.key=value/,
    );
  });

  it('passes through --defaults, --user, -y and --dry-run', () => {
    expect(
      parseRunConfig(['go'], {
        defaults: true,
        user: ' alice ',
        yes: true,
        dryRun: true,
      }),
    ).toMatchObject({ defaults: true, user: 'alice', yes: true, dryRun: true });
    expect(() => parseRunConfig(['go'], { user: ' ' })).toThrow(
      /--user needs a user name/,
    );
  });
});
