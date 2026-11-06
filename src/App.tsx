import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { consoleStore, io } from './core/consoleStore';
import { clearDiagnostics, diagnosticsStore, scheduleLint } from './core/diagnosticsStore';
import { projectActions, projectStore } from './core/projectStore';
import { getGitHubDiff } from './core/github';
import { runStore, startRun, stopRun } from './core/runSession';
import { templateById } from './core/templates';
import { accentHex, type AccentId, type EditorThemeId } from './core/theme';
import {
  loadInterfaceTheme,
  saveInterfaceTheme,
  type InterfaceThemeId,
} from './core/interfaceTheme';
import { loadLayout, layoutActions, layoutStore } from './core/layoutStore';
import { useStore } from './ui/useStore';
import { runtimeForWorkspace } from './runtimes/registry';
import { applyMarkers, clearAllMarkers } from './ui/monacoMarkers';
import { EditorPane, type EditorReveal } from './ui/EditorPane';
import { PreviewPane } from './ui/PreviewPane';
import { summarizeIssues } from './ui/MobileNav';
import type { MobileTab } from './ui/MobileNav';
import { GameWorkspace } from './ui/GameWorkspace';
import { Explorer } from './ui/Explorer';
import { ProjectsHome } from './ui/ProjectsHome';
import { Tabs } from './ui/Tabs';
import { TopBar } from './ui/TopBar';
import { Drawer } from './ui/Drawer';
import type { SectionId } from './ui/Drawer';
import { Palette, type PaletteCommand, type PaletteMode } from './ui/Palette';
import { SettingsPanel } from './ui/SettingsPanel';
import { BackupPanel } from './ui/BackupPanel';
import { SourceControlPanel } from './ui/SourceControlPanel';
import { DesktopWorkspace } from './ui/DesktopWorkspace';
import { ConsolePanel } from './ui/ConsolePanel';
import { DiagnosticsPanel } from './ui/DiagnosticsPanel';
import { NoticeBar } from './ui/NoticeBar';
import { useLayoutMode } from './ui/useLayoutMode';
import { currentRelease } from './core/release';
import type { ProjectTextMatch } from './core/search';
import { CreateProjectDialog, type NewProjectOptions } from './ui/CreateProjectDialog';

/** Where a drawer section lands on a wide screen: a column section, or none. */
const DESKTOP_SECTION: Record<SectionId, MobileTab | 'look' | 'backup' | 'source' | 'drawer'> = {
  files: 'drawer',
  objects: 'preview',
  code: 'code',
  preview: 'preview',
  output: 'output',
  look: 'look',
  backup: 'backup',
  source: 'source',
};

