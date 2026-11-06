import { WebContainer } from '@webcontainer/api';
import type { FileMap } from './types';

export interface TerminalWorkspace {
  container: WebContainer;
  cwd: string;
}

interface WorkspaceSession {
  cwd: string;
  knownFiles: Record<string, string>;
  tail: Promise<void>;
}

let containerPromise: Promise<WebContainer> | null = null;
const workspaces = new Map<string, WorkspaceSession>();
const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.cache',
  '.next',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
]);
const MAX_SYNC_FILE_BYTES = 1024 * 1024;

export function bootTerminalContainer(): Promise<WebContainer> {
  if (typeof window === 'undefined') return Promise.reject(new Error('The terminal is only available in a browser.'));
  if (!window.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
    return Promise.reject(
      new Error(
        'This browser page is not cross-origin isolated. Serve CodeForge with COOP: same-origin and COEP: require-corp headers over HTTPS, then reload.',
      ),
    );
  }
  if (!containerPromise) {
    containerPromise = WebContainer.boot({
      workdirName: 'codeforge',
      coep: 'require-corp',
    }).catch((error: unknown) => {
      containerPromise = null;
      throw error;
    });
  }
  return containerPromise;
}

function cleanRelativePath(path: string): string | null {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '.' || part === '..')) return null;
  return parts.join('/');
}

function workspaceFolder(projectId: string): string {
  const suffix = projectId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'project';
  return `workspace-${suffix}`;
}

function getSession(projectId: string): WorkspaceSession {
  let session = workspaces.get(projectId);
  if (!session) {
    session = { cwd: workspaceFolder(projectId), knownFiles: {}, tail: Promise.resolve() };
    workspaces.set(projectId, session);
  }
  return session;
}

/** Keep the WebContainer copy in step with CodeForge without replacing npm's node_modules. */
export async function syncWorkspace(projectId: string, files: FileMap): Promise<TerminalWorkspace> {
  const container = await bootTerminalContainer();
  const session = getSession(projectId);
  const contents: Record<string, string> = {};
  for (const [inputPath, file] of Object.entries(files)) {
    const path = cleanRelativePath(inputPath);
    if (path) contents[path] = file.content;
  }

  const operation = session.tail.then(async () => {
    await container.fs.mkdir(session.cwd, { recursive: true });
    for (const oldPath of Object.keys(session.knownFiles)) {
      if (Object.hasOwn(contents, oldPath)) continue;
      await container.fs.rm(`${session.cwd}/${oldPath}`, { force: true, recursive: true }).catch(() => undefined);
    }
    for (const [path, content] of Object.entries(contents)) {
      if (session.knownFiles[path] === content) continue;
      const segments = path.split('/');
      segments.pop();
      if (segments.length) await container.fs.mkdir(`${session.cwd}/${segments.join('/')}`, { recursive: true });
      await container.fs.writeFile(`${session.cwd}/${path}`, content);
    }
    session.knownFiles = contents;
  });
  session.tail = operation.catch(() => undefined);
  await operation;
  return { container, cwd: session.cwd };
}

/** Read text files back from the shell, excluding dependency/build internals and binary assets. */
export async function readWorkspaceTextFiles(
  container: WebContainer,
  cwd: string,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const decoder = new TextDecoder('utf-8', { fatal: true });

  async function walk(relativeDirectory: string): Promise<void> {
    const absoluteDirectory = relativeDirectory ? `${cwd}/${relativeDirectory}` : cwd;
    let entries;
    try {
      entries = await container.fs.readdir(absoluteDirectory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = typeof entry.name === 'string' ? entry.name : new TextDecoder().decode(entry.name);
      if (!name || name === '.' || name === '..') continue;
      const relativePath = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(name) && !name.startsWith('.webcontainer')) {
          await walk(relativePath);
        }
        continue;
      }
      if (!entry.isFile() || relativePath.split('/').some((part) => EXCLUDED_DIRECTORIES.has(part))) continue;
      try {
        const bytes = await container.fs.readFile(`${cwd}/${relativePath}`);
        if (bytes.byteLength > MAX_SYNC_FILE_BYTES || bytes.includes(0)) continue;
        result[relativePath] = decoder.decode(bytes);
      } catch {
        // Binary files and files being replaced mid-scan are not source text.
      }
    }
  }

  await walk('');
  return result;
}

/** Keep files that the lightweight terminal sync intentionally cannot import. */
export function mergeWorkspaceTextFiles(
  terminalFiles: Record<string, string>,
  projectFiles: FileMap,
): Record<string, string> {
  const preserved: Record<string, string> = {};
  for (const [path, file] of Object.entries(projectFiles)) {
    const ignored = path.split('/').some((part) => EXCLUDED_DIRECTORIES.has(part) || part.startsWith('.webcontainer'));
    const bytes = new TextEncoder().encode(file.content).byteLength;
    if (ignored || bytes > MAX_SYNC_FILE_BYTES || file.content.includes('\u0000')) {
      preserved[path] = file.content;
    }
  }

  const imported: Record<string, string> = {};
  for (const [path, content] of Object.entries(terminalFiles)) {
    const ignored = path.split('/').some((part) => EXCLUDED_DIRECTORIES.has(part) || part.startsWith('.webcontainer'));
    const bytes = new TextEncoder().encode(content).byteLength;
    if (!ignored && bytes <= MAX_SYNC_FILE_BYTES && !content.includes('\u0000')) imported[path] = content;
  }
  return { ...preserved, ...imported };
}

export function watchWorkspace(
  container: WebContainer,
  cwd: string,
  onChange: () => void,
): () => void {
  const watcher = container.fs.watch(cwd, { recursive: true }, onChange);
  return () => watcher.close();
}
