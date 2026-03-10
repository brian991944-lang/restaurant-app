'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

interface AdminContextProps {
    isAdmin: boolean;
    setIsAdmin: (val: boolean) => void;
}

const AdminContext = createContext<AdminContextProps | undefined>(undefined);

export function AdminProvider({ children }: { children: React.ReactNode }) {
    const [isAdmin, setIsAdmin] = useState(false);
    const [isLoaded, setIsLoaded] = useState(false);
    const [showRestrictedAlert, setShowRestrictedAlert] = useState(false);
    const pathname = usePathname();
    const router = useRouter();
    useEffect(() => {
        const stored = sessionStorage.getItem('isAdmin');
        if (stored === 'true') {
            setIsAdmin(true);
        }

        if (sessionStorage.getItem('showRestrictedAlert') === 'true') {
            setShowRestrictedAlert(true);
            sessionStorage.removeItem('showRestrictedAlert');
            setTimeout(() => setShowRestrictedAlert(false), 3000);
        }

        setIsLoaded(true);
    }, []);

    useEffect(() => {
        if (isLoaded) {
            sessionStorage.setItem('isAdmin', isAdmin.toString());
        }
    }, [isAdmin, isLoaded]);

    const restrictedRoutes = ['/dashboard', '/purchases', '/menu', '/sales', '/data'];
    const isRestricted = restrictedRoutes.some(route => pathname.includes(route));

    useEffect(() => {
        if (!isLoaded) return;

        if (isRestricted && !isAdmin) {
            const localeMatch = pathname.match(/^\/([a-z]{2})/);
            const localePrefix = localeMatch ? `/${localeMatch[1]}` : '/en';

            sessionStorage.setItem('showRestrictedAlert', 'true');
            window.location.replace(`${localePrefix}/inventory`);
        }
    }, [pathname, isAdmin, isLoaded, isRestricted]);

    // To prevent flashing the full restricted UI post-hydration:
    const hideContent = isLoaded && isRestricted && !isAdmin;

    return (
        <AdminContext.Provider value={{ isAdmin, setIsAdmin }}>
            {hideContent ? (
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
