import type { ConsoleState } from '../core/consoleStore';
import type { DiagnosticsState } from '../core/diagnosticsStore';

/** The panes available in the compact workspace. */
export type MobileTab = 'files' | 'code' | 'preview' | 'output';

/**
 * Counts everything the user needs to be told about, from both sources: a
 * Runtime errors reach the console and type errors reach diagnostics;
 * the count is reused by the compact output hint.
 */
export function summarizeIssues(
  consoleState: ConsoleState,
  diagnostics: DiagnosticsState,
): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const entry of consoleState.entries) {
    if (entry.kind === 'error') errors += 1;
    else if (entry.kind === 'warn') warnings += 1;
  }
  for (const diagnostic of diagnostics.diagnostics) {
    if (diagnostic.severity === 'error') errors += 1;
    else if (diagnostic.severity === 'warning') warnings += 1;
  }
  return { errors, warnings };
}
