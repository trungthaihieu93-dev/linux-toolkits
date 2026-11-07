import type { Toolchain } from '../types';

/**
 * Option keys:
 * - group  confirm add the target user to the `docker` group   (default true)
 * - addons multi   lazydocker | dive | hadolint                (default [lazydocker])
 *   latest GitHub release binaries -> /usr/local/bin (installGithubBinary).
 */
export const docker: Toolchain = {
  id: 'docker',
  label: 'Docker Engine',
  description: "docker-ce, buildx, compose from Docker's official apt repo",
  options: [
    { key: 'group', kind: 'confirm', label: 'Add the user to the docker group', default: true },
    {
      key: 'addons',
      kind: 'multi',
      label: 'Add-ons',
      choices: [
        { value: 'lazydocker', label: 'lazydocker', hint: 'terminal UI' },
        { value: 'dive', label: 'dive', hint: 'image layer explorer' },
        { value: 'hadolint', label: 'hadolint', hint: 'Dockerfile linter' },
      ],
      default: ['lazydocker'],
    },
  ],
  async install() {
    throw new Error('not implemented');
  },
};
