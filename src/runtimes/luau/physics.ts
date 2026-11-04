/**
 * The physics solver, and the honest limits of it.
 *
 * Roblox uses a Bullet-derived solver. We use Rapier. Both are rigid-body
 * engines with the same broad behaviour (boxes fall, rest, and stay put), so a
 * simulation is useful — but contact resolution, friction, restitution, and
 * sleeping behave differently, and stack stability in particular is a place
 * where the two visibly disagree. Nothing here claims otherwise, and the
 * viewport keeps its permanent "Simulation" badge.
 *
 * The module is deliberately free of reactivity: it is built, stepped, and
 * read in a loop by `physicsStore`. Keeping it plain means it can be unit
 * tested at 60 steps/second in Node, which is the only way to verify motion in
 * a sandbox with no browser.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import type { ScenePart } from '../../core/types';

/**
 * Rapier is ~1.6 MB of wasm. A Web project, or a Roblox project whose script
 * only builds anchored scenery, must not pay for it, so the module is imported
 * on first use rather than at module load. That is also why the types above are
 * type-only: a value import would defeat the split.
 */
type RapierModule = typeof RAPIER;
let rapierModule: RapierModule | null = null;

export interface PhysicsOptions {
  /** Roblox's default ambient gravity, in studs/s². */
  gravity: number;
  /**
   * Ground height, so a part that falls off the world edge is recoverable.
   * Roblox deletes parts below ~-500 studs (`Workspace.FallenPartsDestroyHeight`).
   */
  killHeight: number;
}

export const DEFAULT_PHYSICS: PhysicsOptions = {
  gravity: -196.2,
  killHeight: -500,
};

/** A part after the solver has moved it. */
export interface SolvedPart {
  id: number;
  path: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  /** True when the part is asleep, which the host uses to skip work. */
  sleeping: boolean;
}

export interface TouchEvent {
  kind: 'touch' | 'end';
  path: string;
  otherPath: string;
}

/**
 * Which colliders are touching which. Keyed by a stable pair string so the
 * difference between two frames yields started/ended events without keeping
 * Rapier objects alive.
 */
export type ContactSet = Set<string>;

export function contactKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

export interface PhysicsWorld {
  readonly bodyCount: number;
  step(dt: number): void;
  readParts(): SolvedPart[];
  contacts(): ContactSet;
  /** Applies writes a script made after the world was built (e.g. `.Velocity`). */
  applyExternal(updates: ExternalUpdate[]): void;
  dispose(): void;
}

export interface ExternalUpdate {
  path: string;
  position?: { x: number; y: number; z: number };
  velocity?: { x: number; y: number; z: number };
  anchored?: boolean;
}

let rapierReady: Promise<RapierModule> | null = null;

/**
 * Loads the solver and instantiates its wasm. Idempotent: concurrent callers
 * share one promise, so a double-click on Run cannot initialise it twice.
 */
export function initPhysics(): Promise<RapierModule> {
  if (!rapierReady) {
    rapierReady = import('@dimforge/rapier3d-compat').then(async (mod) => {
      const rapier = (mod.default ?? mod) as RapierModule;
      await rapier.init();
      rapierModule = rapier;
      return rapier;
    });
  }
  return rapierReady;
}

/** The loaded solver. Throws if called before `initPhysics` resolves. */
function rapier(): RapierModule {
  if (!rapierModule) {
    throw new Error('physics used before initPhysics() resolved');
  }
  return rapierModule;
}

interface BodyRecord {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  part: ScenePart;
}

/**
 * Builds a world from a scene snapshot.
 *
 * Anchored parts become fixed bodies: they still collide, which is what makes
 * a baseplate hold anything up, but the solver will not move them. Parts with
 * `CanCollide = false` still exist as bodies so their position can be read,
 * but get no collider.
 */
