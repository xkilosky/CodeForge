/**
 * Core vocabulary shared by every workspace and runtime.
 * Adding a language means adding a Runtime — nothing here changes.
 */

export type LanguageId =
  | 'html'
  | 'css'
  | 'javascript'
  | 'typescript'
  | 'luau'
  | 'python'
  | 'json'
  | 'text';

export interface SourceFile {
  content: string;
  language: LanguageId;
}

/** path (e.g. "src/main.js") -> file */
export type FileMap = Record<string, SourceFile>;

export type WorkspaceId = 'roblox' | 'web' | 'game' | 'python' | 'blank';

export interface ProjectSettings {
  theme: 'vs-dark' | 'vs';
  autorun: boolean;
  /**
   * Luau analysis mode. `strict` catches type mismatches (e.g. assigning a
   * string to a `number`); `nonstrict` matches Roblox Studio's default and only
   * reports clear errors. Ignored by other runtimes.
   */
  analysisMode: 'strict' | 'nonstrict' | 'nocheck';
}

export interface Project {
  id: string;
  name: string;
  workspace: WorkspaceId;
  files: FileMap;
  activeFile: string;
  settings: ProjectSettings;
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

export type PreviewMode = 'roblox-viewport' | 'iframe' | 'canvas' | 'terminal' | 'none';

/**
 * What a runtime hands the preview panel. `srcdoc` today; the Roblox viewport
 * and game canvas will add their own kinds without changing the shell.
 */
export type PreviewPayload =
  | { kind: 'srcdoc'; srcdoc: string; meta?: unknown }
  | { kind: 'viewport'; meta?: unknown }
  | { kind: 'placeholder'; message: string };

/* ------------------------------------------------------------------ *
 * Scene snapshot — the render bridge
 * ------------------------------------------------------------------ */

/** Plain-data mirror of a rendered Roblox part. Survives the Lua/JS boundary. */
export interface ScenePart {
  /** Stable id from the Luau Instance tree, so re-runs keep identity. */
  id: number;
  className: string;
  name: string;
  path: string;
  position: Vec3Json;
  size: Vec3Json;
  color: ColorJson;
  transparency: number;
  reflectance: number;
  anchored: boolean;
  material: string;
  /** Physics descriptors, read by the M4 solver. */
  canCollide: boolean;
  canTouch: boolean;
  velocity: Vec3Json;
}

export interface Vec3Json {
  x: number;
  y: number;
  z: number;
}

export interface ColorJson {
  r: number;
  g: number;
  b: number;
}

/** A renderable camera, when the script made one. */
export interface SceneCamera {
  position: Vec3Json;
  /** Degrees, matching Roblox's orientation convention. */
  cframe?: {
    position: Vec3Json;
    /** Row-major 3x3 rotation. */
    rotation: number[];
  };
}

/** One complete frame of the simulated world. */
export interface SceneSnapshot {
  parts: ScenePart[];
  camera?: SceneCamera;
  /** Increments per run so the viewport can tell a new run from a redraw. */
  runId: number;
}

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
   */
  buildPreview?(files: FileMap): PreviewPayload;
  /**
   * Interpret a message posted by this runtime's own preview. Keeps the shell
   * generic: the shell forwards raw data, the runtime decides what it means.
   */
  handlePreviewMessage?(data: unknown, meta: unknown): PreviewEvent | null;
  lint?(files: FileMap, options?: LintOptions): Promise<Diagnostic[]>;
  /**
   * A runtime whose preview is driven by execution output rather than by a
   * pure function of the files. The shell runs it automatically when autorun
   * is on, because there is no static equivalent of the scene.
   */
  buildViewport?(files: FileMap): PreviewPayload;
}

/** Runtime-specific lint settings. `mode` is the Luau analysis mode today. */
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
  lua: 'luau',
  luau: 'luau',
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
