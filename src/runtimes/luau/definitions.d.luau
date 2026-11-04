--!nonstrict
--[[
	Type definitions for the CodeForge Roblox simulator (M2).

	These describe the surface that prelude.luau actually implements, so the
	analyzer can type-check user scripts instead of flagging every Roblox global
	as unknown. Keep this in step with prelude.luau: anything implemented there
	should be declared here, and anything declared here must exist at runtime.

	Format note: this analyzer accepts `declare name: type` and `export type`.
	It does NOT accept the `declare class X ... end` form.
]]

----------------------------------------------------------------
-- Value types
----------------------------------------------------------------

export type Vector2 = {
	X: number,
	Y: number,
	Magnitude: (self: Vector2) -> number,
	Dot: (self: Vector2, other: Vector2) -> number,
}

export type Vector3 = {
	X: number,
	Y: number,
	Z: number,
	Magnitude: (self: Vector3) -> number,
	Unit: (self: Vector3) -> Vector3,
	Dot: (self: Vector3, other: Vector3) -> number,
	Cross: (self: Vector3, other: Vector3) -> Vector3,
	Lerp: (self: Vector3, goal: Vector3, alpha: number) -> Vector3,
	Abs: (self: Vector3) -> Vector3,
	Floor: (self: Vector3) -> Vector3,
	Ceil: (self: Vector3) -> Vector3,
	Min: (self: Vector3, other: Vector3) -> Vector3,
	Max: (self: Vector3, other: Vector3) -> Vector3,
	FuzzyEq: (self: Vector3, other: Vector3, epsilon: number?) -> boolean,
	Angle: (self: Vector3, other: Vector3, axis: Vector3?) -> number,
}

export type CFrame = {
	Position: Vector3,
	X: number,
	Y: number,
	Z: number,
	R00: number, R01: number, R02: number,
	R10: number, R11: number, R12: number,
	R20: number, R21: number, R22: number,
	PointToWorldSpace: (self: CFrame, v: Vector3) -> Vector3,
	VectorToWorldSpace: (self: CFrame, v: Vector3) -> Vector3,
	Lerp: (self: CFrame, goal: CFrame, alpha: number) -> CFrame,
	GetComponents: (self: CFrame) -> (number, number, number, number, number, number, number, number, number, number, number, number),
}

export type Color3 = {
	R: number,
	G: number,
	B: number,
	ToHex: (self: Color3) -> string,
	ToHSV: (self: Color3) -> (number, number, number),
	Lerp: (self: Color3, goal: Color3, alpha: number) -> Color3,
}

export type UDim = {
	Scale: number,
	Offset: number,
}

export type UDim2 = {
	X: UDim,
	Y: UDim,
	Lerp: (self: UDim2, goal: UDim2, alpha: number) -> UDim2,
}

export type Rect = {
	Min: Vector2,
	Max: Vector2,
}

export type NumberRange = {
	Min: number,
	Max: number,
}

export type Region3 = {
	CFrame: CFrame,
	Size: Vector3,
	ExpandToGrid: (self: Region3, resolution: number?) -> Region3,
}

export type Ray = {
	Origin: Vector3,
	Direction: Vector3,
	Unit: (self: Ray) -> Ray,
	ClosestPoint: (self: Ray, point: Vector3) -> Vector3,
	Distance: (self: Ray, point: Vector3) -> number,
}

export type BrickColor = {
	Name: string,
	Color: Color3,
	r: number,
	g: number,
	b: number,
}

export type Random = {
	NextNumber: (self: Random, a: number?, b: number?) -> number,
	NextInteger: (self: Random, a: number, b: number?) -> number,
	NextBoolean: (self: Random) -> boolean,
}

----------------------------------------------------------------
-- Enums
----------------------------------------------------------------

export type EnumItem = {
	Name: string,
	Value: number,
	EnumType: string,
}

export type EnumType<T> = { [string]: EnumItem }

export type Enum = {
	Material: EnumType<EnumItem>,
	AnchorId: EnumType<EnumItem>,
	Size: EnumType<EnumItem>,
	Orientation: EnumType<EnumItem>,
	NormalId: EnumType<EnumItem>,
	Axis: EnumType<EnumItem>,
	ConnectionState: EnumType<EnumItem>,
	EasingStyle: EnumType<EnumItem>,
	EasingDirection: EnumType<EnumItem>,
	TextXAlignment: EnumType<EnumItem>,
	TextYAlignment: EnumType<EnumItem>,
	Font: EnumType<EnumItem>,
	KeyCode: EnumType<EnumItem>,
	RunContext: EnumType<EnumItem>,
	HttpContentType: EnumType<EnumItem>,
}

----------------------------------------------------------------
-- Signals
----------------------------------------------------------------

export type RBXScriptConnection = {
	Connected: boolean,
	Disconnect: (self: RBXScriptConnection) -> (),
}

export type RBXScriptSignal = {
	Connect: (self: RBXScriptSignal, handler: (...any) -> ()) -> RBXScriptConnection,
	connect: (self: RBXScriptSignal, handler: (...any) -> ()) -> RBXScriptConnection,
	Once: (self: RBXScriptSignal, handler: (...any) -> ()) -> RBXScriptConnection,
	Wait: (self: RBXScriptSignal) -> ...any,
}

----------------------------------------------------------------
-- Instances
----------------------------------------------------------------
-- Deliberately permissive: Roblox exposes thousands of properties, so an
-- indexer keeps user scripts type-checking while the modelled ones stay precise.

