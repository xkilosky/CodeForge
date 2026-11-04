# CodeForge — Project Plan

**Universal coding environment in the browser.** Write Lua for Roblox, HTML for the web,
games, and other languages — each with a live preview, no install, no server to configure.

> Status: **planning**. Nothing is built yet — the repo contained only a 12-byte `README.md`
> at commit `68f00b3`. Every technical claim in §2 was measured in this workspace, not assumed.

---

## 1. Product in one paragraph

CodeForge is a browser IDE shaped around **one editor + one preview**, where the preview
changes meaning per language: a Roblox viewport for Luau, a live page for HTML, a canvas for
games, a terminal for everything else. The unifying idea is that a *language* is a pluggable
**Runtime** that provides three things — an executor, a diagnostic source, and a preview mode —
and the rest of the app (files, tabs, console, persistence, layout) is language-agnostic.

---

## 2. Verified technical foundation

The riskiest assumption in a project like this is *"can we really run Roblox Luau in a
browser, and can we inject our own API into it?"* That was tested rather than guessed.

**Test harness:** `npm i @luau-rs/luau` in `/home/user/spikes/luau`, Node v22.22.3.

| # | Question | Result |
|---|---|---|
| 1 | Is it real Luau, not Lua 5.4? | **Yes.** `+=`, `continue`, `type Point = {...}`, and `` `{interp}` `` all compiled and ran; loop returned `25` (1+3+5+7+9). Package targets **Luau v739**. |
| 2 | Can we inject a Roblox-style API? | **Yes.** A Luau **prelude** defining `Vector3` (`__add`/`__tostring`/`:Magnitude()`/`:Lerp()`), `Color3`, `Enum.Material`, `Instance.new` with `:FindFirstChild`/`:GetChildren`/`:Clone`, `workspace`, `game` ran real user code that built a 6-object scene. |
| 3 | Can it drive a renderer? | **Yes.** The prelude pushed 6 `Part`s with position/size/color through a JS host callback into a render queue — the exact data a 3D viewport needs. |
| 4 | Is untrusted code contained? | **Yes.** `LuaWorker` enforces `memoryLimitBytes: 33554432`, `interruptLimit: 250000`, `outputLimitBytes: 65536`, `outputLimitEvents: 1024`, `resultLimitBytes: 1048576`. `while true do end`, a memory bomb, and an output bomb all died in **~1.0s**; a valid script returned `42` in 105 ms. |
| 5 | Real diagnostics? | **Yes.** `AnalysisWorker` (`@luau-rs/luau/analysis/worker`) returned `{kind, severity, code: 1001, location: {begin:{line,column}, end:{line,column}}}` — exactly what editor squiggles need. One check = **316 ms** (so: debounce). |

### Constraints discovered (these shape the design)

1. **Sandbox mode makes `_G` readonly.** `_G.Vector3 = ...` fails with *"attempt to modify a
   readonly table"*. → The prelude must **`return`** its API table and the host installs each
   global via `lua.globals.set()`. This is better design anyway: the host controls the exact
   global surface.
2. **`warn` is `nil` in this build** — the shim must supply it.
3. **`LuaTable.get(k)` returns a `LuaFunction` handle that is *not* JS-callable.** Calling it
   throws. → Use `table.callMethod(name, args)`. Better: keep the API **in Luau**, and use JS
   only for the ~5 host bridges (render, console, time, input, audio). This avoids thousands of
   JS↔WASM boundary crossings per frame.
4. **A parse error suppresses later type diagnostics** — the checker reported 1 of 3 planted
   issues. → Report syntax errors first, re-check once they clear.
5. `@luau-rs/luau` is **ESM-only** and ships **two** wasm blobs (`luau_wasm_bg.wasm`,
   `luau_analysis_wasm_bg.wasm`); total install **8.4 MB**.

### Dependency shortlist (versions + sizes pulled from the npm registry)

