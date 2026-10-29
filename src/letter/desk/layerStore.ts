/**
 * The desk's drawn layers kept between visits (web): WebP blobs in IndexedDB, keyed by what
 * they show and by this build, so a second visit draws the wood, leather and drawers from
 * images instead of running their shaders. Every call fails soft (private windows, no
 * IndexedDB): a miss just means the layer is drawn again.
 */
const DB = 'letter-desk';
const STORE = 'layers';

type IDB = {
  open: (name: string, version?: number) => {
    result: Db;
    onupgradeneeded: (() => void) | null;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
  };
};
type Req<T> = { result: T; onsuccess: (() => void) | null; onerror: (() => void) | null };
type Db = {
  objectStoreNames: { contains: (name: string) => boolean };
  createObjectStore: (name: string) => void;
  transaction: (store: string, mode: 'readonly' | 'readwrite') => {
    objectStore: (name: string) => {
      get: (key: string) => Req<Blob | undefined>;
      put: (value: Blob, key: string) => Req<unknown>;
      getAllKeys: () => Req<string[]>;
      delete: (key: string) => Req<unknown>;
    };
  };
};

/** This build: drawn layers from an older one (other shaders, other drawing code) are never used. */
export const BUILD = (() => {
  const doc = (globalThis as { document?: { querySelector: (s: string) => { getAttribute: (a: string) => string | null } | null } }).document;
  return doc?.querySelector('script[src*="/_expo/static/js/web/"]')?.getAttribute('src') ?? 'dev';
})();

let db: Promise<Db | null> | null = null;

function open(): Promise<Db | null> {
  db ??= new Promise((resolve) => {
    const idb = (globalThis as { indexedDB?: IDB }).indexedDB;
    if (!idb) return resolve(null);
    try {
      const req = idb.open(DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        resolve(req.result);
        prune(req.result);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return db;
}

const done = <T>(req: Req<T>) =>
  new Promise<T | null>((resolve) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });

/** Layers drawn by earlier builds go, a little after the page has settled. */
function prune(d: Db) {
  setTimeout(async () => {
    try {
      const keys = (await done(d.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys())) ?? [];
      const store = d.transaction(STORE, 'readwrite').objectStore(STORE);
      for (const k of keys) if (!k.startsWith(`${BUILD}|`)) store.delete(k);
    } catch {}
  }, 5000);
}

export async function loadLayer(key: string): Promise<Blob | null> {
  try {
    const d = await open();
    if (!d) return null;
    return (await done(d.transaction(STORE, 'readonly').objectStore(STORE).get(`${BUILD}|${key}`))) ?? null;
  } catch {
    return null;
  }
}

export async function saveLayer(key: string, blob: Blob): Promise<void> {
  try {
    const d = await open();
    if (d) await done(d.transaction(STORE, 'readwrite').objectStore(STORE).put(blob, `${BUILD}|${key}`));
  } catch {}
}
