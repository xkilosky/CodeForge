/**
 * The wide-screen workspace: code and preview side by side, output underneath.
 *
 * The old grid was `220px | editor | preview` with a permanent 190px console
 * strip across the bottom. Three fixed panes plus a console is four things
 * competing for one screen, and the preview got less than a third of it while
 * the console sat empty most of the time.
 *
 * Two arrangements instead, both driven by the drawer's sections:
 *
 *   split   editor + preview side by side, output collapsible at the bottom
 *   focus   exactly one section, full width
 *
 * Split is the default because a live preview that is visible while you type is
 * the reason this app exists; focus is for reading code on a narrow window,
 * where two columns are two postage stamps.
 */
import { useEffect, useRef, useState } from 'react';
import type { ConsoleState } from '../core/consoleStore';
import type { DiagnosticsState } from '../core/diagnosticsStore';
import type { FileMap, LanguageId, Runtime } from '../core/types';
import type { Scene } from '../core/scene';
import type { MobileTab } from './MobileNav';
import { ConsolePanel } from './ConsolePanel';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { EditorPane, type EditorReveal } from './EditorPane';
import { PreviewPane } from './PreviewPane';
import { Tabs } from './Tabs';
import { ChevronIcon } from './icons';

type Section = MobileTab;

interface DesktopWorkspaceProps {
  /** Which single section `focus` shows. Ignored while split. */
  tab: Section;
  onChange: (tab: Section) => void;
  arrangement: 'split' | 'focus';
  onArrangement: (arrangement: 'split' | 'focus') => void;
  files: FileMap;
  activeFile: string;
  content: string;
  language: LanguageId | 'plaintext';
  theme: string;
  diffOriginal?: string;
  diffModified?: string;
  onExitDiff?: () => void;
  onSelectFile: (path: string) => void;
  onEdit: (value: string) => void;
  runtime: Runtime;
  scene?: Scene;
  autorun: boolean;
  runSignal: number;
  onRun: () => void;
  onClearConsole: () => void;
  onOpenFileForDiagnostic: (file: string) => void;
  issues: { errors: number; warnings: number };
  console: ConsoleState;
  diagnostics: DiagnosticsState;
  running: boolean;
  reveal?: EditorReveal;
}

const SECTION_LABEL: Record<Section, string> = {
  files: 'Files',
  code: 'Code',
  preview: 'Preview',
  output: 'Output',
};

export function DesktopWorkspace(props: DesktopWorkspaceProps) {
  const { tab, onChange, arrangement, onArrangement, issues } = props;
  // Collapsed by default, and remembered for the session: an empty console
  // strip is wasted height, but hiding a *new* error would be worse, so an
  // error opens it. The panels stay mounted so their height can animate; the
  // collapsed state is inert and hidden from assistive technology.
  const [outputOpen, setOutputOpen] = useState(false);
  const previousErrors = useRef(0);

  useEffect(() => {
    if (issues.errors > previousErrors.current) setOutputOpen(true);
    previousErrors.current = issues.errors;
  }, [issues.errors]);

  const editor = (
    <div className="pane pane-editor">
      <Tabs files={props.files} activeFile={props.activeFile} onSelect={props.onSelectFile} />
      <EditorPane
        path={props.activeFile}
        content={props.content}
        language={props.language}
        theme={props.theme}
        diffOriginal={props.diffOriginal}
        diffModified={props.diffModified}
        onExitDiff={props.onExitDiff}
        onChange={props.onEdit}
        reveal={props.reveal}
      />
    </div>
  );

  const preview = (
    <div className="pane pane-preview">
      <div className="pane-head">
        <span className="pane-title">Preview</span>
        <span className="pane-meta muted">
          {props.runtime.available ? props.runtime.label : props.runtime.unavailableReason}
        </span>
      </div>
      <PreviewPane
        runtime={props.runtime}
        files={props.files}
        scene={props.scene}
        autorun={props.autorun}
        runSignal={props.runSignal}
        onRun={props.onRun}
      />
    </div>
  );

  const output = (
    <>
      <ConsolePanel onClear={props.onClearConsole} />
      <DiagnosticsPanel onOpen={props.onOpenFileForDiagnostic} />
    </>
  );

  const sectionOf = (id: Section) =>
    id === 'code' ? editor : id === 'preview' ? preview : id === 'output' ? (
      <div className="pane pane-output">{output}</div>
    ) : (
      <div className="pane pane-empty">
        <p>The file tree lives in the drawer.</p>
        <p className="muted">Press Ctrl+B to open it.</p>
      </div>
    );

  /*
   * The section tabs only exist in focus mode.
   *
   * In split mode Code and Preview are both on screen, so a tab strip for them
   * has nothing to do — and an earlier version reused the same strip to switch
   * arrangements, so clicking "Code" threw the user into a different layout.
   * That is the sort of control that teaches you not to click it.
   */
  const arrangementSwitcher = (
    <div className="arrangement" role="group" aria-label="Layout">
      <button
        className={`arrangement-btn${arrangement === 'split' ? ' active' : ''}`}
        aria-pressed={arrangement === 'split'}
        onClick={() => onArrangement('split')}
        title="Code and preview side by side"
      >
        Split
      </button>
      <button
        className={`arrangement-btn${arrangement === 'focus' ? ' active' : ''}`}
        aria-pressed={arrangement === 'focus'}
        onClick={() => onArrangement('focus')}
        title="One section at a time"
      >
        Focus
      </button>
    </div>
  );

  const sectionTabs = (
    <div className="section-bar" role="tablist" aria-label="Workspace sections">
      {(['code', 'preview', 'output'] as Section[]).map((id) => (
        <button
          key={id}
          role="tab"
          aria-selected={tab === id}
          className={`section-tab${tab === id ? ' active' : ''}`}
          onClick={() => onChange(id)}
        >
          {SECTION_LABEL[id]}
          {id === 'output' && issues.errors > 0 ? (
            <span className="section-badge error">{issues.errors}</span>
          ) : id === 'output' && issues.warnings > 0 ? (
            <span className="section-badge warn">{issues.warnings}</span>
          ) : null}
        </button>
      ))}
      <div className="section-bar-spacer" />
      {arrangementSwitcher}
    </div>
  );


  return (
    <div className={`desktop-workspace ${arrangement}`}>
      {arrangement === 'focus' ? (
        <>
          {sectionTabs}
          <div className="focus-body">{sectionOf(tab)}</div>
        </>
      ) : (
        <>
          <div className="split-body">
            {editor}
            {preview}
          </div>
          <div className="section-bar slim">
            <span className="section-hint">
              {SECTION_LABEL.code} and {SECTION_LABEL.preview.toLowerCase()} side by side
            </span>
            <div className="section-bar-spacer" />
            {arrangementSwitcher}
          </div>
          <section className={`output-drawer${outputOpen ? ' open' : ''}`} aria-label="Output">
            <button
              className="output-toggle"
              onClick={() => setOutputOpen((open) => !open)}
              aria-expanded={outputOpen}
            >
              <ChevronIcon className={`output-chevron${outputOpen ? ' open' : ''}`} />
              <span>Console</span>
              {issues.errors > 0 ? (
                <span className="section-badge error">{issues.errors}</span>
              ) : issues.warnings > 0 ? (
                <span className="section-badge warn">{issues.warnings}</span>
              ) : null}
              {props.running ? <span className="dot running" /> : null}
            </button>
            <div
              className={`output-panel${outputOpen ? ' open' : ''}`}
              aria-hidden={!outputOpen}
              inert={!outputOpen}
            >
              <div className="output-panel-inner">
                <div className="output-panes">{output}</div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
