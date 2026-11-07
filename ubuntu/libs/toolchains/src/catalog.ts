import { android } from './toolchains/android';
import { bunTools } from './toolchains/bun-tools';
import { claude } from './toolchains/claude';
import { cpp } from './toolchains/cpp';
import { docker } from './toolchains/docker';
import { flutter } from './toolchains/flutter';
import { go } from './toolchains/go';
import { java } from './toolchains/java';
import { jenv } from './toolchains/jenv';
import { nvmBun } from './toolchains/nvm-bun';
import { pyenv } from './toolchains/pyenv';
import { python } from './toolchains/python';
import { rust } from './toolchains/rust';
import type { Toolchain } from './types';

/** All toolchains, in install order (same order as install-toolchains.sh). */
export const catalog: readonly Toolchain[] = [
  nvmBun,
  bunTools,
  go,
  rust,
  python,
  pyenv,
  java,
  jenv,
  flutter,
  android,
  cpp,
  docker,
  claude,
];

export function getToolchain(id: string): Toolchain | undefined {
  return catalog.find((t) => t.id === id);
}
