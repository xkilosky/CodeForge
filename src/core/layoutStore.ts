/**
 * Which pane arrangement the user chose, and whether the drawer is pinned.
 *
 * Persisted to `localStorage` and not to the project: this is a preference of
 * the person, not a property of the file. Two projects should not disagree
 * about where the tree lives, and a project opened on another machine should
 * not carry someone else's window layout with it.
 *
 * Every read is defensive. `localStorage` throws in a sandboxed iframe and in
 * some private modes, and a layout preference is not worth crashing the app
 * over — the fallback is simply the default layout.
 */
import { Store } from './store';

export type WorkspaceLayout = 'split' | 'focus';

export interface LayoutState {
  /** Pinned drawer on a wide screen. */
  drawerPinned: boolean;
  /** `focus` hides the drawer and the output pane until asked for. */
  arrangement: WorkspaceLayout;
  /** Whether the user has ever opened the drawer — used to decide a first hint. */
  seenDrawer: boolean;
}

const KEY = 'codeforge:layout';

const DEFAULT: LayoutState = {
  drawerPinned: true,
  arrangement: 'split',
  seenDrawer: false,
};

function read(): LayoutState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<LayoutState>;
    return {
      drawerPinned: typeof parsed.drawerPinned === 'boolean' ? parsed.drawerPinned : DEFAULT.drawerPinned,
      arrangement:
        parsed.arrangement === 'focus' || parsed.arrangement === 'split'
          ? parsed.arrangement
          : DEFAULT.arrangement,
      seenDrawer: parsed.seenDrawer === true,
    };
  } catch {
    return DEFAULT;
  }
}

export const layoutStore = new Store<LayoutState>(DEFAULT);

let loaded = false;

/**
 * Loads the saved layout once per page.
 *
 * Called from the store's own subscriptions rather than at module scope so a
 * Node test that imports this file does not touch a `localStorage` that is not
 * there.
 */
export function loadLayout(): void {
  if (loaded) return;
  loaded = true;
  layoutStore.set(read());
}

function save(state: LayoutState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // A preference that cannot be saved is not an error the user needs to see.
  }
}

export const layoutActions = {
  setDrawerPinned(pinned: boolean): void {
    layoutStore.set((prev) => {
      const next = { ...prev, drawerPinned: pinned };
      save(next);
      return next;
    });
  },
  toggleDrawerPinned(): void {
    layoutActions.setDrawerPinned(!layoutStore.get().drawerPinned);
  },
  markDrawerSeen(): void {
    if (layoutStore.get().seenDrawer) return;
    layoutStore.set((prev) => {
      const next = { ...prev, seenDrawer: true };
      save(next);
      return next;
    });
  },
  setArrangement(arrangement: WorkspaceLayout): void {
    layoutStore.set((prev) => {
      const next = { ...prev, arrangement };
      save(next);
      return next;
    });
  },
  /** Test seam: forget the saved state and the "already loaded" flag. */
  reset(): void {
    loaded = false;
    layoutStore.set(DEFAULT);
  },
};
