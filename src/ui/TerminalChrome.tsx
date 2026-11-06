import { useEffect, useState, type RefObject } from 'react';
import type { Terminal as TerminalType } from '@xterm/xterm';
import type { TerminalIssue } from '../core/terminalDiagnostics';
import type { TerminalActivity } from '../core/terminalActivity';

export type TerminalStatus = 'starting' | 'ready' | 'stopped' | 'error';

interface TerminalChromeProps {
  status: TerminalStatus;
  statusMessage: string;
  activity: TerminalActivity | null;
  projectName: string;
  activePath: string;
  terminalRef: RefObject<TerminalType | null>;
  terminalHostRef: RefObject<HTMLDivElement | null>;
  issues: TerminalIssue[];
  onRunActiveFile: () => void;
  onClear: () => void;
  onRestart: () => void;
  sendInput: (data: string) => void;
  onStatusMessage: (message: string) => void;
  onOpenIssue: (file: string, line: number, column: number) => void;
}

const MOBILE_KEYS = [
  { label: 'Esc', title: 'Escape', data: '\u001b' },
  { label: 'Tab', title: 'Tab', data: '\t' },
  { label: '^C', title: 'Ctrl+C · interrupt current command', data: '\u0003' },
  { label: '^D', title: 'Ctrl+D · send end of input', data: '\u0004' },
  { label: '^L', title: 'Ctrl+L · clear the shell screen', data: '\u000c' },
  { label: '↑', title: 'Up arrow · previous command', data: '\u001b[A' },
  { label: '↓', title: 'Down arrow · next command', data: '\u001b[B' },
  { label: '←', title: 'Left arrow', data: '\u001b[D' },
  { label: '→', title: 'Right arrow', data: '\u001b[C' },
] as const;

function changeFontSize(terminalRef: RefObject<TerminalType | null>, delta: number): void {
  const terminal = terminalRef.current;
  if (!terminal) return;
  const size = Number(terminal.options.fontSize ?? 13);
  terminal.options.fontSize = Math.max(10, Math.min(20, size + delta));
  terminal.refresh(0, Math.max(0, terminal.rows - 1));
}

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
}

