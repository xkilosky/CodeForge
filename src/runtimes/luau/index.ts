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
  ConsoleKind,
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

    const onPrint = (event: Event) => {
      const text = (event as Event & { text?: string }).text ?? '';
      io.log({ kind: 'log', text, file: entryPath });
    };
    worker.addEventListener('print', onPrint);

    io.log({ kind: 'system', text: `Running ${entryPath}` });

    try {
      const result = await worker.execute(files[entryPath].content, {
        entryName: entryPath,
        signal: controller.signal,
        ...EXECUTION_LIMITS,
      });

      if (result.outputTruncated) {
        io.log({
          kind: 'warn',
          text: 'Output was truncated — the script printed more than the output budget allows.',
        });
      }

      if (result.ok) {
        const values = result.values
          .map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)))
          .join('\t');
        io.log({
          kind: 'system',
          text: values ? `Finished, returned: ${values}` : 'Finished',
        });
      } else if (result.error) {
        const parsed = parseLuauError(result.error.message);
        const kind: ConsoleKind = parsed.kind === 'runtime' ? 'error' : 'error';
        io.log({
          kind,
          text: `${parsed.kind} error: ${formatLuauError(parsed)}`,
          file: parsed.file ?? entryPath,
          line: parsed.line,
        });
      }
    } catch (err) {
      if (controller.signal.aborted) {
        io.log({ kind: 'system', text: 'Stopped.' });
      } else {
        io.log({
          kind: 'error',
          text: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        });
      }
    } finally {
      worker.removeEventListener('print', onPrint);
    }

    return {
      stop() {
        controller.abort();
      },
    };
  },

  buildPreview(): PreviewPayload {
    return {
      kind: 'placeholder',
      message:
        'The 3D viewport arrives in M3. Scripts already run against the real Luau VM — check the console for output.',
    };
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
