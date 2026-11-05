import { useCallback, useEffect, useMemo, useState } from 'react';
import { consoleStore, io } from './core/consoleStore';
import { clearDiagnostics, diagnosticsStore, scheduleLint } from './core/diagnosticsStore';
import { projectActions, projectStore } from './core/projectStore';
import { runStore, startRun, stopRun } from './core/runSession';
import { templateById } from './core/templates';
import { accentHex, type AccentId, type EditorThemeId } from './core/theme';
import { loadLayout, layoutActions, layoutStore } from './core/layoutStore';
import { useStore } from './ui/useStore';
import { runtimeForWorkspace } from './runtimes/registry';
import { applyMarkers, clearAllMarkers } from './ui/monacoMarkers';
import { EditorPane } from './ui/EditorPane';
import { PreviewPane } from './ui/PreviewPane';
import { summarizeIssues } from './ui/MobileNav';
import type { MobileTab } from './ui/MobileNav';
import { GameWorkspace } from './ui/GameWorkspace';
import { ProjectsHome } from './ui/ProjectsHome';
import { Tabs } from './ui/Tabs';
import { TopBar } from './ui/TopBar';
import { Drawer } from './ui/Drawer';
import type { SectionId } from './ui/Drawer';
import { Palette } from './ui/Palette';
import { SettingsPanel } from './ui/SettingsPanel';
import { BackupPanel } from './ui/BackupPanel';
import { DesktopWorkspace } from './ui/DesktopWorkspace';
import { ConsolePanel } from './ui/ConsolePanel';
import { DiagnosticsPanel } from './ui/DiagnosticsPanel';
import { NoticeBar } from './ui/NoticeBar';
import { useLayoutMode } from './ui/useLayoutMode';
import { currentRelease } from './core/release';

/** Where a drawer section lands on a wide screen: a column section, or none. */
const DESKTOP_SECTION: Record<SectionId, MobileTab | 'look' | 'backup' | 'drawer'> = {
  files: 'drawer',
  objects: 'preview',
  code: 'code',
  preview: 'preview',
  output: 'output',
  look: 'look',
  backup: 'backup',
};

