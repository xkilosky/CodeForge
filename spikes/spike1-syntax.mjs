// Spike 1: is this real Luau (not Lua 5.4)?
// Proves: type annotations, `+=`, `continue`, and `{string}` interpolation all compile and run.
// Also proves a shim constraint: `warn` is nil in this build, so the host must supply it.
import { Lua } from '@luau-rs/luau';

const lua = await Lua.create({ sandbox: true });
const out = [];
for (const t of ['print', 'warn', 'error']) lua.addEventListener(t, e => out.push(`[${t}] ${e.text}`));

// Constraint discovered: `warn` does not exist in this build (see PLAN.md §2).
console.log('typeof(warn) before shim:', lua.execute('return typeof(warn)'));
lua.globals.set('warn', lua.createFunction(m => out.push(`[warn] ${m}`), { args: [String] }));

const src = `
type Point = { x: number, y: number }
local function norm(p: Point): number
	return math.sqrt(p.x^2 + p.y^2)
end

local total = 0
for i = 1, 10 do
	if i % 2 == 0 then continue end   -- Luau-only: continue
	total += i                         -- Luau-only: compound assignment
end

local name = "Roblox"
print(\`{name} sum={total} norm={norm({x=3, y=4})}\`)          -- Luau-only: string interpolation
print("types:", typeof(total), typeof(buffer.create(8)), typeof(utf8))
warn("a warning")
return total
`;

console.log('RETURN :', lua.execute(src), '(expected [25] = 1+3+5+7+9)');
console.log('OUTPUT :');
out.forEach(l => console.log('   ', l));
