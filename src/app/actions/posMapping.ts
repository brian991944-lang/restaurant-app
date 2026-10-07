'use server';

import prisma from '@/lib/prisma';
import { PosSource } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { isAdminSession } from '@/lib/adminGuard';
import { seedToastMappingsCore, type MappingSeedReport } from '@/lib/pos/toastMapping';

const MENU_ROUTE = '/[locale]/menu';

/**
 * Rebuild the Toast → app mapping from Toast's menu and recent orders.
 * Rows set by hand (MANUAL) are kept.
 */
export async function seedToastMappings(): Promise<{ success: boolean; error?: string; report?: MappingSeedReport }> {
    if (!(await isAdminSession())) return { success: false, error: 'Solo un administrador puede sincronizar el mapeo.' };
    try {
        const report = await seedToastMappingsCore();
        revalidatePath(MENU_ROUTE, 'page');
        return { success: true, report };
    } catch (e) {
        console.error('Failed to seed Toast mappings:', e instanceof Error ? e.message : e);
        return { success: false, error: 'No se pudo sincronizar el mapeo con Toast.' };
    }
}

export type PosMappingRow = {
    id: string;
    kind: string;
    posGuid: string;
    posDisplayName: string;
    matchedBy: string;
    menuItemId: string | null;
    menuItemModifierId: string | null;
    targetLabel: string | null;
};

/** Every Toast mapping row plus the options an admin can assign. */
export async function getToastMappings(): Promise<{
    rows: PosMappingRow[];
    menuItems: { id: string; name: string }[];
    modifiers: { id: string; label: string }[];
    error?: string;
}> {
    if (!(await isAdminSession())) return { rows: [], menuItems: [], modifiers: [], error: 'Solo un administrador puede ver el mapeo.' };
    const [rows, menuItems, modifiers] = await Promise.all([
        prisma.posItemMapping.findMany({
            where: { source: PosSource.TOAST },
            include: {
                menuItem: { select: { name: true } },
                menuItemModifier: { select: { name: true, menuItem: { select: { name: true } } } }
            },
            orderBy: [{ kind: 'asc' }, { posDisplayName: 'asc' }]
        }),
        prisma.menuItem.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        prisma.menuItemModifier.findMany({
            select: { id: true, name: true, menuItem: { select: { name: true } } },
            orderBy: [{ menuItem: { name: 'asc' } }, { name: 'asc' }]
        })
    ]);
    return {
        rows: rows.map(r => ({
            id: r.id,
            kind: r.kind,
            posGuid: r.posGuid,
            posDisplayName: r.posDisplayName,
            matchedBy: r.matchedBy,
            menuItemId: r.menuItemId,
            menuItemModifierId: r.menuItemModifierId,
            targetLabel: r.kind === 'ITEM'
                ? r.menuItem?.name ?? null
                : r.menuItemModifier ? `${r.menuItemModifier.menuItem.name} — ${r.menuItemModifier.name}` : null
        })),
        menuItems,
        modifiers: modifiers.map(m => ({ id: m.id, label: `${m.menuItem.name} — ${m.name}` }))
    };
}

/**
 * Assign a mapping by hand. targetId is a MenuItem id for an ITEM row and a
 * MenuItemModifier id for a MODIFIER row; null clears it. Either way the row
 * becomes MANUAL, so a re-seed leaves it alone.
 */
export async function setToastMapping(id: string, targetId: string | null): Promise<{ success: boolean; error?: string }> {
    if (!(await isAdminSession())) return { success: false, error: 'Solo un administrador puede cambiar el mapeo.' };
    try {
        const row = await prisma.posItemMapping.findUnique({ where: { id }, select: { kind: true } });
        if (!row) return { success: false, error: 'No se encontró la fila de mapeo.' };
        await prisma.posItemMapping.update({
            where: { id },
            data: row.kind === 'ITEM'
                ? { menuItemId: targetId, menuItemModifierId: null, matchedBy: 'MANUAL' }
                : { menuItemModifierId: targetId, menuItemId: null, matchedBy: 'MANUAL' }
        });
        revalidatePath(MENU_ROUTE, 'page');
        return { success: true };
    } catch (e) {
        console.error('Failed to set Toast mapping:', e instanceof Error ? e.message : e);
        return { success: false, error: 'No se pudo guardar el mapeo.' };
    }
}
