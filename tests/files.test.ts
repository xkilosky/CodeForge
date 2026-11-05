/**
 * Files, folders and the tree.
 *
 * This is the milestone's core claim: a flat `Record<path, file>` can be
 * presented as a real tree, and every operation on it — create, rename, move,
 * delete, duplicate — is a pure function of the map. If that is true the UI is
 * just a view; if it is not, the UI is where the bugs live.
 *
 * The store actions are exercised too, because renaming a folder is the one
 * operation that touches three fields at once (`files`, `folders`,
 * `activeFile`) and getting two of them right is a project that half-loads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../src/core/types';
import { projectFromTemplate, templateById } from '../src/core/templates';

const rows = new Map<string, Project>();

vi.mock('../src/core/idb', () => ({
  db: {
    listProjects: async () => [...rows.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    getProject: async (id: string) => rows.get(id),
    putProject: async (project: Project) => {
      rows.set(project.id, project);
      return project.id;
    },
    deleteProject: async (id: string) => {
      rows.delete(id);
      return undefined;
    },
  },
}));

const { projectActions, projectStore, settleProject } = await import('../src/core/projectStore');
const workspace = await import('../src/core/workspace');

const {
  buildTree,
  normalizePath,
  parentOf,
  nameOf,
  extensionOf,
  ancestorsOf,
  isInside,
  pathProblem,
  freePath,
  remapPath,
  deleteFolder,
} = workspace;

function seed(): Project {
  const project = settleProject(projectFromTemplate(templateById('web-starter')!));
  rows.set(project.id, project);
  projectActions.open(project);
  return project;
}

function state(): Project {
  const project = projectStore.get().project;
  if (!project) throw new Error('no project open');
  return project;
}

beforeEach(() => {
  rows.clear();
  projectStore.set({
    project: null,
    recent: [],
    loading: false,
    dirty: false,
    error: null,
    undoDepth: 0,
    redoDepth: 0,
    notice: null,
  });
});

afterEach(() => vi.restoreAllMocks());

describe('paths', () => {
  it('normalises slashes and stray segments', () => {
    expect(normalizePath('  src/ui/  ')).toBe('src/ui');
    expect(normalizePath('src//ui///a.ts')).toBe('src/ui/a.ts');
    // A path pasted from Windows arrives with backslashes.
    expect(normalizePath('src\\ui\\a.ts')).toBe('src/ui/a.ts');
    expect(normalizePath('./src/./a.ts')).toBe('src/a.ts');
  });

  it('splits a path into the parts a tree needs', () => {
    expect(parentOf('src/ui/a.ts')).toBe('src/ui');
    expect(parentOf('a.ts')).toBe('');
    expect(nameOf('src/ui/a.ts')).toBe('a.ts');
    expect(nameOf('a.ts')).toBe('a.ts');
    expect(extensionOf('src/A.TS')).toBe('ts');
    expect(extensionOf('README')).toBe('');
    // `.env` is a name, not an extension.
    expect(extensionOf('.env')).toBe('');
  });

  it('lists every folder a path implies, outermost first', () => {
    expect(ancestorsOf('a/b/c.js')).toEqual(['a', 'a/b']);
    expect(ancestorsOf('a.js')).toEqual([]);
  });

  it('knows what is inside what, without matching prefixes by accident', () => {
    expect(isInside('src/a.js', 'src')).toBe(true);
    expect(isInside('src', 'src')).toBe(true);
    // `srcs/a.js` is not inside `src`; a bare startsWith would say it is.
    expect(isInside('srcs/a.js', 'src')).toBe(false);
  });

  it('refuses the paths that break a preview or an export', () => {
    expect(pathProblem('')).toMatch(/required/);
    expect(pathProblem('a/../b')).toMatch(/\.\./);
    expect(pathProblem('a<b.js')).toMatch(/cannot contain/);
    expect(pathProblem('a"b.js')).toMatch(/cannot contain/);
    expect(pathProblem(`${'x'.repeat(65)}.js`)).toMatch(/64/);
    expect(pathProblem('src/a.js')).toBeNull();
  });
});

describe('the tree', () => {
  it('shows folders the files imply, with the files inside them', () => {
    const tree = buildTree({
      files: {
        'index.html': { content: '', language: 'html' },
        'styles/style.css': { content: '', language: 'css' },
        'scripts/main.js': { content: '', language: 'javascript' },
      },
    });
    // Folders first, then files — the order every file explorer uses.
    expect(tree.map((node) => node.name)).toEqual(['scripts', 'styles', 'index.html']);
    const styles = tree.find((node) => node.name === 'styles');
    expect(styles?.kind).toBe('folder');
    if (styles?.kind === 'folder') {
      expect(styles.children).toHaveLength(1);
      expect(styles.children[0].name).toBe('style.css');
    }
  });

  it('nests as deep as the paths go', () => {
    const tree = buildTree({
      files: { 'a/b/c/d.js': { content: '', language: 'javascript' } },
    });
    // a > b > c, with d.js inside c: three folders deep.
    let depth = 0;
    let nodes = tree;
    for (;;) {
      const folder = nodes.find((node) => node.kind === 'folder');
      if (!folder || folder.kind !== 'folder') break;
      depth += 1;
      nodes = folder.children;
    }
    expect(depth).toBe(3);
  });

  it('keeps an empty folder visible instead of dropping it', () => {
    const tree = buildTree({
      files: { 'index.html': { content: '', language: 'html' } },
      folders: ['assets'],
    });
    const assets = tree.find((node) => node.name === 'assets');
    expect(assets?.kind).toBe('folder');
    if (assets?.kind === 'folder') {
      expect(assets.empty).toBe(true);
      expect(assets.children).toEqual([]);
    }
  });

  it('sorts names numerically and case-insensitively', () => {
    const tree = buildTree({
      files: {
        'file10.js': { content: '', language: 'javascript' },
        'file2.js': { content: '', language: 'javascript' },
        'File1.js': { content: '', language: 'javascript' },
      },
    });
    // numeric: 1, 2, 10 — not 1, 10, 2.
    expect(tree.map((node) => node.name)).toEqual(['File1.js', 'file2.js', 'file10.js']);
  });

  it('survives a project with no folders field at all', () => {
    // Every project written before this milestone looks like this.
    const tree = buildTree({ files: { 'a/b.js': { content: '', language: 'javascript' } } });
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('a');
  });
});

describe('creating and deleting', () => {
  it('creates a file, registers its folders, and opens it', () => {
    seed();
    expect(projectActions.addFile('src/ui/button.tsx')).toBe(true);
    const project = state();
    expect(project.files['src/ui/button.tsx']).toBeDefined();
    expect(project.activeFile).toBe('src/ui/button.tsx');
    // The folders must be real, not just implied by the path, or deleting the
    // file would leave a phantom folder in the tree.
    expect(project.folders).toEqual(expect.arrayContaining(['src', 'src/ui']));
  });

  it('refuses a duplicate name instead of overwriting content', () => {
    seed();
    const before = state().files['index.html'].content;
    expect(projectActions.addFile('index.html')).toBe(false);
    expect(state().files['index.html'].content).toBe(before);
    expect(projectStore.get().notice?.tone).toBe('error');
  });

  it('refuses to create a file where a folder already is', () => {
    seed();
    projectActions.createFolder('assets');
    expect(projectActions.addFile('assets')).toBe(false);
    expect(projectStore.get().notice?.text).toMatch(/already exists/);
  });

  it('moves the editor to another file when the open one is deleted', () => {
    seed();
    projectActions.setActiveFile('index.html');
    projectActions.removeFile('index.html');
    const project = state();
    expect(project.files['index.html']).toBeUndefined();
    // Never leave the editor pointed at a file that is gone.
    expect(project.activeFile).not.toBe('index.html');
    expect(project.files[project.activeFile]).toBeDefined();
  });

  it('deletes a folder, its files and its subfolders together', () => {
    seed();
    projectActions.addFile('src/ui/a.tsx');
    projectActions.addFile('src/ui/b.tsx');
    projectActions.addFile('src/index.ts');
    projectActions.addFile('keep.js');

    projectActions.removeFolder('src');

    const project = state();
    expect(Object.keys(project.files).sort()).toEqual(['index.html', 'keep.js', 'scripts/main.js', 'styles/style.css'].sort());
    expect(project.folders ?? []).not.toContain('src');
    expect(project.folders ?? []).not.toContain('src/ui');
  });

  it('returns to a real file when the folder holding the open file is deleted', () => {
    seed();
    projectActions.addFile('src/ui/a.tsx');
    projectActions.removeFolder('src');
    const project = state();
    expect(project.files[project.activeFile]).toBeDefined();
  });

  it('creates an empty folder that survives a reload', () => {
    seed();
    const created = projectActions.createFolder('assets');
    expect(created).toBe('assets');
    // A round trip through storage is what "survives a reload" means.
    const saved = settleProject({ ...state(), folders: [...(state().folders ?? [])] });
    expect(saved.folders).toContain('assets');
  });

  it('refuses a folder that already exists', () => {
    seed();
    expect(projectActions.createFolder('styles')).toBeNull();
    expect(projectStore.get().notice?.text).toMatch(/already exists/);
  });
});

describe('renaming', () => {
  it('renames a file and follows it with the editor', () => {
    seed();
    projectActions.setActiveFile('index.html');
    expect(projectActions.renamePath('index.html', 'home.html')).toBe(true);
    const project = state();
    expect(project.files['home.html']).toBeDefined();
    expect(project.files['index.html']).toBeUndefined();
    expect(project.activeFile).toBe('home.html');
  });

  it('carries a folder’s contents and repoints the open file', () => {
    seed();
    projectActions.setActiveFile('styles/style.css');
    expect(projectActions.renamePath('styles', 'css')).toBe(true);
    const project = state();
    expect(project.files['css/style.css']).toBeDefined();
    expect(project.files['styles/style.css']).toBeUndefined();
    expect(project.activeFile).toBe('css/style.css');
  });

  it('refuses to rename onto an existing file', () => {
    seed();
    expect(projectActions.renamePath('index.html', 'scripts/main.js')).toBe(false);
    // Both files must still be there, with their own content: a refused rename
    // changes nothing at all.
    expect(state().files['index.html']).toBeDefined();
    expect(state().files['scripts/main.js'].content).toContain('console.log');
    expect(projectStore.get().notice?.tone).toBe('error');
  });

  it('refuses to move a folder into itself', () => {
    seed();
    projectActions.addFile('src/ui/a.tsx');
    expect(projectActions.renamePath('src', 'src/ui/inner')).toBe(false);
    expect(state().files['src/ui/a.tsx']).toBeDefined();
  });

  it('renames an empty folder without inventing a file in it', () => {
    seed();
    projectActions.createFolder('assets');
    expect(projectActions.renamePath('assets', 'public')).toBe(true);
    const project = state();
    expect(project.folders).toContain('public');
    expect(project.folders).not.toContain('assets');
    expect(Object.keys(project.files).some((path) => path.startsWith('public/'))).toBe(false);
  });

  it('moves a file between folders, which is what drag-and-drop is', () => {
    seed();
    expect(projectActions.renamePath('scripts/main.js', 'src/main.js')).toBe(true);
    expect(state().files['src/main.js']).toBeDefined();
    expect(state().folders).toEqual(expect.arrayContaining(['src']));
  });

  it('does nothing when the name did not change', () => {
    seed();
    expect(projectActions.renamePath('index.html', 'index.html')).toBe(false);
  });
});

describe('duplicate and replace', () => {
  it('copies a file beside the original, keeping the extension', () => {
    seed();
    const copy = projectActions.duplicateFile('index.html');
    expect(copy).toBe('index copy.html');
    expect(state().files['index copy.html'].content).toBe(state().files['index.html'].content);
  });

  it('never collides on a second copy', () => {
    seed();
    projectActions.duplicateFile('index.html');
    const second = projectActions.duplicateFile('index.html');
    expect(second).toBe('index copy 2.html');
  });

  it('replaces across every file and counts every occurrence', () => {
    seed();
    projectActions.addFile('a.txt', 'zzz zzz');
    projectActions.addFile('b.txt', 'zzz');
    // Occurrences, not files: the count is what the user will try to verify.
    const hits = projectActions.replaceInFiles('zzz', 'yyy');
    expect(hits).toBe(3);
    expect(state().files['a.txt'].content).toBe('yyy yyy');
    expect(state().files['b.txt'].content).toBe('yyy');
  });

  it('reports no matches instead of touching anything', () => {
    seed();
    const before = state().files['index.html'].content;
    expect(projectActions.replaceInFiles('nothing-like-this', 'x')).toBe(0);
    expect(state().files['index.html'].content).toBe(before);
    expect(projectStore.get().notice?.tone).toBe('info');
  });
});

describe('helpers', () => {
  it('finds a free name rather than overwriting', () => {
    expect(freePath([], 'a.js')).toBe('a.js');
    expect(freePath(['a.js'], 'a.js')).toBe('a copy.js');
    expect(freePath(['a.js', 'a copy.js'], 'a.js')).toBe('a copy 2.js');
    expect(freePath(['src/a.js'], 'src/a.js')).toBe('src/a copy.js');
  });

  it('remaps only the paths under the target', () => {
    expect(remapPath('a/b.js', 'a', 'c')).toBe('c/b.js');
    expect(remapPath('a.js', 'a', 'c')).toBe('a.js');
    expect(remapPath('ab/c.js', 'a', 'c')).toBe('ab/c.js');
  });

  it('deletes a folder without touching a sibling that shares a prefix', () => {
    const result = deleteFolder(
      {
        files: {
          'src/a.js': { content: '', language: 'javascript' },
          'srcs/b.js': { content: '', language: 'javascript' },
        },
        folders: ['src', 'srcs'],
      },
      'src',
    );
    expect(Object.keys(result.files)).toEqual(['srcs/b.js']);
    expect(result.folders).toEqual(['srcs']);
  });
});

describe('settleProject', () => {
  it('gives an old project the fields this build expects', () => {
    // Exactly the shape S1.5 wrote: no folders, no accent, stock Monaco theme.
    const old = {
      id: 'prj_old',
      name: 'Old',
      workspace: 'web' as const,
      files: { 'src/a.js': { content: 'x', language: 'javascript' as const } },
      activeFile: 'src/a.js',
      settings: { theme: 'vs-dark' as const, autorun: true },
      createdAt: 1,
      updatedAt: 1,
    };
    const settled = settleProject(old);
    expect(settled.folders).toEqual(['src']);
    expect(settled.accent).toBe('blue');
    // The old theme id is kept as-is; resolveEditorTheme() maps it forward, so
    // no migration pass over IndexedDB is needed.
    expect(settled.settings.theme).toBe('vs-dark');
  });

  it('does not duplicate folders that are both explicit and implied', () => {
    const settled = settleProject({
      id: 'p',
      name: 'P',
      workspace: 'web',
      files: { 'src/a.js': { content: '', language: 'javascript' } },
      folders: ['src'],
      activeFile: 'src/a.js',
      settings: { theme: 'tokyo-night', autorun: true },
      accent: 'teal',
      createdAt: 1,
      updatedAt: 1,
    });
    expect(settled.folders).toEqual(['src']);
    expect(settled.accent).toBe('teal');
  });
});
