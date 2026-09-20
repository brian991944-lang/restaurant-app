'use client';

/**
 * Bridges MenuClient to the offline machinery.
 *
 * In a normal browser tab this hook does nothing beyond suppressing the
 * install prompt: it returns the server-rendered props untouched, registers no
 * service worker and never opens IndexedDB.
 *
 * In standalone mode (home-screen launch) it: registers the service worker,
 * asks for persistent storage (again inside the first user gesture, where
 * iPadOS is more willing), loads the IndexedDB snapshot and starts the sync
 * engine. Rendering switches to the stored snapshot the moment it is read —
 * it never waits for the network.
 */
import { useEffect, useMemo, useState } from 'react';
import { getSyncEngine } from './sync';
import { isStandaloneDisplay, registerMenuServiceWorker, requestPersistentStorage, suppressInstallPrompt } from './standalone';
import type { MenuCategoryData, MenuItemData, SyncState } from './types';

export type OfflineMenu = {
    categories: MenuCategoryData[];
    items: MenuItemData[];
    standalone: boolean;
    sync: SyncState | null;
    syncNow: () => Promise<void>;
};

export function useOfflineMenu(initial: { categories: MenuCategoryData[]; items: MenuItemData[] }): OfflineMenu {
    // false on the server and on the first client render so hydration matches.
    const [standalone, setStandalone] = useState(false);
    const [sync, setSync] = useState<SyncState | null>(null);

    useEffect(() => {
        const disposeInstallPrompt = suppressInstallPrompt();
        if (!isStandaloneDisplay()) return disposeInstallPrompt;

        // Nothing in here may throw into React: if the offline machinery
        // fails to start, the page keeps rendering the server props.
        let cleanup: (() => void) | null = null;
        try {
            setStandalone(true);
            const engine = getSyncEngine();
            const unsubscribe = engine.subscribe(setSync);

            engine.setServiceWorker('registering');
            registerMenuServiceWorker().then(result => engine.setServiceWorker(result)).catch(() => engine.setServiceWorker('failed'));

            requestPersistentStorage().then(p => engine.setPersisted(p)).catch(() => {});
            // Retry inside the first gesture: some engines only grant persistence
            // when asked from user activation.
            const onGesture = () => {
                window.removeEventListener('pointerdown', onGesture);
                requestPersistentStorage().then(p => engine.setPersisted(p)).catch(() => {});
            };
            window.addEventListener('pointerdown', onGesture, { once: true });

            engine.start();
            cleanup = () => {
                unsubscribe();
                window.removeEventListener('pointerdown', onGesture);
                // The engine singleton keeps polling for the life of the launch.
            };
        } catch (e) {
            console.error('[menu] offline mode failed to start; showing the server menu:', e);
        }
        return () => {
            cleanup?.();
            disposeInstallPrompt();
        };
    }, []);

    const snapshot = standalone ? sync?.snapshot ?? null : null;
    const data = useMemo(() => {
        // The stored snapshot is validated on load; this is the last line of
        // defence so a bad record can never blank the menu.
        if (!snapshot || !Array.isArray(snapshot.categories) || !Array.isArray(snapshot.items)) {
            return { categories: initial.categories, items: initial.items };
        }
        return {
            categories: snapshot.categories,
            items: snapshot.items.map(item => item as MenuItemData),
        };
    }, [snapshot, initial.categories, initial.items]);

    return {
        categories: data.categories,
        items: data.items,
        standalone,
        sync: standalone ? sync : null,
        syncNow: async () => {
            try { await getSyncEngine().syncNow(); } catch { /* reported via sync.lastError */ }
        },
    };
}
