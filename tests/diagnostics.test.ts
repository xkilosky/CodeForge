import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearDiagnostics,
  diagnosticsStore,
  scheduleLint,
  setCompilerDiagnostics,
  setTerminalDiagnostics,
} from '../src/core/diagnosticsStore';
import type { Diagnostic, Runtime } from '../src/core/types';

const compilerDiagnostic: Diagnostic = {
  file: 'src/app.ts',
  line: 1,
  column: 7,
  severity: 'error',
  message: 'Type string is not assignable to number.',
  code: 2322,
  source: 'TypeScript',
};
const lintDiagnostic: Diagnostic = {
  file: 'index.html',
  line: 1,
  column: 1,
  severity: 'error',
  message: 'Missing closing tag for <main>.',
  source: 'HTML',
};
const terminalDiagnostic: Diagnostic = {
  file: 'src/app.ts',
  line: 8,
  column: 2,
  severity: 'error',
  message: 'Cannot find name missing.',
  source: 'Terminal',
};

const runtime = (lint: Runtime['lint']): Runtime => ({
  id: 'test',
  label: 'Test',
  preview: 'none',
  available: true,
  run: () => ({ stop() {} }),
  lint,
});

afterEach(() => {
  clearDiagnostics();
  vi.useRealTimers();
});

describe('diagnostics channels', () => {
  it('merges live compiler results with lint results without overwriting either', async () => {
    vi.useFakeTimers();
    setCompilerDiagnostics([compilerDiagnostic]);
    scheduleLint(runtime(async () => [lintDiagnostic]), {}, 0);
    await vi.runAllTimersAsync();

    expect(diagnosticsStore.get().diagnostics).toEqual([lintDiagnostic, compilerDiagnostic]);
    expect(diagnosticsStore.get().checking).toBe(false);
  });

  it('keeps terminal diagnostics alongside compiler and lint results', async () => {
    vi.useFakeTimers();
    setCompilerDiagnostics([compilerDiagnostic]);
    setTerminalDiagnostics([terminalDiagnostic]);
    scheduleLint(runtime(async () => [lintDiagnostic]), {}, 0);
    await vi.runAllTimersAsync();

    expect(diagnosticsStore.get().diagnostics).toEqual([
      lintDiagnostic,
      compilerDiagnostic,
      terminalDiagnostic,
    ]);
    expect(diagnosticsStore.get().terminalDiagnostics).toEqual([terminalDiagnostic]);
  });

  it('retains compiler results when a runtime has no separate linter', () => {
    setCompilerDiagnostics([compilerDiagnostic]);
    scheduleLint(runtime(undefined), {});
    expect(diagnosticsStore.get().diagnostics).toEqual([compilerDiagnostic]);
  });

  it('deduplicates unchanged compiler updates', () => {
    setCompilerDiagnostics([compilerDiagnostic]);
    const firstState = diagnosticsStore.get();
    setCompilerDiagnostics([compilerDiagnostic]);
    expect(diagnosticsStore.get()).toBe(firstState);
  });
});
