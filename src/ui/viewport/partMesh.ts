/**
 * Roblox Part -> three.js geometry, and the material/shape decision table.
 *
 * Kept apart from the React component so the mapping can be unit-tested in Node
 * without a WebGL context — there is no browser in the dev sandbox, so this
 * module is where the geometry claims are actually verified.
 *
 * Coordinate systems agree: Roblox's Y is up, and spike 8 confirmed a Part's
 * `Position` is its CENTER, exactly like a three.js mesh origin. So position
 * needs no offset math. (Roblox's +Z is "back" and three's is "forward"; that
 * only matters for camera orientation, which is handled in RobloxViewport.)
 */
import type { ColorJson, ScenePart, Vec3Json } from '../../core/types';

export type PartShape = 'box' | 'sphere' | 'cylinder' | 'wedge' | 'cornerWedge' | 'truss';

/** Roblox class name -> geometry. Anything unlisted renders as a box. */
export function shapeForClass(className: string): PartShape {
  switch (className) {
    case 'SpherePart':
    case 'Ball':
      return 'sphere';
    case 'CylinderPart':
    case 'Cylinder':
    case 'Tube':
      return 'cylinder';
    case 'WedgePart':
      return 'wedge';
    case 'CornerWedgePart':
      return 'cornerWedge';
    case 'TrussPart':
      return 'truss';
    default:
      return 'box';
  }
}

/**
 * Roblox `Enum.Material` -> how the surface should look.
 *
 * Roughness/metalness are a deliberate approximation, not a colour match:
 * Roblox's materials are texture-driven and cannot be reproduced exactly.
 */
export interface MaterialLook {
  roughness: number;
  metalness: number;
  /** Neon renders unlit in Roblox, so it ignores shading entirely. */
  emissive: boolean;
  /** Glass and forcefield are translucent regardless of `Transparency`. */
  forceOpacity?: number;
}

const MATERIALS: Record<string, MaterialLook> = {
  Plastic: { roughness: 0.8, metalness: 0.0, emissive: false },
  SmoothPlastic: { roughness: 0.4, metalness: 0.0, emissive: false },
  Neon: { roughness: 1.0, metalness: 0.0, emissive: true },
  Metal: { roughness: 0.35, metalness: 0.85, emissive: false },
  CorrodedMetal: { roughness: 0.85, metalness: 0.7, emissive: false },
  DiamondPlate: { roughness: 0.45, metalness: 0.8, emissive: false },
  Foil: { roughness: 0.25, metalness: 0.95, emissive: false },
  Concrete: { roughness: 0.95, metalness: 0.0, emissive: false },
  Brick: { roughness: 0.9, metalness: 0.0, emissive: false },
  Granite: { roughness: 0.7, metalness: 0.1, emissive: false },
  Marble: { roughness: 0.35, metalness: 0.1, emissive: false },
  Slate: { roughness: 0.8, metalness: 0.05, emissive: false },
  Sand: { roughness: 1.0, metalness: 0.0, emissive: false },
  Fabric: { roughness: 1.0, metalness: 0.0, emissive: false },
  Wood: { roughness: 0.75, metalness: 0.0, emissive: false },
  WoodPlanks: { roughness: 0.8, metalness: 0.0, emissive: false },
  Cobblestone: { roughness: 0.9, metalness: 0.05, emissive: false },
  Pebble: { roughness: 0.95, metalness: 0.0, emissive: false },
  Glass: { roughness: 0.05, metalness: 0.1, emissive: false, forceOpacity: 0.25 },
  ForceField: { roughness: 0.2, metalness: 0.3, emissive: true, forceOpacity: 0.35 },
  Ice: { roughness: 0.1, metalness: 0.2, emissive: false, forceOpacity: 0.6 },
  Grass: { roughness: 0.95, metalness: 0.0, emissive: false },
};

const DEFAULT_LOOK = MATERIALS.Plastic;

export function lookForMaterial(material: string): MaterialLook {
  return MATERIALS[material] ?? DEFAULT_LOOK;
}

/**
 * Roblox `Transparency` is 0 (opaque) to 1 (invisible); three's `opacity` is the
 * inverse. A material's own translucency acts as an upper bound so a Glass part
 * does not render solid.
 */
export function opacityFor(part: Pick<ScenePart, 'transparency' | 'material'>): number {
  const look = lookForMaterial(part.material);
  const base = 1 - clamp01(part.transparency);
  return look.forceOpacity === undefined ? base : Math.min(base, look.forceOpacity);
}

/** three.js wants 0xRRGGBB; Roblox colors are already linear 0..1 floats. */
export function rgbHex(color: ColorJson): number {
  const to255 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (to255(color.r) << 16) | (to255(color.g) << 8) | to255(color.b);
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Extracted as a number[] so the test can assert on raw geometry arguments. */
export function boxArgs(size: Vec3Json): [number, number, number] {
  return [size.x, size.y, size.z];
}

/**
 * A Roblox `Part` is always a rectangular block; a `Ball` is a sphere whose
 * diameter equals the part's largest dimension. Sizes below 1e-4 are rounded up
 * because three.js treats a zero dimension as an error.
 */
export function sphereArgs(size: Vec3Json): [number, number, number] {
  const diameter = Math.max(size.x, size.y, size.z, 1e-4);
  return [diameter / 2, 24, 16];
}

/**
 * A Roblox cylinder's circular face points along its X axis, not Y. Rather
 * than rotate the mesh and have every downstream transform reason about it,
 * every primitive is created Y-up and rotated at render time; this returns the
 * unrotated dimensions.
 */
export function cylinderArgs(size: Vec3Json): [number, number, number, number] {
  const radius = Math.max(size.y / 2, size.z / 2, 1e-4);
  return [radius, size.x, 20, radius];
}

export function cylinderRadius(size: Vec3Json): number {
  return Math.max(size.y / 2, size.z / 2, 1e-4);
}

/** The Y rotation, in radians, that turns the Y-up cylinder onto Roblox's X axis. */
export const CYLINDER_ROTATION_Z = Math.PI / 2;
