// Serves the public-menu service worker at /menu/serwist/sw.js.
//
// Turbopack cannot emit a worker bundle during `next build`, so Serwist builds
// it with esbuild inside this static route handler at build time (the route is
// force-static and prerendered). Keeping it under /menu means the worker's
// natural scope and its registration scope ('/menu') line up; the handler also
// sends Service-Worker-Allowed so the scope may sit above the script path.
//
// Precache manifest: only the menu's own static assets. The admin app's
// chunks are deliberately NOT precached — /_next/static is cached at runtime
// by the worker as the menu page actually references files.
//
// Listed one by one rather than globbed, because public/menu/ now holds three
// kinds of file and only one of them belongs in a tablet's precache:
//   shipped   the leather texture and the header lockup — the page paints
//             them on every launch, so they must survive going offline
//   OS-only   splash-ipad-portrait.jpg is fetched by iOS when the icon is
//             added to the home screen, never by the page; precaching it
//             would cost ~1 MB per tablet for a file the page never requests
//   source    icon-1024.png is the master the manifest icons are generated
//             from, and logo.png / logo-transparent.png are the superseded
//             pre-leather lockup — kept in the repo, never shipped to a device
// A `**/*.png` glob swept all three in. Add new runtime assets here explicitly.
import { createSerwistRoute } from '@serwist/turbopack';

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
    swSrc: 'src/app/menu/sw.ts',
    globPatterns: [
        'public/menu/header-logo-leather.png',
        'public/menu/leather-texture.jpg',
        'public/menu/paper-texture.jpg',       // the day page itself, tiled
        'public/menu/emblem.png',              // section crests and the scattered suns
        'public/menu/icons/icon-*.png',        // manifest icons
        'public/menu/icons/apple-touch-icon.png',
        'public/menu-manifest.webmanifest',
    ],
    // esbuild-wasm is not installed; the native binary is (a devDependency).
    useNativeEsbuild: true,
});
