/**
 * Project files -> Luau modules.
 *
 * Roblox's `require` resolves relative paths (`require("./Shop")`) to child
 * modules, so a multi-file project needs every Luau file registered up front.
 * Verified against `@luau-rs/luau`: nested paths, dotted filenames, spaces, and
 * sibling requires from inside a module all resolve.
 *
 * Kept pure so the mapping is unit-testable without a worker.
 */
import type { ColorJson, FileMap, ScenePart, Vec3Json } from '../../core/types';

export interface LuauModule {
  name: string;
  source: string;
}

export function isLuauPath(path: string): boolean {
  return /\.(luau|lua)$/i.test(path);
}

/**
 * The specifier a file is reachable at.
 *
 * The `.luau` extension is dropped, matching Roblox, where `require(script.Shop)`
 * names the instance rather than a filename. A leading `./` makes the specifier
 * relative; without it the resolver warns about an absolute require.
 */
export function requireSpecifierFor(path: string): string {
  return `./${path.replace(/\.(luau|lua)$/i, '')}`;
}

/**
 * Registers every Luau file. The entry is included: a script may `require`
 * a sibling, and the bootstrap separately requires the entry itself.
 */
export function buildLuauModules(files: FileMap): LuauModule[] {
  return Object.keys(files)
    .filter(isLuauPath)
    .sort()
    .map((path) => ({ name: path, source: files[path].content }));
}

/**
 * Finds a module the way Roblox would: by basename, ignoring extension and
 * case, so `require("./shop")` reaching `Shop.luau` works as users expect.
 * Returns the project path, or null.
 */
export function resolveModuleReference(files: FileMap, reference: string): string | null {
  const cleaned = reference.replace(/^\.\//, '').replace(/\.(luau|lua)$/i, '').toLowerCase();
  const candidates = Object.keys(files).filter(isLuauPath);
  return (
    candidates.find((path) => requireSpecifierFor(path).slice(2).toLowerCase() === cleaned) ??
    candidates.find((path) => basenameWithoutExtension(path).toLowerCase() === cleaned) ??
    null
  );
}

function basenameWithoutExtension(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.(luau|lua)$/i, '');
}

/* ------------------------------------------------------------------ *
 * Reading the scene back out of the sandbox
 * ------------------------------------------------------------------ */

/**
 * Validates what the bootstrap returned into `ScenePart[]`.
 *
 * This value crosses an untrusted boundary: a project's Luau source is the
 * user's, but the serializer could also be reached by a script that poked at
 * internals. Nothing downstream should have to defend against a missing
 * `position` or a string where a number belongs, so the shape is rebuilt field
 * by field here rather than cast. Malformed parts are dropped, not thrown on —
 * one bad part should not blank the whole viewport.
 */
export function readSceneSnapshot(value: unknown): ScenePart[] {
  if (!Array.isArray(value)) return [];

  const parts: ScenePart[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const record = raw as Record<string, unknown>;

    const position = readVec3(record.position);
    const size = readVec3(record.size);
    const color = readColor(record.color);
    const className = typeof record.className === 'string' ? record.className : 'Part';
    if (!position || !size || !color) continue;

    parts.push({
      id: typeof record.id === 'number' && Number.isFinite(record.id) ? record.id : parts.length,
      className,
      name: typeof record.name === 'string' ? record.name : className,
      path: typeof record.path === 'string' ? record.path : className,
      // A zero-sized part is a degenerate mesh; clamp to something drawable.
      position,
      size: {
        x: Math.max(size.x, MIN_AXIS),
        y: Math.max(size.y, MIN_AXIS),
        z: Math.max(size.z, MIN_AXIS),
      },
      color,
      transparency: clampUnit(record.transparency),
      reflectance: clampUnit(record.reflectance),
      anchored: record.anchored === true,
      material: typeof record.material === 'string' ? record.material : 'Plastic',
    });
  }
  return parts;
}

/** three.js rejects zero-dimensional geometry, so no axis may be 0. */
const MIN_AXIS = 0.001;

function readVec3(value: unknown): Vec3Json | null {
  if (typeof value !== 'object' || value === null) return null;
  const { x, y, z } = value as Record<string, unknown>;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}

function readColor(value: unknown): ColorJson | null {
  if (typeof value !== 'object' || value === null) return null;
  const { r, g, b } = value as Record<string, unknown>;
  if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') return null;
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return { r: clampUnit(r), g: clampUnit(g), b: clampUnit(b) };
}

function clampUnit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