export type Instance = {
	Name: string,
	ClassName: string,
	Parent: Instance?,

	-- Common BasePart / GuiObject properties
	Anchored: boolean,
	CanCollide: boolean,
	CanTouch: boolean,
	CanQuery: boolean,
	Size: Vector3,
	Color: Color3,
	Position: Vector3,
	CFrame: CFrame,
	Transparency: number,
	Reflectance: number,
	Material: EnumItem,
	BrickColor: BrickColor,
	Visible: boolean,
	Text: string,
	TextSize: number,
	ZIndex: number,
	Enabled: boolean,

	FindFirstChild: (self: Instance, name: string, recursive: boolean?) -> Instance?,
	FindFirstChildOfClass: (self: Instance, className: string) -> Instance?,
	FindFirstChildWhichIsA: (self: Instance, className: string) -> Instance?,
	WaitForChild: (self: Instance, name: string, timeout: number?) -> Instance,
	GetChildren: (self: Instance) -> { Instance },
	GetDescendants: (self: Instance) -> { Instance },
	GetFullName: (self: Instance) -> string,
	IsA: (self: Instance, className: string) -> boolean,
	Clone: (self: Instance) -> Instance,
	Destroy: (self: Instance) -> (),
	ClearAllChildren: (self: Instance) -> (),
	GetPropertyChangedSignal: (self: Instance, property: string) -> RBXScriptSignal,
	GetAttribute: (self: Instance, name: string) -> any,
	SetAttribute: (self: Instance, name: string, value: any) -> (),
	GetAttributes: (self: Instance) -> { [string]: any },
	GetService: (self: Instance, name: string) -> Instance,

	Changed: RBXScriptSignal,
	AncestryChanged: RBXScriptSignal,
	ChildAdded: RBXScriptSignal,
	ChildRemoved: RBXScriptSignal,

	[string]: any,
}

----------------------------------------------------------------
-- Global constructors and services
----------------------------------------------------------------

declare Vector2: {
	new: (x: number?, y: number?) -> Vector2,
	zero: Vector2,
	one: Vector2,
}

declare Vector3: {
	new: (x: number?, y: number?, z: number?) -> Vector3,
	zero: Vector3,
	one: Vector3,
	xAxis: Vector3,
	yAxis: Vector3,
	zAxis: Vector3,
	AngleBetween: (a: Vector3, b: Vector3) -> number,
}

declare CFrame: {
	new: (...any) -> CFrame,
	identity: CFrame,
	lookAt: (at: Vector3, target: Vector3, up: Vector3?) -> CFrame,
	LookAt: (at: Vector3, target: Vector3, up: Vector3?) -> CFrame,
	fromMatrix: (pos: Vector3, vX: Vector3, vY: Vector3, vZ: Vector3) -> CFrame,
	fromEulerAnglesXYZ: (rx: number, ry: number, rz: number) -> CFrame,
	fromOrientation: (rx: number, ry: number, rz: number) -> CFrame,
	Angles: (rx: number, ry: number, rz: number) -> CFrame,
}

declare Color3: {
	new: (r: number?, g: number?, b: number?) -> Color3,
	fromRGB: (r: number?, g: number?, b: number?) -> Color3,
	fromHex: (hex: string) -> Color3,
	fromHSV: (h: number, s: number, v: number) -> Color3,
	toHSV: (color: Color3) -> (number, number, number),
	white: Color3,
	black: Color3,
	red: Color3,
	green: Color3,
	blue: Color3,
	yellow: Color3,
}

declare UDim: {
	new: (scale: number?, offset: number?) -> UDim,
	fromScale: (scale: number) -> UDim,
	fromOffset: (offset: number) -> UDim,
}

declare UDim2: {
	new: (...any) -> UDim2,
	fromScale: (x: number?, y: number?) -> UDim2,
	fromOffset: (x: number?, y: number?) -> UDim2,
	zero: UDim2,
}

declare Rect: {
	new: (...any) -> Rect,
}

declare NumberRange: {
	new: (min: number?, max: number?) -> NumberRange,
}

declare Region3: {
	new: (min: Vector3, max: Vector3) -> Region3,
}

declare Ray: {
	new: (origin: Vector3, direction: Vector3) -> Ray,
}

declare BrickColor: {
	new: (name: string) -> BrickColor,
	random: () -> BrickColor,
}

declare Random: {
	new: (seed: number?) -> Random,
}

declare Enum: Enum

declare Signal: {
	new: () -> RBXScriptSignal,
}

declare Instance: {
	new: (className: string, parent: Instance?) -> Instance,
}

declare game: Instance
declare workspace: Instance
declare Lighting: Instance
declare ReplicatedStorage: Instance
declare ServerStorage: Instance
declare ServerScriptService: Instance
declare Players: Instance
declare Debris: Instance
declare TweenService: Instance
declare RunService: Instance
declare UserInputService: Instance

declare function GetService(name: string): Instance
declare function print(...: any)
declare function warn(...: any)
declare function tick(): number
declare function time(): number

declare task: {
	wait: (seconds: number?) -> number,
	delay: (seconds: number, handler: () -> ()) -> (),
	spawn: (handler: () -> (), ...any) -> (),
	defer: (handler: () -> (), ...any) -> (),
	cancel: (thread: thread) -> (),
}

declare function wait(seconds: number?): number
declare function spawn(handler: () -> (), ...: any): thread
declare function delay(seconds: number, handler: () -> ()): thread

-- Roblox's typeof reports its own type names.
declare function typeof(value: any): string
