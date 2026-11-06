import type { Diagnostic, FileMap } from '../core/types';
import { setCompilerDiagnostics } from '../core/diagnosticsStore';
import { monaco, monacoLanguageFor } from './monaco';

/**
 * Monaco models are keyed by URI so diagnostics can be attached to a specific
 * file even when it is not the open tab. `inmemory://` avoids any network
 * implication and keeps paths readable in the UI.
 */
export function modelUriFor(path: string): monaco.Uri {
  return monaco.Uri.parse(`inmemory://codeforge/${path}`);
}

let activeProjectPaths = new Set<string>();

/** Keep every JS/TS project file in Monaco so imports can be checked together. */
export function syncProjectModels(files: FileMap | undefined): void {
  activeProjectPaths = new Set(files ? Object.keys(files) : []);
  for (const [path, file] of Object.entries(files ?? {})) {
    if (file.language !== 'typescript' && file.language !== 'javascript') continue;
    const uri = modelUriFor(path);
    const language = monacoLanguageFor(file.language);
    const model = monaco.editor.getModel(uri);
    if (model) {
      if (model.getLanguageId() !== language) monaco.editor.setModelLanguage(model, language);
      if (model.getValue() !== file.content) model.setValue(file.content);
    } else {
      monaco.editor.createModel(file.content, language, uri);
    }
  }
  syncCompilerDiagnostics();
}

function syncCompilerDiagnostics(): void {
  const diagnostics: Diagnostic[] = [];
  for (const model of monaco.editor.getModels()) {
    const language = model.getLanguageId();
    const path = model.uri.path.replace(/^\/+/, '');
    if (!activeProjectPaths.has(path)) continue;
    if (language !== 'typescript' && language !== 'javascript') continue;
    const source = language === 'typescript' ? 'TypeScript' : 'JavaScript';
    for (const marker of monaco.editor.getModelMarkers({ resource: model.uri })) {
      if (marker.owner === 'codeforge') continue;
      const code = typeof marker.code === 'string' ? marker.code : marker.code?.value;
      diagnostics.push({
        file: model.uri.path.replace(/^\/+/, ''),
        line: marker.startLineNumber,
        column: marker.startColumn,
        endLine: marker.endLineNumber,
        endColumn: marker.endColumn,
        severity:
          marker.severity === monaco.MarkerSeverity.Error
            ? 'error'
            : marker.severity === monaco.MarkerSeverity.Warning
              ? 'warning'
              : 'info',
        message: marker.message,
        code,
        source,
      });
    }
  }
  setCompilerDiagnostics(diagnostics);
}

// The TypeScript worker publishes fresh markers as the user types. Mirror them
// into Problems as well as leaving Monaco's native red/amber squiggles intact.
monaco.editor.onDidChangeMarkers(syncCompilerDiagnostics);

function severityFor(severity: Diagnostic['severity']): monaco.MarkerSeverity {
  if (severity === 'error') return monaco.MarkerSeverity.Error;
  if (severity === 'warning') return monaco.MarkerSeverity.Warning;
  return monaco.MarkerSeverity.Info;
}

/** Files we have already marked, so stale markers get cleared. */
let markedPaths = new Set<string>();

export function applyMarkers(diagnostics: Diagnostic[]): void {
  const byFile = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    const list = byFile.get(d.file);
    if (list) list.push(d);
    else byFile.set(d.file, [d]);
  }

  // Clear markers for files that are now clean.
  for (const path of markedPaths) {
    if (!byFile.has(path)) {
      const model = monaco.editor.getModel(modelUriFor(path));
      if (model) monaco.editor.setModelMarkers(model, 'codeforge', []);
    }
  }

  for (const [path, list] of byFile) {
    const model = monaco.editor.getModel(modelUriFor(path));
    if (!model) continue;

    const lineCount = model.getLineCount();
    const markers = list.map((d) => {
      // Clamp: a diagnostic can point past the end of a file that has since
      // been edited, and Monaco rejects out-of-range markers.
      const startLine = Math.min(Math.max(d.line, 1), lineCount);
      const endLine = Math.min(Math.max(d.endLine ?? d.line, startLine), lineCount);
      const lineLength = model.getLineLength(startLine);
      const endLineLength = model.getLineLength(endLine);

      return {
        severity: severityFor(d.severity),
        message: d.code ? `${d.message} (${d.source} ${d.code})` : `${d.message} (${d.source})`,
        startLineNumber: startLine,
        startColumn: Math.min(Math.max(d.column, 1), lineLength + 1),
        endLineNumber: endLine,
        endColumn: Math.min(Math.max(d.endColumn ?? lineLength + 1, 1), endLineLength + 1),
      };
    });

    monaco.editor.setModelMarkers(model, 'codeforge', markers);
  }

  markedPaths = new Set(byFile.keys());
}

/** Drops all markers, e.g. when switching to a runtime with no linter. */
export function clearAllMarkers(): void {
  for (const path of markedPaths) {
    const model = monaco.editor.getModel(modelUriFor(path));
    if (model) monaco.editor.setModelMarkers(model, 'codeforge', []);
  }
  markedPaths = new Set();
}
