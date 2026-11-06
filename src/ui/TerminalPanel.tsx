import { useCallback, useEffect, useRef, useState } from 'react';
import type { FitAddon as FitAddonType } from '@xterm/addon-fit';
import type { Terminal as TerminalType } from '@xterm/xterm';
import type { WebContainerProcess } from '@webcontainer/api';
import type { FileMap } from '../core/types';
import { setTerminalDiagnostics } from '../core/diagnosticsStore';
import { parseTerminalLocation, terminalIssueDiagnostic, type TerminalIssue } from '../core/terminalDiagnostics';
import {
  mergeWorkspaceTextFiles,
  readWorkspaceTextFiles,
  syncWorkspace,
  watchWorkspace,
} from '../core/terminalRuntime';
import '@xterm/xterm/css/xterm.css';

export interface TerminalRunRequest {
  path: string;
  sequence: number;
}

interface TerminalPanelProps {
  active: boolean;
  onSwitchShell: (shell: 'bash' | 'node') => void;
  projectId: string;
  projectName: string;
  files: FileMap;
  activePath: string;
  runRequest?: TerminalRunRequest;
  onRunActiveFile: () => void;
  onReplaceFiles: (projectId: string, files: Record<string, string>) => void;
  onOpenIssue: (file: string, line: number, column: number) => void;
}

type TerminalStatus = 'starting' | 'ready' | 'error';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function commandForPath(path: string): string | null {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'tsx' || extension === 'jsx') return `npx tsx ${shellQuote(path)}`;
  if (['ts', 'mts', 'cts'].includes(extension ?? '')) {
    return `node --experimental-strip-types ${shellQuote(path)}`;
  }
  if (['js', 'mjs', 'cjs'].includes(extension ?? '')) return `node ${shellQuote(path)}`;
  return null;
}

async function submitRunCommand(writer: WritableStreamDefaultWriter<string>, command: string): Promise<void> {
  await writer.write('\u0003');
  await new Promise<void>((resolve) => setTimeout(resolve, 80));
  await writer.write(`${command}\n`);
}

