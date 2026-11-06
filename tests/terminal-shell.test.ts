import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { TERMINAL_BASH_RC } from '../src/core/terminalShell';

describe('interactive Bash helpers', () => {
  it('is syntactically valid Bash when a local Bash executable is available', () => {
    const result = spawnSync('bash', ['-n'], { input: TERMINAL_BASH_RC, encoding: 'utf8' });
    if (result.error && 'code' in result.error && result.error.code === 'ENOENT') return;
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });

  it('provides dependency-free highlighted file and diff viewers', () => {
    expect(TERMINAL_BASH_RC).toContain('bat()');
    expect(TERMINAL_BASH_RC).toContain('line-numbered, color-highlighted file viewer');
    expect(TERMINAL_BASH_RC).toContain('delta()');
    expect(TERMINAL_BASH_RC).toContain('diff()');
    expect(TERMINAL_BASH_RC).toContain('Colorizes unified diff headers');
  });

  it('provides arrow-key menus and keeps their selection usable in a pipeline', () => {
    expect(TERMINAL_BASH_RC).toContain('fzf()');
    expect(TERMINAL_BASH_RC).toContain("'[A')");
    expect(TERMINAL_BASH_RC).toContain("'[B')");
    expect(TERMINAL_BASH_RC).toContain('read -r -s -N 1 key');
    expect(TERMINAL_BASH_RC).toContain('choose()');
    expect(TERMINAL_BASH_RC).toContain('cf-help()');
    expect(TERMINAL_BASH_RC).toContain("printf '%s\\n' \"$selected\"");
  });
});
