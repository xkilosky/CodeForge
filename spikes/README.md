# Feasibility spikes

Evidence for the claims in [PLAN.md §3](../PLAN.md). Each spike proves one load-bearing
assumption. Nothing here ships in the app — these are the receipts.

```bash
cd spikes && npm install
```

| Script | Proves | Key result |
|---|---|---|
| `spike1-syntax.mjs` | It's real Luau, not Lua 5.4 | `+=`, `continue`, type annotations, `` `{interp}` `` all run; returns `25`. Also shows `typeof(warn)` → `"nil"` before shimming. |
| `spike3-prelude.mjs` | A Roblox API can be injected as a Luau **prelude** | `Vector3`/`Color3`/`Enum`/`Instance`/`workspace` built a 6-object scene and pushed it to a JS render queue. |
| `spike4-limits.mjs` | Untrusted code is contained | `LuaWorker` kills infinite loop / memory bomb / output bomb in ~1.1s; valid script returns `42` in ~117ms. |
| `spike5-analysis.mjs` | Real diagnostics exist | `AnalysisWorker` reports unknown globals and parse errors. |
| `spike6-diag-shape.mjs` | Diagnostics are editor-usable | `location: {begin:{line,column}, end:{line,column}}`, `code: 1001`; ~307ms per check. |
| `spike7-physics.mjs` | Physics runs client-side with **no wasm fetch** | Rapier 0.21.0 at Roblox gravity (196.2 studs/s²); Part falls `60 → 35.27 → 0.5` and rests on the baseplate; `.Touched` fires. |
| `spike8-three.mjs` | Roblox Part maps directly to three.js | `Size (4,1,2)` @ `Position (12,20,0)` → AABB size `4,1,2`, center `12,20,0`, `#6ee5a0`. No offset math needed. |

## Dead ends worth remembering

These cost real time; recorded so they aren't rediscovered.

- **Writing globals from a prelude fails.** In sandbox mode `_G` is readonly —
  *"attempt to modify a readonly table"*. The prelude must `return` its API table and the host
  installs each global with `lua.globals.set()`.
- **`LuaTable.get(k)` returns a `LuaFunction` handle that is not JS-callable.** Calling it
  throws. Use `table.callMethod(name, args)` — or better, keep the API in Luau and cross into
  JS only for a handful of host bridges.
- **`contactPairsWith` yields Collider objects, not handles.** Comparing `other === collider.handle`
  silently never matches; compare `other.handle`.
- **`warn` does not exist** in this Luau build; the shim has to provide it.
- **A parse error suppresses subsequent type diagnostics**, so syntax errors must be surfaced
  and re-checked before type errors appear.
