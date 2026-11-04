--!nonstrict
--[[
	CodeForge Roblox API prelude — milestone M2.

	This module RETURNS its global surface. The host installs each entry with
	`lua.globals.set()`, because Luau's sandbox makes `_G` readonly — writing to
	it from inside a script fails with "attempt to modify a readonly table".

	Scope for M2: value types, the Instance tree, signals, and core globals.
	No rendering (M3), no scheduler/services loops (M5). Anything outside this
	scope raises a NAMED error instead of silently returning nil, so a user is
	told what is missing rather than debugging a mystery nil.
]]

local M = {}

local VERSION = "M2"

local function notYet(name)
	error(name .. " is not available in the CodeForge simulator yet (arrives in M5)", 3)
end

----------------------------------------------------------------
-- typeof
----------------------------------------------------------------
-- Roblox reports its own type names. Luau's typeof() says "table" for all of
-- them, so we look for a marker before falling back to the real typeof.
local nativeTypeof = typeof

local function rbxTypeof(value)
	if nativeTypeof(value) == "table" then
		local mt = getmetatable(value)
		if nativeTypeof(mt) == "table" and mt.__rbxType then
			return mt.__rbxType
		end
	end
	return nativeTypeof(value)
end

M.typeof = rbxTypeof

----------------------------------------------------------------
-- Signals
----------------------------------------------------------------
local Signal = {}
Signal.__index = Signal
Signal.__rbxType = "RBXScriptSignal"

function Signal.new()
	return setmetatable({ _handlers = {} }, Signal)
end

function Signal:Connect(handler)
	if nativeTypeof(handler) ~= "function" then
		error("Signal:Connect expects a function", 2)
	end
	local connection
	connection = setmetatable({
		Connected = true,
		_fire = handler,
	}, {
		__index = {
			Disconnect = function(self)
				self.Connected = false
			end,
		},
	})
	table.insert(self._handlers, connection)
	return connection
end

Signal.connect = Signal.Connect

function Signal:Once(handler)
	local connection
	connection = self:Connect(function(...)
		if connection then
			connection:Disconnect()
		end
		handler(...)
	end)
	return connection
end

function Signal:Wait()
	notYet("Signal:Wait")
end

function Signal:Fire(...)
	-- Copy first: a handler may disconnect itself while firing.
	for _, connection in ipairs(table.clone(self._handlers)) do
		if connection.Connected then
			connection._fire(...)
		end
	end
end

M.Signal = Signal

----------------------------------------------------------------
-- Vector2
----------------------------------------------------------------
local Vector2 = {}
Vector2.__index = Vector2
Vector2.__rbxType = "Vector2"

function Vector2.new(x, y)
	return setmetatable({ X = x or 0, Y = y or 0 }, Vector2)
end

function Vector2.__add(a, b) return Vector2.new(a.X + b.X, a.Y + b.Y) end
function Vector2.__sub(a, b) return Vector2.new(a.X - b.X, a.Y - b.Y) end
function Vector2.__unm(a) return Vector2.new(-a.X, -a.Y) end

function Vector2.__mul(a, b)
	if nativeTypeof(a) == "number" then return Vector2.new(a * b.X, a * b.Y) end
	if nativeTypeof(b) == "number" then return Vector2.new(a.X * b, a.Y * b) end
	return Vector2.new(a.X * b.X, a.Y * b.Y)
end

function Vector2.__div(a, b)
	if nativeTypeof(b) == "number" then return Vector2.new(a.X / b, a.Y / b) end
	return Vector2.new(a.X / b.X, a.Y / b.Y)
end

function Vector2.__eq(a, b) return a.X == b.X and a.Y == b.Y end
function Vector2.__tostring(a) return string.format("%g, %g", a.X, a.Y) end

function Vector2:Magnitude() return math.sqrt(self.X ^ 2 + self.Y ^ 2) end
function Vector2:Dot(o) return self.X * o.X + self.Y * o.Y end

Vector2.zero = Vector2.new(0, 0)
Vector2.one = Vector2.new(1, 1)
M.Vector2 = Vector2

----------------------------------------------------------------
-- Vector3
----------------------------------------------------------------
local Vector3 = {}
Vector3.__index = Vector3
Vector3.__rbxType = "Vector3"

function Vector3.new(x, y, z)
	return setmetatable({ X = x or 0, Y = y or 0, Z = z or 0 }, Vector3)
end

function Vector3.__add(a, b) return Vector3.new(a.X + b.X, a.Y + b.Y, a.Z + b.Z) end
function Vector3.__sub(a, b) return Vector3.new(a.X - b.X, a.Y - b.Y, a.Z - b.Z) end
function Vector3.__unm(a) return Vector3.new(-a.X, -a.Y, -a.Z) end

function Vector3.__mul(a, b)
	if nativeTypeof(a) == "number" then return Vector3.new(a * b.X, a * b.Y, a * b.Z) end
	if nativeTypeof(b) == "number" then return Vector3.new(a.X * b, a.Y * b, a.Z * b) end
	if getmetatable(b) == Vector3 then return Vector3.new(a.X * b.X, a.Y * b.Y, a.Z * b.Z) end
	error("invalid operand to Vector3 *", 2)
end

function Vector3.__div(a, b)
	if nativeTypeof(b) == "number" then return Vector3.new(a.X / b, a.Y / b, a.Z / b) end
	if getmetatable(b) == Vector3 then return Vector3.new(a.X / b.X, a.Y / b.Y, a.Z / b.Z) end
	error("invalid operand to Vector3 /", 2)
end

function Vector3.__eq(a, b) return a.X == b.X and a.Y == b.Y and a.Z == b.Z end

function Vector3.__lt(a, b)
	return a.X < b.X and a.Y < b.Y and a.Z < b.Z
end

function Vector3.__le(a, b)
	return a.X <= b.X and a.Y <= b.Y and a.Z <= b.Z
end

function Vector3.__tostring(a)
	return string.format("%g, %g, %g", a.X, a.Y, a.Z)
end

function Vector3:Magnitude() return math.sqrt(self.X ^ 2 + self.Y ^ 2 + self.Z ^ 2) end
Vector3.magnitude = Vector3.Magnitude

function Vector3:Dot(o) return self.X * o.X + self.Y * o.Y + self.Z * o.Z end

function Vector3:Cross(o)
	return Vector3.new(
		self.Y * o.Z - self.Z * o.Y,
		self.Z * o.X - self.X * o.Z,
		self.X * o.Y - self.Y * o.X
	)
end

function Vector3:Unit()
	local m = self:Magnitude()
	if m == 0 then
		error("Cannot unitize a zero-length Vector3", 2)
	end
	return Vector3.new(self.X / m, self.Y / m, self.Z / m)
