import { describe, expect, it } from 'vitest';
import { Lua } from '@luau-rs/luau';
import { LuaWorker } from '@luau-rs/luau/worker';
import { installRobloxApi } from '../src/runtimes/luau/configure';
import { formatLuauError, parseLuauError } from '../src/runtimes/luau/errors';
import { createLuauAnalyzer } from '../src/runtimes/luau/analyze';
import { filesFromRecords } from '../src/core/templates';

/** A fresh sandboxed state with the Roblox API installed, as the worker does. */
async function makeState() {
  const lua = await Lua.create({ sandbox: true });
  const printed: string[] = [];
  // `print` is the only output event this build dispatches; the prelude's `warn`
  // falls back to print, so this captures both.
  lua.addEventListener('print', (e) => printed.push(e.text));
  const globals = installRobloxApi(lua);
  return { lua, printed, globals };
}

async function runUser(source: string) {
  const { lua, printed } = await makeState();
  const values = lua.execute(source);
  return { values, printed };
}

describe('installRobloxApi', () => {
  it('installs the Roblox global surface', async () => {
    const { globals } = await makeState();
    for (const name of [
      'Vector3', 'Vector2', 'CFrame', 'Color3', 'UDim', 'UDim2', 'Enum',
      'Instance', 'Signal', 'workspace', 'game', 'typeof', 'print', 'warn',
      'task', 'tick', 'time', 'Lighting', 'ReplicatedStorage', 'Players',
    ]) {
      expect(globals, name).toContain(name);
    }
  });

  it('supplies warn, which this Luau build does not define', async () => {
    const { lua } = await makeState();
    expect(lua.execute('return typeof(warn)')).toEqual(['function']);
  });

  it('leaves Luau native table/math/string extensions untouched', async () => {
    const { lua } = await makeState();
    // Shadowing these recursed infinitely; they must stay the natives.
    expect(lua.execute('return table.clone({1,2,3})[3]')).toEqual([3]);
    expect(lua.execute('return math.clamp(15, 0, 10)')).toEqual([10]);
    expect(lua.execute('return #("a,b,c"):split(",") and 3 or 0')).toEqual([3]);
  });
});

describe('Roblox API behaviour', () => {
  it('reports Roblox type names from typeof', async () => {
    const { values } = await runUser(`
      return typeof(Vector3.new()), typeof(Instance.new("Part")), typeof(Color3.new()), typeof(5)
    `);
    expect(values).toEqual(['Vector3', 'Instance', 'Color3', 'number']);
  });

  it('does the Vector3 arithmetic', async () => {
    const { values } = await runUser(`
      local v = Vector3.new(3, 4, 0)
      return v:Magnitude(), tostring(Vector3.xAxis:Cross(Vector3.yAxis)), tostring(v + v)
    `);
    expect(values).toEqual([5, '0, 0, 1', '6, 8, 0']);
  });

  it('converts Color3 to and from RGB', async () => {
    const { values } = await runUser(`
      local c = Color3.fromRGB(40, 200, 90)
      return c:ToHex(), math.floor(c.R * 255), math.floor(c.G * 255)
    `);
    expect(values).toEqual(['28C85A', 40, 200]);
  });

  it('builds and traverses an Instance tree', async () => {
    const { values } = await runUser(`
      local base = Instance.new("Part", workspace)
      base.Name = "Baseplate"
      for i = 1, 3 do
        local b = Instance.new("Part", base)
        b.Name = "Block" .. i
      end
      return #base:GetChildren(), #workspace:GetDescendants(),
             base:FindFirstChild("Block2").Name, base:IsA("BasePart"), base:GetFullName()
    `);
    expect(values).toEqual([3, 4, 'Block2', true, 'Game.Workspace.Baseplate']);
  });

  it('fires signals to every connection', async () => {
    const { values } = await runUser(`
      local signal = Signal.new()
      local total = 0
      signal:Connect(function(n) total += n end)
      signal:Connect(function(n) total += n * 10 end)
      signal:Fire(2)
      return total
    `);
    expect(values).toEqual([22]);
  });

  it('stops a handler that disconnects itself mid-fire', async () => {
    const { values } = await runUser(`
      local signal = Signal.new()
      local calls = 0
      local conn
      conn = signal:Connect(function()
        calls += 1
        conn:Disconnect()
      end)
      signal:Fire()
      signal:Fire()
      return calls
    `);
    expect(values).toEqual([1]);
  });

  it('clones and destroys instances', async () => {
    const { values } = await runUser(`
      local base = Instance.new("Part", workspace)
      base.Name = "Base"
      Instance.new("Part", base).Name = "Kid"
      local copy = base:Clone()
      copy.Parent = workspace
      local before = #workspace:GetChildren()
      base:Destroy()
      return #copy:GetChildren(), before, #workspace:GetChildren()
    `);
    expect(values).toEqual([1, 2, 1]);
  });

  it('refuses to reparent an instance under its own descendant', async () => {
    const { lua } = await makeState();
    expect(() =>
      lua.execute(`
        local parent = Instance.new("Part", workspace)
        local child = Instance.new("Part", parent)
        parent.Parent = child
      `),
    ).toThrow(/descendant/);
  });

  it('names what is missing instead of returning a silent nil', async () => {
    const { lua } = await makeState();
    expect(() => lua.execute('task.wait(1)')).toThrow(/M5/);
    expect(() => lua.execute('wait(1)')).toThrow(/M5/);
  });
});

