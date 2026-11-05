# CodeForge

A coding environment that runs entirely in your browser — HTML, CSS and JavaScript, plus a visual
game builder. Python is planned.

**Live:** https://codeforge-ten-flame.vercel.app — currently **CodeForge - Forge S1.5**
(Platform Release)

## Versioning

Every release is named **Forge S<season>.<milestone>** and carries a channel:

| | |
| --- | --- |
| Title | `CodeForge - Forge S1.6` |
| Channel | `Platform Release` |
| Milestone | M6 — files, folders and a new interface |

The number after the dot is the highest **shipped** milestone, and it is derived from
`SHIPPED_MILESTONES` in `src/core/release.ts` — not typed into a component. Shipping a milestone
means adding one line to that list; the top bar tag, the home screen, the tab title and the
"arrives in…" copy for unshipped workspaces all follow.

Season (`S1`) is a decision rather than a count, because a season can open a new product line
rather than continue the milestone sequence.

## The interface (Forge S1.6)

**Separate interface and syntax palettes.** The app chrome uses a neutral black-and-white
interface palette, mirrored from `src/core/theme.ts` into `styles.css`; project accents are
restrained grayscale. Monaco retains its Tokyo Night semantic syntax colors so code keeps clear
language highlighting instead of becoming monochrome.

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

There is no server and no account. Projects are stored in this browser's IndexedDB, the preview is a
sandboxed iframe, and the whole thing is a static site.

## Using it

- **Projects home** — everything saved on this device, newest first. Open, duplicate, or delete
  a project; start a new one from a template.
- **Out of a project** — the brand button in the drawer, or the CodeForge mark in the top bar,
  closes the project and returns home. Pending edits are written before it closes.
- **+ New** — creates a project from any template, from anywhere.
- **The drawer** (`☰`, or Ctrl+B) — sections and the file tree. Pin it with the layout button to
  keep the tree beside the editor.
- **Files** — `+ File` / `+ Folder` in the tree toolbar create beside the current selection; every
  row has duplicate, rename and delete. Drag a row onto a folder to move it.
- **Quick open** (`Ctrl+P`) finds a file by name anywhere in the project; `Ctrl+K` replaces a
  string across every file.
- **Look** — accent and editor theme, per project.
- **Backup** — export the project as `.codeforge.json`, or import one as a new project.

The workspace tabs that used to live in the top bar are gone. Retargeting a project's workspace
by replacing its files was a destructive action presented as navigation; a new project from a
template does the same job without overwriting anything.

## Workspaces

| Workspace | Runtime | Preview |
| --- | --- | --- |
| Web | HTML/CSS/JS in a sandboxed iframe | live page, console forwarded |
| Games | canvas stage + gravity + a per-frame script | the stage, playable |
| Languages | *planned* (Forge S1.7) | — |

### The game builder

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
