import { db } from './idb';
import { Store } from './store';
import { TEMPLATES, projectFromTemplate, type Template } from './templates';
import { runtimeForWorkspace } from '../runtimes/registry';
import type { FileMap, Project, ProjectSettings } from './types';
import { languageForPath, newId } from './types';
import { DEFAULT_ACCENT, type AccentId, type EditorThemeId } from './theme';
import { exportFileName, parseProject, serializeProject } from './transfer';
import {
  allFolders,
  ancestorsOf,
  deleteFolder,
  freePath,
  isInside,
  nameOf,
  normalizePath,
  parentOf,
  pathProblem,
  remapFiles,
} from './workspace';
import { addEntity, removeEntity, setPlayer, updateEntity, type Entity, type Scene } from './scene';

/**
 * What just happened, in words, for the one-line notice in the bottom bar.
 *
 * Undo for files and folders is a full history stack, and it is not built yet.
 * A toast is the honest middle ground: it confirms that the destructive thing
 * the user just pressed actually happened, which is the part a silent delete
 * gets wrong. `undoable` marks the actions that a future undo would cover.
 */
export interface ProjectNotice {
  id: string;
  text: string;
  /** 'success' for "done", 'info' for "nothing to do", 'error' for a refusal. */
  tone: 'success' | 'info' | 'error';
  at: number;
}

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
  /** The most recent confirmation or refusal, shown briefly in the bottom bar. */
  notice: ProjectNotice | null;
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
  notice: null,
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

/**
 * Publishes a one-line confirmation.
 *
 * Cleared by the UI after a few seconds rather than by a timer here: a timer in
 * the store would keep firing against a store nobody is subscribed to, and the
 * component that shows the notice owns how long it stays.
 */
function notify(text: string, tone: ProjectNotice['tone'] = 'success'): void {
  projectStore.set((prev) => ({
    ...prev,
    notice: { id: newId('note'), text, tone, at: Date.now() },
  }));
}

function scheduleSave(project: Project): void {
  projectStore.set((prev) => ({ ...prev, project, dirty: true }));
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void persist(project), AUTOSAVE_MS);
}

/**
 * Brings a project loaded from storage up to the current shape.
 *
 * Called on every read rather than as an IndexedDB migration: a project saved
 * by S1.5 has no `folders`, no `accent`, and a stock Monaco theme id. Fixing
 * those at the boundary means the rest of the code never has to ask whether a
 * field might be missing, and there is exactly one place to add the next one.
 */
export function settleProject(project: Project): Project {
  const folders = new Set(project.folders ?? []);
  for (const path of Object.keys(project.files)) {
    for (const ancestor of ancestorsOf(path)) folders.add(ancestor);
  }
  return {
    ...project,
    folders: [...folders],
    accent: project.accent ?? DEFAULT_ACCENT,
  };
}

