import type { Toolchain } from '../types';

/** No options: native installer, latest release, as the target user. */
export const claude: Toolchain = {
  id: 'claude',
  label: 'Claude Code CLI',
  description: 'native installer, latest release',
  options: [],
  async install() {
    throw new Error('not implemented');
  },
};
