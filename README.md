# CodeForge

A coding environment that runs entirely in your browser — HTML, CSS, and JavaScript today, with a
visual game builder and Python planned.

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
  purpose: the starter of one workspace is not the content of another.

## Workspaces

| Workspace | Runtime | Preview |
| --- | --- | --- |
| Web | HTML/CSS/JS in a sandboxed iframe | live page, console forwarded |
| Games | *planned* | — |
| Languages | *planned* | — |

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
