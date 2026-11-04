/**
 * Execution worker entry.
 *
 * `serveLuaWorker` hands us the `Lua` state through `configure`, which is where
 * the Roblox API gets installed. Doing it here rather than by prepending the
 * prelude to user source matters: prepending would shift every line number, and
 * then every error and diagnostic would point at the wrong line.
 *
 * Bundled by Vite via `?worker` and supplied to `LuaWorker` through its
 * `worker` factory option.
 */
import { serveLuaWorker } from '@luau-rs/luau/worker';
import type { Lua } from '@luau-rs/luau';
import { installRobloxApi } from './configure';

await serveLuaWorker({
  configure(lua) {
    // The `Lua` type re-exported by the worker subpath is structurally the same
    // class but carries a distinct private brand, so it needs this cast.
    installRobloxApi(lua as unknown as Lua);
  },
});
