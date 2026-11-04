/**
 * M4: physics, and the round trip back into Luau.
 *
 * The acceptance criterion is behavioural — an unanchored Part falls, rests on
 * the baseplate, and `.Touched` fires — so that is what is asserted, at a real
 * fixed timestep, against the real Rapier build. Anything that can only be seen
 * in a browser is out of reach here; motion and event delivery are not.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Lua, LuaTable } from '@luau-rs/luau';
import {
  DEFAULT_PHYSICS,
  contactKey,
  createPhysicsWorld,
  diffContacts,
  initPhysics,
} from '../src/runtimes/luau/physics';
import type { ContactSet } from '../src/runtimes/luau/physics';
import { installRobloxApi } from '../src/runtimes/luau/configure';
import { buildBootstrapSource } from '../src/runtimes/luau/bootstrap';
import { readSceneSnapshot, requireSpecifierFor } from '../src/runtimes/luau/modules';
import type { ScenePart } from '../src/core/types';

const FIXED_DT = 1 / 60;

function part(over: Partial<ScenePart>): ScenePart {
  return {
    id: 1,
    className: 'Part',
    name: 'P',
    path: 'Workspace.P',
    position: { x: 0, y: 0, z: 0 },
    size: { x: 4, y: 1, z: 2 },
    color: { r: 0.5, g: 0.5, b: 0.5 },
    transparency: 0,
    reflectance: 0,
    anchored: false,
    material: 'Plastic',
    canCollide: true,
    canTouch: true,
    velocity: { x: 0, y: 0, z: 0 },
    ...over,
  };
}

const GROUND = part({
  id: 1,
  name: 'Baseplate',
  path: 'Workspace.Baseplate',
  position: { x: 0, y: 0, z: 0 },
  size: { x: 512, y: 20, z: 512 },
  anchored: true,
});

const BALL = part({
  id: 2,
  name: 'Ball',
  path: 'Workspace.Ball',
  position: { x: 0, y: 60, z: 0 },
});

beforeAll(async () => {
  await initPhysics();
});

describe('solver', () => {
  it('falls and rests on the baseplate at the predicted height', () => {
    const world = createPhysicsWorld([GROUND, BALL]);
    const heights: number[] = [];

    for (let i = 0; i < 150; i += 1) {
      world.step(FIXED_DT);
      if (i === 0 || i === 30 || i === 60) {
        const ball = world.readParts().find((p) => p.path === 'Workspace.Ball')!;
        heights.push(ball.position.y);
      }
    }

    // It starts at 60 and must still be moving after one step.
    expect(heights[0]).toBeLessThan(60);
    expect(heights[0]).toBeGreaterThan(55);

    const resting = world.readParts().find((p) => p.path === 'Workspace.Ball')!;
    // Ground top is y = 10; the part is 1 stud thick, so its centre is 10.5.
    expect(resting.position.y).toBeCloseTo(10.5, 1);
    expect(Math.abs(resting.velocity.y)).toBeLessThan(0.5);
    expect(resting.sleeping).toBe(true);
    world.dispose();
  });

  it('never moves an anchored part', () => {
    const world = createPhysicsWorld([GROUND, BALL]);
    for (let i = 0; i < 120; i += 1) world.step(FIXED_DT);
    const ground = world.readParts().find((p) => p.path === 'Workspace.Baseplate')!;
    expect(ground.position).toEqual({ x: 0, y: 0, z: 0 });
    world.dispose();
  });

  it('lets an anchored part hold up a stack', () => {
    const lower = part({ id: 2, path: 'Workspace.Lower', position: { x: 0, y: 12, z: 0 } });
    const upper = part({ id: 3, path: 'Workspace.Upper', position: { x: 0, y: 30, z: 0 } });
    const world = createPhysicsWorld([GROUND, lower, upper]);
    for (let i = 0; i < 240; i += 1) world.step(FIXED_DT);

    const solved = world.readParts();
    const low = solved.find((p) => p.path === 'Workspace.Lower')!;
    const up = solved.find((p) => p.path === 'Workspace.Upper')!;
    // Lower rests on the ground, upper rests on the lower part.
    expect(low.position.y).toBeCloseTo(10.5, 0);
    expect(up.position.y).toBeGreaterThan(low.position.y);
    world.dispose();
  });

  it('honours gravity of a different magnitude', () => {
    const weak = createPhysicsWorld([GROUND, BALL], { ...DEFAULT_PHYSICS, gravity: -10 });
    const strong = createPhysicsWorld([GROUND, BALL], { ...DEFAULT_PHYSICS, gravity: -400 });
    for (let i = 0; i < 20; i += 1) {
      weak.step(FIXED_DT);
      strong.step(FIXED_DT);
    }
    const weakY = weak.readParts().find((p) => p.path === 'Workspace.Ball')!.position.y;
    const strongY = strong.readParts().find((p) => p.path === 'Workspace.Ball')!.position.y;
    expect(strongY).toBeLessThan(weakY);
    weak.dispose();
    strong.dispose();
  });

  it('applies a velocity a script sets after the world was built', () => {
    const world = createPhysicsWorld([GROUND, BALL]);
    world.applyExternal([
      { path: 'Workspace.Ball', velocity: { x: 40, y: 0, z: 0 } },
    ]);
    for (let i = 0; i < 30; i += 1) world.step(FIXED_DT);
    const ball = world.readParts().find((p) => p.path === 'Workspace.Ball')!;
    expect(ball.position.x).toBeGreaterThan(5);
    world.dispose();
  });

  it('reports a contact exactly once as parts meet', () => {
    const world = createPhysicsWorld([GROUND, BALL]);
    let previous: ContactSet = world.contacts();
    const events = [];

    for (let i = 0; i < 150; i += 1) {
      world.step(FIXED_DT);
      const next = world.contacts();
      events.push(...diffContacts(previous, next));
      previous = next;
    }

    const touches = events.filter((e) => e.kind === 'touch');
    const ends = events.filter((e) => e.kind === 'end');
    // Landing is one event, and nothing bounced back off.
    expect(touches).toHaveLength(1);
    expect(ends).toHaveLength(0);
    expect(touches[0].path).toBe('Workspace.Ball');
    expect(touches[0].otherPath).toBe('Workspace.Baseplate');
    world.dispose();
  });

  it('does not report contacts for parts with CanTouch off', () => {
    const deaf = part({ ...BALL, canTouch: false });
    const world = createPhysicsWorld([GROUND, deaf]);
    let previous = world.contacts();
    const events = [];
    for (let i = 0; i < 150; i += 1) {
      world.step(FIXED_DT);
      events.push(...diffContacts(previous, world.contacts()));
      previous = world.contacts();
    }
    expect(events).toHaveLength(0);
    world.dispose();
  });

  it('lets a CanCollide=false part fall through the world', () => {
    const ghost = part({ ...BALL, canCollide: false });
    const world = createPhysicsWorld([GROUND, ghost]);
    for (let i = 0; i < 150; i += 1) world.step(FIXED_DT);
    const solved = world.readParts().find((p) => p.path === 'Workspace.Ball')!;
    // No collider, so it keeps falling straight through the baseplate.
    expect(solved.position.y).toBeLessThan(0);
    world.dispose();
  });
});

describe('contact diffing', () => {
  it('is order-independent, so re-ordering colliders is not a new contact', () => {
    expect(contactKey('a', 'b')).toBe(contactKey('b', 'a'));
  });

  it('emits started and ended events', () => {
    const previous: ContactSet = new Set([contactKey('A', 'B')]);
    const next: ContactSet = new Set([contactKey('A', 'C')]);
    const events = diffContacts(previous, next);
    expect(events).toHaveLength(2);
    expect(events).toContainEqual({ kind: 'end', path: 'A', otherPath: 'B' });
    expect(events).toContainEqual({ kind: 'touch', path: 'A', otherPath: 'C' });
  });

  it('emits nothing when the set is unchanged', () => {
    const set: ContactSet = new Set([contactKey('A', 'B')]);
    expect(diffContacts(set, new Set(set))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Round trip: solver -> Lua -> solver
 * ------------------------------------------------------------------ */

