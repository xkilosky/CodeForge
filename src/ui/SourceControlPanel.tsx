import { useEffect, useMemo, useState } from 'react';
import type { GitHubSourceControl, Project } from '../core/types';
import {
  fetchGitHubSnapshot,
  getGitHubChanges,
  pushGitHubCommit,
  type SourceFileChange,
} from '../core/github';

interface SourceControlPanelProps {
  project: Project;
  onUpdate: (sourceControl: GitHubSourceControl | undefined) => void;
  onReplaceFiles: (files: Record<string, string>) => void;
  onOpenFile: (path: string) => void;
}

function skippedFilesNote(snapshot: { skippedFiles: string[] }): string {
  return snapshot.skippedFiles.length
    ? ` ${snapshot.skippedFiles.length} binary or oversized file(s) remain on GitHub and are not loaded into the editor.`
    : '';
}

function changeLabel(status: SourceFileChange['status']): string {
  return status === 'added' ? 'A' : status === 'deleted' ? 'D' : 'M';
}

export function SourceControlPanel({ project, onUpdate, onReplaceFiles, onOpenFile }: SourceControlPanelProps) {
  const link = project.sourceControl;
  const [owner, setOwner] = useState(link?.owner ?? '');
  const [repo, setRepo] = useState(link?.repo ?? '');
  const [branch, setBranch] = useState(link?.branch ?? '');
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'info' | 'success' | 'error'; text: string } | null>(null);
  const [remoteCommit, setRemoteCommit] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    if (!link) return;
    setOwner(link.owner);
    setRepo(link.repo);
    setBranch(link.branch);
  }, [link?.owner, link?.repo, link?.branch]);

  const changes = useMemo(
    () => (link ? getGitHubChanges(project.files, link) : { staged: [], working: [] }),
    [link, project.files],
  );
  const requireCredentials = (): GitHubSourceControl => {
    if (!link) throw new Error('Connect a GitHub repository first.');
    if (!token.trim()) throw new Error('Enter a GitHub token to run remote operations.');
    return link;
  };

  const runOperation = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      await operation();
    } catch (error) {
      setStatus({ tone: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const connect = (event: React.FormEvent) => {
    event.preventDefault();
    void runOperation(async () => {
      if (!owner.trim() || !repo.trim()) throw new Error('Enter both a repository owner and name.');
      if (!token.trim()) throw new Error('Enter a GitHub token to connect.');
      const snapshot = await fetchGitHubSnapshot(owner.trim(), repo.trim(), branch, token.trim());
      onUpdate({
        owner: owner.trim(),
        repo: repo.trim(),
        branch: snapshot.branch,
        baseCommit: snapshot.commit,
        baseTree: snapshot.tree,
        baseFiles: snapshot.files,
        baseBlobShas: snapshot.blobShas,
        baseModes: snapshot.modes,
        staged: {},
      });
      setBranch(snapshot.branch);
      setRemoteCommit(snapshot.commit);
      setStatus({
        tone: 'success',
        text: `${snapshot.commit
          ? `Connected to ${owner.trim()}/${repo.trim()} on ${snapshot.branch}.`
          : `Connected to the empty repository ${owner.trim()}/${repo.trim()}.`}${skippedFilesNote(snapshot)}`,
      });
    });
  };

  const fetchRemote = () => runOperation(async () => {
    const current = requireCredentials();
    const snapshot = await fetchGitHubSnapshot(current.owner, current.repo, current.branch, token.trim());
    setRemoteCommit(snapshot.commit);
    setStatus({
      tone: snapshot.commit === current.baseCommit
        ? 'success'
        : 'info',
      text: `${snapshot.commit === current.baseCommit
        ? 'Already up to date with the remote branch.'
        : `Remote has new commits (${snapshot.commit.slice(0, 7)}). Staged files can still push if they do not overlap remote changes; pull requires a clean working tree.`}${skippedFilesNote(snapshot)}`,
    });
  });

  const pull = () => runOperation(async () => {
    const current = requireCredentials();
    if (changes.staged.length || changes.working.length) {
      throw new Error('Pull requires a clean working tree. Commit and push your changes, or export a backup and discard them first.');
    }
    const snapshot = await fetchGitHubSnapshot(current.owner, current.repo, current.branch, token.trim());
    if (snapshot.commit === current.baseCommit) {
      setRemoteCommit(snapshot.commit);
      setStatus({ tone: 'success', text: `Already up to date with the remote branch.${skippedFilesNote(snapshot)}` });
      return;
    }
    onReplaceFiles(snapshot.files);
    onUpdate({
      ...current,
      branch: snapshot.branch,
      baseCommit: snapshot.commit,
      baseTree: snapshot.tree,
      baseFiles: snapshot.files,
      baseBlobShas: snapshot.blobShas,
      baseModes: snapshot.modes,
      staged: {},
    });
    setRemoteCommit(snapshot.commit);
    setStatus({ tone: 'success', text: `Pulled ${Object.keys(snapshot.files).length} text files from ${snapshot.branch}.${skippedFilesNote(snapshot)}` });
  });

  const push = () => runOperation(async () => {
    const current = requireCredentials();
    if (!changes.staged.length) throw new Error('Stage at least one change before committing.');
    const staged = Object.fromEntries(
      changes.staged.map(({ path }) => [path, current.staged[path] ?? null]),
    );
    const result = await pushGitHubCommit(current, staged, message, token.trim());
    const baseFiles = { ...result.baseFiles };
    for (const [path, content] of Object.entries(staged)) {
      if (content === null) delete baseFiles[path];
      else baseFiles[path] = content;
    }
    onUpdate({
      ...current,
      baseCommit: result.commit,
      baseTree: result.tree,
      baseFiles,
      baseBlobShas: result.blobShas,
      baseModes: result.modes,
      staged: {},
    });
    setRemoteCommit(result.commit);
    setMessage('');
    setStatus({ tone: 'success', text: `Committed and pushed ${result.commit.slice(0, 7)}.${skippedFilesNote(result)}` });
  });

  const stagePath = (path: string) => {
    if (!link) return;
    onUpdate({
      ...link,
      staged: {
        ...link.staged,
        [path]: project.files[path]?.content ?? null,
      },
    });
  };

  const stageAll = () => {
    if (!link || !changes.working.length) return;
    const staged = { ...link.staged };
    for (const { path } of changes.working) staged[path] = project.files[path]?.content ?? null;
    onUpdate({ ...link, staged });
  };

  const unstagePath = (path: string) => {
    if (!link) return;
    const staged = { ...link.staged };
    delete staged[path];
    onUpdate({ ...link, staged });
  };

  const disconnect = () => {
    onUpdate(undefined);
    setToken('');
    setRemoteCommit(null);
    setStatus({ tone: 'info', text: 'Remote disconnected. Your project files were not changed.' });
  };

  const discardLocalChanges = () => {
    if (!link) return;
    if (!confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    onReplaceFiles(link.baseFiles);
    onUpdate({ ...link, staged: {} });
    setConfirmDiscard(false);
    setStatus({ tone: 'info', text: 'Local and staged changes were reset to the last synchronized snapshot.' });
  };

  const renderChanges = (title: string, list: SourceFileChange[], staged: boolean) => (
    <section className="source-change-group" aria-label={title}>
      <div className="source-change-head">
        <h3>{title}</h3>
        <span className="source-count">{list.length}</span>
        {link && !staged && list.length > 0 ? (
          <button className="text-button" onClick={stageAll} disabled={busy}>Stage all</button>
        ) : null}
      </div>
      {list.length ? (
        <ul className="source-change-list">
          {list.map((change) => (
            <li key={change.path} className="source-change-row">
              <button
                className="source-file-link"
                onClick={() => change.status !== 'deleted' && onOpenFile(change.path)}
                disabled={change.status === 'deleted'}
                title={change.status === 'deleted' ? 'Deleted file' : `Open ${change.path}`}
              >
                <span className={`source-change-badge ${change.status}`}>{changeLabel(change.status)}</span>
                <span>{change.path}</span>
              </button>
              {link ? (
                staged ? (
                  <button className="text-button" onClick={() => unstagePath(change.path)} disabled={busy}>Unstage</button>
                ) : (
                  <button className="text-button" onClick={() => stagePath(change.path)} disabled={busy}>Stage</button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="source-empty muted">No {staged ? 'staged' : 'unstaged'} changes.</p>}
    </section>
  );

  return (
    <section className="source-control-panel" aria-label="Source control">
      <header className="source-panel-head">
        <div>
          <p className="eyebrow">SOURCE CONTROL</p>
          <h2>GitHub</h2>
        </div>
        {link ? <span className="source-branch">{link.branch}</span> : null}
      </header>

      {!link ? (
        <form className="source-connect" onSubmit={connect}>
          <p className="source-intro">Connect this project to a GitHub repository to fetch, pull, and push commits.</p>
          <div className="source-connect-row">
            <label className="source-field">
              <span>Owner</span>
              <input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="octocat" autoComplete="off" />
            </label>
            <label className="source-field">
              <span>Repository</span>
              <input value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="hello-world" autoComplete="off" />
            </label>
          </div>
          <label className="source-field">
            <span>Branch <small>optional</small></span>
            <input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="default branch" autoComplete="off" />
          </label>
          <label className="source-field">
            <span>Personal access token</span>
            <input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="new-password" spellCheck={false} />
          </label>
          <p className="source-security-note">Token stays in memory only; it is never saved with the project. Use a fine-grained token limited to this repository with Contents read/write access.</p>
          <button className="btn primary" type="submit" disabled={busy || !token.trim() || !owner.trim() || !repo.trim()}>
            {busy ? 'Connecting…' : 'Connect repository'}
          </button>
        </form>
      ) : (
        <>
          <div className="source-remote-card">
            <div className="source-remote-name">{link.owner}/{link.repo}</div>
            <div className="muted source-commit-id">Base commit {link.baseCommit ? link.baseCommit.slice(0, 7) : '—'}</div>
            <button className="text-button" onClick={disconnect} disabled={busy}>Disconnect</button>
          </div>
          <label className="source-field source-token-field">
            <span>GitHub personal access token <small>memory only</small></span>
            <input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="new-password" spellCheck={false} />
          </label>
          {!token ? <p className="source-security-note">Re-enter a repository-scoped Contents read/write token to use remote operations. Tokens are never persisted.</p> : null}
          <div className="source-remote-actions">
            <button className="btn secondary" onClick={fetchRemote} disabled={busy || !token.trim()}>{busy ? 'Working…' : 'Fetch'}</button>
            <button className="btn secondary" onClick={pull} disabled={busy || !token.trim()}>Pull</button>
          </div>
          {remoteCommit && remoteCommit !== link.baseCommit ? (
            <p className="source-remote-ahead">Remote branch advanced to {remoteCommit.slice(0, 7)}. Pull when your working tree is clean.</p>
          ) : null}
          {renderChanges('Changes', changes.working, false)}
          {renderChanges('Staged Changes', changes.staged, true)}
          {changes.staged.length || changes.working.length ? (
            <div className="source-discard-row">
              <button className="text-button danger" onClick={discardLocalChanges} disabled={busy}>
                {confirmDiscard ? 'Confirm discard' : 'Discard local changes'}
              </button>
              {confirmDiscard ? <span className="muted">Restores the last synchronized text snapshot.</span> : null}
            </div>
          ) : null}
          <label className="source-field source-message-field">
            <span>Commit message</span>
            <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Describe this change" />
          </label>
          <button className="btn primary source-push" onClick={() => void push()} disabled={busy || !token.trim() || !changes.staged.length || !message.trim()}>
            {busy ? 'Committing…' : `Commit & Push${changes.staged.length ? ` (${changes.staged.length})` : ''}`}
          </button>
        </>
      )}

      {status ? <p className={`source-status ${status.tone}`} role="status">{status.text}</p> : null}
    </section>
  );
}
