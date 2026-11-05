/**
 * The file tree.
 *
 * This used to be a flat sorted list of paths with one "Add" box underneath —
 * `src/ui/button.ts` was one string in a list of strings. That is a storage
 * layout shown to a person: it hides hierarchy, it makes every new file start
 * by typing the folder you are already looking at, and there was no folder
 * concept to have an opinion about either way.
 *
 * So: a real tree. Folders open and close, everything implied by a path exists
 * as a folder, and every row has the operations that make sense *for that row*
 * (a folder gets "new file inside", a file gets "duplicate"). Destructive
 * actions confirm inline, once, and the confirmation says how much is going.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileMap } from '../core/types';
import {
  buildTree,
  compareNames,
  extensionOf,
  nameOf,
  normalizePath,
  parentOf,
  type TreeNode,
} from '../core/workspace';
import {
  ChevronIcon,
  CopyIcon,
  FileIcon,
  FolderIcon,
  FolderPlusIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from './icons';

interface ExplorerProps {
  files: FileMap;
  /** Empty folders, so a folder with nothing in it can still be shown. */
  folders?: string[];
  activeFile: string;
  onSelect: (path: string) => void;
  /** Creates a file. `folder` is where it should go when the name is bare. */
  onCreateFile: (path: string) => void;
  onCreateFolder: (path: string) => void;
  onRename: (from: string, to: string) => void;
  onDeleteFile: (path: string) => void;
  onDeleteFolder: (path: string) => void;
  onDuplicate: (path: string) => void;
  /** Hides the header row, for panes that already have a section title. */
  bare?: boolean;
}

/** Glyph colour per extension, so a tree can be skimmed without reading it. */
const EXT_COLOR: Record<string, string> = {
  html: 'var(--orange)',
  css: 'var(--cyan)',
  js: 'var(--yellow)',
  ts: 'var(--accent)',
  jsx: 'var(--yellow)',
  tsx: 'var(--accent)',
  json: 'var(--green)',
  py: 'var(--teal)',
  md: 'var(--purple)',
  txt: 'var(--muted)',
};

function fileColor(path: string): string {
  return EXT_COLOR[extensionOf(path)] ?? 'var(--muted)';
}

/**
 * The toolbar's small icon button. Kept local because it is only ever used in
 * this row, and a shared `IconButton` would need every prop in the app to
 * justify itself for three call sites.
 */
