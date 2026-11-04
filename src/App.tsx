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
import { MobileNav } from './ui/MobileNav';
import { MobileOutputHint } from './ui/MobileOutputHint';
import type { MobileTab } from './ui/MobileNav';
import { Tabs } from './ui/Tabs';
import { TopBar } from './ui/TopBar';
import { useLayoutMode } from './ui/useLayoutMode';
import { consoleStore } from './core/consoleStore';

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
          /* One pane at a time, with the tab bar underneath. */
          <div className="workspace workspace-compact">
            <div className="mobile-pane">
              {mobileTab === 'files' ? (
                <aside className="sidebar sidebar-full">
                  <Explorer
                    files={project.files}
                    activeFile={activePath}
                    onSelect={(path) => {
                      projectActions.setActiveFile(path);
                      // Picking a file on a phone means "I want to edit this".
                      setMobileTab('code');
                    }}
                    onAdd={(path) => projectActions.addFile(path)}
                    onRemove={projectActions.removeFile}
                  />
                </aside>
              ) : null}

              {mobileTab === 'code' ? (
                <main className="center">
                  <Tabs
                    files={project.files}
                    activeFile={activePath}
                    onSelect={projectActions.setActiveFile}
                  />
                  <EditorPane
                    path={activePath}
                    content={activeFile?.content ?? ''}
                    language={activeFile?.language ?? 'plaintext'}
                    theme={project.settings.theme}
                    onChange={(value) => projectActions.updateFile(activePath, value)}
                  />
                </main>
              ) : null}

              {mobileTab === 'preview' ? (
                <section className="right">
                  <PreviewPane
                    runtime={runtime}
                    files={project.files}
                    autorun={project.settings.autorun}
                    runSignal={runSignal}
                    onRun={handleRun}
                  />
                </section>
              ) : null}

              {mobileTab === 'output' ? (
                <footer className="bottom bottom-full">
                  <div className="bottom-panes">
                    <ConsolePanel onClear={() => io.clear()} />
                    <DiagnosticsPanel
                      onOpen={(file) => {
                        projectActions.setActiveFile(file);
                        setMobileTab('code');
                      }}
                    />
                  </div>
                </footer>
              ) : null}
            </div>

            <MobileOutputHint
              console={consoleState}
              diagnostics={diagnosticsState}
              visible={mobileTab !== 'output'}
              onOpen={() => setMobileTab('output')}
            />

            <MobileNav
              active={mobileTab}
              onChange={setMobileTab}
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
