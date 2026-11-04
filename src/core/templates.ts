import type { FileMap, Project, WorkspaceId } from './types';
import { languageForPath, newId } from './types';

export interface Template {
  id: string;
  label: string;
  workspace: WorkspaceId;
  description: string;
  entry: string;
  files: Record<string, string>;
  /** Milestone the workspace lands in — drives the "coming soon" state. */
  milestone: string;
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
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <main class="card">
      <h1>Hello, CodeForge</h1>
      <p>Edit any file and the preview reloads.</p>
      <button id="ping">Log something</button>
      <button id="boom">Throw an error</button>
    </main>
    <script src="main.js"></script>
  </body>
</html>
`,
      'style.css': `:root { color-scheme: dark; }
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
      'main.js': `// console output is forwarded to the CodeForge console panel.
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
    id: 'roblox-script',
    label: 'Roblox script',
    workspace: 'roblox',
    description: 'Luau with a simulated viewport. Arrives in M2.',
    milestone: 'M2',
    entry: 'ServerScript.luau',
    files: {
      'ServerScript.luau': `-- Runs in the simulated Roblox viewport (M2).
local part = Instance.new("Part")
part.Name = "Baseplate"
part.Size = Vector3.new(512, 20, 512)
part.Anchored = true
part.Color = Color3.fromRGB(40, 200, 90)
part.Parent = workspace

for i = 1, 5 do
	local block = Instance.new("Part")
	block.Name = "Block" .. i
	block.Position = Vector3.new(i * 12, 20, 0)
	block.Color = Color3.new(i / 5, 0.3, 1 - i / 5)
	block.Parent = workspace
end

print("built " .. #workspace:GetChildren() .. " parts")
`,
    },
  },
  {
    id: 'roblox-physics',
    label: 'Roblox physics',
    workspace: 'roblox',
    description: 'Parts fall, bounce, and fire .Touched. Arrives in M4.',
    milestone: 'M4',
    entry: 'ServerScript.luau',
    files: {
      'ServerScript.luau': `-- Everything below runs in the simulated Roblox viewport.
-- The solver is Rapier, not Roblox's Bullet-derived one, so feel differs.
local baseplate = Instance.new("Part")
baseplate.Name = "Baseplate"
baseplate.Size = Vector3.new(120, 4, 120)
baseplate.Anchored = true
baseplate.Color = Color3.fromRGB(60, 70, 85)
baseplate.Parent = workspace

-- A wall to bounce a part off, so Touched has something to report.
local wall = Instance.new("Part")
wall.Name = "Wall"
wall.Size = Vector3.new(30, 20, 2)
wall.Position = Vector3.new(0, 12, -12)
wall.Anchored = true
wall.Color = Color3.fromRGB(200, 90, 60)
wall.Parent = workspace

-- Five balls dropped from different heights, with different rests of bounce.
for i = 1, 5 do
	local ball = Instance.new("Part")
	ball.Name = "Ball" .. i
	ball.Size = Vector3.new(4, 4, 4)
	ball.Position = Vector3.new(i * 9 - 27, 40 + i * 12, 0)
	ball.Color = Color3.fromRGB(90, 170, 230)
	ball.Material = Enum.Material.SmoothPlastic
	ball.Parent = workspace

	-- Touched fires every tick the parts are in contact, so the log is kept
	-- quiet with a flag. Note: this script re-runs each simulation tick, so
	-- state kept in locals resets — that is the known limit until M5.
	ball.Touched:Connect(function(other)
		if other and other.Name == "Baseplate" then
			print(ball.Name .. " landed on the baseplate")
		end
	end)
end

print("dropped 5 parts")
`,
    },
  },
  {
    id: 'game-platformer',
    label: 'Platformer',
    workspace: 'game',
    description: 'Place objects visually and attach code. Arrives in M7.',
    milestone: 'M7',
    entry: 'game.js',
    files: {
      'game.js': `// Visual game builder projects store a scene alongside these files.
export function onUpdate(entity, dt) {
  entity.x += 60 * dt;
}
`,
    },
  },
  {
    id: 'python-script',
    label: 'Python script',
    workspace: 'python',
    description: 'Runs on Pyodide in the browser. Arrives in M8.',
    milestone: 'M8',
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
    activeFile: template.entry in files ? template.entry : Object.keys(files)[0] ?? '',
    settings: { theme: 'vs-dark', autorun: true, analysisMode: 'strict' },
    createdAt: now,
    updatedAt: now,
  };
}

export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
