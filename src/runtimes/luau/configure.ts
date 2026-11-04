/**
 * Installs the CodeForge Roblox API into a Luau state.
 *
 * The prelude RETURNS its globals and we install them from the host, because
 * Luau's sandbox makes `_G` readonly — a script that tries `_G.Vector3 = ...`
 * fails with "attempt to modify a readonly table". Setting them through
 * `lua.globals` works, and it means the host controls the exact global surface.
 *
 * Kept separate from the worker so it can be exercised directly in tests.
 */
import { LuaTable } from '@luau-rs/luau';
import type { Lua } from '@luau-rs/luau';
import preludeSource from './prelude.luau?raw';

/** The prelude source, exposed so callers can inspect or lint it. */
export const PRELUDE_SOURCE: string = preludeSource;

/**
 * Runs the prelude and installs everything it returns as a global.
 * Returns the installed names, which is useful for tests and diagnostics.
 */
export function installRobloxApi(lua: Lua): string[] {
  const api = lua.execute(PRELUDE_SOURCE)[0];

  if (!(api instanceof LuaTable)) {
    throw new Error(
      'Roblox prelude did not return its API table — check that prelude.luau ends with `return M`',
    );
  }

  const names: string[] = [];
  for (const [key, value] of api.toMap()) {
    const name = String(key);
    lua.globals.set(name, value);
    names.push(name);
  }
  return names;
}
