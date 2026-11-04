/**
 * The bootstrap module that captures the scene.
 *
 * Why a bootstrap at all: `LuaWorker` gives each execution a fresh sandboxed
 * state, and a successful run keeps no host-reachable handle. So the only way
 * to see what a script built is to return it from the *same* execution. The
 * user's script therefore runs as a `require`d module, and this bootstrap
 * requires it, then serialises the instance tree afterwards.
 *
 * Why `require` rather than string-concatenating the script: concatenation
 * would put the bootstrap's text above the user's, shifting every line number
 * and every error. As a module the user's source is byte-for-byte untouched and
 * the engine reports errors against their real filename and line — verified
 * against `@luau-rs/luau` before this design was adopted.
 *
 * The `?raw` import means Vite ships this verbatim; TypeScript never compiles it.
 */

export interface BootstrapOptions {
  /** Module specifier the user's script is registered under, e.g. "./ServerScript". */
  requirePath: string;
  /** Filename shown in the console, e.g. "ServerScript.luau". */
  displayName: string;
  /**
   * Physics round-trip. The script is re-executed from the top every tick and
   * therefore rebuilds the instance tree each time, so solved positions have to
   * be applied AFTER the script has created the parts and BEFORE touch events
   * are delivered — both steps run inside the same execution, which is what lets
   * a handler connected by the script fire on the tick it lands.
   *
   * Applying before `require` would silently do nothing: the parts do not exist
   * yet. (That ordering bug was shipped, then caught by a test.)
   */
  physics?: {
    /** Solved part positions, as plain data. */
    state: string;
    /** Touch/end events for this tick. */
    touches: string;
    /** Shared clock, so tick()/time() advance. */
    time: number;
  };
}

/**
 * Builds the bootstrap source.
 *
 * Two failures are kept separate on purpose: a failure inside user code (which
 * must be reported with the user's own file and line) and a failure in the host
 * bridge (which would be our bug). Both are surfaced, because a silently empty
 * viewport is harder to diagnose than an ugly message.
 */
export function buildBootstrapSource({
  requirePath,
  displayName,
  physics,
}: BootstrapOptions): string {
  const pathLiteral = JSON.stringify(requirePath);
  const nameLiteral = JSON.stringify(displayName);

  // The clock is safe to set first: it has no dependency on the instance tree.
  // `toLuaLiteral` is required because JSON's empty array is `[]`, which is not
  // valid Luau — `{}` is the empty table.
  const physicsHead = physics ? `__codeforge_setClock(${Number(physics.time)})\n` : '';
  // Both of these need the tree the script is about to build, so they run after
  // `require`: state so reads see solved positions, then events so handlers fire.
  const physicsTail = physics
    ? `
__codeforge_applyState(${toLuaLiteral(physics.state)})
__codeforge_deliverTouched(${toLuaLiteral(physics.touches)})
`
    : '';

  return `--!nonstrict${physicsHead ? '\n' + physicsHead : ''}
-- CodeForge render bridge. Generated per run; not part of your project.
local path = ${pathLiteral}
local displayName = ${nameLiteral}

local ok, result = pcall(require, path)
if not ok then
	-- Keep only the first line: the engine appends a stack traceback of its
	-- own when this error is rethrown, and a doubled trace reads badly.
	local message = tostring(result)
	local firstLine = string.match(message, "^([^\\n]*)") or message
	error(firstLine, 0)
end

-- Requiring returns whatever the script's last expression evaluated to, which
-- is usually nil; the instance tree, not the return value, is what matters.
-- Physics lands here: after the script built the world, before it is read back,
-- so a handler that moves a part is reflected in this frame's snapshot.
${physicsTail}
local snapshot = __codeforge_serializeScene()
return snapshot.parts
`;
}

/**
 * Converts a JSON array of flat records into a Luau table constructor.
 *
 * Deliberately not a JSON parser: the payload is always an array of objects with
 * numeric/string fields and no nesting beyond one level, which is exactly what
 * the physics bridge produces. Anything unexpected is dropped rather than
 * emitting syntax the Lua parser would reject at runtime.
 */
export function toLuaLiteral(json: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return '{}';
  }
  if (!Array.isArray(parsed)) return '{}';

  const records = parsed.map((record) => {
    if (typeof record !== 'object' || record === null) return null;
    const fields: string[] = [];
    for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
      const rendered = renderValue(value);
      if (rendered === null) continue;
      fields.push(`${safeKey(key)} = ${rendered}`);
    }
    return `{ ${fields.join(', ')} }`;
  });

  const kept = records.filter((r): r is string => r !== null);
  return `{ ${kept.join(', ')} }`;
}

function renderValue(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '0';
  }
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const fields: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const rendered = renderValue(v);
      if (rendered === null) continue;
      fields.push(`${safeKey(k)} = ${rendered}`);
    }
    return `{ ${fields.join(', ')} }`;
  }
  return null;
}

/** A Lua identifier when possible, else a bracketed string key. */
function safeKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : `[${JSON.stringify(key)}]`;
}

/** Thrown away after bootstrap validation; exported so tests can lint it. */
export const BOOTSTRAP_DISPLAY_NAME = '<codeforge-bootstrap>';
