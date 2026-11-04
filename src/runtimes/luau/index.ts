/**
 * Roblox / Luau runtime — milestone M2.
 *
 * Execution runs in `LuaWorker`, which enforces memory, interrupt, and output
 * budgets, so a `while true do end` in user code is killed in about a second
 * rather than freezing the tab. The Roblox API is installed inside that worker
 * (see execWorker.ts), so no prelude is prepended and user line numbers stay exact.
 *
 * What M2 covers: value types, the Instance tree, signals, console output, and
 * diagnostics. The 3D viewport arrives in M3 and the scheduler/services in M5.
 */
import type {
  Diagnostic,
  FileMap,
  IOBridge,
  PreviewPayload,
  RunHandle,
  Runtime,
} from '../../core/types';
import { LuaWorker } from '@luau-rs/luau/worker';
import type { ExecutionOptions } from '@luau-rs/luau/worker';
import ExecWorker from './execWorker?worker';
import AnalysisWorkerThread from './analysisWorker?worker';
import type { AnalyzeRequest, AnalyzeResponse } from './analysisWorker';
import type { LuauAnalysisMode } from './analyze';
import { formatLuauError, parseLuauError } from './errors';
import { BOOTSTRAP_DISPLAY_NAME, buildBootstrapSource } from './bootstrap';
import { buildLuauModules, readSceneSnapshot, requireSpecifierFor } from './modules';
import { publishScene, reportSceneError, sceneStore } from '../../core/sceneStore';
import { createPhysicsWorld, initPhysics } from './physics';
import type { SolvedPart, TouchEvent } from './physics';
import { startPhysicsLoop } from './physicsLoop';
import { applyPhysicsFrame } from './physicsBridge';
import { serializeRuns } from './runGate';
import type { ScenePart } from '../../core/types';

/** Budgets for one execution. Mirrors the library defaults, stated explicitly. */
const EXECUTION_LIMITS: ExecutionOptions = {
  memoryLimitBytes: 32 * 1024 * 1024,
  interruptLimit: 250_000,
  outputLimitBytes: 256 * 1024,
  outputLimitEvents: 2_000,
};

let executionWorker: LuaWorker | null = null;

function getExecutionWorker(): LuaWorker {
  if (!executionWorker) {
    executionWorker = new LuaWorker({
      // Our own Vite-bundled worker, so the Roblox prelude is installed in it.
      worker: () => new ExecWorker() as unknown as Worker,
    });
  }
  return executionWorker;
}

function isLuauFile(path: string): boolean {
  return /\.(luau|lua)$/i.test(path);
}

/** The file to execute: the active one if it is Luau, else the first Luau file. */
export function resolveEntry(files: FileMap, entry: string): string | null {
  if (entry && isLuauFile(entry) && entry in files) return entry;
  const candidates = Object.keys(files).filter((p) => isLuauFile(p)).sort();
  // Prefer obvious entry points so multi-file projects behave predictably.
  const preferred = candidates.find((p) => /(^|\/)(ServerScript|Script|init|main)\.luau$/i.test(p));
  return preferred ?? candidates[0] ?? null;
}

