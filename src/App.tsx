import { useCallback, useEffect, useMemo, useState } from 'react';
import { io } from './core/consoleStore';
import { clearDiagnostics, diagnosticsStore, scheduleLint } from './core/diagnosticsStore';
import { projectActions, projectStore } from './core/projectStore';
import { runStore, startRun, stopRun } from './core/runSession';
import { TEMPLATES, templateById } from './core/templates';
import { useStore } from './ui/useStore';
import { runtimeForWorkspace } from './runtimes/registry';
import { applyMarkers, clearAllMarkers } from './ui/monacoMarkers';
import { ConsolePanel } from './ui/ConsolePanel';
import { DiagnosticsPanel } from './ui/DiagnosticsPanel';
import { EditorPane } from './ui/EditorPane';
import { Explorer } from './ui/Explorer';
import { PreviewPane } from './ui/PreviewPane';
import { MobileNav, summarizeIssues } from './ui/MobileNav';
import type { MobileTab } from './ui/MobileNav';
import { Tabs } from './ui/Tabs';
import { TopBar } from './ui/TopBar';
import { useLayoutMode } from './ui/useLayoutMode';
import { consoleStore } from './core/consoleStore';

/**
 * Scrolls a stacked section into view on the phone layout.
 *
 * `scrollIntoView` with block:'start' is used rather than setting scrollTop so
 * the browser accounts for the sticky section header itself.
 */
