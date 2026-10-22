// B7 (agent D): persistent store of baked atlas strips in IndexedDB (own database; Cache Storage is wiped by the PWA
// service worker's activate handler, public/sw.js). One record per sprite key: { ver, blob, top }; a record of another
// build version counts as a miss and is overwritten, so the store never grows beyond one strip per sprite and size.

const DB = 'veilgrounds-atlas';
const STORE = 'strips';

interface StripRecord {
  ver: string;
  blob: Blob;
  top: number;
}

let db: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return db;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** The strip of `key` stored by build `ver`, or null (missing, other build, IndexedDB unavailable). */
export async function loadStrip(key: string, ver: string): Promise<{ blob: Blob; top: number } | null> {
  try {
    const r = await run<StripRecord | undefined>('readonly', (s) => s.get(key) as IDBRequest<StripRecord | undefined>);
    return r && r.ver === ver && r.blob ? { blob: r.blob, top: r.top } : null;
  } catch {
    return null;
  }
}

export async function saveStrip(key: string, ver: string, blob: Blob, top: number): Promise<void> {
  try {
    const rec: StripRecord = { ver, blob, top };
    await run('readwrite', (s) => s.put(rec, key));
  } catch {
    /* quota / private mode: the next start bakes again */
  }
}

/** True when IndexedDB is usable in this context. */
export const atlasStoreAvailable = (): boolean => typeof indexedDB !== 'undefined';
