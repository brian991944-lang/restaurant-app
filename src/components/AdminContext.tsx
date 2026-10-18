'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import AdminUnlockModal from '@/components/AdminUnlockModal';
import {
    ADMIN_COLD_LAUNCH_GRACE_MS,
    ADMIN_RELOCK_AFTER_HIDDEN_MS,
    clearAdminDevice,
    isAdminDevice,
    isPhoneSized,
    markAdminDevice,
    onAdminDeviceChange,
} from '@/lib/adminDevice';

interface AdminContextProps {
    isAdmin: boolean;
    /** Unlock (true) or "Salir de Admin" (false). Leaving Admin also un-flags an Admin phone. */
    setIsAdmin: (val: boolean) => void;
    /** False until sessionStorage has been read; the Admin lock screen waits for it so it never flashes. */
    isLoaded: boolean;
}

const AdminContext = createContext<AdminContextProps | undefined>(undefined);

const UNLOCKED_AT_KEY = 'adminUnlockedAt';
const hasAdminCookie = () => document.cookie.split(';').some(c => c.trim().startsWith('fusionista_admin=true'));
const localeOf = (pathname: string) => pathname.match(/^\/(en|es)(\/|$)/)?.[1] ?? 'es';

export function AdminProvider({ children }: { children: React.ReactNode }) {
    const [isAdmin, setIsAdminState] = useState(false);
    const [isLoaded, setIsLoaded] = useState(false);
    // This device is an Admin phone (lib/adminDevice.ts): lock on launch and after the background.
    const [device, setDevice] = useState(false);
    const [showRestrictedAlert, setShowRestrictedAlert] = useState(false);
    const refreshOnce = useRef(false);
    const escaping = useRef(false);
    const pathname = usePathname();
    const router = useRouter();
    useEffect(() => {
        const stored = sessionStorage.getItem('isAdmin') === 'true';
        // Admin on a phone-sized screen makes this the Admin phone — a session the
        // browser restored included — so the lock applies from this launch on.
        if (stored) markAdminDevice();
        const dev = isAdminDevice();
        setDevice(dev);
        if (stored) {
            const unlockedAt = Number(sessionStorage.getItem(UNLOCKED_AT_KEY) || 0);
            const justUnlocked = Date.now() - unlockedAt < ADMIN_COLD_LAUNCH_GRACE_MS;
            if (dev) {
                // Admin phone: a fresh page load is a new launch → fingerprint first.
                // Only a reload seconds after unlocking (deploy, pull-to-refresh) skips it.
                if (justUnlocked && hasAdminCookie()) setIsAdminState(true);
            } else {
                setIsAdminState(true);
                // The browser restored the session but the 12h cookie is gone, so the
                // server rendered this page as "not admin". Re-arm the cookie (effect
                // below) and re-render the server half, so both sides agree.
                if (!hasAdminCookie()) refreshOnce.current = true;
            }
        }

        if (sessionStorage.getItem('showRestrictedAlert') === 'true') {
            setShowRestrictedAlert(true);
            sessionStorage.removeItem('showRestrictedAlert');
            setTimeout(() => setShowRestrictedAlert(false), 3000);
        }

        setIsLoaded(true);
        return onAdminDeviceChange(() => setDevice(isAdminDevice()));
    }, []);

    // The layout's inline script hides the page on an Admin phone until this
    // first decision (lock or page) has rendered, so no figure flashes before
    // the fingerprint screen. Lift it once that render has committed.
    useEffect(() => {
        if (isLoaded) document.documentElement.removeAttribute('data-admin-device');
    }, [isLoaded]);

    useEffect(() => {
        if (isLoaded) {
            sessionStorage.setItem('isAdmin', isAdmin.toString());
            // Mirror admin state into a cookie so admin-only API routes
            // (e.g. /api/quickbooks/*) can check it server-side.
            if (isAdmin) {
                document.cookie = 'fusionista_admin=true; path=/; max-age=43200; samesite=lax';
                if (refreshOnce.current) { refreshOnce.current = false; router.refresh(); }
            } else {
                document.cookie = 'fusionista_admin=; path=/; max-age=0';
            }
        }
    }, [isAdmin, isLoaded, router]);

    const setIsAdmin = useCallback((val: boolean) => {
        setIsAdminState(val);
        if (val) {
            sessionStorage.setItem(UNLOCKED_AT_KEY, String(Date.now()));
            markAdminDevice(); // phones only — a no-op on the kitchen iPad and the PCs
        } else {
            clearAdminDevice(); // "Salir de Admin": this phone stops asking on launch
        }
    }, []);

    // Admin phone: back from the background after a while → lock again (the flag stays).
    useEffect(() => {
        if (!device) return;
        let hiddenAt = 0;
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
            if (hiddenAt && Date.now() - hiddenAt >= ADMIN_RELOCK_AFTER_HIDDEN_MS) setIsAdminState(false);
            hiddenAt = 0;
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, [device]);

    // '/sales' stays: it now redirects into Analytics, and a non-admin must be
    // turned away before the redirect rather than after it.
    const restrictedRoutes = ['/purchases', '/menu', '/sales', '/analytics', '/data', '/finanzas', '/almacen', '/hoy', '/ventas', '/mas'];
    const isRestricted = restrictedRoutes.some(route => pathname.includes(route));
    const onLockPage = /^\/(en|es)\/admin(\/|$)/.test(pathname);
    // Admin phone, locked: the fingerprint screen covers whatever page it opened
    // on (the /admin page runs its own). No bounce to inventory — that is for
    // shared devices, where "not admin" is the normal state.
    const locked = isLoaded && device && !isAdmin && !onLockPage;

    useEffect(() => {
        if (!isLoaded || device || escaping.current) return;

        if (isRestricted && !isAdmin) {
            const localePrefix = `/${localeOf(pathname)}`;

            sessionStorage.setItem('showRestrictedAlert', 'true');
            window.location.replace(`${localePrefix}/inventory`);
        }
    }, [pathname, isAdmin, isLoaded, isRestricted, device]);

    // The lock screen's way out for a phone flagged by mistake (an admin unlocked
    // on a server's phone and forgot "Salir de Admin"): back to the kitchen / salon
    // view with no Admin, and no "restricted" toast on the way.
    const escapeDevice = () => {
        escaping.current = true;
        clearAdminDevice();
        if (isRestricted) window.location.replace(`/${localeOf(pathname)}/inventory`);
        else escaping.current = false;
    };

    // To prevent flashing the full restricted UI post-hydration:
    const hideContent = isLoaded && isRestricted && !isAdmin && !device;

    return (
        <AdminContext.Provider value={{ isAdmin, setIsAdmin, isLoaded }}>
            {locked ? (
                <AdminDeviceLock pathname={pathname} router={router} onUnlocked={() => setIsAdmin(true)} onEscape={escapeDevice} />
            ) : hideContent ? (
                <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)' }}>
                    <div style={{ color: 'var(--text-secondary)' }}>Redirigiendo...</div>
                </div>
            ) : (
                children
            )}
            {showRestrictedAlert && (
                <div style={{
                    position: 'fixed',
                    bottom: '2rem',
                    right: '2rem',
                    background: 'var(--danger)',
                    color: 'white',
                    padding: '1rem 1.5rem',
                    borderRadius: '8px',
                    fontWeight: 500,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    zIndex: 99999,
                    animation: 'fadeIn 0.3s ease-out'
                }}>
                    Acceso Restringido. Inicie sesión como Admin.
                </div>
            )}
        </AdminContext.Provider>
    );
}

