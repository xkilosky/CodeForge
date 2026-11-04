/**
 * M3: the render bridge, the scene serializer, and the Roblox -> three.js mapping.
 *
 * The viewport itself cannot be pixel-tested here (there is no browser in the
 * dev sandbox), so these tests attack the parts that can silently produce a
 * blank or wrong scene: whether the bridge returns geometry at all, whether the
 * numbers survive the Lua/JS boundary, and whether Roblox's size/position/colour
 * conventions are mapped the way three.js expects.
 *
 * The bridge is exercised through a real Luau VM with `resolveModule` wired to
 * the project files, which is the same path the worker takes.
 */
import { describe, expect, it } from 'vitest';
import { Lua, LuaTable } from '@luau-rs/luau';
import { installRobloxApi } from '../src/runtimes/luau/configure';
import { buildBootstrapSource } from '../src/runtimes/luau/bootstrap';
import {
  buildLuauModules,
  readSceneSnapshot,
  requireSpecifierFor,
  resolveModuleReference,
} from '../src/runtimes/luau/modules';
import { PRELUDE_SOURCE } from '../src/runtimes/luau/configure';
import type { FileMap, ScenePart } from '../src/core/types';
import {
  CYLINDER_ROTATION_Z,
  boxArgs,
  cylinderArgs,
  cylinderRadius,
  lookForMaterial,
  opacityFor,
  rgbHex,
  shapeForClass,
  sphereArgs,
} from '../src/ui/viewport/partMesh';

const SENTINEL: FileMap = {
  'ServerScript.luau': { content: '', language: 'luau' },
};

function filesFrom(records: Record<string, string>): FileMap {
  const files: FileMap = {};
  for (const [path, content] of Object.entries(records)) {
    files[path] = { content, language: 'luau' };
  }
  return files;
}

/**
 * Runs a project exactly as the worker does: bootstrap as the entry, the user's
 * script registered as a module, and the prelude installed from the host.
 */
