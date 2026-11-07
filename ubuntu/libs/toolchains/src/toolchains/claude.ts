import type { Toolchain } from '../types';

/** No options: native installer, latest release, as the target user. */
export const claude: Toolchain = {
  id: 'claude',
  label: 'Claude Code CLI',
  description: 'native installer, latest release',
  options: [],
  async install(ic) {
    ic.logger.log('Installing Claude Code (native installer, latest)');
    await ic.runner.asUser(
      'curl -fsSL https://claude.ai/install.sh | bash; claude --version',
      'claude: native installer',
    );
  },
};
