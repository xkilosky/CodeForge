/**
 * Parsing of Luau error messages.
 *
 * `LuaWorker` reports errors as a single string, e.g.
 *   "runtime error: ServerScript.luau:3: deliberate\nstack traceback:\n..."
 *   "syntax error: Bad.luau:2: Expected identifier when parsing expression, got '='"
 *
 * The console panel wants the message on its own plus a clickable file:line, so
 * that structure has to be pulled back apart. Some failures originate inside the
 * wasm host rather than user code; those carry a `crates/...rs:line:col` prefix
 * and must not be presented as the user's file.
 */

export interface ParsedLuauError {
  /** Luau's own classification: runtime, syntax, compile, input, memory, interrupted, host. */
  kind: string;
  /** Message with the "<kind> error: " prefix and the traceback removed. */
  message: string;
  /** User source file the error points at, when it does. */
  file?: string;
  /** 1-based line in that file. */
  line?: number;
  /** Full traceback, when present. */
  traceback?: string;
  /** True when the failure came from the host/wasm rather than user code. */
  internal: boolean;
}

const KIND_RE = /^([a-z]+) error: ([\s\S]*)$/i;
// An optional ":col" group is required: user frames are "file.luau:3: msg" but
// wasm-internal frames are "crates/x.rs:187:1323: msg".
const LOCATION_RE = /^([^:\s]+):(\d+)(?::\d+)?: ([\s\S]*)$/;
const TRACEBACK_RE = /\nstack traceback:[\s\S]*$/;

/** A wasm-internal frame, e.g. "crates/luau-wasm/src/direct/compiler.rs". */
function isInternalSource(source: string): boolean {
  return source.includes('crates/') || source.endsWith('.rs') || source === '[C]';
}

export function parseLuauError(raw: string): ParsedLuauError {
  const kindMatch = KIND_RE.exec(raw);
  const kind = kindMatch ? kindMatch[1].toLowerCase() : 'runtime';
  const body = kindMatch ? kindMatch[2] : raw;

  const tracebackMatch = TRACEBACK_RE.exec(body);
  const traceback = tracebackMatch ? tracebackMatch[0].trim() : undefined;
  const withoutTraceback = body.replace(TRACEBACK_RE, '').trim();

  const locationMatch = LOCATION_RE.exec(withoutTraceback);
  if (!locationMatch) {
    return { kind, message: withoutTraceback, internal: false, traceback };
  }

  const [, source, rawLine, message] = locationMatch;
  const line = Number.parseInt(rawLine, 10);
  const internal = isInternalSource(source);

  return {
    kind,
    message: message.trim(),
    // An internal frame is not something the user can open, so drop the
    // location rather than send them to a file that does not exist.
    file: internal ? undefined : source,
    line: internal || !Number.isFinite(line) ? undefined : line,
    internal,
    traceback,
  };
}

/** Renders a parsed error the way the console panel displays it. */
export function formatLuauError(parsed: ParsedLuauError): string {
  const location = parsed.file && parsed.line ? ` (${parsed.file}:${parsed.line})` : '';
  const base = `${parsed.message}${location}`;
  return parsed.traceback ? `${base}\n${parsed.traceback}` : base;
}
