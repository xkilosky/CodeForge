# CodeForge

A coding environment that runs entirely in your browser — HTML, CSS and JavaScript, plus a visual
game builder. Python is planned.

**Live:** https://codeforge-ten-flame.vercel.app
**Source release:** **CodeForge - Forge S2.1** (Platform Release)

## Forge S2.1 — real-time error detection

JavaScript and TypeScript syntax/type diagnostics update while you edit, with Monaco squiggles and
clickable entries in Problems. HTML tag structure, CSS braces/strings, and JSON parse errors are
linted locally after a short typing pause. Nothing waits for save or run; analysis stays in the
browser and the TypeScript worker loads only when a JS/TS file needs it.

## Versioning

Every release is named **Forge S<season>.<milestone>** and carries a channel:

| | |
| --- | --- |
| Title | `CodeForge - Forge S2.1` |
| Channel | `Platform Release` |
| Milestone | M12 — Real-time error detection |

The number after the dot is the highest **shipped** milestone, and it is derived from
`SHIPPED_MILESTONES` in `src/core/release.ts` — not typed into a component. Shipping a milestone
means adding one line to that list; the top bar tag, the home screen, the tab title and the
"arrives in…" copy for unshipped workspaces all follow.

Season (`S1`) is a decision rather than a count, because a season can open a new product line
rather than continue the milestone sequence.

## Development workflow (Forge S1.7)

**The command palette** (`Ctrl/Cmd+Shift+P`) searches and runs project and navigation actions
without menu-hopping. It can open workspace sections, run or stop the current project, change the
workspace layout, clear output, or return to Projects. In Quick Open (`Ctrl/Cmd+P`), type `>` to
switch directly into command search. The same dialog also keeps project-wide replace (`Ctrl/Cmd+K`)
close at hand.

## Global project search (Forge S1.8)

**Search every file's contents** (`Ctrl/Cmd+Shift+F`) for text, function names, variables, or any
other source string. Results show the file, line, and matching snippet; selecting a result opens
that file in the editor and jumps to the exact match. Search is case-insensitive and literal, and
large result sets are capped in the palette while still reporting the total.

## Source control (Forge S1.9)

**GitHub panel** in the project drawer. Connect a repository using a fine-grained personal access
token limited to that repository with Contents read/write permission. The token is held in memory
only and is never saved with the project; re-enter it after leaving the panel or reloading. Stage
and unstage file snapshots, fetch remote status, pull when the working tree is clean, and commit
and push. Push checks for remote changes and preserves non-overlapping remote updates; it stops
when a remote change conflicts with a staged file. This panel tracks text files in CodeForge
projects; binary and oversized tree entries on GitHub are kept out of the editor and left untouched by commits.

## The interface (Forge S1.6)

**Separate interface and syntax palettes.** The app chrome uses layered graphite surfaces,
cool slate text, and restrained steel-blue and muted color accents, mirrored from
`src/core/theme.ts` into `styles.css`. Monaco retains its Tokyo Night semantic syntax colors, so
code stays expressive while the surrounding interface remains quiet and low-glare.

**The drawer is the navigation.** Sections and the file tree live in it. Pinned on a wide screen
it is a grid column; unpinned it overlays and collapses its column to zero. On a phone it is
always an overlay. The top bar keeps only what acts on the current thing.

**Files are a tree, not a list.** Projects still store a flat `Record<path, file>`; `core/workspace.ts`
builds the tree, and create/rename/move/delete/duplicate are pure functions over that map. Empty
folders are kept in `Project.folders` because "create a folder, then a file inside it" should not
lose the folder on reload.

**Anything that can destroy work confirms.** Deleting a file or folder takes two presses and the
second one says how many files are going. Files and folders have no undo yet — only the scene does
— so the confirmation is the guarantee, and the notice bar is what makes a delete visible.

**Export is the backup.** `core/transfer.ts` writes and validates a `.codeforge.json`. Import always
allocates a new project id, so importing a backup twice gives two projects and can never overwrite
the one that is here.

There is no CodeForge backend or account. Projects are stored in this browser's IndexedDB, the
built-in preview is a sandboxed iframe, and the app itself is a static site. The optional integrated
terminal creates browser-hosted processes and previews only when the user runs commands.

## Using it

- **Projects home** — everything saved on this device, newest first. Open, duplicate, or delete
  a project; start a new one from a template.
- **Out of a project** — the brand button in the drawer, or the CodeForge mark in the top bar,
  closes the project and returns home. Pending edits are written before it closes.
- **+ New** — creates a project from any template, from anywhere.
- **The drawer** (`☰`, or Ctrl/Cmd+B) — sections and the file tree. Pin it with the layout button to
  keep the tree beside the editor.
- **Files** — `+ File` / `+ Folder` in the tree toolbar create at the project root; a folder's own
  `+` creates inside it. Every row has duplicate, rename and delete. Drag a row onto a folder to move it.
- **Quick open** (`Ctrl/Cmd+P`) finds a file by name anywhere in the project; type `>` for
  commands. `Ctrl/Cmd+Shift+P` opens the command palette directly, `Ctrl/Cmd+Shift+F` searches
  project contents, and `Ctrl/Cmd+K` replaces a string across every file.