export function TerminalChrome({
  status,
  statusMessage,
  activity,
  projectName,
  activePath,
  terminalRef,
  terminalHostRef,
  issues,
  onRunActiveFile,
  onClear,
  onRestart,
  sendInput,
  onStatusMessage,
  onOpenIssue,
}: TerminalChromeProps) {
  const runQuickCommand = (command: string) => {
    sendInput(`${command}\r`);
    terminalRef.current?.focus();
  };

  const sendShortcut = (data: string) => {
    sendInput(data);
    terminalRef.current?.focus();
  };

  const copySelection = async () => {
    const selection = terminalRef.current?.getSelection() ?? '';
    if (!selection) {
      onStatusMessage('Select terminal text first, then tap Copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(selection);
      onStatusMessage('Selection copied.');
    } catch {
      onStatusMessage('Clipboard access was blocked by the browser.');
    }
  };

  const pasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        onStatusMessage('Clipboard is empty.');
        return;
      }
      sendInput(text);
      terminalRef.current?.focus();
      onStatusMessage('Pasted from clipboard.');
    } catch {
      onStatusMessage('Clipboard access was blocked. Use the phone keyboard’s Paste command.');
    }
  };

  const quickCommands = ['pwd', 'help', 'echo ready'];
  const [activityNow, setActivityNow] = useState(Date.now());

  useEffect(() => {
    if (!activity) return;
    setActivityNow(Date.now());
    const timer = setInterval(() => setActivityNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activity?.startedAt]);

  return (
    <>
      <header className="terminal-topbar">
        <div className="terminal-identity">
          <span className="terminal-mark" aria-hidden="true">$_</span>
          <div className="terminal-title-block">
            <div className="terminal-title-line">
              <h2>Terminal</h2>
              <span className="terminal-project-name" title={projectName}>{projectName}</span>
            </div>
            <p className="terminal-context">Browser-local Bash <span aria-hidden="true">/</span> {activePath || 'project root'}</p>
          </div>
        </div>
        <div className="terminal-topbar-tools">
          <span className={`terminal-state-pill terminal-state-${status}`} role="status">
            <span className="terminal-status" aria-hidden="true" />
            <span className="terminal-status-message" title={statusMessage}>{status === 'ready' ? 'Ready' : status === 'error' ? 'Needs attention' : status === 'stopped' ? 'Stopped' : 'Starting'}</span>
          </span>
        </div>
      </header>

      <div className="terminal-controlbar">
        <div className="terminal-control-group terminal-run-controls">
          <button type="button" className="terminal-primary-action" onClick={onRunActiveFile} disabled={!activePath} title="Run a Bash script in this terminal, or run the active project in Preview">
            <span aria-hidden="true">▶</span> Run file
          </button>
          <div className="terminal-quick-commands" aria-label="Quick commands">
            <span>Try</span>
            {quickCommands.map((command) => (
              <button type="button" key={command} disabled={status !== 'ready'} onClick={() => runQuickCommand(command)}>{command}</button>
            ))}
          </div>
        </div>
        <div className="terminal-control-group terminal-utility-controls">
          <button type="button" onClick={() => void copySelection()} title="Copy selected terminal text">Copy</button>
          <button type="button" onClick={() => void pasteClipboard()} disabled={status !== 'ready'} title="Paste clipboard text into the shell">Paste</button>
          <button type="button" className="terminal-font-control" onClick={() => changeFontSize(terminalRef, -1)} title="Decrease terminal text size">A−</button>
          <button type="button" className="terminal-font-control" onClick={() => changeFontSize(terminalRef, 1)} title="Increase terminal text size">A+</button>
          <button type="button" onClick={onClear} title="Clear visible output and terminal problems">Clear</button>
          <button type="button" onClick={onRestart} title={status === 'error' ? 'Retry starting the terminal' : status === 'stopped' ? 'Start a new shell session' : 'Restart the shell'}>{status === 'error' ? 'Retry' : status === 'stopped' ? 'Start' : 'Restart'}</button>
        </div>
      </div>

      {activity && status !== 'error' ? (
        <section className="terminal-activity" aria-label={`${activity.label}${activity.percent === null ? '' : `, ${activity.percent}%`}`}>
          <div className="terminal-activity-copy">
            <span className="terminal-activity-spinner" aria-hidden="true" />
            <strong>{activity.label}</strong>
            <span className="terminal-activity-elapsed">{formatElapsed(activityNow - activity.startedAt)}</span>
            {activity.percent !== null ? <span className="terminal-activity-percent">{activity.percent}%</span> : null}
          </div>
          <div
            className={`terminal-progress-track${activity.percent === null ? ' is-indeterminate' : ''}`}
            role="progressbar"
            aria-label={activity.label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={activity.percent ?? undefined}
          >
            <span
              className="terminal-progress-fill"
              style={{ width: activity.percent === null ? '34%' : `${activity.percent}%` }}
            />
          </div>
        </section>
      ) : null}

      {status === 'error' ? (
        <div className="terminal-error-banner" role="alert">
          <strong>Bash needs attention</strong>
          <span>{statusMessage}</span>
          <span>Use Retry above to start Bash again.</span>
        </div>
      ) : null}

      {issues.length ? (
        <div className="terminal-issues" aria-label="Detected terminal errors">
          {issues.slice(-4).map((issue, index) => (
            <button
              type="button"
              className="terminal-issue"
              key={`${issue.file}:${issue.line}:${issue.column}:${index}`}
              onClick={() => onOpenIssue(issue.file, issue.line, issue.column)}
              title={`${issue.file}:${issue.line}:${issue.column}`}
            >
              <span className="terminal-issue-location">{issue.file}:{issue.line}:{issue.column}</span>
              <span className="terminal-issue-message">{issue.message}</span>
              <span aria-hidden="true">Open ↗</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="terminal-view" ref={terminalHostRef} aria-label="Shell output and input" />

      <div className="terminal-mobile-keys" aria-label="Terminal keyboard shortcuts">
        {MOBILE_KEYS.map((key) => (
          <button type="button" key={key.label} title={key.title} disabled={status !== 'ready'} onClick={() => sendShortcut(key.data)}>{key.label}</button>
        ))}
      </div>
      <div className="terminal-footnote">
        <span className="terminal-footnote-status">{statusMessage}</span>
        <span title="bat FILE for highlighted source; diff -u OLD NEW | delta for colored diffs; choose or fzf for arrow-key menus">bat · delta · choose/fzf</span>
      </div>
    </>
  );
}
