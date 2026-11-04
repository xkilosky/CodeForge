import { useSyncExternalStore } from 'react';
import type { Store } from '../core/store';

/** Subscribe a component to a Store without pulling in a state library. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