- **Look** — accent and editor theme, per project.
- **Backup** — export the project as `.codeforge.json`, or import one as a new project.
- **Source Control** — connect GitHub, stage changes, fetch/pull, and commit/push from the project drawer.

The workspace tabs that used to live in the top bar are gone. Retargeting a project's workspace
by replacing its files was a destructive action presented as navigation; a new project from a
template does the same job without overwriting anything.

## Install on mobile

CodeForge is installable as a **Progressive Web App**; no app-store download is required. On Android,
open the HTTPS site in a supported browser and tap **Install** in the top bar (or use the browser's
**Install app / Add to Home screen** menu). On iPhone or iPad, open the site in Safari, tap **Share**,
then **Add to Home Screen**. Launch it from the new home-screen icon for a standalone app window.

The app shell and its static assets are cached for offline reopening after an initial online visit.
Projects remain in that browser's local storage and are not automatically synced to another device;
use **Backup** to export a copy before changing or replacing phones. Features that require network
access, including the integrated WebContainer terminal and package installs, still need a connection.

## Workspaces

| Workspace | Runtime | Preview |
| --- | --- | --- |
| Web | HTML/CSS/JS in a sandboxed iframe | live page, console forwarded |
| Games | canvas stage + gravity + a per-frame script | the stage, playable |
| Languages | *planned* (Forge S2.2) | — |

### Integrated terminal

Open **Terminal** from the project drawer or command palette. The default **Bash** shell runs in a
browser-local WebAssembly/WASIX sandbox and automatically loads a compatible common-utilities bundle
when one is available. Common commands such as `ls`, `cat`, `cp`, `mv`, `rm`, and `mkdir` need no
manual package step. It does not execute on a remote server and requires no account, API key, or
backend. Bash edits and new text files synchronize with the CodeForge project; the shell's temporary
filesystem and history are session-local.

Bash in WASIX is not the phone's native shell or a complete Linux virtual machine. Outbound TCP/DNS
is disabled by default, so networked package managers such as `npm install` need a WISP proxy
endpoint; no proxy is bundled. Use the
**Node / npm** shell switch for the existing browser-based WebContainer runtime (`jsh`) when you need
`npm`/`npx`, development servers, or its wider command set. Open ports there surface an **Open running
app** link. `Ctrl/Cmd+Shift+Enter` runs the active JavaScript or TypeScript file in the Node terminal.

Files edited in either shell or CodeForge are synchronized back into the project; dependency, Git
metadata, build-output folders, and binary files stay outside the editor's text-file map. Common
compiler/runtime locations become clickable terminal problems and Monaco markers. For GitHub commits
and pushes, use **Source Control**; local `git` CLI availability depends on the selected runtime.

Both runtimes require a secure HTTPS page and cross-origin isolation (`COOP: same-origin`,
`COEP: require-corp`); the Vite and Vercel configurations in this repository set those headers. The
first Bash launch needs an internet connection to fetch and cache the public runtime package. The
Wasmer attribution is shown in the Bash terminal; see [third-party notices](THIRD_PARTY_NOTICES.md).

## The game builder

A game project is a **scene** plus a **script**, both saved with the project.

- **Stage** — drag objects to move them, drag a corner to resize. `+ Box` and `+ Circle` add more.
- **Inspector** — name, position, size, colour, and whether an object is *solid*. Solids block the
  player and never move; anything else is a pickup.
- **Player** — the object Play drives. Exactly one; `Make player` moves the marker.
- **Code** — the script's `onUpdate(ctx)` runs once per frame while playing. The stage reacts to the
  arrow keys or WASD on its own; the hook is for everything else.
- **Play / Restart** — above the stage. Editing stops the game; the iframe only exists while playing.

```js
export function onUpdate(ctx) {
  // ctx.player  x, y, vx, vy, grounded, move(vx), jump()
  // ctx.time    seconds since Play
  // ctx.dt      seconds since the last frame
  // ctx.frames  frames since Play (whole number, counted by the engine)
  // ctx.input   { axis: -1 | 0 | 1, jump }
  // ctx.api     find(name), pickups(), log(...), math
}
```

## A note on Roblox and Lua

This project previously shipped a Luau/`Roblox` workspace: a WASM Lua VM with a hand-written Roblox
API prelude, a three.js viewport, and a Rapier physics loop. It was removed rather than repaired —
the simulation could not be made to behave reliably in a real browser, and it accounted for most of
the app's weight (Rapier alone was 1.6 MB gzipped, loaded lazily on top of a 1 MB first paint).

Deleting it removed roughly 6,000 lines and four dependencies: `@luau-rs/luau`, `three`,
`@types/three`, and `@dimforge/rapier3d-compat`. The history is in git if it is ever wanted back;
`PLAN.md` still describes the design, marked as retired.

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # vitest
npm run typecheck
npm run build
```

`spikes/` holds standalone Node scripts that established technical claims during planning. They are
evidence, not part of the app.
