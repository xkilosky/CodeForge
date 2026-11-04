// Architecture probe: Roblox API = Luau prelude that RETURNS its globals; host installs them.
import { Lua } from '@luau-rs/luau';
const lua = await Lua.create({ sandbox: true });
const out = [], drawn = [];
for (const t of ['print','warn','error']) lua.addEventListener(t, e => out.push(e.text));

const Host = lua.createTable();
Host.set('draw', lua.createFunction((cls, name, x, y, z, sx, sy, sz, r, g, b) => {
  drawn.push({ cls, name, pos: [x,y,z], size: [sx,sy,sz], color: [+r.toFixed(2),+g.toFixed(2),+b.toFixed(2)] });
}, { args: [String, String, Number, Number, Number, Number, Number, Number, Number, Number, Number] }));
lua.globals.set('Host', Host);

const PRELUDE = `
local api = {}
local Vector3 = {}
Vector3.__index = Vector3
function Vector3.new(x, y, z) return setmetatable({ X = x or 0, Y = y or 0, Z = z or 0 }, Vector3) end
function Vector3.__add(a, b) return Vector3.new(a.X + b.X, a.Y + b.Y, a.Z + b.Z) end
function Vector3.__sub(a, b) return Vector3.new(a.X - b.X, a.Y - b.Y, a.Z - b.Z) end
function Vector3.__unm(a) return Vector3.new(-a.X, -a.Y, -a.Z) end
function Vector3.__mul(a, s) if typeof(s) == "number" then return Vector3.new(a.X*s, a.Y*s, a.Z*s) end end
function Vector3.__eq(a, b) return a.X==b.X and a.Y==b.Y and a.Z==b.Z end
function Vector3.__tostring(a) return string.format("%g, %g, %g", a.X, a.Y, a.Z) end
function Vector3:Magnitude() return math.sqrt(self.X^2 + self.Y^2 + self.Z^2) end
function Vector3:Dot(o) return self.X*o.X + self.Y*o.Y + self.Z*o.Z end
function Vector3:Lerp(g, a) return Vector3.new(self.X+(g.X-self.X)*a, self.Y+(g.Y-self.Y)*a, self.Z+(g.Z-self.Z)*a) end
api.Vector3 = Vector3

local Color3 = {}
Color3.__index = Color3
function Color3.new(r, g, b) return setmetatable({ R = r or 0, G = g or 0, B = b or 0 }, Color3) end
function Color3.fromRGB(r, g, b) return Color3.new(r/255, g/255, b/255) end
function Color3.__tostring(c) return string.format("%.3f, %.3f, %.3f", c.R, c.G, c.B) end
api.Color3 = Color3

local Enum = {}
local function makeEnum(name, items)
	local e = {}
	for i, v in ipairs(items) do e[v] = { Name = v, Value = i - 1, EnumType = name } end
	return e
end
Enum.Material = makeEnum("Material", {"Plastic","Wood","Slate","Concrete","Neon","Metal","Glass"})
Enum.KeyCode  = makeEnum("KeyCode", {"Unknown","W","A","S","D","Space","E"})
api.Enum = Enum

local Instance = {}
Instance.__index = Instance
local registry = {}
function Instance.new(class, parent)
	local o = setmetatable({
		ClassName = class, Name = class, Parent = nil, Anchored = false, CanCollide = true,
		Size = Vector3.new(4,1,2), Position = Vector3.new(0,0,0), Color = Color3.new(0.6,0.6,0.6),
		Transparency = 0, Material = Enum.Material.Plastic, _children = {},
	}, Instance)
	table.insert(registry, o)
	if parent then o.Parent = parent; table.insert(parent._children, o) end
	return o
end
function Instance:FindFirstChild(n) for _, c in ipairs(self._children) do if c.Name == n then return c end end end
function Instance:GetChildren() return self._children end
function Instance:Clone() return Instance.new(self.ClassName, self.Parent) end
function Instance:Destroy() end
api.Instance = Instance

local workspace = Instance.new("Workspace")
api.workspace = workspace
api.game = Instance.new("DataModel")
workspace.Parent = api.game

api.__commit = function()
	for _, o in ipairs(registry) do
		if o.ClassName == "Part" and o.Parent then
			Host.draw(o.ClassName, o.Name, o.Position.X, o.Position.Y, o.Position.Z,
			          o.Size.X, o.Size.Y, o.Size.Z, o.Color.R, o.Color.G, o.Color.B)
		end
	end
end
return api
`;

// Host installs the returned globals (bypasses the readonly _G of sandbox mode)
const api = lua.execute(PRELUDE)[0];
for (const [k, v] of api.toMap()) lua.globals.set(k, v);
console.log('globals installed:', [...api.toMap().keys()].join(', '));

const USER = `
local base = Instance.new("Part", workspace)
base.Name = "Baseplate"
base.Size = Vector3.new(512, 20, 512)
base.Anchored = true
base.Color = Color3.fromRGB(40, 200, 90)

for i = 1, 5 do
	local p = Instance.new("Part", workspace)
	p.Name = "Block" .. i
	p.Position = base.Position + Vector3.new(i * 12, 20, 0)
	p.Color = Color3.new(i / 5, 0.3, 1 - i / 5)
	p.Material = Enum.Material.Neon
	print(\`made {p.Name} at {p.Position} mag={math.floor(p.Position:Magnitude())}\`)
end
print("FindFirstChild -> " .. workspace:FindFirstChild("Block3").Name)
__commit()
return #workspace:GetChildren()
`;
console.log('\nuser script returned:', lua.execute(USER));
console.log('\nCONSOLE OUTPUT:'); out.forEach(l => console.log('  ', l));
console.log('\nRENDER QUEUE (' + drawn.length + ' objects):');
drawn.forEach(d => console.log('  ', JSON.stringify(d)));
