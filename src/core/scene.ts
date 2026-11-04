/**
 * The game scene: what a visual game project is made of.
 *
 * Pure — no React, no canvas, no store — so the editor's logic is testable in
 * Node and the runtime can import it without dragging the UI in.
 *
 * The scene lives on the `Project`, which means it is persisted by the same
 * IndexedDB write that saves the files. A scene therefore survives a reload
 * for free, and cannot drift out of sync with the code beside it.
 *
 * Coordinates are stage units with the origin at the **top-left**, y growing
 * downward. That is the same convention as the canvas and the DOM, so the
 * builder, the physics and the preview never have to flip anything.
 */

import { newId } from './types';

export type EntityKind = 'box' | 'circle';

export interface Entity {
  id: string;
  /** Shown in the inspector and in script errors; user-editable. */
  name: string;
  kind: EntityKind;
  /** Top-left corner, stage units. */
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  /**
   * Solid entities never move and block the player. A platform is solid; a
   * coin or the player is not.
   */
  solid: boolean;
}

export interface World {
  width: number;
  height: number;
  /** Downward acceleration, units per second squared. */
  gravity: number;
}

export interface Scene {
  /** Bumped if the persisted shape ever changes, so a stale scene is portable. */
  version: 1;
  world: World;
  entities: Entity[];
  /** Which entity the Play button drives. Optional: see `resolvePlayer`. */
  playerId?: string;
}

/** Colours that read well on the dark stage and stay distinguishable. */
export const PALETTE = [
  '#4c6ef5',
  '#22b8cf',
  '#37b24d',
  '#f59f00',
  '#f76707',
  '#e64980',
  '#ae3ec9',
  '#868e96',
] as const;

export const DEFAULT_WORLD: World = { width: 960, height: 540, gravity: 1600 };

/** Minimum size an entity can be dragged or typed down to. */
export const MIN_ENTITY_SIZE = 8;

export function emptyScene(): Scene {
  return {
    version: 1,
    world: { ...DEFAULT_WORLD },
    entities: [],
  };
}

export function createEntity(
  kind: EntityKind,
  x: number,
  y: number,
  overrides: Partial<Omit<Entity, 'id' | 'kind'>> = {},
): Entity {
  return {
    id: newId('ent'),
    kind,
    name: kind === 'circle' ? 'Circle' : 'Box',
    x: Math.round(x),
    y: Math.round(y),
    w: kind === 'circle' ? 48 : 120,
    h: kind === 'circle' ? 48 : 32,
    color: PALETTE[0],
    solid: kind !== 'circle',
    ...overrides,
  };
}

/**
 * Whether `value` is a scene we can trust.
 *
 * Everything that leaves the app comes back through here: a project stored by
 * an older build, a duplicated project, a hand-edited IndexedDB record. A scene
 * that fails this check is treated as absent rather than half-loaded, because a
 * missing entity is a lot easier to notice than one drawn at `NaN`.
 */
export function normalizeScene(value: unknown): Scene | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const rawWorld = (raw.world ?? {}) as Record<string, unknown>;
  const world: World = {
    width: positive(rawWorld.width, DEFAULT_WORLD.width),
    height: positive(rawWorld.height, DEFAULT_WORLD.height),
    gravity: finite(rawWorld.gravity, DEFAULT_WORLD.gravity),
  };

  const list = Array.isArray(raw.entities) ? raw.entities : [];
  const entities: Entity[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item !== 'object' || item === null) continue;
    const e = item as Record<string, unknown>;
    if (typeof e.id !== 'string' || !e.id || seen.has(e.id)) continue;
    seen.add(e.id);
    const kind: EntityKind = e.kind === 'circle' ? 'circle' : 'box';
    entities.push({
      id: e.id,
      name: typeof e.name === 'string' && e.name ? e.name : kind === 'circle' ? 'Circle' : 'Box',
      kind,
      x: finite(e.x, 0),
      y: finite(e.y, 0),
      w: Math.max(MIN_ENTITY_SIZE, finite(e.w, kind === 'circle' ? 48 : 120)),
      h: Math.max(MIN_ENTITY_SIZE, finite(e.h, kind === 'circle' ? 48 : 32)),
      color: typeof e.color === 'string' && e.color ? e.color : PALETTE[0],
      solid: typeof e.solid === 'boolean' ? e.solid : kind !== 'circle',
    });
  }

  const playerId =
    typeof raw.playerId === 'string' && entities.some((e) => e.id === raw.playerId)
      ? raw.playerId
      : undefined;

  return { version: 1, world, entities, ...(playerId ? { playerId } : {}) };
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positive(value: unknown, fallback: number): number {
  const n = finite(value, fallback);
  return n > 0 ? n : fallback;
}

