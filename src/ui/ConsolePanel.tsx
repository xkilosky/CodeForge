import { useEffect, useRef } from 'react';
import { consoleStore } from '../core/consoleStore';
import { useStore } from './useStore';

/**
 * Console output from the active runtime. Entries may carry a file:line, which
 * the preview mapped back from a document-relative position.
 */
export function ConsolePanel({ onClear }: { onClear: () => void }) {
  const state = useStore(consoleStore);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.entries, state.generation]);

  const counts = state.entries.reduce(
    (acc, e) => {
      if (e.kind === 'error') acc.errors++;
      else if (e.kind === 'warn') acc.warnings++;
      return acc;
    },
    { errors: 0, warnings: 0 },
  );

  return (
    <div className="console">
      <div className="console-head">
        <span className="console-title">
          Console
          {state.running ? <span className="dot running" title="running" /> : null}
        </span>
        <span className="console-meta">
          {counts.errors > 0 ? <span className="badge error">{counts.errors} errors</span> : null}
          {counts.warnings > 0 ? <span className="badge warn">{counts.warnings} warnings</span> : null}
          <button className="btn ghost" onClick={onClear}>
            Clear
          </button>
        </span>
      </div>
      <div className="console-body" ref={scrollRef}>
        {state.entries.length === 0 ? (
          <p className="muted console-empty">
            Output from your code appears here — <code>console.log</code>, warnings, and uncaught
            errors with the file and line they came from.
          </p>
        ) : (
          state.entries.map((entry) => (
            <div key={entry.id} className={`console-line kind-${entry.kind}`}>
              <span className="console-marker" aria-hidden="true">
                {entry.kind === 'error' ? '✕' : entry.kind === 'warn' ? '!' : '›'}
              </span>
              <span className="console-text">{entry.text}</span>
              {entry.file ? (
                <span className="console-loc">
                  {entry.file}
                  {typeof entry.line === 'number' ? `:${entry.line}` : ''}
                </span>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
