import type { FileMap } from '../core/types';

interface TabsProps {
  files: FileMap;
  activeFile: string;
  onSelect: (path: string) => void;
}

export function Tabs({ files, activeFile, onSelect }: TabsProps) {
  const paths = Object.keys(files).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (paths.length === 0) return <div className="tabs" />;

  return (
    <div className="tabs" role="tablist">
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
  );
}