export function TerminalPanel({
  active,
  onSwitchShell,
  projectId,
  projectName,
  files,
  activePath,
  runRequest,
  onRunActiveFile,
  onReplaceFiles,
  onOpenIssue,
}: TerminalPanelProps) {
  const terminalHost = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<TerminalType | null>(null);
  const fitRef = useRef<FitAddonType | null>(null);
  const processRef = useRef<WebContainerProcess | null>(null);
  const inputWriterRef = useRef<WritableStreamDefaultWriter<string> | null>(null);
  const filesRef = useRef(files);
  const onReplaceFilesRef = useRef(onReplaceFiles);
  const onOpenIssueRef = useRef(onOpenIssue);
  const pendingRunRef = useRef<TerminalRunRequest | undefined>(undefined);
  const handledRunSequence = useRef(0);
  const outputLineBuffer = useRef('');
  const lastErrorLine = useRef('');
  const issuesRef = useRef<TerminalIssue[]>([]);
  const [status, setStatus] = useState<TerminalStatus>('starting');
  const [statusMessage, setStatusMessage] = useState('Starting browser runtime…');
  const [issues, setIssues] = useState<TerminalIssue[]>([]);
  const [serverUrl, setServerUrl] = useState<string | null>(null);

  filesRef.current = files;
  onReplaceFilesRef.current = onReplaceFiles;
  onOpenIssueRef.current = onOpenIssue;

  const fitTerminal = useCallback(() => {
    const terminal = terminalRef.current;
    const host = terminalHost.current;
    if (!terminal || !host || !active || host.clientWidth === 0 || host.clientHeight === 0) return;
    try {
      fitRef.current?.fit();
      processRef.current?.resize({ cols: terminal.cols, rows: terminal.rows });
    } catch {
      // xterm can reject a fit while a hidden/mobile viewport has zero dimensions.
    }
  }, [active]);

  useEffect(() => {
    let disposed = false;
    let unwatch: (() => void) | undefined;
    let unsubscribeServer: (() => void) | undefined;
    let scanTimer: ReturnType<typeof setTimeout> | undefined;
    let outputReader: ReadableStreamDefaultReader<string> | undefined;

    let terminal: TerminalType | null = null;

    setStatus('starting');
    setStatusMessage('Starting browser runtime…');
    setServerUrl(null);
    issuesRef.current = [];
    setIssues([]);
    setTerminalDiagnostics([]);

    const appendOutput = (chunk: string) => {
      terminal?.write(chunk);
      const combined = outputLineBuffer.current + chunk;
      const lines = combined.split(/\r?\n/);
      outputLineBuffer.current = lines.pop() ?? '';
      for (const rawLine of lines) {
        const line = rawLine.replace(/\r/g, '');
        if (/\b(error|exception|failed|failure)\b/i.test(line) && !/^\s*at\s/.test(line)) {
          lastErrorLine.current = line.trim().slice(0, 300);
        }
        const location = parseTerminalLocation(line, Object.keys(filesRef.current));
        if (!location) continue;
        const message = lastErrorLine.current || line.trim().replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
        lastErrorLine.current = '';
        const issue: TerminalIssue = { ...location, message: message || 'Terminal reported an error at this location.' };
        const next = [
          ...issuesRef.current.filter(
            (item) => !(item.file === issue.file && item.line === issue.line && item.message === issue.message),
          ),
          issue,
        ].slice(-20);
        issuesRef.current = next;
        setIssues(next);
        setTerminalDiagnostics(next.map(terminalIssueDiagnostic));
      }
    };

    const queueRun = (request: TerminalRunRequest) => {
      const writer = inputWriterRef.current;
      const path = request.path.replace(/\\/g, '/').replace(/^\/+/, '');
      if (!path || !filesRef.current[path]) return;
      const command = commandForPath(path);
      if (!command) {
        terminal?.writeln(`\r\n\x1b[33mRun Active File supports JavaScript and TypeScript files.\x1b[0m`);
        return;
      }
      if (!writer) {
        pendingRunRef.current = request;
        return;
      }
      pendingRunRef.current = undefined;
      issuesRef.current = [];
      setIssues([]);
      setTerminalDiagnostics([]);
      void syncWorkspace(projectId, filesRef.current)
        .then(() => submitRunCommand(writer, command))
        .catch((error: unknown) => {
          if (!disposed) setStatusMessage(error instanceof Error ? error.message : String(error));
        });
    };

    const start = async () => {
      try {
        // The xterm chunk loads lazily; wait for its view before attaching a shell.
        let framesWaited = 0;
        while (!disposed && !terminalRef.current && framesWaited < 1200) {
          framesWaited += 1;
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        if (disposed) return;
        if (!terminalRef.current) throw new Error('The terminal display did not finish loading.');
        terminal = terminalRef.current;
        setStatusMessage('Booting WebContainer…');
        const workspace = await syncWorkspace(projectId, filesRef.current);
        if (disposed) return;
        outputLineBuffer.current = '';
        const unsubscribe = workspace.container.on('server-ready', (_port, url) => {
          if (!disposed) setServerUrl(url);
        });
        unsubscribeServer = unsubscribe;
        unwatch = watchWorkspace(workspace.container, workspace.cwd, () => {
          if (scanTimer) clearTimeout(scanTimer);
          scanTimer = setTimeout(() => {
            void readWorkspaceTextFiles(workspace.container, workspace.cwd).then((scanned) => {
              if (disposed) return;
              const current = filesRef.current;
              const snapshot = mergeWorkspaceTextFiles(scanned, current);
              const unchanged = Object.keys(snapshot).length === Object.keys(current).length &&
                Object.entries(snapshot).every(([path, content]) => current[path]?.content === content);
              if (!unchanged && (Object.keys(snapshot).length > 0 || Object.keys(current).length === 0)) {
                onReplaceFilesRef.current(projectId, snapshot);
              }
            }).catch(() => undefined);
          }, 180);
        });
        setStatusMessage('Opening interactive shell…');
        const process = await workspace.container.spawn('jsh', [], {
          cwd: workspace.cwd,
          terminal: {
            cols: Math.max(terminal.cols, 60),
            rows: Math.max(terminal.rows, 12),
          },
        });
        if (disposed) {
          process.kill();
          return;
        }
        processRef.current = process;
        const writer = process.input.getWriter();
        inputWriterRef.current = writer;
        setStatus('ready');
        setStatusMessage('Interactive shell ready');
        terminal.writeln(`\x1b[90mCodeForge terminal · ${projectName}\x1b[0m`);
        const pending = pendingRunRef.current;
        if (pending) {
          pendingRunRef.current = undefined;
          queueRun(pending);
        }
        const reader = process.output.getReader();
        outputReader = reader;
        void (async () => {
          try {
            while (!disposed) {
              const { value, done } = await reader.read();
              if (done) break;
              if (value) appendOutput(value);
            }
          } catch (error) {
            if (!disposed) setStatusMessage(error instanceof Error ? error.message : String(error));
          }
        })();
        void process.exit.then((code) => {
          if (!disposed && code !== 0) setStatusMessage(`Shell exited with code ${code}.`);
        });
      } catch (error) {
        if (disposed) return;
        const message = error instanceof Error ? error.message : String(error);
        setStatus('error');
        setStatusMessage(message);
        terminal?.writeln(`\r\n\x1b[31mTerminal failed to start: ${message}\x1b[0m`);
      }
    };

    void start();
    return () => {
      disposed = true;
      if (scanTimer) clearTimeout(scanTimer);
      unwatch?.();
      unsubscribeServer?.();
      processRef.current?.kill();
      processRef.current = null;
      const writer = inputWriterRef.current;
      inputWriterRef.current = null;
      try {
        writer?.releaseLock();
      } catch {
        // The process may have closed its input during cleanup.
      }
      if (outputReader) void outputReader.cancel().catch(() => undefined);
    };
    // A shell is restarted only when the project changes, not for each editor keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    let disposed = false;
    void syncWorkspace(projectId, files).catch((error: unknown) => {
      if (!disposed) {
        setStatus('error');
        setStatusMessage(error instanceof Error ? error.message : String(error));
      }
    });
    return () => {
      disposed = true;
    };
  }, [projectId, files]);

  useEffect(() => {
    if (!runRequest || handledRunSequence.current === runRequest.sequence) return;
    handledRunSequence.current = runRequest.sequence;
    pendingRunRef.current = runRequest;
    // Once a shell is ready, run immediately; otherwise startup consumes the queued request.
    if (inputWriterRef.current && terminalRef.current) {
      const path = runRequest.path.replace(/\\/g, '/').replace(/^\/+/, '');
      const command = commandForPath(path);
      if (filesRef.current[path] && command) {
        pendingRunRef.current = undefined;
        pendingRunRef.current = undefined;
        issuesRef.current = [];
        setIssues([]);
        setTerminalDiagnostics([]);
        void syncWorkspace(projectId, filesRef.current)
          .then(() => {
            const writer = inputWriterRef.current;
            if (!writer) {
              pendingRunRef.current = runRequest;
              return;
            }
            return submitRunCommand(writer, command);
          })
          .catch(() => undefined);
      } else {
        pendingRunRef.current = undefined;
        terminalRef.current.writeln('\r\n\x1b[33mRun Active File supports JavaScript and TypeScript files.\x1b[0m');
      }
    }
  }, [runRequest]);

  useEffect(() => {
    let disposed = false;
    let terminal: TerminalType | undefined;
    let fit: FitAddonType | undefined;
    let observer: ResizeObserver | undefined;
    let removeResizeListener: (() => void) | undefined;
    let dataSubscription: { dispose(): void } | undefined;

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (disposed || !terminalHost.current) return;
      terminal = new Terminal({
        allowProposedApi: false,
        cursorBlink: true,
        convertEol: true,
        fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
        fontSize: 13,
        scrollback: 5000,
        theme: {
          background: '#0c0f15',
          foreground: '#e2e7f0',
          cursor: '#78a9ff',
          selectionBackground: '#354052',
          black: '#11141b',
          red: '#e78d9b',
          green: '#8fd2a0',
          yellow: '#e2b76f',
          blue: '#78a9ff',
          magenta: '#c0a3ed',
          cyan: '#8dcdf5',
          white: '#e2e7f0',
          brightBlack: '#8792a3',
          brightRed: '#f29ba8',
          brightGreen: '#a6e7b4',
          brightYellow: '#f1cb83',
          brightBlue: '#9cbfff',
          brightMagenta: '#d6bdf7',
          brightCyan: '#a8defb',
          brightWhite: '#ffffff',
        },
      });
      fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(terminalHost.current);
      terminalRef.current = terminal;
      fitRef.current = fit;
      dataSubscription = terminal.onData((data) => {
        const writer = inputWriterRef.current;
        if (writer) void writer.write(data).catch(() => undefined);
      });
      observer = new ResizeObserver(() => {
        if (active) {
          try {
            fit?.fit();
            processRef.current?.resize({ cols: terminal!.cols, rows: terminal!.rows });
          } catch {
            // Ignore zero-sized intermediary layouts.
          }
        }
      });
      observer.observe(terminalHost.current);
      const resize = () => {
        if (!active || !terminalHost.current?.clientHeight) return;
        try {
          fit?.fit();
          processRef.current?.resize({ cols: terminal!.cols, rows: terminal!.rows });
        } catch {
          // Mobile virtual keyboards can temporarily report a zero-height viewport.
        }
      };
      window.addEventListener('resize', resize);
      window.visualViewport?.addEventListener('resize', resize);
      removeResizeListener = () => {
        window.removeEventListener('resize', resize);
        window.visualViewport?.removeEventListener('resize', resize);
      };
      requestAnimationFrame(resize);
    })().catch((error: unknown) => {
      if (!disposed) {
        setStatus('error');
        setStatusMessage(error instanceof Error ? error.message : String(error));
      }
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      removeResizeListener?.();
      dataSubscription?.dispose();
      terminal?.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(fitTerminal);
    return () => cancelAnimationFrame(frame);
  }, [active, fitTerminal]);

  const clearTerminal = () => {
    terminalRef.current?.clear();
    issuesRef.current = [];
    setIssues([]);
    outputLineBuffer.current = '';
    lastErrorLine.current = '';
    setTerminalDiagnostics([]);
  };

  return (
    <section className={`terminal-overlay${active ? ' is-active' : ''}`} aria-label="Integrated terminal" aria-hidden={!active}>
      <div className="terminal-toolbar">
        <div className="terminal-heading">
          <span className={`terminal-status terminal-status-${status}`} aria-hidden="true" />
          <strong>Terminal</strong>
          <span className="terminal-project-name">{projectName}</span>
          <span className="terminal-status-message" role="status">{statusMessage}</span>
        </div>
        <div className="terminal-actions">
          {serverUrl ? <a className="terminal-server-link" href={serverUrl} target="_blank" rel="noreferrer">Open running app ↗</a> : null}
          <button type="button" onClick={() => onSwitchShell('bash')} title="Switch to browser-local Bash">Bash</button>
          <button type="button" onClick={onRunActiveFile} disabled={!activePath} title="Run the active JavaScript or TypeScript file">Run file</button>
          <button type="button" onClick={clearTerminal} title="Clear terminal output and terminal problems">Clear</button>
        </div>
      </div>
      {issues.length ? (
        <div className="terminal-issues" aria-label="Detected terminal errors">
          {issues.slice(-4).map((issue, index) => (
            <button
              type="button"
              className="terminal-issue"
              key={`${issue.file}:${issue.line}:${issue.column}:${index}`}
              onClick={() => onOpenIssueRef.current(issue.file, issue.line, issue.column)}
              title={`${issue.file}:${issue.line}:${issue.column}`}
            >
              <span className="terminal-issue-location">{issue.file}:{issue.line}:{issue.column}</span>
              <span className="terminal-issue-message">{issue.message}</span>
              <span aria-hidden="true">Open ↗</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="terminal-view" ref={terminalHost} aria-label="Shell output and input" />
    </section>
  );
}
