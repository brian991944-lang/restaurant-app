/// <reference lib="webworker" />
/**
 * Service worker for the installed public menu (iPad, standalone mode).
 *
 * Built by src/app/menu/serwist/[path]/route.ts and served at
 * /menu/serwist/sw.js with scope /menu. It is registered ONLY from
 * useOfflineMenu when the page runs in standalone display mode, so guests on
 * phones never get it.
 *
 * Cache buckets:
 *   precache                 public/menu/** (logo, emblem, icons) + manifest
 *   fusionista-menu-shell    the /menu HTML — stale-while-revalidate, and every
 *                            /_next/static asset it references is warmed
 *                            right after the HTML is stored so an offline
 *                            launch never meets a chunk it cannot load
 *   fusionista-menu-static   /_next/static/** — stale-while-revalidate
 *   fusionista-menu-fonts    Google Fonts CSS + woff2
 *   fusionista-menu-media    dish photos and videos — cache-first, with
 *                            RangeRequestsPlugin so a cached full video can
 *                            satisfy iPad Safari's byte-range requests, and
 *                            preferFullVariant so a request for a photo's web
 *                            copy is answered from the full copy this tablet
 *                            already holds
 *
 * Never cached: /api/menu/version, /api/menu/availability and
 * /api/menu/snapshot — the sync engine owns those and keeps the snapshot in
 * IndexedDB, not in a cache.
 */
import {
    CacheFirst,
    CacheableResponsePlugin,
    ExpirationPlugin,
    NetworkOnly,
    RangeRequestsPlugin,
    Serwist,
    StaleWhileRevalidate,
} from 'serwist';
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig, SerwistPlugin } from 'serwist';

declare global {
    interface WorkerGlobalScope extends SerwistGlobalConfig {
        __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
    }
}

declare const self: ServiceWorkerGlobalScope;

// Shared with the sync engine (src/app/menu/offline/sync.ts), which warms
// this bucket from the page. Keep the two in step.
const MEDIA_CACHE = 'fusionista-menu-media-v1';
const SHELL_CACHE = 'fusionista-menu-shell-v1';
const STATIC_CACHE = 'fusionista-menu-static-v1';
const FONT_CACHE = 'fusionista-menu-fonts-v1';

const isMenuApi = (url: URL) => url.pathname.startsWith('/api/menu/');
const isMediaRequest = (request: Request, url: URL, sameOrigin: boolean) =>
    !sameOrigin && (
        request.destination === 'image' ||
        request.destination === 'video' ||
        request.destination === 'audio' ||
        // The sync engine's warm-up fetch() has an empty destination; match the
        // storage path instead so it lands in the same bucket.
        url.pathname.includes('/storage/v1/object/')
    );

// After the /menu HTML is (re)stored, pull every /_next/static asset it names
// into STATIC_CACHE. Without this, a deploy followed by a background
// revalidation could leave the tablet holding new HTML whose chunks it has
// never downloaded — and the next offline launch would fail.
const warmShellAssets: SerwistPlugin = {
    cacheDidUpdate: async ({ newResponse }) => {
        try {
            const html = await newResponse.clone().text();
            const urls = new Set<string>();
            for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) {
                urls.add(m[1].replace(/&amp;/g, '&'));
            }
            if (urls.size === 0) return;
            const cache = await caches.open(STATIC_CACHE);
            await Promise.all([...urls].map(async (u) => {
                if (await cache.match(u)) return;
                const res = await fetch(u);
                if (res.ok) await cache.put(u, res);
            }));
        } catch {
            // Best effort: the runtime route still caches chunks on first use.
        }
    },
};

