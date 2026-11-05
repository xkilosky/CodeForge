/**
 * The top bar, after the drawer took over navigation.
 *
 * It used to be the only UI in the app: brand, three workspace tabs, a name
 * field, a save state, Run / Stop / Auto, "+ New" and an exit button, all at
 * once. On a phone that did not fit, so half of it was hidden and the app had
 * no navigation left. Now the bar carries only what acts on the current thing,
 * and the drawer carries the map.
 */
import { useEffect, useRef, useState } from 'react';
import type { Project } from '../core/types';
import { TEMPLATES } from '../core/templates';
import { RUNTIMES } from '../runtimes/registry';
import { WORKSPACE_LABEL } from './labels';
import { BrandMark } from './BrandMark';
import { currentRelease } from '../core/release';
import { MenuIcon, PlayIcon, SearchIcon, StopIcon } from './icons';
import { accentHex } from '../core/theme';

interface TopBarProps {
  project: Project | null;
  dirty: boolean;
  running: boolean;
  onRename: (name: string) => void;
  onRun: () => void;
  onStop: () => void;
  /** Opens the "+ New" menu, which creates a project from a template. */
  onCreate: (templateId: string) => void;
  /** Opens the projects home. */
  onExit: () => void;
  /** Opens the drawer. */
  onOpenDrawer: () => void;
  onOpenSearch: () => void;
}

/**
 * The "+ New" menu.
 *
 * A native `<select>` was the previous control and it was the wrong shape: on a
 * phone it opens an OS picker that hides the app, it cannot show a description,
 * and it reads as a form field rather than a command. This is a button that
 * opens a list.
 */
function NewProjectMenu({ onCreate }: { onCreate: (templateId: string) => void }) {
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

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
  onCreate,
  onExit,
  onOpenDrawer,
  onOpenSearch,
}: TopBarProps) {
  const release = currentRelease();
  // The accent is a per-project CSS variable rather than a class, so a saved
  // accent id cannot fall out of sync with a stylesheet rule that was renamed.
  const accent = accentHex(project?.accent);
  const style = project ? ({ '--accent': accent } as React.CSSProperties) : undefined;

  return (
    <header className={`topbar${project ? ' has-project' : ''}`} style={style}>
      <button
        className="drawer-btn"
        onClick={onOpenDrawer}
        aria-label="Open the drawer"
        title="Files and sections (Ctrl+B)"
      >
        <MenuIcon size={17} />
      </button>

      <button
        className="brand brand-btn"
        onClick={onExit}
        title={`${release.title} — ${release.channel}. ${project ? 'Back to your projects' : 'Your projects'}`}
        aria-label={`${release.title}. ${project ? 'Back to your projects' : 'Projects'}`}
      >
        <BrandMark size={22} />
        <span className="brand-name">CodeForge</span>
        {/* The tag rides on the brand: the bar has no room for a ninth control
            on a phone, and the full title is in the tooltip. */}
        <span className="brand-version">{release.tag}</span>
      </button>

      {project ? (
        <div className="topbar-file">
          <input
            className="project-name"
            value={project.name}
            onChange={(event) => onRename(event.target.value)}
            aria-label="Project name"
            spellCheck={false}
          />
          <span className="workspace-chip">{WORKSPACE_LABEL[project.workspace]}</span>
          <span className={`save-state${dirty ? ' dirty' : ''}`}>
            {dirty ? 'saving…' : 'saved'}
          </span>
        </div>
      ) : null}

      <div className="topbar-spacer" />

      {project ? (
        <div className="run-controls">
          <button
            className="btn ghost icon-btn"
            onClick={onOpenSearch}
            title="Open a file (Ctrl+P)"
            aria-label="Open a file"
          >
            <SearchIcon size={15} />
          </button>
          <button className="btn primary" onClick={onRun} title="Run (Ctrl+Enter)">
            <PlayIcon size={12} />
            <span className="btn-label"> Run</span>
          </button>
          <button className="btn" onClick={onStop} disabled={!running} title="Stop">
            <StopIcon size={12} />
            <span className="btn-label"> Stop</span>
          </button>
        </div>
      ) : null}

      <NewProjectMenu onCreate={onCreate} />
    </header>
  );
}