end

function Vector3:Lerp(goal, alpha)
	return Vector3.new(
		self.X + (goal.X - self.X) * alpha,
		self.Y + (goal.Y - self.Y) * alpha,
		self.Z + (goal.Z - self.Z) * alpha
	)
end

function Vector3:Abs() return Vector3.new(math.abs(self.X), math.abs(self.Y), math.abs(self.Z)) end
function Vector3:Floor() return Vector3.new(math.floor(self.X), math.floor(self.Y), math.floor(self.Z)) end
function Vector3:Ceil() return Vector3.new(math.ceil(self.X), math.ceil(self.Y), math.ceil(self.Z)) end

function Vector3:Min(o) return Vector3.new(math.min(self.X, o.X), math.min(self.Y, o.Y), math.min(self.Z, o.Z)) end
function Vector3:Max(o) return Vector3.new(math.max(self.X, o.X), math.max(self.Y, o.Y), math.max(self.Z, o.Z)) end

function Vector3:FuzzyEq(o, epsilon)
	local e = epsilon or 1e-5
	return math.abs(self.X - o.X) <= e and math.abs(self.Y - o.Y) <= e and math.abs(self.Z - o.Z) <= e
end

function Vector3:Angle(o, axis)
	local dot = math.clamp(self:Unit():Dot(o:Unit()), -1, 1)
	local angle = math.acos(dot)
	if axis then
		if self:Cross(o):Dot(axis) < 0 then
			angle = -angle
		end
	end
	return angle
end

function Vector3.AngleBetween(a, b) return a:Angle(b) end

Vector3.zero = Vector3.new(0, 0, 0)
Vector3.one = Vector3.new(1, 1, 1)
Vector3.xAxis = Vector3.new(1, 0, 0)
Vector3.yAxis = Vector3.new(0, 1, 0)
Vector3.zAxis = Vector3.new(0, 0, 1)
M.Vector3 = Vector3