describe('LuaWorker containment', () => {
  it('kills a runaway script instead of hanging', async () => {
    const worker = new LuaWorker();
    const started = Date.now();
    const result = await worker.execute('while true do end');
    const elapsed = Date.now() - started;
    worker.terminate();

    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('interrupted');
    expect(elapsed).toBeLessThan(5000);
  }, 20_000);

  it('caps memory growth', async () => {
    const worker = new LuaWorker();
    const result = await worker.execute('local t = {} for i = 1, 1e9 do t[i] = i end');
    worker.terminate();
    expect(result.ok).toBe(false);
  }, 20_000);
});

describe('parseLuauError', () => {
  it('extracts file and line from a runtime error', () => {
    const parsed = parseLuauError(
      'runtime error: ServerScript.luau:3: deliberate\nstack traceback:\n[C] function error\nServerScript.luau:3',
    );
    expect(parsed).toMatchObject({
      kind: 'runtime',
      message: 'deliberate',
      file: 'ServerScript.luau',
      line: 3,
      internal: false,
    });
    expect(parsed.traceback).toContain('stack traceback');
  });

  it('extracts file and line from a syntax error', () => {
    const parsed = parseLuauError(
      "syntax error: Bad.luau:2: Expected identifier when parsing expression, got '='",
    );
    expect(parsed).toMatchObject({
      kind: 'syntax',
      file: 'Bad.luau',
      line: 2,
      message: "Expected identifier when parsing expression, got '='",
    });
  });

  it('does not blame the user for a wasm-internal failure', () => {
    const parsed = parseLuauError(
      'runtime error: crates/luau-wasm/src/direct/compiler.rs:187:1323: stack overflow',
    );
    expect(parsed.internal).toBe(true);
    expect(parsed.file).toBeUndefined();
    expect(parsed.line).toBeUndefined();
    expect(parsed.message).toBe('stack overflow');
  });

  it('handles a message with no location', () => {
    const parsed = parseLuauError('runtime error: something went wrong');
    expect(parsed.file).toBeUndefined();
    expect(parsed.message).toBe('something went wrong');
  });

  it('formats a clickable location', () => {
    expect(formatLuauError(parseLuauError('runtime error: a.luau:7: boom'))).toBe(
      'boom (a.luau:7)',
    );
  });
});

describe('createLuauAnalyzer', () => {
  it('recognises the Roblox globals instead of flagging them unknown', async () => {
    const analyzer = await createLuauAnalyzer();
    const diagnostics = analyzer.check(
      filesFromRecords({
        'ServerScript.luau': `local part = Instance.new("Part", workspace)
part.Name = "Baseplate"
part.Color = Color3.fromRGB(40, 200, 90)
print(#part:GetChildren())
`,
      }),
      'nonstrict',
    );
    analyzer.dispose();
    expect(diagnostics).toEqual([]);
  });

  it('reports a type error at the right line in strict mode', async () => {
    const analyzer = await createLuauAnalyzer();
    const diagnostics = analyzer.check(
      filesFromRecords({
        'ServerScript.luau': `local v = Vector3.new(1, 2, 3)
local n: number = "not a number"
print(v)
`,
      }),
      'strict',
    );
    analyzer.dispose();

    const typeError = diagnostics.find((d) => d.code === 1000);
    expect(typeError).toBeDefined();
    // 1-based: the bad assignment is the second line.
    expect(typeError?.line).toBe(2);
    expect(typeError?.file).toBe('ServerScript.luau');
    expect(typeError?.severity).toBe('error');
  });

  it('does not report that type error in nonstrict mode', async () => {
    const analyzer = await createLuauAnalyzer();
    const diagnostics = analyzer.check(
      filesFromRecords({
        'ServerScript.luau': `local n: number = "not a number"\nprint(n)\n`,
      }),
      'nonstrict',
    );
    analyzer.dispose();
    expect(diagnostics.find((d) => d.code === 1000)).toBeUndefined();
  });

  it('flags an undefined global', async () => {
    const analyzer = await createLuauAnalyzer();
    const diagnostics = analyzer.check(
      filesFromRecords({ 'a.luau': 'print(totallyUnknown)\n' }),
      'nonstrict',
    );
    analyzer.dispose();
    expect(diagnostics.some((d) => d.code === 1001)).toBe(true);
  });

  it('skips files that are not Luau', async () => {
    const analyzer = await createLuauAnalyzer();
    const diagnostics = analyzer.check(
      filesFromRecords({ 'index.html': '<h1>hi</h1>', 'style.css': 'a{b:c}' }),
      'strict',
    );
    analyzer.dispose();
    expect(diagnostics).toEqual([]);
  });
});
