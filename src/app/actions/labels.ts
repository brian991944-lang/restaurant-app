'use server';

import prisma from '@/lib/prisma';
import { isAdminSession } from '@/lib/adminGuard';

// Etiquetas — what the label modal and the Etiquetas screen read. Every
// kitchen product that is not a raw purchase can get a label; how long it
// lasts in the fridge and in the freezer lives on the Ingredient row.

export interface LabelProduct {
    id: string;
    name: string;
    nameEs: string | null;
    category: string;
    fridgeDays: number | null;
    freezerDays: number | null;
}

const toProduct = (i: {
    id: string; name: string; nameEs: string | null;
    shelfLifeFridgeDays: number | null; shelfLifeFreezerDays: number | null;
    category: { name: string } | null;
}): LabelProduct => ({
    id: i.id,
    name: i.name,
    nameEs: i.nameEs,
    category: i.category?.name ?? '',
    fridgeDays: i.shelfLifeFridgeDays,
    freezerDays: i.shelfLifeFreezerDays,
});

const SELECT = {
    id: true, name: true, nameEs: true,
    shelfLifeFridgeDays: true, shelfLifeFreezerDays: true,
    category: { select: { name: true } },
} as const;

export async function getLabelProducts(): Promise<{ success: boolean; products: LabelProduct[] }> {
    try {
        const rows = await prisma.ingredient.findMany({
            where: { isActive: true, isSalonItem: false, type: { not: 'RAW' } },
            select: SELECT,
            orderBy: { name: 'asc' },
        });
        return { success: true, products: rows.map(toProduct) };
    } catch (e) {
        console.error('getLabelProducts failed', e);
        return { success: false, products: [] };
    }
}

export async function getLabelProduct(ingredientId: string): Promise<{ success: boolean; product: LabelProduct | null }> {
    try {
        const row = await prisma.ingredient.findUnique({ where: { id: ingredientId }, select: SELECT });
        return { success: !!row, product: row ? toProduct(row) : null };
    } catch (e) {
        console.error('getLabelProduct failed', e);
        return { success: false, product: null };
    }
}

const cleanDays = (v: number | null): number | null => {
    if (v === null || !Number.isFinite(v)) return null;
    const n = Math.round(v);
    return n >= 1 && n <= 730 ? n : null;
};

/** Admin only. Null clears the value, which puts the product back on the default. */
export async function updateShelfLife(
    ingredientId: string,
    fridgeDays: number | null,
    freezerDays: number | null,
): Promise<{ success: boolean; code?: 'NOT_ADMIN' | 'FAILED'; product?: LabelProduct }> {
    if (!(await isAdminSession())) return { success: false, code: 'NOT_ADMIN' };
    try {
        const row = await prisma.ingredient.update({
            where: { id: ingredientId },
            data: { shelfLifeFridgeDays: cleanDays(fridgeDays), shelfLifeFreezerDays: cleanDays(freezerDays) },
            select: SELECT,
        });
        return { success: true, product: toProduct(row) };
    } catch (e) {
        console.error('updateShelfLife failed', e);
        return { success: false, code: 'FAILED' };
    }
}