function scrollToPane(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function Welcome({ onCreate }: { onCreate: (templateId: string) => void }) {
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <h1>
          <span className="brand-mark" aria-hidden="true">
            ⚒
          </span>{' '}
          CodeForge
        </h1>
        <p className="muted">
          A universal coding environment in the browser. Pick a template to start — everything is
          saved locally in your browser.
        </p>
        <div className="template-grid">
          {TEMPLATES.map((t) => {
            // The milestone is documentation, not the gate: a template becomes
            // usable when its workspace has a runtime. Gating on a literal
            // milestone string silently hid every template added after M1.
            const available =
              templateById(t.id) !== undefined && runtimeForWorkspace(t.workspace).available;
            return (
              <button
                key={t.id}
                className={`template-card${available ? '' : ' disabled'}`}
                onClick={() => onCreate(t.id)}
                disabled={!available}
              >
                <span className="template-label">{t.label}</span>
                <span className="template-desc">{t.description}</span>
                {!available ? <span className="template-milestone">{t.milestone}</span> : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const projectState = useStore(projectStore);
  const runState = useStore(runStore);
  const diagnosticsState = useStore(diagnosticsStore);
  const consoleState = useStore(consoleStore);
  const layout = useLayoutMode();
  const [runSignal, setRunSignal] = useState(0);
  /**
   * Which single pane the phone layout shows. Defaults to the code editor:
   * opening a project and landing on anything else makes the app look empty.
   */
  const [mobileTab, setMobileTab] = useState<MobileTab>('code');
  // Issues are counted once here because both the section header and the tab
  // bar show them.
  const issues = useMemo(
    () => summarizeIssues(consoleState, diagnosticsState),
    [consoleState, diagnosticsState],
  );

  useEffect(() => {
    void projectActions.init();
    // Persist on the way out so a debounce in flight is not lost.
    const flush = () => projectActions.flush();
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  const project = projectState.project;
  const runtime = useMemo(
    () => runtimeForWorkspace(project?.workspace ?? 'web'),
    [project?.workspace],
  );

  // Lint on change. The bus debounces because a Luau check costs ~300 ms.
  const files = project?.files;
  const analysisMode = project?.settings.analysisMode;
  useEffect(() => {
    if (!files || !runtime.lint) {
      clearDiagnostics();
      clearAllMarkers();
      return;
    }
    scheduleLint(runtime, files, analysisMode);
  }, [files, analysisMode, runtime]);

  // Push results into Monaco as squiggles.
  useEffect(() => {
    applyMarkers(diagnosticsState.diagnostics);
  }, [diagnosticsState.diagnostics]);

  const handleRun = useCallback(() => {
    if (!project) return;
    if (!runtime.available) {
      io.log({ kind: 'system', text: runtime.unavailableReason ?? 'This workspace is not ready.' });
      return;
    }
    setRunSignal((n) => n + 1);
    // On a phone the preview is behind a tab. Pressing Run means "show me the
    // result", so bring it into view rather than leaving the user on Files.
    if (layout === 'compact') setMobileTab('preview');
    void startRun((bridge) => runtime.run(project.files, project.activeFile, bridge));
  }, [project, runtime, layout]);

  const handleStop = useCallback(() => stopRun(), []);

  // Ctrl+Enter runs, Ctrl+S flushes the autosave debounce.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        handleRun();
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        projectActions.flush();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleRun]);

  const activePath = project?.activeFile ?? '';
  const activeFile = project && activePath ? project.files[activePath] : undefined;

  return (
    <div className="app">
      <TopBar
        project={project}
        dirty={projectState.dirty}
        running={runState.running}
        onRename={projectActions.rename}
        onRun={handleRun}
        onStop={handleStop}
        onToggleAutorun={() =>
          projectActions.updateSettings({ autorun: !project?.settings.autorun })
        }
        onCreate={(templateId) => {
          const template = templateById(templateId);
          if (template) projectActions.createFromTemplate(template);
        }}
        onSwitchWorkspace={(workspace) => {
          projectActions.switchWorkspace(workspace);
          // A different workspace is a different project shape; land on Code so
          // the new starter is visible instead of a stale pane.
          setMobileTab('code');
        }}
      />

      {projectState.loading ? (
        <div className="pane-empty">Loading…</div>
      ) : !project ? (
        <Welcome
          onCreate={(templateId) => {
            const template = templateById(templateId);
            if (template) projectActions.createFromTemplate(template);
          }}
        />
      ) : (
        layout === 'compact' ? (
          /* Every pane visible, stacked and scrollable. The tab bar scrolls to
             a section instead of hiding the others, so nothing is ever
             unreachable — which was the failure mode of the previous version. */
          <div className="workspace workspace-compact">
            <div className="mobile-stack">
              <section id="pane-files" className="mobile-section mobile-section-files">
                <div className="mobile-section-head">Files</div>
                <Explorer
                  files={project.files}
                  activeFile={activePath}
                  onSelect={(path) => {
                    projectActions.setActiveFile(path);
                    requestAnimationFrame(() => scrollToPane('pane-code'));
                  }}
                  onAdd={(path) => projectActions.addFile(path)}
                  onRemove={projectActions.removeFile}
                />
              </section>

              <section id="pane-code" className="mobile-section mobile-section-code">
                <div className="mobile-section-head">
                  Code
                  <span className="muted">{activePath || 'no file'}</span>
                </div>
                <Tabs
                  files={project.files}
                  activeFile={activePath}
                  onSelect={projectActions.setActiveFile}
                />
                <div className="mobile-editor">
                  <EditorPane
                    path={activePath}
                    content={activeFile?.content ?? ''}
                    language={activeFile?.language ?? 'plaintext'}
                    theme={project.settings.theme}
                    onChange={(value) => projectActions.updateFile(activePath, value)}
                  />
                </div>
              </section>

              <section id="pane-preview" className="mobile-section mobile-section-preview">
                <div className="mobile-section-head">Preview</div>
                <div className="mobile-preview">
                  <PreviewPane
                    runtime={runtime}
                    files={project.files}
                    autorun={project.settings.autorun}
                    runSignal={runSignal}
                    onRun={handleRun}
                  />
                </div>
              </section>

              <section id="pane-output" className="mobile-section mobile-section-output">
                <div className="mobile-section-head">
                  Output
                  {issues.errors > 0 ? <span className="badge error">{issues.errors}</span> : null}
                  {issues.errors === 0 && issues.warnings > 0 ? (
                    <span className="badge warn">{issues.warnings}</span>
                  ) : null}
                </div>
                <div className="mobile-output-grid">
                  <ConsolePanel onClear={() => io.clear()} />
                  <DiagnosticsPanel
                    onOpen={(file) => {
                      projectActions.setActiveFile(file);
                      requestAnimationFrame(() => scrollToPane('pane-code'));
                    }}
                  />
                </div>
              </section>
            </div>

            <MobileNav
              active={mobileTab}
              onChange={(tab) => {
                setMobileTab(tab);
                scrollToPane(`pane-${tab}`);
              }}
              console={consoleState}
              diagnostics={diagnosticsState}
              running={runState.running}
            />
          </div>
        ) : (
        <div className="workspace">
          <aside className="sidebar">
            <Explorer
              files={project.files}
              activeFile={activePath}
              onSelect={projectActions.setActiveFile}
              onAdd={(path) => projectActions.addFile(path)}
              onRemove={projectActions.removeFile}
            />
          </aside>

          <main className="center">
            <Tabs files={project.files} activeFile={activePath} onSelect={projectActions.setActiveFile} />
            <EditorPane
              path={activePath}
              content={activeFile?.content ?? ''}
              language={activeFile?.language ?? 'plaintext'}
              theme={project.settings.theme}
              onChange={(value) => projectActions.updateFile(activePath, value)}
            />
          </main>

          <section className="right">
            <PreviewPane
              runtime={runtime}
              files={project.files}
              autorun={project.settings.autorun}
              runSignal={runSignal}
              onRun={handleRun}
            />
          </section>

          <footer className="bottom">
            <div className="bottom-panes">
              <ConsolePanel onClear={() => io.clear()} />
              <DiagnosticsPanel
                onOpen={(file) => projectActions.setActiveFile(file)}
              />
            </div>
          </footer>
        </div>
        )
      )}

      {projectState.error ? (
        <div className="error-banner">Storage error: {projectState.error}</div>
      ) : null}
    </div>
  );
}
