import { describe, expect, it } from 'vitest';
import { describeTerminalCommand, parseTerminalProgress } from '../src/core/terminalActivity';

describe('terminal activity feedback', () => {
  it('recognizes builds, tests, installs, and ordinary commands', () => {
    expect(describeTerminalCommand('npm run build')).toBe('Building project');
    expect(describeTerminalCommand('npm test -- --run')).toBe('Running tests');
    expect(describeTerminalCommand('pnpm install')).toBe('Installing dependencies');
    expect(describeTerminalCommand('curl -O https://example.test/archive.zip')).toBe('Downloading files');
    expect(describeTerminalCommand('sleep 10')).toBe('Running sleep');
  });

  it('reads percentages and completed/total counters from live output', () => {
    expect(parseTerminalProgress('Downloading package · 42%')).toBe(42);
    expect(parseTerminalProgress('Tests 3/8 passed')).toBe(38);
    expect(parseTerminalProgress('2% then 7%')).toBe(7);
    expect(parseTerminalProgress('Waiting for output')).toBeNull();
    expect(parseTerminalProgress('Invalid 140%')).toBeNull();
  });
});