export const projectActions = {
  /**
   * Kept as `settleProject` for callers that already hold a project object
   * (creating from a template, duplicating) and want the same normalisation.
   */
  settle: settleProject,

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
    const project = settleProject(projectFromTemplate(template, name));
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
      settings: { theme: 'tokyo-night', autorun: true },
      accent: DEFAULT_ACCENT,
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
      if (found) projectActions.open(settleProject(found));
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
    if (found) projectActions.open(settleProject(found));
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
        // Copied, not shared: deleting a folder in the copy must not gut the
        // original's folder list.
        folders: [...(source.folders ?? [])],
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

  addFile(path: string, content = ''): boolean {
    const current = projectStore.get().project;
    if (!current) return false;
    const clean = normalizePath(path);
    const problem = pathProblem(clean);
    if (problem) {
      notify(problem, 'error');
      return false;
    }
    if (clean in current.files || allFolders(current).has(clean)) {
      notify(`“${clean}” already exists.`, 'error');
      return false;
    }
    const files: FileMap = {
      ...current.files,
      [clean]: { content, language: languageForPath(clean) },
    };
    // Every folder a new file implies must exist, or the tree shows the file
    // at the root when its parent folder was never registered.
    const folders = new Set(current.folders ?? []);
    for (const ancestor of ancestorsOf(clean)) folders.add(ancestor);
    scheduleSave(
      touch({ ...current, files, folders: [...folders], activeFile: clean }),
    );
    notify(`Created ${clean}.`);
    return true;
  },

  removeFile(path: string): void {
    const current = projectStore.get().project;
    if (!current) return;
    if (!(path in current.files)) return;
    const files = { ...current.files };
    delete files[path];
    const keys = Object.keys(files).sort();
    scheduleSave(
      touch({
        ...current,
        files,
        // Never point the editor at a file that is gone: the pane would render
        // an empty editor over a path that does not exist.
        activeFile: current.activeFile === path ? (keys[0] ?? '') : current.activeFile,
      }),
    );
    notify(`Deleted ${path}.`);
  },

  /**
   * Renames a file, or a whole folder, carrying its contents.
   *
   * A rename is a content-preserving rewrite of every affected key, so it goes
   * through one function: renaming `src` has to move `src/a.js` and `src/b/c.js`
   * together, and doing that in two code paths is how an editor ends up with
   * half a folder.
   */
  renamePath(from: string, to: string): boolean {
    const current = projectStore.get().project;
    if (!current) return false;
    const clean = normalizePath(to);
    const problem = pathProblem(clean);
    if (problem) {
      notify(problem, 'error');
      return false;
    }
    if (normalizePath(from) === clean) return false;

    const folders = allFolders(current);
    const isFolder = folders.has(from);
    if (!isFolder && !(from in current.files)) return false;

    // Renaming onto something else would destroy it silently. A *case-only*
    // rename of the same file (`a.js` → `A.js`) is allowed on case-sensitive
    // hosts but is a no-op on macOS, so it is refused rather than half-applied.
    if (clean in current.files && clean !== from) {
      notify(`“${clean}” already exists.`, 'error');
      return false;
    }
    if (folders.has(clean) && !isInside(clean, from)) {
      notify(`The folder “${clean}” already exists.`, 'error');
      return false;
    }
    // Moving a folder inside itself would produce paths that no longer grow.
    if (isFolder && isInside(clean, from)) {
      notify('A folder cannot be moved inside itself.', 'error');
      return false;
    }

    const files = remapFiles(current.files, from, clean);
    const nextFolders = new Set<string>();
    const keep = (path: string) => {
      if (path !== from && !isInside(path, from)) nextFolders.add(path);
    };
    for (const folder of current.folders ?? []) keep(folder);
    for (const path of Object.keys(files)) {
      for (const ancestor of ancestorsOf(path)) nextFolders.add(ancestor);
    }
    // A renamed empty folder stays an empty folder.
    if (isFolder && ![...Object.keys(files)].some((path) => isInside(path, clean))) {
      nextFolders.add(clean);
    }

    scheduleSave(
      touch({
        ...current,
        files,
        folders: [...nextFolders],
        activeFile: isInside(current.activeFile, from)
          ? clean + current.activeFile.slice(from.length)
          : current.activeFile,
      }),
    );
    notify(isFolder ? `Renamed folder to ${nameOf(clean)}.` : `Renamed to ${nameOf(clean)}.`);
    return true;
  },

  /**
   * Creates a folder.
   *
   * `using` is what the user has selected in the tree — a folder means "inside
   * it", a file means "beside it". Passing it in keeps the store free of the
   * explorer's own selection state.
   */
  createFolder(raw: string): string | null {
    const current = projectStore.get().project;
    if (!current) return null;
    const path = normalizePath(raw);
    if (!path) return null;
    const problem = pathProblem(path);
    if (problem) {
      notify(problem, 'error');
      return null;
    }
    if (path in current.files) {
      notify(`“${path}” is a file, not a folder.`, 'error');
      return null;
    }
    if (allFolders(current).has(path)) {
      notify(`The folder “${path}” already exists.`, 'error');
      return null;
    }
    const folders = new Set(current.folders ?? []);
    for (const ancestor of ancestorsOf(`${path}/_`)) folders.add(ancestor);
    scheduleSave(touch({ ...current, folders: [...folders] }));
    notify(`Created folder ${path}.`);
    return path;
  },

  /** Deletes a folder, its files and its subfolders as one operation. */
  removeFolder(folder: string): void {
    const current = projectStore.get().project;
    if (!current) return;
    if (!allFolders(current).has(folder)) return;
    const { files, folders } = deleteFolder(current, folder);
    const keys = Object.keys(files).sort();
    scheduleSave(
      touch({
        ...current,
        files,
        folders,
        activeFile: isInside(current.activeFile, folder) ? (keys[0] ?? '') : current.activeFile,
      }),
    );
    notify(`Deleted folder ${folder}.`);
  },

  /** A copy of a file, next to the original, opened. */
  duplicateFile(path: string): string | null {
    const current = projectStore.get().project;
    if (!current) return null;
    const source = current.files[path];
    if (!source) return null;
    const target = freePath(
      [...Object.keys(current.files), ...allFolders(current)],
      path,
    );
    const folders = new Set(current.folders ?? []);
    for (const ancestor of ancestorsOf(target)) folders.add(ancestor);
    const files: FileMap = {
      ...current.files,
      [target]: { content: source.content, language: source.language },
    };
    scheduleSave(touch({ ...current, files, folders: [...folders], activeFile: target }));
    notify(`Duplicated to ${nameOf(target)}.`);
    return target;
  },

  /**
   * Replaces every occurrence of a string across the project's text files.
   *
   * Scoped to the project on purpose: this is the "I renamed `.card` and now
   * four files are wrong" button, not a refactor engine. Binary-ish files are
   * untouched because `files` is text by construction, but a file with no
   * extension is still text here — that is what this app stores.
   */
  replaceInFiles(find: string, replace: string): number {
    const current = projectStore.get().project;
    if (!current || !find) return 0;
    let hits = 0;
    const files: FileMap = {};
    for (const [path, file] of Object.entries(current.files)) {
      if (!file.content.includes(find)) {
        files[path] = file;
        continue;
      }
      // Count occurrences, not lines: the number in the notice is what the
      // user will try to verify.
      let index = 0;
      let count = 0;
      while ((index = file.content.indexOf(find, index)) !== -1) {
        count += 1;
        index += find.length;
      }
      hits += count;
      files[path] = { ...file, content: file.content.split(find).join(replace) };
    }
    if (hits === 0) {
      notify(`No matches for “${find}”.`, 'info');
      return 0;
    }
    scheduleSave(touch({ ...current, files }));
    notify(`Replaced ${hits} ${hits === 1 ? 'match' : 'matches'} in ${Object.keys(files).length} files.`);
    return hits;
  },

  /**
   * Saves a project as a `.codeforge.json` download.
   *
   * Uses an object URL and a synthetic click rather than the File System
   * Access API: this has to work in every browser the app runs in, including
   * the ones embedded in other apps.
   */
  exportProject(): string | null {
    const current = projectStore.get().project;
    if (!current) return null;
    const text = serializeProject(current);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = exportFileName(current.name);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    // Revoking immediately can cancel the download in Safari.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    notify(`Exported ${exportFileName(current.name)}.`);
    return text;
  },

  /**
   * Reads an imported file and opens it as a **new** project.
   *
   * Never overwrites: the id is always fresh, so importing the same backup
   * twice gives two projects and neither one can destroy the other.
   */
  async importProject(text: string): Promise<Project | null> {
    const result = parseProject(text);
    if (!result.ok) {
      notify(result.error, 'error');
      return null;
    }
    const project = settleProject(result.project);
    projectStore.set((prev) => ({ ...prev, project, dirty: false, error: null }));
    resetHistory();
    await persist(project);
    notify(`Imported “${project.name}”.`);
    return project;
  },

  setAccent(accent: AccentId): void {
    const current = projectStore.get().project;
    if (!current) return;
    scheduleSave(touch({ ...current, accent }));
  },

  setEditorTheme(theme: EditorThemeId): void {
    projectActions.updateSettings({ theme });
  },

  dismissNotice(): void {
    projectStore.set((prev) => (prev.notice ? { ...prev, notice: null } : prev));
  },

  /**
   * The path a new file or folder should be created under, given what the
   * explorer currently has selected.
   */
  containerFor(selected: string | null): string {
    const current = projectStore.get().project;
    if (!current || !selected) return '';
    if (allFolders(current).has(selected)) return selected;
    return parentOf(selected);
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
