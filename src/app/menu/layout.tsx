import type { Metadata, Viewport } from 'next';
import './menu.css';

// This route lives outside [locale] on purpose: no AppLayout/sidebar, no
// AdminContext, no next-intl provider. There is no shared root layout in
// this app ([locale]/layout.tsx renders its own <html>), so this layout
// must render <html>/<body> itself.
export const metadata: Metadata = {
    title: 'Fusionista — Menú',
    description: 'Fusionista digital menu / menú digital',
};

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
};

export default function PublicMenuLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="es">
            <body className="menu-public">
                {children}
            </body>
        </html>
    );
}
