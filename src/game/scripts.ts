/**
 * The compiler for a game project's script.
 *
 * **This mirrors the compiler inside `SIM_RUNTIME`.** The real compilation
 * happens in the preview frame, where the script actually runs; this module
 * exists so the same rules can be exercised in Node, and so the builder can
 * explain a script's shape without booting a frame.
 *
 * The two must not drift. `tests/game-script.test.ts` compiles the same sources
 * through both and asserts they agree, so a change here that is not mirrored
 * there fails the suite rather than producing a preview that behaves unlike the
 * tests.
 */

export interface CompiledScript {
  /** Set when compilation failed. */
  error: string | null;
  /** 1-based line in the user's file, when the engine reports one. */
  line: number | null;
  /** The hook, or null when the script defines none. */
  hookName: 'onUpdate' | 'update' | null;
  /** True when a hook was found and returned. */
  hasHook: boolean;
}

/**
 * `new Function` bodies are not modules, so `export` is a syntax error there.
 * Removing the keyword is what lets the template look like a normal module
 * while still running inside a plain script.
 */
export function stripExports(source: string): string {
  // Anchored to the start of a line. A bare `\bexport\b` also rewrites the
  // inside of string literals — `const label = "export function"` is data, and
  // silently changing it is the kind of bug that shows up as a wrong message
  // rather than as a crash.
  return source
    .replace(/^[ \t]*export\s+(async\s+)?function\b/gm, '$1function')
    .replace(/^[ \t]*export\s+(const|let|var)\b/gm, '$1');
}

/** The body handed to `new Function`: user code, then the hook lookup. */
export function scriptBody(source: string): string {
  return `${stripExports(source)}
; if (typeof onUpdate === "function") return onUpdate;
  if (typeof update === "function") return update;
  return null;`;
}

/**
 * Pulls a line number out of an engine-specific error message or stack.
 *
 * `expectedLines` is the user's own line count. Engines disagree about whether
 * a `new Function` body starts at line 1 or 2, and V8's syntax errors carry no
 * position at all — only its stack frames do. Any candidate outside the user's
 * file is therefore a position in the shim above it, not something to show.
 */
export function errorLine(err: unknown, expectedLines: number): number | null {
  const raw = err as { message?: string; stack?: string } | null;
  const text = `${raw?.stack ?? ''} ${raw?.message ?? ''}`;
  const match = /:(\d+):\d+/.exec(text) ?? /line (\d+)/i.exec(text);
  if (!match) return null;
  const line = Number(match[1]);
  if (!Number.isFinite(line) || line < 1) return null;
  // Two lines of slack: the wrapper line above and a trailing newline.
  if (line > Math.max(1, expectedLines) + 2) return null;
  return line;
}

/**
 * Compiles the script the same way the preview does.
 *
 * Runs the body but keeps the hook rather than calling it: the point is to
 * prove the file parses and defines something callable before the user presses
 * Play, and to name the line when it does not.
 */
export function compileScript(source: string): CompiledScript {
  try {
    const factory = new Function(scriptBody(source)) as () => unknown;
    const hook = factory();
    if (typeof hook === 'function') {
      const name = /function\s+(onUpdate|update)\b/.exec(String(hook))?.[1];
      const hookName = name === 'update' ? 'update' : name === 'onUpdate' ? 'onUpdate' : 'onUpdate';
      return { error: null, line: null, hookName, hasHook: true };
    }
    return { error: null, line: null, hookName: null, hasHook: false };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
      line: errorLine(err, source.split('\n').length),
      hookName: null,
      hasHook: false,
    };
  }
}

/** A message for the console, or null when the script is fine. */
export function describeScriptProblem(result: CompiledScript, path: string): string | null {
  if (result.error) {
    const where = result.line ? `${path}:${result.line}` : path;
    return `Script error in ${where} — ${result.error}`;
  }
  if (!result.hasHook) {
    return `${path} defines no onUpdate(ctx). The scene still runs; add the hook to animate it.`;
  }
  return null;
}
