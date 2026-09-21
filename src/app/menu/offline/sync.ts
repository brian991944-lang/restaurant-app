/**
 * Offline sync engine for the installed public menu (standalone mode only).
 *
 * Polls /api/menu/version every 2 minutes while online and reacts to exactly
 * three signals:
 *
 *   soldOutHash changed  -> GET /api/menu/availability now, patch soldOut on
 *                           the stored items. Any time of day.
 *   forceToken changed   -> full snapshot sync now. Any time of day.
 *   dataHash changed     -> full snapshot sync ONLY when local time is at or
 *                           after 09:00 AND no full sync has completed yet on
 *                           the current business date (5 AM NY cutover, same
 *                           helper the kitchen uses). Otherwise the change is
 *                           held and re-checked on the next poll.
 *
 * Nothing changed -> nothing downloaded. A full sync = GET /api/menu/snapshot,
 * store it in IndexedDB (one record), then warm the media cache for photo and
 * video URLs that are not already cached. Media whose URL is unchanged is
 * never re-downloaded; media no longer referenced is evicted.
 *
 * Photos exist in two sizes (see ./media). This engine warms the full-res
 * variant only — it runs on the installed tablets and nowhere else, and those
 * are the ones rendering full-res. The web copies a phone would load are never
 * downloaded here, and eviction removes them if an older build cached them.
 *
 * Module singleton: MenuClient mounts once per launch, and the engine's timers
 * must not double up under React re-mounts.
 */
import { getBusinessDate } from '@/lib/businessDay';
import { kvGet, kvSet } from './db';
import { mediaUrlsOf, type MediaVariant } from './media';
import type {
    AvailabilityRow, OfflineSnapshot, PersistedSyncState, SyncState, VersionInfo,
} from './types';

// Must match MEDIA_CACHE in src/app/menu/sw.ts.
export const MEDIA_CACHE = 'fusionista-menu-media-v1';

// The variant this engine warms. The engine only ever runs in standalone mode
// (useOfflineMenu starts it nowhere else), and MenuClient renders that same
// launch at 'full' — so warming 'full' caches precisely what the tablet will
// ask for. The web copies are never fetched here, and warmMedia's eviction
// pass drops any that an earlier build left behind.
const WARM_VARIANT: MediaVariant = 'full';
const STATE_KEY = 'state';
const POLL_MS = 2 * 60 * 1000;
const DATA_SYNC_OPENS_AT_HOUR = 9;
const WARM_CONCURRENCY = 2;

type Listener = (state: SyncState) => void;

const emptyPersisted: PersistedSyncState = {
    snapshot: null,
    version: null,
    lastSyncAt: null,
    lastSyncKind: null,
    lastFullSyncAt: null,
    lastDataSyncBusinessDate: null,
    pendingDataHash: null,
    lastAttemptAt: null,
    lastAttemptOk: null,
    offlineSince: null,
};

