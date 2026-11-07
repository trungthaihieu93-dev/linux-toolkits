import { arch, hasApt, hasCommand, isLinux, osRelease } from './system';

describe('isLinux', () => {
  it('checks the platform', () => {
    expect(isLinux('linux')).toBe(true);
    expect(isLinux('darwin')).toBe(false);
  });
});

describe('hasCommand / hasApt', () => {
  it('searches PATH entries', () => {
    const seen: string[] = [];
    const exec = (f: string) => (seen.push(f), f === '/usr/bin/apt-get');
    expect(hasCommand('apt-get', '/bin::/usr/bin', exec)).toBe(true);
    expect(seen).toEqual(['/bin/apt-get', '/usr/bin/apt-get']);
    expect(hasCommand('nope', '/bin:/usr/bin', exec)).toBe(false);
    expect(hasCommand('apt-get', '', exec)).toBe(false);
    expect(hasCommand('', '/usr/bin', exec)).toBe(false);
    expect(hasCommand('../x', '/usr/bin', exec)).toBe(false);
  });

  it('finds real commands with the default checker', () => {
    expect(hasCommand('sh')).toBe(true);
    expect(hasCommand('definitely-not-a-command-xyz')).toBe(false);
  });

  it('hasApt looks for apt-get', () => {
    expect(hasApt((c) => c === 'apt-get')).toBe(true);
    expect(hasApt(() => false)).toBe(false);
    expect(typeof hasApt()).toBe('boolean');
  });
});

describe('osRelease', () => {
  it('parses quoted and unquoted values, skipping comments', () => {
    const text = [
      '# comment',
      'NAME="Ubuntu"',
      'ID=ubuntu',
      "ID_LIKE='debian'",
      'VERSION_CODENAME=noble',
      'PRETTY_NAME="Say \\"hi\\""',
      '',
      'garbage',
    ].join('\n');
    expect(osRelease(() => text)).toEqual({
      NAME: 'Ubuntu',
      ID: 'ubuntu',
      ID_LIKE: 'debian',
      VERSION_CODENAME: 'noble',
      PRETTY_NAME: 'Say "hi"',
    });
  });
});

describe('arch', () => {
  it('maps kernel machine names', () => {
    expect(arch('x86_64')).toBe('amd64');
    expect(arch('aarch64')).toBe('arm64');
    expect(arch('arm64')).toBe('arm64');
    expect(() => arch('riscv64')).toThrow('unsupported architecture: riscv64');
  });
});
