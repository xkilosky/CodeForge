# CodeForge — Project Plan

> **Status: the Roblox/Luau pillar described below is RETIRED and has been removed from the code.**
> The Lua VM, the Roblox API prelude, the three.js viewport, the Rapier physics loop, and the
> `roblox`/`luau` templates are gone (see README). This document is kept as the design record: the
> feasibility results, the measured costs, and the reasoning are still accurate history, and the
> remaining milestones (visual game builder, Python) are renumbered from it.
>
> **M6 — files, folders and the new interface — is built (Forge S1.6).** A drawer, a real file
> tree, the Tokyo Night palette, quick open, project-wide replace and export/import.
>
> **M5 — the visual game builder — is built.** It was scoped down from the Pixi/ECS design below:
> an AABB platformer on a 2D canvas, not a general engine. See §9.


**Universal coding environment in the browser.** Write HTML for the web, build games visually, and
run other languages — each with a live preview, no install, no server.

> **Historical status: planning, decisions locked.** The repo contained only a 12-byte `README.md` at
> commit `68f00b3`. Every technical claim in §3 was measured in this workspace, not assumed —
> the scripts are in [`spikes/`](spikes/README.md).

---

## 1. Locked decisions

| # | Question | Decision | Consequence |
|---|---|---|---|
| 1 | Roblox preview fidelity | **Push the simulator hard** | Physics, lighting, GUI, and particles become a first-class pillar, not an afterthought. Biggest single chunk of work. |
| 2 | Where code runs | **Fully client-side, no server** | Everything is WASM in the browser. Static hosting only, works offline, zero per-user compute cost. |
| 3 | "Games" category | **Visual game builder** | A scene editor: place objects visually, set properties, attach code. Not just "inject a JS library". |
| 4 | Who uses it | **Local-first, no accounts** | IndexedDB persistence, export/import for backup. No auth, no database, no sync. |

These four are compatible and reinforce each other: client-only + local-first means the app is
a **static site**, and the two heavy pillars (Roblox simulator, visual builder) are both pure
frontend work.

---

## 2. Product shape

Three workspaces, one shell:

| Workspace | What you do | Preview |
|---|---|---|
| **Roblox** | Write Luau, build a place | Simulated 3D viewport (physics + lighting + GUI) |
| **Web** | Write HTML / CSS / JS | Live iframe with captured console |
| **Games** | Place objects on a canvas, attach code | 2D game canvas with a play/stop transport |

Plus a **Languages** area for Python and other runtimes, where the preview is a terminal or
rendered output rather than a viewport.

The unifying idea: a language is a pluggable **Runtime** providing an executor, a diagnostic
source, and a preview mode. Files, tabs, console, persistence, and layout stay language-agnostic.

---

## 3. Verified technical foundation

Eight spikes were run in this workspace (`node --version` → v22.22.3).

| # | Question | Result |
|---|---|---|
| 1 | Is it real Luau, not Lua 5.4? | **Yes.** `+=`, `continue`, `type Point = {...}`, and `` `{interp}` `` all compiled and ran; loop returned `25` (1+3+5+7+9). Package targets **Luau v739**. |
| 2 | Can we inject a Roblox-style API? | **Yes.** A Luau **prelude** defining `Vector3` (`__add`/`__tostring`/`:Magnitude()`/`:Lerp()`), `Color3`, `Enum.Material`, `Instance.new` with `:FindFirstChild`/`:GetChildren`/`:Clone`, `workspace`, `game` ran real user code and built a 6-object scene. |
| 3 | Can it drive a renderer? | **Yes.** The prelude pushed 6 `Part`s with position/size/color through a JS host callback into a render queue — exactly what a viewport needs. |
| 4 | Is untrusted code contained? | **Yes.** `LuaWorker` enforces `memoryLimitBytes: 33554432`, `interruptLimit: 250000`, `outputLimitBytes: 65536`, `outputLimitEvents: 1024`. Infinite loop, memory bomb, and output bomb all died in **~1.1s**; a valid script returned `42` in 117 ms. |
| 5 | Real diagnostics? | **Yes.** `AnalysisWorker` returned `{kind, severity, code: 1001, location: {begin:{line,column}, end:{line,column}}}` — what editor squiggles need. One check = **307 ms** → debounce. |
| 6 | Physics, client-side, no fetch? | **Yes.** `@dimforge/rapier3d-compat` 0.21.0 loaded with inlined wasm, ran at Roblox's gravity (**196.2 studs/s²**); a Part fell `60 → 35.27 → 0.5` and **rested on the baseplate**. |
| 7 | `.Touched` events? | **Yes** — `world.contactPairsWith()` reports contacts. **Gotcha:** the callback receives a *Collider object*, not a handle; compare `.handle`. |
| 8 | Roblox Part → three.js mesh? | **Yes, and the coordinate mapping is direct.** `Size (4,1,2)` at `Position (12,20,0)` → `BoxGeometry(4,1,2)`, measured AABB size `4,1,2`, center `12,20,0`, `Color3.fromRGB(40,200,90)` → `#6ee5a0`. Roblox `Position` is the part **center** and so is three's mesh origin, so no offset math is needed. |

