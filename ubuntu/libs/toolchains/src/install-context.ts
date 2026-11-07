import { existsSync, readdirSync } from 'node:fs';
import type { Context, Logger, Runner } from '@linux-toolchain/core';
import type { InstallContext } from './types';

export interface InstallContextInit {
  runner: Runner;
  ctx: Context;
  logger: Logger;
  yes?: boolean;
  fetch?: typeof fetch;
  exists?: (path: string) => boolean;
  listDir?: (path: string) => string[];
}

function defaultListDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

/** Build an InstallContext; fs probes and fetch default to the real ones. */
export function createInstallContext(init: InstallContextInit): InstallContext {
  const warnings: string[] = [];
  return {
    runner: init.runner,
    ctx: init.ctx,
    logger: init.logger,
    yes: init.yes ?? false,
    fetch: init.fetch ?? fetch,
    exists: init.exists ?? existsSync,
    listDir: init.listDir ?? defaultListDir,
    warnings,
    warn(message: string) {
      warnings.push(message);
      init.logger.warn(message);
    },
  };
}