// Dish photos are stored in two sizes, `<base>-web.webp` and `<base>-full.webp`
// (src/components/ui/ImageUpload.tsx). An installed launch displays full-res
// and the sync engine warms only that copy — but the first paint comes from the
// cached /menu HTML, which was rendered before anything knew this was the
// installed app and therefore still names the -web twins. Left alone, every
// launch would download a second size of every visible photo just to throw it
// away at the next sync.
//
// This worker only exists in standalone mode, so it can answer that request
// from the full copy it already holds. A photo with no cached full twin (an
// upload from before the split, or a sync still in flight) falls through to the
// normal cache-first path unchanged.
const preferFullVariant: SerwistPlugin = {
    cacheKeyWillBeUsed: async ({ request, mode }) => {
        if (mode !== 'read' || !request.url.endsWith('-web.webp')) return request;
        try {
            const fullUrl = request.url.replace(/-web\.webp$/, '-full.webp');
            const cache = await caches.open(MEDIA_CACHE);
            if (await cache.match(fullUrl, { ignoreVary: true })) return new Request(fullUrl);
        } catch { /* fall through to the requested copy */ }
        return request;
    },
};

const runtimeCaching: RuntimeCaching[] = [
    // Sync endpoints: always the network, never a cache.
    {
        matcher: ({ url, sameOrigin }) => sameOrigin && isMenuApi(url),
        handler: new NetworkOnly(),
    },
    // App shell HTML.
    {
        matcher: ({ request, url, sameOrigin }) =>
            sameOrigin && request.mode === 'navigate' && url.pathname.startsWith('/menu'),
        handler: new StaleWhileRevalidate({
            cacheName: SHELL_CACHE,
            plugins: [new CacheableResponsePlugin({ statuses: [200] }), warmShellAssets],
        }),
    },
    // Hashed build assets.
    {
        matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/_next/static/'),
        handler: new StaleWhileRevalidate({
            cacheName: STATIC_CACHE,
            plugins: [
                new CacheableResponsePlugin({ statuses: [200] }),
                new ExpirationPlugin({ maxEntries: 300, maxAgeSeconds: 60 * 24 * 60 * 60 }),
            ],
        }),
    },
    // Google Fonts (menu.css @imports Instrument Serif).
    {
        matcher: ({ url }) => url.hostname === 'fonts.googleapis.com',
        handler: new StaleWhileRevalidate({
            cacheName: FONT_CACHE,
            plugins: [new CacheableResponsePlugin({ statuses: [0, 200] })],
        }),
    },
    {
        matcher: ({ url }) => url.hostname === 'fonts.gstatic.com',
        handler: new CacheFirst({
            cacheName: FONT_CACHE,
            plugins: [
                new CacheableResponsePlugin({ statuses: [0, 200] }),
                new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60 }),
            ],
        }),
    },
    // Dish photos and videos (Supabase Storage, CORS-enabled).
    //
    // Range requests: Safari fetches <video> with `Range: bytes=…`. Cache.match
    // ignores that header, so a cache hit returns the FULL 200 response we
    // warmed; RangeRequestsPlugin then slices it into a 206 with the right
    // Content-Range. On a miss the network answers the range itself with a
    // 206, which CacheableResponsePlugin keeps OUT of the cache (only full 200
    // bodies are stored — a partial body would poison later playback).
    // ignoreVary: Supabase answers with `Vary`, and the warm-up request and the
    // <img>/<video> request differ in mode; the URL is the identity here.
    {
        matcher: ({ request, url, sameOrigin }) => isMediaRequest(request, url, sameOrigin),
        handler: new CacheFirst({
            cacheName: MEDIA_CACHE,
            matchOptions: { ignoreVary: true, ignoreSearch: false },
            plugins: [
                preferFullVariant,
                new CacheableResponsePlugin({ statuses: [200] }),
                new RangeRequestsPlugin(),
            ],
        }),
    },
];

const serwist = new Serwist({
    precacheEntries: self.__SW_MANIFEST,
    precacheOptions: {
        cleanupOutdatedCaches: true,
        ignoreURLParametersMatching: [/.*/],
    },
    skipWaiting: true,
    clientsClaim: true,
    navigationPreload: false,
    runtimeCaching,
});

serwist.addEventListeners();
