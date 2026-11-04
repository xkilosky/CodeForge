import { db } from './idb';
import { Store } from './store';
import { TEMPLATES, projectFromTemplate, type Template } from './templates';
import type { FileMap, Project, ProjectSettings } from './types';
import { languageForPath, newId } from './types';

export interface ProjectState {
  project: Project | null;
  /** All known projects, newest first. */
  recent: Project[];
  loading: boolean;
  /** True while a debounced autosave is pending. */
  dirty: boolean;
  error: string | null;
}

export const projectStore = new Store<ProjectState>({
  project: null,
  recent: [],
  loading: true,
  dirty: false,
  error: null,
});

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const AUTOSAVE_MS = 400;

function touch(project: Project): Project {
  return { ...project, updatedAt: Date.now() };
}

/** Persist immediately, replacing the entry in `recent`. */
async function persist(project: Project): Promise<void> {
  try {
    await db.putProject(project);
    const all = await db.listProjects();
    projectStore.set((prev) => ({ ...prev, recent: all, dirty: false }));
  } catch (err) {
    projectStore.set((prev) => ({
      ...prev,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

function scheduleSave(project: Project): void {
  projectStore.set((prev) => ({ ...prev, project, dirty: true }));
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void persist(project), AUTOSAVE_MS);
}

export const projectActions = {
  async init(): Promise<void> {
    try {
      const recent = await db.listProjects();
      projectStore.set((prev) => ({
        ...prev,
        recent,
        project: prev.project ?? recent[0] ?? null,
        loading: false,
      }));
    } catch (err) {
      projectStore.set((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  },

  createFromTemplate(template: Template, name?: string): Project {
    const project = projectFromTemplate(template, name);
    projectStore.set((prev) => ({ ...prev, project }));
    void persist(project);
    return project;
  },

  createBlank(name: string, workspace: Project['workspace'] = 'blank'): Project {
    const now = Date.now();
    const project: Project = {
      id: newId('prj'),
      name: name.trim() || 'Untitled',
      workspace,
      files: {},
      activeFile: '',
      settings: { theme: 'vs-dark', autorun: true, analysisMode: 'strict' },
      createdAt: now,
      updatedAt: now,
    };
    projectStore.set((prev) => ({ ...prev, project }));
    void persist(project);
    return project;
  },

  /**
   * Switches the open project to a different workspace, replacing its files with
   * that workspace's starter template.
   *
   * This is what the workspace tabs do. Before, they were inert: the click
   * handler was an empty comment, so tapping "Roblox" on a Web project did
   * nothing at all and there was no obvious way to reach the Roblox workspace
   * except by starting over from the Welcome screen.
   *
   * Files are replaced rather than merged because a Luau script and an HTML page
   * do not belong in the same project; the user is choosing a different kind of
   * project, and the starter is the honest content for it.
   */
  switchWorkspace(workspace: Project['workspace']): void {
    const current = projectStore.get().project;
    if (!current) return;
    if (current.workspace === workspace) return;

    const template =
      TEMPLATES.find((t) => t.workspace === workspace) ??
      TEMPLATES.find((t) => t.workspace === 'blank');
    if (!template) return;

    const replacement = projectFromTemplate(template, current.name);
    // Keep identity and settings: this is the same project, retargeted.
    const next: Project = {
      ...replacement,
      id: current.id,
      settings: current.settings,
      createdAt: current.createdAt,
    };
    projectStore.set((prev) => ({ ...prev, project: next, dirty: true }));
    void persist(next);
  },

  open(project: Project): void {
    if (saveTimer) clearTimeout(saveTimer);
    projectStore.set((prev) => ({ ...prev, project, dirty: false }));
  },

  async reopen(id: string): Promise<void> {
    const found = await db.getProject(id);
    if (found) projectActions.open(found);
  },

  async remove(id: string): Promise<void> {
    await db.deleteProject(id);
    const recent = await db.listProjects();
    projectStore.set((prev) => ({
      ...prev,
      recent,
      project: prev.project?.id === id ? (recent[0] ?? null) : prev.project,
    }));
  },

  rename(name: string): void {
    const current = projectStore.get().project;
    if (!current) return;
    scheduleSave(touch({ ...current, name }));
  },

  setActiveFile(path: string): void {
    const current = projectStore.get().project;
    if (!current) return;
    scheduleSave(touch({ ...current, activeFile: path }));
  },

  updateFile(path: string, content: string): void {
    const current = projectStore.get().project;
    if (!current) return;
    const files: FileMap = {
      ...current.files,
      [path]: { content, language: languageForPath(path) },
    };
    scheduleSave(touch({ ...current, files }));
  },

  addFile(path: string): boolean {
    const current = projectStore.get().project;
    if (!current) return false;
    const clean = path.trim().replace(/^\/+/, '');
    if (!clean || clean in current.files) return false;
    const files: FileMap = { ...current.files, [clean]: { content: '', language: languageForPath(clean) } };
    scheduleSave(touch({ ...current, files, activeFile: clean }));
    return true;
  },

  removeFile(path: string): void {
    const current = projectStore.get().project;
    if (!current) return;
    const files = { ...current.files };
    delete files[path];
    const keys = Object.keys(files);
    scheduleSave(
      touch({
        ...current,
        files,
        activeFile: current.activeFile === path ? (keys[0] ?? '') : current.activeFile,
      }),
    );
  },

  updateSettings(patch: Partial<ProjectSettings>): void {
    const current = projectStore.get().project;
    if (!current) return;
    scheduleSave(touch({ ...current, settings: { ...current.settings, ...patch } }));
  },

  flush(): void {
    if (saveTimer) clearTimeout(saveTimer);
    const current = projectStore.get().project;
    if (current) void persist(current);
  },
};