----------------------------------------------------------------
-- CFrame
----------------------------------------------------------------
-- Stored as position + a 3x3 rotation matrix (row-major, like Roblox's R00..R22).
local CFrame = {}
CFrame.__index = CFrame
CFrame.__rbxType = "CFrame"

local function identityMatrix()
	return 1, 0, 0, 0, 1, 0, 0, 0, 1
end

function CFrame.new(...)
	local args = { ... }
	local n = select("#", ...)
	local pos = Vector3.zero
	local m = { identityMatrix() }

	if n == 0 then
		-- identity
	elseif n == 1 and getmetatable(args[1]) == Vector3 then
		pos = args[1]
	elseif n == 3 then
		pos = Vector3.new(args[1], args[2], args[3])
	elseif n == 12 then
		pos = Vector3.new(args[1], args[2], args[3])
		m = table.move(args, 4, 12, 1, {})
	else
		error("CFrame.new received an unsupported argument count: " .. n, 2)
	end

	return setmetatable({
		Position = pos,
		X = pos.X, Y = pos.Y, Z = pos.Z,
		R00 = m[1], R01 = m[2], R02 = m[3],
		R10 = m[4], R11 = m[5], R12 = m[6],
		R20 = m[7], R21 = m[8], R22 = m[9],
	}, CFrame)
end

function CFrame.identity() return CFrame.new() end

function CFrame.fromMatrix(pos, vX, vY, vZ)
	return setmetatable({
		Position = pos,
		X = pos.X, Y = pos.Y, Z = pos.Z,
		R00 = vX.X, R01 = vX.Y, R02 = vX.Z,
		R10 = vY.X, R11 = vY.Y, R12 = vY.Z,
		R20 = vZ.X, R21 = vZ.Y, R22 = vZ.Z,
	}, CFrame)
end

function CFrame.lookAt(at, target, up)
	local zAxis = (at - target).Unit
	local xAxis = (up or Vector3.yAxis):Cross(zAxis)
	if xAxis.Magnitude < 1e-6 then
		xAxis = Vector3.xAxis
	end
	xAxis = xAxis.Unit
	local yAxis = zAxis:Cross(xAxis)
	return CFrame.fromMatrix(at, xAxis, yAxis, zAxis)
end

CFrame.lookAt = CFrame.lookAt
CFrame.LookAt = CFrame.lookAt

function CFrame.fromEulerAnglesXYZ(rx, ry, rz)
	local cx, sx = math.cos(rx), math.sin(rx)
	local cy, sy = math.cos(ry), math.sin(ry)
	local cz, sz = math.cos(rz), math.sin(rz)
	return setmetatable({
		Position = Vector3.zero,
		X = 0, Y = 0, Z = 0,
		R00 = cy * cz, R01 = -cy * sz, R02 = sy,
		R10 = cx * sz + sx * sy * cz, R11 = cx * cz - sx * sy * sz, R12 = -sx * cy,
		R20 = sx * sz - cx * sy * cz, R21 = sx * cz + cx * sy * sz, R22 = cx * cy,
	}, CFrame)
end

CFrame.Angles = CFrame.fromEulerAnglesXYZ
CFrame.fromOrientation = CFrame.fromEulerAnglesXYZ

function CFrame.__tostring(cf)
	return string.format(
		"%g, %g, %g, %g, %g, %g, %g, %g, %g, %g, %g, %g",
		cf.X, cf.Y, cf.Z,
		cf.R00, cf.R01, cf.R02,
		cf.R10, cf.R11, cf.R12,
		cf.R20, cf.R21, cf.R22
	)
end

function CFrame.__eq(a, b)
	return a.Position == b.Position
		and a.R00 == b.R00 and a.R01 == b.R01 and a.R02 == b.R02
		and a.R10 == b.R10 and a.R11 == b.R11 and a.R12 == b.R12
		and a.R20 == b.R20 and a.R21 == b.R21 and a.R22 == b.R22
end

function CFrame.__mul(a, b)
	if getmetatable(b) == Vector3 then
		return a:PointToWorldSpace(b)
	end
	if nativeTypeof(b) == "number" then
		return CFrame.new(a.Position * b)
	end
	-- CFrame * CFrame: rotate then translate.
	local pos = a:PointToWorldSpace(b.Position)
	return setmetatable({
		Position = pos,
		X = pos.X, Y = pos.Y, Z = pos.Z,
		R00 = a.R00 * b.R00 + a.R01 * b.R10 + a.R02 * b.R20,
		R01 = a.R00 * b.R01 + a.R01 * b.R11 + a.R02 * b.R21,
		R02 = a.R00 * b.R02 + a.R01 * b.R12 + a.R02 * b.R22,
		R10 = a.R10 * b.R00 + a.R11 * b.R10 + a.R12 * b.R20,
		R11 = a.R10 * b.R01 + a.R11 * b.R11 + a.R12 * b.R21,
		R12 = a.R10 * b.R02 + a.R11 * b.R12 + a.R12 * b.R22,
		R20 = a.R20 * b.R00 + a.R21 * b.R10 + a.R22 * b.R20,
		R21 = a.R20 * b.R01 + a.R21 * b.R11 + a.R22 * b.R21,
		R22 = a.R20 * b.R02 + a.R21 * b.R12 + a.R22 * b.R22,
	}, CFrame)
end

function CFrame.__add(a, b)
	if getmetatable(b) == Vector3 then
		return CFrame.new(a.Position + b)
	end
	error("invalid operand to CFrame +", 2)
end

function CFrame.__sub(a, b)
	if getmetatable(b) == Vector3 then
		return CFrame.new(a.Position - b)
	end
	error("invalid operand to CFrame -", 2)
end

function CFrame:PointToWorldSpace(v)
	return Vector3.new(
		self.R00 * v.X + self.R01 * v.Y + self.R02 * v.Z + self.X,
		self.R10 * v.X + self.R11 * v.Y + self.R12 * v.Z + self.Y,
		self.R20 * v.X + self.R21 * v.Y + self.R22 * v.Z + self.Z
	)
end

function CFrame:VectorToWorldSpace(v)
	return Vector3.new(
		self.R00 * v.X + self.R01 * v.Y + self.R02 * v.Z,
		self.R10 * v.X + self.R11 * v.Y + self.R12 * v.Z,
		self.R20 * v.X + self.R21 * v.Y + self.R22 * v.Z
	)
end

function CFrame:Inverse()
	notYet("CFrame:Inverse")
end

function CFrame:Lerp(goal, alpha)
	return CFrame.new(self.Position:Lerp(goal.Position, alpha))
end

function CFrame:GetComponents()
	return self.X, self.Y, self.Z,
		self.R00, self.R01, self.R02,
		self.R10, self.R11, self.R12,
		self.R20, self.R21, self.R22
end

function CFrame.LookVector(self) return self:VectorToWorldSpace(Vector3.new(0, 0, -1)) end

CFrame.identity = setmetatable({
	Position = Vector3.zero,
	X = 0, Y = 0, Z = 0,
	R00 = 1, R01 = 0, R02 = 0,
	R10 = 0, R11 = 1, R12 = 0,
	R20 = 0, R21 = 0, R22 = 1,
}, CFrame)

M.CFrame = CFrame

----------------------------------------------------------------
-- Color3
----------------------------------------------------------------
local Color3 = {}
Color3.__index = Color3
Color3.__rbxType = "Color3"

function Color3.new(r, g, b)
	return setmetatable({
		R = math.clamp(r or 0, 0, 1),
		G = math.clamp(g or 0, 0, 1),
		B = math.clamp(b or 0, 0, 1),
	}, Color3)
end

function Color3.fromRGB(r, g, b)
	return Color3.new((r or 0) / 255, (g or 0) / 255, (b or 0) / 255)
end

function Color3.fromHex(hex)
	local h = tostring(hex):gsub("#", "")
	if #h ~= 6 then
		error("Color3.fromHex expects a 6 character hex string", 2)
	end
	return Color3.fromRGB(
		tonumber(h:sub(1, 2), 16),
		tonumber(h:sub(3, 4), 16),
		tonumber(h:sub(5, 6), 16)
	)
end

function Color3.fromHSV(h, s, v)
	-- Standard HSV -> RGB.
	local i = math.floor(h * 6)
	local f = h * 6 - i
	local p = v * (1 - s)
	local q = v * (1 - f * s)
	local t = v * (1 - (1 - f) * s)
	i = i % 6
	if i == 0 then return Color3.new(v, t, p) end
	if i == 1 then return Color3.new(q, v, p) end
	if i == 2 then return Color3.new(p, v, t) end
	if i == 3 then return Color3.new(p, q, v) end
	if i == 4 then return Color3.new(t, p, v) end
	return Color3.new(v, p, q)
end

function Color3.toHSV(c)
	local max = math.max(c.R, c.G, c.B)
	local min = math.min(c.R, c.G, c.B)
	local d = max - min
	local h = 0
	if d ~= 0 then
		if max == c.R then
			h = ((c.G - c.B) / d) % 6
		elseif max == c.G then
			h = (c.B - c.R) / d + 2
		else
			h = (c.R - c.G) / d + 4
		end
		h = h / 6
	end
	local s = max == 0 and 0 or d / max
	return h, s, max
end

function Color3:ToHSV() return Color3.toHSV(self) end

function Color3:ToHex()
	return string.format("%02X%02X%02X",
		math.floor(self.R * 255 + 0.5),
		math.floor(self.G * 255 + 0.5),
		math.floor(self.B * 255 + 0.5))
end

function Color3:Lerp(goal, alpha)
	return Color3.new(
		self.R + (goal.R - self.R) * alpha,
		self.G + (goal.G - self.G) * alpha,
		self.B + (goal.B - self.B) * alpha
	)
end

function Color3.__add(a, b)
	return Color3.new(a.R + b.R, a.G + b.G, a.B + b.B)
end

function Color3.__mul(a, b)
	if nativeTypeof(a) == "number" then return Color3.new(a * b.R, a * b.G, a * b.B) end
	if nativeTypeof(b) == "number" then return Color3.new(a.R * b, a.G * b, a.B * b) end
	return Color3.new(a.R * b.R, a.G * b.G, a.B * b.B)
end

function Color3.__eq(a, b) return a.R == b.R and a.G == b.G and a.B == b.B end

function Color3.__tostring(c)
	return string.format("%.3f, %.3f, %.3f", c.R, c.G, c.B)
end

Color3.white = Color3.new(1, 1, 1)
Color3.black = Color3.new(0, 0, 0)
Color3.red = Color3.new(1, 0, 0)
Color3.green = Color3.new(0, 1, 0)
Color3.blue = Color3.new(0, 0, 1)
Color3.yellow = Color3.new(1, 1, 0)
M.Color3 = Color3

----------------------------------------------------------------
-- UDim / UDim2
----------------------------------------------------------------
local UDim = {}
UDim.__index = UDim
UDim.__rbxType = "UDim"

function UDim.new(scale, offset)
	return setmetatable({ Scale = scale or 0, Offset = offset or 0 }, UDim)
end

function UDim.fromScale(scale) return UDim.new(scale, 0) end
function UDim.fromOffset(offset) return UDim.new(0, offset) end
function UDim.__add(a, b) return UDim.new(a.Scale + b.Scale, a.Offset + b.Offset) end
function UDim.__sub(a, b) return UDim.new(a.Scale - b.Scale, a.Offset - b.Offset) end
function UDim.__eq(a, b) return a.Scale == b.Scale and a.Offset == b.Offset end
function UDim.__tostring(a) return string.format("{%g, %d}", a.Scale, a.Offset) end
M.UDim = UDim

local UDim2 = {}
UDim2.__index = UDim2
UDim2.__rbxType = "UDim2"

function UDim2.new(xs, xo, ys, yo)
	if nativeTypeof(xs) == "table" and getmetatable(xs) == UDim then
		return setmetatable({ X = xs, Y = nativeTypeof(xo) == "table" and xo or UDim.new(0, 0) }, UDim2)
	end
	return setmetatable({
		X = UDim.new(xs or 0, xo or 0),
		Y = UDim.new(ys or 0, yo or 0),
	}, UDim2)
end

function UDim2.fromScale(xs, ys) return UDim2.new(xs or 0, 0, ys or 0, 0) end
function UDim2.fromOffset(xo, yo) return UDim2.new(0, xo or 0, 0, yo or 0) end

function UDim2.__add(a, b) return UDim2.new(a.X + b.X, a.Y + b.Y) end
function UDim2.__sub(a, b) return UDim2.new(a.X - b.X, a.Y - b.Y) end

function UDim2.__eq(a, b)
	return a.X == b.X and a.Y == b.Y
end

function UDim2.__tostring(a)
	return string.format("{%g, %d}, {%g, %d}", a.X.Scale, a.X.Offset, a.Y.Scale, a.Y.Offset)
end

function UDim2:Lerp(goal, alpha)
	return UDim2.new(
		self.X.Scale + (goal.X.Scale - self.X.Scale) * alpha,
		self.X.Offset + (goal.X.Offset - self.X.Offset) * alpha,
		self.Y.Scale + (goal.Y.Scale - self.Y.Scale) * alpha,
		self.Y.Offset + (goal.Y.Offset - self.Y.Offset) * alpha
	)
end

UDim2.zero = UDim2.new(0, 0, 0, 0)
M.UDim2 = UDim2

----------------------------------------------------------------
-- Smaller value types
----------------------------------------------------------------
local Rect = {}
Rect.__index = Rect
Rect.__rbxType = "Rect"

function Rect.new(a, b, c, d)
	if getmetatable(a) == Vector2 then
		return setmetatable({ Min = a, Max = b }, Rect)
	end
	return setmetatable({ Min = Vector2.new(a or 0, b or 0), Max = Vector2.new(c or 0, d or 0) }, Rect)
end

function Rect.__eq(a, b) return a.Min == b.Min and a.Max == b.Max end
function Rect.__tostring(a) return string.format("%s, %s", tostring(a.Min), tostring(a.Max)) end
M.Rect = Rect

local NumberRange = {}
NumberRange.__index = NumberRange
NumberRange.__rbxType = "NumberRange"

function NumberRange.new(min, max)
	return setmetatable({ Min = min or 0, Max = max or min or 0 }, NumberRange)
end

function NumberRange.__eq(a, b) return a.Min == b.Min and a.Max == b.Max end
function NumberRange.__tostring(a) return string.format("%g, %g", a.Min, a.Max) end
M.NumberRange = NumberRange

local Region3 = {}
Region3.__index = Region3
Region3.__rbxType = "Region3"

function Region3.new(min, max)
	return setmetatable({ CFrame = CFrame.new((min + max) * 0.5), Size = max - min }, Region3)
end

function Region3:ExpandToGrid(resolution)
	local r = resolution or 4
	local half = self.Size * 0.5
	local snapped = Vector3.new(
		math.round(half.X / r) * r,
		math.round(half.Y / r) * r,
		math.round(half.Z / r) * r
	)
	return Region3.new(self.CFrame.Position - snapped, self.CFrame.Position + snapped)
end
M.Region3 = Region3

local Ray = {}
Ray.__index = Ray
Ray.__rbxType = "Ray"

function Ray.new(origin, direction)
	return setmetatable({ Origin = origin, Direction = direction }, Ray)
end

function Ray:Unit() return Ray.new(self.Origin, self.Direction.Unit) end
function Ray:ClosestPoint(point)
	local t = math.clamp((point - self.Origin):Dot(self.Direction) / self.Direction.Magnitude ^ 2, 0, 1)
	return self.Origin + self.Direction * t
end
function Ray:Distance(point) return (self:ClosestPoint(point) - point).Magnitude end
function Ray.__tostring(r) return string.format("Origin: %s, Direction: %s", tostring(r.Origin), tostring(r.Direction)) end
M.Ray = Ray

local BrickColor = {}
BrickColor.__index = BrickColor
BrickColor.__rbxType = "BrickColor"

local PALETTE = {
	White = Color3.new(0.97, 0.97, 0.97),
	Black = Color3.new(0.1, 0.1, 0.1),
	["Really red"] = Color3.new(1, 0, 0),
	["Really blue"] = Color3.new(0, 0, 1),
	["Bright green"] = Color3.new(0, 0.6, 0.2),
	["Bright yellow"] = Color3.new(1, 0.85, 0),
	["Medium stone grey"] = Color3.new(0.63, 0.65, 0.65),
}

function BrickColor.new(name)
	local color = PALETTE[name] or Color3.new(0.63, 0.65, 0.65)
	return setmetatable({ Name = name, Color = color, r = color.R * 255, g = color.G * 255, b = color.B * 255 }, BrickColor)
end

function BrickColor.random() return BrickColor.new("Medium stone grey") end
function BrickColor.__tostring(b) return b.Name end
M.BrickColor = BrickColor

local Random = {}
Random.__index = Random
Random.__rbxType = "Random"

function Random.new(seed)
	local self = setmetatable({ _seed = seed or math.random(1, 2 ^ 31) }, Random)
	return self
end

function Random:NextNumber(a, b)
	if a == nil then return math.random() end
	if b == nil then return math.random() * a end
	return a + math.random() * (b - a)
end

function Random:NextInteger(a, b)
	if b == nil then return math.random(1, a) end
	return math.random(a, b)
end

function Random:NextBoolean() return math.random() < 0.5 end
M.Random = Random

----------------------------------------------------------------
-- Enum
----------------------------------------------------------------
local function makeEnum(typeName, items)
	local enum = {}
	for i, name in ipairs(items) do
		enum[name] = { Name = name, Value = i - 1, EnumType = typeName }
	end
	return enum
end

M.Enum = {
	Material = makeEnum("Material", {
		"Plastic", "Wood", "Slate", "Concrete", "CorrodedMetal", "DiamondPlate",
		"Foil", "Grass", "Ice", "Marble", "Granite", "Brick", "Pebble", "Sand",
		"Fabric", "SmoothPlastic", "Metal", "WoodPlanks", "Cobblestone", "Neon",
		"Glass", "Asphalt", "LeafyGrass", "Sandstone", "Mud", "Rock", "Glacier",
	}),
	AnchorId = makeEnum("AnchorId", { "Top", "Bottom", "Left", "Right", "Center" }),
	Size = makeEnum("Size", { "All", "X", "Y", "Z" }),
	Orientation = makeEnum("Orientation", { "Z", "X", "Y" }),
	NormalId = makeEnum("NormalId", { "Top", "Bottom", "Back", "Front", "Right", "Left" }),
	Axis = makeEnum("Axis", { "X", "Y", "Z" }),
	ConnectionState = makeEnum("ConnectionState", { "Connected", "Disconnected" }),
	EasingStyle = makeEnum("EasingStyle", {
		"Linear", "Sine", "Back", "Quad", "Quart", "Quint", "Bounce", "Elastic",
		"Exponential", "Circular", "Cubic",
	}),
	EasingDirection = makeEnum("EasingDirection", { "In", "Out", "InOut" }),
	TextXAlignment = makeEnum("TextXAlignment", { "Left", "Center", "Right" }),
	TextYAlignment = makeEnum("TextYAlignment", { "Top", "Center", "Bottom" }),
	Font = makeEnum("Font", { "Legacy", "Arial", "ArialBold", "SourceSans", "SourceSansBold", "Gotham", "GothamBold", "Code" }),
	KeyCode = makeEnum("KeyCode", {
		"Unknown", "Backspace", "Tab", "Return", "Escape", "Space",
		"Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
		"A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
		"N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
		"LeftShift", "RightShift", "LeftControl", "RightControl",
		"Up", "Down", "Left", "Right",
	}),
	RunContext = makeEnum("RunContext", { "Legacy", "Server", "Client" }),
	HttpContentType = makeEnum("HttpContentType", { "ApplicationJson", "ApplicationXml", "TextPlain", "TextXml" }),
}

----------------------------------------------------------------
-- Instances
----------------------------------------------------------------
-- Default properties per class. Anything a script reads that is not modelled
-- returns nil rather than a fabricated value, which matches "unknown property"
-- closely enough while staying debuggable.
local CLASS_DEFAULTS = {
	Part = {
		Anchored = false, CanCollide = true, CanTouch = true, CanQuery = true,
		Size = nil, Color = nil, Transparency = 0, Reflectance = 0,
		Massless = false, Locked = false, CastShadow = true,
	},
	MeshPart = { Anchored = false, CanCollide = true, Transparency = 0, MeshId = "", TextureID = "" },
	WedgePart = { Anchored = false, CanCollide = true, Transparency = 0 },
	CornerWedgePart = { Anchored = false, CanCollide = true, Transparency = 0 },
	TrussPart = { Anchored = false, CanCollide = true },
	Folder = {},
	Model = {},
	ScreenGui = { Enabled = true, ResetOnSpawn = true, ZIndexBehavior = nil, DisplayOrder = 0 },
	Frame = { Visible = true, Active = false, ZIndex = 1, BackgroundTransparency = 0, BorderSizePixel = 1 },
	TextLabel = { Visible = true, Text = "Label", TextSize = 14, ZIndex = 1 },
	TextButton = { Visible = true, Text = "Button", TextSize = 14, ZIndex = 1, AutoButtonColor = true },
	TextBox = { Visible = true, Text = "", TextSize = 14, ZIndex = 1, ClearTextOnFocus = true },
	ImageLabel = { Visible = true, Image = "", ZIndex = 1 },
	ImageButton = { Visible = true, Image = "", ZIndex = 1 },
	ViewportFrame = { Visible = true, ZIndex = 1 },
	ScrollingFrame = { Visible = true, ZIndex = 1, CanvasSize = nil },
	UIListLayout = { SortOrder = nil, Padding = nil, FillDirection = nil, HorizontalAlignment = nil, VerticalAlignment = nil },
	UIGridLayout = { CellSize = nil, CellPadding = nil },
	UICorner = { CornerRadius = nil },
	UIPadding = {},
	LocalScript = { Enabled = true, RunContext = nil },
	Script = { Enabled = true, RunContext = nil },
	ModuleScript = {},
	StringValue = { Value = "" },
	IntValue = { Value = 0 },
	NumberValue = { Value = 0 },
	BoolValue = { Value = false },
	ObjectValue = { Value = nil },
	Color3Value = {},
	Vector3Value = {},
	CFrameValue = {},
	Camera = { CameraType = nil, FieldOfView = 70 },
	SpawnLocation = { Anchored = true, CanCollide = true },
	PointLight = { Enabled = true, Brightness = 1, Range = 16 },
	SpotLight = { Enabled = true, Brightness = 1, Range = 16, Angle = 90 },
	SurfaceLight = { Enabled = true, Brightness = 1, Range = 16 },
	ParticleEmitter = { Enabled = true, Rate = 20, Texture = "" },
	Sound = { Playing = false, Volume = 0.5, Looped = false, SoundId = "" },
	ClickDetector = { CursorIcon = "", MaxActivationDistance = 32 },
	BodyVelocity = { MaxForce = nil, Velocity = nil, P = 1250 },
	BodyForce = { Force = nil },
	BodyGyro = { MaxTorque = nil, CFrame = nil, P = 3000 },
	BodyAngularVelocity = { MaxTorque = nil, AngularVelocity = nil },
	VectorForce = { Force = nil, ApplyAtCenterOfMass = true },
	AlignPosition = { MaxForce = 10000 },
	Attachment = {},
	Configuration = {},
	ProximityPrompt = { ActionText = "Interact", ObjectText = "", MaxActivationDistance = 10, Enabled = true },
	Tool = { Grip = nil, RequiresHandle = true },
	HandlePart = { Anchored = false },
}

-- Properties that are computed rather than stored.
local COMPUTED = {
	Size = function() return Vector3.new(4, 1, 2) end,
	Color = function() return Color3.new(0.63, 0.65, 0.65) end,
	CFrame = function(inst) return CFrame.new(inst.Position) end,
	Position = function() return Vector3.zero end,
	BrickColor = function(inst) return BrickColor.new("Medium stone grey") end,
	Padding = function() return UDim.new(0, 0) end,
	CornerRadius = function() return UDim.new(0, 8) end,
	CellSize = function() return UDim2.fromOffset(100, 100) end,
	CellPadding = function() return UDim2.fromOffset(4, 4) end,
	MaxForce = function() return Vector3.new(0, 0, 0) end,
	MaxTorque = function() return Vector3.new(0, 0, 0) end,
	Velocity = function() return Vector3.zero end,
	Force = function() return Vector3.zero end,
	AngularVelocity = function() return Vector3.zero end,
	BackgroundColor3 = function() return Color3.new(1, 1, 1) end,
	TextColor3 = function() return Color3.new(0, 0, 0) end,
	AbsoluteSize = function() return Vector2.zero end,
	AbsolutePosition = function() return Vector2.zero end,
	ContentSize = function() return Vector2.zero end,
}

local Instance = {}
Instance.__index = Instance
Instance.__rbxType = "Instance"

-- Every live instance, so the host can walk the scene graph.
local registry = {}
local nextInstanceId = 0

local function isInstance(value)
	return nativeTypeof(value) == "table" and getmetatable(value) == Instance
end

M.isInstance = isInstance

local function defaultsFor(className)
	return CLASS_DEFAULTS[className] or {}
end

local function setParent(inst, parent)
	if parent ~= nil and not isInstance(parent) then
		error("Instance.Parent must be an Instance or nil", 3)
	end
	if inst.Parent == parent then
		return
	end
	-- Guard against reparenting into own descendants, which would cycle the tree.
	if parent ~= nil then
		local walk = parent
		while walk ~= nil do
			if walk == inst then
				error("Attempt to set parent of " .. inst.Name .. " to its own descendant", 3)
			end
			walk = walk.Parent
		end
	end

	local previous = inst.Parent
	if previous ~= nil then
		for i, child in ipairs(previous._children) do
			if child == inst then
				table.remove(previous._children, i)
				break
			end
		end
	end

	-- Stored in _properties, NOT rawset: a rawset key makes __newindex stop
	-- firing, which would silently disable the cycle guard on later reparents.
	inst._properties.Parent = parent

	if parent ~= nil then
		table.insert(parent._children, inst)
	end

	inst._ancestryChanged:Fire(inst, parent)
	if previous ~= nil then
		previous._childRemoved:Fire(inst)
	end
	if parent ~= nil then
		parent._childAdded:Fire(inst)
	end
end

function Instance.new(className, parent)
	if nativeTypeof(className) ~= "string" then
		error("Instance.new expects a class name string", 2)
	end

	local defaults = defaultsFor(className)
	nextInstanceId += 1

	local inst = setmetatable({
		ClassName = className,
		Name = className,
		_children = {},
		_changed = Signal.new(),
		_ancestryChanged = Signal.new(),
		_childAdded = Signal.new(),
		_childRemoved = Signal.new(),
		_properties = {},
		_destroyed = false,
		_id = nextInstanceId,
	}, Instance)

	-- Seed class defaults, evaluating lazily-computed ones on demand.
	for name, value in pairs(defaults) do
		if value ~= nil then
			inst._properties[name] = value
		end
	end

	if parent ~= nil then
		setParent(inst, parent)
	end

	table.insert(registry, inst)
	return inst
end

function Instance:FindFirstChild(name, recursive)
	for _, child in ipairs(self._children) do
		if child.Name == name then
			return child
		end
	end
	if recursive then
		for _, child in ipairs(self._children) do
			local found = child:FindFirstChild(name, true)
			if found ~= nil then
				return found
			end
		end
	end
	return nil
end

function Instance:FindFirstChildOfClass(className)
	for _, child in ipairs(self._children) do
		if child.ClassName == className then
			return child
		end
	end
	return nil
end

function Instance:FindFirstChildWhichIsA(className)
	for _, child in ipairs(self._children) do
		if child:IsA(className) then
			return child
		end
	end
	return nil
end

function Instance:WaitForChild(name, timeout)
	-- No scheduler in M2: return what exists, otherwise fail loudly rather than
	-- hanging forever, which is worse than an error while learning.
	local found = self:FindFirstChild(name)
	if found ~= nil then
		return found
	end
	if timeout then
		return nil
	end
	error('Infinite yield possible on "' .. self:GetFullName() .. ':WaitForChild(' .. name .. ')" — WaitForChild needs the scheduler, which arrives in M5', 2)
end

function Instance:GetChildren()
	return table.clone(self._children)
end

function Instance:GetDescendants()
	local out = {}
	local function walk(inst)
		for _, child in ipairs(inst._children) do
			table.insert(out, child)
			walk(child)
		end
	end
	walk(self)
	return out
end

function Instance:GetFullName()
	local parts = {}
	local walk = self
	while walk ~= nil do
		table.insert(parts, 1, walk.Name)
		walk = walk.Parent
	end
	return table.concat(parts, ".")
end

function Instance:IsA(className)
	if self.ClassName == className then
		return true
	end
	-- A short, explicit ancestry chain covers the classes the simulator ships.
	local ancestors = {
		BasePart = { Part = true, MeshPart = true, WedgePart = true, CornerWedgePart = true, TrussPart = true, SpawnLocation = true, HandlePart = true },
		GuiObject = { Frame = true, TextLabel = true, TextButton = true, TextBox = true, ImageLabel = true, ImageButton = true, ViewportFrame = true, ScrollingFrame = true },
		GuiButton = { TextButton = true, ImageButton = true },
		GuiBase2d = { ScreenGui = true, Frame = true, TextLabel = true, TextButton = true, TextBox = true, ImageLabel = true, ImageButton = true, ViewportFrame = true, ScrollingFrame = true },
		LayerCollector = { ScreenGui = true },
		Instance = true,
		PVInstance = { Part = true, MeshPart = true, WedgePart = true, Model = true, Camera = true },
		Light = { PointLight = true, SpotLight = true, SurfaceLight = true },
		DynamicRotate = {},
		ValueBase = { StringValue = true, IntValue = true, NumberValue = true, BoolValue = true, ObjectValue = true, Color3Value = true, Vector3Value = true, CFrameValue = true },
		LuaSourceContainer = { LocalScript = true, Script = true, ModuleScript = true },
		BodyMover = { BodyVelocity = true, BodyForce = true, BodyGyro = true, BodyAngularVelocity = true },
		UIBase = { UIListLayout = true, UIGridLayout = true, UICorner = true, UIPadding = true },
	}

	local group = ancestors[className]
	if group == nil then
		return false
	end
	if group == true then
		return true
	end
	return group[self.ClassName] == true
end

function Instance:Clone()
	if self._destroyed then
		error("Cannot clone a destroyed Instance", 2)
	end
	local copy = Instance.new(self.ClassName, nil)
	copy.Name = self.Name
	for name, value in pairs(self._properties) do
		-- Parent must NOT be copied: the clone is not in the original parent's
		-- child list, so copying it would desync the tree and make a later
		-- `copy.Parent = workspace` a no-op.
		if name ~= "Parent" then
			copy._properties[name] = value
		end
	end
	for _, child in ipairs(self._children) do
		child:Clone().Parent = copy
	end
	return copy
end

function Instance:Destroy()
	if self._destroyed then
		return
	end
	for _, child in ipairs(table.clone(self._children)) do
		child:Destroy()
	end
	setParent(self, nil)
	self._destroyed = true
	for i, entry in ipairs(registry) do
		if entry == self then
			table.remove(registry, i)
			break
		end
	end
end

function Instance:ClearAllChildren()
	for _, child in ipairs(table.clone(self._children)) do
		child:Destroy()
	end
end

function Instance:GetPropertyChangedSignal(property)
	local key = "_prop_" .. tostring(property)
	if self[key] == nil then
		rawset(self, key, Signal.new())
	end
	return self[key]
end

Instance.Changed = nil -- installed per instance below

function Instance:GetAttribute(name)
	return self._attributes and self._attributes[name]
end

function Instance:SetAttribute(name, value)
	if self._attributes == nil then
		rawset(self, "_attributes", {})
	end
	self._attributes[name] = value
end

function Instance:GetAttributes()
	return table.clone(self._attributes or {})
end

-- Events that are lazily created per instance. Touched/TouchEnded are real
-- signals fired by the physics bridge; creating them on first access means a
-- script that connects costs one table, and one that never connects costs none.
local SHADOWED_SIGNALS = { Touched = true, TouchEnded = true }

-- Property access. Reads fall back to computed defaults; writes fire .Changed.
Instance.__index = function(self, key)
	if SHADOWED_SIGNALS[key] then
		local slot = "_signal_" .. key
		local signal = self[slot]
		if signal == nil then
			signal = Signal.new()
			rawset(self, slot, signal)
		end
		return signal
	end
	if key == "Changed" then
		return self._changed
	end
	if key == "AncestryChanged" then
		return self._ancestryChanged
	end
	if key == "ChildAdded" then
		return self._childAdded
	end
	if key == "ChildRemoved" then
		return self._childRemoved
	end
	local stored = self._properties[key]
	if stored ~= nil then
		return stored
	end

	local computed = COMPUTED[key]
	if computed ~= nil then
		return computed(self)
	end

	-- Methods live on the metatable chain. rawget is essential: indexing
	-- `Instance` normally re-enters this very function and overflows the stack.
	local method = rawget(Instance, key)
	if method ~= nil then
		return method
	end

	return nil
end

Instance.__newindex = function(self, key, value)
	if key == "Parent" then
		setParent(self, value)
		return
	end
	if key == "Name" or key == "ClassName" or key == "_children" or key == "_properties" or key == "_id" or key == "_destroyed" then
		rawset(self, key, value)
		return
	end
	self._properties[key] = value
	self._changed:Fire(key)
end

Instance.__tostring = function(self)
	return self.Name
end

M.Instance = Instance
M.getRegistry = function() return registry end

----------------------------------------------------------------
-- Services and the DataModel
----------------------------------------------------------------
local game = Instance.new("DataModel")
game.Name = "Game"

local function service(className, name)
	local inst = Instance.new(className, game)
	inst.Name = name or className
	return inst
end

local workspace = Instance.new("Workspace", game)
workspace.Name = "Workspace"

local services = {
	Workspace = workspace,
	ReplicatedStorage = service("ReplicatedStorage"),
	ReplicatedFirst = service("ReplicatedFirst"),
	ServerStorage = service("ServerStorage"),
	ServerScriptService = service("ServerScriptService"),
	StarterPlayer = service("StarterPlayer"),
	StarterGui = service("StarterGui"),
	StarterPack = service("StarterPack"),
	Players = service("Players"),
	Lighting = service("Lighting"),
	SoundService = service("SoundService"),
	TextChatService = service("TextChatService"),
	Debris = service("Debris"),
	RunService = service("RunService"),
	TweenService = service("TweenService"),
	UserInputService = service("UserInputService"),
	ContextActionService = service("ContextActionService"),
	HttpService = service("HttpService"),
	Workspace_ = nil,
}

-- Lighting defaults that the M3 renderer will read.
local lighting = services.Lighting
lighting._properties.Ambient = Color3.fromRGB(0, 0, 0)
lighting._properties.Brightness = 3
lighting._properties.ClockTime = 14
lighting._properties.FogEnd = 1e6
lighting._properties.FogStart = 0
lighting._properties.FogColor = Color3.fromRGB(191, 191, 191)
lighting._properties.GlobalShadows = true
lighting._properties.OutdoorAmbient = Color3.fromRGB(128, 128, 128)

local function getService(name)
	local found = services[name]
	if found ~= nil then
		return found
	end
	-- Unknown service: create a plain container so scripts do not hard-fail on
	-- services the simulator has not modelled yet.
	local created = service("Folder")
	created.Name = name
	services[name] = created
	return created
end

function game:GetService(name)
	return getService(name)
end

function game:GetDescendants()
	return Instance.GetDescendants(game)
end

M.game = game
M.workspace = workspace
M.GetService = getService

-- Convenience globals matching Roblox's service shortcuts.
M.Lighting = lighting
M.ReplicatedStorage = services.ReplicatedStorage
M.ServerStorage = services.ServerStorage
M.ServerScriptService = services.ServerScriptService
M.Players = services.Players
M.Debris = services.Debris
M.TweenService = services.TweenService
M.RunService = services.RunService
M.UserInputService = services.UserInputService

----------------------------------------------------------------
-- Global functions
----------------------------------------------------------------
M.print = print

-- `warn` does not exist in this Luau build, so the shim must supply it.
local nativeWarn = rawget(_G, "warn")
M.warn = nativeWarn or function(...)
	local parts = {}
	for i = 1, select("#", ...) do
		table.insert(parts, tostring(select(i, ...)))
	end
	print("WARN: " .. table.concat(parts, "\t"))
end

local startTime = os.clock()

M.tick = function() return startTime + os.clock() end
M.time = function() return os.clock() end

-- task.* needs a scheduler to resume coroutines. M2 does not have one, so these
-- fail loudly instead of hanging the script forever.
M.task = {
	wait = function() notYet("task.wait") end,
	delay = function() notYet("task.delay") end,
	spawn = function(fn, ...)
		if nativeTypeof(fn) ~= "function" then
			error("task.spawn expects a function", 2)
		end
		fn(...)
	end,
	defer = function(fn, ...)
		if nativeTypeof(fn) ~= "function" then
			error("task.defer expects a function", 2)
		end
		fn(...)
	end,
	cancel = function() end,
}

M.wait = function() notYet("wait") end
M.spawn = function(fn, ...) return M.task.spawn(fn, ...) end
M.delay = function() notYet("delay") end

-- Luau already ships the Roblox extensions to these libraries:
--   table.find/create/clear/clone/move/pack/unpack
--   math.clamp/round/sign/noise
--   string.split/format
-- Verified present in this build, so they are deliberately NOT re-defined here.
-- Shadowing them is both pointless and dangerous: a wrapper like
-- `tableExt.clone = function(t) return table.clone(t) end` recurses forever once
-- tableExt is installed as the global `table`, because `table` then refers to
-- the wrapper itself.

M.DebugSettings = function() notYet("DebugSettings") end
M.UserSettings = function() notYet("UserSettings") end
M.settings = function() notYet("settings") end

----------------------------------------------------------------
-- Scene serialisation (M3)
----------------------------------------------------------------
-- The viewport needs a plain-data snapshot of the instance tree. Values are
-- deliberately flattened into numeric fields: the host receives detached Lua
-- values with no metatables, so Vector3 and Color3 would arrive as bare
-- arrays. Flattening here keeps the JavaScript side free of Roblox knowledge.
--
-- Reads go straight to _properties rather than through the instance
-- metatable so serialisation cannot trigger user-defined property reads,
-- and cannot fail on an instance that is mid-construction.

local RENDERABLE = {
	Part = true,
	MeshPart = true,
	WedgePart = true,
	CornerWedgePart = true,
	TrussPart = true,
	SpawnLocation = true,
	SpherePart = true,
	CylinderPart = true,
}

local DEFAULT_SIZE = { X = 4, Y = 1, Z = 2 }
local DEFAULT_COLOR = { R = 0.639, G = 0.635, B = 0.647 }

local function readVector(value, fallback)
	if nativeTypeof(value) ~= "table" or value.X == nil then
		return { x = fallback.X, y = fallback.Y, z = fallback.Z }
	end
	return { x = value.X, y = value.Y, z = value.Z }
end

local function readColor(value)
	if nativeTypeof(value) ~= "table" or value.R == nil then
		return { r = DEFAULT_COLOR.R, g = DEFAULT_COLOR.G, b = DEFAULT_COLOR.B }
	end
	return { r = value.R, g = value.G, b = value.B }
end

local function readNumber(value, fallback)
	if nativeTypeof(value) ~= "number" then
		return fallback
	end
	return value
end

-- Name from the object itself; attribute read, not a metatable call.
local function displayName(inst)
	if nativeTypeof(inst.Name) == "string" and inst.Name ~= "" then
		return inst.Name
	end
	return inst.ClassName
end

local function serializeNode(inst, path, out)
	local props = inst._properties
	local name = displayName(inst)
	local fullPath = path == "" and name or (path .. "." .. name)

	if RENDERABLE[inst.ClassName] then
		local material = props.Material
		table.insert(out, {
			id = inst._id,
			className = inst.ClassName,
			name = name,
			path = fullPath,
			position = readVector(props.Position, { X = 0, Y = 0, Z = 0 }),
			size = readVector(props.Size, DEFAULT_SIZE),
			color = readColor(props.Color),
			transparency = readNumber(props.Transparency, 0),
			reflectance = readNumber(props.Reflectance, 0),
			anchored = props.Anchored == true,
			material = (nativeTypeof(material) == "table" and material.Name) or "Plastic",
			canCollide = props.CanCollide ~= false,
			canTouch = props.CanTouch ~= false,
			velocity = readVector(props.AssemblyLinearVelocity, { X = 0, Y = 0, Z = 0 }),
		})
	end

	for _, child in ipairs(inst._children) do
		serializeNode(child, fullPath, out)
	end
end

-- Walks the whole DataModel, so a part parented anywhere is drawn. The camera
-- is included when the script supplied one, because a script that aims the
-- camera expects to be looking through it.
function M.__codeforge_serializeScene()
	local parts = {}
	for _, child in ipairs(game._children) do
		serializeNode(child, "", parts)
	end
	return {
		parts = parts,
		workspaceName = displayName(workspace),
	}
end

----------------------------------------------------------------
-- Physics round-trip hooks (M4)
----------------------------------------------------------------
-- The host owns the solver (Rapier); Lua owns the instance tree. Neither can
-- see the other directly, so each tick moves state across in plain tables.
--
-- `__codeforge_applyState` is the upstream half: the host hands back where each
-- part ended up and the tree is updated so a script that reads `part.Position`
-- sees the truth rather than the value it set.

local function findByPath(root, path)
	-- Fast path: "Workspace.Ball" -> root child "Workspace" -> child "Ball".
	local walk = root
	for segment in string.gmatch(path, "[^%.]+") do
		local found = nil
		for _, child in ipairs(walk._children) do
			if displayName(child) == segment then
				found = child
				break
			end
		end
		if found == nil then
			return nil
		end
		walk = found
	end
	return walk
end

function M.__codeforge_applyState(state)
	for _, record in ipairs(state) do
		local inst = findByPath(game, record.path)
		if inst ~= nil then
			local props = inst._properties
			props.Position = Vector3.new(record.position.x, record.position.y, record.position.z)
			if record.velocity ~= nil then
				props.AssemblyLinearVelocity = Vector3.new(record.velocity.x, record.velocity.y, record.velocity.z)
			end
		end
	end
end

-- `__codeforge_now` is set by the host each tick so `tick()`/`time()` advance.
M.__codeforge_setClock = function(seconds)
	if nativeTypeof(seconds) ~= "number" then
		return
	end
	startTime = seconds - os.clock()
end

-- Touched delivery. Handlers are stored on the instance and called from here so
-- a handler error cannot abort the rest of the frame's touches.
function M.__codeforge_deliverTouched(events)
	for _, event in ipairs(events) do
		local inst = findByPath(game, event.path)
		if inst ~= nil then
			local slot = event.kind == "touch" and "_signal_Touched" or "_signal_TouchEnded"
			local signal = inst[slot]
			-- nil when nothing ever connected; nothing to deliver.
			if signal ~= nil then
				local other = findByPath(game, event.otherPath)
				local ok, err = pcall(function()
					signal:Fire(other)
				end)
				if not ok then
					-- Surface it like any other script error: the host prints it.
					M.warn("Touched handler error on " .. event.path .. ": " .. tostring(err))
				end
			end
		end
	end
end

M._codeforgeVersion = VERSION
M._codeforgeScope = "M4: value types, Instance tree, signals, core globals, scene serialisation, physics round-trip hooks. Scheduler/services in M5."

return M
