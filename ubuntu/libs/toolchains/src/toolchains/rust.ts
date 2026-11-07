import type { Toolchain } from '../types';

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
        { value: 'cargo-watch', label: 'cargo-watch' },
        { value: 'cargo-edit', label: 'cargo-edit', hint: 'cargo add/rm/upgrade' },
      ],
      default: ['cargo-nextest'],
    },
  ],
  async install() {
    throw new Error('not implemented');
  },
};
