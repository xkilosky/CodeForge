import type { ConsoleState } from '../core/consoleStore';
import type { DiagnosticsState } from '../core/diagnosticsStore';
import { CodeIcon, FolderIcon, PlayIcon, TerminalIcon } from './icons';

/** The four panes reachable on a phone, one at a time. */
export type MobileTab = 'files' | 'code' | 'preview' | 'output';

interface MobileNavProps {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
  console: ConsoleState;
  diagnostics: DiagnosticsState;
  running: boolean;
}

const TABS: { id: MobileTab; label: string; Icon: typeof CodeIcon }[] = [
  { id: 'files', label: 'Files', Icon: FolderIcon },
  { id: 'code', label: 'Code', Icon: CodeIcon },
  { id: 'preview', label: 'Run', Icon: PlayIcon },
  { id: 'output', label: 'Output', Icon: TerminalIcon },
];

/**
 * Bottom tab bar for the compact layout.
 *
 * Badges are the point: on a phone the console is hidden behind a tab, so
 * without a count an error message would scroll past unseen. Problems and
 * errors surface here instead, and the tab bar is also where "is it running?"
 * lives.
 */
/**
 * Counts everything the user needs to be told about, from both sources: a
 * runtime error reaches the console, a type error reaches diagnostics, and on a
 * phone both are behind a tab where nobody would see them.
 */
export function summarizeIssues(
  consoleState: ConsoleState,
  diagnostics: DiagnosticsState,
): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const entry of consoleState.entries) {
    if (entry.kind === 'error') errors += 1;
    else if (entry.kind === 'warn') warnings += 1;
  }
  for (const diagnostic of diagnostics.diagnostics) {
    if (diagnostic.severity === 'error') errors += 1;
    else if (diagnostic.severity === 'warning') warnings += 1;
  }
  return { errors, warnings };
}

export function MobileNav({ active, onChange, console: consoleState, diagnostics, running }: MobileNavProps) {
  const { errors, warnings } = summarizeIssues(consoleState, diagnostics);

  return (
    <nav className="mobile-nav" aria-label="Panels">
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        // Output carries the shared error/warning count; the others stay clean.
        const badge = tab.id === 'output' ? errors : 0;
        const warnBadge = tab.id === 'output' ? warnings : 0;
        return (
          <button
            key={tab.id}
            className={`mobile-nav-btn${isActive ? ' active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onChange(tab.id)}
          >
            <span className="mobile-nav-glyph" aria-hidden="true">
              <tab.Icon size={17} />
              {tab.id === 'preview' && running ? <span className="mobile-nav-dot" /> : null}
            </span>
            <span className="mobile-nav-label">{tab.label}</span>
            {badge > 0 ? (
              <span className="mobile-nav-badge error">{badge > 99 ? '99+' : badge}</span>
            ) : warnBadge > 0 ? (
              <span className="mobile-nav-badge warn">{warnBadge > 99 ? '99+' : warnBadge}</span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
