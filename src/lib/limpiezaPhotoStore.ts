/**
 * On-device store for Limpieza task photos. Raw IndexedDB, no dependency,
 * nothing here ever leaves the iPad: a compressed photo is written the
 * moment it exists so it survives tab switches and page reloads, and today's
 * entries are cleared only once the list has been completed on the server.
 *
 * Every function swallows storage failures (private mode, quota, an old
 * WebKit build) and reports them through console.error, so a broken store
 * degrades to memory-only and never blocks a capture.
 */

export type StoredPhotoKind = 'antes' | 'despues';

export type StoredPhoto = {
    /** `${businessDate}:${taskId}:${kind}` */
    key: string;
    businessDate: string;
    taskId: string;
    kind: StoredPhotoKind;
    blob: Blob;
    savedAt: number;
};

const DB_NAME = 'limpieza-photos';
const DB_VERSION = 1;
const STORE = 'photos';
const DATE_INDEX = 'byBusinessDate';

export const photoKey = (businessDate: string, taskId: string, kind: StoredPhotoKind) =>
    `${businessDate}:${taskId}:${kind}`;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB no disponible'));
            return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const store = db.createObjectStore(STORE, { keyPath: 'key' });
                store.createIndex(DATE_INDEX, 'businessDate', { unique: false });
            }
        };
        req.onsuccess = () => {
            const db = req.result;
            // If another tab bumps the version, or the browser closes us, drop
            // the cached handle so the next call reopens cleanly.
            db.onversionchange = () => { db.close(); dbPromise = null; };
            db.onclose = () => { dbPromise = null; };
            resolve(db);
        };
        req.onerror = () => reject(req.error ?? new Error('No se pudo abrir IndexedDB'));
        req.onblocked = () => reject(new Error('IndexedDB bloqueada'));
    }).catch(e => {
        dbPromise = null;
        throw e;
    });
    return dbPromise;
}

function txDone(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Transacción fallida'));
        tx.onabort = () => reject(tx.error ?? new Error('Transacción abortada'));
    });
}

function reqResult<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('Petición fallida'));
    });
}

/** Write (or overwrite) one photo. Resolves false if the store is unavailable. */
export async function savePhoto(entry: Omit<StoredPhoto, 'key' | 'savedAt'>): Promise<boolean> {
    try {
        const db = await openDb();
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({
            ...entry,
            key: photoKey(entry.businessDate, entry.taskId, entry.kind),
            savedAt: Date.now(),
        } satisfies StoredPhoto);
        await txDone(tx);
        return true;
    } catch (e) {
        console.error('No se pudo guardar la foto en este iPad:', e);
        return false;
    }
}

/** Every photo saved for one business date. Empty on any failure. */
export async function loadPhotosForDate(businessDate: string): Promise<StoredPhoto[]> {
    try {
        const db = await openDb();
        const tx = db.transaction(STORE, 'readonly');
        const rows = await reqResult(tx.objectStore(STORE).index(DATE_INDEX).getAll(businessDate));
        await txDone(tx);
        return (rows as StoredPhoto[]).filter(r => r && r.blob instanceof Blob);
    } catch (e) {
        console.error('No se pudieron recuperar las fotos guardadas:', e);
        return [];
    }
}

/** Remove every photo from any business date other than the one given. */
export async function deletePhotosNotForDate(businessDate: string): Promise<void> {
    try {
        const db = await openDb();
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const keys = await reqResult(store.getAllKeys());
        for (const key of keys) {
            if (typeof key === 'string' && !key.startsWith(`${businessDate}:`)) store.delete(key);
        }
        await txDone(tx);
    } catch (e) {
        console.error('No se pudieron limpiar fotos antiguas:', e);
    }
}

/** Remove every photo saved for one business date. */
export async function deletePhotosForDate(businessDate: string): Promise<void> {
    try {
        const db = await openDb();
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const keys = await reqResult(store.index(DATE_INDEX).getAllKeys(businessDate));
        for (const key of keys) store.delete(key);
        await txDone(tx);
    } catch (e) {
        console.error('No se pudieron borrar las fotos de hoy:', e);
    }
}

let persistRequested = false;

/**
 * Ask the browser not to evict our origin's storage under pressure. Fire and
 * forget: iOS may refuse, and a refusal changes nothing about the flow.
 */
export function requestPersistentStorage(): void {
    if (persistRequested) return;
    persistRequested = true;
    try {
        if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
            navigator.storage.persist().catch(() => { /* ignored */ });
        }
    } catch {
        // ignored
    }
}
