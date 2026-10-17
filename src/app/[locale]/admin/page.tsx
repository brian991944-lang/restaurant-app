import type { Metadata } from 'next';
import AdminLockScreen from './AdminLockScreen';

export const dynamic = 'force-dynamic';

/**
 * /admin — the Admin install's front door (start_url of
 * public/admin-manifest.webmanifest). Nothing of the app is shown until the
 * admin unlocks with fingerprint / Face ID or the password; then it goes to
 * the dashboard. The kitchen install (/app) never passes through here.
 *
 * This page swaps the PWA metadata so "Add to Home Screen" from here installs
 * the Admin app (own id, name and lock-badged icon) instead of Fusionista Ops.
 */
export const metadata: Metadata = {
    title: 'Fusionista Admin',
    manifest: '/admin-manifest.webmanifest',
    appleWebApp: {
        capable: true,
        title: 'Fusionista Admin',
        statusBarStyle: 'default',
    },
    icons: {
        apple: '/icons/admin-apple-touch-icon.png',
    },
};

export default async function AdminLockPage({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    return <AdminLockScreen locale={locale === 'en' ? 'en' : 'es'} />;
}
