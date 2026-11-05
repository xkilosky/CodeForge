/** The project action bar. The project switch/exit control stays explicit on phones. */
import type { Project } from '../core/types';
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
  onNewProject: () => void;
  onExit: () => void;
  onOpenDrawer: () => void;
  onOpenSearch: () => void;
}

export function TopBar({
  project,
  dirty,
  running,
  onRename,
  onRun,
  onStop,
  onNewProject,
  onExit,
  onOpenDrawer,
  onOpenSearch,
}: TopBarProps) {
  const release = currentRelease();
  const accent = accentHex(project?.accent);
  const style = project ? ({ '--accent': accent } as React.CSSProperties) : undefined;

  return (
    <header className={`topbar${project ? ' has-project' : ''}`} style={style}>
      {project ? (
        <button
          className="btn ghost exit-btn"
          onClick={onExit}
          title="Close this project and return to your projects"
          aria-label="Exit project and return to Projects"
        >
          <span aria-hidden="true">←</span><span className="exit-label">Projects</span>
        </button>
      ) : null}

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
            <PlayIcon size={12} /><span className="btn-label"> Run</span>
          </button>
          <button className="btn" onClick={onStop} disabled={!running} title="Stop">
            <StopIcon size={12} /><span className="btn-label"> Stop</span>
          </button>
        </div>
      ) : null}

      <button className="btn new-btn" onClick={onNewProject} title="Create a named project from a starter or blank template">
        + <span className="new-btn-label">New project</span><span className="new-btn-short">New</span>
      </button>
    </header>
  );
}