export function createPhysicsWorld(
  parts: ScenePart[],
  options: PhysicsOptions = DEFAULT_PHYSICS,
): PhysicsWorld {
  const RAPIER = rapier();
  const world = new RAPIER.World({ x: 0, y: options.gravity, z: 0 });
  // Roblox runs its solver at a fixed rate; matching it keeps feel closer than
  // letting the frame time vary.
  world.timestep = 1 / 60;

  const records = new Map<string, BodyRecord>();

  for (const part of parts) {
    const halfX = Math.max(part.size.x, 0.001) / 2;
    const halfY = Math.max(part.size.y, 0.001) / 2;
    const halfZ = Math.max(part.size.z, 0.001) / 2;

    const desc = part.anchored
      ? RAPIER.RigidBodyDesc.fixed()
      : RAPIER.RigidBodyDesc.dynamic();
    desc.setTranslation(part.position.x, part.position.y, part.position.z);
    if (!part.anchored) {
      desc.setLinvel(part.velocity.x, part.velocity.y, part.velocity.z);
    }
    const body = world.createRigidBody(desc);

    let collider!: RAPIER.Collider;
    if (part.canCollide) {
      collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ)
          // Roblox's default friction/restitution are not published, so these
          // are values that make a part settle quickly instead of sliding.
          .setFriction(0.6)
          .setRestitution(0.0),
        body,
      );
    } else {
      // A sensor: reports contacts for CanTouch without pushing anything.
      collider = world.createCollider(
        RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ).setSensor(true),
        body,
      );
    }

    records.set(part.path, { body, collider, part });
  }

  /**
   * Rapier's contact list is rebuilt every `step()`. Callbacks must therefore
   * be gathered immediately after stepping, before anything else can advance
   * the world — which is why this is called inside `step`.
   */
  let currentContacts: ContactSet = new Set();

  return {
    get bodyCount() {
      return records.size;
    },

    step(dt: number) {
      world.timestep = Math.min(Math.max(dt, 1 / 240), 1 / 30);
      world.step();

      const next: ContactSet = new Set();
      for (const [path, record] of records) {
        if (!record.part.canTouch) continue;
        world.contactPairsWith(record.collider, (other) => {
          const otherPath = pathForCollider(records, other);
          if (otherPath === null || otherPath === path) return;
          // CanTouch is a property of BOTH parts in Roblox: if either side has
          // it off, no Touched fires for the pair. Checking only the instance
          // being iterated made a touch-deaf part still emit from its partner.
          const otherRecord = records.get(otherPath);
          if (otherRecord && !otherRecord.part.canTouch) return;
          next.add(contactKey(path, otherPath));
        });
      }
      currentContacts = next;
    },

    readParts(): SolvedPart[] {
      const solved: SolvedPart[] = [];
      for (const [path, record] of records) {
        const translation = record.body.translation();
        const velocity = record.body.linvel();
        solved.push({
          id: record.part.id,
          path,
          position: { x: translation.x, y: translation.y, z: translation.z },
          velocity: { x: velocity.x, y: velocity.y, z: velocity.z },
          sleeping: record.body.isSleeping(),
        });
      }
      return solved;
    },

    contacts(): ContactSet {
      return currentContacts;
    },

    applyExternal(updates: ExternalUpdate[]) {
      for (const update of updates) {
        const record = records.get(update.path);
        if (!record) continue;
        if (update.position) {
          record.body.setTranslation(update.position, true);
        }
        if (update.velocity) {
          record.body.setLinvel(update.velocity, true);
        }
        if (typeof update.anchored === 'boolean') {
          record.body.setBodyType(
            update.anchored ? RAPIER.RigidBodyType.Fixed : RAPIER.RigidBodyType.Dynamic,
            true,
          );
        }
      }
    },

    dispose() {
      // Freeing the world releases every body and collider it owns.
      world.free();
      records.clear();
    },
  };
}

/** Rapier hands back a Collider; map it to the instance path it was built from. */
function pathForCollider(records: Map<string, BodyRecord>, collider: RAPIER.Collider): string | null {
  for (const [path, record] of records) {
    if (record.collider === collider) return path;
  }
  return null;
}

/**
 * Diffs two contact sets into Roblox-shaped events. Doing this outside the
 * world keeps the "what changed" logic pure and testable.
 */
export function diffContacts(previous: ContactSet, next: ContactSet): TouchEvent[] {
  const events: TouchEvent[] = [];
  for (const key of next) {
    if (previous.has(key)) continue;
    const [a, b] = key.split('\u0000');
    events.push({ kind: 'touch', path: a, otherPath: b });
  }
  for (const key of previous) {
    if (next.has(key)) continue;
    const [a, b] = key.split('\u0000');
    events.push({ kind: 'end', path: a, otherPath: b });
  }
  return events;
}