export default function App() {
  const projectState = useStore(projectStore);
  const runState = useStore(runStore);
  const diagnosticsState = useStore(diagnosticsStore);
  const consoleState = useStore(consoleStore);
  const layoutState = useStore(layoutStore);
  const layout = useLayoutMode();
  const [runSignal, setRunSignal] = useState(0);
  const [interfaceTheme, setInterfaceTheme] = useState<InterfaceThemeId>(() => loadInterfaceTheme());
  /** The active full-screen section on compact layouts. */
  const [mobileTab, setMobileTab] = useState<MobileTab>('code');
  /** The project the user most recently had open, for the home screen. */
  const [lastProjectId, setLastProjectId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editorReveal, setEditorReveal] = useState<EditorReveal>();
  const [diffView, setDiffView] = useState<{ path: string; original: string; modified: string } | null>(null);
  const revealSequence = useRef(0);
  const [palette, setPalette] = useState<{ open: boolean; mode: PaletteMode }>({
    open: false,
    mode: 'file',
  });
  /** Extra destinations (Look, Backup, Source Control, or game Objects). */
  const [extraSection, setExtraSection] = useState<'look' | 'backup' | 'source' | 'objects' | null>(null);
  const [desktopTab, setDesktopTab] = useState<MobileTab>('code');
  const [createDialog, setCreateDialog] = useState<{ open: boolean; templateId: string | null }>({
    open: false,
    templateId: null,
  });

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
  const openCreateDialog = useCallback((templateId: string | null = null) => {
    setCreateDialog({ open: true, templateId });
  }, []);

  const closeCreateDialog = useCallback(() => {
    setCreateDialog({ open: false, templateId: null });
  }, []);

  const handleCreate = useCallback((templateId: string, name: string, options: NewProjectOptions) => {
    const template = templateById(templateId);
    if (!template) {
      io.log({ kind: 'error', text: `Unknown template "${templateId}".` });
      return;
    }
    projectActions.createFromTemplate(template, name, options);
    closeCreateDialog();
    setMobileTab('code');
    setDesktopTab('code');
    setExtraSection(null);
  }, [closeCreateDialog]);

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

  const openPalette = useCallback((mode: PaletteMode = 'file') => {
    setPalette({ open: true, mode });
  }, []);

  // Ctrl/Cmd+Shift+P opens commands; Ctrl/Cmd+Shift+F searches the project;
  // Ctrl/Cmd+P opens a file; Ctrl/Cmd+K replaces.
  // Ctrl/Cmd+Enter runs, Ctrl/Cmd+S flushes, and Ctrl/Cmd+B toggles the drawer.
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
      } else if (key === 'f' && e.shiftKey) {
        e.preventDefault();
        openPalette('search');
      } else if (key === 'p' && e.shiftKey) {
        e.preventDefault();
        openPalette('command');
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
  const activeDiff = diffView?.path === activePath ? diffView : null;
  const diffOriginal = activeDiff?.original;
  const diffModified = activeDiff?.modified;
  const currentDiff = project?.sourceControl && activePath
    ? getGitHubDiff(project.files, project.sourceControl, activePath)
    : null;
  const diffDisabledReason = !project?.sourceControl
    ? 'Connect GitHub in Source Control to establish a comparison baseline.'
    : 'No changes in this file to compare.';

  useEffect(() => {
    if (diffView && (diffView.path !== activePath || !project?.sourceControl)) setDiffView(null);
  }, [diffView, activePath, project?.sourceControl]);

  const handleCloseSourceDiff = useCallback(() => {
    setDiffView(null);
    if (project && !project.files[activePath]) {
      projectActions.setActiveFile(Object.keys(project.files)[0] ?? '');
    }
  }, [project, activePath]);

  useEffect(() => {
    if (!editorReveal || editorReveal.path !== activePath) return;
    const frame = requestAnimationFrame(() => setEditorReveal(undefined));
    return () => cancelAnimationFrame(frame);
  }, [activePath, editorReveal]);

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
          setMobileTab('files');
          setDrawerOpen(false);
        } else if (target === 'look' || target === 'backup' || target === 'source') {
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
        // On desktop the tree is the Files view. Keep it open and mark the
        // section active; compact screens use the dedicated full-height tree.
        setDesktopTab('files');
        setDrawerOpen(true);
        return;
      }
      if (target === 'look' || target === 'backup' || target === 'source') setExtraSection(target);
      else setDesktopTab(target);
      if (!pinned) setDrawerOpen(false);
    },
    [layout, pinned],
  );

  const handleOpenSourceFile = useCallback((path: string) => {
    setDiffView(null);
    projectActions.setActiveFile(path);
    setExtraSection(null);
    setDesktopTab('code');
    setMobileTab('code');
  }, []);

  const handleViewSourceDiff = useCallback((path: string, original: string, modified: string) => {
    projectActions.setActiveFile(path);
    setDiffView({ path, original, modified });
    setExtraSection(null);
    setDesktopTab('code');
    setMobileTab('code');
  }, []);

  const handleViewActiveDiff = useCallback(() => {
    if (!project?.sourceControl || !activePath) return;
    const diff = getGitHubDiff(project.files, project.sourceControl, activePath);
    if (diff) handleViewSourceDiff(activePath, diff.original, diff.modified);
  }, [project, activePath, handleViewSourceDiff]);

  const handleOpenSearchResult = useCallback(
    (result: ProjectTextMatch) => {
      projectActions.setActiveFile(result.path);
      setExtraSection(null);
      setDesktopTab('code');
      setMobileTab('code');
      setEditorReveal({ ...result, sequence: ++revealSequence.current });
    },
    [],
  );

  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const commands: PaletteCommand[] = [
      {
        id: 'new-project',
        label: 'Create new project',
        description: 'Choose a starter or create a blank project',
        run: () => openCreateDialog(),
      },
    ];
    if (!project) return commands;

    commands.push(
      {
        id: 'global-search',
        label: 'Search Project',
        description: 'Find text in every project file',
        shortcut: 'Ctrl/Cmd+Shift+F',
        run: () => openPalette('search'),
      },
      {
        id: 'files',
        label: 'Open Files',
        description: 'Browse project files and folders',
        run: () => handleSection('files'),
      },
      {
        id: 'code',
        label: 'Open Code',
        description: 'Return to the editor',
        run: () => handleSection('code'),
      },
      {
        id: 'preview',
        label: 'Open Preview',
        description: 'Show the live preview or game stage',
        run: () => handleSection('preview'),
      },
      {
        id: 'output',
        label: 'Open Output',
        description: 'Inspect console messages and diagnostics',
        run: () => handleSection('output'),
      },
      {
        id: 'look',
        label: 'Open Look settings',
        description: 'Change interface theme, project accent and editor theme',
        run: () => handleSection('look'),
      },
      {
        id: 'backup',
        label: 'Open Backup',
        description: 'Export or import a project backup',
        run: () => handleSection('backup'),
      },
      {
        id: 'source-control',
        label: 'Open Source Control',
        description: 'Review changes and manage GitHub commits',
        run: () => handleSection('source'),
      },
      {
        id: 'toggle-files',
        label:
          layout === 'desktop'
            ? pinned
              ? 'Unpin Files drawer'
              : 'Pin Files drawer'
            : 'Toggle Files drawer',
        description: 'Show or hide the project file tree',
        shortcut: 'Ctrl/Cmd+B',
        run: () => {
          layoutActions.markDrawerSeen();
          if (layout === 'desktop') layoutActions.toggleDrawerPinned();
          else setDrawerOpen((open) => !open);
        },
      },
      {
        id: 'clear-output',
        label: 'Clear Output',
        description: 'Clear console messages',
        run: () => io.clear(),
      },
      {
        id: 'back-to-projects',
        label: 'Back to Projects',
        description: 'Close this project and return home',
        run: handleExit,
      },
    );

    if (project.workspace === 'game') {
      commands.push({
        id: 'game-stage',
        label: 'Open Game Stage',
        description: 'Switch to the game builder stage',
        run: () => handleSection('preview'),
      });
    } else {
      commands.push({
        id: 'run-project',
        label: runState.running ? 'Stop Current Run' : 'Run Current Project',
        description: runState.running ? 'Stop the running preview' : 'Build and show the current preview',
        shortcut: runState.running ? undefined : 'Ctrl/Cmd+Enter',
        run: runState.running ? handleStop : handleRun,
      });
    }

    if (layout === 'desktop') {
      commands.push(
        { id: 'layout-split', label: 'Use Split Layout', description: 'Show code and preview side by side', run: () => layoutActions.setArrangement('split') },
        { id: 'layout-focus', label: 'Use Focus Layout', description: 'Show one workspace section at a time', run: () => layoutActions.setArrangement('focus') },
      );
    }
    return commands;
  }, [
    project,
    layout,
    pinned,
    runState.running,
    handleSection,
    handleExit,
    handleRun,
    handleStop,
    openCreateDialog,
    openPalette,
  ]);

  const handleImport = useCallback((file: File) => {
    void file.text().then((text) => projectActions.importProject(text));
  }, []);

  const handleAccent = useCallback((accent: AccentId) => projectActions.setAccent(accent), []);
  const handleTheme = useCallback((theme: EditorThemeId) => projectActions.setEditorTheme(theme), []);
  const handleInterfaceTheme = useCallback((theme: InterfaceThemeId) => {
    setInterfaceTheme(saveInterfaceTheme(theme));
  }, []);

  const sourceControlPanel = project ? (
    <SourceControlPanel
      project={project}
      onUpdate={projectActions.updateSourceControl}
      onReplaceFiles={projectActions.replaceFiles}
      onOpenFile={handleOpenSourceFile}
      onViewDiff={handleViewSourceDiff}
    />
  ) : null;

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
      data-interface-theme={interfaceTheme}
      style={project ? ({ '--accent': accentHex(project.accent) } as React.CSSProperties) : undefined}
    >
      <TopBar
        project={project}
        dirty={projectState.dirty}
        running={runState.running}
        onRename={projectActions.rename}
        onRun={handleRun}
        onStop={handleStop}
        onNewProject={() => openCreateDialog()}
        onExit={handleExit}
        onOpenDrawer={() => {
          layoutActions.markDrawerSeen();
          setDrawerOpen((open) => !open);
        }}
        onOpenSearch={() => openPalette('file')}
      />
      <CreateProjectDialog
        open={createDialog.open}
        initialTemplateId={createDialog.templateId}
        onClose={closeCreateDialog}
        onCreate={handleCreate}
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
          onCreate={(templateId) => openCreateDialog(templateId ?? null)}
          onImport={handleImport}
          onDismissError={projectActions.dismissError}
        />
      ) : layout === 'compact' && mobileTab === 'files' ? (
        <div className="workspace workspace-compact">
          <section id="pane-files" className="mobile-section mobile-section-files">
            <div className="mobile-section-head">Files</div>
            <div className="mobile-files-list">
              <Explorer
                bare
                files={project.files}
                folders={project.folders}
                activeFile={project.activeFile}
                onSelect={(path) => {
                  projectActions.setActiveFile(path);
                  setMobileTab('code');
                  setDesktopTab('code');
                  setExtraSection(null);
                }}
                onCreateFile={(path) => {
                  projectActions.addFile(path);
                  setMobileTab('code');
                  setDesktopTab('code');
                  setExtraSection(null);
                }}
                onCreateFolder={(path) => void projectActions.createFolder(path)}
                onRename={(from, to) => void projectActions.renamePath(from, to)}
                onDeleteFile={projectActions.removeFile}
                onDeleteFolder={projectActions.removeFolder}
                onDuplicate={(path) => void projectActions.duplicateFile(path)}
              />
            </div>
          </section>
        </div>
      ) : project.workspace === 'game' && (extraSection === 'look' || extraSection === 'backup' || extraSection === 'source') ? (
        layout === 'compact' ? (
          <div className="workspace workspace-compact">
            <section className="mobile-section mobile-section-settings">
              <div className="mobile-section-head">
                {extraSection === 'look' ? 'Look' : extraSection === 'backup' ? 'Backup' : 'Source Control'}
              </div>
              {extraSection === 'look' ? (
                <SettingsPanel
                  project={project}
                  interfaceTheme={interfaceTheme}
                  onAccent={handleAccent}
                  onTheme={handleTheme}
                  onInterfaceTheme={handleInterfaceTheme}
                />
              ) : extraSection === 'backup' ? (
                <BackupPanel
                  project={project}
                  onExport={() => void projectActions.exportProject()}
                  onImport={handleImport}
                />
              ) : sourceControlPanel}
            </section>
          </div>
        ) : (
          <div className="workspace workspace-split">
            <main className="center">
              <div className="section-pane">
                {extraSection === 'look' ? (
                  <SettingsPanel
                    project={project}
                    interfaceTheme={interfaceTheme}
                    onAccent={handleAccent}
                    onTheme={handleTheme}
                    onInterfaceTheme={handleInterfaceTheme}
                  />
                ) : extraSection === 'backup' ? (
                  <BackupPanel
                    project={project}
                    onExport={() => void projectActions.exportProject()}
                    onImport={handleImport}
                  />
                ) : sourceControlPanel}
              </div>
            </main>
          </div>
        )
      ) : project.workspace === 'game' ? (
        <GameWorkspace
          project={project}
          compact={layout === 'compact'}
          reveal={editorReveal}
          diffOriginal={diffOriginal}
          diffModified={diffModified}
          onExitDiff={handleCloseSourceDiff}
          onViewDiff={!activeDiff && currentDiff ? handleViewActiveDiff : undefined}
          diffDisabledReason={!activeDiff ? diffDisabledReason : undefined}
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
              <SettingsPanel
                project={project}
                interfaceTheme={interfaceTheme}
                onAccent={handleAccent}
                onTheme={handleTheme}
                onInterfaceTheme={handleInterfaceTheme}
              />
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
          ) : extraSection === 'source' ? (
            <section className="mobile-section mobile-section-settings">
              <div className="mobile-section-head">Source Control</div>
              {sourceControlPanel}
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
                onDiff={!activeDiff && currentDiff ? handleViewActiveDiff : undefined}
                diffDisabledReason={!activeDiff ? diffDisabledReason : undefined}
              />
              <div className="mobile-editor">
                <EditorPane
                  path={activePath}
                  content={activeFile?.content ?? ''}
                  language={activeFile?.language ?? 'plaintext'}
                  theme={project.settings.theme}
                  onChange={(value) => projectActions.updateFile(activePath, value)}
                  reveal={editorReveal}
                  diffOriginal={diffOriginal}
                  diffModified={diffModified}
                  onExitDiff={handleCloseSourceDiff}
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
                <SettingsPanel
                  project={project}
                  interfaceTheme={interfaceTheme}
                  onAccent={handleAccent}
                  onTheme={handleTheme}
                  onInterfaceTheme={handleInterfaceTheme}
                />
              </div>
            ) : extraSection === 'backup' ? (
              <div className="section-pane">
                <BackupPanel
                  project={project}
                  onExport={() => void projectActions.exportProject()}
                  onImport={handleImport}
                />
              </div>
            ) : extraSection === 'source' ? (
              <div className="section-pane">{sourceControlPanel}</div>
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
                diffOriginal={diffOriginal}
                diffModified={diffModified}
                onExitDiff={handleCloseSourceDiff}
                onViewDiff={!activeDiff && currentDiff ? handleViewActiveDiff : undefined}
                diffDisabledReason={!activeDiff ? diffDisabledReason : undefined}
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
                reveal={editorReveal}
              />
            )}
          </main>
        </div>
      )}

      <Palette
        open={palette.open}
        mode={palette.mode}
        files={project?.files ?? {}}
        commands={paletteCommands}
        onClose={() => setPalette((prev) => ({ ...prev, open: false }))}
        onOpenSearchResult={handleOpenSearchResult}
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