export default function App() {
  const projectState = useStore(projectStore);
  const runState = useStore(runStore);
  const diagnosticsState = useStore(diagnosticsStore);
  const consoleState = useStore(consoleStore);
  const layoutState = useStore(layoutStore);
  const layout = useLayoutMode();
  const [runSignal, setRunSignal] = useState(0);
  /** The active full-screen section on compact layouts. */
  const [mobileTab, setMobileTab] = useState<MobileTab>('code');
  /** The project the user most recently had open, for the home screen. */
  const [lastProjectId, setLastProjectId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [palette, setPalette] = useState<{ open: boolean; mode: 'file' | 'replace' }>({
    open: false,
    mode: 'file',
  });
  /** Extra destinations (Look, Backup, or game Objects) outside the main panes. */
  const [extraSection, setExtraSection] = useState<'look' | 'backup' | 'objects' | null>(null);
  const [desktopTab, setDesktopTab] = useState<MobileTab>('code');

  const issues = useMemo(
    () => summarizeIssues(consoleState, diagnosticsState),
    [consoleState, diagnosticsState],
  );

  const project = projectState.project;
  const pinned = layoutState.drawerPinned;

  /**
   * Pinned on a wide screen means the drawer is simply part of the layout; on a
   * phone it is always an overlay, because 300px of tree on a 390px screen is
   * not a sidebar, it is the whole app.
   */
  const drawerVisible = layout === 'desktop' ? pinned || drawerOpen : drawerOpen;

  useEffect(() => {
    loadLayout();
    void projectActions.init();
    // Persist on the way out so a debounce in flight is not lost.
    const flush = () => projectActions.flush();
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  /**
   * Creating a project always means "open it": from the home screen the new
   * project replaces the list, and from the top bar it replaces the open one.
   * Both entry points go through here so they cannot diverge.
   */
  const handleCreate = useCallback((templateId: string) => {
    const template = templateById(templateId);
    if (!template) {
      // Never a silent no-op: a missing template id is a bug, and swallowing it
      // is how the "New…" menu created nothing for several milestones.
      io.log({ kind: 'error', text: `Unknown template "${templateId}".` });
      return;
    }
    projectActions.createFromTemplate(template);
    setMobileTab('code');
    setDesktopTab('code');
    setExtraSection(null);
  }, []);

  const handleExit = useCallback(() => {
    setLastProjectId(project?.id ?? null);
    projectActions.close();
    void projectActions.refreshRecent();
    setMobileTab('code');
    setExtraSection(null);
  }, [project?.id]);

  const runtime = useMemo(
    () => runtimeForWorkspace(project?.workspace ?? 'web'),
    [project?.workspace],
  );

  // Lint on change. The bus debounces so a check never runs per keystroke.
  const files = project?.files;
  useEffect(() => {
    if (!files || !runtime.lint) {
      clearDiagnostics();
      clearAllMarkers();
      return;
    }
    scheduleLint(runtime, files);
  }, [files, runtime]);

  // Push results into Monaco as squiggles.
  useEffect(() => {
    applyMarkers(diagnosticsState.diagnostics);
  }, [diagnosticsState.diagnostics]);

  const handleRun = useCallback(() => {
    if (!project) return;
    if (!runtime.available) {
      io.log({ kind: 'system', text: runtime.unavailableReason ?? 'This workspace is not ready.' });
      if (layout === 'compact') {
        setExtraSection(null);
        setMobileTab('output');
        setDrawerOpen(false);
      }
      return;
    }
    // A game project is driven by the builder's own Play button. Rebuilding the
    // preview from here would fight it: two transports, one stage.
    if (project.workspace === 'game') {
      io.log({ kind: 'system', text: 'Use ▶ Play above the stage to run a game project.' });
      if (layout === 'compact') {
        setExtraSection(null);
        setMobileTab('preview');
        setDrawerOpen(false);
      }
      return;
    }
    setRunSignal((n) => n + 1);
    if (layout === 'compact') {
      setExtraSection(null);
      setMobileTab('preview');
      setDrawerOpen(false);
    }
    void startRun((bridge) => runtime.run(project.files, project.activeFile, bridge));
  }, [project, runtime, layout]);

  const handleStop = useCallback(() => stopRun(), []);

  const openPalette = useCallback((mode: 'file' | 'replace' = 'file') => {
    setPalette({ open: true, mode });
  }, []);

  // Ctrl+Enter runs, Ctrl+S flushes, Ctrl+B toggles the drawer, Ctrl+P opens a
  // file, Ctrl+K replaces across the project.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'enter') {
        e.preventDefault();
        handleRun();
      } else if (key === 's') {
        e.preventDefault();
        projectActions.flush();
      } else if (key === 'b') {
        // Monaco does not use Ctrl+B, and it is the shortcut every editor with
        // a sidebar uses, so it is bound globally here. On a wide screen the
        // key toggles the *pin*: an overlay drawer over a desktop layout is
        // the wrong shape, and toggling `drawerOpen` there would look like
        // nothing happened while the drawer stayed pinned open.
        e.preventDefault();
        if (layout === 'desktop') layoutActions.toggleDrawerPinned();
        else setDrawerOpen((open) => !open);
      } else if (key === 'p') {
        e.preventDefault();
        openPalette('file');
      } else if (key === 'k') {
        e.preventDefault();
        openPalette('replace');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleRun, openPalette, layout]);

  const activePath = project?.activeFile ?? '';
  const activeFile = project && activePath ? project.files[activePath] : undefined;

  /** Drawer sections become full-page destinations on mobile. */
  const handleSection = useCallback(
    (section: SectionId) => {
      layoutActions.markDrawerSeen();
      const target = DESKTOP_SECTION[section];

      if (section === 'objects') {
        setExtraSection('objects');
        setDrawerOpen(false);
        return;
      }

      if (layout === 'compact') {
        if (target === 'drawer') {
          setExtraSection(null);
          setDrawerOpen(true);
        } else if (target === 'look' || target === 'backup') {
          setExtraSection(target);
          setDrawerOpen(false);
        } else {
          setExtraSection(null);
          setMobileTab(target);
          setDrawerOpen(false);
        }
        return;
      }

      setExtraSection(null);
      if (target === 'drawer') {
        // "Files" on a wide screen means the drawer itself; when it is hidden,
        // show it, and when it is already showing, keep it.
        setDrawerOpen(true);
        return;
      }
      if (target === 'look' || target === 'backup') setExtraSection(target);
      else setDesktopTab(target);
      if (!pinned) setDrawerOpen(false);
    },
    [layout, pinned],
  );

  const handleImport = useCallback((file: File) => {
    void file.text().then((text) => projectActions.importProject(text));
  }, []);

  const handleAccent = useCallback((accent: AccentId) => projectActions.setAccent(accent), []);
  const handleTheme = useCallback((theme: EditorThemeId) => projectActions.setEditorTheme(theme), []);


  const release = currentRelease();

  /*
   * The shell class decides the grid: `has-drawer` reserves a column for a
   * pinned tree, `unpinned` collapses that column to zero so the editor keeps
   * the full width. Nothing else in the app may add layout classes.
   */
  const drawerLayout =
    layout === 'desktop' && project
      ? pinned
        ? ' has-drawer'
        : ' has-drawer unpinned'
      : '';

  return (
    <div
      className={`app${drawerLayout}`}
      style={project ? ({ '--accent': accentHex(project.accent) } as React.CSSProperties) : undefined}
    >
      <TopBar
        project={project}
        dirty={projectState.dirty}
        running={runState.running}
        onRename={projectActions.rename}
        onRun={handleRun}
        onStop={handleStop}
        onCreate={handleCreate}
        onExit={handleExit}
        onOpenDrawer={() => {
          layoutActions.markDrawerSeen();
          setDrawerOpen((open) => !open);
        }}
        onOpenSearch={() => openPalette('file')}
      />

      {project ? (
        <Drawer
          open={drawerVisible}
          onClose={() => setDrawerOpen(false)}
          pinned={pinned}
          onTogglePin={() => layoutActions.toggleDrawerPinned()}
          layout={layout}
          project={project}
          release={release}
          activeSection={
            extraSection ??
            (layout === 'compact' ? mobileTab : (desktopTab as SectionId))
          }
          onSection={handleSection}
          issues={issues}
          running={runState.running}
          onRun={handleRun}
          onStop={handleStop}
          onExit={handleExit}
          onSelectFile={(path) => {
            projectActions.setActiveFile(path);
            setExtraSection(null);
            setDesktopTab('code');
            if (layout === 'compact') {
              setMobileTab('code');
              setExtraSection(null);
              setDrawerOpen(false);
            }
          }}
          onCreateFile={(path) => {
            projectActions.addFile(path);
            setExtraSection(null);
            setMobileTab('code');
            setDesktopTab('code');
            if (layout === 'compact') setDrawerOpen(false);
          }}
          onCreateFolder={(path) => void projectActions.createFolder(path)}
          onRename={(from, to) => void projectActions.renamePath(from, to)}
          onDeleteFile={projectActions.removeFile}
          onDeleteFolder={projectActions.removeFolder}
          onDuplicateFile={(path) => void projectActions.duplicateFile(path)}
          onOpenSearch={() => openPalette('file')}
        />
      ) : null}

      {projectState.loading ? (
        <div className="pane-empty">Loading…</div>
      ) : !project ? (
        /* No project open: the projects home. */
        <ProjectsHome
          recent={projectState.recent}
          currentId={lastProjectId}
          loading={projectState.loading}
          error={projectState.error}
          onOpen={(id) => {
            void projectActions.openById(id);
            setMobileTab('code');
            setDesktopTab('code');
            setExtraSection(null);
          }}
          onDelete={(id) => void projectActions.remove(id)}
          onDuplicate={async (id) => {
            const copy = await projectActions.duplicate(id);
            if (copy) setLastProjectId(copy.id);
          }}
          onCreate={handleCreate}
          onImport={handleImport}
          onDismissError={projectActions.dismissError}
        />
      ) : project.workspace === 'game' && (extraSection === 'look' || extraSection === 'backup') ? (
        layout === 'compact' ? (
          <div className="workspace workspace-compact">
            <section className="mobile-section mobile-section-settings">
              <div className="mobile-section-head">{extraSection === 'look' ? 'Look' : 'Backup'}</div>
              {extraSection === 'look' ? (
                <SettingsPanel project={project} onAccent={handleAccent} onTheme={handleTheme} />
              ) : (
                <BackupPanel
                  project={project}
                  onExport={() => void projectActions.exportProject()}
                  onImport={handleImport}
                />
              )}
            </section>
          </div>
        ) : (
          <div className="workspace workspace-split">
            <main className="center">
              <div className="section-pane">
                {extraSection === 'look' ? (
                  <SettingsPanel project={project} onAccent={handleAccent} onTheme={handleTheme} />
                ) : (
                  <BackupPanel
                    project={project}
                    onExport={() => void projectActions.exportProject()}
                    onImport={handleImport}
                  />
                )}
              </div>
            </main>
          </div>
        )
      ) : project.workspace === 'game' ? (
        <GameWorkspace
          project={project}
          compact={layout === 'compact'}
          compactSection={
            extraSection === 'objects'
              ? 'objects'
              : mobileTab === 'preview' || mobileTab === 'output'
                ? mobileTab
                : 'code'
          }
          onOpenFile={(file) => {
            projectActions.setActiveFile(file);
            setMobileTab('code');
            setDesktopTab('code');
            setExtraSection(null);
          }}
          onSelectEntity={() => {}}
        />
      ) : layout === 'compact' ? (
        /* The drawer selects one full-height destination at a time on mobile. */
        <div className="workspace workspace-compact">
          {extraSection === 'look' ? (
            <section className="mobile-section mobile-section-settings">
              <div className="mobile-section-head">Look</div>
              <SettingsPanel project={project} onAccent={handleAccent} onTheme={handleTheme} />
            </section>
          ) : extraSection === 'backup' ? (
            <section className="mobile-section mobile-section-settings">
              <div className="mobile-section-head">Backup</div>
              <BackupPanel
                project={project}
                onExport={() => void projectActions.exportProject()}
                onImport={handleImport}
              />
            </section>
          ) : mobileTab === 'code' ? (
            <section id="pane-code" className="mobile-section mobile-section-code">
              <div className="mobile-section-head">
                Code<span className="muted">{activePath || 'no file'}</span>
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
          ) : mobileTab === 'preview' ? (
            <section id="pane-preview" className="mobile-section mobile-section-preview">
              <div className="mobile-section-head">Preview</div>
              <div className="mobile-preview">
                <PreviewPane
                  runtime={runtime}
                  files={project.files}
                  scene={project.scene}
                  autorun={project.settings.autorun}
                  runSignal={runSignal}
                  onRun={handleRun}
                />
              </div>
            </section>
          ) : (
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
                    setMobileTab('code');
                  }}
                />
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="workspace workspace-split">
          <main className="center">
            {extraSection === 'look' ? (
              <div className="section-pane">
                <SettingsPanel project={project} onAccent={handleAccent} onTheme={handleTheme} />
              </div>
            ) : extraSection === 'backup' ? (
              <div className="section-pane">
                <BackupPanel
                  project={project}
                  onExport={() => void projectActions.exportProject()}
                  onImport={handleImport}
                />
              </div>
            ) : (
              <DesktopWorkspace
                tab={desktopTab}
                onChange={setDesktopTab}
                arrangement={layoutState.arrangement}
                onArrangement={layoutActions.setArrangement}
                files={project.files}
                activeFile={activePath}
                content={activeFile?.content ?? ''}
                language={activeFile?.language ?? 'plaintext'}
                theme={project.settings.theme}
                onSelectFile={projectActions.setActiveFile}
                onEdit={(value) => projectActions.updateFile(activePath, value)}
                runtime={runtime}
                scene={project.scene}
                autorun={project.settings.autorun}
                runSignal={runSignal}
                onRun={handleRun}
                onClearConsole={() => io.clear()}
                onOpenFileForDiagnostic={(file) => {
                  projectActions.setActiveFile(file);
                  setDesktopTab('code');
                }}
                issues={issues}
                console={consoleState}
                diagnostics={diagnosticsState}
                running={runState.running}
              />
            )}
          </main>
        </div>
      )}

      <Palette
        open={palette.open}
        mode={palette.mode}
        files={project?.files ?? {}}
        onClose={() => setPalette((prev) => ({ ...prev, open: false }))}
        onOpenFile={(path) => {
          projectActions.setActiveFile(path);
          setExtraSection(null);
          setDesktopTab('code');
          if (layout === 'compact') setMobileTab('code');
        }}
        onReplace={projectActions.replaceInFiles}
      />

      <NoticeBar />

      {projectState.error && project ? (
        <div className="error-banner">Storage error: {projectState.error}</div>
      ) : null}
    </div>
  );
}
