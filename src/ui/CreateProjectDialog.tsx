/**
 * Project creation form shared by the projects home and the editor top bar.
 * Choosing a starter is only the first step: the project gets its own name and
 * initial workspace/editor preferences before it is opened.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { TEMPLATES } from '../core/templates';
import { ACCENTS, EDITOR_THEMES, DEFAULT_ACCENT, type AccentId, type EditorThemeId } from '../core/theme';
import { RUNTIMES } from '../runtimes/registry';
import { WORKSPACE_LABEL } from './labels';

export interface NewProjectOptions {
  accent: AccentId;
  theme: EditorThemeId;
  autorun: boolean;
}

interface CreateProjectDialogProps {
  open: boolean;
  initialTemplateId: string | null;
  onClose: () => void;
  onCreate: (templateId: string, name: string, options: NewProjectOptions) => void;
}

const availableWorkspaces = new Set(RUNTIMES.filter((runtime) => runtime.available).map((runtime) => runtime.id));
const defaultTemplate = TEMPLATES.find((template) => availableWorkspaces.has(template.workspace)) ?? TEMPLATES[0];

export function CreateProjectDialog({ open, initialTemplateId, onClose, onCreate }: CreateProjectDialogProps) {
  const [templateId, setTemplateId] = useState(initialTemplateId ?? defaultTemplate.id);
  const [name, setName] = useState('My project');
  const [advancedOpen, setAdvancedOpen] = useState(true);
  const [accent, setAccent] = useState<AccentId>(DEFAULT_ACCENT);
  const [theme, setTheme] = useState<EditorThemeId>('tokyo-night');
  const [autorun, setAutorun] = useState(true);
  const template = useMemo(() => TEMPLATES.find((candidate) => candidate.id === templateId) ?? defaultTemplate, [templateId]);

  useEffect(() => {
    if (!open) return;
    setTemplateId(initialTemplateId ?? defaultTemplate.id);
    setName('My project');
    setAdvancedOpen(true);
    setAccent(DEFAULT_ACCENT);
    setTheme('tokyo-night');
    setAutorun(true);
  }, [open, initialTemplateId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const canCreate = Boolean(name.trim()) && availableWorkspaces.has(template.workspace);
  const runtimeReason = RUNTIMES.find((runtime) => runtime.id === template.workspace)?.unavailableReason;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate) return;
    onCreate(template.id, name.trim(), { accent, theme, autorun });
  }

  return (
    <div className="create-project-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="create-project-dialog" role="dialog" aria-modal="true" aria-labelledby="create-project-title">
        <header className="create-project-head">
          <div>
            <p className="create-project-kicker">NEW WORKSPACE</p>
            <h2 id="create-project-title">Create a project</h2>
          </div>
          <button type="button" className="btn ghost create-project-close" onClick={onClose} aria-label="Close create project">×</button>
        </header>

        <form onSubmit={submit}>
          <label className="create-project-field">
            <span>Project name</span>
            <input
              value={name}
              maxLength={80}
              placeholder="My project"
              aria-label="Project name"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </label>

          <label className="create-project-field">
            <span>Start with</span>
            <select aria-label="Project template" value={template.id} onChange={(event) => setTemplateId(event.target.value)}>
              {TEMPLATES.map((option) => {
                const enabled = availableWorkspaces.has(option.workspace);
                const reason = RUNTIMES.find((runtime) => runtime.id === option.workspace)?.unavailableReason;
                return (
                  <option key={option.id} value={option.id} disabled={!enabled}>
                    {option.label} — {WORKSPACE_LABEL[option.workspace]}{enabled ? '' : ` (${reason ?? 'not available yet'})`}
                  </option>
                );
              })}
            </select>
          </label>

          <div className="create-project-template-note">
            <span className={`workspace-tag ${template.workspace}`}>{WORKSPACE_LABEL[template.workspace]}</span>
            <span>{template.description}</span>
          </div>
          {!availableWorkspaces.has(template.workspace) ? <p className="create-project-unavailable">{runtimeReason ?? 'This workspace is not available yet.'}</p> : null}

          <button
            type="button"
            className="create-project-advanced-toggle"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((value) => !value)}
          >
            <span>{advancedOpen ? '▾' : '▸'} Advanced options</span>
            <span className="muted">Editor, accent, live preview</span>
          </button>

          {advancedOpen ? (
            <div className="create-project-advanced">
              <label className="create-project-field">
                <span>Project accent</span>
                <select value={accent} onChange={(event) => setAccent(event.target.value as AccentId)}>
                  {ACCENTS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
              <label className="create-project-field">
                <span>Editor theme</span>
                <select value={theme} onChange={(event) => setTheme(event.target.value as EditorThemeId)}>
                  {EDITOR_THEMES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
              </label>
              <label className="create-project-check">
                <input type="checkbox" checked={autorun} onChange={(event) => setAutorun(event.target.checked)} />
                <span>Update the preview automatically while I edit</span>
              </label>
            </div>
          ) : null}

          <footer className="create-project-actions">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={!canCreate}>Create project</button>
          </footer>
          {!name.trim() ? <p className="create-project-validation">Enter a project name to continue.</p> : null}
        </form>
      </section>
    </div>
  );
}