async function fetchJson<T>(path: string): Promise<T> {
    const res = await fetch(path, { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
    return res.json() as Promise<T>;
}

class SyncEngine {
    private state: SyncState = {
        ...emptyPersisted,
        loaded: false,
        syncing: false,
        online: typeof navigator === 'undefined' ? true : navigator.onLine,
        persisted: null,
        mediaCached: null,
        serviceWorker: 'idle',
        lastError: null,
    };
    private listeners = new Set<Listener>();
    private timer: number | null = null;
    private started = false;
    private loadPromise: Promise<void> | null = null;

    getState(): SyncState { return this.state; }

    subscribe(fn: Listener): () => void {
        this.listeners.add(fn);
        fn(this.state);
        return () => { this.listeners.delete(fn); };
    }

    private patch(partial: Partial<SyncState>) {
        this.state = { ...this.state, ...partial };
        for (const fn of this.listeners) fn(this.state);
    }

    /** Read the persisted record from IndexedDB. Safe to call repeatedly. */
    load(): Promise<void> {
        if (!this.loadPromise) {
            this.loadPromise = (async () => {
                try {
                    const saved = await kvGet<Partial<PersistedSyncState>>(STATE_KEY);
                    // A malformed record (interrupted write, older shape) must
                    // never take the menu down: fall back to the server props
                    // and let the next sync rewrite it.
                    const snap = saved?.snapshot;
                    const snapshotOk = !!snap && Array.isArray(snap.categories) && Array.isArray(snap.items);
                    this.patch({
                        ...(saved ?? {}),
                        snapshot: snapshotOk ? snap : null,
                        loaded: true,
                    });
                } catch (e) {
                    this.patch({ loaded: true, lastError: e instanceof Error ? e.message : String(e) });
                }
                void this.countMedia();
            })();
        }
        return this.loadPromise;
    }

    private async persist() {
        const s = this.state;
        const record: PersistedSyncState = {
            snapshot: s.snapshot,
            version: s.version,
            lastSyncAt: s.lastSyncAt,
            lastSyncKind: s.lastSyncKind,
            lastFullSyncAt: s.lastFullSyncAt,
            lastDataSyncBusinessDate: s.lastDataSyncBusinessDate,
            pendingDataHash: s.pendingDataHash,
            lastAttemptAt: s.lastAttemptAt,
            lastAttemptOk: s.lastAttemptOk,
            offlineSince: s.offlineSince,
        };
        await kvSet(STATE_KEY, record);
    }

    setPersisted(persisted: boolean | null) { this.patch({ persisted }); }
    setServiceWorker(serviceWorker: SyncState['serviceWorker']) { this.patch({ serviceWorker }); }

    start() {
        if (this.started || typeof window === 'undefined') return;
        this.started = true;
        window.addEventListener('online', this.onOnline);
        window.addEventListener('offline', this.onOffline);
        document.addEventListener('visibilitychange', this.onVisibility);
        this.timer = window.setInterval(() => { void this.tick(); }, POLL_MS);
        void this.load().then(() => this.tick());
    }

    stop() {
        if (!this.started) return;
        this.started = false;
        window.removeEventListener('online', this.onOnline);
        window.removeEventListener('offline', this.onOffline);
        document.removeEventListener('visibilitychange', this.onVisibility);
        if (this.timer !== null) window.clearInterval(this.timer);
        this.timer = null;
    }

    private onOnline = () => { this.patch({ online: true }); void this.tick(); };
    private onOffline = () => { this.patch({ online: false }); };
    private onVisibility = () => { if (document.visibilityState === 'visible') void this.tick(); };

    /**
     * Staff panel "Descargar menú ahora": a full snapshot + media sync
     * regardless of the 09:00 window. Never rejects — failures land in
     * lastError / lastAttemptOk and the cached menu keeps rendering.
     */
    async syncNow(): Promise<void> {
        try {
            await this.tick({ force: true });
        } catch (e) {
            this.patch({ syncing: false, lastError: e instanceof Error ? e.message : String(e) });
        }
    }

    private async tick(opts: { force?: boolean } = {}): Promise<void> {
        if (this.state.syncing) return;
        await this.load();
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            const now = Date.now();
            this.patch({
                online: false,
                lastAttemptAt: now,
                lastAttemptOk: false,
                offlineSince: this.state.offlineSince ?? now,
            });
            await this.persist();
            return;
        }
        this.patch({ syncing: true, lastError: null });
        try {
            const version = await fetchJson<VersionInfo>('/api/menu/version');
            const now = Date.now();
            this.patch({ online: true, lastAttemptAt: now, lastAttemptOk: true, offlineSince: null });

            const local = this.state.version;
            const today = getBusinessDate();

            if (opts.force || !this.state.snapshot || !local || local.forceToken !== version.forceToken) {
                await this.fullSync(version, today);
                return;
            }

            let didFull = false;
            if (version.dataHash !== local.dataHash) {
                const hour = new Date().getHours();
                const windowOpen = hour >= DATA_SYNC_OPENS_AT_HOUR && this.state.lastDataSyncBusinessDate !== today;
                if (windowOpen) {
                    await this.fullSync(version, today);
                    didFull = true;
                } else {
                    this.patch({ pendingDataHash: version.dataHash });
                }
            } else if (this.state.pendingDataHash) {
                this.patch({ pendingDataHash: null });
            }

            if (!didFull && version.soldOutHash !== local.soldOutHash) {
                await this.availabilitySync(version);
            }
        } catch (e) {
            const now = Date.now();
            this.patch({
                lastAttemptAt: now,
                lastAttemptOk: false,
                offlineSince: this.state.offlineSince ?? now,
                lastError: e instanceof Error ? e.message : String(e),
            });
        } finally {
            this.patch({ syncing: false });
            await this.persist();
        }
    }

    private async fullSync(version: VersionInfo, today: string) {
        const snapshot = await fetchJson<OfflineSnapshot>('/api/menu/snapshot');
        const now = Date.now();
        // Store and render first; warming media can take a while on a big menu.
        this.patch({
            snapshot,
            version,
            lastSyncAt: now,
            lastSyncKind: 'full',
            lastFullSyncAt: now,
            lastDataSyncBusinessDate: today,
            pendingDataHash: null,
        });
        await this.persist();
        await this.warmMedia(mediaUrlsOf(snapshot, WARM_VARIANT));
    }

    private async availabilitySync(version: VersionInfo) {
        const rows = await fetchJson<AvailabilityRow[]>('/api/menu/availability');
        const soldOutById = new Map(rows.map(r => [r.id, r.soldOut]));
        const snapshot = this.state.snapshot;
        if (!snapshot) return;
        const items = snapshot.items.map(item => {
            const soldOut = soldOutById.get(item.id);
            return soldOut === undefined || soldOut === item.soldOut ? item : { ...item, soldOut };
        });
        const local = this.state.version;
        this.patch({
            snapshot: { ...snapshot, items },
            version: local ? { ...local, soldOutHash: version.soldOutHash, serverTime: version.serverTime } : version,
            lastSyncAt: Date.now(),
            lastSyncKind: 'availability',
        });
        await this.persist();
    }

    /**
     * Fill the media cache for every URL the snapshot references that is not
     * cached yet, and drop entries nothing references any more. Fetched with
     * mode 'cors' so the stored response is a real 200 (not opaque) — the
     * service worker needs the byte length to answer Range requests for video.
     */
    private async warmMedia(urls: Set<string>) {
        if (typeof caches === 'undefined') return;
        let cache: Cache;
        try {
            cache = await caches.open(MEDIA_CACHE);
        } catch {
            return;
        }
        try {
            const keys = await cache.keys();
            await Promise.all(keys.filter(k => !urls.has(k.url)).map(k => cache.delete(k)));
        } catch { /* eviction is best effort */ }

        const queue = [...urls];
        const worker = async () => {
            for (;;) {
                const url = queue.shift();
                if (!url) return;
                try {
                    if (await cache.match(url, { ignoreVary: true })) continue;
                    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
                    if (res.status === 200) await cache.put(url, res);
                } catch {
                    // Leave it for the next full sync; the card still shows a
                    // placeholder background if the photo is missing offline.
                }
            }
        };
        await Promise.all(Array.from({ length: WARM_CONCURRENCY }, worker));
        await this.countMedia();
    }

    private async countMedia() {
        if (typeof caches === 'undefined') return;
        try {
            const cache = await caches.open(MEDIA_CACHE);
            const keys = await cache.keys();
            this.patch({ mediaCached: keys.length });
        } catch { /* ignore */ }
    }
}

let engine: SyncEngine | null = null;

export function getSyncEngine(): SyncEngine {
    if (!engine) engine = new SyncEngine();
    return engine;
}

export type { SyncEngine };
