import type { ConsoleState } from '../core/consoleStore';
import type { DiagnosticsState } from '../core/diagnosticsStore';
import { summarizeIssues } from './MobileNav';

/**
 * The one thing a single-pane layout can genuinely lose.
 *
 * On desktop the console is always on screen, so a failing run is visible the
 * moment it happens. On a phone it is below the stage and editor, which means a user who
 * pressed Run and got a blank scene could miss what happened. This
 * strip appears only when there is something wrong AND the output section is not currently in view.
 */
export function MobileOutputHint({
  console: consoleState,
  diagnostics,
  visible,
  onOpen,
}: {
  console: ConsoleState;
  diagnostics: DiagnosticsState;
  visible: boolean;
  onOpen: () => void;
}) {
  const { errors, warnings } = summarizeIssues(consoleState, diagnostics);
  if (!visible || (errors === 0 && warnings === 0)) return null;

  const tone = errors > 0 ? 'error' : 'warn';
  const count = errors > 0 ? errors : warnings;
  const noun = errors > 0 ? 'error' : 'warning';

  return (
    <button className={`mobile-hint ${tone}`} onClick={onOpen}>
      <span className="mobile-hint-icon" aria-hidden="true">
        {errors > 0 ? '✕' : '!'}
      </span>
      <span className="mobile-hint-text">
        {count} {noun}
        {count === 1 ? '' : 's'} — tap to view
      </span>
    </button>
  );
}
