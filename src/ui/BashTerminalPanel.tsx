import { useCallback, useEffect, useRef, useState } from 'react';
import type { FitAddon as FitAddonType } from '@xterm/addon-fit';
import type { Terminal as TerminalType } from '@xterm/xterm';
import type { Process as WasmerProcess, ReadableBytes, Sandbox as WasmerSandbox, Wasmer as WasmerClient } from '@wasmer/sdk/browser';
import type { FileMap } from '../core/types';
import { setTerminalDiagnostics } from '../core/diagnosticsStore';
import { parseTerminalLocation, terminalIssueDiagnostic, type TerminalIssue } from '../core/terminalDiagnostics';
import { TerminalChrome, type TerminalStatus } from './TerminalChrome';
import '@xterm/xterm/css/xterm.css';

interface BashTerminalPanelProps {
  active: boolean;
  onRestartTerminal: () => void;
  projectId: string;
  projectName: string;
  files: FileMap;
  activePath: string;
  runRequest?: { path: string; sequence: number };
  onRunRequestHandled: (sequence: number) => void;
  onRunActiveFile: () => void;
  onReplaceFiles: (projectId: string, files: Record<string, string>) => void;
  onOpenIssue: (file: string, line: number, column: number) => void;
}

type TextFiles = Record<string, string>;

const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', '.wasmer', 'dist', 'build', 'coverage']);
const MAX_SYNC_FILE_BYTES = 1024 * 1024;
const MAX_SYNC_TOTAL_BYTES = 10 * 1024 * 1024;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function projectPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  return normalized;
}

function projectFiles(files: FileMap): TextFiles {
  const result: TextFiles = {};
  for (const [rawPath, file] of Object.entries(files)) {
    const path = projectPath(rawPath);
    if (path) result[path] = file.content;
  }
  return result;
}

function equalTextFiles(left: TextFiles, right: TextFiles): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((path) => left[path] === right[path]);
}

async function readSandboxTextFiles(sandbox: WasmerSandbox): Promise<{ files: TextFiles; complete: boolean }> {
  const result: TextFiles = {};
  let totalBytes = 0;
  let complete = true;

  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries = await sandbox.fs.readDir(directory);
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue;
      if (entry.kind === 'directory') {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        await visit(`${directory}/${entry.name}`, prefix ? `${prefix}/${entry.name}` : entry.name);
        continue;
      }
      if (entry.size > MAX_SYNC_FILE_BYTES || totalBytes + entry.size > MAX_SYNC_TOTAL_BYTES) {
        complete = false;
        continue;
      }
      const path = projectPath(prefix ? `${prefix}/${entry.name}` : entry.name);
      if (!path) continue;
      try {
        const contents = await sandbox.fs.readText(`${directory}/${entry.name}`);
        result[path] = contents;
        totalBytes += new TextEncoder().encode(contents).byteLength;
      } catch {
        // Ignore binary or transient files; CodeForge's project model stores text files.
        complete = false;
      }
    }
  };

  await visit('/workspace', '');
  return { files: result, complete };
}

