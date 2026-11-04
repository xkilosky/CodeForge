import type { ConsoleEntry, IOBridge } from './types';
import { newId } from './types';
import { Store } from './store';

const MAX_ENTRIES = 500;

export interface ConsoleState {
  entries: ConsoleEntry[];
  /** Bumped on clear so the panel can reset scroll. */
  generation: number;
  running: boolean;
}

export const consoleStore = new Store<ConsoleState>({
  entries: [],
  generation: 0,
  running: false,
});

function push(entry: Omit<ConsoleEntry, 'id' | 'at'>): void {
  consoleStore.set((prev) => {
    const entries = [...prev.entries, { ...entry, id: newId('c'), at: Date.now() }];
    return { ...prev, entries: entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries };
  });
}

/** The IOBridge handed to runtimes. Runtimes never touch React. */
export const io: IOBridge = {
  log: push,
  clear() {
    consoleStore.set((prev) => ({ ...prev, entries: [], generation: prev.generation + 1 }));
  },
};

export function setRunning(running: boolean): void {
  consoleStore.set((prev) => ({ ...prev, running }));
}
