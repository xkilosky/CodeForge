/**
 * Project export and import.
 *
 * There is no account and no server, so IndexedDB is the only copy of anything
 * the user makes. One cleared browser profile and a year of work is gone. Export
 * is therefore not a "nice to have" for a later milestone — it is the backup
 * story, and it is the only feature that makes deleting a project safe.
 *
 * The format is a plain JSON object with an explicit `format` field and a
 * version. Parsing is strict: a file that is not ours is rejected with a reason
 * the user can act on, rather than half-imported into a broken project.
 */
import type { FileMap, Project, SourceFile, WorkspaceId } from './types';
import { languageForPath, newId } from './types';
import { normalizePath, pathProblem } from './workspace';
import { DEFAULT_ACCENT, resolveEditorTheme } from './theme';

/** Bumped only when an older file would be misread, never for additions. */
export const TRANSFER_FORMAT = 'codeforge.project';
export const TRANSFER_VERSION = 1;

export interface ProjectFile {
  name: string;
  version: number;
  exportedAt: string;
  project: {
    name: string;
    workspace: WorkspaceId;
    accent: string;
    theme: string;
    autorun: boolean;
    folders: string[];
    files: Record<string, string>;
    activeFile: string;
  };
}

const WORKSPACES: WorkspaceId[] = ['web', 'game', 'python', 'blank'];

/** The JSON a download writes. Stable key order so diffs of two exports read. */
export function serializeProject(project: Project): string {
  const payload: ProjectFile = {
    name: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    exportedAt: new Date().toISOString(),
    project: {
      name: project.name,
      workspace: project.workspace,
      accent: project.accent ?? DEFAULT_ACCENT,
      theme: project.settings.theme,
      autorun: project.settings.autorun,
      folders: [...(project.folders ?? [])].sort(),
      files: Object.fromEntries(
        Object.keys(project.files)
          .sort()
          .map((path) => [path, project.files[path].content]),
      ),
      activeFile: project.activeFile,
    },
  };
  return JSON.stringify(payload, null, 2);
}

/** A filename that survives every OS: `my-page` → `my-page.codeforge.json`. */
export function exportFileName(name: string): string {
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'project';
  return `${slug}.codeforge.json`;
}

export type ImportResult = { ok: true; project: Project; renamed: boolean } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Turns exported text into a project.
 *
 * `getFreshId` is injected rather than called directly so an import can be
 * tested for id uniqueness without a global counter, and so importing the same
 * file twice produces two projects rather than overwriting the first.
 */
export function parseProject(text: string, getFreshId: () => string = () => newId('prj')): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }

  if (!isRecord(data) || data.name !== TRANSFER_FORMAT) {
    return { ok: false, error: 'That file was not exported from CodeForge.' };
  }
  if (typeof data.version !== 'number' || data.version > TRANSFER_VERSION) {
    return {
      ok: false,
      error: 'That file was made by a newer CodeForge. Update, then import it again.',
    };
  }
  if (!isRecord(data.project)) return { ok: false, error: 'That file has no project inside it.' };

  const raw = data.project;
  const files: FileMap = {};

  if (!isRecord(raw.files)) return { ok: false, error: 'That project has no files.' };

  for (const [rawPath, content] of Object.entries(raw.files)) {
    if (typeof content !== 'string') {
      return { ok: false, error: `“${rawPath}” is not text.` };
    }
    const path = normalizePath(rawPath);
    const problem = pathProblem(path);
    if (problem) return { ok: false, error: `${problem} (in “${rawPath}”)` };
    files[path] = { content, language: languageForPath(path) } satisfies SourceFile;
  }

  if (Object.keys(files).length === 0) {
    return { ok: false, error: 'That project has no files.' };
  }

  const workspace = WORKSPACES.includes(raw.workspace as WorkspaceId)
    ? (raw.workspace as WorkspaceId)
    : 'web';

  const activeFile =
    typeof raw.activeFile === 'string' && raw.activeFile in files
      ? raw.activeFile
      : Object.keys(files)[0];

  const folders = Array.isArray(raw.folders)
    ? raw.folders.filter((value): value is string => typeof value === 'string').map(normalizePath)
    : [];

  const now = Date.now();
  const project: Project = {
    id: getFreshId(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Imported project',
    workspace,
    files,
    folders,
    activeFile,
    settings: {
      theme: resolveEditorTheme(typeof raw.theme === 'string' ? raw.theme : undefined),
      autorun: raw.autorun !== false,
    },
    accent: typeof raw.accent === 'string' ? (raw.accent as Project['accent']) : DEFAULT_ACCENT,
    createdAt: now,
    updatedAt: now,
  };

  return { ok: true, project, renamed: typeof raw.name !== 'string' };
}