### Constraints discovered (these shape the design)

1. **Sandbox mode makes `_G` readonly.** `_G.Vector3 = ...` fails with *"attempt to modify a
   readonly table"*. → The prelude must **`return`** its API table; the host installs each global
   via `lua.globals.set()`. Better design anyway: the host controls the exact global surface.
2. **`warn` is `nil` in this build** (`typeof(warn)` → `"nil"`). The shim must supply it.
3. **`LuaTable.get(k)` returns a `LuaFunction` handle that is *not* JS-callable.** → Use
   `table.callMethod(name, args)`. Better: keep the API **in Luau** and use JS only for the few
   host bridges (render, physics, console, time, input, audio). Avoids thousands of JS↔WASM
   crossings per frame.
4. **A parse error suppresses later type diagnostics** — the checker reported 1 of 3 planted
   issues. → Report syntax errors first, re-check once they clear.
5. **`contactPairsWith` yields Collider objects**, not handles (see spike 7).
6. `@luau-rs/luau` is **ESM-only** and ships **two** wasm blobs; total install **8.4 MB**.

### Dependency shortlist (versions + sizes from the npm registry)

| Package | Version | Unpacked | Role |
|---|---|---|---|
| `@luau-rs/luau` | 0.739.0 | 8.66 MB | Luau VM + compiler + analysis. The Roblox engine. ✅ tested |
| `@dimforge/rapier3d-compat` | 0.21.0 | 15.04 MB | Physics. Inlined wasm → **no fetch**, works offline. ✅ tested |
| `three` | 0.187.0 | 21.03 MB | 3D renderer for the Roblox viewport. ✅ tested |
| `pixi.js` | 8.22.0 | 76.27 MB | 2D renderer for the visual game builder |
| `monaco-editor` | 0.57.0 | 101.67 MB | Editor. Tree-shake to needed languages. |
| `pyodide` | 314.0.7 | 13.88 MB | Python, in-browser |
| `@rbxts/types` | 1.0.961 | — | Roblox API typings → generate autocomplete |
| `codemirror-mode-luau` | 1.0.9 | — | Luau highlighting fallback |

**Rejected:** `wasmoon` 1.16.0 is **Lua 5.4, not Luau** — cannot parse `+=`, `continue`, or type
annotations. `cannon-es` 0.20.0 is only 0.77 MB but last published **2022-08-12** (stale).
`phaser` 4.2.1 is 112 MB and is a full framework, which fights a *visual builder* where we own
the scene model. `kaplay` is tiny (4 MB) but last published 2025-06-15.

**Bundle budget:** these sum to far more than one page should download. Every engine
**lazy-loads on first use of its workspace** (§9). Target: first paint < 1.5 MB, each workspace
engine fetched only when opened.

**Measured (M0 build, `npx vite build`):** the naive `import * from 'monaco-editor'` pulls
`editor.main.js`, which registers all 81 language definitions *and* the css/html/json/typescript
language services — emitting `ts.worker` (6.9 MB), `css.worker` (1.08 MB), `html.worker` (743 KB),
and `json.worker` (433 KB). Importing the editor API + the 6 languages we offer + a curated
feature set instead:

| | full Monaco | minimal Monaco |
|---|---|---|
| `dist/` total | 14 MB | **4.5 MB** |
| monaco chunk (gzip) | 1,135 KB | **963 KB** |
| language-service workers | 9.2 MB | **0** |

Total JS gzip for first paint ≈ **1.04 MB** (monaco 963 + react 68 + app 9), inside the 1.5 MB
target before any workspace engine is loaded. Trade-off accepted: Monaco has no JSON language
*definition* (only the worker-backed service), so `.json` falls back to plaintext.

---

