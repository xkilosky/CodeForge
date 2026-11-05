/**
 * Core vocabulary shared by every workspace and runtime.
 * Adding a language means adding a Runtime — nothing here changes.
 */

import type { Scene } from './scene';
import type { AccentId, EditorThemeId } from './theme';

export type LanguageId =
  | 'html'
  | 'css'
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'json'
  | 'text';

export interface SourceFile {
  content: string;
  language: LanguageId;
}

/** path (e.g. "src/main.js") -> file */
export type FileMap = Record<string, SourceFile>;

export type WorkspaceId = 'web' | 'game' | 'python' | 'blank';

export interface ProjectSettings {
  /**
   * Editor scheme id. Typed loosely on purpose: a project saved by an older
   * build holds Monaco's stock `vs-dark`, and `resolveEditorTheme()` maps it
   * forward without needing a migration over IndexedDB.
   */
  theme: EditorThemeId | 'vs-dark' | 'vs' | 'tokyo-night' | 'tokyo-storm';
  autorun: boolean;
}

export interface Project {
  id: string;
  name: string;
  workspace: WorkspaceId;
  files: FileMap;
  activeFile: string;
  settings: ProjectSettings;
  /**
   * Folders the user created that hold no files yet.
   *
   * The tree normally comes from file paths — `src/App.tsx` implies `src/` —
   * so this only carries the ones that would otherwise not exist. Optional so
   * a project written before folders shipped still opens.
   */
  folders?: string[];
  /** Which accent this project wears. An id, not a hex: see `core/theme.ts`. */
  accent?: AccentId;
  /**
   * The visual scene, for workspaces that have one (the game builder).
   *
   * It lives on the project so a single IndexedDB write persists both the code
   * and the stage. Optional: a Web project has none, and a project saved before
   * the game builder existed must still open.
   */
  scene?: Scene;
  createdAt: number;
  updatedAt: number;
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  file: string;
  line: number; // 1-based
  column: number; // 1-based
  endLine?: number;
  endColumn?: number;
  severity: DiagnosticSeverity;
  message: string;
  code?: string | number;
  source: string;
}

export type ConsoleKind = 'log' | 'info' | 'warn' | 'error' | 'system';

export interface ConsoleEntry {
  id: string;
  kind: ConsoleKind;
  text: string;
  file?: string;
  line?: number;
  column?: number;
  at: number;
}

export interface IOBridge {
  log(entry: Omit<ConsoleEntry, 'id' | 'at'>): void;
  clear(): void;
}

export interface RunHandle {
  stop(): void;
}

export type PreviewMode = 'iframe' | 'canvas' | 'terminal' | 'none';

/**
 * What a runtime hands the preview panel. `srcdoc` today; the game canvas will
 * add its own kind without changing the shell.
 */
export type PreviewPayload =
  | { kind: 'srcdoc'; srcdoc: string; meta?: unknown }
  | { kind: 'placeholder'; message: string };

/** A runtime's interpretation of a message posted by its own preview. */
export type PreviewEvent =
  | { type: 'log'; entry: Omit<ConsoleEntry, 'id' | 'at'> }
  | { type: 'clear' };

export interface Runtime {
  id: string;
  label: string;
  /** What the right-hand panel shows for this runtime. */
  preview: PreviewMode;
  /** False for runtimes that land in a later milestone. */
  available: boolean;
  /** Human-readable reason when `available` is false. */
  unavailableReason?: string;
  /** Lazy engine load — called once, on first use. */
  init?(): Promise<void>;
  run(files: FileMap, entry: string, io: IOBridge): RunHandle | Promise<RunHandle>;
  /**
   * Produce what the preview panel renders. Kept on the runtime so the shell
   * stays language-agnostic.
   *
   * `scene` is only meaningful for workspaces that have one (the game builder);
   * runtimes that do not are free to ignore it. Passing it through the same
   * call keeps a single preview path instead of one per workspace shape.
   */
  buildPreview?(files: FileMap, scene?: Scene): PreviewPayload;
  /**
   * Interpret a message posted by this runtime's own preview. Keeps the shell
   * generic: the shell forwards raw data, the runtime decides what it means.
   */
  handlePreviewMessage?(data: unknown, meta: unknown): PreviewEvent | null;
  lint?(files: FileMap, options?: LintOptions): Promise<Diagnostic[]>;
}

/** Runtime-specific lint settings, forwarded to whichever runtime lints. */
export interface LintOptions {
  mode?: string;
}

export const LANGUAGE_BY_EXTENSION: Record<string, LanguageId> = {
  html: 'html',
  htm: 'html',
  css: 'css',
  js: 'javascript',
  mjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  json: 'json',
  txt: 'text',
  md: 'text',
};

export function languageForPath(path: string): LanguageId {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return LANGUAGE_BY_EXTENSION[ext] ?? 'text';
}

export function newId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
