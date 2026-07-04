'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

// Revalidate the public digital menu and the admin editor after any write.
function revalidateMenuPaths() {
    revalidatePath('/menu');
    revalidatePath('/[locale]/menu', 'page');
}

// ============ CATEGORÍAS ============

export async function getMenuCategoriesAdmin() {
    try {
        return await prisma.menuCategory.findMany({
            orderBy: { sortOrder: 'asc' },
            include: { _count: { select: { menuItems: true } } }
        });
    } catch (e) {
        console.error('getMenuCategoriesAdmin failed:', e);
        return [];
    }
}

export async function createMenuCategory(nameEn: string, nameEs: string) {
    try {
        if (!nameEn?.trim() || !nameEs?.trim()) {
            return { success: false, error: 'El nombre en inglés y español son obligatorios.' };
        }
        const last = await prisma.menuCategory.findFirst({ orderBy: { sortOrder: 'desc' } });
        const category = await prisma.menuCategory.create({
            data: {
                nameEn: nameEn.trim(),
                nameEs: nameEs.trim(),
                sortOrder: (last?.sortOrder ?? -1) + 1
            }
        });
        revalidateMenuPaths();
        return { success: true, category };
    } catch (e) {
        console.error('createMenuCategory failed:', e);
        return { success: false, error: 'No se pudo crear la categoría.' };
    }
}

export async function updateMenuCategory(
    id: string,
    data: { nameEn?: string; nameEs?: string; isActive?: boolean }
) {
    try {
        const category = await prisma.menuCategory.update({
            where: { id },
            data: {
                ...(data.nameEn !== undefined ? { nameEn: data.nameEn.trim() } : {}),
                ...(data.nameEs !== undefined ? { nameEs: data.nameEs.trim() } : {}),
                ...(data.isActive !== undefined ? { isActive: data.isActive } : {})
            }
        });
        revalidateMenuPaths();
        return { success: true, category };
    } catch (e) {
        console.error('updateMenuCategory failed:', e);
        return { success: false, error: 'No se pudo actualizar la categoría.' };
    }
}

export async function reorderMenuCategories(orderedIds: string[]) {
    try {
        await prisma.$transaction(
            orderedIds.map((id, index) =>
                prisma.menuCategory.update({ where: { id }, data: { sortOrder: index } })
            )
        );
        revalidateMenuPaths();
        return { success: true };
    } catch (e) {
        console.error('reorderMenuCategories failed:', e);
        return { success: false, error: 'No se pudo reordenar las categorías.' };
    }
}

export async function deleteMenuCategory(id: string) {
    try {
        const itemCount = await prisma.menuItem.count({ where: { menuCategoryId: id } });
        if (itemCount > 0) {
            return {
                success: false,
                error: `No se puede eliminar: la categoría tiene ${itemCount} plato(s). Muévelos a otra categoría primero.`
            };
        }
        await prisma.menuCategory.delete({ where: { id } });
        revalidateMenuPaths();
        return { success: true };
    } catch (e) {
        console.error('deleteMenuCategory failed:', e);
        return { success: false, error: 'No se pudo eliminar la categoría.' };
    }
}

// ============ PLATOS ============

export async function getMenuItemsAdmin() {
    try {
        // Includes items with menuCategoryId null so pre-existing Clover-mapped rows
        // are visible and can be adopted into the digital menu.
        const items = await prisma.menuItem.findMany({
            include: {
                menuCategory: true,
                _count: { select: { recipeIngredients: true, modifiers: true } }
            },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
        });
        // Order by category sortOrder first (uncategorized last), then item sortOrder.
        return items.sort((a, b) => {
            const catA = a.menuCategory ? a.menuCategory.sortOrder : Number.MAX_SAFE_INTEGER;
            const catB = b.menuCategory ? b.menuCategory.sortOrder : Number.MAX_SAFE_INTEGER;
            if (catA !== catB) return catA - catB;
            if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
            return a.name.localeCompare(b.name);
        });
    } catch (e) {
        console.error('getMenuItemsAdmin failed:', e);
        return [];
    }
}

interface MenuItemInput {
    name: string;            // maps to MenuItem.name (@unique, EN)
    nameEs?: string | null;
    descriptionEn?: string | null;
    descriptionEs?: string | null;
    taglineEn?: string | null;  // short "how we make it" line for the lightbox, max 60 chars
    taglineEs?: string | null;
    salePrice?: number;
    menuCategoryId?: string | null;
    photoUrl?: string | null;    // card cover
    photoUrls?: string[];        // lightbox gallery, append order = display order
    videoUrl?: string | null;
    isAvailable?: boolean;
    isFeatured?: boolean;
}

const TAGLINE_MAX = 60;

function taglineError(data: MenuItemInput): string | null {
    if ((data.taglineEn?.trim().length ?? 0) > TAGLINE_MAX || (data.taglineEs?.trim().length ?? 0) > TAGLINE_MAX) {
        return `La frase no puede superar los ${TAGLINE_MAX} caracteres.`;
    }
    return null;
}

function isUniqueNameError(e: any) {
    return e?.code === 'P2002';
}

