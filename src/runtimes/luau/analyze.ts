/**
 * Luau type-checking and linting.
 *
 * `Analysis.create()` is async but `check()` is synchronous, which suits a
 * worker: build the analyzer once, then answer checks without reinitialising
 * wasm. A check costs roughly 300 ms, so callers must debounce.
 *
 * Positions come back zero-based (lines) with UTF-16 columns; Monaco and our own
 * Diagnostic type are 1-based, so the conversion happens here and nowhere else.
 */
import { Analysis } from '@luau-rs/luau/analysis';
import type { AnalysisDiagnostic } from '@luau-rs/luau/analysis';
import type { Diagnostic, DiagnosticSeverity, FileMap } from '../../core/types';
import definitionsSource from './definitions.d.luau?raw';

export type LuauAnalysisMode = 'nocheck' | 'nonstrict' | 'strict';

/** Definitions describing prelude.luau's runtime surface. */
export const DEFINITIONS_SOURCE: string = definitionsSource;

const DEFINITION_NAME = 'codeforge-roblox';

function severityFor(severity: string): DiagnosticSeverity {
  if (severity === 'error') return 'error';
  if (severity === 'warning' || severity === 'hint') return 'warning';
  return 'info';
}

function toDiagnostic(file: string, d: AnalysisDiagnostic): Diagnostic {
  const begin = d.location?.begin;
  const end = d.location?.end;
  return {
    file,
    // Analysis is zero-based; our Diagnostic (and Monaco) are 1-based.
    line: (begin?.line ?? 0) + 1,
    column: (begin?.column ?? 0) + 1,
    endLine: end ? end.line + 1 : undefined,
    endColumn: end ? end.column + 1 : undefined,
    severity: severityFor(d.severity),
    message: d.message,
    code: d.code,
    source: 'luau',
  };
}

function isLuauFile(path: string): boolean {
  return /\.(luau|lua)$/i.test(path);
}

export interface LuauAnalyzer {
  /** Checks every Luau file in the project. */
  check(files: FileMap, mode: LuauAnalysisMode): Diagnostic[];
  dispose(): void;
}

/**
 * Creates a persistent analyzer. Reusing one instance keeps the wasm module and
 * its module cache alive between checks.
 */
export async function createLuauAnalyzer(): Promise<LuauAnalyzer> {
  const analysis = await Analysis.create({
    lint: true,
    definitions: [{ name: DEFINITION_NAME, source: DEFINITIONS_SOURCE }],
  });

  let currentMode: LuauAnalysisMode | null = null;
  let knownModules = new Set<string>();

  return {
    check(files: FileMap, mode: LuauAnalysisMode): Diagnostic[] {
      if (mode !== currentMode) {
        analysis.setMode(mode);
        currentMode = mode;
      }

      const targets = Object.keys(files).filter(isLuauFile);

      // Drop modules that disappeared so stale diagnostics cannot linger.
      for (const previous of knownModules) {
        if (!(previous in files)) {
          analysis.deleteModule(previous);
          knownModules.delete(previous);
        }
      }

      const diagnostics: Diagnostic[] = [];
      const nextKnown = new Set<string>();

      for (const path of targets) {
        analysis.setModule(path, files[path].content, 'script');
        nextKnown.add(path);

        let result;
        try {
          result = analysis.check(path);
        } catch (err) {
          diagnostics.push({
            file: path,
            line: 1,
            column: 1,
            severity: 'error',
            message: `Analyzer failed: ${err instanceof Error ? err.message : String(err)}`,
            source: 'luau',
          });
          continue;
        }

        for (const d of result.diagnostics) {
          diagnostics.push(toDiagnostic(path, d));
        }
      }

      knownModules = nextKnown;
      return diagnostics;
    },

    dispose() {
      analysis[Symbol.dispose]?.();
    },
  };
}
