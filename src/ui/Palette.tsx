/**
 * Quick open, global project search, project-wide replace, and commands.
 *
 * The tree answers "what is in this project"; quick open finds a file by name,
 * while Search scans source text across every file and jumps to a match.
 * Commands add searchable actions, so workflow and navigation do not require
 * menu-hopping. All modes share one keyboard-first dialog.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  highlight,
  rankFiles,
  scoreMatch,
  searchProjectFiles,
  type ProjectTextMatch,
} from '../core/search';
import { nameOf, parentOf } from '../core/workspace';
import type { FileMap } from '../core/types';
import { CloseIcon, SearchIcon } from './icons';

export type PaletteMode = 'file' | 'search' | 'replace' | 'command';

export interface PaletteCommand {
  id: string;
  label: string;
  description: string;
  shortcut?: string;
  enabled?: boolean;
  run: () => void;
}

interface PaletteProps {
  open: boolean;
  files: FileMap;
  mode: PaletteMode;
  commands: PaletteCommand[];
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onOpenSearchResult: (result: ProjectTextMatch) => void;
  onReplace: (find: string, replace: string) => void;
}

export function Palette({
  open,
  files,
  mode: initialMode,
  commands,
  onClose,
  onOpenFile,
  onOpenSearchResult,
  onReplace,
}: PaletteProps) {
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
  const projectSearch = useMemo(() => searchProjectFiles(files, query), [files, query]);
  const commandResults = useMemo(() => {
    return commands
      .map((command) => {
        const byLabel = scoreMatch(command.label, query);
        const byDescription = scoreMatch(command.description, query);
        const match = byLabel ?? byDescription;
        return match
          ? {
              command,
              score: match.score + (byLabel ? 120 : 0),
              matches: byLabel?.matches ?? [],
            }
          : null;
      })
      .filter((result): result is NonNullable<typeof result> => result !== null)
      .sort((a, b) => b.score - a.score);
  }, [commands, query]);

  useEffect(() => {
    setIndex(0);
  }, [query, mode]);

  if (!open) return null;

  const choose = (path: string) => {
    onOpenFile(path);
    onClose();
  };

  const chooseSearchResult = (result: ProjectTextMatch) => {
    onOpenSearchResult(result);
    onClose();
  };

  const runCommand = (command: PaletteCommand) => {
    if (command.enabled === false) return;
    onClose();
    command.run();
  };

  const switchMode = (nextMode: PaletteMode) => {
    setMode(nextMode);
    setQuery('');
    setIndex(0);
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
        aria-label={
          mode === 'file'
            ? 'Open a file'
            : mode === 'search'
              ? 'Search project'
              : mode === 'command'
                ? 'Command palette'
                : 'Replace in project'
        }
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="palette-head">
          <SearchIcon size={15} />
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            onChange={(event) => {
              const value = event.target.value;
              if (mode === 'file' && value.startsWith('>')) {
                setMode('command');
                setQuery(value.slice(1).trimStart());
              } else setQuery(value);
            }}
            placeholder={
              mode === 'file'
                ? 'Open a file… (type > for commands)'
                : mode === 'search'
                  ? 'Search all project files…'
                  : mode === 'replace'
                    ? 'Find text…'
                    : 'Search commands…'
            }
            aria-label={
              mode === 'file'
                ? 'File name'
                : mode === 'search'
                  ? 'Search project text'
                  : mode === 'command'
                    ? 'Search commands'
                    : 'Find'
            }
            spellCheck={false}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              if (mode === 'file') {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setIndex((n) => Math.min(n + 1, Math.max(0, results.length - 1)));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setIndex((n) => Math.max(n - 1, 0));
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  const hit = results[index];
                  if (hit) choose(hit.item.path);
                }
              } else if (mode === 'command' || mode === 'search') {
                const resultCount = mode === 'command' ? commandResults.length : projectSearch.matches.length;
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setIndex((n) => Math.min(n + 1, Math.max(0, resultCount - 1)));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setIndex((n) => Math.max(n - 1, 0));
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  if (mode === 'command') {
                    const hit = commandResults[index];
                    if (hit) runCommand(hit.command);
                  } else {
                    const hit = projectSearch.matches[index];
                    if (hit) chooseSearchResult(hit);
                  }
                }
              }
            }}
          />
          <div className="palette-modes" role="tablist" aria-label="Mode">
            <button
              role="tab"
              aria-selected={mode === 'file'}
              className={`palette-mode${mode === 'file' ? ' active' : ''}`}
              onClick={() => switchMode('file')}
            >
              Open
            </button>
            <button
              role="tab"
              aria-selected={mode === 'search'}
              className={`palette-mode${mode === 'search' ? ' active' : ''}`}
              onClick={() => switchMode('search')}
            >
              Search
            </button>
            <button
              role="tab"
              aria-selected={mode === 'replace'}
              className={`palette-mode${mode === 'replace' ? ' active' : ''}`}
              onClick={() => switchMode('replace')}
            >
              Replace
            </button>
            <button
              role="tab"
              aria-selected={mode === 'command'}
              className={`palette-mode${mode === 'command' ? ' active' : ''}`}
              onClick={() => switchMode('command')}
            >
              Commands
            </button>
          </div>
          <button className="palette-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={15} />
          </button>
        </div>

        {mode === 'command' ? (
          <>
            <ul className="palette-list" role="listbox" aria-label="Commands">
              {commandResults.map(({ command, matches }, position) => (
                <li key={command.id}>
                  <button
                    className={`palette-item palette-command${position === index ? ' active' : ''}`}
                    role="option"
                    aria-selected={position === index}
                    disabled={command.enabled === false}
                    onMouseEnter={() => setIndex(position)}
                    onClick={() => runCommand(command)}
                  >
                    <span className="palette-command-copy">
                      <span className="palette-name">
                        {highlight(command.label, matches).map((run, runIndex) => (
                          <span key={runIndex} className={run.hit ? 'hit' : undefined}>
                            {run.text}
                          </span>
                        ))}
                      </span>
                      <span className="palette-dir palette-command-description">
                        {command.description}
                      </span>
                    </span>
                    {command.shortcut ? <kbd className="palette-shortcut">{command.shortcut}</kbd> : null}
                  </button>
                </li>
              ))}
              {commandResults.length === 0 ? (
                <li className="palette-empty muted">No command matches “{query}”.</li>
              ) : null}
            </ul>
            <div className="palette-foot">
              <span className="muted">↑↓ to move · Enter to run · Esc to close · Ctrl/Cmd+Shift+P</span>
            </div>
          </>
        ) : mode === 'search' ? (
          <>
            <ul className="palette-list palette-search-results" role="listbox" aria-label="Search results">
              {projectSearch.matches.map((result, position) => {
                const start = Math.max(0, result.column - 1);
                const end = start + result.length;
                return (
                  <li key={`${result.path}:${result.line}:${result.column}`}>
                    <button
                      className={`palette-item palette-search-result${position === index ? ' active' : ''}`}
                      role="option"
                      aria-selected={position === index}
                      onMouseEnter={() => setIndex(position)}
                      onClick={() => chooseSearchResult(result)}
                    >
                      <span className="palette-search-location">
                        <span className="palette-search-path">{result.path}</span>
                        <span className="palette-search-line">{result.line}:{result.column}</span>
                      </span>
                      <span className="palette-search-snippet">
                        {result.text.slice(0, start)}
                        <mark>{result.text.slice(start, end)}</mark>
                        {result.text.slice(end)}
                      </span>
                    </button>
                  </li>
                );
              })}
              {query.trim() && projectSearch.matches.length === 0 ? (
                <li className="palette-empty muted">No matches in this project.</li>
              ) : !query.trim() ? (
                <li className="palette-empty muted">Search text across every project file.</li>
              ) : null}
            </ul>
            <div className="palette-foot">
              <span className="muted">
                {projectSearch.total > 0
                  ? `${projectSearch.truncated ? 'Showing first ' : ''}${projectSearch.matches.length} of ${projectSearch.total} matches · `
                  : ''}
                ↑↓ to move · Enter to open · Esc to close · Ctrl/Cmd+Shift+F
              </span>
            </div>
          </>
        ) : mode === 'replace' ? (
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
