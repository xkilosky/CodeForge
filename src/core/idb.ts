/**
 * Minimal IndexedDB wrapper for local-first persistence.
 * No backend, no accounts: this is the only durability guarantee.
 */
import type { Project } from './types';

const DB_NAME = 'codeforge';
const DB_VERSION = 1;
const STORE = 'projects';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('failed to open IndexedDB'));
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const req = run(transaction.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
      }),
  );
}

export const db = {
  listProjects: (): Promise<Project[]> =>
    tx<Project[]>('readonly', (s) => s.getAll() as IDBRequest<Project[]>).then((all) =>
      all.sort((a, b) => b.updatedAt - a.updatedAt),
    ),
  getProject: (id: string): Promise<Project | undefined> =>
    tx<Project | undefined>('readonly', (s) => s.get(id) as IDBRequest<Project | undefined>),
  putProject: (project: Project): Promise<IDBValidKey> =>
    tx<IDBValidKey>('readwrite', (s) => s.put(project)),
  deleteProject: (id: string): Promise<undefined> => tx<undefined>('readwrite', (s) => s.delete(id)),
};
