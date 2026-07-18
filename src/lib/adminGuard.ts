import { NextRequest } from 'next/server';

// Server-side counterpart of the client AdminContext guard.
// AdminContext sets the `fusionista_admin` cookie when the admin unlocks
// the sidebar, and clears it on "Exit Admin" — API routes that back
// admin-only pages check it here. Same trust level as the rest of the
// app's admin gating (client-side password), not a hardened auth system.
export function isAdminRequest(req: NextRequest): boolean {
    return req.cookies.get('fusionista_admin')?.value === 'true';
}
