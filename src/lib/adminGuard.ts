import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';

// Server-side counterpart of the client AdminContext guard.
// AdminContext sets the `fusionista_admin` cookie when the admin unlocks
// the sidebar, and clears it on "Exit Admin" — API routes that back
// admin-only pages check it here. Same trust level as the rest of the
// app's admin gating (client-side password), not a hardened auth system.
export function isAdminRequest(req: NextRequest): boolean {
    return req.cookies.get('fusionista_admin')?.value === 'true';
}

// Server-action counterpart of isAdminRequest. Server actions receive no
// NextRequest, so the same `fusionista_admin` cookie is read through
// next/headers instead. Identical cookie, identical trust level — a
// client-set value, not hardened auth. Treat it as a speed bump, and keep an
// audit trail of anything it gates.
export async function isAdminSession(): Promise<boolean> {
    const store = await cookies();
    return store.get('fusionista_admin')?.value === 'true';
}
