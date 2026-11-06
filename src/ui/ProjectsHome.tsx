/**
 * The projects home.
 *
 * This screen exists because of a dead end: once a project was open there was no
 * way out of it. The top bar could create projects, but nothing listed them, so
 * a returning user could not reopen yesterday's work and could not get rid of a
 * project they did not want — the app opened the most recent project forever.
 *
 * Two jobs, in this order:
 *   1. Get back into work already done (open, duplicate, delete).
 *   2. Start something new (the template grid).
 *
 * Everything here is local. There is no account, so there is no "sign in" and
 * nothing to sync; the list is whatever IndexedDB holds.
 */
import { useRef, useState, type KeyboardEvent } from 'react';
import { TEMPLATES } from '../core/templates';
import type { Project } from '../core/types';
import { RUNTIMES } from '../runtimes/registry';
import { WORKSPACE_LABEL, describeAge } from './labels';
import { BrandMark } from './BrandMark';
import { currentRelease } from '../core/release';
import { accentHex } from '../core/theme';
import {
  ChevronIcon,
  CloseIcon,
  CodeIcon,
  CopyIcon,
  LayoutIcon,
  PlusIcon,
  SearchIcon,
  TerminalIcon,
  TrashIcon,
} from './icons';

interface ProjectsHomeProps {
  recent: Project[];
  /** The project the user was last inside, highlighted so it is easy to spot. */
  currentId: string | null;
  loading: boolean;
  error: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onCreate: (templateId?: string) => void;
  /** Brings a `.codeforge.json` back as a new project. */
  onImport: (file: File) => void;
  onDismissError: () => void;
}

const available = new Set(RUNTIMES.filter((runtime) => runtime.available).map((r) => r.id));

function fileCount(project: Project): number {
  return Object.keys(project.files ?? {}).length;
}

/** Folders that exist only as prefixes of a file path still count. */
function folderCount(project: Project): number {
  const folders = new Set(project.folders ?? []);
  for (const path of Object.keys(project.files ?? {})) {
    const parts = path.split('/').slice(0, -1);
    for (let i = 0; i < parts.length; i += 1) folders.add(parts.slice(0, i + 1).join('/'));
  }
  return folders.size;
}

type WorkspaceFilter = Project['workspace'] | 'all';
type ProjectSort = 'recent' | 'name';