export function useAdmin() {
    const context = useContext(AdminContext);
    if (context === undefined) {
        throw new Error('useAdmin must be used within an AdminProvider');
    }
    return context;
}

/**
 * The Admin phone's lock: the unlock sheet in its full-screen variant (it leads
 * with the fingerprint), rendered in place of the page. A phone that launched on
 * the root or the dashboard goes to Hoy once unlocked; any other page stays.
 */
function AdminDeviceLock({ pathname, router, onUnlocked, onEscape }: {
    pathname: string;
    router: ReturnType<typeof useRouter>;
    onUnlocked: () => void;
    onEscape: () => void;
}) {
    const t = useTranslations('Nav');
    const unlocked = () => {
        onUnlocked();
        const bare = pathname.replace(/^\/(en|es)/, '');
        if (isPhoneSized() && (bare === '' || bare === '/' || bare.startsWith('/dashboard'))) {
            router.replace(`/${localeOf(pathname)}/hoy`);
        }
    };
    return (
        <AdminUnlockModal
            open
            variant="screen"
            onClose={() => { }}
            onUnlocked={unlocked}
            footnote={(
                <button onClick={onEscape}
                    style={{ background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.8rem', textDecoration: 'underline', textUnderlineOffset: 3, padding: '0.5rem' }}>
                    {t('admin_device_escape')}
                </button>
            )}
        />
    );
}
