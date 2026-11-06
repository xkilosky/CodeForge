import { describe, expect, it } from 'vitest';
import { colorizeTerminalLine, mayBeRichTerminalLinePrefix } from '../src/core/terminalColors';

describe('rich terminal output', () => {
  it('colors log timestamps, levels, and leaves the message clearly separated', () => {
    const line = colorizeTerminalLine('2026-11-06T20:15:30Z ERROR: Build failed');
    expect(line).toContain('\u001b[36m2026-11-06T20:15:30Z\u001b[0m');
    expect(line).toContain('\u001b[1m\u001b[31mERROR\u001b[0m');
    expect(line.endsWith('Build failed')).toBe(true);
  });

  it('uses distinct warning and success colors', () => {
    expect(colorizeTerminalLine('WARN: deprecated option')).toContain('\u001b[33mWARN\u001b[0m');
    expect(colorizeTerminalLine('PASS: all tests passed')).toContain('\u001b[32mPASS\u001b[0m');
    expect(colorizeTerminalLine('ERROR: command failed')).toContain('\u001b[1m\u001b[31mERROR\u001b[0m: command failed');
  });

  it('makes branch names and file states scannable in short Git status output', () => {
    expect(colorizeTerminalLine('## feature/login...origin/feature/login')).toContain('\u001b[32mfeature/login\u001b[0m');
    expect(colorizeTerminalLine(' M src/App.tsx')).toContain('\u001b[33m M\u001b[0m');
    expect(colorizeTerminalLine('?? new-file.txt')).toContain('\u001b[32m??\u001b[0m');
    expect(colorizeTerminalLine('UU conflict.ts')).toContain('\u001b[1m\u001b[31mUU\u001b[0m');
  });

  it('preserves existing ANSI output and ordinary terminal text', () => {
    expect(colorizeTerminalLine('\u001b[31mred already\u001b[0m')).toBe('\u001b[31mred already\u001b[0m');
    expect(colorizeTerminalLine('plain output')).toBe('plain output');
    expect(mayBeRichTerminalLinePrefix('2026-11')).toBe(true);
    expect(mayBeRichTerminalLinePrefix('## main')).toBe(true);
    expect(mayBeRichTerminalLinePrefix('pwd')).toBe(false);
  });
});