## 4. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Shell (React): workspace switcher · explorer · tabs · editor ·      │
│                 preview · console · property inspector               │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│  Core                                                                │
│  ProjectStore (files, scene, tabs, settings) → IndexedDB, autosaved  │
│  RunSession  (start/stop/restart, stdout+stderr, kill, timers)       │
│  DiagnosticsBus (debounced 400ms, per-runtime)                       │
│  AssetStore (uploaded images/audio → IndexedDB blobs)                │
└───────────────────────────────┬──────────────────────────────────────┘
                                │  interface Runtime
   ┌────────────────┬───────────┴─────────┬───────────────┬────────────┐
   │ luau-roblox    │ html-web            │ game-builder  │ python     │
   ├────────────────┼─────────────────────┼───────────────┼────────────┤
   │ LuaWorker      │ iframe srcdoc       │ ECS + Pixi    │ Pyodide    │
   │ + prelude      │                     │ + per-object  │            │
   │ + rapier3d     │                     │   scripts     │            │
   ├────────────────┼─────────────────────┼───────────────┼────────────┤
   │ three.js       │ iframe              │ canvas        │ terminal   │
   │ + DOM GUI layer│                     │ + transport   │ / image    │
   └────────────────┴─────────────────────┴───────────────┴────────────┘
```

```ts
interface Runtime {
  id: string
  preview: 'roblox-viewport' | 'iframe' | 'canvas' | 'terminal' | 'none'
  init(): Promise<void>                                  // lazy engine load
  run(files: FileMap, entry: string, io: IOBridge): Promise<RunHandle>
  lint?(files: FileMap): Promise<Diagnostic[]>
  export?(files: FileMap): Promise<Blob>
}
```

Adding a language = adding a runtime. Nothing in Core or the shell changes.

---

## 5. Pillar A — the Roblox simulator (the big one)

Chosen deliberately over a thin preview, so it is scoped honestly. Four sub-systems, in
dependency order:

**A1. Scene & rendering.** three.js. `Part`, `MeshPart`, `WedgePart`, `SpherePart`,
`CylinderPart` with color / material / transparency / reflectance. Orbit, first-person, and
follow cameras. Verified mapping in §3 spike 8.

**A2. Physics.** Rapier3D. `Anchored`, `CanCollide`, `Mass`, `CustomPhysicalProperties`,
`BodyVelocity`, `BodyForce`, `BodyGyro`, `AlignPosition`, `VectorForce`. `.Touched` /
`.TouchEnded` from `contactPairsWith`. Roblox uses a Bullet-derived solver, so **results will
differ** — the viewport carries a permanent "simulation" badge.

**A3. Lighting.** `Lighting` service → three.js lights: `Ambient`, `Brightness`, `ClockTime`,
`ColorShift`, `FogEnd`/`FogStart`/`FogColor`, `GlobalShadows`. Day/night cycle driven by
`ClockTime`.

**A4. GUI.** **Key architectural choice:** render `ScreenGui` / `Frame` / `TextLabel` /
`TextButton` / `ImageLabel` as **real DOM elements layered over the canvas**, not as canvas
drawing. CSS gives us positioning, text shaping, and input handling for free, and `UDim2`
maps cleanly onto percentage + pixel offsets. Covers anchors, offsets, `ZIndex`, `Visible`,
`Active`, basic `UIListLayout`/`UITextSizeConstraint`.

**A5. Particles.** `ParticleEmitter` → three.js `Points`: `Rate`, `Lifetime`, `Speed`,
`SpreadAngle`, `Color`/`Size`/`Transparency` as `NumberSequence`/`ColorSequence`, `Rotation`.

**Explicitly out of scope** (each raises a *named* error rather than silently returning `nil`):
real client↔server networking, `HttpService` requests, DataStores, terrain editing, the full
constraint solver, `PathfindingService`, and exact Roblox lighting parity.

**Escape hatch:** even with a deep simulator, `.rbxlx` export stays valuable so users can
verify in real Studio. Deferred to M7 rather than dropped.

---

## 6. Pillar B — the visual game builder

Not "write engine code" — **place things, then script them**.

- **Scene model (our own ECS):** `Entity { id, name, type, position, size, rotation, z,
  visible, props, scriptId }`. Serialized as JSON alongside the project files.
- **Editor UI:** object palette → click/drag onto canvas → select → **property inspector** on
  the right → **attach a code script** with lifecycle hooks.
- **Script hooks:** `onStart()`, `onUpdate(dt)`, `onKeyDown(key)`, `onCollide(other)`,
  `onClick()`. Scripts are ordinary JS/TS in the editor, so the same editor + console serve it.
- **Renderer:** PixiJS 8 for sprites, textures, and a camera. Fallback: plain Canvas2D if the
  76 MB package becomes a bundle problem.
- **Built-in types:** sprite, rectangle, text, tilemap, camera, spawner, trigger zone.
- **Transport:** play / pause / stop / step-frame, with a reset that restores initial state.
- **Assets:** uploaded images and audio stored in IndexedDB via `AssetStore`.
- **Templates:** platformer, top-down, clicker, pong.

---

## 7. Data model & persistence

```ts
type Project = {
  id: string
  name: string
  workspace: 'roblox' | 'web' | 'game' | 'python' | 'blank'
  files: FileMap                    // path → { content, language }
  scene?: GameScene                 // visual-builder projects only
  activeFile: string
  settings: { theme, layout, autorun }
  createdAt: number
  updatedAt: number
}
```

- **Persistence:** IndexedDB, local-first, autosaved with debounce. No backend, no accounts.
- **Backup:** export a project as a single JSON/zip; import it back. This is the *only* durability
  guarantee — state it plainly in the UI, since a cleared browser profile loses everything.
- **Assets:** blobs in a separate IndexedDB store, referenced by id.
- **Templates:** `roblox-script`, `roblox-place` (multi-file `ServerScriptService` /
  `ReplicatedStorage` layout), `html`, `game-platformer`, `game-topdown`, `python`, `blank`.

---

## 8. UI

```
┌────────────────────────────────────────────────────────────────────────┐
│ CodeForge │ [Roblox] [Web] [Games] │ ▾ MyPlace │ ▶ ■ │ ⤓ │ ⚙          │
├────────────┬───────────────────────────────┬───────────────────────────┤
│ Explorer   │  ServerScript.luau  ×         │  PREVIEW                  │
│  📁 script │  1 │ local part = Instance…   │  [3D viewport · simulate] │
│  📄 Util   │  2 │ part.Parent = workspace  │                           │
│  ＋ New    │  3 │                          │  ── or ──                 │
│            │                               │  [canvas + transport]     │
│ PROPS      │                               │  ── or ──                 │
│  Anchored ☑│                               │  [live iframe]            │
├────────────┴───────────────────────────────┴───────────────────────────┤
│ Console │ Problems (2) │ Terminal                                      │
│ > made Block1 at 12, 20, 0                                            │
└────────────────────────────────────────────────────────────────────────┘
```

Resizable, collapsible panes. Right panel doubles as the **property inspector** in the game
builder and Roblox explorer. `Ctrl+Enter` run, `Ctrl+S` save.

---

## 9. Milestones

Ordered so each ships something usable and de-risks the next. The Roblox simulator is split
because it is the largest pillar.

**M0 — Scaffold.** ✅ *Done.* Vite + React + TS, shell, Monaco mounting, IndexedDB project
store, template picker, console panel, `RunSession` plumbing, workspace switcher.
*Accept: create a project, edit, save, reload the page, files persist.*

**M1 — Web workspace.** ✅ *Done.* Smallest complete win; proves the Runtime + preview
abstraction.
*Accept: multi-file HTML/CSS/JS renders live; `console.log` reaches the console panel; a
runtime error is caught and shown with a line number.*

**M2 — Luau core (no rendering yet).** ✅ *Done.* `LuaWorker`, console, diagnostics with
debounce, Roblox value types + `Instance` tree.
*Accept: the §3 spike-3 script runs; `print` streams; an infinite loop dies in ~1s; a type
error squiggles the right line.*

**M3 — Roblox viewport (A1).** ✅ *Done.* three.js scene from the render bridge; orbit camera.
*Accept: spike-3 script draws a baseplate + 5 colored blocks with correct size, position, color.*
*Done: the acceptance scene is asserted end to end in a real Luau VM (`tests/viewport.test.ts`),
including each block's position, size, and colour. The script runs as a required module so
errors keep their real file and line. three.js is lazily imported, so a Web project never
downloads it and first paint stays at 1014 KB gzip.*

**Responsive / mobile.** ✅ *Done.* Not a milestone — a cross-cutting constraint that
applies to every milestone after it.
*Accept: at 820px and below the app is one pane at a time with a bottom navigator; at 390px
the editor and the files list are usable with a thumb; errors stay visible even though the
console is behind a tab.*
*Done: `useLayoutMode` keys on viewport width (not a user agent), so a narrow desktop window
and a landscape tablet both do the right thing. Touch targets are 40px, form inputs are 16px
so iOS does not zoom, the shell is 100dvh with safe-area insets, and the manifest plus real
icons make it installable to a home screen. The 3D canvas takes `touch-action: none` so a
drag orbits instead of scrolling the page, and devicePixelRatio is capped at 1.5 on small
screens.*

**M4 — Roblox physics (A2).** ✅ *Done.* Rapier integration, `.Touched`, movers.
*Accept: an unanchored Part falls and rests on the baseplate (spike 7), and `.Touched` fires
on the Roblox side.*
*Done: parts fall and rest at the predicted height (a 1-stud part lands with its centre at
10.5 on a ground whose top is at 10), stacks hold, and `.Touched`/`.TouchEnded` deliver the
other Instance to a handler connected in the same run. Measured architecture note: a fresh
Luau state costs 6.6–12 ms to boot with the Roblox API, so the script is **re-executed at
10 Hz** while Rapier steps at 60 Hz — a documented limit, not a hidden one. Rapier is a lazy
1.6 MB chunk, keeping first paint at 1019 KB gzip.*

**M5 — Visual game builder.** ✅ *Done.* A scene on the project, a canvas stage with drag/resize,
an inspector, undo/redo, and a runtime that plays the scene in a sandboxed iframe.
*Accept: place an object, attach an `onUpdate` script that moves it, press play, see it move;
reload and the scene persists.*
*Done, and asserted by running the shipped preview document in Node rather than by matching
strings in a template: the player falls and rests exactly on the floor (centre y = 428 for a
64-unit box on a floor whose top is 492), walks, jumps and lands again, collects a pickup once,
and respawns when it falls off the stage. A script that throws is reported **once** — a throw per
frame would emit 120 identical errors a second and bury the first — and module-level state
survives between frames, which is why the script is compiled once rather than per tick.
Scope was cut deliberately: AABB collision and one driven entity, not rigid-body physics.*

**M6 — Files, folders and the interface.** ✅ *Done (Forge S1.6).* Drawer navigation, a real file
tree with folders, create/rename/move/delete/duplicate, quick open, project-wide replace, the Tokyo
Night palette with per-project accents, and `.codeforge.json` export/import.

**M7 — Python + other languages.** Pyodide lazy-loaded.
*Accept: a Python script prints; `import numpy` works; matplotlib output renders.*

**M8 — Polish.** Asset upload, more game primitives (sprites, tilemaps), undo/redo for files and
folders, and a keyboard map. Export/import and per-project theming shipped early, in S1.6,
because without a backup path the data model was one cleared browser profile away from gone.

---

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Roblox simulator scope creep** — physics/lighting/GUI/particles is a large build | **High** | Split across M3–M6 with hard acceptance tests; ship M3 usable before starting M4 |
| Simulator diverges from real Roblox and misleads users | High | Permanent "simulation" badge; named errors for unsupported APIs; `.rbxlx` export in M9 |
| Roblox API surface is enormous | High | Documented subset (§5); loud named errors instead of silent `nil` |
| **Total deps ≈ 250 MB unpacked** | High | Lazy-load per workspace; tree-shake Monaco; budget gate in CI |
| `@luau-rs/luau` is v0.x — API may shift | Medium | Pin version; isolate behind `Runtime` |
| Rapier ≠ Roblox physics solver | Medium | Label as approximate; don't promise parity |
| Pixi's 76 MB hurts the builder's first load | Medium | Lazy-load; Canvas2D fallback |
| Monaco's 101 MB bloats the bundle | **Resolved** | Minimal build landed in M0: 14 MB → 4.5 MB `dist`, no language-service workers. `.json` falls back to plaintext. |
| IndexedDB loss on cleared profile | Medium | Prominent export/import; autosave |
| Analysis at 307 ms/check | Low | Debounce 400 ms in a worker |

**Not verified:** `@luau-rs/luau` and `rapier3d-compat` inside a real Web Worker under Vite's
wasm handling; three.js actual on-screen rendering (spike 8 exercised scene-graph math, not
WebGL); `.rbxlx` round-trip into Roblox Studio (no Studio here). Each becomes an early task in
its milestone rather than an assumption.

**Verified since this plan was first written:** Vite-bundled browser sizes (see the measured
table in §3). **No browser is installed in this sandbox and Playwright's CDN is unreachable
from it**, so M1's iframe/console behaviour is covered by unit tests over the pure logic
(document assembly, span recording, position mapping, message translation) but has **not** been
exercised in a real browser. That is the first thing to click through manually.

---

## 11. Immediate next step

**M0 scaffold**, then **M1 (Web workspace)** because it is the smallest complete proof of the
Runtime + preview abstraction that everything else reuses. The Roblox pillar that followed was
retired; the **visual game builder (M5)** now occupies the same slot and reuses the same
Runtime + preview contract. **M6 (files and the interface)** shipped ahead of Python because the
flat file list was becoming the reason projects were hard to navigate. Next is **M7 (Python)**,
then M8 polish.
