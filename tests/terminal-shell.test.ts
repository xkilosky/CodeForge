import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TERMINAL_BASH_RC } from '../src/core/terminalShell';

describe('interactive Bash helpers', () => {
  it('is syntactically valid Bash when a local Bash executable is available', () => {
    const result = spawnSync('bash', ['-n'], { input: TERMINAL_BASH_RC, encoding: 'utf8' });
    if (result.error && 'code' in result.error && result.error.code === 'ENOENT') return;
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });

  it('emits visible syntax colors for keywords, numbers, and comments', () => {
    const script = `${TERMINAL_BASH_RC}\nprintf '%s\\n' 'const answer = 42; // note' | bat -`;
    const result = spawnSync('bash', ['--noprofile', '--norc', '-c', script], { encoding: 'utf8' });
    if (result.error && 'code' in result.error && result.error.code === 'ENOENT') return;
    expect(result.error).toBeUndefined();
    expect(result.stdout).toContain('\u001b[35mconst\u001b[0m');
    expect(result.stdout).toContain('\u001b[36m42\u001b[0m');
    expect(result.stdout).toContain('\u001b[2;90m// note');
  });

  it('finds nested text files when the basename casing differs and highlights CSS tokens', () => {
    const root = mkdtempSync(join(tmpdir(), 'codeforge-bat-'));
    try {
      mkdirSync(join(root, 'src'));
      writeFileSync(join(root, 'src', 'style.css'), 'body { color: red; }\n');
      const script = `${TERMINAL_BASH_RC}
cd ${JSON.stringify(root)}
bat Style.css`;
      const result = spawnSync('bash', ['--noprofile', '--norc', '-c', script], { encoding: 'utf8' });
      if (result.error && 'code' in result.error && result.error.code === 'ENOENT') return;
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('\u001b[36mbody\u001b[0m');
      expect(result.stdout).toContain('\u001b[36mcolor\u001b[0m');
      expect(result.stdout).toContain('\u001b[36mred\u001b[0m');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('provides dependency-free highlighted file and diff viewers', () => {
    expect(TERMINAL_BASH_RC).toContain('bat()');
    expect(TERMINAL_BASH_RC).toContain('line-numbered, color-highlighted file viewer');
    expect(TERMINAL_BASH_RC).toContain('_cf_bat_highlight');
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
