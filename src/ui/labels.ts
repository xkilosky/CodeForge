/**
 * Small display helpers shared by the top bar and the projects home.
 *
 * These live outside the components so they can be unit-tested without a DOM,
 * and so the top bar and the home screen cannot drift apart on what a
 * workspace is called.
 */
import type { WorkspaceId } from '../core/types';

export const WORKSPACE_LABEL: Record<WorkspaceId, string> = {
  web: 'Web',
  game: 'Games',
  python: 'Languages',
  blank: 'Blank',
};

/**
 * Human-readable age of a timestamp, for "last edited" in the projects list.
 *
 * Deliberately coarse: an exact clock time is noise here, and the only question
 * a returning user is asking is "is this the one I was working on?".
 */
export function describeAge(updatedAt: number, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - updatedAt);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (elapsed < minute) return 'just now';
  if (elapsed < hour) {
    const minutes = Math.floor(elapsed / minute);
    return `${minutes} min ago`;
  }
  if (elapsed < day) {
    const hours = Math.floor(elapsed / hour);
    return `${hours} h ago`;
  }
  if (elapsed < 7 * day) {
    const days = Math.floor(elapsed / day);
    return days === 1 ? 'yesterday' : `${days} days ago`;
  }
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return 'a while ago';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
