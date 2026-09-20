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

        setStandalone(true);
        const engine = getSyncEngine();
        const unsubscribe = engine.subscribe(setSync);

        engine.setServiceWorker('registering');
        void registerMenuServiceWorker().then(result => engine.setServiceWorker(result));

        void requestPersistentStorage().then(p => engine.setPersisted(p));
        // Retry inside the first gesture: some engines only grant persistence
        // when asked from user activation.
        const onGesture = () => {
            window.removeEventListener('pointerdown', onGesture);
            void requestPersistentStorage().then(p => engine.setPersisted(p));
        };
        window.addEventListener('pointerdown', onGesture, { once: true });

        engine.start();
        return () => {
            unsubscribe();
            window.removeEventListener('pointerdown', onGesture);
            disposeInstallPrompt();
            // The engine singleton keeps polling for the life of the launch.
        };
    }, []);

    const snapshot = standalone ? sync?.snapshot ?? null : null;
    const data = useMemo(() => {
        if (!snapshot) return { categories: initial.categories, items: initial.items };
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
        syncNow: () => getSyncEngine().syncNow(),
    };
}
