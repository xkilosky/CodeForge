import type { Project, WorkspaceId } from '../core/types';
import { RUNTIMES } from '../runtimes/registry';

interface TopBarProps {
  project: Project | null;
  dirty: boolean;
  running: boolean;
  onRename: (name: string) => void;
  onRun: () => void;
  onStop: () => void;
  onToggleAutorun: () => void;
  onCreate: (templateId: string) => void;
}

const WORKSPACE_LABEL: Record<WorkspaceId, string> = {
  roblox: 'Roblox',
  web: 'Web',
  game: 'Games',
  python: 'Languages',
  blank: 'Blank',
};

export function TopBar({
  project,
  dirty,
  running,
  onRename,
  onRun,
  onStop,
  onToggleAutorun,
  onCreate,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          ⚒
        </span>
        <span className="brand-name">CodeForge</span>
      </div>

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
                /* workspace switching happens through the template picker in M0 */
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

      <div className="run-controls">
        <button className="btn primary" onClick={onRun} title="Run (Ctrl+Enter)">
          ▶ Run
        </button>
        <button className="btn" onClick={onStop} disabled={!running}>
          ■ Stop
        </button>
        <label className="autorun" title="Rebuild the preview as you type">
          <input type="checkbox" checked={project?.settings.autorun ?? true} onChange={onToggleAutorun} />
          Auto
        </label>
      </div>

      <select
        className="btn select"
        value=""
        onChange={(e) => {
          if (e.target.value) onCreate(e.target.value);
        }}
        aria-label="New project from template"
      >
        <option value="">New…</option>
        {RUNTIMES.filter((r) => r.available).map((r) => (
          <option key={r.id} value={`${r.id}-starter`}>
            {r.label} starter
          </option>
        ))}
      </select>
    </header>
  );
}
