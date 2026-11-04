/**
 * The simulation loop.
 *
 * ## The constraint that shapes this file
 *
 * `LuaWorker` gives every execution a fresh sandbox and keeps no host-reachable
 * handle, so phase-0 script output cannot be continued. Rapier, meanwhile, has
 * to run over many frames. Something must therefore connect the two, and the
 * only channel out of a Luau state is its return value.
 *
 * Measured before choosing: creating a state is 0.19 ms, but booting one with
 * the Roblox API costs 6.6–12 ms (a 3.4 ms bytecode run, 1.1 ms toMap, 2.1 ms
 * for 44 globals.set). A fresh VM per 60 Hz frame is therefore not shippable,
 * so the script is re-executed at a fixed *simulation rate* instead — 10 Hz by
 * default, which leaves the frame budget intact while still letting
 * `part.Touched` handlers do meaningful work.
 *
 * ## What this costs
 *
 * Re-execution means a script runs from the top each tick. State a script keeps
 * in locals is lost between ticks, so `local count = 0` inside a Touched
 * handler does not accumulate. This is a real fidelity limit, not a bug, and
 * the honest fix is `task.*`/`RunService` with a persistent state in M5.
 *
 * The loop is also budgeted: if a tick's execution is slow the rate drops
 * rather than the frame rate, and a hard cap stops a pathological script from
 * locking the tab.
 */
import { useSyncExternalStore } from 'react';
import type { PhysicsWorld, SolvedPart, TouchEvent } from './physics';
import { Store } from '../../core/store';

/** Ticks per second at which the script is re-executed. */
export const DEFAULT_SIM_RATE = 10;
/** Never exceed this many script executions per second, whatever the rate. */
const MAX_EXECUTIONS_PER_SECOND = 20;
/** A single tick slower than this halves the rate, so the UI stays responsive. */
const SLOW_TICK_MS = 24;
const MIN_SIM_RATE = 2;

export interface PhysicsState {
  enabled: boolean;
  /** Parts the solver moved this frame, by path. */
  solved: Map<string, SolvedPart>;
  /** Clock the viewport and scripts share, in seconds. */
  time: number;
  /** Measured cost of one script tick, for the UI to show honestly. */
  lastTickMs: number;
  rate: number;
  bodyCount: number;
  touchCount: number;
  error: string | null;
}

const EMPTY: PhysicsState = {
  enabled: false,
  solved: new Map(),
  time: 0,
  lastTickMs: 0,
  rate: DEFAULT_SIM_RATE,
  bodyCount: 0,
  touchCount: 0,
  error: null,
};

export const physicsStore = new Store<PhysicsState>(EMPTY);

export function usePhysicsState(): PhysicsState {
  return useSyncExternalStore(physicsStore.subscribe, physicsStore.get, physicsStore.get);
}

/* ------------------------------------------------------------------ *
 * Per-frame motion — deliberately outside React
 * ------------------------------------------------------------------ */

/**
 * The freshest solved positions, readable every animation frame.
 *
 * This used to live in `physicsStore`, which meant a new state object and a new
 * Map 60 times a second, each one notifying React. Every subscriber re-rendered
 * at that rate — including the 3D viewport, whose render output does not depend
 * on the positions at all: the render loop reads them and moves meshes directly.
 * On a phone that is the difference between a simulation and a still frame,
 * because React reconciling a large tree at 60 Hz starves the same main thread
 * that is stepping Rapier.
 *
 * So the per-frame channel is a plain mutable object. Readers poll it from the
 * animation frame they already run; nothing re-renders. Status that a human
 * actually reads (rate, body count, tick cost, errors) still goes through
 * `physicsStore`, but only a few times a second.
 */
export const motionChannel: {
  solved: Map<string, SolvedPart>;
  time: number;
  /** Increments per frame, so a reader can tell whether it is current. */
  frame: number;
} = { solved: new Map(), time: 0, frame: 0 };

/** How often React-visible status is republished. Four times a second is
 *  enough for numbers a person reads, and cheap enough to be invisible. */
const STATUS_INTERVAL_MS = 250;

export interface PhysicsTick {
  /** Applies solved positions to the Lua tree and returns any touch events. */
  (solved: SolvedPart[], touches: TouchEvent[], time: number): Promise<void>;
}

export interface PhysicsLoopOptions {
  world: PhysicsWorld;
  /** Runs the script for this tick. Provided by the runtime. */
  onTick: PhysicsTick;
  /** Called with each frame's solved positions so the viewport can draw them. */
  onFrame?: (solved: SolvedPart[], time: number) => void;
  rate?: number;
  /** Injected in tests so stepping is deterministic. */
  now?: () => number;
  requestFrame?: (cb: () => void) => number;
  cancelFrame?: (id: number) => void;
}

