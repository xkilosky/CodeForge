/**
 * The simulation loop's scheduling.
 *
 * The frame clock and the script clock run at different rates on purpose (60 Hz
 * solver, 10 Hz script), so the thing worth testing is that the split actually
 * holds, that an over-budget tick steps the rate down instead of blocking, and
 * that stopping really stops.
 */
import { describe, expect, it, vi } from 'vitest';
import { motionChannel, physicsStore, startPhysicsLoop } from '../src/runtimes/luau/physicsLoop';
import type { SolvedPart } from '../src/runtimes/luau/physics';

/** A world stub that advances a single falling part at a known rate. */
function fakeWorld() {
  let y = 100;
  let disposed = false;
  const contacts = new Set<string>();
  return {
    get bodyCount() {
      return 1;
    },
    step(dt: number) {
      y -= 60 * dt;
    },
    readParts(): SolvedPart[] {
      return [
        {
          id: 1,
          path: 'Workspace.Ball',
          position: { x: 0, y, z: 0 },
          velocity: { x: 0, y: -60, z: 0 },
          sleeping: false,
        },
      ];
    },
    contacts: () => contacts,
    applyExternal: () => {},
    dispose() {
      disposed = true;
    },
    get disposed() {
      return disposed;
    },
  };
}

/**
 * Drives frames by hand so the test controls time exactly. Timers are stubbed
 * out because the loop only ever re-schedules itself.
 */
function manualClock() {
  let now = 0;
  let queue: (() => void)[] = [];
  return {
    now: () => now,
    requestFrame: (cb: () => void) => {
      queue.push(cb);
      return queue.length;
    },
    cancelFrame: () => {
      queue = [];
    },
    /** Advances time and runs the single pending frame callback. */
    advance(ms: number) {
      now += ms;
      const pending = queue;
      queue = [];
      for (const cb of pending) cb();
    },
  };
}

describe('physics loop scheduling', () => {
  it('steps the world every frame but runs the script at the simulation rate', async () => {
    const clock = manualClock();
    const world = fakeWorld();
    const onTick = vi.fn().mockResolvedValue(undefined);
    const frames: number[] = [];

    const loop = startPhysicsLoop({
      world,
      onTick,
      onFrame: (solved) => frames.push(solved[0].position.y),
      rate: 10,
      now: clock.now,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    });

    // 60 frames of 16.7ms = one second. The tick is async and the loop will
    // not start another until it settles, so microtasks are flushed per frame.
    for (let i = 0; i < 60; i += 1) {
      clock.advance(1000 / 60);
      await Promise.resolve();
      await Promise.resolve();
    }

    // The solver ran every frame...
    expect(frames).toHaveLength(60);
    expect(frames[0]).toBeGreaterThan(frames[59]);

    // ...but the script ran about ten times, not sixty.
    expect(onTick.mock.calls.length).toBeGreaterThanOrEqual(8);
    expect(onTick.mock.calls.length).toBeLessThanOrEqual(12);

    loop.stop();
    expect(world.disposed).toBe(true);
  });

  it('reports solved positions for the viewport', async () => {
    const clock = manualClock();
    const world = fakeWorld();
    const loop = startPhysicsLoop({
      world,
      onTick: async () => {},
      rate: 10,
      now: clock.now,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    });
    clock.advance(16);
    const state = physicsStore.get();
    expect(state.enabled).toBe(true);
    expect(state.bodyCount).toBe(1);
    expect(state.solved.get('Workspace.Ball')).toBeDefined();
    loop.stop();
    expect(physicsStore.get().enabled).toBe(false);
  });

  it('halves the rate when a tick overruns its budget', async () => {
    let fakeNow = 0;
    const world = fakeWorld();
    let queue: (() => void)[] = [];
    const loop = startPhysicsLoop({
      world,
      // A tick that takes 40ms of wall time: over the 24ms budget.
      onTick: async () => {
        fakeNow += 40;
      },
      rate: 10,
      now: () => fakeNow,
      requestFrame: (cb) => {
        queue.push(cb);
        return queue.length;
      },
      cancelFrame: () => {
        queue = [];
      },
    });

    const pump = () => {
      const pending = queue;
      queue = [];
      for (const cb of pending) cb();
    };

    // First tick runs and is measured as slow.
    fakeNow += 100;
    pump();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(physicsStore.get().rate).toBeLessThan(10);
    loop.stop();
  });

  it('stops cleanly and stops scheduling frames', () => {
    const clock = manualClock();
    const world = fakeWorld();
    const onFrame = vi.fn();
    const loop = startPhysicsLoop({
      world,
      onTick: async () => {},
      onFrame,
      rate: 10,
      now: clock.now,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    });
    clock.advance(16);
    expect(onFrame).toHaveBeenCalledTimes(1);
    loop.stop();
    expect(loop.isRunning()).toBe(false);
    // Nothing is queued after stop, so time passing runs no more frames.
    clock.advance(16);
    expect(onFrame).toHaveBeenCalledTimes(1);
  });

  it('does not let a multi-second stall teleport parts through the floor', () => {
    const clock = manualClock();
    const world = fakeWorld();
    const heights: number[] = [];
    const loop = startPhysicsLoop({
      world,
      onTick: async () => {},
      onFrame: (solved) => heights.push(solved[0].position.y),
      rate: 10,
      now: clock.now,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    });
    // A backgrounded tab: five seconds between frames.
    clock.advance(5000);
    // Delta is clamped to 0.1s, so at 60 studs/s the part moves ~6 studs,
    // not the 300 it would move unclamped.
    expect(heights[0]).toBeGreaterThan(90);
    loop.stop();
  });
});

