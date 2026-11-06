import { describe, expect, it, vi } from 'vitest';
import { fetchGitHubSnapshot, getGitHubChanges, getGitHubDiff, pushGitHubCommit } from '../src/core/github';
import type { GitHubSourceControl } from '../src/core/types';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const link: GitHubSourceControl = {
  owner: 'octocat',
  repo: 'hello-world',
  branch: 'main',
  baseCommit: 'base-commit',
  baseTree: 'base-tree',
  baseFiles: { 'src/edit.ts': 'old', 'src/remove.ts': 'gone' },
  staged: {
    'src/edit.ts': 'staged content',
    'src/remove.ts': null,
    'src/new.ts': 'new file',
  },
};

describe('GitHub source control', () => {
  it('splits staged snapshots from later working-tree edits', () => {
    const status = getGitHubChanges(
      {
        'src/edit.ts': { content: 'edited after staging', language: 'typescript' },
        'src/new.ts': { content: 'new file', language: 'typescript' },
        'src/extra.ts': { content: 'unstaged', language: 'typescript' },
      },
      link,
    );
    expect(status.staged).toEqual([
      { path: 'src/edit.ts', status: 'modified' },
      { path: 'src/new.ts', status: 'added' },
      { path: 'src/remove.ts', status: 'deleted' },
    ]);
    expect(status.working).toEqual([
      { path: 'src/edit.ts', status: 'modified' },
      { path: 'src/extra.ts', status: 'added' },
    ]);
  });


  it('returns the working diff first and falls back to the staged diff', () => {
    const files = {
      'src/edit.ts': { content: 'edited after staging', language: 'typescript' as const },
      'src/new.ts': { content: 'new file', language: 'typescript' as const },
    };
    expect(getGitHubDiff(files, link, 'src/edit.ts')).toEqual({
      original: 'staged content',
      modified: 'edited after staging',
    });
    expect(getGitHubDiff(files, link, 'src/new.ts')).toEqual({
      original: '',
      modified: 'new file',
    });
    expect(getGitHubDiff(files, link, 'src/remove.ts')).toEqual({
      original: 'gone',
      modified: '',
    });
    expect(getGitHubDiff(
      { 'src/edit.ts': { content: 'old', language: 'typescript' } },
      { ...link, staged: {} },
      'src/edit.ts',
    )).toBeNull();
  });

  it('loads a branch snapshot and decodes text blobs', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ default_branch: 'main' }))
      .mockResolvedValueOnce(jsonResponse({
        commit: { sha: 'commit-1', commit: { tree: { sha: 'tree-1' } } },
      }))
      .mockResolvedValueOnce(jsonResponse({
        truncated: false,
        tree: [{ path: 'src/app.ts', type: 'blob', sha: 'blob-1', mode: '100644', size: 20 }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        content: btoa('export const app = 1;'),
        encoding: 'base64',
        size: 21,
      }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const snapshot = await fetchGitHubSnapshot('octocat', 'hello-world', '', 'temporary-test-token');
      expect(snapshot).toEqual({
        branch: 'main',
        commit: 'commit-1',
        tree: 'tree-1',
        files: { 'src/app.ts': 'export const app = 1;' },
        blobShas: { 'src/app.ts': 'blob-1' },
        modes: { 'src/app.ts': '100644' },
        skippedFiles: [],
      });
      expect(fetchMock.mock.calls[0][1]).toMatchObject({
        headers: expect.objectContaining({ Authorization: 'Bearer temporary-test-token' }),
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('creates the first branch and commit in an empty repository', async () => {
    const emptyLink: GitHubSourceControl = {
      owner: 'octocat',
      repo: 'empty-repo',
      branch: 'main',
      baseCommit: '',
      baseTree: '',
      baseFiles: {},
      staged: {},
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ default_branch: null }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, 404))
      .mockResolvedValueOnce(jsonResponse({ sha: 'blob-first' }, 201))
      .mockResolvedValueOnce(jsonResponse({ sha: 'tree-first' }, 201))
      .mockResolvedValueOnce(jsonResponse({ sha: 'commit-first', tree: { sha: 'tree-first' } }, 201))
      .mockResolvedValueOnce(jsonResponse({ ref: 'refs/heads/main' }, 201));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await pushGitHubCommit(
        emptyLink,
        { 'README.md': 'First commit' },
        'Initial commit',
        'temporary-test-token',
      );
      expect(result.commit).toBe('commit-first');
      expect(fetchMock).toHaveBeenCalledTimes(6);
      expect(fetchMock.mock.calls[5][1]).toMatchObject({ method: 'POST' });
      expect(fetchMock.mock.calls[5][0]).toContain('/git/refs');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('blocks a push when the remote and staged changes overlap', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ default_branch: 'main' }))
      .mockResolvedValueOnce(jsonResponse({
        commit: { sha: 'remote-commit', commit: { tree: { sha: 'remote-tree' } } },
      }))
      .mockResolvedValueOnce(jsonResponse({
        truncated: false,
        tree: [{ path: 'src/edit.ts', type: 'blob', sha: 'remote-blob', size: 6 }],
      }))
      .mockResolvedValueOnce(jsonResponse({ content: btoa('remote'), encoding: 'base64', size: 6 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(pushGitHubCommit(
        { ...link, baseFiles: { 'src/edit.ts': 'base' } },
        { 'src/edit.ts': 'local staged' },
        'Update app',
        'temporary-test-token',
      )).rejects.toThrow(/overlap/);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('creates a commit and advances the linked branch', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ default_branch: 'main' }))
      .mockResolvedValueOnce(jsonResponse({
        commit: { sha: 'base-commit', commit: { tree: { sha: 'base-tree' } } },
      }))
      .mockResolvedValueOnce(jsonResponse({ truncated: false, tree: [] }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'blob-2' }, 201))
      .mockResolvedValueOnce(jsonResponse({ sha: 'tree-2' }, 201))
      .mockResolvedValueOnce(jsonResponse({ sha: 'commit-2', tree: { sha: 'tree-2' } }, 201))
      .mockResolvedValueOnce(jsonResponse({ ref: 'refs/heads/main' }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const result = await pushGitHubCommit(
        { ...link, baseFiles: {} },
        { 'src/new.ts': 'new file' },
        'Update app',
        'temporary-test-token',
      );
      expect(result).toEqual({
        commit: 'commit-2',
        tree: 'tree-2',
        baseFiles: {},
        blobShas: { 'src/new.ts': 'blob-2' },
        modes: { 'src/new.ts': '100644' },
        skippedFiles: [],
      });
      expect(fetchMock).toHaveBeenCalledTimes(7);
      expect(fetchMock.mock.calls[6][1]).toMatchObject({ method: 'PATCH' });
      expect(fetchMock.mock.calls[6][0]).toContain('/git/refs/heads/main');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
