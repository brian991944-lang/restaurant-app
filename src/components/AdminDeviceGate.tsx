'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAdmin } from '@/components/AdminContext';
import AdminUnlockModal from '@/components/AdminUnlockModal';
import { isAdminDevice } from '@/lib/adminDevice';
import { useIsPhone } from '@/components/phone/usePhone';

/**
 * On a device marked as the Admin phone (lib/adminDevice.ts), nothing shows
 * until Admin is unlocked: whatever icon launched the app and whatever page it
 * opened on, the fingerprint / password screen comes first. The /admin page
 * runs its own lock, so it is left alone. After unlocking, a phone that opened
 * on the dashboard or the root goes to Hoy.
 */
export default function AdminDeviceGate({ locale }: { locale: string }) {
    const { isAdmin, setIsAdmin, isLoaded } = useAdmin();
    const pathname = usePathname();
    const router = useRouter();
    const phone = useIsPhone();
    const [flagged, setFlagged] = useState(false);

    useEffect(() => { setFlagged(isAdminDevice()); }, [isAdmin]);

    const onLockPage = /^\/(en|es)\/admin(\/|$)/.test(pathname);
    if (!isLoaded || isAdmin || !flagged || onLockPage) return null;

    return (
        <AdminUnlockModal
            open
            variant="screen"
            onClose={() => { }}
            onUnlocked={() => {
                setIsAdmin(true);
                const bare = pathname.replace(/^\/(en|es)/, '');
                if (phone && (bare === '' || bare === '/' || bare.startsWith('/dashboard'))) router.replace(`/${locale}/hoy`);
            }}
        />
    );
}
