/**
 * The game workspace: stage, code and inspector in one screen.
 *
 * The Web workspace is explorer + editor + preview. A game project needs a
 * fourth thing — the stage — and needs it *large*, because direct manipulation
 * is the entire point. So the game branch lays out differently:
 *
 *   ┌──────────────┬───────────────┐
 *   │ Stage        │ Inspector     │
 *   │ (canvas)     │ (properties)  │
 *   ├──────────────┴───────────────┤
 *   │ Code   │ Console / Problems  │
 *   └────────┴─────────────────────┘
 *
 * and on a phone each part becomes a full-height section selected from the
 * drawer, so the stage, inspector, code and output do not compete for space.
 *
 * Play/Restart live above the stage. The preview iframe is only mounted while
 * playing: a paused game should not keep a 120 Hz loop and a canvas alive
 * behind an editor.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from '../core/consoleStore';
import { projectActions, projectStore } from '../core/projectStore';
import { resolvePlayer, type Scene } from '../core/scene';
import { runStore } from '../core/runSession';
import type { Project } from '../core/types';
import { useStore } from './useStore';
import { StageEditor } from './StageEditor';
import { BuilderToolbar, SceneInspector } from './SceneInspector';
import { EditorPane, type EditorReveal } from './EditorPane';
import { Tabs } from './Tabs';
import { ConsolePanel } from './ConsolePanel';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { gameRuntime, isGameMessage } from '../runtimes/game';
import { buildGameDocument } from '../game/preview';

type GameCompactSection = 'code' | 'preview' | 'output' | 'objects';

interface GameWorkspaceProps {
  project: Project;
  compact: boolean;
  compactSection?: GameCompactSection;
  reveal?: EditorReveal;
  diffOriginal?: string;
  diffModified?: string;
  onExitDiff?: () => void;
  onOpenFile?: (path: string) => void;
  /** Publishes the selected object id so the phone layout can scroll to it. */
  onSelectEntity?: (id: string | null) => void;
}

const SELECTED_KEY = 'codeforge:game:selected';

/**
 * The preview frame, mounted only while playing.
 *
 * Messages are handled here rather than in `PreviewPane` because this frame has
 * its own command channel (pause/resume/restart) and its own lifecycle — it is
 * created and destroyed by Play/Stop, not by the debounced file watcher.
 */
function GamePreview({
  srcdoc,
  scriptPath,
  onStatus,
}: {
  srcdoc: string;
  scriptPath: string;
  onStatus: (status: { time: number; collected: number }) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data;
      if (!isGameMessage(data)) return;
      // Only obey frames this component owns: a Web preview in another pane is
      // same-origin and could otherwise impersonate a game frame.
      if (frameRef.current && event.source !== frameRef.current.contentWindow) return;
      if (data.type === 'status') {
        onStatus({
          time: typeof data.time === 'number' ? data.time : 0,
          collected: typeof data.collected === 'number' ? data.collected : 0,
        });
        return;
      }
      const translated = gameRuntime.handlePreviewMessage?.(data, { scriptPath });
      if (!translated) return;
      if (translated.type === 'clear') io.clear();
      else io.log(translated.entry);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [scriptPath, onStatus]);

  return (
    <iframe
      ref={frameRef}
      title="Game preview"
      className="game-frame"
      sandbox="allow-scripts"
      srcDoc={srcdoc}
    />
  );
}

