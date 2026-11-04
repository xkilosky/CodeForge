# CodeForge

A coding environment that runs entirely in your browser — HTML, CSS and JavaScript, plus a visual
game builder. Python is planned.

**Live:** https://codeforge-ten-flame.vercel.app

There is no server and no account. Projects are stored in this browser's IndexedDB, the preview is a
sandboxed iframe, and the whole thing is a static site.

## Using it

- **Projects home** — everything saved on this device, newest first. Open, duplicate, or delete
  a project; start a new one from a template.
- **Out of a project** — the `‹ Projects` button in the top bar (or the ⚒ mark) closes the project
  and returns home. Pending edits are written before it closes.
- **+ New** — creates a project from any template, from anywhere.
- **Workspace tabs** retarget the open project to that workspace's starter. Files are replaced on
  purpose: the starter of one workspace is not the content of another. A workspace with no runtime
  yet (Languages) refuses the switch rather than handing back a project whose Run button does
  nothing.

## Workspaces

| Workspace | Runtime | Preview |
| --- | --- | --- |
| Web | HTML/CSS/JS in a sandboxed iframe | live page, console forwarded |
| Games | canvas stage + gravity + a per-frame script | the stage, playable |
| Languages | *planned* (M6) | — |

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