/** "Box 3" — the next free number for a new entity of this kind. */
export function nextEntityName(entities: Entity[], kind: EntityKind): string {
  const base = kind === 'circle' ? 'Circle' : 'Box';
  let n = 1;
  const taken = new Set(entities.map((e) => e.name));
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

export function addEntity(
  scene: Scene,
  kind: EntityKind,
  x: number,
  y: number,
  overrides: Partial<Omit<Entity, 'id' | 'kind'>> = {},
): { scene: Scene; entity: Entity } {
  const entity = createEntity(kind, x, y, {
    name: nextEntityName(scene.entities, kind),
    ...overrides,
  });
  return { scene: { ...scene, entities: [...scene.entities, entity] }, entity };
}

export function updateEntity(
  scene: Scene,
  id: string,
  patch: Partial<Omit<Entity, 'id'>>,
): Scene {
  let changed = false;
  const entities = scene.entities.map((entity) => {
    if (entity.id !== id) return entity;
    changed = true;
    return clampEntity({ ...entity, ...patch, id: entity.id }, scene.world);
  });
  return changed ? { ...scene, entities } : scene;
}

/**
 * Clamps an edited entity to legal values.
 *
 * Dragging and typing both funnel through here, so an entity cannot be given a
 * `NaN` from a cleared input or shrunk below a grabable size. Position is left
 * alone beyond `y >= 0`: an entity partly off the left or right edge is a
 * legitimate thing to build (a wall that runs past the stage), and clamping it
 * back inside would fight the user's drag.
 */
export function clampEntity(entity: Entity, world: World): Entity {
  const w = Math.max(MIN_ENTITY_SIZE, Math.round(finite(entity.w, MIN_ENTITY_SIZE)));
  const h = Math.max(MIN_ENTITY_SIZE, Math.round(finite(entity.h, MIN_ENTITY_SIZE)));
  return {
    ...entity,
    w,
    h,
    // At least a grabable corner must stay on the stage, or the entity becomes
    // unreachable — visible in the inspector, impossible to click.
    x: Math.round(clamp(finite(entity.x, 0), MIN_ENTITY_SIZE - w, Math.max(0, world.width - MIN_ENTITY_SIZE))),
    y: Math.round(clamp(finite(entity.y, 0), 0, Infinity)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function removeEntity(scene: Scene, id: string): Scene {
  const entities = scene.entities.filter((entity) => entity.id !== id);
  if (entities.length === scene.entities.length) return scene;
  return {
    ...scene,
    entities,
    // A deleted player must not leave `playerId` pointing at nothing.
    ...(scene.playerId === id ? { playerId: undefined } : {}),
  };
}

/**
 * The entity Play drives.
 *
 * `playerId` is honoured only if it still resolves; otherwise the first
 * non-solid box is used, then the first box. A project created by an older
 * build — or one whose player was just deleted — therefore still plays instead
 * of refusing to start, which is the difference between a bug and a mystery.
 */
export function resolvePlayer(scene: Scene): Entity | null {
  if (scene.entities.length === 0) return null;
  if (scene.playerId) {
    const chosen = scene.entities.find((entity) => entity.id === scene.playerId);
    if (chosen) return chosen;
  }
  return (
    scene.entities.find((entity) => entity.kind === 'box' && !entity.solid) ??
    scene.entities.find((entity) => entity.kind === 'box') ??
    scene.entities[0]
  );
}

export function setPlayer(scene: Scene, id: string | undefined): Scene {
  if (id && !scene.entities.some((entity) => entity.id === id)) return scene;
  return { ...scene, playerId: id };
}

/** A scene with a floor, a wall, the player and a pickup — the starter stage. */
export function starterScene(): Scene {
  const scene = emptyScene();
  const floor: Entity = {
    ...createEntity('box', 0, 492, { w: 960, h: 48 }),
    name: 'Floor',
    color: PALETTE[7],
    solid: true,
  };
  const ledge: Entity = {
    ...createEntity('box', 560, 360, { w: 220, h: 28 }),
    name: 'Ledge',
    color: PALETTE[7],
    solid: true,
  };
  const player: Entity = {
    ...createEntity('box', 80, 380, { w: 40, h: 64 }),
    name: 'Player',
    color: PALETTE[0],
    solid: false,
  };
  const coin: Entity = {
    ...createEntity('circle', 640, 300, { w: 36, h: 36 }),
    name: 'Coin',
    color: PALETTE[3],
    solid: false,
  };
  return { ...scene, entities: [floor, ledge, player, coin], playerId: player.id };
}
