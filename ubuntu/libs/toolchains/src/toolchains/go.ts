import type { Toolchain } from '../types';

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
      choices: [{ value: 'latest', label: 'Latest stable', hint: 'go.dev/VERSION' }],
      default: 'latest',
    },
    {
      key: 'addons',
      kind: 'multi',
      label: 'Add-ons',
      choices: [
        { value: 'gopls', label: 'gopls', hint: 'language server' },
        { value: 'golangci-lint', label: 'golangci-lint', hint: 'linter aggregator' },
        { value: 'delve', label: 'delve', hint: 'debugger (dlv)' },
      ],
      default: ['gopls', 'golangci-lint'],
    },
  ],
  async install() {
    throw new Error('not implemented');
  },
};
