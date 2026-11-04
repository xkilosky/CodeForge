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
  /**
   * Loads the project list. Deliberately does **not** open anything.
   *
   * It used to open the most recent project on every launch. That made the
   * projects list unreachable (the home screen only rendered when no project was
   * open) and it made the app look like it only had one project: whatever you
   * last touched was reopened, and everything else might as well not exist.
   * The app now always starts on the projects home.
   */
  async init(): Promise<void> {
    try {
      const recent = await db.listProjects();
      projectStore.set((prev) => ({
        ...prev,
        recent,
        project: null,
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

  /**
   * Opens a project by id, loading it from IndexedDB first.
   *
   * The store deliberately does not keep every project's files in memory — the
   * home screen lists them from metadata only — so opening one is a read.
   */
  async openById(id: string): Promise<void> {
    try {
      const found = await db.getProject(id);
      if (found) projectActions.open(found);
      else projectStore.set((prev) => ({ ...prev, error: 'That project no longer exists.' }));
    } catch (err) {
      projectStore.set((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  },

  open(project: Project): void {
    if (saveTimer) clearTimeout(saveTimer);
    // Opening is a deliberate navigation, so the not-found banner from a
    // previous attempt must not linger over the newly opened project.
    projectStore.set((prev) => ({ ...prev, project, dirty: false, error: null }));
  },

  async reopen(id: string): Promise<void> {
    const found = await db.getProject(id);
    if (found) projectActions.open(found);
  },

  /**
   * Closes the open project and returns to the projects home.
   *
   * Anything still pending in the autosave debounce is written first —
   * otherwise "Back to projects" would be the one action that loses the last
   * edit, which is exactly the kind of bug that makes an editor untrustworthy.
   */
  close(): void {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const current = projectStore.get().project;
    if (current) void persist(current);
    projectStore.set((prev) => ({ ...prev, project: null, dirty: false }));
  },

  /**
   * Creates a copy of a project with a new id, and opens it.
   *
   * There is no server and no accounts: duplicating is how a user experiments
   * without risking work they already have.
   */
  async duplicate(id: string): Promise<Project | null> {
    try {
      const source = await db.getProject(id);
      if (!source) {
        projectStore.set((prev) => ({ ...prev, error: 'That project no longer exists.' }));
        return null;
      }
      const now = Date.now();
      const copy: Project = {
        ...source,
        id: newId('prj'),
        name: `${source.name} copy`,
        // Deep-copy the files so editing the copy cannot mutate the original
        // through a shared reference.
        files: Object.fromEntries(
          Object.entries(source.files).map(([path, file]) => [path, { ...file }]),
        ),
        createdAt: now,
        updatedAt: now,
      };
      await db.putProject(copy);
      await projectActions.refreshRecent();
      return copy;
    } catch (err) {
      projectStore.set((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : String(err),
      }));
      return null;
    }
  },

  /**
   * Re-reads the project list from IndexedDB.
   *
   * The home screen shows this list, so every mutation that can happen while it
   * is visible (create, delete, duplicate from another tab) has to refresh it or
   * the screen becomes a lie.
   */
  async refreshRecent(): Promise<void> {
    try {
      const recent = await db.listProjects();
      projectStore.set((prev) => ({ ...prev, recent }));
    } catch (err) {
      projectStore.set((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  },

  dismissError(): void {
    projectStore.set((prev) => ({ ...prev, error: null }));
  },

  /**
   * Deletes a project permanently.
   *
   * The UI confirms first; this function does not ask. Deleting the project that
   * is currently open returns to the home screen rather than silently opening
   * some other project, which would look like the delete had picked a project
   * for you.
   */
  async remove(id: string): Promise<void> {
    try {
      await db.deleteProject(id);
      const recent = await db.listProjects();
      projectStore.set((prev) => ({
        ...prev,
        recent,
        project: prev.project?.id === id ? null : prev.project,
      }));
    } catch (err) {
      projectStore.set((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
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
