/**
 * The projects home, and getting back out of a project.
 *
 * The bug behind these tests: once a project was open there was no way out.
 * The top bar could create projects but nothing listed them, so `init()` opened
 * the newest project forever and yesterday's work could not be reopened. Every
 * assertion below is about a dead end that used to exist.
 *
 * IndexedDB is faked rather than assumed: jsdom and Node have none, and the
 * open/duplicate/delete paths are exactly the ones that read and write it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import type { Project } from '../src/core/types';
import { projectFromTemplate, templateById } from '../src/core/templates';

const rows = new Map<string, Project>();

vi.mock('../src/core/idb', () => ({
  db: {
    listProjects: async () =>
      [...rows.values()].sort((a, b) => b.updatedAt - a.updatedAt),
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

const { projectActions, projectStore } = await import('../src/core/projectStore');
const { ProjectsHome, filterAndSortProjects } = await import('../src/ui/ProjectsHome');
const { CreateProjectDialog } = await import('../src/ui/CreateProjectDialog');
const { describeAge, WORKSPACE_LABEL } = await import('../src/ui/labels');

function seed(templateId: string, name?: string): Project {
  const project = projectFromTemplate(templateById(templateId)!, name);
  rows.set(project.id, project);
  return project;
}

function reset(): void {
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
}

beforeEach(reset);
afterEach(() => vi.restoreAllMocks());

describe('close — the way out of a project', () => {
  it('closes the open project so the home screen can be shown', () => {
    const project = seed('web-starter');
    projectActions.open(project);

    projectActions.close();

    expect(projectStore.get().project).toBeNull();
    expect(projectStore.get().dirty).toBe(false);
  });

  it('persists the last edit instead of losing it on the way out', async () => {
    const project = seed('web-starter');
    projectActions.open(project);
    projectActions.updateFile('index.html', '<h1>edited</h1>');

    projectActions.close();
    // close() persists synchronously-ish; give the promise a tick.
    await new Promise((r) => setTimeout(r, 0));

    expect(rows.get(project.id)!.files['index.html'].content).toBe('<h1>edited</h1>');
  });
});

describe('createFromTemplate options', () => {
  it('creates a named project with the selected advanced preferences', () => {
    const project = projectActions.createFromTemplate(
      templateById('web-starter')!,
      'Portfolio site',
      { accent: 'purple', theme: 'tokyo-storm', autorun: false },
    );

    expect(project.name).toBe('Portfolio site');
    expect(project.accent).toBe('purple');
    expect(project.settings).toEqual({ theme: 'tokyo-storm', autorun: false });
    expect(projectStore.get().project?.id).toBe(project.id);
  });
});

describe('openById', () => {
  it('reopens a project that is not the most recent one', async () => {
    const older = seed('web-starter', 'old web');
    seed('web-blank', 'new web');
    // Make the web project clearly older.
    older.updatedAt = Date.now() - 86_400_000;
    rows.set(older.id, older);

    await projectActions.openById(older.id);

    expect(projectStore.get().project!.id).toBe(older.id);
    expect(projectStore.get().project!.name).toBe('old web');
  });

  it('reports a project that no longer exists instead of opening nothing', async () => {
    await projectActions.openById('prj_missing');
    expect(projectStore.get().project).toBeNull();
    expect(projectStore.get().error).toMatch(/no longer exists/i);
  });

  it('clears a previous error when a project does open', async () => {
    const project = seed('web-starter');
    projectStore.set((prev) => ({ ...prev, error: 'something old' }));

    await projectActions.openById(project.id);

    expect(projectStore.get().error).toBeNull();
  });
});

describe('duplicate', () => {
  it('copies a project under a new id with independent files', async () => {
    const source = seed('web-starter', 'gravity test');

    const copy = (await projectActions.duplicate(source.id))!;

    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe('gravity test copy');
    expect(copy.workspace).toBe('web');
    expect(Object.keys(copy.files)).toEqual(Object.keys(source.files));

    // Editing the copy must not touch the original.
    copy.files['index.html'].content = '<!-- changed -->';
    expect(rows.get(source.id)!.files['index.html'].content).not.toBe('<!-- changed -->');
  });

  it('adds the copy to the project list', async () => {
    const source = seed('web-starter');
    await projectActions.duplicate(source.id);
    expect(projectStore.get().recent).toHaveLength(2);
  });

  it('refuses to duplicate something that is gone', async () => {
    expect(await projectActions.duplicate('prj_nope')).toBeNull();
    expect(projectStore.get().error).toMatch(/no longer exists/i);
  });
});

describe('remove', () => {
  it('deletes the project from storage and from the list', async () => {
    const a = seed('web-starter', 'a');
    seed('web-blank', 'b');
    projectActions.open(a);

    await projectActions.remove(a.id);

    expect(rows.has(a.id)).toBe(false);
    expect(projectStore.get().recent.map((p) => p.id)).not.toContain(a.id);
  });

  it('returns to the home screen rather than opening some other project', async () => {
    const a = seed('web-starter', 'a');
    seed('web-blank', 'b');
    projectActions.open(a);

    await projectActions.remove(a.id);

    // Silently opening project "b" would look like the delete did something else.
    expect(projectStore.get().project).toBeNull();
  });
});

describe('describeAge', () => {
  const now = 1_700_000_000_000;

  it('describes recent edits in human terms', () => {
    expect(describeAge(now - 5_000, now)).toBe('just now');
    expect(describeAge(now - 7 * 60_000, now)).toBe('7 min ago');
    expect(describeAge(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(describeAge(now - 24 * 3_600_000, now)).toBe('yesterday');
    expect(describeAge(now - 3 * 86_400_000, now)).toBe('3 days ago');
  });

  it('falls back to a date for anything older than a week', () => {
    expect(describeAge(now - 30 * 86_400_000, now)).toMatch(/\d/);
  });

  it('never returns a negative age for a future timestamp', () => {
    expect(describeAge(now + 60_000, now)).toBe('just now');
  });
});

describe('WORKSPACE_LABEL', () => {
  it('names every workspace the type system allows', () => {
    expect(Object.keys(WORKSPACE_LABEL).sort()).toEqual(
      ['blank', 'game', 'python', 'web'].sort(),
    );
  });
});

describe('CreateProjectDialog', () => {
  it('asks for a project name, a starter, and optional editor/preview preferences', () => {
    const html = renderToStaticMarkup(
      <CreateProjectDialog
        open
        initialTemplateId="web-blank"
        onClose={() => {}}
        onCreate={() => {}}
      />,
    );
    expect(html).toContain('Create a project');
    expect(html).toContain('aria-label="Project name"');
    expect(html).toContain('Project template');
    expect(html).toContain('Advanced options');
    expect(html).toContain('Project accent');
    expect(html).toContain('Editor theme');
    expect(html).toContain('Update the preview automatically while I edit');
  });
});

describe('ProjectsHome', () => {
  const noop = () => {};

  function render(props: Partial<Parameters<typeof ProjectsHome>[0]> = {}): string {
    return renderToStaticMarkup(
      <ProjectsHome
        recent={[]}
        currentId={null}
        loading={false}
        error={null}
        onOpen={noop}
        onDelete={noop}
        onDuplicate={noop}
        onCreate={noop}
        onImport={noop}
        onDismissError={noop}
        {...props}
      />,
    );
  }

  it('offers a named project creation path as well as starter templates', () => {
    const html = render();
    expect(html).toContain('Nothing here yet');
    expect(html).toContain('Start something new');
    expect(html).toContain('Create project');
    expect(html).toContain('Give it a name and make it yours.');
  });

  it('groups projects and creation into a responsive home dashboard', () => {
    const html = render();
    const projects = html.indexOf('home-section home-projects');
    const create = html.indexOf('home-section home-create');
    expect(html).toContain('home-dashboard');
    expect(projects).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(projects);

    const css = readFileSync('src/styles.css', 'utf8');
    expect(css).toContain('grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr)');
    expect(css).toContain('@media (max-width: 860px)');
    expect(css).toContain('.home-dashboard { grid-template-columns: minmax(0, 1fr); gap: 25px; }');
  });

  it('adds accessible search, workspace filtering, sorting, and a keyboard search shortcut', () => {
    const project = projectFromTemplate(templateById('web-starter')!, 'Portfolio');
    const html = render({ recent: [project] });
    expect(html).toContain('aria-label="Search projects by name or workspace"');
    expect(html).toContain('aria-keyshortcuts="/"');
    expect(html).toContain('aria-label="Filter by workspace"');
    expect(html).toContain('aria-label="Sort projects"');
    expect(html).toContain('All workspaces');
    expect(html).toContain('Recently updated');
  });

  it('searches by project name or workspace and filters without mutating recents', () => {
    const web = projectFromTemplate(templateById('web-starter')!, 'Portfolio');
    const game = projectFromTemplate(templateById('game-platformer')!, 'Tiny world');
    const python = projectFromTemplate(templateById('python-script')!, 'Data cleanup');
    const recents = [web, game, python];

    expect(filterAndSortProjects(recents, '  PORTFOLIO ', 'all', 'recent')).toEqual([web]);
    expect(filterAndSortProjects(recents, 'python', 'all', 'recent')).toEqual([python]);
    expect(filterAndSortProjects(recents, '', 'game', 'recent')).toEqual([game]);
    expect(recents).toEqual([web, game, python]);
  });

  it('sorts projects by name or recent activity', () => {
    const zebra = projectFromTemplate(templateById('web-starter')!, 'zebra');
    const alpha = projectFromTemplate(templateById('game-platformer')!, 'Alpha');
    zebra.updatedAt = 5;
    alpha.updatedAt = 2;

    expect(filterAndSortProjects([zebra, alpha], '', 'all', 'name')).toEqual([alpha, zebra]);
    expect(filterAndSortProjects([zebra, alpha], '', 'all', 'recent')).toEqual([zebra, alpha]);
  });

  it('lists saved projects with their workspace, age, and consistent vector actions', () => {
    const project = projectFromTemplate(templateById('web-starter')!, 'gravity');
    const html = render({ recent: [project] });

    expect(html).toContain('gravity');
    expect(html).toContain('Web');
    expect(html).toContain('3 files');
    expect(html).toContain('aria-label="Duplicate gravity"');
    expect(html).toContain('aria-label="Delete gravity"');
    expect(html).not.toContain('🗑');
    expect(html).not.toContain('⧉');
    expect(html).not.toContain('Nothing here yet');
  });

  it('marks the project the user was just in', () => {
    const project = projectFromTemplate(templateById('web-starter')!);
    const html = render({ recent: [project], currentId: project.id });
    expect(html).toContain('project-row current');
    expect(html).toContain('recent<');
  });

  it('offers every template with workspace identity and a clear next action', () => {
    const html = render();
    // Shipping templates and both "soon" ones are visible: hiding a template
    // entirely is how a workspace once became unreachable.
    for (const label of ['Web page', 'Platformer', 'Python script']) {
      expect(html, label).toContain(label);
    }
    expect(html).toContain('template-card disabled');
    expect(html).toContain('home-eyebrow');
    expect(html).toContain('LOCAL-FIRST DEVELOPMENT STUDIO');
    expect(html).toContain('template-icon web');
    expect(html).toContain('template-icon game');
    expect(html).toContain('Start with this template');
  });

  it('shows a storage error with a way to dismiss it', () => {
    const html = render({ error: 'QuotaExceededError' });
    expect(html).toContain('QuotaExceededError');
    expect(html).toContain('Dismiss');
  });

  it('says it is loading rather than claiming there are no projects', () => {
    const html = render({ loading: true });
    expect(html).toContain('Loading…');
    expect(html).not.toContain('Nothing here yet');
  });
});
