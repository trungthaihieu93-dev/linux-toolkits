import type { SavePreview } from '@linux-toolchain/term-config';
import { applyPatch, parsePatch, reversePatch } from 'diff';

/**
 * The current file content a preview was computed from, rebuilt by applying
 * its unified diff backwards to the candidate. Null when that fails (the
 * dialog then shows the unified diff text instead).
 */
export function originalFromPreview(preview: SavePreview): string | null {
  if (preview.baseMtimeMs === null) return '';
  if (!preview.diff) return preview.candidate;
  try {
    const [patch] = parsePatch(preview.diff);
    if (!patch || patch.hunks.length === 0) return null;
    const original = applyPatch(preview.candidate, reversePatch(patch));
    return typeof original === 'string' ? original : null;
  } catch {
    return null;
  }
}

/** Where the previous content goes before the write, or why nothing is copied. */
export function backupNote(preview: SavePreview): string {
  if (preview.baseMtimeMs === null) {
    return 'No backup: the file does not exist yet.';
  }
  const dir = preview.backupDir;
  return dir
    ? `${preview.path} is copied to ${dir}/<timestamp>/${preview.fileId} before it is replaced.`
    : `${preview.path} is backed up before it is replaced.`;
}
