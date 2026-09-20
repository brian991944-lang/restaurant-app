'use server';

import prisma from '@/lib/prisma';
import { updateCloverItemDescription } from './clover';
import { revalidateMenuPaths } from '@/lib/menuRevalidate';
import { newForceToken } from '@/lib/menuSnapshot';
import { isAdminSession } from '@/lib/adminGuard';

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

export async function createMenuCategory(
    data: { nameEn: string; nameEs: string; subtitleEn?: string | null; subtitleEs?: string | null }
) {
    try {
        if (!data.nameEn?.trim() || !data.nameEs?.trim()) {
            return { success: false, error: 'El nombre en inglés y español son obligatorios.' };
        }
        const last = await prisma.menuCategory.findFirst({ orderBy: { sortOrder: 'desc' } });
        const category = await prisma.menuCategory.create({
            data: {
                nameEn: data.nameEn.trim(),
                nameEs: data.nameEs.trim(),
                subtitleEn: data.subtitleEn?.trim() || null,
                subtitleEs: data.subtitleEs?.trim() || null,
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
    data: { nameEn?: string; nameEs?: string; subtitleEn?: string | null; subtitleEs?: string | null; isActive?: boolean }
) {
    try {
        const category = await prisma.menuCategory.update({
            where: { id },
            data: {
                ...(data.nameEn !== undefined ? { nameEn: data.nameEn.trim() } : {}),
                ...(data.nameEs !== undefined ? { nameEs: data.nameEs.trim() } : {}),
                ...(data.subtitleEn !== undefined ? { subtitleEn: data.subtitleEn?.trim() || null } : {}),
                ...(data.subtitleEs !== undefined ? { subtitleEs: data.subtitleEs?.trim() || null } : {}),
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
    name: string;            // maps to MenuItem.name (@unique, EN). Clover-owned on linked rows.
    nameEn?: string | null;  // app-owned English display name; overrides `name` on the public menu
    nameEs?: string | null;
    descriptionEn?: string | null;
    descriptionEs?: string | null;
    taglineEn?: string | null;  // short "how we make it" line for the lightbox, max 60 chars
    taglineEs?: string | null;
    tags?: string[];             // MenuTagKey values from src/lib/menuTags.ts
    whyEn?: string | null;       // "why order it" line for the redesigned card
    whyEs?: string | null;
    componentsEn?: string[];     // what arrives at the table, one entry per component
    componentsEs?: string[];
    salePrice?: number;
    menuCategoryId?: string | null;
    photoUrl?: string | null;    // card cover
    photoUrls?: string[];        // lightbox gallery, append order = display order
    photoFocalX?: number;        // cover focal point X, 0-100 %
    photoFocalY?: number;        // cover focal point Y, 0-100 %
    photoZoom?: number;          // favorites-band cover zoom, 100-300 %
    photoFit?: string;           // favorites-band fit: "cover" or "contain"
    videoUrl?: string | null;
    isAvailable?: boolean;
    // App-owned "hide this dish". Separate from isAvailable, which the Clover
    // sync owns — see the MenuItem model for why they are two columns.
    hiddenInApp?: boolean;
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
                nameEn: data.nameEn?.trim() || null,
                nameEs: data.nameEs?.trim() || null,
                descriptionEn: data.descriptionEn?.trim() || null,
                descriptionEs: data.descriptionEs?.trim() || null,
                taglineEn: data.taglineEn?.trim() || null,
                taglineEs: data.taglineEs?.trim() || null,
                tags: data.tags ?? [],
                whyEn: data.whyEn?.trim() || null,
                whyEs: data.whyEs?.trim() || null,
                componentsEn: data.componentsEn ?? [],
                componentsEs: data.componentsEs ?? [],
                salePrice: data.salePrice ?? 0,
                menuCategoryId: data.menuCategoryId || null,
                photoUrl: data.photoUrl || null,
                photoUrls: data.photoUrls ?? [],
                photoFocalX: data.photoFocalX ?? 50,
                photoFocalY: data.photoFocalY ?? 50,
                photoZoom: data.photoZoom ?? 100,
                photoFit: data.photoFit ?? 'cover',
                videoUrl: data.videoUrl?.trim() || null,
                isAvailable: data.isAvailable ?? true,
                hiddenInApp: data.hiddenInApp ?? false,
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
        // isAvailable is Clover-owned on a linked row: syncMenuFromClover
        // rewrites it on every run, so accepting it here would be silently
        // undone (the same two-owners bug the Eye button had before it moved
        // to hiddenInApp). Dropped for linked rows; app-only dishes keep it.
        let isAvailable = data.isAvailable;
        if (isAvailable !== undefined) {
            const existing = await prisma.menuItem.findUnique({ where: { id }, select: { cloverId: true } });
            if (existing?.cloverId) isAvailable = undefined;
        }
        const item = await prisma.menuItem.update({
            where: { id },
            data: {
                ...(data.name !== undefined ? { name: data.name.trim() } : {}),
                ...(data.nameEn !== undefined ? { nameEn: data.nameEn?.trim() || null } : {}),
                ...(data.nameEs !== undefined ? { nameEs: data.nameEs?.trim() || null } : {}),
                ...(data.descriptionEn !== undefined ? { descriptionEn: data.descriptionEn?.trim() || null } : {}),
                ...(data.descriptionEs !== undefined ? { descriptionEs: data.descriptionEs?.trim() || null } : {}),
                ...(data.taglineEn !== undefined ? { taglineEn: data.taglineEn?.trim() || null } : {}),
                ...(data.taglineEs !== undefined ? { taglineEs: data.taglineEs?.trim() || null } : {}),
                ...(data.tags !== undefined ? { tags: data.tags } : {}),
                ...(data.whyEn !== undefined ? { whyEn: data.whyEn?.trim() || null } : {}),
                ...(data.whyEs !== undefined ? { whyEs: data.whyEs?.trim() || null } : {}),
                ...(data.componentsEn !== undefined ? { componentsEn: data.componentsEn } : {}),
                ...(data.componentsEs !== undefined ? { componentsEs: data.componentsEs } : {}),
                ...(data.salePrice !== undefined ? { salePrice: data.salePrice } : {}),
                ...(data.menuCategoryId !== undefined ? { menuCategoryId: data.menuCategoryId || null } : {}),
                ...(data.photoUrl !== undefined ? { photoUrl: data.photoUrl || null } : {}),
                ...(data.photoUrls !== undefined ? { photoUrls: data.photoUrls } : {}),
                ...(data.photoFocalX !== undefined ? { photoFocalX: data.photoFocalX } : {}),
                ...(data.photoFocalY !== undefined ? { photoFocalY: data.photoFocalY } : {}),
                ...(data.photoZoom !== undefined ? { photoZoom: data.photoZoom } : {}),
                ...(data.photoFit !== undefined ? { photoFit: data.photoFit } : {}),
                ...(data.videoUrl !== undefined ? { videoUrl: data.videoUrl?.trim() || null } : {}),
                ...(isAvailable !== undefined ? { isAvailable } : {}),
                ...(data.hiddenInApp !== undefined ? { hiddenInApp: data.hiddenInApp } : {}),
                ...(data.isFeatured !== undefined ? { isFeatured: data.isFeatured } : {})
                // cloverId / digitalRecipeId intentionally untouched — managed by the
                // Clover sync and Recetario integrations respectively.
            }
        });
        // Mirror descriptionEn to the linked Clover item's description (EN only;
        // descriptionEs is app-managed). Non-fatal: the app save never fails
        // because Clover is unreachable.
        if (item.cloverId && data.descriptionEn !== undefined) {
            await updateCloverItemDescription(item.cloverId, data.descriptionEn?.trim() || '');
        }
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

// Public-menu "Favorites" band. Ranks 1 and 2 are mutually exclusive PER CATEGORY
// — writing rank N first clears N from other items in the same category, leaving
// other categories untouched. A dish with no cover photo cannot be featured (the
// band renders an image). This is separate from isFeatured, which is untouched here.
export async function setFeaturedRank(itemId: string, rank: 1 | 2 | null) {
    try {
        if (rank !== null) {
            const item = await prisma.menuItem.findUnique({
                where: { id: itemId },
                select: { photoUrl: true, photoUrls: true, menuCategoryId: true }
            });
            if (!item) {
                return { success: false, error: 'El plato no existe.' };
            }
            const hasPhoto = !!(item.photoUrl || (item.photoUrls ?? [])[0]);
            if (!hasPhoto) {
                return { success: false, error: 'Este plato necesita una foto antes de destacarse.' };
            }
            // Atomic: within this item's category, strip this rank from whoever holds
            // it, then assign it here.
            await prisma.$transaction([
                prisma.menuItem.updateMany({
                    where: { featuredRank: rank, menuCategoryId: item.menuCategoryId, id: { not: itemId } },
                    data: { featuredRank: null }
                }),
                prisma.menuItem.update({
                    where: { id: itemId },
                    data: { featuredRank: rank }
                })
            ]);
        } else {
            await prisma.menuItem.update({
                where: { id: itemId },
                data: { featuredRank: null }
            });
        }
        revalidateMenuPaths();
        return { success: true };
    } catch (e) {
        console.error('setFeaturedRank failed:', e);
        return { success: false, error: 'No se pudo actualizar el destacado.' };
    }
}

// "Sold out for today". Writes soldOutAt (app-owned, never touched by the
// Clover sync). The mark is only honoured while it falls on the current
// business date (see isSoldOut in src/lib/menuSnapshot.ts), so un-marking is
// optional — it expires on its own at the 5 AM cutover.
export async function setMenuItemSoldOut(itemId: string, soldOut: boolean) {
    try {
        await prisma.menuItem.update({
            where: { id: itemId },
            data: { soldOutAt: soldOut ? new Date() : null }
        });
        revalidateMenuPaths();
        return { success: true };
    } catch (e) {
        console.error('setMenuItemSoldOut failed:', e);
        return { success: false, error: 'No se pudo actualizar el estado de agotado.' };
    }
}

// Rotates MenuPublishState.forceToken. Every offline client polling
// /api/menu/version sees a new token and re-downloads the snapshot, even if
// the content hashes did not change (e.g. a photo was replaced at the same URL).
// Admin-only: gated on the same fusionista_admin cookie as the other admin
// server actions (see src/lib/adminGuard.ts — a speed bump, not hardened auth).
export async function forceMenuRepublish() {
    try {
        if (!(await isAdminSession())) {
            return { success: false, error: 'Solo un administrador puede actualizar los iPads.' };
        }
        const token = newForceToken();
        const row = await prisma.menuPublishState.upsert({
            where: { id: 1 },
            update: { forceToken: token },
            create: { id: 1, forceToken: token }
        });
        revalidateMenuPaths();
        return { success: true, forceToken: row.forceToken };
    } catch (e) {
        console.error('forceMenuRepublish failed:', e);
        return { success: false, error: 'No se pudo forzar la republicación del menú.' };
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
