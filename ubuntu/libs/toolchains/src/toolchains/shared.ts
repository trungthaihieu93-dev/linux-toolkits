import type { InstallContext } from '../types';

const APT_GET = '/usr/bin/apt-get';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True when apt-get is available (Debian/Ubuntu). */
export function hasAptProbe(ic: InstallContext): boolean {
  return ic.exists(APT_GET);
}

/** Throws unless apt-get is available; `who` prefixes the message (e.g. `java`). */
export function requireApt(ic: InstallContext, who: string): void {
  if (!hasAptProbe(ic))
    throw new Error(`${who} needs apt (Debian/Ubuntu): apt-get not found`);
}

/** Run an optional step; a failure becomes a collected warning instead of aborting the toolchain. */
export async function tryAddon(
  ic: InstallContext,
  what: string,
  step: () => Promise<void>,
): Promise<void> {
  try {
    await step();
  } catch (error) {
    ic.warn(`${what} failed: ${errorMessage(error)}`);
  }
}
