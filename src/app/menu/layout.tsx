import type { Metadata, Viewport } from 'next';
import { SerwistProvider } from '@serwist/turbopack/react';
import './menu.css';

// This route lives outside [locale] on purpose: no AppLayout/sidebar, no
// AdminContext, no next-intl provider. There is no shared root layout in
// this app ([locale]/layout.tsx renders its own <html>), so this layout
// must render <html>/<body> itself.
//
// PWA metadata (manifest, apple-touch-icon, apple-mobile-web-app-*) is
// declared HERE and only here — the admin layout never links the manifest, so
// only /menu is installable. Colors come from menu.css tokens: theme_color is
// --m-header (#1d3c40, the average of the header's leather texture — keep the
// manifest, the viewport below and the CSS token in step so the status bar and
// the header read as one surface), background_color is the light --m-bg
// (#f3eee6), which is the effective default theme when nothing is stored.
export const metadata: Metadata = {
    title: 'Fusionista — Menú',
    description: 'Fusionista digital menu / menú digital',
    manifest: '/menu-manifest.webmanifest',
    appleWebApp: {
        capable: true,
        title: 'Fusionista',
        // black-translucent = the web view runs the full height of the screen
        // and the status bar floats over it, so the header's leather IS the
        // status bar background. Its glyphs are always WHITE and iOS will not
        // darken them, which is why .mp-statusbar-scrim keeps a dark strip
        // under them once the leather header has scrolled away — see menu.css.
        // Requires viewportFit: 'cover' below; without it the layout viewport
        // still stops at the safe area, every env(safe-area-inset-*) reports
        // 0px, and this setting changes nothing but the glyph colour.
        statusBarStyle: 'black-translucent',
    },
    icons: {
        apple: '/menu/icons/apple-touch-icon.png',
    },
    // Next emits the modern `mobile-web-app-capable` for appleWebApp.capable;
    // older iPadOS builds only honour the Apple-prefixed name, so send both.
    other: {
        'apple-mobile-web-app-capable': 'yes',
    },
};

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    themeColor: '#1d3c40',
    // Lets the page paint into the status bar area (and, on a notched phone in
    // landscape, beside the sensor housing) and turns on real values for
    // env(safe-area-inset-*). Everything that holds text or controls pads
    // itself off those insets in menu.css — the leather and the card surfaces
    // deliberately do not, so backgrounds still bleed to the glass edge.
    viewportFit: 'cover',
};

// iPadOS opening screen. iOS ignores the manifest's background_color and shows
// a blank canvas unless an apple-touch-startup-image matches the device
// EXACTLY, so each entry is pinned to one device's CSS size and DPR. These
// dimensions are the 11" iPad (834x1194 @2x = 1668x2388) — the tablets on the
// floor. A different model simply finds no match and launches blank, as it
// does today; add its size here rather than loosening the query, because a
// loose query hands iOS a wrongly-proportioned image and it stretches it.
//
// Rendered as plain <link>s (React hoists them into <head>): Next's Metadata
// API has no field for startup images, and `other` emits <meta>, not <link>.
// Both orientations share the same device-width/height: iOS states those in
// portrait terms whatever way the iPad is held, and switches on `orientation`
// alone. The files are 1668x2388 and 2388x1668 respectively.
const STARTUP_IMAGES = [
    {
        href: '/menu/splash-ipad-portrait.jpg',
        media: '(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)',
    },
    {
        href: '/menu/splash-ipad-landscape.jpg',
        media: '(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)',
    },
];

export default function PublicMenuLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="es">
            {/* menu-dark pre-applied: default theme is dark, so first paint matches
                before MenuClient syncs from localStorage */}
            <body className="menu-public menu-dark">
                {STARTUP_IMAGES.map(img => (
                    <link key={img.href} rel="apple-touch-startup-image" href={img.href} media={img.media} />
                ))}
                {/* register={false}: the provider only prepares window.serwist.
                    Registration happens in useOfflineMenu, and ONLY when the page
                    runs as an installed (standalone) app — a guest on a phone
                    never gets a service worker. reloadOnOnline is off so the
                    tablet never reloads mid-service; cacheOnNavigation is off
                    because the worker's own routes decide what to cache. */}
                <SerwistProvider
                    swUrl="/menu/serwist/sw.js"
                    register={false}
                    reloadOnOnline={false}
                    cacheOnNavigation={false}
                    options={{ scope: '/menu' }}
                >
                    {children}
                </SerwistProvider>
            </body>
        </html>
    );
}
