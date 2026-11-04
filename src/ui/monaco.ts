/**
 * Minimal Monaco build.
 *
 * `import * from 'monaco-editor'` resolves to editor.main.js, which registers all
 * 81 language definitions *and* the css/html/json/typescript language services.
 * Those services drag in multi-megabyte workers (ts.worker alone is ~6.9 MB) that
 * this app never uses — Luau diagnostics come from @luau-rs/luau in M2.
 *
 * So: the editor API, the widget, the languages we actually offer, and a curated
 * set of editing features. Nothing that starts a language service.
 */
import * as monaco from 'monaco-editor/editor/editor.api';
// Monaco 0.57's exports map is "./*": "./esm/vs/*.js", so bare subpaths below
// resolve into esm/vs/. editor.worker.js is the self-contained worker entry.
import editorWorker from 'monaco-editor/editor/editor.worker?worker';

// Core widget and commands — required for an editor to function at all.
import 'monaco-editor/editor/browser/widget/codeEditor/codeEditorWidget';
import 'monaco-editor/editor/browser/coreCommands';

// Syntax highlighting only. Note there is no Luau mode in Monaco; `lua` is the
// closest and is what the editor maps .luau files to.
import 'monaco-editor/languages/definitions/html/register';
import 'monaco-editor/languages/definitions/css/register';
import 'monaco-editor/languages/definitions/javascript/register';
import 'monaco-editor/languages/definitions/typescript/register';
import 'monaco-editor/languages/definitions/lua/register';
import 'monaco-editor/languages/definitions/python/register';

// Editing features. Deliberately excludes the language-service-backed ones.
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

(self as unknown as { MonacoEnvironment?: monaco.Environment }).MonacoEnvironment = {
  getWorker() {
    return new editorWorker();
  },
};

export { monaco };

/**
 * Monaco has no `luau` mode. Mapping it to `lua` gets correct-enough
 * highlighting for Luau without shipping a second tokenizer.
 */
export function monacoLanguageFor(language: string): string {
  return language === 'luau' ? 'lua' : language;
}
