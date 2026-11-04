import { useEffect, useRef, useState } from 'react';
import type { Project, WorkspaceId } from '../core/types';
import { TEMPLATES } from '../core/templates';
import { RUNTIMES } from '../runtimes/registry';
import { WORKSPACE_LABEL } from './labels';

interface TopBarProps {
  project: Project | null;
  dirty: boolean;
  running: boolean;
  onRename: (name: string) => void;
  onRun: () => void;
  onStop: () => void;
  onToggleAutorun: () => void;
  /** Creates a project from a template id and opens it. */
  onCreate: (templateId: string) => void;
  /** Switches the open project to another workspace. */
  onSwitchWorkspace: (workspace: WorkspaceId) => void;
  /** Closes the open project and returns to the projects home. */
  onExit: () => void;
}

/**
 * The "+ New" menu.
 *
 * A native `<select>` was the previous control and it was the wrong shape for
 * this job: on a phone it opens an OS picker that hides the app, it cannot show
 * a description, and it reads as a form field rather than a command. This is a
 * button that opens a list.
 */
function NewProjectMenu({ onCreate }: { onCreate: (templateId: string) => void }) {
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Click-away and Escape both close it. Without the click-away the menu covers
  // the editor and there is no obvious way to dismiss it on a phone.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!hostRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // One entry per template, grouped by workspace, using the real template ids.
  // Synthesising ids from runtime ids is what made this menu create nothing.
  const groups = RUNTIMES.map((runtime) => ({
    runtime,
    templates: TEMPLATES.filter((template) => template.workspace === runtime.id),
  })).filter((group) => group.templates.length > 0);

  return (
    <div className="new-menu" ref={hostRef}>
      <button
        className="btn new-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        + New
      </button>

      {open ? (
        <div className="new-menu-list" role="menu">
          {groups.map(({ runtime, templates }) => (
            <div key={runtime.id} className="new-menu-group" role="group" aria-label={runtime.label}>
              <div className="new-menu-group-head">
                {runtime.label}
                {!runtime.available ? <span className="soon">soon</span> : null}
              </div>
              {templates.map((template) => (
                <button
                  key={template.id}
                  className="new-menu-item"
                  role="menuitem"
                  disabled={!runtime.available}
                  title={runtime.available ? template.description : runtime.unavailableReason}
                  onClick={() => {
                    setOpen(false);
                    onCreate(template.id);
                  }}
                >
                  <span className="new-menu-item-label">{template.label}</span>
                  <span className="new-menu-item-desc">
                    {runtime.available ? template.description : runtime.unavailableReason}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function TopBar({
  project,
  dirty,
  running,
  onRename,
  onRun,
  onStop,
  onToggleAutorun,
  onCreate,
  onSwitchWorkspace,
  onExit,
}: TopBarProps) {
  return (
    /* `has-project` lets the phone layout drop the brand mark only when the
       project name and exit control need that width. Without it the home
       screen would open with an empty left corner. */
    <header className={`topbar${project ? ' has-project' : ''}`}>
      <button
        className="brand brand-btn"
        onClick={onExit}
        title={project ? 'Back to your projects' : 'Projects'}
        aria-label={project ? 'Back to your projects' : 'Projects'}
      >
        <span className="brand-mark" aria-hidden="true">
          ⚒
        </span>
        <span className="brand-name">CodeForge</span>
      </button>

      <nav className="workspace-tabs" aria-label="Workspaces">
        {RUNTIMES.map((runtime) => {
          const active = project?.workspace === runtime.id;
          return (
            <button
              key={runtime.id}
              className={`workspace-tab${active ? ' active' : ''}`}
              disabled={!runtime.available}
              title={runtime.available ? runtime.label : runtime.unavailableReason}
              onClick={() => {
                if (runtime.available) onSwitchWorkspace(runtime.id as WorkspaceId);
              }}
            >
              {runtime.label}
              {!runtime.available ? <span className="soon">soon</span> : null}
            </button>
          );
        })}
      </nav>

      <div className="topbar-spacer" />

      {project ? (
        <>
          <input
            className="project-name"
            value={project.name}
            onChange={(e) => onRename(e.target.value)}
            aria-label="Project name"
            spellCheck={false}
          />
          <span className="workspace-chip">{WORKSPACE_LABEL[project.workspace]}</span>
          <span className={`save-state${dirty ? ' dirty' : ''}`}>
            {dirty ? 'saving…' : 'saved'}
          </span>
        </>
      ) : null}

      {/* Run controls only make sense with a project open; showing them on the
          projects home would offer to run nothing. */}
      {project ? (
        <div className="run-controls">
          <button className="btn primary" onClick={onRun} title="Run (Ctrl+Enter)">
            ▶ Run
          </button>
          <button className="btn" onClick={onStop} disabled={!running} title="Stop">
            ■<span className="btn-label"> Stop</span>
          </button>
          <label className="autorun" title="Rebuild the preview as you type">
            <input
              type="checkbox"
              checked={project.settings.autorun}
              onChange={onToggleAutorun}
            />
            Auto
          </label>
        </div>
      ) : null}

      <NewProjectMenu onCreate={onCreate} />

      {project ? (
        <button
          className="btn ghost exit-btn"
          onClick={onExit}
          title="Close this project and go back to your projects"
        >
          <span aria-hidden="true">‹</span>
          <span className="exit-label">Projects</span>
        </button>
      ) : null}
    </header>
  );
}
