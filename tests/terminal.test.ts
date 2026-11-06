import { describe, expect, it } from 'vitest';
import { parseTerminalLocation, terminalIssueDiagnostic } from '../src/core/terminalDiagnostics';
import { mergeWorkspaceTextFiles } from '../src/core/terminalRuntime';

describe('terminal diagnostics', () => {
  const files = ['src/app.ts', 'src/main.js', 'index.html'];

  it('parses TypeScript compiler locations and keeps one-based coordinates', () => {
    expect(parseTerminalLocation("src/app.ts(12,7): error TS2304: Cannot find name 'missing'.", files)).toEqual({
      file: 'src/app.ts',
      line: 12,
      column: 7,
    });
  });

  it('maps absolute Node stack paths back to the project file', () => {
    expect(parseTerminalLocation('    at /codeforge/workspace-abcd/src/main.js:4:9', files)).toEqual({
      file: 'src/main.js',
      line: 4,
      column: 9,
    });
  });

  it('parses Vite-style locations and ignores paths outside the project', () => {
    expect(parseTerminalLocation('src/app.ts:3:2: error: Unexpected token', files)).toEqual({
      file: 'src/app.ts',
      line: 3,
      column: 2,
    });
    expect(parseTerminalLocation('node_modules/library/index.js:3:2: error', files)).toBeNull();
  });

  it('keeps dependency/build and oversized project files when importing shell edits', () => {
    const oversized = 'x'.repeat(1024 * 1024 + 1);
    expect(mergeWorkspaceTextFiles(
      { 'src/app.ts': 'updated', 'package.json': '{}', 'node_modules/pkg/index.js': 'runtime copy' },
      {
        'src/app.ts': { content: 'old', language: 'typescript' },
        'dist/site.js': { content: 'tracked build output', language: 'javascript' },
        'large.txt': { content: oversized, language: 'text' },
      },
    )).toEqual({
      'src/app.ts': 'updated',
      'package.json': '{}',
      'dist/site.js': 'tracked build output',
      'large.txt': oversized,
    });
  });

  it('converts a parsed location to an editor problem', () => {
    expect(terminalIssueDiagnostic({
      file: 'src/app.ts',
      line: 2,
      column: 5,
      message: 'Build failed',
    })).toMatchObject({
      file: 'src/app.ts',
      line: 2,
      column: 5,
      severity: 'error',
      source: 'Terminal',
    });
  });
});
