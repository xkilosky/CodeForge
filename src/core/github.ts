import type { FileMap, GitHubSourceControl } from './types';
import { pathProblem } from './workspace';

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const MAX_TEXT_FILE_BYTES = 2_000_000;

export interface GitHubSnapshot {
  branch: string;
  commit: string;
  tree: string;
  files: Record<string, string>;
  blobShas: Record<string, string>;
  modes: Record<string, string>;
  skippedFiles: string[];
}

export interface SourceFileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

interface GitHubRepository {
  default_branch: string | null;
}

interface GitHubBranch {
  commit: {
    sha: string;
    commit: { tree: { sha: string } };
  };
}

interface GitHubTree {
  truncated: boolean;
  tree: Array<{ path: string; type: string; sha: string; mode: string; size?: number }>;
}

interface GitHubBlob {
  content: string;
  encoding: string;
  size: number;
}

interface GitHubCommitResponse {
  sha: string;
  tree: { sha: string };
}

export class GitHubApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

async function request<T>(token: string, endpoint: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${endpoint}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'message' in payload &&
      typeof payload.message === 'string'
        ? payload.message
        : response.statusText || 'GitHub request failed.';
    throw new GitHubApiError(message, response.status);
  }
  return payload as T;
}

function repoPath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function decodeBlob(base64: string): string | null {
  try {
    const binary = atob(base64.replace(/\s/g, ''));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.includes('\0') ? null : text;
  } catch {
    // Images, archives and other binary assets do not belong in CodeForge's
    // text-only source map. Their Git tree entries remain untouched on push.
    return null;
  }
}