export interface PhysicsLoop {
  stop(): void;
  isRunning(): boolean;
}

/**
 * Starts stepping the world. Physics runs on the animation frame (smooth), the
 * script on a slower fixed-rate clock (affordable).
 */
export function startPhysicsLoop(options: PhysicsLoopOptions): PhysicsLoop {
  const {
    world,
    onTick,
    onFrame,
    now = () => performance.now(),
    requestFrame = (cb) => requestAnimationFrame(cb),
    cancelFrame = (id) => cancelAnimationFrame(id),
  } = options;

  let rate = Math.min(options.rate ?? DEFAULT_SIM_RATE, MAX_EXECUTIONS_PER_SECOND);
  let running = true;
  let frameId = 0;
  let lastFrame = now();
  let lastTick = lastFrame;
  let elapsed = 0;
  let previousContacts = world.contacts();
  let ticking = false;
  let touchTotal = 0;
  let lastStatusAt = -Infinity;
  let lastRate = rate;

  physicsStore.set({ ...EMPTY, enabled: true, rate, bodyCount: world.bodyCount });
  motionChannel.solved = new Map();
  motionChannel.time = 0;

  const loop = () => {
    if (!running) return;
    frameId = requestFrame(loop);

    const frameNow = now();
    // Clamp: a backgrounded tab can produce a multi-second delta, which would
    // otherwise teleport everything through the floor.
    const dt = Math.min((frameNow - lastFrame) / 1000, 0.1);
    lastFrame = frameNow;

    world.step(dt);
    elapsed += dt;

    const solved = world.readParts();
    const solvedByPath = new Map(solved.map((s) => [s.path, s]));
    const contacts = world.contacts();
    const events = diffContactsForLoop(previousContacts, contacts);
    previousContacts = contacts;
    touchTotal += events.length;

    onFrame?.(solved, elapsed);

    // The hot path: no allocation of a store state, no listeners, no React.
    motionChannel.solved = solvedByPath;
    motionChannel.time = elapsed;
    motionChannel.frame += 1;

    // The cold path: numbers a person reads, at a human rate.
    if (frameNow - lastStatusAt >= STATUS_INTERVAL_MS) {
      lastStatusAt = frameNow;
      physicsStore.set((prev) => ({
        ...prev,
        // Kept for callers that read the store rather than the channel; it is
        // a snapshot, not a per-frame guarantee.
        solved: solvedByPath,
        time: elapsed,
        bodyCount: world.bodyCount,
        touchCount: touchTotal,
        rate: lastRate,
      }));
    }

    // Execute the script only as often as the budget allows.
    const interval = 1 / rate;
    if (!ticking && (frameNow - lastTick) / 1000 >= interval) {
      lastTick = frameNow;
      ticking = true;
      const started = now();
      void onTick(solved, events, elapsed)
        .catch((err: unknown) => {
          physicsStore.set((prev) => ({
            ...prev,
            error: err instanceof Error ? err.message : String(err),
          }));
        })
        .finally(() => {
          const cost = now() - started;
          ticking = false;
          // Adaptive: a script too slow for its rate steps down instead of
          // blocking the tab.
          if (cost > SLOW_TICK_MS && rate > MIN_SIM_RATE) {
            rate = Math.max(MIN_SIM_RATE, Math.round(rate / 2));
          }
          lastRate = rate;
          physicsStore.set((prev) => ({ ...prev, lastTickMs: cost, rate }));
        });
    }
  };

  frameId = requestFrame(loop);

  return {
    stop() {
      running = false;
      cancelFrame(frameId);
      world.dispose();
      motionChannel.solved = new Map();
      physicsStore.set(EMPTY);
    },
    isRunning() {
      return running;
    },
  };
}

/** Local copy to avoid importing the pure helper through the physics module's
 *  heavier dependency graph on every frame; the logic is identical. */
function diffContactsForLoop(previous: Set<string>, next: Set<string>): TouchEvent[] {
  const events: TouchEvent[] = [];
  const split = (key: string) => key.split('\u0000');
  for (const key of next) {
    if (previous.has(key)) continue;
    const [a, b] = split(key);
    events.push({ kind: 'touch', path: a, otherPath: b });
  }
  for (const key of previous) {
    if (next.has(key)) continue;
    const [a, b] = split(key);
    events.push({ kind: 'end', path: a, otherPath: b });
  }
  return events;
}
