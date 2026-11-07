import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PROFILE_HOOK_LINE,
  PROFILE_HOOK_MARKER,
  addRcBlock,
  aptInstall,
  profilePath,
  rcBlockEnd,
  rcBlockStart,
  shQuote,
  writeProfile,
} from './shell';
import { rootScript, userScript } from './runner';

const hasBash = spawnSync('bash', ['--version']).status === 0;

describe('shQuote', () => {
  it('wraps plain values in single quotes', () => {
    expect(shQuote('abc')).toBe("'abc'");
    expect(shQuote('')).toBe("''");
  });

  it('escapes embedded single quotes', () => {
    expect(shQuote("it's")).toBe(`'it'\\''s'`);
  });

  it.skipIf(!hasBash)('round-trips hostile values through bash', () => {
    const value = `a b'c"$HOME\`id\`;\n\\x`;
    const out = spawnSync('bash', ['-c', `printf '%s' ${shQuote(value)}`], { encoding: 'utf8' });
    expect(out.stdout).toBe(value);
  });
});

describe('markers match install-toolchains.sh', () => {
  it('uses the same rc block, profile and hook text', () => {
    expect(rcBlockStart('pyenv')).toBe('# >>> pyenv >>>');
    expect(rcBlockEnd('pyenv')).toBe('# <<< pyenv <<<');
    expect(profilePath('go')).toBe('/etc/profile.d/devtools-go.sh');
    expect(PROFILE_HOOK_MARKER).toBe('# devtools-profile-hook');
    expect(PROFILE_HOOK_LINE).toBe(
      'for _f in /etc/profile.d/devtools-*.sh; do [ -r "$_f" ] && . "$_f"; done; unset _f',
    );
  });
});

describe('aptInstall', () => {
  it('builds the bulk-then-per-package fallback', () => {
    expect(aptInstall(['gcc', 'libstdc++-14-dev'])).toBe(
      [
        "if ! apt-get install -y --no-install-recommends 'gcc' 'libstdc++-14-dev'; then",
        "  printf '\\033[1;33m[warn]\\033[0m %s\\n' 'bulk install failed, retrying package by package' >&2",
        "  for p in 'gcc' 'libstdc++-14-dev'; do",
        `    apt-get install -y --no-install-recommends "$p" || printf '\\033[1;33m[warn]\\033[0m %s\\n' "skipped: $p" >&2`,
        '  done',
        'fi',
      ].join('\n'),
    );
  });

  it('rejects an empty package list', () => {
    expect(() => aptInstall([])).toThrow(/at least one package/);
  });
});

describe('addRcBlock', () => {
  it('builds the marked block without a skip regex', () => {
    expect(addRcBlock('pyenv', 'export PYENV_ROOT="$HOME/.pyenv"\n')).toBe(
      [
        'for f in "$HOME/.bashrc" "$HOME/.zshrc"; do',
        '  [ -f "$f" ] || continue',
        `  grep -qF '# >>> pyenv >>>' "$f" && continue`,
        `  printf '\\n# >>> %s >>>\\n%s\\n# <<< %s <<<\\n' 'pyenv' 'export PYENV_ROOT="$HOME/.pyenv"' 'pyenv' >> "$f"`,
        'done',
      ].join('\n'),
    );
  });

  it('adds the skip regex check when given', () => {
    expect(addRcBlock('jenv', 'eval "$(jenv init -)"', 'jenv init')).toContain(
      `  grep -qE 'jenv init' "$f" && continue\n`,
    );
  });

  it('rejects names that are not simple identifiers', () => {
    expect(() => addRcBlock('a b', 'x')).toThrow(/invalid snippet name/);
    expect(() => addRcBlock('../x', 'x')).toThrow(/invalid snippet name/);
  });

  describe.skipIf(!hasBash)('when executed', () => {
    let home: string;
    beforeEach(() => {
      home = mkdtempSync(join(tmpdir(), 'core-rc-'));
    });
    afterEach(() => rmSync(home, { recursive: true, force: true }));

    const run = (script: string) => {
      const res = spawnSync('bash', ['-c', `set -e; ${script}`], {
        env: { ...process.env, HOME: home },
        encoding: 'utf8',
      });
      expect(res.status, res.stderr).toBe(0);
    };

    it('appends once to existing files, skips missing and matching ones', () => {
      writeFileSync(join(home, '.bashrc'), 'existing\n');
      run(addRcBlock('pyenv', 'line1\nline2\n'));
      run(addRcBlock('pyenv', 'line1\nline2\n'));
      // Same bytes the bash script's printf produces.
      expect(readFileSync(join(home, '.bashrc'), 'utf8')).toBe(
        'existing\n\n# >>> pyenv >>>\nline1\nline2\n# <<< pyenv <<<\n',
      );

      writeFileSync(join(home, '.zshrc'), 'eval "$(jenv init -)"\n');
      run(addRcBlock('jenv', 'x', 'jenv init'));
      expect(readFileSync(join(home, '.zshrc'), 'utf8')).toBe('eval "$(jenv init -)"\n');
      expect(readFileSync(join(home, '.bashrc'), 'utf8')).toContain('# >>> jenv >>>\nx\n# <<< jenv <<<\n');
    });
  });
});

describe('writeProfile', () => {
  it('writes the profile.d file and the hook', () => {
    expect(writeProfile('go', 'export PATH="/usr/local/go/bin:$PATH"\n')).toBe(
      [
        'install -d /etc/profile.d',
        `printf '%s\\n' 'export PATH="/usr/local/go/bin:$PATH"' > '/etc/profile.d/devtools-go.sh'`,
        `chmod 644 '/etc/profile.d/devtools-go.sh'`,
        'for f in /etc/bash.bashrc /etc/zsh/zshrc; do',
        '  [ -f "$f" ] || continue',
        `  grep -qF '# devtools-profile-hook' "$f" && continue`,
        `  printf '%s\\n' '# devtools-profile-hook' 'for _f in /etc/profile.d/devtools-*.sh; do [ -r "$_f" ] && . "$_f"; done; unset _f' >> "$f"`,
        'done',
      ].join('\n'),
    );
  });

  it('rejects unsafe names', () => {
    expect(() => writeProfile('go/../x', 'x')).toThrow(/invalid snippet name/);
  });
});

describe.skipIf(!hasBash)('bash -n on every builder output', () => {
  const samples: Record<string, string> = {
    aptInstall: aptInstall(['gcc', "odd'name"]),
    addRcBlock: addRcBlock('pyenv', 'export A="$HOME"\neval "$(pyenv init -)"'),
    addRcBlockSkip: addRcBlock('jenv', "it's", 'jenv (init|enable)'),
    writeProfile: writeProfile('flutter', 'export PATH="/opt/flutter/bin:$PATH"\n# it\'s fine'),
    rootScript: rootScript(aptInstall(['make'])),
    userScript: userScript(addRcBlock('x', 'y')),
  };

  it.each(Object.entries(samples))('%s parses', (_name, script) => {
    const res = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' });
    expect(res.status, res.stderr).toBe(0);
  });
});
