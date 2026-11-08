import { createTwoFilesPatch } from 'diff';
import type { FileId, SavePreview } from '@linux-toolchain/term-config';
import type { FileSnapshot, FileStore } from './file-store';

/** Unified diff from `current` to `candidate`; '' when they are equal. */
export function unifiedDiff(
  path: string,
  current: string,
  candidate: string,
): string {
  if (current === candidate) return '';
  return createTwoFilesPatch(
    path,
    path,
    current,
    candidate,
    'current',
    'candidate',
  );
}

/**
 * What a save of `candidate` would do: diff against the file on disk and the
 * syntax check result. Writes nothing except the check's temp file, which is
 * removed. Pass `snapshot` when the caller already read the file.
 */
export async function previewWrite(
  store: FileStore,
  id: FileId,
  candidate: string,
  snapshot?: FileSnapshot,
): Promise<SavePreview> {
  const current = snapshot ?? (await store.read(id));
  const check = await store.check(id, candidate);
  return {
    fileId: id,
    path: current.path,
    diff: unifiedDiff(current.path, current.content, candidate),
    changed: current.content !== candidate || !current.exists,
    check,
    baseMtimeMs: current.mtimeMs,
    candidate,
  };
}
