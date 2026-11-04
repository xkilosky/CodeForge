import { useState } from 'react';
import type { FileMap } from '../core/types';

interface ExplorerProps {
  files: FileMap;
  activeFile: string;
  onSelect: (path: string) => void;
  onAdd: (path: string) => void;
  onRemove: (path: string) => void;
}

function sortPaths(files: FileMap): string[] {
  return Object.keys(files).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function Explorer({ files, activeFile, onSelect, onAdd, onRemove }: ExplorerProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const paths = sortPaths(files);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    onAdd(draft);
    setDraft('');
    setError(null);
  }

  return (
    <div className="explorer">
      <div className="explorer-head">
        <span>Files</span>
        <span className="muted">{paths.length}</span>
      </div>

      <form className="explorer-add" onSubmit={submit}>
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          placeholder="new file.css"
          aria-label="New file name"
          spellCheck={false}
        />
        <button className="btn" type="submit">
          Add
        </button>
      </form>
      {error ? <div className="explorer-error">{error}</div> : null}

      <ul className="file-list">
        {paths.map((path) => (
          <li key={path} className={path === activeFile ? 'active' : undefined}>
            <button className="file-row" onClick={() => onSelect(path)} title={path}>
              <span className="file-name">{path}</span>
            </button>
            <button
              className="file-remove"
              aria-label={`Delete ${path}`}
              title="Delete file"
              onClick={() => onRemove(path)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      {paths.length === 0 ? <p className="muted explorer-empty">No files yet.</p> : null}
    </div>
  );
}
