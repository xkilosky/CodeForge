import { db } from './idb';
import { Store } from './store';
import { TEMPLATES, projectFromTemplate, type Template } from './templates';
import { runtimeForWorkspace } from '../runtimes/registry';
import type { FileMap, Project, ProjectSettings } from './types';
import { languageForPath, newId } from './types';
import { addEntity, removeEntity, setPlayer, updateEntity, type Entity, type Scene } from './scene';

export interface ProjectState {
  project: Project | null;
  /** All known projects, newest first. */
  recent: Project[];
  loading: boolean;
  /** True while a debounced autosave is pending. */
  dirty: boolean;
  error: string | null;
  /**
   * Scene undo/redo depth, for the builder's buttons.
   *
   * The histories themselves are module-local and not in the store: they hold
   * whole scenes, and publishing them would re-render every subscriber on every
   * drag step for no benefit. The UI only needs to know whether a press would
   * do anything.
   */
  undoDepth: number;
  redoDepth: number;
}

/**
 * Undo history for the scene, one project at a time.
 *
 * Dragging produces a scene change per pointer move, so entries are opened
 * explicitly by `beginSceneGesture()` rather than per update — otherwise a
 * single drag would need forty presses of Ctrl+Z.
 */
const UNDO_LIMIT = 60;
let undoStack: Scene[] = [];
let redoStack: Scene[] = [];
let gestureOpen = false;
/** The scene as it was when the open gesture started, if one is open. */
let gestureBefore: Scene | null = null;

export const projectStore = new Store<ProjectState>({
  project: null,
  recent: [],
  loading: true,
  dirty: false,
  error: null,
  undoDepth: 0,
  redoDepth: 0,
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

/**
 * Pushes a scene onto the undo stack.
 *
 * The redo stack dies here on purpose: once a new change is made, the branch
 * that was undone is unreachable, and keeping it would make Redo jump back to a
 * state the user has already replaced.
 */
function pushHistory(before: Scene): void {
  undoStack.push(before);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack = [];
  publishDepths();
}

function publishDepths(): void {
  projectStore.set((prev) => ({
    ...prev,
    undoDepth: undoStack.length,
    redoDepth: redoStack.length,
  }));
}

/** Scene history is per project; opening a different one must not leak it. */
function resetHistory(): void {
  undoStack = [];
  redoStack = [];
  gestureOpen = false;
  gestureBefore = null;
  publishDepths();
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
      settings: { theme: 'vs-dark', autorun: true },
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
   * handler was an empty comment, so tapping a workspace tab did nothing at all
   * and there was no obvious way to reach another workspace except by starting
   * over from the projects home.
   *
   * Files are replaced rather than merged because the starters of two
   * workspaces do not belong in one project; the user is choosing a different
   * kind of project, and the starter is the honest content for it.
   */
  switchWorkspace(workspace: Project['workspace']): void {
    const current = projectStore.get().project;
    if (!current) return;
    if (current.workspace === workspace) return;

    // A workspace with no runtime cannot run anything: retargeting to it would
    // hand the user a project whose Run button does nothing. The top bar
    // disables those tabs, but the action must hold the same line on its own.
    if (!runtimeForWorkspace(workspace).available) return;

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
    resetHistory();
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
    resetHistory();
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

  // ── scene (the game builder) ──────────────────────────────────────────
  /**
   * Records the current scene as one undo step.
   *
   * Called at the start of a drag, so the whole gesture collapses into a single
   * press of Ctrl+Z rather than one per pixel of movement.
   */
  beginSceneGesture(): void {
    gestureOpen = true;
    gestureBefore = projectStore.get().project?.scene ?? null;
  },

  /**
   * Ends a gesture, recording the state it started from as one undo step.
   *
   * One drag therefore costs one press of Ctrl+Z. A gesture during which
   * nothing actually moved records nothing.
   */
  endSceneGesture(): void {
    const before = gestureBefore;
    gestureOpen = false;
    gestureBefore = null;
    const current = projectStore.get().project?.scene;
    if (before && current && before !== current) pushHistory(before);
  },

  /**
   * Applies a change to the scene, recording history once per gesture.
   *
   * A change with no open gesture records its own entry, which is what a
   * button press or a typed field should undo to.
   */
  updateScene(change: (scene: Scene) => Scene): void {
    const current = projectStore.get().project;
    if (!current) return;
    const before = current.scene;
    const next = change(before ?? { version: 1, world: { width: 960, height: 540, gravity: 1600 }, entities: [] });
    if (!before || next === before) return;

    // Inside a gesture the pre-drag scene is recorded once, and only once the
    // gesture *ends* — so the entry is the state before the whole drag, not the
    // state between its first and second pointer moves.
    if (gestureOpen) {
      gestureBefore ??= before;
    } else {
      pushHistory(before);
    }

    scheduleSave(touch({ ...current, scene: next }));
  },

  addEntity(kind: 'box' | 'circle', x: number, y: number): string | null {
    const current = projectStore.get().project;
    if (!current?.scene) return null;
    const result = addEntity(current.scene, kind, x, y);
    projectActions.updateScene(() => result.scene);
    return result.entity.id;
  },

  moveEntity(id: string, x: number, y: number): void {
    projectActions.updateScene((scene) => updateEntity(scene, id, { x, y }));
  },

  resizeEntity(id: string, w: number, h: number): void {
    projectActions.updateScene((scene) => updateEntity(scene, id, { w, h }));
  },

  patchEntity(id: string, patch: Partial<Omit<Entity, 'id'>>): void {
    projectActions.updateScene((scene) => updateEntity(scene, id, patch));
  },

  deleteEntity(id: string): void {
    projectActions.updateScene((scene) => removeEntity(scene, id));
  },

  duplicateEntity(id: string): string | null {
    const current = projectStore.get().project;
    const source = current?.scene?.entities.find((entity) => entity.id === id);
    if (!current?.scene || !source) return null;
    const result = addEntity(
      current.scene,
      source.kind,
      source.x + 24,
      source.y + 24,
      { w: source.w, h: source.h, color: source.color, solid: source.solid, name: `${source.name} copy` },
    );
    projectActions.updateScene(() => result.scene);
    return result.entity.id;
  },

  setPlayer(id: string | undefined): void {
    projectActions.updateScene((scene) => setPlayer(scene, id));
  },

  patchWorld(patch: Partial<Scene['world']>): void {
    projectActions.updateScene((scene) => ({ ...scene, world: { ...scene.world, ...patch } }));
  },

  undoScene(): void {
    const current = projectStore.get().project;
    const previous = undoStack.pop();
    if (!current || !current.scene || !previous) return;
    redoStack.push(current.scene);
    publishDepths();
    scheduleSave(touch({ ...current, scene: previous }));
  },

  redoScene(): void {
    const current = projectStore.get().project;
    const next = redoStack.pop();
    if (!current || !current.scene || !next) return;
    undoStack.push(current.scene);
    publishDepths();
    scheduleSave(touch({ ...current, scene: next }));
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
