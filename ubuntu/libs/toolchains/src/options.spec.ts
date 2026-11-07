import { getToolchain } from './catalog';
import { choiceBool, choiceList, choiceString, defaultsFor, mergeChoices, parseOpts } from './options';
import type { Toolchain } from './types';

function tc(id: string): Toolchain {
  const t = getToolchain(id);
  if (!t) throw new Error(`missing ${id}`);
  return t;
}

describe('parseOpts', () => {
  it('parses multi, select and confirm values', () => {
    const result = parseOpts(['java.jdk=25, 17', 'go.addons=gopls', 'nvm-bun.node=current', 'nvm-bun.bun=no']);
    expect(result.get('java')).toEqual({ jdk: ['17', '25'] });
    expect(result.get('go')).toEqual({ addons: ['gopls'] });
    expect(result.get('nvm-bun')).toEqual({ node: 'current', bun: false });
  });

  it('accepts true/false/yes/no for confirm options', () => {
    expect(parseOpts(['docker.group=YES']).get('docker')).toEqual({ group: true });
    expect(parseOpts(['docker.group=false']).get('docker')).toEqual({ group: false });
  });

  it('dedupes multi values, allows an empty list, later entries win', () => {
    expect(parseOpts(['docker.addons=dive,dive']).get('docker')).toEqual({ addons: ['dive'] });
    expect(parseOpts(['docker.addons=']).get('docker')).toEqual({ addons: [] });
    expect(parseOpts(['go.addons=gopls', 'go.addons=delve']).get('go')).toEqual({ addons: ['delve'] });
  });

  it('accepts values containing @ and /', () => {
    expect(parseOpts(['bun-tools.packages=@nestjs/cli,nx']).get('bun-tools')).toEqual({
      packages: ['nx', '@nestjs/cli'],
    });
  });

  it('rejects malformed entries', () => {
    expect(() => parseOpts(['java'])).toThrow('invalid option "java" (expected id.key=value');
    expect(() => parseOpts(['java=17'])).toThrow('expected id.key=value');
  });

  it('rejects unknown toolchains and keys, listing valid ones', () => {
    expect(() => parseOpts(['kotlin.x=1'])).toThrow('unknown toolchain in option "kotlin.x=1": kotlin (valid: nvm-bun,');
    expect(() => parseOpts(['java.vendor=x'])).toThrow('unknown option for java: vendor (valid: jdk, default, addons)');
    expect(() => parseOpts(['claude.x=1'])).toThrow('unknown option for claude: x (claude has no options)');
  });

  it('rejects invalid values, listing valid ones', () => {
    expect(() => parseOpts(['java.jdk=11'])).toThrow('invalid value for java.jdk: "11" (valid: 17, 21, 25)');
    expect(() => parseOpts(['rust.toolchain=dev'])).toThrow('valid: stable, beta, nightly');
    expect(() => parseOpts(['docker.group=maybe'])).toThrow('valid: true, false, yes, no');
  });

  it('enforces the minimum count of a multi option', () => {
    expect(() => parseOpts(['java.jdk='])).toThrow('java.jdk needs at least 1 value(s)');
  });

  it('uses a custom catalog when given', () => {
    expect(() => parseOpts(['go.addons=gopls'], [])).toThrow('unknown toolchain');
  });
});

describe('defaultsFor / mergeChoices', () => {
  it('builds defaults from every option', () => {
    expect(defaultsFor(tc('java'))).toEqual({ jdk: ['21'], default: '21', addons: ['maven', 'gradle'] });
    expect(defaultsFor(tc('claude'))).toEqual({});
  });

  it('returns fresh arrays', () => {
    const a = defaultsFor(tc('go'));
    choiceList(a, 'addons').push('delve');
    expect(defaultsFor(tc('go'))['addons']).toEqual(['gopls', 'golangci-lint']);
  });

  it('overrides replace defaults key by key', () => {
    expect(mergeChoices({ a: 'x', b: ['1'] }, { b: [] })).toEqual({ a: 'x', b: [] });
    expect(mergeChoices({ a: 'x' })).toEqual({ a: 'x' });
  });
});

describe('typed accessors', () => {
  const choices = { s: 'v', l: ['a'], b: true };

  it('return values of the right kind', () => {
    expect(choiceString(choices, 's')).toBe('v');
    expect(choiceList(choices, 'l')).toEqual(['a']);
    expect(choiceBool(choices, 'b')).toBe(true);
  });

  it('throw on missing or mistyped keys', () => {
    expect(() => choiceString(choices, 'l')).toThrow('option l: expected a single value');
    expect(() => choiceList(choices, 'missing')).toThrow('option missing: expected a list');
    expect(() => choiceBool(choices, 's')).toThrow('option s: expected true/false');
  });
});
