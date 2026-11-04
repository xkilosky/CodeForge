import { io, setRunning } from './consoleStore';
import { Store } from './store';
import type { RunHandle } from './types';

export interface RunState {
  running: boolean;
  runCount: number;
}

export const runStore = new Store<RunState>({ running: false, runCount: 0 });

let handle: RunHandle | null = null;

/**
 * Owns the lifecycle of exactly one execution at a time.
 * Runtimes stay React-free: they get an IOBridge and return a RunHandle.
 */
export async function startRun(
  run: (io: typeof import('./consoleStore').io) => RunHandle | Promise<RunHandle>,
): Promise<void> {
  stopRun();
  io.clear();
  setRunning(true);
  try {
    handle = await run(io);
  } catch (err) {
    io.log({
      kind: 'error',
      text: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    handle = null;
  }
  runStore.set((prev) => ({ ...prev, running: true, runCount: prev.runCount + 1 }));
}

export function stopRun(): void {
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
