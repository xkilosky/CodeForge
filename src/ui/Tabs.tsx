import type { FileMap } from '../core/types';

interface TabsProps {
  files: FileMap;
  activeFile: string;
  onSelect: (path: string) => void;
  onDiff?: () => void;
  diffDisabledReason?: string;
}

export function Tabs({ files, activeFile, onSelect, onDiff, diffDisabledReason }: TabsProps) {
  const paths = Object.keys(files).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return (
    <div className="tabs">
      {paths.length ? (
        <div className="tabs-list" role="tablist" aria-label="Open files">
          {paths.map((path) => (
            <button
              key={path}
              role="tab"
              aria-selected={path === activeFile}
              className={`tab${path === activeFile ? ' active' : ''}`}
              onClick={() => onSelect(path)}
              title={path}
            >
              <span className="tab-name">{path.split('/').pop()}</span>
            </button>
          ))}
        </div>
      ) : null}
      {activeFile && (onDiff || diffDisabledReason) ? (
        <button
          type="button"
          className="tab-diff"
          onClick={onDiff}
          disabled={!onDiff}
          title={onDiff ? `Compare changes in ${activeFile}` : diffDisabledReason}
          aria-label={onDiff ? `View diff for ${activeFile}` : 'Diff unavailable'}
        >
          Diff
        </button>
      ) : null}
    </div>
  );
}
