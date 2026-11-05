import { useEffect, useRef } from 'react';
import { monaco, monacoLanguageFor } from './monaco';
import { resolveEditorTheme } from '../core/theme';
import { modelUriFor } from './monacoMarkers';
import { useLayoutMode } from './useLayoutMode';

interface EditorPaneProps {
  /** Recreating the editor per path keeps models simple and avoids stale state. */
  path: string;
  content: string;
  language: string;
  /** Any theme id a project might hold; older builds stored Monaco's own ids. */
  theme: string;
  onChange: (value: string) => void;
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

export function EditorPane({ path, content, language, theme, onChange }: EditorPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const layout = useLayoutMode();
  // Keep the latest callback without re-creating the editor on every keystroke.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

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

    return () => {
      subscription.dispose();
      editor.dispose();
      editorRef.current = null;
    };
    // `content` is intentionally not a dependency: it is the initial value only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  // When a phone rotates or the window crosses the breakpoint, switch wrapping
  // without recreating the editor. Reset the horizontal position on compact
  // layouts so old scroll state cannot hide the start of every line.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateOptions({ wordWrap: layout === 'compact' ? 'on' : 'off' });
    if (layout === 'compact') editor.setScrollLeft(0);
  }, [layout]);

  // Sync externally-driven changes (template switch, file revert) without
  // clobbering what the user is typing.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== content) {
      editor.setValue(content);
    }
  }, [content]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const monacoId = monacoLanguageFor(language);
    if (model && monaco.languages.getLanguages().some((l) => l.id === monacoId)) {
      monaco.editor.setModelLanguage(model, monacoId);
    }
  }, [language]);

  useEffect(() => {
    monaco.editor.setTheme(resolveEditorTheme(theme));
  }, [theme]);

  if (!path) {
    return (
      <div className="pane-empty">
        <p>No file selected.</p>
        <p className="muted">Create one in the explorer to start editing.</p>
      </div>
    );
  }

  return <div ref={hostRef} className="editor-host" />;
}
