import type { Diagnostic } from './types';

export interface TerminalIssue {
  file: string;
  line: number;
  column: number;
  message: string;
}

const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const SOURCE_LOCATION = /((?:file:\/\/)?(?:[A-Za-z]:[\\/])?(?:[./\\]|[A-Za-z0-9_@.$-])(?:[^\s():]*[\\/])*[^\s():]+\.(?:[cm]?[jt]sx?|json|css|html|py))(?::(\d+)(?::(\d+))?|\((\d+),(\d+)\))/i;

/** Pull the common TypeScript, Vite, Node stack, and compiler location formats from a shell line. */
export function parseTerminalLocation(line: string, knownFiles: string[]): Omit<TerminalIssue, 'message'> | null {
  const cleaned = line.replace(ANSI_ESCAPE, '');
  const match = SOURCE_LOCATION.exec(cleaned);
  if (!match) return null;

  const rawPath = match[1].replace(/^file:\/\//, '').replace(/\\/g, '/');
  const normalized = rawPath.replace(/^\/+/, '').replace(/^\.\//, '');
  const file = knownFiles
    .filter((path) => normalized === path || normalized.endsWith(`/${path}`) || path.endsWith(`/${normalized}`))
    .sort((a, b) => b.length - a.length)[0];
  if (!file) return null;

  const lineNumber = Number(match[2] ?? match[4]);
  const columnNumber = Number(match[3] ?? match[5] ?? 1);
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return null;
  return { file, line: lineNumber, column: Math.max(1, columnNumber) };
}

export function terminalIssueDiagnostic(issue: TerminalIssue): Diagnostic {
  return {
    file: issue.file,
    line: issue.line,
    column: issue.column,
    severity: 'error',
    message: issue.message,
    source: 'Terminal',
  };
}
