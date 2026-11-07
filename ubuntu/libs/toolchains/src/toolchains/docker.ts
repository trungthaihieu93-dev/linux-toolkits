import { aptInstall, arch, osRelease, shQuote } from '@linux-toolchain/core';
import { installGithubBinary, latestRelease } from '../github-release';
import { choiceBool, choiceList } from '../options';
import type { InstallContext, Toolchain } from '../types';
import { requireApt, tryAddon } from './shared';

/** System probes docker.install reads; tests replace them (e.g. with vi.spyOn). */
export const dockerDeps = {
  osRelease: (): Record<string, string> => osRelease(),
  arch: (): 'amd64' | 'arm64' => arch(),
};

export interface DockerRepoTarget {
  distro: 'ubuntu' | 'debian';
  codename: string;
}

const CODENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Which download.docker.com repo fits this /etc/os-release, as install-toolchains.sh decides it. */
export function dockerRepoTarget(os: Record<string, string>): DockerRepoTarget {
  const id = os['ID'] ?? '';
  const like = ` ${os['ID_LIKE'] ?? ''} `;
  let target: DockerRepoTarget;
  if (id === 'ubuntu' || id === 'debian') {
    target = { distro: id, codename: os['VERSION_CODENAME'] ?? '' };
  } else if (like.includes(' ubuntu ')) {
    target = { distro: 'ubuntu', codename: os['UBUNTU_CODENAME'] ?? '' };
  } else if (like.includes(' debian ')) {
    target = {
      distro: 'debian',
      codename: os['DEBIAN_CODENAME'] || os['VERSION_CODENAME'] || '',
    };
  } else {
    throw new Error(
      `unsupported distro for Docker's apt repo: ${id || 'unknown'}`,
    );
  }
  if (!target.codename) throw new Error('could not determine distro codename');
  // The codename lands in an apt sources file; refuse anything that is not a plain word.
  if (!CODENAME_RE.test(target.codename))
    throw new Error(`invalid distro codename: ${target.codename}`);
  return target;
}

function warnLine(message: string): string {
  return `printf '\\033[1;33m[warn]\\033[0m %s\\n' ${shQuote(message)} >&2`;
}

function engineScript(
  { distro, codename }: DockerRepoTarget,
  systemd: boolean,
  groupUser?: string,
): string {
  const repo = `https://download.docker.com/linux/${distro}`;
  const lines = [
    "if dpkg -l docker.io 2>/dev/null | grep -q '^ii'; then",
    `  ${warnLine('docker.io is installed; installing docker-ce will replace it')}`,
    'fi',
    aptInstall(['ca-certificates', 'curl']),
    'install -m 0755 -d /etc/apt/keyrings',
    `curl -fsSL ${shQuote(`${repo}/gpg`)} -o /etc/apt/keyrings/docker.asc`,
    'chmod a+r /etc/apt/keyrings/docker.asc',
    'cat > /etc/apt/sources.list.d/docker.sources <<EOF',
    'Types: deb',
    `URIs: ${repo}`,
    `Suites: ${codename}`,
    'Components: stable',
    'Architectures: $(dpkg --print-architecture)',
    'Signed-By: /etc/apt/keyrings/docker.asc',
    'EOF',
    'apt-get update -y',
    'apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin',
  ];
  if (systemd) lines.push('systemctl enable --now docker');
  if (groupUser !== undefined)
    lines.push(`usermod -aG docker ${shQuote(groupUser)}`);
  lines.push('docker --version');
  return lines.join('\n');
}

interface AddonSpec {
  repo: string;
  /** Pinned tag used when the GitHub API cannot be reached. */
  fallback: string;
  archive: 'tar.gz' | 'raw';
  /** Release asset and checksum file names for a version without the leading `v`. */
  assets(
    version: string,
    cpu: 'amd64' | 'arm64',
  ): { asset: string; checksums: string };
}

/** Asset names verified against each project's latest release (lazydocker v0.25.2, dive v0.13.1, hadolint v2.15.1). */
const ADDONS: Record<string, AddonSpec> = {
  lazydocker: {
    repo: 'jesseduffield/lazydocker',
    fallback: 'v0.25.2',
    archive: 'tar.gz',
    assets: (v, cpu) => ({
      asset: `lazydocker_${v}_Linux_${cpu === 'amd64' ? 'x86_64' : 'arm64'}.tar.gz`,
      checksums: 'checksums.txt',
    }),
  },
  dive: {
    repo: 'wagoodman/dive',
    fallback: 'v0.13.1',
    archive: 'tar.gz',
    assets: (v, cpu) => ({
      asset: `dive_${v}_linux_${cpu}.tar.gz`,
      checksums: `dive_${v}_checksums.txt`,
    }),
  },
  hadolint: {
    repo: 'hadolint/hadolint',
    fallback: 'v2.15.1',
    archive: 'raw',
    // checksums.sha256 holds `<sha256> *<asset>` lines; installGithubBinary strips the `*`.
    assets: (_v, cpu) => ({
      asset: `hadolint-linux-${cpu === 'amd64' ? 'x86_64' : 'arm64'}`,
      checksums: 'checksums.sha256',
    }),
  },
};

async function installAddon(
  ic: InstallContext,
  name: string,
  cpu: 'amd64' | 'arm64',
): Promise<void> {
  const spec = ADDONS[name];
  if (!spec) throw new Error(`unknown add-on: ${name}`);
  const tag = await latestRelease(spec.repo, spec.fallback, ic.fetch, {
    onWarn: (m) => ic.warn(m),
  });
  const { asset, checksums } = spec.assets(tag.replace(/^v/, ''), cpu);
  const base = `https://github.com/${spec.repo}/releases/download/${tag}`;
  const script = installGithubBinary({
    url: `${base}/${asset}`,
    sha256Url: `${base}/${checksums}`,
    binName: name,
    archive: spec.archive,
  });
  await ic.runner.asRoot(script, `docker: ${name}`);
}

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
    {
      key: 'group',
      kind: 'confirm',
      label: 'Add the user to the docker group',
      default: true,
    },
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
  async install(ic, choices) {
    requireApt(ic, 'docker');
    const group = choiceBool(choices, 'group');
    const addons = choiceList(choices, 'addons');
    const target = dockerRepoTarget(dockerDeps.osRelease());

    ic.logger.log(
      `Adding Docker apt repo (${target.distro} ${target.codename})`,
    );
    const systemd = ic.exists('/run/systemd/system');
    if (!systemd) ic.warn('systemd not running; start dockerd manually');
    await ic.runner.asRoot(
      engineScript(target, systemd, group ? ic.ctx.user : undefined),
      'docker: engine',
    );

    if (addons.length === 0) return;
    const cpu = dockerDeps.arch();
    for (const name of addons) {
      await tryAddon(ic, `docker add-on ${name}`, () =>
        installAddon(ic, name, cpu),
      );
    }
  },
};
