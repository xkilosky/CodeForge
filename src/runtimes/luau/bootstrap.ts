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
}

/**
 * Builds the bootstrap source.
 *
 * Two failures are kept separate on purpose: a failure inside user code (which
 * must be reported with the user's own file and line) and a failure in the host
 * bridge (which would be our bug). Both are surfaced, because a silently empty
 * viewport is harder to diagnose than an ugly message.
 */
export function buildBootstrapSource({ requirePath, displayName }: BootstrapOptions): string {
  const pathLiteral = JSON.stringify(requirePath);
  const nameLiteral = JSON.stringify(displayName);

  return `--!nonstrict
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
local snapshot = __codeforge_serializeScene()
return snapshot.parts
`;
}

/** Thrown away after bootstrap validation; exported so tests can lint it. */
export const BOOTSTRAP_DISPLAY_NAME = '<codeforge-bootstrap>';
