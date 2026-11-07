import { aptInstall, shQuote } from '@linux-toolchain/core';
import { choiceList, choiceString } from '../options';
import type { InstallContext, Toolchain } from '../types';
import { hasAptProbe, tryAddon } from './shared';

/** rustc needs a system linker; the rest covers common -sys crates. */
const BUILD_DEPS = [
  'build-essential',
  'pkg-config',
  'libssl-dev',
  'curl',
  'ca-certificates',
];

/**
 * Option keys:
 * - toolchain  select stable | beta | nightly                 (default stable)
 * - components multi  clippy | rustfmt | rust-analyzer        (default: all)
 * - addons     multi  cargo-nextest | cargo-watch | cargo-edit (default [cargo-nextest])
 *   add-ons via `cargo install --locked`.
 */
export const rust: Toolchain = {
  id: 'rust',
  label: 'Rust',
  description: 'rustup + stable toolchain, clippy, rustfmt, rust-analyzer',
  options: [
    {
      key: 'toolchain',
      kind: 'select',
      label: 'Default toolchain',
      choices: [
        { value: 'stable', label: 'stable' },
        { value: 'beta', label: 'beta' },
        { value: 'nightly', label: 'nightly' },
      ],
      default: 'stable',
    },
    {
      key: 'components',
      kind: 'multi',
      label: 'Components',
      choices: [
        { value: 'clippy', label: 'clippy' },
        { value: 'rustfmt', label: 'rustfmt' },
        { value: 'rust-analyzer', label: 'rust-analyzer' },
      ],
      default: ['clippy', 'rustfmt', 'rust-analyzer'],
    },
    {
      key: 'addons',
      kind: 'multi',
      label: 'Add-ons',
      choices: [
        { value: 'cargo-nextest', label: 'cargo-nextest', hint: 'test runner' },
        {
          value: 'cargo-watch',
          label: 'cargo-watch',
          hint: 'rerun on file changes',
        },
        {
          value: 'cargo-edit',
          label: 'cargo-edit',
          hint: 'cargo add/rm/upgrade',
        },
      ],
      default: ['cargo-nextest'],
    },
  ],
  async install(ic, choices) {
    const toolchain = shQuote(choiceString(choices, 'toolchain'));
    const components = choiceList(choices, 'components');
    const addons = choiceList(choices, 'addons');

    if (hasAptProbe(ic)) {
      await ic.runner.asRoot(aptInstall(BUILD_DEPS), 'rust: build deps');
    } else {
      ic.warn('rust: no apt: make sure a C linker (gcc/cc) is installed');
    }

    ic.logger.log('Installing Rust via rustup');
    const script = [
      'if command -v rustup >/dev/null; then',
      '  rustup self update || true',
      `  rustup update ${toolchain}`,
      'else',
      `  curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --profile default --default-toolchain ${toolchain}`,
      'fi',
      '. "$HOME/.cargo/env"',
      `rustup default ${toolchain}`,
    ];
    if (components.length > 0)
      script.push(`rustup component add ${components.map(shQuote).join(' ')}`);
    script.push('rustc --version; cargo --version');
    await ic.runner.asUser(script.join('\n'), 'rust: rustup');

    for (const name of addons) {
      await tryAddon(ic, `rust: add-on ${name}`, () =>
        ic.runner.asUser(
          `cargo install --locked ${shQuote(name)}`,
          `rust: ${name}`,
        ),
      );
    }
  },
};
