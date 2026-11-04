/**
 * A ~20 line observable store. Avoids pulling in a state library for M0.
 * Compatible with React's useSyncExternalStore.
 */
export type Listener = () => void;

export class Store<T> {
  private state: T;
  private readonly listeners = new Set<Listener>();

  constructor(initial: T) {
    this.state = initial;
  }

  get = (): T => this.state;

  set = (updater: T | ((prev: T) => T)): void => {
    const next = typeof updater === 'function' ? (updater as (p: T) => T)(this.state) : updater;
    if (Object.is(next, this.state)) return;
    this.state = next;
    for (const l of this.listeners) l();
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}
