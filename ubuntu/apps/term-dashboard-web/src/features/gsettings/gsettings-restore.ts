import type { GSettingsRestoreResult } from '@linux-toolchain/term-config';

/**
 * Toast text for a gsettings restore: what was restored and, when td took
 * one, where the settings from before the restore were backed up (the undo
 * point, listed on the Backups page).
 */
export function describeGSettingsRestore(
  result: GSettingsRestoreResult,
): string {
  const restored = `Restored: ${result.restored.join(', ') || 'nothing'}.`;
  return result.backup
    ? `${restored} The settings from before the restore are backed up in ${result.backup.path}; restore that backup on the Backups page to undo.`
    : restored;
}