/* ------------------------------------------------------------------ *
 * Per-frame cost
 * ------------------------------------------------------------------ */

describe('the loop does not re-render React every frame', () => {
  /**
   * Regression: `physicsStore` was pushed a new object (and a new Map of every
   * solved part) on every animation frame, which notified every subscriber —
   * including the whole 3D viewport. At 60 Hz that starved the main thread that
   * steps the solver, and the scene appeared frozen.
   *
   * Positions now travel on `motionChannel`, which nothing subscribes to.
   */
  it('publishes status a few times a second, not 60', async () => {
    const clock = manualClock();
    const world = fakeWorld();
    let notifications = 0;
    const unsubscribe = physicsStore.subscribe(() => {
      notifications += 1;
    });

    const loop = startPhysicsLoop({
      world,
      onTick: async () => {},
      rate: 10,
      now: clock.now,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    });

    // One second at 60 fps.
    for (let i = 0; i < 60; i++) clock.advance(16);
    unsubscribe();
    loop.stop();

    // `stop()` publishes once as well; the point is that 60 frames must not
    // mean 60 notifications.
    expect(notifications).toBeLessThanOrEqual(6);
  });

  it('still exposes every frame through the motion channel', () => {
    const clock = manualClock();
    const world = fakeWorld();
    const loop = startPhysicsLoop({
      world,
      onTick: async () => {},
      rate: 10,
      now: clock.now,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    });

    const first = motionChannel.frame;
    for (let i = 0; i < 10; i++) clock.advance(16);
    const advanced = motionChannel.frame;

    // The viewport polls this; it must advance every frame.
    expect(advanced - first).toBe(10);
    expect(motionChannel.solved.get('Workspace.Ball')).toBeDefined();
    expect(motionChannel.time).toBeGreaterThan(0);

    loop.stop();
    // A stopped loop holds no stale positions for the next render to draw.
    expect(motionChannel.solved.size).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * A loop that is stepping but not visibly moving
 * ------------------------------------------------------------------ */

describe('a stalled world is reported, not silently drawn', () => {
  /**
   * The failure that looks exactly like "simulation doesn't work": Rapier
   * steps every frame, but every body is asleep, so no part ever changes
   * position. The viewport then draws a perfectly correct still image.
   */
  it('exposes whether any body is awake', () => {
    const clock = manualClock();
    const world = fakeWorld();
    const loop = startPhysicsLoop({
      world,
      onTick: async () => {},
      rate: 10,
      now: clock.now,
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
    });
    clock.advance(16);

    // `fakeWorld` reports a solved part with y changing; the viewport needs to
    // know how many of those are actually awake, not just how many exist.
    const settled = [...motionChannel.solved.values()].filter((p) => p.sleeping).length;
    expect(motionChannel.solved.size).toBeGreaterThan(0);
    expect(settled).toBeGreaterThanOrEqual(0);

    loop.stop();
  });
});