export const luauRuntime: Runtime = {
  id: 'roblox',
  label: 'Roblox',
  preview: 'roblox-viewport',
  available: true,

  async run(files: FileMap, entry: string, io: IOBridge): Promise<RunHandle> {
    const entryPath = resolveEntry(files, entry);
    if (!entryPath) {
      io.log({
        kind: 'system',
        text: 'No Luau file to run. Add a .luau file to this project.',
      });
      return { stop() {} };
    }

    const worker = getExecutionWorker();
    const controller = new AbortController();
    const modules = buildLuauModules(files);
    // Captured as a const: the closures below lose the narrowing otherwise.
    const scriptPath: string = entryPath;

    /**
     * Whether a script error has already been reported for this run.
     *
     * A failing script used to log the same error on every simulation tick —
     * ten identical lines a second, forever. `tickFailures` bounded how long
     * that went on but not how much it printed; the first failure is the one
     * that matters, the rest is noise.
     */
    let reportedError = false;

    const onPrint = (event: Event) => {
      const text = (event as Event & { text?: string }).text ?? '';
      io.log({ kind: 'log', text, file: entryPath });
    };
    worker.addEventListener('print', onPrint);

    io.log({ kind: 'system', text: `Running ${entryPath}` });

    /** True once the handle has been stopped: no further executions. */
    let stopped = false;
    const isAbort = (err: unknown): boolean =>
      controller.signal.aborted ||
      (err instanceof DOMException && err.name === 'AbortError') ||
      (err instanceof Error && err.name === 'AbortError');

    /**
     * One script execution. `physicsState` is spliced into the bootstrap so the
     * script sees solved positions and can receive touch events in the same run
     * that binds its handlers.
     */
    async function executeOnce(
      physics?: { solved: SolvedPart[]; touches: TouchEvent[]; time: number },
    ): Promise<{ ok: boolean; parts: ScenePart[]; error?: unknown }> {
      const bootstrap = buildBootstrapSource({
        requirePath: requireSpecifierFor(scriptPath),
        displayName: scriptPath,
        physics: physics
          ? {
              state: JSON.stringify(physics.solved),
              touches: JSON.stringify(physics.touches),
              time: physics.time,
            }
          : undefined,
      });

      // Queued, never dropped: the worker rejects concurrent calls outright.
      const result = await serializeRuns(() =>
        worker.execute(bootstrap, {
          entryName: BOOTSTRAP_DISPLAY_NAME,
          signal: controller.signal,
          modules,
          ...EXECUTION_LIMITS,
        }),
      );

      if (result.outputTruncated) {
        io.log({
          kind: 'warn',
          text: 'Output was truncated — the script printed more than the output budget allows.',
        });
      }

      if (result.ok) {
        return { ok: true, parts: readSceneSnapshot(result.values[0]) };
      }

      if (result.error) {
        const parsed = parseLuauError(result.error.message);
        if (!reportedError) {
          reportedError = true;
          // A bootstrap failure has no user-visible filename of its own;
          // attribute it to the script that was required. A genuine script
          // error is already attributed by the engine and keeps its file and
          // line.
          if (parsed.kind === 'syntax' || parsed.kind === 'compile') {
            reportSceneError(formatLuauError(parsed));
          }
          io.log({
            kind: 'error',
            text: `${parsed.kind} error: ${formatLuauError(parsed)}`,
            file: parsed.file ?? scriptPath,
            line: parsed.line,
          });
        }
      }
      return { ok: false, parts: [], error: result.error };
    }

    try {
      // --- phase 0: build the scene -------------------------------------
      const first = await executeOnce();
      if (!first.ok) {
        // executeOnce reports its own error. The one case worth adding is a
        // first run that failed without saying so (an abort), because a blank
        // console over an empty viewport explains nothing.
        if (!reportedError && !stopped) {
          io.log({ kind: 'error', text: `Could not run ${scriptPath}.` });
        }
        return { stop() { controller.abort(); } };
      }

      publishScene(first.parts);
      io.log({
        kind: 'system',
        text: first.parts.length === 0
          ? 'Finished — the script did not create any parts.'
          : `Finished — ${first.parts.length} part${first.parts.length === 1 ? '' : 's'} in the viewport.`,
      });

      const dynamicCount = first.parts.filter((p) => !p.anchored).length;
      if (dynamicCount === 0) {
        const tail = 'No unanchored parts, so physics has nothing to simulate.';
        io.log({ kind: 'system', text: tail });
        sceneStore.set((prev) => ({ ...prev, simulationNote: tail }));
        return { stop() { controller.abort(); } };
      }

      // --- phases 1..n: simulate ----------------------------------------
      // Named phases in the console: if the viewport is still, the last line
      // printed says exactly which step did not complete. A silent simulation
      // is the one bug that cannot be diagnosed from a screenshot.
      let physicsModule: Awaited<ReturnType<typeof initPhysics>>;
      try {
        physicsModule = await initPhysics();
      } catch (err) {
        const message = `Physics engine failed to load: ${
          err instanceof Error ? err.message : String(err)
        }`;
        io.log({ kind: 'error', text: message });
        reportSceneError(message);
        return { stop() { stopped = true; controller.abort(); } };
      }
      void physicsModule;

      let world: ReturnType<typeof createPhysicsWorld>;
      try {
        world = createPhysicsWorld(first.parts);
      } catch (err) {
        const message = `Physics world could not be built: ${
          err instanceof Error ? err.message : String(err)
        }`;
        io.log({ kind: 'error', text: message });
        reportSceneError(message);
        return { stop() { stopped = true; controller.abort(); } };
      }
      sceneStore.set((prev) => ({ ...prev, simulationNote: null }));
      io.log({
        kind: 'system',
        text: `Simulating ${world.bodyCount} part${world.bodyCount === 1 ? '' : 's'}`,
      });

      let tickFailures = 0;
      // The most recent frame, so a slow script tick reads current positions.
      let solvedLatest: SolvedPart[] | null = null;
      const loop = startPhysicsLoop({
        world,
        onFrame: (solved) => {
          solvedLatest = solved;
          applyPhysicsFrame(solved);
        },
        onTick: async (solved, touches, time) => {
          // Scheduled but never started? Drop it: an execution that begins
          // after the user pressed Stop would publish a scene into a viewport
          // that has already been torn down.
          if (stopped) return;

          // `solved` describes the frame this tick was queued for. By the time
          // a slow tick gets its turn the world has moved on, so the freshest
          // positions are used instead of stale ones.
          const tick = await executeOnce({
            solved: solvedLatest ?? solved,
            touches,
            time,
          });

          if (!tick.ok) {
            // A stopped run is not a failing script: aborting the in-flight
            // execution is how Stop works, and counting it would stop the
            // simulation with a message about a script that is fine.
            if (stopped || isAbort(tick.error)) return;
            tickFailures += 1;
            if (tickFailures >= 3) {
              io.log({
                kind: 'error',
                text: 'Stopping the simulation: the script failed on three consecutive ticks.',
              });
              stopLoop();
            }
            return;
          }

          tickFailures = 0;
          if (stopped) return;
          // New instances can appear mid-run (a Touched handler spawning one),
          // so the scene is republished each tick.
          if (tick.parts.length !== lastPublishedCount) {
            lastPublishedCount = tick.parts.length;
            publishScene(tick.parts);
          }
        },
      });

      let lastPublishedCount = first.parts.length;
      // Idempotent: Stop, a crash, and a new Run can all arrive for the same
      // session, and the loop must only be torn down once.
      let loopStopped = false;
      const stopLoop = () => {
        if (loopStopped) return;
        loopStopped = true;
        loop.stop();
      };

      return {
        stop() {
          if (stopped) return;
          stopped = true;
          stopLoop();
          // Aborting last: the signal is what interrupts an in-flight
          // execution, and `stopped` must already be set when it does.
          controller.abort();
          io.log({ kind: 'system', text: 'Stopped.' });
        },
      };
    } catch (err) {
      if (isAbort(err) || controller.signal.aborted) {
        // Stop is not an error and must not be reported as one. Saying so once
        // is enough; the user pressed the button.
        if (!stopped) io.log({ kind: 'system', text: 'Stopped.' });
      } else {
        io.log({
          kind: 'error',
          text: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        });
        reportSceneError(err instanceof Error ? err.message : String(err));
      }
      return { stop() { stopped = true; controller.abort(); } };
    } finally {
      worker.removeEventListener('print', onPrint);
    }
  },

  buildViewport(): PreviewPayload {
    return { kind: 'viewport' };
  },
};