export function GameWorkspace({
  project,
  compact,
  compactSection = 'code',
  reveal,
  diffOriginal,
  diffModified,
  onExitDiff,
  onOpenFile,
  onSelectEntity,
}: GameWorkspaceProps) {
  const store = useStore(projectStore);
  const runState = useStore(runStore);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(SELECTED_KEY);
    } catch {
      return null;
    }
  });
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState({ time: 0, collected: 0 });
  /** Forces a new iframe document on Restart, without changing its contents. */
  const [frameKey, setFrameKey] = useState(0);

  const scene: Scene = project.scene ?? {
    version: 1,
    world: { width: 960, height: 540, gravity: 1600 },
    entities: [],
  };
  const player = useMemo(() => resolvePlayer(scene), [scene]);
  const selected = scene.entities.find((entity) => entity.id === selectedId) ?? null;

  // Stop the game when the project changes or the pane unmounts, or a stale
  // frame keeps playing against a scene that no longer exists.
  useEffect(() => {
    return () => setPlaying(false);
  }, [project.id]);

  useEffect(() => {
    try {
      if (selectedId) sessionStorage.setItem(SELECTED_KEY, selectedId);
      else sessionStorage.removeItem(SELECTED_KEY);
    } catch {
      /* private mode; selection just does not survive a reload */
    }
    onSelectEntity?.(selectedId);
  }, [selectedId, onSelectEntity]);

  const entry = project.activeFile;

  const srcdoc = useMemo(() => {
    if (!playing) return '';
    return buildGameDocument({
      scene,
      script: project.files[entry]?.content ?? '',
      scriptPath: entry,
      paused: false,
    });
  }, [playing, scene, project.files, entry]);

  // Keyboard: undo/redo follow the platform convention, and Escape drops the
  // selection.
  //
  // The stage and the code editor both want Ctrl+Z, and they mean different
  // things by it. The scene handler therefore stands down whenever focus is
  // inside the editor: otherwise editing a line of code and pressing Ctrl+Z
  // would silently move a box on the stage instead of restoring the text, which
  // is unrecoverable-looking and impossible to explain.
  useEffect(() => {
    function inEditor(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null;
      if (!el) return false;
      return !!el.closest?.('.editor-host, .monaco-editor, input, textarea');
    }

    function onKey(event: KeyboardEvent) {
      if (inEditor(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) {
        if (event.key === 'Escape' && selectedId) setSelectedId(null);
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        projectActions.undoScene();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        projectActions.redoScene();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  const handleSelect = useCallback((id: string | null) => setSelectedId(id), []);

  const addAndSelect = useCallback(
    (kind: 'box' | 'circle') => {
      // Place new objects near the horizontal centre and a third of the way
      // down, which is visible on every stage size — dropping them at 0,0
      // puts them under the toolbar's label on a phone.
      const id = projectActions.addEntity(kind, Math.round(scene.world.width / 2) - 40, Math.round(scene.world.height / 3));
      if (id) setSelectedId(id);
    },
    [scene.world.width, scene.world.height],
  );

  const restart = useCallback(() => {
    setFrameKey((n) => n + 1);
    setStatus({ time: 0, collected: 0 });
    io.clear();
  }, []);

  const stage = (
    <div className="stage-pane">
      <div className="stage-head">
        <span className="stage-title">Stage</span>
        <span className="muted stage-meta">
          {scene.entities.length} objects
          {playing ? ` · ${status.time.toFixed(1)}s · ${status.collected} collected` : ''}
        </span>
      </div>
      <BuilderToolbar
        onAdd={addAndSelect}
        onUndo={projectActions.undoScene}
        onRedo={projectActions.redoScene}
        canUndo={store.undoDepth > 0}
        canRedo={store.redoDepth > 0}
        playing={playing}
        onTogglePlay={() => {
          if (playing) {
            setPlaying(false);
            io.log({ kind: 'system', text: 'Stopped.' });
          } else {
            io.clear();
            setStatus({ time: 0, collected: 0 });
            setPlaying(true);
            setFrameKey((n) => n + 1);
          }
        }}
        onRestart={restart}
      />
      <div className="stage-body">
        {playing ? (
          <GamePreview key={frameKey} srcdoc={srcdoc} scriptPath={entry} onStatus={setStatus} />
        ) : (
          <StageEditor
            scene={scene}
            selectedId={selectedId}
            playerId={player?.id ?? null}
            onSelect={handleSelect}
            onMove={(id, x, y) => projectActions.moveEntity(id, x, y)}
            onResize={(id, w, h) => projectActions.resizeEntity(id, w, h)}
            onGestureStart={projectActions.beginSceneGesture}
            onGestureEnd={projectActions.endSceneGesture}
          />
        )}
      </div>
      {!playing && !player ? (
        <div className="stage-warn">
          No player object. Runs will show the stage but nothing will move — select an object and
          press “Make player”.
        </div>
      ) : null}
      {runState.running && !playing ? (
        <div className="stage-warn">A Web-style run is still active. Press Play to drive the stage.</div>
      ) : null}
    </div>
  );

  const inspector = (
    <SceneInspector
      scene={scene}
      selected={selected}
      isPlayer={!!selected && selected.id === player?.id}
      onUpdate={(patch) => {
        if (selected) projectActions.patchEntity(selected.id, patch);
      }}
      onDelete={() => {
        if (!selected) return;
        projectActions.deleteEntity(selected.id);
        setSelectedId(null);
      }}
      onDuplicate={() => {
        if (!selected) return;
        const id = projectActions.duplicateEntity(selected.id);
        if (id) setSelectedId(id);
      }}
      onSetPlayer={() => {
        if (selected) projectActions.setPlayer(selected.id);
      }}
      onClose={() => setSelectedId(null)}
      onWorld={(patch) => projectActions.patchWorld(patch)}
    />
  );

  const code = (
    <>
      <Tabs
        files={project.files}
        activeFile={project.activeFile}
        onSelect={projectActions.setActiveFile}
      />
      <EditorPane
        path={project.activeFile}
        content={project.files[project.activeFile]?.content ?? ''}
        language={project.files[project.activeFile]?.language ?? 'plaintext'}
        theme={project.settings.theme}
        onChange={(value) => projectActions.updateFile(project.activeFile, value)}
        reveal={reveal}
        diffOriginal={diffOriginal}
        diffModified={diffModified}
        onExitDiff={onExitDiff}
      />
    </>
  );

  const output = (
    <div className="game-output">
      <ConsolePanel onClear={() => io.clear()} />
      <DiagnosticsPanel onOpen={(file) => (onOpenFile ?? projectActions.setActiveFile)(file)} />
    </div>
  );

  if (compact) {
    // One full-height section at a time. The drawer is the only mobile
    // navigator, so the editor, stage, inspector and output never compete for
    // the same scroll area.
    const sectionHead = compactSection === 'preview'
      ? 'Stage'
      : compactSection === 'objects'
        ? 'Objects'
        : compactSection === 'output'
          ? 'Output'
          : 'Code';

    return (
      <div className="workspace workspace-compact">
        {compactSection === 'preview' ? (
          <section id="pane-preview" className="mobile-section mobile-section-preview">
            <div className="mobile-section-head">{sectionHead}</div>
            {stage}
          </section>
        ) : compactSection === 'objects' ? (
          <section id="pane-inspector" className="mobile-section mobile-section-objects">
            <div className="mobile-section-head">{sectionHead}</div>
            {inspector}
          </section>
        ) : compactSection === 'output' ? (
          <section id="pane-output" className="mobile-section mobile-section-output">
            <div className="mobile-section-head">{sectionHead}</div>
            <div className="mobile-output-grid">{output}</div>
          </section>
        ) : (
          <section id="pane-code" className="mobile-section mobile-section-code">
            <div className="mobile-section-head">
              {sectionHead}<span className="muted">{project.activeFile || 'no file'}</span>
            </div>
            <div className="mobile-editor">{code}</div>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="workspace game-workspace">
      <section className="game-top">
        <div className="game-stage">{stage}</div>
        <aside className="game-side">{inspector}</aside>
      </section>
      <section className="game-bottom">
        <div className="game-code">{code}</div>
        <div className="game-console">{output}</div>
      </section>
    </div>
  );
}
