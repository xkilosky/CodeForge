/**
 * The file *tree*.
 *
 * A project stores a flat `Record<path, file>`, which is the right shape for
 * storage and the wrong shape for a person: nobody browses `src/ui/button.ts`
 * as one string in a sorted list of twenty strings. Everything folder-shaped —
 * building the tree, creating a folder, renaming one, deleting one — lives here
 * as pure functions over the flat map so it can be tested without a DOM and so
 * the store never has to know what a node is.
 *
 * Folders that contain no files are held in `Project.folders`. They are real:
 * "Create folder" then "New file inside it" is the most common thing anyone
 * does in a file tree, and an empty folder that vanishes on the next read is a
 * bug, not a simplification.
 */
import type { FileMap, Project } from './types';

export interface TreeFileNode {
  kind: 'file';
  path: string;
  name: string;
}

export interface TreeFolderNode {
  kind: 'folder';
  path: string;
  name: string;
  children: TreeNode[];
  /** True when the user created it but nothing has been placed inside yet. */
  empty: boolean;
}

export type TreeNode = TreeFileNode | TreeFolderNode;

export type PathResult = { ok: true; path: string } | { ok: false; error: string };

/** Same comparison the explorer and tabs use, so ordering cannot disagree. */
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Canonical form of a typed path.
 *
 * Slashes are normalised rather than rejected: a path pasted from a Windows
 * file manager arrives with backslashes, and refusing it would be a papercut
 * with no upside. `.` segments and empty segments are dropped; `..` is *not*
 * resolved, because a project has no parent directory and silently accepting it
 * would create a path that looks like it escapes.
 */
export function normalizePath(raw: string): string {
  const cleaned = raw.trim().replace(/\\/g, '/');
  const segments = cleaned
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.');
  return segments.join('/');
}

/** Everything above the last slash. `src/ui/a.ts` → `src/ui`. */
export function parentOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

/** The last segment. `src/ui/a.ts` → `a.ts`. */
export function nameOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

/** The extension without the dot, lowercased. `a.TS` → `ts`. */
export function extensionOf(path: string): string {
  const name = nameOf(path);
  const index = name.lastIndexOf('.');
  return index <= 0 ? '' : name.slice(index + 1).toLowerCase();
}

/** Every parent folder of a path, outermost first. `a/b/c.js` → ['a', 'a/b']. */
export function ancestorsOf(path: string): string[] {
  const parts = path.split('/').slice(0, -1);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 1) out.push(parts.slice(0, i + 1).join('/'));
  return out;
}

