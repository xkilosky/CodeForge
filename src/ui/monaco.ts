/**
 * Minimal Monaco build.
 *
 * `import * from 'monaco-editor'` resolves to editor.main.js, which registers all
 * 81 language definitions and every language service. Import the editor API,
 * offered languages, and curated editing features directly instead. The JS/TS
 * diagnostics service is opt-in and its multi-megabyte worker starts only for
 * JavaScript or TypeScript models.
 */
import * as monaco from 'monaco-editor/editor/editor.api';
import { MONACO_THEMES } from '../core/theme';
// Monaco accepts unknown theme ids by silently falling back to its light theme.
// Register the ids that projects store before EditorPane can create an editor.
for (const theme of MONACO_THEMES) {
  monaco.editor.defineTheme(theme.id, theme.data);
}
// Monaco 0.57's exports map is "./*": "./esm/vs/*.js", so bare subpaths below
// resolve into esm/vs/. editor.worker.js is the self-contained worker entry.
import editorWorker from 'monaco-editor/editor/editor.worker?worker';
import typeScriptWorker from 'monaco-editor/languages/features/typescript/ts.worker?worker';
import {
  javascriptDefaults,
  typescriptDefaults,
} from 'monaco-editor/languages/features/typescript/register';

// Core widget and commands — required for an editor to function at all.
import 'monaco-editor/editor/browser/widget/codeEditor/codeEditorWidget';
import 'monaco-editor/editor/browser/coreCommands';

// Syntax highlighting only.
import 'monaco-editor/languages/definitions/html/register';
import 'monaco-editor/languages/definitions/css/register';
import 'monaco-editor/languages/definitions/javascript/register';
import 'monaco-editor/languages/definitions/typescript/register';
import 'monaco-editor/languages/definitions/lua/register';
import 'monaco-editor/languages/definitions/python/register';

// Core editing features. Language-service diagnostics are configured below.
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard';
import 'monaco-editor/editor/contrib/comment/browser/comment';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu';
import 'monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo';
import 'monaco-editor/editor/contrib/find/browser/findController';
import 'monaco-editor/editor/contrib/folding/browser/folding';
import 'monaco-editor/editor/contrib/gotoError/browser/gotoError';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution';
import 'monaco-editor/editor/contrib/inPlaceReplace/browser/inPlaceReplace';
import 'monaco-editor/editor/contrib/indentation/browser/indentation';
import 'monaco-editor/editor/contrib/inlineCompletions/browser/inlineCompletions.contribution';
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations';
import 'monaco-editor/editor/contrib/links/browser/links';
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor';
import 'monaco-editor/editor/contrib/parameterHints/browser/parameterHints';
import 'monaco-editor/editor/contrib/smartSelect/browser/smartSelect';
import 'monaco-editor/editor/contrib/snippet/browser/snippetController2';
import 'monaco-editor/editor/contrib/stickyScroll/browser/stickyScrollContribution';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController';
import 'monaco-editor/editor/contrib/unicodeHighlighter/browser/unicodeHighlighter';
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations';

// Icon font. Monaco's exports map forces ".js" onto subpaths, so CSS cannot be
// imported by bare specifier — vite.config.ts aliases these two.
import 'monaco-codicon-css';
import 'monaco-codicon-modifiers-css';

// Turn on Monaco's real TypeScript compiler service only for JS/TS models. Its
// worker is emitted separately and downloaded on demand, keeping plain-text and
// HTML/CSS projects on the small editor worker path.
typescriptDefaults.setCompilerOptions({
  allowNonTsExtensions: true,
  target: 99,
  module: 99,
  moduleResolution: 2,
  jsx: 4,
  strict: true,
  noEmit: true,
});
typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: false,
  noSyntaxValidation: false,
  onlyVisible: false,
});
typescriptDefaults.setModeConfiguration({
  completionItems: false,
  hovers: false,
  documentSymbols: false,
  definitions: false,
  references: false,
  documentHighlights: false,
  rename: false,
  diagnostics: true,
  documentRangeFormattingEdits: false,
  signatureHelp: false,
  onTypeFormattingEdits: false,
  codeActions: false,
  inlayHints: false,
});

javascriptDefaults.setCompilerOptions({
  allowNonTsExtensions: true,
  allowJs: true,
  checkJs: true,
  target: 99,
  module: 99,
  moduleResolution: 2,
  strict: false,
  noEmit: true,
});
javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: false,
  noSyntaxValidation: false,
  onlyVisible: false,
});
javascriptDefaults.setModeConfiguration({
  completionItems: false,
  hovers: false,
  documentSymbols: false,
  definitions: false,
  references: false,
  documentHighlights: false,
  rename: false,
  diagnostics: true,
  documentRangeFormattingEdits: false,
  signatureHelp: false,
  onTypeFormattingEdits: false,
  codeActions: false,
  inlayHints: false,
});

(self as unknown as { MonacoEnvironment?: monaco.Environment }).MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === 'typescript' || label === 'javascript') return new typeScriptWorker();
    return new editorWorker();
  },
};

export { monaco };

/**
 * The editor's language id for a file. Kept as a function because not every
 * Monaco mode name matches our `LanguageId` one-to-one, and callers should not
 * have to know which do.
 */
export function monacoLanguageFor(language: string): string {
  return language;
}
