'use client';

import { useAdmin } from '@/components/AdminContext';

// Renders its children only for admin users. Used to keep admin-only cards
// (e.g. Alertas de Stock Bajo) out of the cook view while the rest of the
// Dashboard stays visible to everyone.
export default function AdminOnly({ children }: { children: React.ReactNode }) {
    const { isAdmin } = useAdmin();
    if (!isAdmin) return null;
    return <>{children}</>;
}
