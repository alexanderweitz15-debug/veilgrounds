// Tiny promise wrapper around IndexedDB: one object store used as a key-value table.
// ponytail: raw IndexedDB instead of Dexie; switch to Dexie when we need queries/indices (match history, replays).

const DB_NAME = 'veilgrounds';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Resolves undefined if missing or if IndexedDB is unavailable (private mode etc.). */
export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    return (await tx<T | undefined>('readonly', (s) => s.get(key) as IDBRequest<T | undefined>)) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function kvDel(key: string): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(key));
  } catch {
    /* storage unavailable */
  }
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put(value, key));
  } catch {
    /* storage unavailable: settings simply do not persist */
  }
}