| Package | Version | Unpacked | Role |
|---|---|---|---|
| `@luau-rs/luau` | 0.739.0 | 8.66 MB | Luau VM + compiler + analysis. **The** Roblox engine. |
| `monaco-editor` | 0.57.0 | 101.67 MB | Editor. Big — tree-shake to needed languages. |
| `pyodide` | 314.0.7 | 13.88 MB | Python, in-browser. |
| `@webcontainer/api` | 1.6.4 | 0.18 MB | Node/npm in browser (API only; runtime fetched at runtime). |
| `codemirror-mode-luau` | 1.0.9 | — | Luau highlighting (fallback if Monaco's Lua mode is too weak). |
| `@rbxts/types` | 1.0.961 | — | Roblox API typings → generate autocomplete. |

Rejected: **`wasmoon` 1.16.0 is Lua 5.4, not Luau** — it cannot parse Roblox's `+=`,
`continue`, or type annotations, so it is not a viable substitute.

---

## 3. The one hard truth about "Roblox Preview"

Roblox's engine is proprietary and **cannot run in a browser**. No browser build of
Roblox Studio or its physics/rendering pipeline exists. So "Lua Roblox with Preview" means
one of three honest things, and the plan does all three:

| Tier | What it is | Fidelity |
|---|---|---|
| **A. Simulate** | Real Luau executes against a Roblox **API shim**; a scene graph is drawn to a WebGL canvas. | High for scripting logic; approximate for physics/rendering. |
| **B. Validate** | Real Luau type-checks and lints the script. | Exact — it *is* Roblox's checker. |
| **C. Export** | Emit a `.rbxlx`/`.rbxmx` the user opens in actual Studio. | Perfect — runs in the real engine. |

**Recommendation: build A + B, then C.** A gives instant feedback while learning; B is free
(the analysis wasm is already in the package); C is the escape hatch that makes the simulator's
gaps acceptable. The UI must state plainly that the viewport is a **simulation**, so nobody
believes a preview bug is a bug in their game.

---

## 4. Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  UI Shell (React)   explorer · tabs · editor · preview · console   │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
┌──────────────────────────────▼─────────────────────────────────────┐
│  Core                                                              │
│  ProjectStore (files, tabs, settings)  →  IndexedDB persistence    │
│  RunSession (start/stop/restart, stdout+stderr stream, timers)     │
│  DiagnosticsBus (debounced, per-language)                          │
└──────────────────────────────┬─────────────────────────────────────┘
                               │  interface Runtime
┌──────────┬───────────────┬───┴────────┬──────────────┬─────────────┐
│ luau-    │ html-web      │ js-game    │ python       │ wasm-lang   │
│ roblox   │               │            │              │ (later)     │
├──────────┼───────────────┼────────────┼──────────────┼─────────────┤
│ LuaWorker│ iframe srcdoc │ iframe +   │ Pyodide      │ clang/rustc │
│ + prelude│               │ game libs  │              │ wasm        │
├──────────┼───────────────┼────────────┼──────────────┼─────────────┤
│ WebGL    │ iframe        │ canvas     │ text/        │ text        │
│ viewport │               │            │ matplotlib   │             │
└──────────┴───────────────┴────────────┴──────────────┴─────────────┘
```

The contract every language implements:

```ts
interface Runtime {
  id: string
  preview: 'roblox-viewport' | 'iframe' | 'canvas' | 'terminal' | 'none'
  init(): Promise<void>
  run(files: FileMap, entry: string, io: IOBridge): Promise<RunHandle>
  lint?(files: FileMap): Promise<Diagnostic[]>   // debounced by DiagnosticsBus
  export?(files: FileMap): Promise<Blob>          // .rbxlx, .zip, …
}
```

Adding a language = adding a runtime. Nothing in Core or the shell changes.

---

## 5. Runtime matrix

| Language | Executor | Preview | Diagnostics | Notes |
|---|---|---|---|---|
| **Luau / Roblox** | `LuaWorker` + Luau prelude | WebGL scene viewport | `AnalysisWorker` ✅ | Proven in §2 |
| **HTML / CSS / JS** | iframe `srcdoc` | Live iframe | Editor built-ins | Console + network captured via injected shim |
| **JS games** | iframe + Kaplay / Phaser / three.js | Canvas | Editor built-ins | Auto-inject the chosen lib; hot-reload on save |
| **Python** | Pyodide | Text or matplotlib PNG | Pyodide | 13.9 MB, lazy-loaded on first use |
| **JS / Node** | WebContainers | iframe or terminal | tsc (optional) | Needs COOP/COEP + secure context — see risks |
| **C / C++ / Rust / Go** | WASM toolchains | Text | toolchain | Later; large downloads |

Every runtime lazy-loads its engine on first use so the initial page stays small.

---

## 6. Roblox shim — explicit scope

The Roblox API is enormous. Shipping "all of it" is not possible, so the supported subset is
**written down** and anything outside it raises a clear, named error instead of a silent `nil`.

**In scope (phases 1–4):**
- **Value types:** `Vector3`, `CFrame`, `Color3`, `UDim`, `UDim2`, `Rect`, `Region3`, `Ray`,
  `NumberRange`, `BrickColor`, `Random`, `Enum` (subset)
- **Instances:** `new`, parenting, `Name`, `ClassName`, `Parent`, `FindFirstChild`,
  `WaitForChild`, `GetChildren`, `GetDescendants`, `Clone`, `Destroy`, `IsA`
- **Signals:** `.Changed`, `.Touched`, `BindableEvent`/`BindableFunction`
- **Globals:** `print`, `warn`, `error`, `typeof`, `tick`, `time`, `task.*`,
  legacy `wait`/`spawn`/`delay`, `table.*` extensions (`find`, `create`, `move`, `clear`,
  `clone`), `string.split`, `string.format`, `utf8`, `buffer`
- **Services:** `Workspace`, `ReplicatedStorage`, `ServerStorage`, `Players`, `RunService`
  (`Heartbeat`/`RenderStepped`/`Stepped`), `TweenService` (real tween math), `Debris`,
  `Lighting`, `SoundService` (WebAudio), `UserInputService`
- **Modules:** `require()` resolved against project files; Rojo-style folder mapping

**Explicitly out of scope (clear error message):** networking/remotes across a real
client-server boundary, `HttpService` network calls, DataStores, real physics solver,
terrain editing, GUI layout engine (basic frames/labels only), particle systems (v1).

**Renderer:** WebGL (three.js) drawing `Part`, `MeshPart`, `WedgePart`, `SpherePart`,
`CylinderPart` with color/material/transparency; orbit + first-person camera; simple
gravity/collision in phase 2; `Touched` fired from that pass.

---

## 7. Data model & persistence

```ts
type Project = {
  id: string
  name: string
  template: TemplateId          // drives which Runtime is used
  files: FileMap                // path → { content, language }
  activeFile: string
  settings: { theme, layout, autorun }
  createdAt: number
}
```

- **Persistence:** IndexedDB (local-first, zero backend). Autosave on edit, debounced.
- **Templates:** `roblox-script`, `roblox-model` (multi-file with `ServerScriptService` /
  `ReplicatedStorage` layout), `html`, `js-game`, `python`, `blank`.
- **Cloud sync / accounts:** deliberately deferred (see open decisions).

---

## 8. UI

```
┌─────────────────────────────────────────────────────────────────┐
│ CodeForge │ ▾ MyProject │ ▶ Run  ■ Stop │ Luau │ ⤓ Export │ ⚙ │
├────────────┬──────────────────────────────┬─────────────────────┤
│ Explorer   │  Script.luau  ×  Util.luau × │   PREVIEW           │
│  📁 script │  1 │ local part = Instance…  │   [Roblox viewport] │
│  📄 Util   │  2 │ part.Parent = workspace │                     │
│  ＋ New    │  3 │                         │                     │
│            │                              │                     │
├────────────┴──────────────────────────────┴─────────────────────┤
│ Console │ Problems (2) │ Terminal                                │
│ > made Block1 at 12, 20, 0                                      │
└─────────────────────────────────────────────────────────────────┘
```

Resizable panes, collapsible right panel for small screens. `Ctrl+Enter` run, `Ctrl+S` save.

---

## 9. Milestones

Each milestone ships something usable and has a testable acceptance criterion.

**M0 — Scaffold.** Vite + React + TS, layout shell, Monaco mounting, IndexedDB project
store, template picker, console panel, `RunSession` plumbing.
*Accept: create a project from a template, edit, save, reload the page, files persist.*

**M1 — HTML/Web runtime.** Smallest complete win; proves the Runtime + preview abstraction.
*Accept: edit HTML/CSS/JS across files, see live preview, `console.log` appears in the
console panel, runtime errors are caught and shown with a line number.*

**M2 — Luau core.** `LuaWorker` in a worker, console, `AnalysisWorker` diagnostics with
debounce, Roblox value types + `Instance` tree — **no rendering yet**.
*Accept: a script using `Vector3`/`Color3`/`Instance` runs; `print` streams; an infinite loop
is killed in ~1s; a type error shows a squiggle at the right line.*

**M3 — Roblox viewport.** three.js scene driven by the prelude's render bridge.
*Accept: the §2 spike script draws a baseplate plus 5 colored blocks; orbit camera works.*

**M4 — Services, signals, modules, export.** `RunService` ticks, `task.*`, `.Touched`,
`require()`, and `.rbxlx` export.
*Accept: a spinning part via `RunService.Heartbeat`; a two-file project using `require`;
exported `.rbxlx` opens in Roblox Studio.*

**M5 — Games.** JS game runtime with injectable libraries and asset upload.
*Accept: a Kaplay or three.js starter runs and hot-reloads on save.*

**M6 — Python + more languages.** Pyodide, lazy-loaded; then WASM toolchains.
*Accept: a Python script prints output; `import numpy` works; matplotlib renders to preview.*

**M7 — Polish.** Share links, export bundles, theming, keyboard map, mobile layout.

---

## 10. Risks & unknowns

| Risk | Severity | Mitigation |
|---|---|---|
| Roblox API surface too large to emulate | High | Documented subset (§6); loud named errors; Tier C export |
| Simulator misleads users about real behaviour | High | Permanent "simulation" badge in the viewport |
| `@luau-rs/luau` is v0.x — API may shift | Medium | Pin version; isolate behind `Runtime` interface |
| Analysis wasm + runtime wasm ≈ 8.4 MB | Medium | Lazy-load analysis on first Luau project |
| Monaco's 101 MB package bloats the bundle | Medium | Tree-shake to used languages; else CodeMirror 6 |
| WebContainers need COOP/COEP + secure context | Medium | Set headers in Vite config; Node is a later milestone |
| **WebContainers commercial licensing** | Medium | **Unchecked** — terms not verified here; confirm before shipping |
| `AnalysisWorker` at 316 ms/check | Low | Debounce 400 ms; run in worker |
| Physics fidelity | Medium | Ship static geometry first; label physics as approximate |

**Not verified in this session:** browser-bundle size after Vite build; `@luau-rs/luau`
inside a real Web Worker under Vite's wasm handling; WebContainers licensing terms;
`.rbxlx` round-trip into Studio (no Studio in this environment).

---

## 11. Open decisions

Four choices materially change the build. Recommendations are marked; see the questions
asked alongside this document.

1. **Roblox preview fidelity** → recommend **A + B + C** (simulate, validate, export).
2. **Where code executes** → recommend **fully client-side** (WASM only, no server). Deployable
   anywhere, no per-user sandbox cost, works offline. A backend only becomes necessary for
   languages without a WASM build.
3. **What "Games" means** as a category.
4. **Single-user local tool vs. hosted product** with accounts, saved projects, and sharing.
