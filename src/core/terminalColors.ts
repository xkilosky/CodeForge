const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/;

const COLORS = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  cyan: '\u001b[36m',
  magenta: '\u001b[35m',
} as const;

function paint(text: string, color: string, bold = false): string {
  return `${bold ? COLORS.bold : ''}${color}${text}${COLORS.reset}`;
}

function colorForLevel(level: string): string {
  switch (level.toUpperCase()) {
    case 'ERROR':
    case 'FATAL':
    case 'CRITICAL':
    case 'EXCEPTION':
    case 'FAILED':
      return COLORS.red;
    case 'WARN':
    case 'WARNING':
      return COLORS.yellow;
    case 'SUCCESS':
    case 'PASS':
    case 'PASSED':
    case 'DONE':
      return COLORS.green;
    case 'DEBUG':
    case 'TRACE':
      return COLORS.dim;
    default:
      return COLORS.blue;
  }
}

function colorizeGitStatus(line: string): string | null {
  const branch = line.match(/^(##\s+)(.+?)(\.\.\..*)?$/);
  if (branch) {
    const upstream = branch[3] ?? '';
    return `${COLORS.dim}${branch[1]}${COLORS.reset}${paint(branch[2], COLORS.green, true)}${upstream ? paint(upstream, COLORS.yellow) : ''}`;
  }

  const shortStatus = line.match(/^([ MADRCU?!]{2}) (.+)$/);
  if (shortStatus) {
    const [, code, path] = shortStatus;
    const normalized = code.replace(/\s/g, '');
    if (!normalized) return null;
    const color = /[U]/.test(normalized) || normalized === 'AA' || normalized === 'DD'
      ? COLORS.red
      : normalized.includes('D')
        ? COLORS.red
        : normalized.includes('A') || normalized === '??'
          ? COLORS.green
          : normalized.includes('R') || normalized.includes('C')
            ? COLORS.cyan
            : normalized.includes('M')
              ? COLORS.yellow
              : COLORS.dim;
    return `${paint(code, color, normalized.includes('U') || normalized === 'AA' || normalized === 'DD')} ${paint(path, color)}`;
  }

  if (/^Changes to be committed:/.test(line)) return paint(line, COLORS.green, true);
  if (/^Changes not staged for commit:/.test(line)) return paint(line, COLORS.yellow, true);
  if (/^Untracked files:/.test(line)) return paint(line, COLORS.green, true);
  if (/^Unmerged paths:/.test(line)) return paint(line, COLORS.red, true);
  if (/^On branch\s+/.test(line) || /^##\s+/.test(line)) return paint(line, COLORS.green, true);
  if (/^nothing to commit(?:, working tree clean)?\.?$/.test(line) || /working tree clean/.test(line)) {
    return paint(line, COLORS.green);
  }

  const fileStatus = line.match(/^(\s+)(new file|modified|deleted|renamed|copied|both modified|both added|both deleted):\s+(.+)$/i);
  if (fileStatus) {
    const statusColor = /deleted/i.test(fileStatus[2]) ? COLORS.red
      : /modified/i.test(fileStatus[2]) ? COLORS.yellow
        : /renamed|copied/i.test(fileStatus[2]) ? COLORS.cyan
          : COLORS.green;
    return `${fileStatus[1]}${paint(`${fileStatus[2]}:`, statusColor, true)} ${paint(fileStatus[3], statusColor)}`;
  }

  return null;
}

function colorizeLogLine(line: string): string | null {
  const timestamped = line.match(/^(\s*)(\[?\d{4}-\d\d-\d\d(?:[T ][^\s\]]+)?\]?)(\s+)(.*)$/);
  const leading = timestamped ? `${timestamped[1]}${paint(timestamped[2], COLORS.cyan)}${timestamped[3]}` : '';
  const body = timestamped ? timestamped[4] : line;
  const level = body.match(/^(\[?)(TRACE|DEBUG|INFO|NOTICE|WARN(?:ING)?|ERROR|FATAL|CRITICAL|EXCEPTION|SUCCESS|PASS(?:ED)?|DONE)(\]?)(\s*[:|,-]?\s*)(.*)$/i);
  if (level) {
    const label = `${level[1]}${level[2]}${level[3]}`;
    return `${leading}${paint(label, colorForLevel(level[2]), true)}${level[4]}${level[5]}`;
  }
  if (!timestamped) return null;
  return `${leading}${body}`;
}

/** Adds semantic color to plain log and Git status lines without touching ANSI or TUI output. */
export function colorizeTerminalLine(line: string): string {
  if (!line || ANSI_ESCAPE.test(line)) return line;
  const gitLine = colorizeGitStatus(line);
  if (gitLine !== null) return gitLine;
  const logLine = colorizeLogLine(line);
  if (logLine !== null) return logLine;

  if (/^\s*(?:error|fatal|exception|failed|failure|npm error|command not found)\b/i.test(line)) {
    return paint(line, COLORS.red);
  }
  if (/^\s*(?:warn|warning|npm warn)\b/i.test(line)) return paint(line, COLORS.yellow);
  if (/^\s*(?:success|passed|done|ready)\b/i.test(line)) return paint(line, COLORS.green);
  return line;
}

/** True while an incomplete stream chunk could still become a styled log or Git line. */
export function mayBeRichTerminalLinePrefix(line: string): boolean {
  const prefix = line.trimStart();
  if (!prefix) return true;
  if (/^\d{0,4}(?:-\d{0,2}(?:-\d{0,2}(?:[T ].*)?)?)?$/.test(prefix)) return true;
  if ('## '.startsWith(prefix) || prefix.startsWith('##')) return true;
  if (/^[ MADRCU?!]{1,2}$/.test(prefix)) return true;

  const labels = [
    'trace', 'debug', 'info', 'notice', 'warn', 'warning', 'error', 'fatal', 'critical',
    'exception', 'success', 'pass', 'passed', 'done', 'npm error', 'npm warn', 'command not found',
    'changes to be committed:', 'changes not staged for commit:', 'untracked files:', 'unmerged paths:',
    'nothing to commit', 'on branch',
  ];
  const lower = prefix.toLowerCase();
  return labels.some((label) => label.startsWith(lower) || lower.startsWith(label));
}
