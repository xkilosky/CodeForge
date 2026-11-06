import type { FileMap } from './types';

export interface FileDiff {
  original: string;
  modified: string;
}

/** Compare one file against a captured project snapshot, including add/delete. */
export function getFileDiff(
  originalFiles: Record<string, string>,
  currentFiles: FileMap,
  path: string,
): FileDiff | null {
  const hasOriginal = Object.hasOwn(originalFiles, path);
  const hasModified = Object.hasOwn(currentFiles, path);
  const original = originalFiles[path] ?? '';
  const modified = currentFiles[path]?.content ?? '';

  return hasOriginal !== hasModified || original !== modified
    ? { original, modified }
    : null;
}
