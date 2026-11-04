# CodeForge

A coding environment that runs entirely in your browser — Luau in a simulated Roblox viewport,
HTML/CSS/JS with a live preview, and more workspaces on the way.

**Live:** https://codeforge-ten-flame.vercel.app

There is no server and no account. Projects are stored in this browser's IndexedDB, the Luau VM
and the physics solver are WebAssembly running on the device, and the whole thing is a static
site. [PLAN.md](PLAN.md) has the architecture, the measured feasibility results, and the milestone
breakdown.

## Using it

- **Projects home** — everything saved on this device, newest first. Open, duplicate, or delete
  a project; start a new one from a template.
- **Out of a project** — the `‹ Projects` button in the top bar (or the ⚒ mark) closes the
  project and returns home. Pending edits are written before it closes.
- **+ New** — creates a project from any template, from anywhere. Every workspace with a runtime
  is offered; workspaces without one say when they arrive.
- **Workspace tabs** (Web / Roblox / …) retarget the open project to that workspace's starter.
  Files are replaced on purpose: a Luau script and an HTML page are not the same project.

## Workspaces

| Workspace | Runtime | Preview |
| --- | --- | --- |
| Web | HTML/CSS/JS in a sandboxed iframe | live page, console forwarded |
| Roblox | Luau (WASM) against a Roblox API prelude | three.js viewport + Rapier physics |

The Roblox viewport is a **simulation**, and says so with a permanent badge. It reproduces the
parts of the Roblox API that scripts actually use — `Instance.new`, properties, `workspace`,
`Touched`, `WaitForChild`, `Vector3`/`CFrame`/`Color3`, and so on — not the engine.

## Development

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # vitest
npm run typecheck
npm run build
```

`spikes/` holds the standalone scripts (Node) that established the technical claims the design
rests on: Luau-in-WASM boot cost, prelude limits, analysis diagnostics shape, and Rapier solver
behaviour. They are evidence, not part of the app.
