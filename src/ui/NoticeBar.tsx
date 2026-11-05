/**
 * The one-line confirmation under the workspace.
 *
 * Files and folders have no undo yet (there is no history stack for them, only
 * for the scene), so a delete has to confirm that it happened. Silence after a
 * destructive press is what makes an editor feel unreliable — the user cannot
 * tell "it worked" from "the click missed".
 *
 * It clears itself after a few seconds. The timer lives here, not in the store,
 * because the store has no idea whether anything is on screen to show it.
 */
import { useEffect } from 'react';
import { projectActions, projectStore } from '../core/projectStore';
import { useStore } from './useStore';

const VISIBLE_MS = 4200;

export function NoticeBar() {
  const notice = useStore(projectStore).notice;

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => projectActions.dismissNotice(), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!notice) return null;

  return (
    <div className={`notice notice-${notice.tone}`} role="status" aria-live="polite">
      <span className="notice-text">{notice.text}</span>
      <button className="notice-close" onClick={projectActions.dismissNotice} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