export async function createMenuItem(data: MenuItemInput) {
    try {
        if (!data.name?.trim()) {
            return { success: false, error: 'El nombre (EN) es obligatorio.' };
        }
        const tagErr = taglineError(data);
        if (tagErr) return { success: false, error: tagErr };
        const last = await prisma.menuItem.findFirst({
            where: { menuCategoryId: data.menuCategoryId ?? null },
            orderBy: { sortOrder: 'desc' }
        });
        const item = await prisma.menuItem.create({
            data: {
                name: data.name.trim(),
                nameEs: data.nameEs?.trim() || null,
                descriptionEn: data.descriptionEn?.trim() || null,
                descriptionEs: data.descriptionEs?.trim() || null,
                taglineEn: data.taglineEn?.trim() || null,
                taglineEs: data.taglineEs?.trim() || null,
                salePrice: data.salePrice ?? 0,
                menuCategoryId: data.menuCategoryId || null,
                photoUrl: data.photoUrl || null,
                photoUrls: data.photoUrls ?? [],
                videoUrl: data.videoUrl?.trim() || null,
                isAvailable: data.isAvailable ?? true,
                isFeatured: data.isFeatured ?? false,
                sortOrder: (last?.sortOrder ?? -1) + 1
                // cloverId is NOT set here — new digital-menu dishes are unlinked until
                // adopted by the future Clover POS sync integration.
                // digitalRecipeId is NOT set here — future Recetario link for food-cost reporting.
            }
        });
        revalidateMenuPaths();
        return { success: true, item };
    } catch (e) {
        console.error('createMenuItem failed:', e);
        if (isUniqueNameError(e)) {
            return { success: false, error: 'Ya existe un plato con ese nombre.' };
        }
        return { success: false, error: 'No se pudo crear el plato.' };
    }
}

export async function updateMenuItem(id: string, data: MenuItemInput) {
    try {
        if (data.name !== undefined && !data.name?.trim()) {
            return { success: false, error: 'El nombre (EN) es obligatorio.' };
        }
        const tagErr = taglineError(data);
        if (tagErr) return { success: false, error: tagErr };
        const item = await prisma.menuItem.update({
            where: { id },
            data: {
                ...(data.name !== undefined ? { name: data.name.trim() } : {}),
                ...(data.nameEs !== undefined ? { nameEs: data.nameEs?.trim() || null } : {}),
                ...(data.descriptionEn !== undefined ? { descriptionEn: data.descriptionEn?.trim() || null } : {}),
                ...(data.descriptionEs !== undefined ? { descriptionEs: data.descriptionEs?.trim() || null } : {}),
                ...(data.taglineEn !== undefined ? { taglineEn: data.taglineEn?.trim() || null } : {}),
                ...(data.taglineEs !== undefined ? { taglineEs: data.taglineEs?.trim() || null } : {}),
                ...(data.salePrice !== undefined ? { salePrice: data.salePrice } : {}),
                ...(data.menuCategoryId !== undefined ? { menuCategoryId: data.menuCategoryId || null } : {}),
                ...(data.photoUrl !== undefined ? { photoUrl: data.photoUrl || null } : {}),
                ...(data.photoUrls !== undefined ? { photoUrls: data.photoUrls } : {}),
                ...(data.videoUrl !== undefined ? { videoUrl: data.videoUrl?.trim() || null } : {}),
                ...(data.isAvailable !== undefined ? { isAvailable: data.isAvailable } : {}),
                ...(data.isFeatured !== undefined ? { isFeatured: data.isFeatured } : {})
                // cloverId / digitalRecipeId intentionally untouched — managed by the
                // Clover sync and Recetario integrations respectively.
            }
        });
        revalidateMenuPaths();
        return { success: true, item };
    } catch (e) {
        console.error('updateMenuItem failed:', e);
        if (isUniqueNameError(e)) {
            return { success: false, error: 'Ya existe un plato con ese nombre.' };
        }
        return { success: false, error: 'No se pudo actualizar el plato.' };
    }
}

export async function reorderMenuItems(categoryId: string, orderedIds: string[]) {
    try {
        await prisma.$transaction(
            orderedIds.map((id, index) =>
                prisma.menuItem.update({ where: { id }, data: { sortOrder: index } })
            )
        );
        revalidateMenuPaths();
        return { success: true };
    } catch (e) {
        console.error('reorderMenuItems failed:', e);
        return { success: false, error: 'No se pudo reordenar los platos.' };
    }
}

export async function deleteMenuItem(id: string) {
    try {
        const item = await prisma.menuItem.findUnique({
            where: { id },
            include: { _count: { select: { recipeIngredients: true, modifiers: true } } }
        });
        if (!item) {
            return { success: false, error: 'El plato no existe.' };
        }
        // SAFETY RULE: rows linked to Clover POS or with recipe/modifier relations feed
        // the Clover sync and food-costing engine — never hard-delete them here.
        if (item.cloverId || item._count.recipeIngredients > 0 || item._count.modifiers > 0) {
            return {
                success: false,
                error: 'Este plato está vinculado a Clover o tiene receta/modificadores (alimenta el costeo). No se puede eliminar — márcalo como "No disponible" en su lugar.'
            };
        }
        await prisma.menuItem.delete({ where: { id } });
        revalidateMenuPaths();
        return { success: true };
    } catch (e) {
        console.error('deleteMenuItem failed:', e);
        return { success: false, error: 'No se pudo eliminar el plato.' };
    }
}
