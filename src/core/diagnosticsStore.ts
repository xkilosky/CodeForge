import { Store } from './store';
import type { Diagnostic, FileMap, Runtime } from './types';

export interface DiagnosticsState {
  diagnostics: Diagnostic[];
  /** True while a check is in flight. */
  checking: boolean;
  error: string | null;
}

export const diagnosticsStore = new Store<DiagnosticsState>({
  diagnostics: [],
  checking: false,
  error: null,
});

/** A check costs ~300 ms in the Luau analyzer, so callers must debounce. */
const DEBOUNCE_MS = 400;

let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = 0;

export function clearDiagnostics(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  diagnosticsStore.set({ diagnostics: [], checking: false, error: null });
}

/**
 * Schedules a lint pass. Results are discarded if a newer pass was requested,
 * so a slow check can never overwrite fresher diagnostics.
 */
export function scheduleLint(
  runtime: Runtime,
  files: FileMap,
  mode: string | undefined,
  delay = DEBOUNCE_MS,
): void {
  if (timer) clearTimeout(timer);

  if (!runtime.lint) {
    diagnosticsStore.set({ diagnostics: [], checking: false, error: null });
    return;
  }

  timer = setTimeout(() => {
    const requestId = ++inFlight;
    diagnosticsStore.set((prev) => ({ ...prev, checking: true, error: null }));

    void runtime
      .lint!(files, mode ? { mode } : undefined)
      .then((diagnostics) => {
        // A newer request superseded this one.
        if (requestId !== inFlight) return;
        diagnosticsStore.set({ diagnostics, checking: false, error: null });
      })
      .catch((err: unknown) => {
        if (requestId !== inFlight) return;
        diagnosticsStore.set({
          diagnostics: [],
          checking: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }, delay);
}

export function diagnosticsByFile(diagnostics: Diagnostic[]): Map<string, Diagnostic[]> {
  const map = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    const list = map.get(d.file);
    if (list) list.push(d);
    else map.set(d.file, [d]);
  }
  return map;
}
