/**
 * Shared shapes for the public menu: what the server page passes to
 * MenuClient, what /api/menu/snapshot returns, and what the offline sync
 * engine keeps in IndexedDB. Client-safe (types only).
 */

export type MenuCategoryData = {
    id: string;
    nameEn: string;
    nameEs: string;
    subtitleEn: string | null;
    subtitleEs: string | null;
    sortOrder: number;
};

export type MenuItemData = {
    id: string;
    name: string;
    nameEn: string | null;
    nameEs: string | null;
    descriptionEn: string | null;
    descriptionEs: string | null;
    taglineEn: string | null;
    taglineEs: string | null;
    tags: string[];
    whyEn: string | null;
    whyEs: string | null;
    componentsEn: string[];
    componentsEs: string[];
    salePrice: number;
    // Web copies (1200 px). The full-res twins live in the *Full fields and are
    // resolved through ./media — never read one of these four directly.
    photoUrl: string | null;
    photoUrls: string[];
    photoUrlFull: string | null;
    photoUrlsFull: string[];
    photoFocalX: number;
    photoFocalY: number;
    photoZoom: number;
    photoFit: string;
    videoUrl: string | null;
    isFeatured: boolean;
    featuredRank: number | null;
    menuCategoryId: string | null;
    // Only present on snapshot items (standalone mode). The server-rendered
    // page never sets it, so a normal browser tab renders exactly as before.
    soldOut?: boolean;
};

/** Body of GET /api/menu/snapshot. */
export type OfflineSnapshot = {
    categories: MenuCategoryData[];
    items: (MenuItemData & { sortOrder: number; soldOut: boolean })[];
};

/** Body of GET /api/menu/version. */
export type VersionInfo = {
    dataHash: string;
    soldOutHash: string;
    forceToken: string;
    serverTime: string;
};

/** Body of GET /api/menu/availability. */
export type AvailabilityRow = { id: string; soldOut: boolean };

/** Everything the engine persists in IndexedDB, as one record. */
export type PersistedSyncState = {
    snapshot: OfflineSnapshot | null;
    /** The version the local snapshot corresponds to (soldOutHash tracks availability-only syncs). */
    version: VersionInfo | null;
    /** Last successful sync of any kind (full or availability), ms epoch. */
    lastSyncAt: number | null;
    /** What that last successful sync was: a full snapshot or availability only. */
    lastSyncKind: 'full' | 'availability' | null;
    /** Last successful FULL snapshot sync, ms epoch. */
    lastFullSyncAt: number | null;
    /** Business date ('YYYY-MM-DD') of the last full sync — gates the 09:00 window. */
    lastDataSyncBusinessDate: string | null;
    /** A dataHash change seen but held for the next 09:00 window. */
    pendingDataHash: string | null;
    lastAttemptAt: number | null;
    lastAttemptOk: boolean | null;
    /** First failed attempt since the last success — "offline since". */
    offlineSince: number | null;
};

/** PersistedSyncState plus in-memory runtime facts for the UI / staff panel. */
export type SyncState = PersistedSyncState & {
    loaded: boolean;
    syncing: boolean;
    online: boolean;
    /** navigator.storage.persisted() — null until read or when unsupported. */
    persisted: boolean | null;
    /** Entries in the media cache after the last warm-up, null until counted. */
    mediaCached: number | null;
    serviceWorker: 'unsupported' | 'registering' | 'active' | 'failed' | 'idle';
    lastError: string | null;
};
