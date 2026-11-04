/**
 * Owns the lifecycle of exactly one execution at a time.
 * Runtimes stay React-free: they get an IOBridge and return a RunHandle.
 *
 * ## The race this file exists to prevent
 *
 * `startRun` awaits the runtime, and a runtime's `run()` does real work before
 * it returns a handle: it awaits the worker, boots the VM, and builds the first
 * scene. That is 10–100 ms, and during it `handle` is still null.
 *
 * So this sequence was possible, and is exactly what autorun produces when a
 * user types while a run is starting:
 *
 *   1. startRun(A) → stopRun() → nothing to stop → A begins, handle = null
 *   2. startRun(B) → stopRun() → nothing to stop → B begins
 *   3. A resolves → handle = A's handle     (B's handle is never stored)
 *   4. B resolves → handle = B's handle, A's handle is dropped on the floor
 *
 * Two executions now exist — two physics loops, two scenes publishing to one
 * store — and A can never be stopped. That is not a hypothetical: it is why a
 * previous fix had to serialise access to a worker that rejects concurrent
 * calls, and it makes "the simulation is doing something wrong" reports very
 * hard to reason about.
 *
 * The fix is a generation counter. Starting a run increments it; a run that
 * resolves into a stale generation stops itself immediately instead of
 * becoming the live handle.
 */

import { io, setRunning } from './consoleStore';
import { Store } from './store';
import type { RunHandle } from './types';

export interface RunState {
  running: boolean;
  runCount: number;
}

export const runStore = new Store<RunState>({ running: false, runCount: 0 });

let handle: RunHandle | null = null;
/** Increments on every start and stop; a run whose generation is stale is dead. */
let generation = 0;

/**
 * Starts a run, replacing whatever was running.
 *
 * `onStart` fires before the runtime is asked to run, so a caller can render
 * "starting…" rather than nothing at all. That gap is where the UI used to look
 * frozen while the worker was still booting.
 */
export async function startRun(
  run: (io: typeof import('./consoleStore').io) => RunHandle | Promise<RunHandle>,
  onStart?: () => void,
): Promise<void> {
  stopRun();
  const mine = ++generation;

  io.clear();
  setRunning(true);
  onStart?.();

  try {
    const next = await run(io);
    if (mine !== generation) {
      // A newer run started while this one was booting. Its output is already
      // on screen from the newer run; this one must not survive.
      try {
        next.stop();
      } catch {
        /* a runtime that fails to stop must not wedge the session */
      }
      return;
    }
    handle = next;
  } catch (err) {
    if (mine !== generation) return;
    io.log({
      kind: 'error',
      text: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    handle = null;
  }

  if (mine !== generation) return;
  runStore.set((prev) => ({ ...prev, running: true, runCount: prev.runCount + 1 }));
}

export function stopRun(): void {
  // Bumping the generation is the important part: it makes any run still
  // booting discard itself when it resolves.
  generation += 1;
  if (handle) {
    try {
      handle.stop();
    } catch {
      /* a runtime that fails to stop must not wedge the session */
    }
    handle = null;
  }
  setRunning(false);
  runStore.set((prev) => ({ ...prev, running: false }));
}

export function isRunning(): boolean {
  return runStore.get().running;
}