/* ------------------------------------------------------------------ *
 * Diagnostics
 * ------------------------------------------------------------------ */

let analysisWorker: Worker | null = null;
let nextRequestId = 1;
const pendingRequests = new Map<number, {
  resolve: (diagnostics: Diagnostic[]) => void;
  reject: (err: Error) => void;
}>();

function getAnalysisWorker(): Worker {
  if (!analysisWorker) {
    analysisWorker = new AnalysisWorkerThread() as unknown as Worker;
    analysisWorker.onmessage = (event: MessageEvent<AnalyzeResponse>) => {
      const { id, diagnostics, error } = event.data;
      const pending = pendingRequests.get(id);
      if (!pending) return;
      pendingRequests.delete(id);
      if (error) pending.reject(new Error(error));
      else pending.resolve(diagnostics ?? []);
    };
    analysisWorker.onerror = (event) => {
      // Fail every in-flight request rather than leaving callers hanging.
      for (const [id, pending] of pendingRequests) {
        pendingRequests.delete(id);
        pending.reject(new Error(event.message || 'analysis worker crashed'));
      }
    };
  }
  return analysisWorker;
}

/**
 * Checks all Luau files off the main thread. A check takes ~300 ms, so the
 * caller (DiagnosticsBus) is responsible for debouncing.
 */
export async function lintLuau(
  files: FileMap,
  mode: LuauAnalysisMode = 'nonstrict',
): Promise<Diagnostic[]> {
  const worker = getAnalysisWorker();
  const id = nextRequestId++;

  return new Promise<Diagnostic[]>((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    const request: AnalyzeRequest = { id, files, mode };
    worker.postMessage(request);
  });
}

luauRuntime.lint = (files, options) =>
  lintLuau(files, (options?.mode as LuauAnalysisMode | undefined) ?? 'nonstrict');
