import { useEffect, useRef } from 'react';
import { monaco, monacoLanguageFor } from './monaco';
import { resolveEditorTheme } from '../core/theme';
import { modelUriFor } from './monacoMarkers';
import { useLayoutMode } from './useLayoutMode';

export interface EditorReveal {
  path: string;
  line: number;
  column: number;
  length: number;
  sequence: number;
}

interface EditorPaneProps {
  /** Recreating the editor per path keeps models simple and avoids stale state. */
  path: string;
  content: string;
  language: string;
  /** Any theme id a project might hold; older builds stored Monaco's own ids. */
  theme: string;
  onChange: (value: string) => void;
  reveal?: EditorReveal;
  /** Comparison snapshots enable a read-only line-by-line diff view. */
  diffOriginal?: string;
  diffModified?: string;
  onExitDiff?: () => void;
}

const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  minimap: { enabled: false },
  fontSize: 13,
  lineNumbers: 'on',
  scrollBeyondLastLine: false,
  tabSize: 2,
  smoothScrolling: true,
  renderWhitespace: 'selection',
  padding: { top: 10 },
};

export function EditorPane({
  path,
  content,
  language,
  theme,
  onChange,
  reveal,
  diffOriginal,
  diffModified,
  onExitDiff,
}: EditorPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const diffModelsRef = useRef<{ original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel } | null>(null);
  const lastRevealSequence = useRef<number | null>(null);
  const isDiffView = diffOriginal !== undefined;
  const layout = useLayoutMode();
  // Keep the latest callback without re-creating the editor on every keystroke.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    if (isDiffView) {
      const originalUri = monaco.Uri.parse(
        `inmemory://codeforge-diff/${encodeURIComponent(path)}/original`,
      );
      const modifiedUri = monaco.Uri.parse(
        `inmemory://codeforge-diff/${encodeURIComponent(path)}/modified`,
      );
      const original = monaco.editor.createModel(
        diffOriginal ?? '',
        monacoLanguageFor(language),
        originalUri,
      );
      const modified = monaco.editor.createModel(
        diffModified ?? content,
        monacoLanguageFor(language),
        modifiedUri,
      );
      const diffEditor = monaco.editor.createDiffEditor(host, {
        ...EDITOR_OPTIONS,
        readOnly: true,
        originalEditable: false,
        renderSideBySide: layout !== 'compact',
        renderIndicators: true,
        theme: resolveEditorTheme(theme),
        wordWrap: layout === 'compact' ? 'on' : 'off',
      });
      diffEditor.setModel({ original, modified });
      diffEditorRef.current = diffEditor;
      diffModelsRef.current = { original, modified };

      return () => {
        diffEditor.setModel(null);
        diffEditor.dispose();
        original.dispose();
        modified.dispose();
        diffEditorRef.current = null;
        diffModelsRef.current = null;
      };
    }

    const editor = monaco.editor.create(host, {
      ...EDITOR_OPTIONS,
      // A finger swipe should not leave a phone looking at the middle of every
      // line. Wrapping keeps the code's left edge visible at compact widths.
      wordWrap: layout === 'compact' ? 'on' : 'off',
      theme: resolveEditorTheme(theme),
    });

    // URI-keyed models let diagnostics target a file that is not the open tab.
    const uri = modelUriFor(path);
    const existing = monaco.editor.getModel(uri);
    const model =
      existing ?? monaco.editor.createModel(content, monacoLanguageFor(language), uri);
    editor.setModel(model);
    editorRef.current = editor;

    const subscription = editor.onDidChangeModelContent(() => {
      onChangeRef.current(editor.getValue());
    });
    let revealFrame = 0;
    const revealCaret = () => {
      if (!editor.hasTextFocus() || revealFrame) return;
      revealFrame = window.requestAnimationFrame(() => {
        revealFrame = 0;
        if (editorRef.current !== editor || !editor.hasTextFocus()) return;
        editor.layout();
        const position = editor.getPosition();
        if (position) editor.revealPositionInCenterIfOutsideViewport(position);
      });
    };
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', revealCaret);
    viewport?.addEventListener('scroll', revealCaret);
    window.addEventListener('resize', revealCaret);

    return () => {
      subscription.dispose();
      viewport?.removeEventListener('resize', revealCaret);
      viewport?.removeEventListener('scroll', revealCaret);
      window.removeEventListener('resize', revealCaret);
      if (revealFrame) window.cancelAnimationFrame(revealFrame);
      editor.dispose();
      editorRef.current = null;
    };
    // `content` and diffOriginal are the initial model values; sync below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, isDiffView]);

  // When a phone rotates or the window crosses the breakpoint, switch wrapping
  // without recreating the editor. Reset the horizontal position on compact
  // layouts so old scroll state cannot hide the start of every line.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor) {
      editor.updateOptions({ wordWrap: layout === 'compact' ? 'on' : 'off' });
      if (layout === 'compact') editor.setScrollLeft(0);
    }
    diffEditorRef.current?.updateOptions({
      renderSideBySide: layout !== 'compact',
      wordWrap: layout === 'compact' ? 'on' : 'off',
    });
  }, [layout]);

  // Sync externally-driven diff inputs without recreating Monaco models.
  useEffect(() => {
    const models = diffModelsRef.current;
    if (!models) return;
    if (diffOriginal !== undefined && models.original.getValue() !== diffOriginal) {
      models.original.setValue(diffOriginal);
    }
    const modifiedValue = diffModified ?? content;
    if (models.modified.getValue() !== modifiedValue) models.modified.setValue(modifiedValue);
  }, [content, diffOriginal, diffModified]);

  // Sync externally-driven changes (template switch, file revert) without
  // clobbering what the user is typing.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== content) {
      editor.setValue(content);
    }
  }, [content]);

  useEffect(() => {
    const monacoId = monacoLanguageFor(language);
    if (!monaco.languages.getLanguages().some((l) => l.id === monacoId)) return;
    const model = editorRef.current?.getModel();
    if (model) monaco.editor.setModelLanguage(model, monacoId);
    const diffModels = diffModelsRef.current;
    if (diffModels) {
      monaco.editor.setModelLanguage(diffModels.original, monacoId);
      monaco.editor.setModelLanguage(diffModels.modified, monacoId);
    }
  }, [language]);

  useEffect(() => {
    monaco.editor.setTheme(resolveEditorTheme(theme));
  }, [theme]);

  useEffect(() => {
    const editor = editorRef.current ?? diffEditorRef.current?.getModifiedEditor();
    const model = editor?.getModel();
    if (
      !editor ||
      !model ||
      !reveal ||
      reveal.path !== path ||
      lastRevealSequence.current === reveal.sequence
    ) return;
    lastRevealSequence.current = reveal.sequence;

    const line = Math.max(1, Math.min(reveal.line, model.getLineCount()));
    const maxColumn = model.getLineMaxColumn(line);
    const column = Math.max(1, Math.min(reveal.column, maxColumn));
    const endColumn = Math.max(column, Math.min(column + reveal.length, maxColumn));
    editor.revealPositionInCenter({ lineNumber: line, column });
    editor.setSelection({
      startLineNumber: line,
      startColumn: column,
      endLineNumber: line,
      endColumn,
    });
    editor.focus();
  }, [path, reveal?.sequence]);

  if (!path) {
    return (
      <div className="pane-empty">
        <p>No file selected.</p>
        <p className="muted">Create one in the explorer to start editing.</p>
      </div>
    );
  }

  if (isDiffView) {
    return (
      <div className="editor-diff-pane">
        <header className="editor-diff-toolbar">
          <div className="editor-diff-title">
            <span className="editor-diff-eyebrow">DIFF</span>
            <span className="editor-diff-path" title={path}>{path}</span>
          </div>
          <div className="editor-diff-scope" aria-label="Comparing previous and current versions">
            <span>BEFORE</span><b>→</b><span>AFTER</span>
          </div>
          <div className="editor-diff-legend" aria-label="Diff colors">
            <span className="added"><i />Added</span>
            <span className="deleted"><i />Deleted</span>
          </div>
          {onExitDiff ? (
            <button type="button" className="editor-diff-close" onClick={onExitDiff}>
              Back to editor
            </button>
          ) : null}
        </header>
        <div ref={hostRef} className="editor-host" />
      </div>
    );
  }

  return <div ref={hostRef} className="editor-host" />;
}