/** True when `path` is `folder` itself or sits inside it. */
export function isInside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`);
}

/**
 * A path's problems, or null.
 *
 * Separate from the "does it already exist" check because the two produce
 * different messages and the second one depends on the current files.
 */
export function pathProblem(path: string): string | null {
  if (!path) return 'A name is required.';
  if (path.split('/').some((segment) => segment === '..')) {
    return 'A path cannot contain “..”.';
  }
  if (path.endsWith('/')) return 'A file needs a name, not just a folder.';
  // Characters that break a URL, a `<script src>` or a shell when the project
  // is exported later. Cheap to refuse now, confusing to debug then.
  if (/[<>:"|?*\u0000-\u001f]/.test(path)) {
    return 'A path cannot contain < > : " | ? * or control characters.';
  }
  if (path.split('/').some((segment) => segment.length > 64)) {
    return 'Each folder name must be 64 characters or fewer.';
  }
  if (path.length > 200) return 'That path is too long.';
  return null;
}

/** Every folder path implied by the files plus the explicitly created ones. */
export function allFolders(project: Pick<Project, 'files' | 'folders'>): Set<string> {
  const folders = new Set<string>(project.folders ?? []);
  for (const path of Object.keys(project.files)) {
    for (const ancestor of ancestorsOf(path)) folders.add(ancestor);
  }
  return folders;
}

/**
 * The tree, folders before files, each sorted the way a person reads them.
 *
 * Built from both sources of truth so an empty folder still appears and a
 * folder that only exists as a prefix of a file path still appears.
 */
export function buildTree(project: Pick<Project, 'files' | 'folders'>): TreeNode[] {
  const folders = allFolders(project);
  const root: TreeNode[] = [];

  function childrenOf(folder: string): TreeNode[] {
    const directFolders = [...folders]
      .filter((candidate) => parentOf(candidate) === folder)
      .sort(compareNames)
      .map<TreeFolderNode>((path) => ({
        kind: 'folder',
        path,
        name: nameOf(path),
        children: childrenOf(path),
        empty: true,
      }));

    const prefix = folder ? `${folder}/` : '';
    const directFiles = Object.keys(project.files)
      .filter((path) => parentOf(path) === folder && path.startsWith(prefix))
      .sort(compareNames)
      .map<TreeFileNode>((path) => ({ kind: 'file', path, name: nameOf(path) }));

    for (const folderNode of directFolders) {
      folderNode.empty = folderNode.children.length === 0;
    }
    return [...directFolders, ...directFiles];
  }

  root.push(...childrenOf(''));
  return root;
}

/** Paths under a folder, including the folder itself. Used by delete/rename. */
export function pathsUnder(files: FileMap, folder: string): string[] {
  return Object.keys(files).filter((path) => isInside(path, folder));
}

/**
 * Removes a folder and everything in it.
 *
 * Returns the new map and the new folder list; the caller decides what the
 * active file becomes, because "the file you were editing just disappeared" is
 * a UI decision, not a storage one.
 */
export function deleteFolder(
  project: Pick<Project, 'files' | 'folders'>,
  folder: string,
): { files: FileMap; folders: string[] } {
  const files: FileMap = {};
  for (const [path, file] of Object.entries(project.files)) {
    if (!isInside(path, folder)) files[path] = file;
  }
  const folders = (project.folders ?? []).filter((path) => !isInside(path, folder));
  return { files, folders };
}

/**
 * Rewrites a path if it lives under `from`, so renaming a folder carries its
 * contents with it. Files outside the folder are returned untouched, which is
 * what makes this safe to call for a file rename too.
 */
export function remapPath(path: string, from: string, to: string): string {
  if (path === from) return to;
  if (!path.startsWith(`${from}/`)) return path;
  return `${to}${path.slice(from.length)}`;
}

/** Applies `remapPath` across the whole map. Collisions are caller's problem. */
export function remapFiles(files: FileMap, from: string, to: string): FileMap {
  const next: FileMap = {};
  for (const [path, file] of Object.entries(files)) {
    next[remapPath(path, from, to)] = file;
  }
  return next;
}

/**
 * A free path close to `desired`, for duplicate.
 *
 * `index.html` → `index copy.html` → `index copy 2.html`. Suffixing the whole
 * name instead would lose the extension and turn the copy into a text file.
 */
export function freePath(taken: Iterable<string>, desired: string): string {
  const used = new Set(taken);
  if (!used.has(desired)) return desired;

  const folder = parentOf(desired);
  const name = nameOf(desired);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  const prefix = folder ? `${folder}/` : '';

  for (let index = 1; index < 500; index += 1) {
    const suffix = index === 1 ? ' copy' : ` copy ${index}`;
    const candidate = `${prefix}${stem}${suffix}${extension}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${prefix}${stem} copy ${Date.now()}${extension}`;
}

/**
 * Where a newly typed path should land.
 *
 * When the user has a folder selected (or a file in a folder), a bare name
 * means "inside here" — that is the whole point of having a tree, and typing
 * `src/` before every filename is exactly what a tree exists to avoid.
 */
export function resolveNewPath(base: string, raw: string): string {
  const normalized = normalizePath(raw);
  if (!normalized) return '';
  if (normalized.includes('/')) return normalized;
  return base ? `${base}/${normalized}` : normalized;
}
