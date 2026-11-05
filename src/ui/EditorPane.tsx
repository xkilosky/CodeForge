import { useEffect, useRef } from 'react';
import { monaco, monacoLanguageFor } from './monaco';
import { resolveEditorTheme } from '../core/theme';
import { modelUriFor } from './monacoMarkers';

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
  // Keep the latest callback without re-creating the editor on every keystroke.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const editor = monaco.editor.create(host, {
      ...EDITOR_OPTIONS,
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