async function runProject(records: Record<string, string>, entry = 'ServerScript.luau') {
  const files = filesFrom(records);
  const modules = buildLuauModules(files);
  const printed: string[] = [];

  // The order here matters and mirrors the worker exactly: create the state
  // UNSANDBOXED, install the API, and only then call sandbox(true). Installing
  // into a state that is already sandboxed puts the globals somewhere that
  // required modules cannot reach, and every `require` then sees nil.
  const lua = await Lua.create({
    resolveModule: (specifier) => {
      const clean = specifier.replace(/^\.\//, '');
      const found = modules.find((m) => m.name.replace(/\.(luau|lua)$/i, '') === clean);
      return found ? { name: found.name, source: found.source } : null;
    },
  });
  lua.addEventListener('print', (event) => printed.push(event.text));
  installRobloxApi(lua);
  lua.sandbox(true);

  const bootstrap = buildBootstrapSource({
    requirePath: requireSpecifierFor(entry),
    displayName: entry,
  });

  let error: string | null = null;
  let raw: unknown = null;
  try {
    raw = lua.execute(bootstrap, { name: '<codeforge-bootstrap>' })[0];
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  return { parts: readSceneSnapshot(deepPlain(raw)), printed, error, raw };
}

/**
 * The direct API hands back LuaTable handles. The worker boundary returns
 * detached plain values instead, so convert to match what production sees —
 * otherwise these tests would validate a shape the app never receives.
 */
function deepPlain(value: unknown): unknown {
  if (!(value instanceof LuaTable)) return value;
  // The outer value is a sequence and each part is a string-keyed record, and
  // the two converters are strict: `toArray` rejects records with "table must
  // be a contiguous sequence" and `toObject` rejects sequences. So decide from
  // the key types rather than guessing.
  const entries = value.entries();
  if (entries.length === 0) return [];
  const allStringKeys = entries.every(([k]) => typeof k === 'string');
  if (allStringKeys) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[String(k)] = deepPlain(v);
    return out;
  }
  return entries.map(([, v]) => deepPlain(v));
}

/** The acceptance script from PLAN.md §9 (spike 3). */
const SPIKE3_SCRIPT = `
local base = Instance.new("Part")
base.Name = "Baseplate"
base.Size = Vector3.new(512, 20, 512)
base.Anchored = true
base.Color = Color3.fromRGB(40, 200, 90)
base.Parent = workspace

for i = 1, 5 do
  local block = Instance.new("Part")
  block.Name = "Block" .. i
  block.Position = Vector3.new(i * 12, 20, 0)
  block.Color = Color3.new(i / 5, 0.3, 1 - i / 5)
  block.Parent = workspace
end

print("built " .. #workspace:GetChildren() .. " parts")
`;

describe('render bridge', () => {
  it('draws the M3 acceptance scene: a baseplate plus 5 positioned blocks', async () => {
    const { parts, error } = await runProject({ 'ServerScript.luau': SPIKE3_SCRIPT });
    expect(error).toBeNull();

    // 1 baseplate + 5 blocks. Nothing else is renderable in the default tree.
    expect(parts).toHaveLength(6);

    const base = parts.find((p) => p.name === 'Baseplate');
    expect(base).toBeDefined();
    expect(base!.size).toEqual({ x: 512, y: 20, z: 512 });
    expect(base!.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(base!.anchored).toBe(true);
    // Color3.fromRGB(40,200,90) -> 0..1 floats.
    expect(base!.color.r).toBeCloseTo(40 / 255, 5);
    expect(base!.color.g).toBeCloseTo(200 / 255, 5);
    expect(base!.color.b).toBeCloseTo(90 / 255, 5);

    // Blocks sit at x = 12..60, all at y = 20, z = 0.
    const blocks = parts.filter((p) => p.name.startsWith('Block'));
    expect(blocks).toHaveLength(5);
    for (let i = 1; i <= 5; i += 1) {
      const block = blocks.find((b) => b.name === `Block${i}`)!;
      expect(block.position).toEqual({ x: i * 12, y: 20, z: 0 });
      expect(block.size).toEqual({ x: 4, y: 1, z: 2 });
      expect(block.color.r).toBeCloseTo(i / 5, 5);
      expect(block.color.g).toBeCloseTo(0.3, 5);
      expect(block.color.b).toBeCloseTo(1 - i / 5, 5);
    }
  });

  it('streams print through the same run', async () => {
    const { printed } = await runProject({ 'ServerScript.luau': SPIKE3_SCRIPT });
    expect(printed).toContain('built 6 parts');
  });

  it('reports the user file and line for a runtime error, not the bootstrap', async () => {
    const { error, parts } = await runProject({
      'ServerScript.luau': 'local t = nil\nprint("before")\nprint(t.field)\n',
    });
    expect(parts).toHaveLength(0);
    expect(error).toBeTruthy();
    // The bug is on line 3 of the user's file and must be attributed there.
    expect(error).toMatch(/ServerScript\.luau:3/);
    expect(error).not.toMatch(/codeforge-bootstrap/);
  });

  it('reports syntax errors against the user file too', async () => {
    const { error } = await runProject({
      'ServerScript.luau': 'local ok = true\nlocal x = = 1\n',
    });
    expect(error).toBeTruthy();
    expect(error).toMatch(/ServerScript\.luau:2/);
  });

  it('finds parts parented anywhere, not only under workspace', async () => {
    const { parts } = await runProject({
      'ServerScript.luau': `
        local a = Instance.new("Part")
        a.Name = "Nested"
        a.Parent = workspace
        local folder = Instance.new("Folder")
        folder.Parent = workspace
        local b = Instance.new("Part")
        b.Name = "Deep"
        b.Parent = folder
        local ignored = Instance.new("Folder")
        ignored.Parent = workspace
      `,
    });
    const names = parts.map((p) => p.name);
    expect(names).toContain('Nested');
    expect(names).toContain('Deep');
    // A Folder is not renderable.
    expect(parts.every((p) => p.className !== 'Folder')).toBe(true);
  });

  it('excludes parts that were destroyed or never parented', async () => {
    const { parts } = await runProject({
      'ServerScript.luau': `
        local kept = Instance.new("Part")
        kept.Name = "Kept"
        kept.Parent = workspace
        local gone = Instance.new("Part")
        gone.Name = "Gone"
        gone.Parent = workspace
        gone:Destroy()
        local orphan = Instance.new("Part")
        orphan.Name = "Orphan"
      `,
    });
    const names = parts.map((p) => p.name);
    expect(names).toEqual(['Kept']);
  });

  it('records a dotted path so the viewport can show hierarchy', async () => {
    const { parts } = await runProject({
      'ServerScript.luau': `
        local folder = Instance.new("Folder")
        folder.Name = "Props"
        folder.Parent = workspace
        local p = Instance.new("Part")
        p.Name = "Crate"
        p.Parent = folder
      `,
    });
    const crate = parts.find((p) => p.name === 'Crate');
    expect(crate!.path).toBe('Workspace.Props.Crate');
  });

  it('works for a project whose entry is in a subdirectory', async () => {
    const { parts, error } = await runProject(
      {
        'src/main.luau': `
          local p = Instance.new("Part")
          p.Name = "SubdirPart"
          p.Parent = workspace
        `,
      },
      'src/main.luau',
    );
    expect(error).toBeNull();
    expect(parts.map((p) => p.name)).toContain('SubdirPart');
  });

  it('lets a multi-file project require a sibling module', async () => {
    const { parts, error } = await runProject({
      'ServerScript.luau': `
        local Shop = require("./lib/Shop")
        Shop.build(workspace)
      `,
      'lib/Shop.luau': `
        local Shop = {}
        function Shop.build(parent)
          local p = Instance.new("Part")
          p.Name = "FromModule"
          p.Parent = parent
        end
        return Shop
      `,
    });
    expect(error).toBeNull();
    expect(parts.map((p) => p.name)).toContain('FromModule');
  });

  it('produces an empty scene rather than throwing when nothing is built', async () => {
    const { parts, error } = await runProject({ 'ServerScript.luau': 'print("hello")' });
    expect(error).toBeNull();
    expect(parts).toEqual([]);
  });

  it('carries material, transparency and reflectance through', async () => {
    const { parts } = await runProject({
      'ServerScript.luau': `
        local p = Instance.new("Part")
        p.Name = "GlassPane"
        p.Material = Enum.Material.Glass
        p.Transparency = 0.25
        p.Reflectance = 0.5
        p.Parent = workspace
      `,
    });
    const pane = parts.find((p) => p.name === 'GlassPane')!;
    expect(pane.material).toBe('Glass');
    expect(pane.transparency).toBeCloseTo(0.25, 5);
    expect(pane.reflectance).toBeCloseTo(0.5, 5);
  });
});

describe('module mapping', () => {
  it('drops the extension the way Roblox names modules', () => {
    expect(requireSpecifierFor('ServerScript.luau')).toBe('./ServerScript');
    expect(requireSpecifierFor('lib/Shop.lua')).toBe('./lib/Shop');
  });

  it('resolves case-insensitively and by basename', () => {
    const files = filesFrom({ 'lib/Shop.luau': '', 'ServerScript.luau': '' });
    expect(resolveModuleReference(files, './lib/Shop')).toBe('lib/Shop.luau');
    expect(resolveModuleReference(files, './shop')).toBe('lib/Shop.luau');
    expect(resolveModuleReference(files, './nope')).toBeNull();
  });

  it('skips non-Luau files', () => {
    const files: FileMap = {
      ...filesFrom({ 'a.luau': '' }),
      'notes.txt': { content: 'x', language: 'text' },
    };
    expect(buildLuauModules(files).map((m) => m.name)).toEqual(['a.luau']);
  });
});

describe('readSceneSnapshot validation', () => {
  it('rejects anything that is not an array', () => {
    expect(readSceneSnapshot(null)).toEqual([]);
    expect(readSceneSnapshot('nope')).toEqual([]);
    expect(readSceneSnapshot(42)).toEqual([]);
  });

  it('drops malformed parts but keeps the good ones', () => {
    const parts = readSceneSnapshot([
      { className: 'Part', position: { x: 1, y: 2, z: 3 }, size: { x: 1, y: 1, z: 1 }, color: { r: 1, g: 0, b: 0 } },
      { className: 'Part', position: 'not a vector', size: { x: 1, y: 1, z: 1 }, color: { r: 1, g: 0, b: 0 } },
      { className: 'Part', position: { x: NaN, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 }, color: { r: 1, g: 0, b: 0 } },
      { completely: 'wrong' },
    ]);
    expect(parts).toHaveLength(1);
    expect(parts[0].position).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('clamps colours into range and floors zero-sized axes', () => {
    const [part] = readSceneSnapshot([
      { position: { x: 0, y: 0, z: 0 }, size: { x: 0, y: -5, z: 2 }, color: { r: 4, g: -1, b: 0.5 } },
    ]);
    expect(part.color).toEqual({ r: 1, g: 0, b: 0.5 });
    expect(part.size.x).toBeGreaterThan(0);
    expect(part.size.y).toBeGreaterThan(0);
  });
});

describe('three.js mapping', () => {
  const part = (over: Partial<ScenePart>): ScenePart => ({
    id: 1,
    className: 'Part',
    name: 'P',
    path: 'Workspace.P',
    position: { x: 0, y: 0, z: 0 },
    size: { x: 4, y: 1, z: 2 },
    color: { r: 0.5, g: 0.5, b: 0.5 },
    transparency: 0,
    reflectance: 0,
    anchored: true,
    material: 'Plastic',
    canCollide: true,
    canTouch: true,
    velocity: { x: 0, y: 0, z: 0 },
    ...over,
  });

  it('maps class names to shapes', () => {
    expect(shapeForClass('Part')).toBe('box');
    expect(shapeForClass('SpherePart')).toBe('sphere');
    expect(shapeForClass('CylinderPart')).toBe('cylinder');
    expect(shapeForClass('WedgePart')).toBe('wedge');
    expect(shapeForClass('SomethingUnknown')).toBe('box');
  });

  it('gives a box the part size verbatim', () => {
    expect(boxArgs({ x: 4, y: 1, z: 2 })).toEqual([4, 1, 2]);
  });

  it('uses the largest dimension as a sphere diameter', () => {
    expect(sphereArgs({ x: 4, y: 8, z: 2 })[0]).toBe(4);
  });

  it('lays a cylinder along X, as Roblox does', () => {
    expect(cylinderRadius({ x: 10, y: 4, z: 4 })).toBe(2);
    const [radius, height] = cylinderArgs({ x: 10, y: 4, z: 4 });
    expect(radius).toBe(2);
    // A Roblox cylinder's length runs along X; its radius is Y/Z.
    expect(height).toBe(10);
    expect(CYLINDER_ROTATION_Z).toBeCloseTo(Math.PI / 2, 10);
  });

  it('converts 0..1 colour to 0xRRGGBB', () => {
    // Spike 8 measured Color3.fromRGB(40,200,90) -> #28C85A.
    expect(rgbHex({ r: 40 / 255, g: 200 / 255, b: 90 / 255 })).toBe(0x28c85a);
    expect(rgbHex({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(rgbHex({ r: 1, g: 1, b: 1 })).toBe(0xffffff);
  });

  it('inverts transparency into opacity', () => {
    expect(opacityFor(part({ transparency: 0 }))).toBe(1);
    expect(opacityFor(part({ transparency: 1 }))).toBe(0);
    expect(opacityFor(part({ transparency: 0.25 }))).toBeCloseTo(0.75, 6);
  });

  it('caps opacity for inherently translucent materials', () => {
    // Glass stays see-through even at Transparency 0.
    expect(opacityFor(part({ transparency: 0, material: 'Glass' }))).toBeLessThan(0.5);
    // But the script can make it more transparent still.
    expect(opacityFor(part({ transparency: 0.9, material: 'Glass' }))).toBeCloseTo(0.1, 6);
  });

  it('treats Neon as emissive and Metal as shiny', () => {
    expect(lookForMaterial('Neon').emissive).toBe(true);
    expect(lookForMaterial('Plastic').emissive).toBe(false);
    expect(lookForMaterial('Metal').metalness).toBeGreaterThan(0.5);
    expect(lookForMaterial('Concrete').roughness).toBeGreaterThan(0.8);
  });

  it('falls back to plastic for an unknown material', () => {
    expect(lookForMaterial('Unobtainium')).toEqual(lookForMaterial('Plastic'));
  });
});

describe('prelude', () => {
  it('still declares the scene serializer after the M3 additions', () => {
    expect(PRELUDE_SOURCE).toContain('__codeforge_serializeScene');
  });

  it('does not leave the shape/size constants shadowing user globals', () => {
    // Instance defaults must not leak a global named `DEFAULT_SIZE`.
    expect(PRELUDE_SOURCE).not.toMatch(/^DEFAULT_SIZE/m);
  });

  it('keeps SENTINEL unused-warning quiet by using it', () => {
    expect(Object.keys(SENTINEL)).toContain('ServerScript.luau');
  });
});