export function BashTerminalPanel({
  active,
  onRestartTerminal,
  projectId,
  projectName,
  files,
  activePath,
  runRequest,
  onRunRequestHandled,
  onRunActiveFile,
  onReplaceFiles,
  onOpenIssue,
}: BashTerminalPanelProps) {
  const terminalHost = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<TerminalType | null>(null);
  const fitRef = useRef<FitAddonType | null>(null);
  const processRef = useRef<WasmerProcess | null>(null);
  const sandboxRef = useRef<WasmerSandbox | null>(null);
  const clientRef = useRef<WasmerClient | null>(null);
  const filesRef = useRef(files);
  const projectNameRef = useRef(projectName);
  const onReplaceFilesRef = useRef(onReplaceFiles);
  const onOpenIssueRef = useRef(onOpenIssue);
  const lastSyncedFilesRef = useRef<TextFiles>({});
  const handledRunSequence = useRef(0);
  const pendingRunRef = useRef<{ path: string; sequence: number } | undefined>(undefined);
  const outputLineBuffer = useRef('');
  const lastErrorLine = useRef('');
  const issuesRef = useRef<TerminalIssue[]>([]);
  const [status, setStatus] = useState<TerminalStatus>('starting');
  const [statusMessage, setStatusMessage] = useState('Starting browser-local Bash…');
  const [issues, setIssues] = useState<TerminalIssue[]>([]);

  filesRef.current = files;
  projectNameRef.current = projectName;
  onReplaceFilesRef.current = onReplaceFiles;
  onOpenIssueRef.current = onOpenIssue;

  const sendInput = useCallback((data: string) => {
    const input = processRef.current?.stdin;
    if (input) void input.write(data).catch(() => undefined);
  }, []);

  const runBashScript = useCallback((request: { path: string; sequence: number }) => {
    const path = request.path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!projectPath(path) || filesRef.current[path] === undefined || !path.toLowerCase().endsWith('.sh')) {
      terminalRef.current?.writeln('\r\n\x1b[33mOnly .sh files run as commands in this Bash terminal. Use CodeForge Run/Preview for app files.\x1b[0m');
      return;
    }
    if (!processRef.current) {
      pendingRunRef.current = request;
      return;
    }
    sendInput(`bash ${shellQuote(path)}\r`);
    terminalRef.current?.focus();
  }, [sendInput]);

  const fitTerminal = useCallback(() => {
    const terminal = terminalRef.current;
    const host = terminalHost.current;
    if (!terminal || !host || !active || host.clientWidth === 0 || host.clientHeight === 0) return;
    try {
      fitRef.current?.fit();
      processRef.current?.resizeTerminal(terminal.cols, terminal.rows);
    } catch {
      // xterm can reject a fit while a hidden/mobile viewport has zero dimensions.
    }
  }, [active]);

  useEffect(() => {
    let disposed = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let terminal: TerminalType | null = null;
    let client: WasmerClient | null = null;
    let sandbox: WasmerSandbox | null = null;
    let process: WasmerProcess | null = null;
    let scanInProgress = false;

    setStatus('starting');
    setStatusMessage('Starting browser-local Bash…');
    issuesRef.current = [];
    setIssues([]);
    setTerminalDiagnostics([]);
    lastSyncedFilesRef.current = projectFiles(filesRef.current);

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
        const issue: TerminalIssue = { ...location, message: message || 'Bash reported an error at this location.' };
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

    const syncEditorFiles = async (activeSandbox: WasmerSandbox, desired: TextFiles) => {
      const lastSynced = lastSyncedFilesRef.current;
      for (const path of Object.keys(lastSynced)) {
        if (desired[path] !== undefined) continue;
        try {
          await activeSandbox.fs.remove(`/workspace/${path}`, { recursive: true });
        } catch {
          // The file may already have been removed by a shell command.
        }
        delete lastSynced[path];
      }
      for (const [path, content] of Object.entries(desired)) {
        if (lastSynced[path] === content) continue;
        const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        if (directory) await activeSandbox.fs.mkdir(`/workspace/${directory}`, { recursive: true });
        await activeSandbox.fs.writeText(`/workspace/${path}`, content);
        lastSynced[path] = content;
      }
    };

    const scanWorkspace = async (activeSandbox: WasmerSandbox) => {
      if (scanInProgress || disposed) return;
      scanInProgress = true;
      try {
        const { files: scanned, complete } = await readSandboxTextFiles(activeSandbox);
        if (disposed) return;
        const current = projectFiles(filesRef.current);
        const lastSynced = lastSyncedFilesRef.current;
        const merged: TextFiles = { ...scanned };

        // Preserve an editor change made since the last sync; otherwise shell-side
        // additions, edits and removals flow back into the saved project.
        for (const [path, content] of Object.entries(current)) {
          const sandboxContent = scanned[path];
          const lastContent = lastSynced[path];
          if (sandboxContent === undefined) {
            if (!complete || lastContent === undefined || content !== lastContent) merged[path] = content;
          } else if (lastContent !== undefined && content !== lastContent && content !== sandboxContent) {
            merged[path] = content;
          }
        }

        for (const path of Object.keys(lastSynced)) {
          if (!complete || scanned[path] !== undefined || merged[path] !== undefined) continue;
          delete lastSynced[path];
        }
        if (!equalTextFiles(merged, scanned)) await syncEditorFiles(activeSandbox, merged);
        lastSyncedFilesRef.current = { ...merged };

        if (!equalTextFiles(merged, current)) onReplaceFilesRef.current(projectId, merged);
      } catch (error) {
        if (!disposed) setStatusMessage(`File sync paused: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        scanInProgress = false;
      }
    };

    const start = async () => {
      try {
        let framesWaited = 0;
        while (!disposed && !terminalRef.current && framesWaited < 1200) {
          framesWaited += 1;
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        if (disposed) return;
        if (!terminalRef.current) throw new Error('The terminal display did not finish loading.');
        terminal = terminalRef.current;

        setStatusMessage('Loading the Bash WebAssembly runtime…');
        const { Wasmer } = await import('@wasmer/sdk/browser');
        if (disposed) return;
        client = new Wasmer({ cache: { namespace: 'codeforge-bash' } });
        clientRef.current = client;
        await client.ready();
        if (disposed) return;

        setStatusMessage('Downloading Bash and standard shell commands (first launch only)…');
        const createSandbox = (packages: string[]) => client!.sandboxes.create({
          packages,
          files: projectFiles(filesRef.current),
          env: {
            HOME: '/workspace',
            PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
            TERM: 'xterm-256color',
          },
          network: { mode: 'http' },
          shell: 'bash',
          onPackageProgress: ({ phase, download }) => {
            if (disposed) return;
            const percent = download.percent;
            setStatusMessage(percent === null
              ? `Loading Bash and commands · ${phase}`
              : `Loading Bash and commands · ${Math.round(percent)}%`);
          },
        });
        let utilitiesPackage: string | null = null;
        for (const candidate of ['wasmer/coreutils', 'wasmer/busybox', 'busybox/busybox']) {
          try {
            sandbox = await createSandbox(['wasmer/bash', candidate]);
            utilitiesPackage = candidate;
            break;
          } catch {
            if (disposed) return;
          }
        }
        if (!sandbox) {
          setStatusMessage('Starting Bash with its built-in commands…');
          sandbox = await createSandbox(['wasmer/bash']);
        }
        sandboxRef.current = sandbox;
        if (disposed) {
          await sandbox.close();
          sandboxRef.current = null;
          return;
        }
        lastSyncedFilesRef.current = projectFiles(filesRef.current);

        setStatusMessage('Opening interactive Bash…');
        process = await sandbox
          .command('bash', ['--noprofile', '--norc', '-i'], {
            cwd: '/workspace',
            env: {
              HOME: '/workspace',
              PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
              TERM: 'xterm-256color',
              PS1: '\\w $ ',
            },
          })
          .spawn({ terminal: { columns: Math.max(terminal.cols, 60), rows: Math.max(terminal.rows, 12) } });
        if (disposed) {
          await process.terminate({ gracePeriodMs: 100 });
          return;
        }
        processRef.current = process;
        const queuedRun = pendingRunRef.current;
        if (queuedRun) {
          pendingRunRef.current = undefined;
          runBashScript(queuedRun);
        }
        setStatus('ready');
        setStatusMessage(utilitiesPackage ? 'Bash ready · standard commands preloaded' : 'Bash ready · basic shell');
        terminal.writeln(`\x1b[90mCodeForge Bash · ${projectNameRef.current} · powered by Wasmer\x1b[0m`);
        if (utilitiesPackage) {
          terminal.writeln(`\x1b[90mCommon shell utilities preloaded from ${utilitiesPackage}.\x1b[0m`);
        } else {
          terminal.writeln('\x1b[33mCommon utility bundle unavailable; Bash is running with built-in commands only.\x1b[0m');
        }

        const pump = async (stream: ReadableBytes | null) => {
          if (!stream) return;
          const decoder = new TextDecoder();
          try {
            for await (const chunk of stream) {
              if (disposed) break;
              appendOutput(decoder.decode(chunk, { stream: true }));
            }
            if (!disposed) appendOutput(decoder.decode());
          } catch (error) {
            if (!disposed) setStatusMessage(error instanceof Error ? error.message : String(error));
          }
        };
        if (process.stdout) void pump(process.stdout);
        if (process.stderr) void pump(process.stderr);
        void process.wait().then((result) => {
          if (disposed) return;
          processRef.current = null;
          setStatus(result.exitCode === 0 ? 'stopped' : 'error');
          setStatusMessage(result.exitCode === 0
            ? 'Bash exited. Start a new session to continue.'
            : `Bash exited with code ${result.exitCode}. Restart to try again.`);
        }).catch((error: unknown) => {
          if (disposed) return;
          processRef.current = null;
          setStatus('error');
          setStatusMessage(error instanceof Error ? error.message : String(error));
        });

        const scheduleScan = () => {
          if (disposed) return;
          pollTimer = setTimeout(async () => {
            await scanWorkspace(sandbox!);
            scheduleScan();
          }, 900);
        };
        scheduleScan();
      } catch (error) {
        if (disposed) return;
        const message = error instanceof Error ? error.message : String(error);
        setStatus('error');
        setStatusMessage(message);
        terminal?.writeln(`\r\n\x1b[31mBash failed to start: ${message}\x1b[0m`);
        terminal?.writeln('\x1b[90mCheck your connection for the first package download, then retry. No API key is needed.\x1b[0m');
      }
    };

    void start();
    return () => {
      disposed = true;
      if (pollTimer) clearTimeout(pollTimer);
      const activeProcess = processRef.current;
      processRef.current = null;
      if (activeProcess) void activeProcess.terminate({ gracePeriodMs: 250 }).catch(() => undefined);
      const activeSandbox = sandboxRef.current;
      sandboxRef.current = null;
      if (activeSandbox) void activeSandbox.close().catch(() => undefined);
      const activeClient = clientRef.current;
      clientRef.current = null;
      if (activeClient) void activeClient.close().catch(() => undefined);
      terminal = null;
    };
    // A shell is restarted only when the project changes, not for each editor keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    const activeSandbox = sandboxRef.current;
    if (!activeSandbox) return;
    let disposed = false;
    void (async () => {
      const desired = projectFiles(files);
      const lastSynced = lastSyncedFilesRef.current;
      for (const path of Object.keys(lastSynced)) {
        if (desired[path] !== undefined) continue;
        try {
          await activeSandbox.fs.remove(`/workspace/${path}`, { recursive: true });
        } catch {
          // A shell command may have already removed it.
        }
        delete lastSynced[path];
      }
      for (const [path, content] of Object.entries(desired)) {
        if (lastSynced[path] === content) continue;
        const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
        if (directory) await activeSandbox.fs.mkdir(`/workspace/${directory}`, { recursive: true });
        await activeSandbox.fs.writeText(`/workspace/${path}`, content);
        lastSynced[path] = content;
      }
    })().catch((error: unknown) => {
      if (!disposed) setStatusMessage(`File sync failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    return () => {
      disposed = true;
    };
  }, [files, projectId]);

  useEffect(() => {
    if (!runRequest || handledRunSequence.current === runRequest.sequence) return;
    handledRunSequence.current = runRequest.sequence;
    onRunRequestHandled(runRequest.sequence);
    runBashScript(runRequest);
  }, [runRequest, onRunRequestHandled, runBashScript]);

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
      dataSubscription = terminal.onData(sendInput);
      observer = new ResizeObserver(() => {
        if (active) {
          try {
            fit?.fit();
            processRef.current?.resizeTerminal(terminal!.cols, terminal!.rows);
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
          processRef.current?.resizeTerminal(terminal!.cols, terminal!.rows);
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
    <section className={`terminal-overlay${active ? ' is-active' : ''}`} aria-label="Bash terminal" aria-hidden={!active}>
      <TerminalChrome
        status={status}
        statusMessage={statusMessage}
        projectName={projectName}
        activePath={activePath}
        terminalRef={terminalRef}
        terminalHostRef={terminalHost}
        issues={issues}
        onRunActiveFile={onRunActiveFile}
        onClear={clearTerminal}
        onRestart={onRestartTerminal}
        sendInput={sendInput}
        onStatusMessage={setStatusMessage}
        onOpenIssue={(file, line, column) => onOpenIssueRef.current(file, line, column)}
      />
    </section>
  );
}
