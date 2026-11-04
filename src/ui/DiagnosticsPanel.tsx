import { diagnosticsStore } from '../core/diagnosticsStore';
import type { Diagnostic } from '../core/types';
import { useStore } from './useStore';

const ICON: Record<Diagnostic['severity'], string> = {
  error: '✕',
  warning: '!',
  info: 'i',
};

/**
 * Linter output. Clicking an entry opens the file — the editor keys models by
 * URI, so the squiggle is already there when the tab appears.
 */
export function DiagnosticsPanel({ onOpen }: { onOpen: (file: string, line: number) => void }) {
  const state = useStore(diagnosticsStore);
  const errors = state.diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = state.diagnostics.length - errors;

  return (
    <div className="diagnostics">
      <div className="console-head">
        <span className="console-title">
          Problems
          {state.checking ? <span className="dot" title="checking" /> : null}
        </span>
        <span className="console-meta">
          {errors > 0 ? <span className="badge error">{errors}</span> : null}
          {warnings > 0 ? <span className="badge warn">{warnings}</span> : null}
        </span>
      </div>
      <div className="console-body">
        {state.error ? <div className="diag-line kind-error">{state.error}</div> : null}

        {!state.error && state.diagnostics.length === 0 ? (
          <p className="muted console-empty">
            {state.checking ? 'Checking…' : 'No problems detected.'}
          </p>
        ) : (
          state.diagnostics.map((d, i) => (
            <button
              key={`${d.file}:${d.line}:${d.code ?? ''}:${i}`}
              className={`diag-line kind-${d.severity}`}
              onClick={() => onOpen(d.file, d.line)}
              title={`${d.file}:${d.line}`}
            >
              <span className="console-marker" aria-hidden="true">
                {ICON[d.severity]}
              </span>
              <span className="console-text">{d.message}</span>
              <span className="console-loc">
                {d.file}:{d.line}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
