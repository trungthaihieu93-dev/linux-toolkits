import { arch, writeProfile } from '@linux-toolchain/core';
import { installGithubBinary, latestRelease } from '../github-release';
import { choiceList, choiceString } from '../options';
import type { InstallContext, Toolchain } from '../types';
import { tryAddon } from './shared';

/** Used when the GitHub API lookup for golangci-lint fails. */
export const GOLANGCI_LINT_FALLBACK_TAG = 'v2.15.0';

/** Puts the Go toolchain and the user's ~/go/bin on PATH (same as the bash script). */
const GO_PROFILE =
  'case ":$PATH:" in *:/usr/local/go/bin:*) ;; *) export PATH="$PATH:/usr/local/go/bin:$HOME/go/bin" ;; esac';

/** Root script: download the latest Go tarball from go.dev and replace /usr/local/go. */
const GO_INSTALL = [
  'case "$(uname -m)" in',
  '  x86_64) arch=amd64 ;;',
  '  aarch64|arm64) arch=arm64 ;;',
  '  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;',
  'esac',
  "ver=$(curl -fsSL 'https://go.dev/VERSION?m=text' | sed -n 1p)",
  'case "$ver" in go*) ;; *) echo "could not determine latest Go version" >&2; exit 1 ;; esac',
  'echo "Installing $ver ($arch)"',
  'tmp=$(mktemp -d)',
  `trap 'rm -rf "$tmp"' EXIT`,
  'curl -fsSL "https://go.dev/dl/${ver}.linux-${arch}.tar.gz" -o "$tmp/go.tgz"',
  'rm -rf /usr/local/go',
  'tar -C /usr/local -xzf "$tmp/go.tgz"',
  '/usr/local/go/bin/go version',
].join('\n');

/** `go install` as the user; Go itself is not on PATH yet in a fresh login shell. */
function goInstall(pkg: string): string {
  return [
    'export PATH="/usr/local/go/bin:$HOME/go/bin:$PATH"',
    `go install ${pkg}@latest`,
  ].join('\n');
}

async function golangciLintScript(ic: InstallContext): Promise<string> {
  const tag = await latestRelease(
    'golangci/golangci-lint',
    GOLANGCI_LINT_FALLBACK_TAG,
    ic.fetch,
    {
      onWarn: (message) => ic.warn(`go: ${message}`),
    },
  );
  const version = tag.replace(/^v/, '');
  const name = `golangci-lint-${version}-linux-${arch()}`;
  const base = `https://github.com/golangci/golangci-lint/releases/download/${tag}`;
  return [
    installGithubBinary({
      url: `${base}/${name}.tar.gz`,
      sha256Url: `${base}/golangci-lint-${version}-checksums.txt`,
      binName: 'golangci-lint',
      archive: 'tar.gz',
      innerPath: `${name}/golangci-lint`,
    }),
    '/usr/local/bin/golangci-lint --version',
  ].join('\n');
}

/**
 * Option keys:
 * - version select latest                              (default latest; from go.dev/VERSION)
 * - addons  multi  gopls | golangci-lint | delve       (default [gopls, golangci-lint])
 *   gopls/delve via `go install ...@latest` as the user; golangci-lint from its GitHub release.
 */
export const go: Toolchain = {
  id: 'go',
  label: 'Go',
  description: 'latest Go tarball -> /usr/local/go',
  options: [
    {
      key: 'version',
      kind: 'select',
      label: 'Go version',
      choices: [
        { value: 'latest', label: 'Latest stable', hint: 'go.dev/VERSION' },
      ],
      default: 'latest',
    },
    {
      key: 'addons',
      kind: 'multi',
      label: 'Add-ons',
      choices: [
        { value: 'gopls', label: 'gopls', hint: 'language server' },
        {
          value: 'golangci-lint',
          label: 'golangci-lint',
          hint: 'linter aggregator',
        },
        { value: 'delve', label: 'delve', hint: 'debugger (dlv)' },
      ],
      default: ['gopls', 'golangci-lint'],
    },
  ],
  async install(ic, choices) {
    const version = choiceString(choices, 'version');
    if (version !== 'latest')
      throw new Error(`go: unsupported version choice: ${version}`);
    const addons = choiceList(choices, 'addons');

    ic.logger.log('Installing Go (latest)');
    await ic.runner.asRoot(GO_INSTALL, 'go: download + install');
    await ic.runner.asRoot(writeProfile('go', GO_PROFILE), 'go: profile');

    for (const name of addons) {
      const label = `go: ${name}`;
      switch (name) {
        case 'gopls':
          await tryAddon(ic, `go: add-on ${name}`, () =>
            ic.runner.asUser(goInstall('golang.org/x/tools/gopls'), label),
          );
          break;
        case 'delve':
          await tryAddon(ic, `go: add-on ${name}`, () =>
            ic.runner.asUser(
              goInstall('github.com/go-delve/delve/cmd/dlv'),
              label,
            ),
          );
          break;
        case 'golangci-lint':
          await tryAddon(ic, `go: add-on ${name}`, async () =>
            ic.runner.asRoot(await golangciLintScript(ic), label),
          );
          break;
        default:
          throw new Error(`go: unknown add-on: ${name}`);
      }
    }
  },
};
