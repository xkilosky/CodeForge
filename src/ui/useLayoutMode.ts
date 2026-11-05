/**
 * Layout tiers, and why there are exactly two.
 *
 * A desktop IDE is a grid of four panes. On a phone that grid cannot be made to
 * fit by shrinking it: 220px of sidebar alone is more than half a 390px screen,
 * and a 190px console leaves roughly two lines of code visible. Below about
 * 820px the app therefore stops being a grid and shows one full-height section
 * at a time, selected from the drawer — a phone-shaped layout, not a squeezed
 * desktop.
 *
 * The breakpoint lives in two places by necessity: CSS handles pure styling,
 * and this hook handles the structural difference (which panes exist at all,
 * and whether the layout is a grid or a single slot). They must agree, so the
 * value is duplicated in `styles.css` — see the note there.
 */
import { useSyncExternalStore } from 'react';

export type LayoutMode = 'desktop' | 'compact';

/** Matches the `max-width: 820px` query in styles.css. */
export const COMPACT_QUERY = '(max-width: 820px)';

let mediaQuery: MediaQueryList | null = null;

function getMediaQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  if (!mediaQuery) mediaQuery = window.matchMedia(COMPACT_QUERY);
  return mediaQuery;
}

function subscribe(onChange: () => void): () => void {
  const mq = getMediaQuery();
  if (!mq) return () => {};
  // Older WebKit exposes addListener instead of addEventListener on MediaQueryList.
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }
  const legacy = mq as MediaQueryList & {
    addListener?: (cb: (e: MediaQueryListEvent) => void) => void;
    removeListener?: (cb: (e: MediaQueryListEvent) => void) => void;
  };
  legacy.addListener?.(onChange);
  return () => legacy.removeListener?.(onChange);
}

function getSnapshot(): boolean {
  return getMediaQuery()?.matches ?? false;
}

/**
 * `compact` means a stacked, drawer-navigated workspace. Driven by actual
 * viewport width rather than a user agent string, so a narrow desktop window
 * behaves the same way and a tablet in landscape gets the full layout.
 */
export function useLayoutMode(): LayoutMode {
  const compact = useSyncExternalStore(subscribe, getSnapshot, () => false);
  return compact ? 'compact' : 'desktop';
}

/**
 * True for touch-first devices. Used to enlarge hit targets and to stop the
 * editor stealing focus and raising the keyboard unexpectedly — not to change
 * which panes exist, which is a width question.
 */
export function useCoarsePointer(): boolean {
  const coarse = useSyncExternalStore(
    (onChange) => {
      const mq = typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(pointer: coarse)')
        : null;
      if (!mq) return () => {};
      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
      }
      const legacy = mq as MediaQueryList & {
        addListener?: (cb: (e: MediaQueryListEvent) => void) => void;
        removeListener?: (cb: (e: MediaQueryListEvent) => void) => void;
      };
      legacy.addListener?.(onChange);
      return () => legacy.removeListener?.(onChange);
    },
    () =>
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(pointer: coarse)').matches
        : false,
    () => false,
  );
  return coarse;
}