/** Search and order a copy so the store's recents remain untouched. */
export function filterAndSortProjects(
  projects: Project[],
  query: string,
  workspace: WorkspaceFilter,
  sort: ProjectSort,
): Project[] {
  const needle = query.trim().toLocaleLowerCase();
  return projects
    .filter((project) => {
      if (workspace !== 'all' && project.workspace !== workspace) return false;
      if (!needle) return true;
      const searchable = `${project.name} ${project.workspace} ${WORKSPACE_LABEL[project.workspace]}`;
      return searchable.toLocaleLowerCase().includes(needle);
    })
    .slice()
    .sort((a, b) => {
      if (sort === 'name') {
        const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        if (byName !== 0) return byName;
      }
      return b.updatedAt - a.updatedAt || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
}

/** One row in "Your projects". */
function ProjectRow({
  project,
  current,
  onOpen,
  onDelete,
  onDuplicate,
}: {
  project: Project;
  current: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  // Delete is destructive and there is no undo (no server, no trash), so it
  // takes two taps. The confirmation is inline rather than a browser `confirm`,
  // which is blocked in some embedded browsers and looks like a page error.
  const [confirming, setConfirming] = useState(false);

  return (
    <li
      className={`project-row${current ? ' current' : ''}`}
      // The accent is a saved id, so the dot is drawn from the same palette the
      // project will open with rather than from a value copied at creation.
      style={{ '--accent': accentHex(project.accent) } as React.CSSProperties}
    >
      <button className="project-open" onClick={onOpen}>
        <span className="project-title">
          <span className="project-name-text">{project.name}</span>
          {current ? <span className="project-current-chip">recent</span> : null}
        </span>
        <span className="project-meta">
          <span className={`workspace-tag ${project.workspace}`}>
            {WORKSPACE_LABEL[project.workspace] ?? project.workspace}
          </span>
          {folderCount(project) > 0 ? (
            <span className="muted">
              {folderCount(project)} {folderCount(project) === 1 ? 'folder' : 'folders'}
            </span>
          ) : null}
          <span className="muted">
            {fileCount(project)} {fileCount(project) === 1 ? 'file' : 'files'}
          </span>
          <span className="muted">{describeAge(project.updatedAt)}</span>
        </span>
      </button>

      <div className="project-actions">
        <button
          className="btn ghost project-action"
          onClick={onDuplicate}
          title="Make a copy"
          aria-label={`Duplicate ${project.name}`}
        >
          <CopyIcon size={15} />
        </button>
        {confirming ? (
          <span className="project-confirm">
            <button
              className="btn danger project-action"
              onClick={onDelete}
              aria-label={`Delete ${project.name} permanently`}
            >
              Delete
            </button>
            <button
              className="btn ghost project-action"
              onClick={() => setConfirming(false)}
              aria-label="Keep project"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            className="btn ghost project-action project-delete-action"
            onClick={() => setConfirming(true)}
            title="Delete"
            aria-label={`Delete ${project.name}`}
          >
            <TrashIcon size={15} />
          </button>
        )}
      </div>
    </li>
  );
}

export function ProjectsHome({
  recent,
  currentId,
  loading,
  error,
  onOpen,
  onDelete,
  onDuplicate,
  onCreate,
  onImport,
  onDismissError,
}: ProjectsHomeProps) {
  // Sorted newest first by the store, but `recent` can be stale while a project
  // is open, so never rely on order to decide what is most relevant.
  const projects = recent;
  const release = currentRelease();
  const importRef = useRef<HTMLInputElement | null>(null);
  const projectSearchRef = useRef<HTMLInputElement | null>(null);
  const [projectQuery, setProjectQuery] = useState('');
  const [workspaceFilter, setWorkspaceFilter] = useState<WorkspaceFilter>('all');
  const [projectSort, setProjectSort] = useState<ProjectSort>('recent');
  const visibleProjects = filterAndSortProjects(projects, projectQuery, workspaceFilter, projectSort);
  const hasProjectFilters = projectQuery.trim() !== '' || workspaceFilter !== 'all';

  function handleHomeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== '/' || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
    ) return;
    event.preventDefault();
    projectSearchRef.current?.focus();
  }

  function clearProjectFilters() {
    setProjectQuery('');
    setWorkspaceFilter('all');
  }

  return (
    <div className="home" onKeyDown={handleHomeKeyDown}>
      <div className="home-inner">
        <header className="home-head">
          <p className="home-eyebrow">
            <span className="home-eyebrow-dot" /> LOCAL-FIRST DEVELOPMENT STUDIO
          </p>
          <h1>
            <BrandMark size={30} /> {release.title}
          </h1>
          <p className="release-line">
            <span className="release-channel">{release.channel}</span>
            <span className="release-milestone">{release.milestone}</span>
          </p>
          <p className="muted home-intro">
            A coding environment that runs entirely in this browser. Everything is stored on this
            device — no account, no server. Export a project to keep a copy.
          </p>
        </header>

        {error ? (
          <div className="home-error" role="alert">
            <span>{error}</span>
            <button className="btn ghost" onClick={onDismissError}>
              Dismiss
            </button>
          </div>
        ) : null}

        <div className="home-dashboard">
          <section className="home-section home-projects" aria-labelledby="home-projects-heading">
            <h2 id="home-projects-heading" className="home-heading">
              Your projects
              <span className="muted home-count">{loading ? '' : projects.length}</span>
            </h2>

            {!loading && projects.length > 0 ? (
              <>
                <div className="project-tools" role="search" aria-label="Filter saved projects">
                  <div className="project-search">
                    <SearchIcon size={15} />
                    <input
                      ref={projectSearchRef}
                      type="text"
                      value={projectQuery}
                      onChange={(event) => setProjectQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape' && projectQuery) setProjectQuery('');
                      }}
                      placeholder="Search by name or workspace"
                      aria-label="Search projects by name or workspace"
                      aria-keyshortcuts="/"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {projectQuery ? (
                      <button
                        type="button"
                        className="project-search-clear"
                        onClick={() => setProjectQuery('')}
                        aria-label="Clear project search"
                        title="Clear search"
                      >
                        <CloseIcon size={13} />
                      </button>
                    ) : (
                      <kbd className="project-search-hint" aria-hidden="true">/</kbd>
                    )}
                  </div>
                  <label className="project-select-wrap">
                    <span className="visually-hidden">Filter by workspace</span>
                    <select
                      aria-label="Filter by workspace"
                      value={workspaceFilter}
                      onChange={(event) => setWorkspaceFilter(event.target.value as WorkspaceFilter)}
                    >
                      <option value="all">All workspaces</option>
                      {(Object.keys(WORKSPACE_LABEL) as Project['workspace'][]).map((workspace) => (
                        <option key={workspace} value={workspace}>{WORKSPACE_LABEL[workspace]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="project-select-wrap project-sort-wrap">
                    <span className="visually-hidden">Sort projects</span>
                    <select
                      aria-label="Sort projects"
                      value={projectSort}
                      onChange={(event) => setProjectSort(event.target.value as ProjectSort)}
                    >
                      <option value="recent">Recently updated</option>
                      <option value="name">Name A–Z</option>
                    </select>
                  </label>
                </div>
                {hasProjectFilters ? (
                  <div className="project-results-status" role="status" aria-live="polite">
                    <span>Showing {visibleProjects.length} of {projects.length} projects</span>
                    <button className="text-button" onClick={clearProjectFilters}>Clear filters</button>
                  </div>
                ) : null}
              </>
            ) : null}

            {loading ? (
              <p className="muted home-empty">Loading…</p>
            ) : projects.length === 0 ? (
              <p className="muted home-empty">
                Nothing here yet. Pick a template below and it will be saved automatically.
              </p>
            ) : visibleProjects.length === 0 ? (
              <p className="muted home-empty project-no-results">No projects match the current filters.</p>
            ) : (
              <ul className="project-list">
                {visibleProjects.map((project) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    current={project.id === currentId}
                    onOpen={() => onOpen(project.id)}
                    onDelete={() => onDelete(project.id)}
                    onDuplicate={() => onDuplicate(project.id)}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="home-section home-create" aria-labelledby="home-new-heading">
            <h2 id="home-new-heading" className="home-heading">
              Start something new
              <span className="home-heading-actions">
                <button className="btn ghost small" onClick={() => importRef.current?.click()}>
                  Import a project
                </button>
                <input
                  ref={importRef}
                  type="file"
                  className="visually-hidden"
                  accept="application/json,.json"
                  aria-label="Import a project file"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onImport(file);
                    event.target.value = '';
                  }}
                />
              </span>
            </h2>
            <div className="create-project-prompt">
              <div>
                <strong>Give it a name and make it yours.</strong>
                <p className="muted">Choose a starter, name your project, then set editor and preview preferences.</p>
              </div>
              <button className="btn primary" onClick={() => onCreate()}>
                <PlusIcon size={15} /> Create project
              </button>
            </div>
            <div className="template-grid">
              {TEMPLATES.map((template) => {
                // Availability comes from the runtime registry, never from the
                // template's own milestone label.
                const enabled = available.has(template.workspace);
                const TemplateIcon = template.workspace === 'game'
                  ? LayoutIcon
                  : template.workspace === 'python'
                    ? TerminalIcon
                    : CodeIcon;
                return (
                  <button
                    key={template.id}
                    className={`template-card${enabled ? '' : ' disabled'} ${template.workspace}`}
                    onClick={() => onCreate(template.id)}
                    disabled={!enabled}
                  >
                    <span className="template-top">
                      <span className="template-card-title">
                        <span className={`template-icon ${template.workspace}`}>
                          <TemplateIcon size={16} />
                        </span>
                        <span className="template-label">{template.label}</span>
                      </span>
                      <span className={`workspace-tag ${template.workspace}`}>
                        {WORKSPACE_LABEL[template.workspace] ?? template.workspace}
                      </span>
                    </span>
                    <span className="template-desc">{template.description}</span>
                    {enabled ? (
                      <span className="template-cta">
                        Start with this template <ChevronIcon size={14} />
                      </span>
                    ) : (
                      <span className="template-milestone">
                        {RUNTIMES.find((r) => r.id === template.workspace)?.unavailableReason ??
                          'Not available yet'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
