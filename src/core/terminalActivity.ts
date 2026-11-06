export interface TerminalActivity {
  label: string;
  percent: number | null;
  startedAt: number;
}

export function describeTerminalCommand(command: string): string {
  const firstLine = command.split(/[\r\n]/, 1)[0]?.trim() ?? '';
  const normalized = firstLine.replace(/^(?:sudo\s+)?/, '').toLowerCase();
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:test|run\s+(?:test|check))\b|\b(?:vitest|jest|pytest)\b/.test(normalized)) {
    return 'Running tests';
  }
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b|\b(?:vite|tsc|webpack|rollup)\b.*\bbuild\b/.test(normalized)) {
    return 'Building project';
  }
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:install|ci|add)\b|\b(?:pip|pip3)\s+install\b|\bcargo\s+(?:add|install)\b/.test(normalized)) {
    return 'Installing dependencies';
  }
  if (/\b(?:curl|wget|aria2c|git\s+clone)\b/.test(normalized)) return 'Downloading files';

  const executable = firstLine.match(/(?:^|\s)([\w./-]+)(?:\s|$)/)?.[1];
  return executable ? `Running ${executable}` : 'Running command';
}

export function parseTerminalProgress(text: string): number | null {
  const percentMatches = Array.from(text.matchAll(/(?:^|\s)(\d{1,3}(?:\.\d+)?)\s*%/g));
  const latestPercent = percentMatches.at(-1);
  if (latestPercent) {
    const value = Number(latestPercent[1]);
    return Number.isFinite(value) && value >= 0 && value <= 100 ? Math.round(value) : null;
  }

  const fractionMatches = Array.from(text.matchAll(/(?:^|\s)(\d+)\s*\/\s*(\d+)(?:\s|$)/g));
  const latestFraction = fractionMatches.at(-1);
  if (latestFraction) {
    const current = Number(latestFraction[1]);
    const total = Number(latestFraction[2]);
    if (total > 0 && current >= 0 && current <= total) return Math.round((current / total) * 100);
  }

  return null;
}
