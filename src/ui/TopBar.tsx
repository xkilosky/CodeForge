import type { Project, WorkspaceId } from '../core/types';
import { TEMPLATES } from '../core/templates';
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
  /** Switches the open project to another workspace. */
  onSwitchWorkspace: (workspace: WorkspaceId) => void;
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
  onSwitchWorkspace,
}: TopBarProps) {
  /**
   * The entry template for each workspace, so "New…" offers real templates.
   *
   * This used to synthesise ids as `${runtime.id}-starter`, which never matched
   * any actual template id (they are `web-starter`, `roblox-script`,
   * `roblox-physics`, …). `templateById` returned undefined and the handler
   * silently did nothing, so no workspace could be created from here at all.
   */
  const templatesByWorkspace = RUNTIMES.map((runtime) => {
    const entry = TEMPLATES.find((t) => t.workspace === runtime.id);
    return { runtime, template: entry };
  }).filter((entry): entry is { runtime: (typeof RUNTIMES)[number]; template: NonNullable<typeof entry.template> } =>
    Boolean(entry.template),
  );

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
        {templatesByWorkspace.map(({ runtime, template }) => (
          <option key={template.id} value={template.id}>
            {runtime.label} — {template.label}
          </option>
        ))}
      </select>
    </header>
  );
}
