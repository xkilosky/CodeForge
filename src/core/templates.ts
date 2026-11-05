import type { FileMap, Project, WorkspaceId } from './types';
import { languageForPath, newId } from './types';
import { emptyScene, starterScene, type Scene } from './scene';
import { arrivesIn } from './release';

export interface Template {
  id: string;
  label: string;
  workspace: WorkspaceId;
  description: string;
  entry: string;
  files: Record<string, string>;
  /**
   * Folders the template ships empty. Everything implied by `files` is created
   * automatically, so this is only for ones that would otherwise not exist.
   */
  folders?: string[];
  /** Milestone the workspace lands in — drives the "coming soon" state. */
  milestone: string;
  /**
   * Starting stage, for workspaces that have one. A function rather than a
   * value so every project from this template gets its own scene with its own
   * entity ids — sharing them would make two projects address each other's
   * objects.
   */
  scene?: () => Scene;
}

export const TEMPLATES: Template[] = [
  {
    id: 'web-starter',
    label: 'Web page',
    workspace: 'web',
    description: 'HTML + CSS + JS across three files, with a live preview and captured console.',
    milestone: 'M1',
    entry: 'index.html',
    files: {
      'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>My page</title>
    <link rel="stylesheet" href="styles/style.css" />
  </head>
  <body>
    <main class="card">
      <h1>Hello, CodeForge</h1>
      <p>Edit any file and the preview reloads.</p>
      <button id="ping">Log something</button>
      <button id="boom">Throw an error</button>
    </main>
    <script src="scripts/main.js"></script>
  </body>
</html>
`,
      'styles/style.css': `:root { color-scheme: dark; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: radial-gradient(circle at 30% 20%, #1d2b53, #0b1020);
  font-family: system-ui, sans-serif;
  color: #e8ecff;
}
.card {
  padding: 2rem 2.5rem;
  border: 1px solid #2f3f6b;
  border-radius: 14px;
  background: #121936cc;
  text-align: center;
}
h1 { margin: 0 0 0.25rem; font-size: 1.6rem; }
button {
  margin: 0.75rem 0.35rem 0;
  padding: 0.5rem 0.9rem;
  border: 0;
  border-radius: 8px;
  background: #3b5bdb;
  color: white;
  font: inherit;
  cursor: pointer;
}
button:hover { background: #4c6ef5; }
#boom { background: #b03050; }
`,
      'scripts/main.js': `// console output is forwarded to the CodeForge console panel.
let clicks = 0;

console.log("page script loaded");

document.querySelector("#ping").addEventListener("click", () => {
  clicks += 1;
  console.log("clicked", clicks, "times", { clicks });
});

document.querySelector("#boom").addEventListener("click", () => {
  // Uncaught errors are reported with the file and line number.
  notDefinedAnywhere.doSomething();
});
`,
    },
  },
  {
    id: 'web-blank',
    label: 'Blank page',
    workspace: 'web',
    description: 'A single empty HTML file.',
    milestone: 'M1',
    entry: 'index.html',
    files: {
      'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Untitled</title>
  </head>
  <body>
    <h1>Untitled</h1>
  </body>
</html>
`,
    },
  },
  {
    id: 'game-platformer',
    label: 'Platformer',
    workspace: 'game',
    description: 'A stage, a player and a script. Drag things around, press Run.',
    milestone: 'M5',
    entry: 'scripts/game.js',
    scene: starterScene,
    files: {
      'scripts/game.js': `/**
 * Runs once per frame while the game is playing.
 *
 *   ctx.player  the entity you drive: x, y, vx, vy, grounded
 *               move(vx) sets horizontal speed, jump() leaves the ground
 *   ctx.time    seconds since Play was pressed
 *   ctx.dt      seconds since the previous frame
 *   ctx.frames  frames since Play was pressed (whole number, engine-counted)
 *   ctx.input   { axis: -1 | 0 | 1, jump: boolean }
 *   ctx.api     find(name) and pickups() to inspect the stage
 *
 * Arrow keys or WASD move; space jumps. The on-screen pads appear on touch.
 */
export function onUpdate(ctx) {
  // The scene responds to the keyboard on its own; this hook is for anything
  // you want on top of it. Move with the arrow keys and the console will show
  // where the player is. A frame counter is used rather than a clock check:
  // "every second" needs state, and a counter is state the script cannot get
  // wrong.
  if (ctx.player.grounded && ctx.frames % 120 === 0) {
    ctx.api.log("standing at y=" + Math.round(ctx.player.y));
  }
}
`,
    },
  },
  {
    id: 'game-blank',
    label: 'Empty stage',
    workspace: 'game',
    description: 'A bare stage with nothing on it. Add objects in the builder.',
    milestone: 'M5',
    entry: 'scripts/game.js',
    scene: () => emptyScene(),
    files: {
      'scripts/game.js': `export function onUpdate(ctx) {
  // Nothing on the stage yet. Add an object in the builder, set it as the
  // player, then press Run.
}
`,
    },
  },
  {
    id: 'python-script',
    label: 'Python script',
    workspace: 'python',
    description: `Runs on Pyodide in the browser. ${arrivesIn()}`,
    milestone: 'M6',
    entry: 'main.py',
    files: {
      'main.py': `print("Hello from Python")

for i in range(5):
    print(i, i ** 2)
`,
    },
  },
];

export function filesFromRecords(files: Record<string, string>): FileMap {
  const map: FileMap = {};
  for (const [path, content] of Object.entries(files)) {
    map[path] = { content, language: languageForPath(path) };
  }
  return map;
}

export function projectFromTemplate(template: Template, name?: string): Project {
  const files = filesFromRecords(template.files);
  const now = Date.now();
  return {
    id: newId('prj'),
    name: name?.trim() || template.label,
    workspace: template.workspace,
    files,
    folders: [...(template.folders ?? [])],
    activeFile: template.entry in files ? template.entry : Object.keys(files)[0] ?? '',
    settings: { theme: 'tokyo-night', autorun: true },
    accent: 'blue',
    ...(template.scene ? { scene: template.scene() } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/**
 * Whether a template can actually be opened right now.
 *
 * The rule is runtime availability, never the `milestone` string. Gating on a
 * literal milestone silently hid templates once, and a disabled card looks like
 * "coming soon" rather than a bug.
 */
export function isTemplateAvailable(template: Template, available: Set<string>): boolean {
  return available.has(template.workspace);
}

/** The workspace ids that currently have a runtime, as a set for lookups. */
export function availableWorkspaces(runtimes: { id: string; available: boolean }[]): Set<string> {
  return new Set(runtimes.filter((r) => r.available).map((r) => r.id));
}
