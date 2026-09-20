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
// --m-header (#114a4d), background_color is the light --m-bg (#f3eee6), which
// is the effective default theme when nothing is stored.
export const metadata: Metadata = {
    title: 'Fusionista — Menú',
    description: 'Fusionista digital menu / menú digital',
    manifest: '/menu-manifest.webmanifest',
    appleWebApp: {
        capable: true,
        title: 'Fusionista',
        statusBarStyle: 'black',
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
    themeColor: '#114a4d',
};

export default function PublicMenuLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="es">
            {/* menu-dark pre-applied: default theme is dark, so first paint matches
                before MenuClient syncs from localStorage */}
            <body className="menu-public menu-dark">
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