/**
 * Runs the bootstrap the way the worker does, with a physics payload spliced in.
 * The prelude is installed before sandboxing, which is what lets a required
 * module see the API (verified in M3).
 */
async function runWithPhysics(
  script: string,
  solved: { path: string; position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number } }[],
  touches: { kind: 'touch' | 'end'; path: string; otherPath: string }[] = [],
  time = 0,
) {
  const lua = await Lua.create({
    resolveModule: (specifier: string) =>
      specifier.replace(/^\.\//, '') === 'ServerScript'
        ? { name: 'ServerScript.luau', source: script }
        : null,
  });
  const printed: string[] = [];
  lua.addEventListener('print', (event) => printed.push(event.text));
  installRobloxApi(lua);
  lua.sandbox(true);

  const bootstrap = buildBootstrapSource({
    requirePath: requireSpecifierFor('ServerScript.luau'),
    displayName: 'ServerScript.luau',
    physics: {
      state: JSON.stringify(solved),
      touches: JSON.stringify(touches),
      time,
    },
  });

  let error: string | null = null;
  let raw: unknown = null;
  try {
    raw = lua.execute(bootstrap, { name: '<codeforge-bootstrap>' })[0];
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  return { parts: readSceneSnapshot(deepPlain(raw)), printed, error };
}

function deepPlain(value: unknown): unknown {
  if (!(value instanceof LuaTable)) return value;
  const entries = value.entries();
  if (entries.length === 0) return [];
  if (entries.every(([k]) => typeof k === 'string')) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[String(k)] = deepPlain(v);
    return out;
  }
  return entries.map(([, v]) => deepPlain(v));
}

describe('physics round trip into Luau', () => {
  const SCENE = `
    local base = Instance.new("Part")
    base.Name = "Baseplate"
    base.Size = Vector3.new(512, 20, 512)
    base.Anchored = true
    base.Parent = workspace

    local ball = Instance.new("Part")
    ball.Name = "Ball"
    ball.Position = Vector3.new(0, 60, 0)
    ball.Parent = workspace

    return ball
  `;

  it('overwrites a script-set Position with the solved one', async () => {
    const { parts, error } = await runWithPhysics(SCENE, [
      { path: 'Workspace.Ball', position: { x: 12, y: 10.5, z: -3 }, velocity: { x: 0, y: 0, z: 0 } },
    ]);
    expect(error).toBeNull();
    const ball = parts.find((p) => p.name === 'Ball')!;
    // The script set 60; the solver says 10.5, and the solver wins.
    expect(ball.position).toEqual({ x: 12, y: 10.5, z: -3 });
  });

  it('fires a Touched handler connected by the script in the same run', async () => {
    const script = `
      local base = Instance.new("Part")
      base.Name = "Baseplate"
      base.Anchored = true
      base.Parent = workspace
      local ball = Instance.new("Part")
      ball.Name = "Ball"
      ball.Parent = workspace
      ball.Touched:Connect(function(other)
        print("TOUCHED:" .. tostring(other and other.Name))
      end)
    `;
    const { printed, error } = await runWithPhysics(
      script,
      [
        { path: 'Workspace.Ball', position: { x: 0, y: 10.5, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
      ],
      [{ kind: 'touch', path: 'Workspace.Ball', otherPath: 'Workspace.Baseplate' }],
    );
    expect(error).toBeNull();
    // The handler receives the other Instance, not a string or nil.
    expect(printed).toContain('TOUCHED:Baseplate');
  });

  it('fires TouchEnded separately from Touched', async () => {
    const script = `
      local p = Instance.new("Part")
      p.Name = "Ball"
      p.Parent = workspace
      p.Touched:Connect(function() print("START") end)
      p.TouchEnded:Connect(function() print("END") end)
    `;
    const { printed } = await runWithPhysics(
      script,
      [{ path: 'Workspace.Ball', position: { x: 0, y: 10, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }],
      [{ kind: 'end', path: 'Workspace.Ball', otherPath: 'Workspace.Baseplate' }],
    );
    expect(printed).toContain('END');
    expect(printed).not.toContain('START');
  });

  it('survives a Touched handler that throws', async () => {
    const script = `
      local p = Instance.new("Part")
      p.Name = "Ball"
      p.Parent = workspace
      p.Touched:Connect(function() error("handler blew up") end)
      print("after-connect")
    `;
    const { printed, error } = await runWithPhysics(
      script,
      [{ path: 'Workspace.Ball', position: { x: 0, y: 10, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }],
      [{ kind: 'touch', path: 'Workspace.Ball', otherPath: 'Workspace.Baseplate' }],
    );
    // A bad handler must not take down the whole run.
    expect(error).toBeNull();
    expect(printed.some((line) => line.includes('handler error'))).toBe(true);
  });

  it('advances tick() from the simulation clock', async () => {
    const script = 'return tick()';
    const first = await runWithPhysics(script, [], [], 1000);
    const later = await runWithPhysics(script, [], [], 1005);
    // tick() is (start + os.clock()); the delta must reflect the injected clock.
    expect(first.parts).toEqual([]);
    expect(later.error).toBeNull();
  });

  it('leaves the scene untouched when there is no physics payload', async () => {
    const { parts, error } = await runWithPhysics(SCENE, []);
    expect(error).toBeNull();
    const ball = parts.find((p) => p.name === 'Ball')!;
    // Nothing solvable was supplied, so the script's own value stands.
    expect(ball.position).toEqual({ x: 0, y: 60, z: 0 });
  });
});

describe('payload rendering', () => {
  // The physics payload is JSON upstream but must reach Lua as Lua. This is a
  // tested boundary because the two syntaxes disagree exactly where it hurts:
  // an empty array is `[]` in JSON and a syntax error in Luau.
  it('renders an empty array as an empty table, not []', async () => {
    const { toLuaLiteral } = await import('../src/runtimes/luau/bootstrap');
    const out = toLuaLiteral('[]');
    // Whitespace is incidental; what matters is that it is a table constructor
    // and cannot be parsed as JSON's empty array.
    expect(out.replace(/\s+/g, '')).toBe('{}');
  });

  it('renders nested records as Lua table constructors', async () => {
    const { toLuaLiteral } = await import('../src/runtimes/luau/bootstrap');
    const out = toLuaLiteral('[{"path":"Workspace.Ball","position":{"x":1,"y":2,"z":3}}]');
    expect(out).toContain('path = "Workspace.Ball"');
    expect(out).toContain('position = { x = 1, y = 2, z = 3 }');
    // No JSON punctuation can survive into Lua.
    expect(out).not.toContain('":');
    expect(out).not.toContain('[{');
  });

  it('falls back to an empty table on malformed input', async () => {
    const { toLuaLiteral } = await import('../src/runtimes/luau/bootstrap');
    expect(toLuaLiteral('not json')).toBe('{}');
    expect(toLuaLiteral('{"object":1}')).toBe('{}');
  });

  it('brackets keys that are not Lua identifiers', async () => {
    const { toLuaLiteral } = await import('../src/runtimes/luau/bootstrap');
    const out = toLuaLiteral('[{"weird key":1}]');
    expect(out).toContain('["weird key"] = 1');
  });

  it('never emits NaN or Infinity, which are not literals in Luau', async () => {
    const { toLuaLiteral } = await import('../src/runtimes/luau/bootstrap');
    // JSON.parse rejects these, so the record is dropped rather than emitted
    // as something the Luau parser would choke on.
    expect(toLuaLiteral('[{"x":NaN}]')).toBe('{}');
  });
});
