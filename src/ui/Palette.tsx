/**
 * Quick open, and project-wide replace.
 *
 * The tree answers "what is in this project"; this answers "where is the file
 * with `main` in the name", which is the question people actually ask once a
 * project has more than a dozen files and the tree is scrolled.
 *
 * Both live in one dialog because both start with Ctrl and both want a text
 * field at the top of the screen. Two dialogs would be two things to remember.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { highlight, rankFiles } from '../core/search';
import { nameOf, parentOf } from '../core/workspace';
import type { FileMap } from '../core/types';
import { CloseIcon, SearchIcon } from './icons';

interface PaletteProps {
  open: boolean;
  files: FileMap;
  mode: 'file' | 'replace';
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onReplace: (find: string, replace: string) => void;
  /** Starts in replace mode; the tree's search button opens file mode. */
}

export function Palette({ open, files, mode: initialMode, onClose, onOpenFile, onReplace }: PaletteProps) {
  const [mode, setMode] = useState(initialMode);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setQuery('');
    setIndex(0);
    // Focus after paint, or the field is focused before it is mounted and the
    // keystroke goes to the page behind the dialog.
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, initialMode]);

  const paths = useMemo(() => Object.keys(files).sort(), [files]);
  const results = useMemo(() => rankFiles(paths, query), [paths, query]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  if (!open) return null;

  const choose = (path: string) => {
    onOpenFile(path);
    onClose();
  };

  const submitReplace = (event: React.FormEvent) => {
    event.preventDefault();
    if (!find) return;
    onReplace(find, replace);
  };

  return (
    <div className="palette-scrim" role="presentation" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'file' ? 'Open a file' : 'Replace in project'}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-head">
          <SearchIcon size={15} />
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={mode === 'file' ? 'Open a file…' : 'Find text…'}
            aria-label={mode === 'file' ? 'File name' : 'Find'}
            spellCheck={false}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              if (mode !== 'file') return;
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setIndex((n) => Math.min(n + 1, results.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setIndex((n) => Math.max(n - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const hit = results[index];
                if (hit) choose(hit.item.path);
              }
            }}
          />
          <div className="palette-modes" role="tablist" aria-label="Mode">
            <button
              role="tab"
              aria-selected={mode === 'file'}
              className={`palette-mode${mode === 'file' ? ' active' : ''}`}
              onClick={() => setMode('file')}
            >
              Open
            </button>
            <button
              role="tab"
              aria-selected={mode === 'replace'}
              className={`palette-mode${mode === 'replace' ? ' active' : ''}`}
              onClick={() => setMode('replace')}
            >
              Replace
            </button>
          </div>
          <button className="palette-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={15} />
          </button>
        </div>

        {mode === 'replace' ? (
          <form className="palette-replace" onSubmit={submitReplace}>
            <label className="palette-field">
              <span>Find</span>
              <input
                className="palette-input small"
                value={find}
                onChange={(event) => setFind(event.target.value)}
                aria-label="Find text"
                spellCheck={false}
              />
            </label>
            <label className="palette-field">
              <span>Replace with</span>
              <input
                className="palette-input small"
                value={replace}
                onChange={(event) => setReplace(event.target.value)}
                aria-label="Replace with"
                spellCheck={false}
              />
            </label>
            <button className="btn primary" type="submit" disabled={!find}>
              Replace everywhere
            </button>
            <p className="muted palette-note">
              Every file in the project. This cannot be undone yet, so export first if the
              project matters.
            </p>
          </form>
        ) : (
          <>
            <ul className="palette-list" role="listbox" aria-label="Files">
              {results.map((result, position) => (
                <li key={result.item.path}>
                  <button
                    className={`palette-item${position === index ? ' active' : ''}`}
                    role="option"
                    aria-selected={position === index}
                    onMouseEnter={() => setIndex(position)}
                    onClick={() => choose(result.item.path)}
                  >
                    <span className="palette-name">
                      {highlight(result.item.name, result.matches).map((run, runIndex) => (
                        <span key={runIndex} className={run.hit ? 'hit' : undefined}>
                          {run.text}
                        </span>
                      ))}
                    </span>
                    {parentOf(result.item.path) ? (
                      <span className="palette-dir">{parentOf(result.item.path)}</span>
                    ) : null}
                  </button>
                </li>
              ))}
              {results.length === 0 ? (
                <li className="palette-empty muted">
                  {paths.length === 0 ? 'This project has no files.' : `No file matches “${query}”.`}
                </li>
              ) : null}
            </ul>
            <div className="palette-foot">
              <span className="muted">↑↓ to move · Enter to open · Esc to close</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** The name shown in the palette's own footer, e.g. for a "current file" chip. */
export const paletteName = nameOf;
