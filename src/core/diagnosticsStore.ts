import { Store } from './store';
import type { Diagnostic, FileMap, Runtime } from './types';

export interface DiagnosticsState {
  diagnostics: Diagnostic[];
  /** Diagnostics emitted directly by Monaco's JavaScript/TypeScript language service. */
  compilerDiagnostics?: Diagnostic[];
  /** True while a check is in flight. */
  checking: boolean;
  error: string | null;
}

export const diagnosticsStore = new Store<DiagnosticsState>({
  diagnostics: [],
  compilerDiagnostics: [],
  checking: false,
  error: null,
});

function combineDiagnostics(base: Diagnostic[], compiler: Diagnostic[]): Diagnostic[] {
  return [...base, ...compiler];
}

/** Keep Monaco's asynchronous compiler results alongside the fast runtime lint. */
export function setCompilerDiagnostics(compilerDiagnostics: Diagnostic[]): void {
  diagnosticsStore.set((prev) => {
    const base = prev.diagnostics.filter(
      (item) => item.source !== 'TypeScript' && item.source !== 'JavaScript',
    );
    const current = prev.compilerDiagnostics ?? [];
    if (JSON.stringify(current) === JSON.stringify(compilerDiagnostics)) return prev;
    return {
      ...prev,
      compilerDiagnostics,
      diagnostics: combineDiagnostics(base, compilerDiagnostics),
    };
  });
}

/** Checks are not free, so callers must debounce instead of running per edit. */
const DEBOUNCE_MS = 400;

let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = 0;

/**
 * True while a check is in flight. An analysis worker runs one query at a time —
 * a second concurrent request is refused — so callers that can fire at arbitrary
 * moments must consult this rather than racing the debounce.
 */
export function isLintInFlight(): boolean {
  return inFlight > 0 && diagnosticsStore.get().checking;
}

export function clearDiagnostics(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  diagnosticsStore.set({ diagnostics: [], compilerDiagnostics: [], checking: false, error: null });
}

/**
 * Schedules a lint pass. Results are discarded if a newer pass was requested,
 * so a slow check can never overwrite fresher diagnostics.
 */
export function scheduleLint(
  runtime: Runtime,
  files: FileMap,
  delay = DEBOUNCE_MS,
): void {
  if (timer) clearTimeout(timer);

  if (!runtime.lint) {
    diagnosticsStore.set((prev) => ({
      ...prev,
      diagnostics: prev.compilerDiagnostics ?? [],
      checking: false,
      error: null,
    }));
    return;
  }

  timer = setTimeout(() => {
    const requestId = ++inFlight;
    diagnosticsStore.set((prev) => ({ ...prev, checking: true, error: null }));

    void runtime
      .lint!(files)
      .then((diagnostics) => {
        // A newer request superseded this one.
        if (requestId !== inFlight) return;
        const compilerDiagnostics = diagnosticsStore.get().compilerDiagnostics ?? [];
        diagnosticsStore.set({
          diagnostics: combineDiagnostics(diagnostics, compilerDiagnostics),
          compilerDiagnostics,
          checking: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (requestId !== inFlight) return;
        const compilerDiagnostics = diagnosticsStore.get().compilerDiagnostics ?? [];
        diagnosticsStore.set({
          diagnostics: compilerDiagnostics,
          compilerDiagnostics,
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