function IconButton({
  label,
  onClick,
  disabled,
  children,
  danger,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={`tree-icon${danger ? ' danger' : ''}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/** Drag-and-drop target state, used to keep the drop preview honest. */
type DragPayload = { path: string; kind: 'file' | 'folder' };

export function Explorer({
  files,
  folders,
  activeFile,
  onSelect,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDeleteFile,
  onDeleteFolder,
  onDuplicate,
  bare,
}: ExplorerProps) {
  const projectFiles = files;
  const tree = useMemo(
    () => buildTree({ files: projectFiles, folders }),
    [projectFiles, folders],
  );

  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState<{ kind: 'file' | 'folder'; parent: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Folders open by default: a tree that starts closed hides the project.
  // Only explicit collapses are stored, so creating a file inside a folder
  // that was opened by default does not then make it collapse.
  const isOpen = (path: string) => open[path] !== false;

  useEffect(() => {
    if (creating && inputRef.current) inputRef.current.focus();
  }, [creating]);

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  function beginCreate(kind: 'file' | 'folder', parent = '') {
    setError(null);
    setRenaming(null);
    setConfirmDelete(null);
    setDraft('');
    setCreating({ kind, parent });
  }

  function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!creating) return;
    const raw = draft.trim();
    if (!raw) {
      setCreating(null);
      return;
    }
    const joined = raw.includes('/')
      ? normalizePath(raw)
      : creating.parent
        ? `${creating.parent}/${normalizePath(raw)}`
        : normalizePath(raw);
    if (!joined) {
      setError('A name is required.');
      return;
    }
    if (creating.kind === 'file') onCreateFile(joined);
    else {
      onCreateFolder(joined);
      // Creating a folder opens it: an empty closed folder looks like nothing
      // happened, and the next thing typed is almost always a file in it.
      setOpen((prev) => ({ ...prev, [joined]: true }));
    }
    setDraft('');
    setCreating(null);
  }

  function submitRename(event: React.FormEvent) {
    event.preventDefault();
    if (!renaming) return;
    const raw = normalizePath(renameDraft);
    if (!raw) {
      setRenaming(null);
      return;
    }
    // A bare new name keeps the row where it is; anything with a slash is a move.
    const folder = parentOf(renaming);
    const target = raw.includes('/') ? raw : folder ? `${folder}/${raw}` : raw;
    if (target !== renaming) onRename(renaming, target);
    setRenaming(null);
  }

  /**
   * Moves a row into a folder by dragging it there.
   *
   * Moving a *folder* into its own descendant would leave the tree with a
   * folder that contains itself; that is refused here rather than in the store
   * because only the tree knows what was under the pointer.
   */
  function handleDrop(event: React.DragEvent, target: string) {
    event.preventDefault();
    setDragOver(null);
    const raw = event.dataTransfer.getData('text/codeforge-path');
    if (!raw) return;
    const payload = JSON.parse(raw) as DragPayload;
    if (payload.path === target) return;
    if (payload.kind === 'folder' && (target === payload.path || target.startsWith(`${payload.path}/`))) {
      setError('A folder cannot be moved inside itself.');
      return;
    }
    const name = nameOf(payload.path);
    onRename(payload.path, `${target}/${name}`);
  }

  function fileRow(node: Extract<TreeNode, { kind: 'file' }>) {
    const active = node.path === activeFile;
    const isRenaming = renaming === node.path;
    const confirming = confirmDelete === node.path;

    if (isRenaming) {
      return (
        <li key={node.path} className="tree-row renaming">
          <form onSubmit={submitRename} className="tree-rename">
            <input
              ref={inputRef}
              className="tree-input"
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              onBlur={() => setRenaming(null)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setRenaming(null);
              }}
              aria-label={`Rename ${node.name}`}
              spellCheck={false}
            />
          </form>
        </li>
      );
    }

    return (
      <li
        key={node.path}
        className={`tree-row${active ? ' active' : ''}${confirming ? ' confirming' : ''}`}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(
            'text/codeforge-path',
            JSON.stringify({ path: node.path, kind: 'file' } satisfies DragPayload),
          );
          event.dataTransfer.effectAllowed = 'move';
        }}
      >
        <button
          type="button"
          className="tree-row-main"
          onClick={() => {
            setConfirmDelete(null);
            onSelect(node.path);
          }}
          title={node.path}
        >
          <span className="tree-glyph" style={{ color: fileColor(node.path) }}>
            <FileIcon />
          </span>
          <span className="tree-name">{node.name}</span>
        </button>

        <span className="tree-actions">
          <IconButton label={`Duplicate ${node.path}`} onClick={() => onDuplicate(node.path)}>
            <CopyIcon size={14} />
          </IconButton>
          <IconButton
            label={`Rename ${node.path}`}
            onClick={() => {
              setRenaming(node.path);
              setRenameDraft(node.path);
            }}
          >
            <PencilIcon size={14} />
          </IconButton>
          <IconButton
            label={confirming ? `Confirm delete ${node.path}` : `Delete ${node.path}`}
            danger
            onClick={() => {
              if (confirming) {
                onDeleteFile(node.path);
                setConfirmDelete(null);
              } else setConfirmDelete(node.path);
            }}
          >
            <TrashIcon size={14} />
          </IconButton>
        </span>

        {confirming ? (
          <span className="tree-confirm" role="status">
            {nameOf(node.path)} ·{' '}
            <button
              type="button"
              className="tree-confirm-yes"
              onClick={() => {
                onDeleteFile(node.path);
                setConfirmDelete(null);
              }}
            >
              delete
            </button>
            <button
              type="button"
              className="tree-confirm-no"
              onClick={() => setConfirmDelete(null)}
            >
              keep
            </button>
          </span>
        ) : null}
      </li>
    );
  }

  function folderRow(node: Extract<TreeNode, { kind: 'folder' }>) {
    const expanded = isOpen(node.path);
    const active = activeFile.startsWith(`${node.path}/`);
    const confirming = confirmDelete === node.path;
    const count = countFiles(node);
    const isRenaming = renaming === node.path;

    if (isRenaming) {
      return (
        <li key={node.path} className="tree-row renaming">
          <form onSubmit={submitRename} className="tree-rename">
            <input
              ref={inputRef}
              className="tree-input"
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              onBlur={() => setRenaming(null)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setRenaming(null);
              }}
              aria-label={`Rename folder ${node.name}`}
              spellCheck={false}
            />
          </form>
        </li>
      );
    }

    return (
      <li key={node.path} className="tree-branch">
        <div
          className={`tree-row folder${active ? ' active-child' : ''}${
            dragOver === node.path ? ' drop-target' : ''
          }${confirming ? ' confirming' : ''}`}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes('text/codeforge-path')) return;
            event.preventDefault();
            setDragOver(node.path);
          }}
          onDragLeave={() => setDragOver((current) => (current === node.path ? null : current))}
          onDrop={(event) => handleDrop(event, node.path)}
        >
          <button
            type="button"
            className="tree-toggle"
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.path}`}
            onClick={() => setOpen((prev) => ({ ...prev, [node.path]: !expanded }))}
          >
            <ChevronIcon className={`tree-chevron${expanded ? ' open' : ''}`} />
          </button>

          <button
            type="button"
            className="tree-row-main"
            onClick={() => {
              setConfirmDelete(null);
              // Clicking the name toggles too: it is the obvious target, and
              // selecting a folder with no visible effect feels broken.
              setOpen((prev) => ({ ...prev, [node.path]: !expanded }));
            }}
            title={node.path}
          >
            <span className="tree-glyph folder-glyph">
              <FolderIcon open={expanded} />
            </span>
            <span className="tree-name">{node.name}</span>
            {node.empty ? <span className="tree-empty">empty</span> : null}
          </button>

          <span className="tree-actions">
            <IconButton
              label={`New file in ${node.path}`}
              onClick={() => {
                setOpen((prev) => ({ ...prev, [node.path]: true }));
                beginCreate('file', node.path);
              }}
            >
              <PlusIcon size={14} />
            </IconButton>
            <IconButton
              label={`Rename folder ${node.path}`}
              onClick={() => {
                setRenaming(node.path);
                setRenameDraft(node.path);
              }}
            >
              <PencilIcon size={14} />
            </IconButton>
            <IconButton
              label={
                confirming
                  ? `Confirm delete ${node.path}`
                  : `Delete folder ${node.path}`
              }
              danger
              onClick={() => {
                if (confirming) {
                  onDeleteFolder(node.path);
                  setConfirmDelete(null);
                  } else setConfirmDelete(node.path);
              }}
            >
              <TrashIcon size={14} />
            </IconButton>
          </span>

          {confirming ? (
            <span className="tree-confirm" role="status">
              {count} {count === 1 ? 'file' : 'files'} ·{' '}
              <button
                type="button"
                className="tree-confirm-yes"
                onClick={() => {
                  onDeleteFolder(node.path);
                  setConfirmDelete(null);
                  }}
              >
                delete all
              </button>
              <button
                type="button"
                className="tree-confirm-no"
                onClick={() => setConfirmDelete(null)}
              >
                keep
              </button>
            </span>
          ) : null}
        </div>

        {expanded ? (
          <ul className="tree-children">
            {creating && creating.parent === node.path ? createRow(0) : null}
            {node.children.length === 0 && !(creating && creating.parent === node.path) ? (
              <li className="tree-row muted tree-note">No files yet.</li>
            ) : (
              node.children.map((child) =>
                child.kind === 'folder' ? folderRow(child) : fileRow(child),
              )
            )}
          </ul>
        ) : null}
      </li>
    );
  }

  function createRow(depth: number) {
    return (
      <li key="__create" className="tree-row creating" style={{ paddingLeft: 8 + depth * 14 }}>
        <form onSubmit={submitCreate} className="tree-rename">
          <span className="tree-glyph">
            {creating?.kind === 'folder' ? <FolderIcon /> : <FileIcon />}
          </span>
          <input
            ref={inputRef}
            className="tree-input"
            value={draft}
            placeholder={creating?.kind === 'folder' ? 'folder-name' : 'file-name.js'}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
              // Blur commits when there is a name, and cancels when there is
              // not: a stray click should not leave an empty input open forever.
              if (draft.trim()) {
                const parent = creating?.parent ?? '';
                const joined = draft.includes('/')
                  ? normalizePath(draft)
                  : parent
                    ? `${parent}/${normalizePath(draft)}`
                    : normalizePath(draft);
                if (joined) {
                  if (creating?.kind === 'folder') {
                    onCreateFolder(joined);
                    setOpen((prev) => ({ ...prev, [joined]: true }));
                  } else onCreateFile(joined);
                }
                setDraft('');
                setCreating(null);
              } else setCreating(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setDraft('');
                setCreating(null);
              }
            }}
            aria-label={creating?.kind === 'folder' ? 'New folder name' : 'New file name'}
            spellCheck={false}
          />
        </form>
      </li>
    );
  }

  const total = Object.keys(files).length;

  return (
    <div className="explorer">
      {bare ? null : (
        <div className="explorer-head">
          <span>Files</span>
          <span className="muted">{total}</span>
        </div>
      )}

      <div className="tree-toolbar">
        <button
          type="button"
          className="tree-tool"
          onClick={() => beginCreate('file', '')}
          title="New file at project root"
        >
          <PlusIcon size={14} />
          <span>File</span>
        </button>
        <button
          type="button"
          className="tree-tool"
          onClick={() => beginCreate('folder', '')}
          title="New folder at project root"
        >
          <FolderPlusIcon size={14} />
          <span>Folder</span>
        </button>
      </div>

      {error ? <div className="explorer-error">{error}</div> : null}

      <ul className="tree" role="tree">
        {creating && !creating.parent ? createRow(0) : null}
        {tree.map((node) => (node.kind === 'folder' ? folderRow(node) : fileRow(node)))}
      </ul>

      {total === 0 && !creating ? (
        <p className="muted explorer-empty">
          No files yet. Add one above — the preview follows whatever you name it.
        </p>
      ) : null}
    </div>
  );
}

/** Files at or below a folder, for the delete confirmation's count. */
function countFiles(node: Extract<TreeNode, { kind: 'folder' }>): number {
  let total = 0;
  for (const child of node.children) {
    total += child.kind === 'file' ? 1 : countFiles(child);
  }
  return total;
}

/** Exported for tests: the sort the tree promises. */
export const treeSort = compareNames;
