/**
 * Minimal IndexedDB key/value store for the offline menu. No dependency: the
 * engine keeps exactly one record, so a full IDB wrapper would be dead weight.
 * Every function resolves to `undefined`/no-op when IndexedDB is unavailable
 * (private mode, storage blocked) so the page still renders from the server.
 */

const DB_NAME = 'fusionista-menu';
const DB_VERSION = 1;
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
        try {
            if (typeof indexedDB === 'undefined') { resolve(null); return; }
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
            req.onblocked = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
    return dbPromise;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
    const db = await openDb();
    if (!db) return undefined;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(key);
            req.onsuccess = () => resolve(req.result as T | undefined);
            req.onerror = () => resolve(undefined);
        } catch {
            resolve(undefined);
        }
    });
}

export async function kvSet(key: string, value: unknown): Promise<boolean> {
    const db = await openDb();
    if (!db) return false;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(value, key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
            tx.onabort = () => resolve(false);
        } catch {
            resolve(false);
        }
    });
}