/** Load the current GitHub branch as a text-file snapshot. */
export async function fetchGitHubSnapshot(
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Promise<GitHubSnapshot> {
  const base = repoPath(owner, repo);
  const repository = await request<GitHubRepository>(token, base);
  const selectedBranch = branch.trim() || repository.default_branch || 'main';

  let branchInfo: GitHubBranch;
  try {
    branchInfo = await request<GitHubBranch>(
      token,
      `${base}/branches/${encodeURIComponent(selectedBranch)}`,
    );
  } catch (error) {
    // An empty GitHub repository has no branch or commit yet. It is a valid
    // starting point for a first push; other 404s remain errors.
    if (error instanceof GitHubApiError && error.status === 404 && !repository.default_branch) {
      return {
        branch: selectedBranch,
        commit: '',
        tree: '',
        files: {},
        blobShas: {},
        modes: {},
        skippedFiles: [],
      };
    }
    throw error;
  }

  const commit = branchInfo.commit.sha;
  const treeSha = branchInfo.commit.commit.tree.sha;
  const tree = await request<GitHubTree>(
    token,
    `${base}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
  );
  if (tree.truncated) {
    throw new Error('This repository is too large to scan in one request. Try a smaller branch.');
  }

  const textFiles = tree.tree.filter((entry) => entry.type === 'blob');
  const files: Record<string, string> = {};
  const blobShas = Object.fromEntries(textFiles.map((entry) => [entry.path, entry.sha]));
  const modes = Object.fromEntries(textFiles.map((entry) => [entry.path, entry.mode]));
  const skippedFiles: string[] = [];
  for (let offset = 0; offset < textFiles.length; offset += 8) {
    await Promise.all(
      textFiles.slice(offset, offset + 8).map(async (entry) => {
        const problem = pathProblem(entry.path);
        if (problem) throw new Error(`Unsupported repository path “${entry.path}”: ${problem}`);
        if (entry.size !== undefined && entry.size > MAX_TEXT_FILE_BYTES) {
          skippedFiles.push(entry.path);
          return;
        }
        const blob = await request<GitHubBlob>(token, `${base}/git/blobs/${entry.sha}`);
        if (blob.size > MAX_TEXT_FILE_BYTES || blob.encoding !== 'base64') {
          skippedFiles.push(entry.path);
          return;
        }
        const content = decodeBlob(blob.content);
        if (content === null) skippedFiles.push(entry.path);
        else files[entry.path] = content;
      }),
    );
  }
  return { branch: selectedBranch, commit, tree: treeSha, files, blobShas, modes, skippedFiles };
}

function encodeBase64(content: string): string {
  const bytes = new TextEncoder().encode(content);
  let binary = '';
  const chunkSize = 0x8000;
  for (let start = 0; start < bytes.length; start += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunkSize));
  }
  return btoa(binary);
}

/** Create and publish a Git commit from the staged index. */
export async function pushGitHubCommit(
  link: GitHubSourceControl,
  staged: Record<string, string | null>,
  message: string,
  token: string,
): Promise<{
  commit: string;
  tree: string;
  baseFiles: Record<string, string>;
  blobShas: Record<string, string>;
  modes: Record<string, string>;
  skippedFiles: string[];
}> {
  if (!message.trim()) throw new Error('Enter a commit message first.');
  const remote = await fetchGitHubSnapshot(link.owner, link.repo, link.branch, token);
  if (link.baseCommit && !remote.commit) {
    throw new Error('The linked remote branch no longer exists. Reconnect to choose a branch.');
  }
  const previousBlobs = link.baseBlobShas ?? {};
  const blobPaths = new Set([...Object.keys(previousBlobs), ...Object.keys(remote.blobShas)]);
  const remoteChanged = new Set(
    [...blobPaths].filter((path) => previousBlobs[path] !== remote.blobShas[path]),
  );
  if (!link.baseBlobShas) {
    for (const change of changesBetween(link.baseFiles, remote.files)) remoteChanged.add(change.path);
  }
  const conflicts = Object.keys(staged).filter((path) => remoteChanged.has(path));
  if (conflicts.length) {
    throw new Error(`Remote and staged changes overlap: ${conflicts.slice(0, 4).join(', ')}. Export a backup, reset local changes, pull, then reapply the edit.`);
  }

  const base = repoPath(link.owner, link.repo);
  const stagedEntries = await Promise.all(
    Object.entries(staged).map(async ([path, content]) => {
      const mode = remote.modes[path] ?? link.baseModes?.[path] ?? '100644';
      if (content === null) return { path, mode, type: 'blob', sha: null as string | null };
      const blob = await request<{ sha: string }>(token, `${base}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: encodeBase64(content), encoding: 'base64' }),
      });
      return { path, mode, type: 'blob', sha: blob.sha as string | null };
    }),
  );
  const treeEntries = stagedEntries.map(({ path, mode, type, sha }) => ({ path, mode, type, sha }));
  const blobShas = { ...remote.blobShas };
  const modes = { ...remote.modes };
  for (const { path, mode, sha } of stagedEntries) {
    if (sha === null) {
      delete blobShas[path];
      delete modes[path];
    } else {
      blobShas[path] = sha;
      modes[path] = mode;
    }
  }

  const treePayload = remote.tree
    ? { base_tree: remote.tree, tree: treeEntries }
    : { tree: treeEntries };
  const tree = await request<{ sha: string }>(token, `${base}/git/trees`, {
    method: 'POST',
    body: JSON.stringify(treePayload),
  });
  const commit = await request<GitHubCommitResponse>(token, `${base}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: message.trim(),
      tree: tree.sha,
      parents: remote.commit ? [remote.commit] : [],
    }),
  });

  const ref = `refs/heads/${link.branch}`;
  if (remote.commit) {
    await request(token, `${base}/git/refs/heads/${encodeURIComponent(link.branch)}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
  } else {
    await request(token, `${base}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref, sha: commit.sha }),
    });
  }
  return {
    commit: commit.sha,
    tree: tree.sha,
    baseFiles: remote.files,
    blobShas,
    modes,
    skippedFiles: remote.skippedFiles,
  };
}

function toSnapshot(files: FileMap): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([path, file]) => [path, file.content]));
}

function changesBetween(
  before: Record<string, string>,
  after: Record<string, string>,
): SourceFileChange[] {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: SourceFileChange[] = [];
  for (const path of paths) {
    const existsBefore = Object.hasOwn(before, path);
    const existsAfter = Object.hasOwn(after, path);
    if (existsBefore && existsAfter && before[path] === after[path]) continue;
    changes.push({
      path,
      status: !existsBefore ? 'added' : !existsAfter ? 'deleted' : 'modified',
    });
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

/** Split the Git-style index (staged) from edits still in the working tree. */
export function getGitHubChanges(
  files: FileMap,
  link: GitHubSourceControl,
): { staged: SourceFileChange[]; working: SourceFileChange[] } {
  const index = { ...link.baseFiles };
  for (const [path, content] of Object.entries(link.staged)) {
    if (content === null) delete index[path];
    else index[path] = content;
  }
  return {
    staged: changesBetween(link.baseFiles, index),
    working: changesBetween(index, toSnapshot(files)),
  };
}

/** Return the most relevant before/after snapshots for a file's Diff action. */
export function getGitHubDiff(
  files: FileMap,
  link: GitHubSourceControl,
  path: string,
): { original: string; modified: string } | null {
  const hasStagedValue = Object.hasOwn(link.staged, path);
  const stagedValue = link.staged[path];
  const existsInIndex = hasStagedValue ? stagedValue !== null : Object.hasOwn(link.baseFiles, path);
  const indexContent = hasStagedValue ? stagedValue ?? '' : link.baseFiles[path] ?? '';
  const existsInWorkingTree = Object.hasOwn(files, path);
  const workingContent = files[path]?.content ?? '';

  if (existsInIndex !== existsInWorkingTree || indexContent !== workingContent) {
    return { original: indexContent, modified: workingContent };
  }

  const original = link.baseFiles[path] ?? '';
  const modified = hasStagedValue ? stagedValue ?? '' : workingContent;
  const existsInBase = Object.hasOwn(link.baseFiles, path);
  if (existsInBase !== existsInIndex || original !== modified) return { original, modified };
  return null;
}
