/**
 * Guest-facing menu snapshot for the offline clients (iPad menu).
 *
 * Feeds the three public routes under /api/menu: snapshot, version and
 * availability. The item filter and the field list mirror the public page in
 * src/app/menu/page.tsx exactly — if that page starts showing a new field,
 * add it here too, and nowhere else.
 *
 * Output objects are built field by field (never spread from the Prisma row)
 * so nothing admin-, cost-, recipe- or inventory-related can leak into the
 * payload: category (legacy string), targetFoodCostPct, cloverId,
 * cloverSyncedAt, cloverMissingAt, hasInventoryModifiers, digitalRecipeId and
 * the recipe/modifier relations are deliberately absent.
 *
 * Server-side Prisma only. No Supabase client, no browser code.
 */
import { createHash, randomBytes } from 'crypto';
import prisma from '@/lib/prisma';
import { getBusinessDate } from '@/lib/businessDay';

// Same three bars as the public page: 86'd in Clover (isAvailable), hidden by
// the admin (hiddenInApp), or not placed in a digital-menu category.
export const PUBLIC_MENU_ITEM_WHERE = {
    isAvailable: true,
    hiddenInApp: false,
    menuCategoryId: { not: null },
} as const;

export type SnapshotCategory = {
    id: string;
    nameEn: string;
    nameEs: string;
    subtitleEn: string | null;
    subtitleEs: string | null;
    sortOrder: number;
};

// Everything MenuClient renders, plus soldOut (app-owned, business-day scoped).
export type SnapshotItem = {
    id: string;
    name: string;
    nameEn: string | null;
    nameEs: string | null;
    descriptionEn: string | null;
    descriptionEs: string | null;
    taglineEn: string | null;
    taglineEs: string | null;
    tags: string[];
    allergens: string[];
    allergenNotesEn: string | null;
    allergenNotesEs: string | null;
    servedRaw: boolean;
    whyEn: string | null;
    whyEs: string | null;
    componentsEn: string[];
    componentsEs: string[];
    salePrice: number;
    photoUrl: string | null;
    photoUrls: string[];
    photoUrlFull: string | null;
    photoUrlsFull: string[];
    photoFocalX: number;
    photoFocalY: number;
    photoZoom: number;
    photoFit: string;
    videoUrl: string | null;
    isFeatured: boolean;
    featuredRank: number | null;
    sortOrder: number;
    menuCategoryId: string;
    soldOut: boolean;
};

export type MenuSnapshot = {
    categories: SnapshotCategory[];
    items: SnapshotItem[];
};

/**
 * Sold out = the mark was set on the CURRENT business date. Uses the same
 * 5 AM New York cutover as the rest of the kitchen, so a mark set at 11 PM is
 * still in force at 1 AM and gone by breakfast. No clearing job exists or is
 * needed — an old soldOutAt is simply not "today" any more.
 */
export function isSoldOut(soldOutAt: Date | null, now: Date = new Date()): boolean {
    if (!soldOutAt) return false;
    return getBusinessDate(soldOutAt) === getBusinessDate(now);
}

/**
 * Full guest-facing menu, ordered deterministically (sortOrder, then id) so
 * two loads of identical content produce byte-identical JSON and hashes.
 */
export async function loadMenuSnapshot(now: Date = new Date()): Promise<MenuSnapshot> {
    const [categories, items] = await Promise.all([
        prisma.menuCategory.findMany({
            where: { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            select: { id: true, nameEn: true, nameEs: true, subtitleEn: true, subtitleEs: true, sortOrder: true },
        }),
        prisma.menuItem.findMany({
            where: PUBLIC_MENU_ITEM_WHERE,
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            select: {
                id: true,
                name: true,
                nameEn: true,
                nameEs: true,
                descriptionEn: true,
                descriptionEs: true,
                taglineEn: true,
                taglineEs: true,
                tags: true,
                allergens: true,
                allergenNotesEn: true,
                allergenNotesEs: true,
                servedRaw: true,
                whyEn: true,
                whyEs: true,
                componentsEn: true,
                componentsEs: true,
                salePrice: true,
                photoUrl: true,
                photoUrls: true,
                photoUrlFull: true,
                photoUrlsFull: true,
                photoFocalX: true,
                photoFocalY: true,
                photoZoom: true,
                photoFit: true,
                videoUrl: true,
                isFeatured: true,
                featuredRank: true,
                sortOrder: true,
                menuCategoryId: true,
                soldOutAt: true,
            },
        }),
    ]);

    return {
        categories: categories.map(c => ({
            id: c.id,
            nameEn: c.nameEn,
            nameEs: c.nameEs,
            subtitleEn: c.subtitleEn,
            subtitleEs: c.subtitleEs,
            sortOrder: c.sortOrder,
        })),
        items: items.map(i => ({
            id: i.id,
            name: i.name,
            nameEn: i.nameEn,
            nameEs: i.nameEs,
            descriptionEn: i.descriptionEn,
            descriptionEs: i.descriptionEs,
            taglineEn: i.taglineEn,
            taglineEs: i.taglineEs,
            tags: [...i.tags],
            allergens: [...i.allergens],
            allergenNotesEn: i.allergenNotesEn,
            allergenNotesEs: i.allergenNotesEs,
            servedRaw: i.servedRaw,
            whyEn: i.whyEn,
            whyEs: i.whyEs,
            componentsEn: [...i.componentsEn],
            componentsEs: [...i.componentsEs],
            salePrice: i.salePrice,
            photoUrl: i.photoUrl,
            photoUrls: [...i.photoUrls],
            photoUrlFull: i.photoUrlFull,
            photoUrlsFull: [...i.photoUrlsFull],
            photoFocalX: i.photoFocalX,
            photoFocalY: i.photoFocalY,
            photoZoom: i.photoZoom,
            photoFit: i.photoFit,
            videoUrl: i.videoUrl,
            isFeatured: i.isFeatured,
            featuredRank: i.featuredRank,
            sortOrder: i.sortOrder,
            // Non-null by the where clause; narrowed here so the type says so.
            menuCategoryId: i.menuCategoryId as string,
            soldOut: isSoldOut(i.soldOutAt, now),
        })),
    };
}

/** [{ id, soldOut }] for visible items only — the availability route body. */
export function availabilityOf(snapshot: MenuSnapshot): { id: string; soldOut: boolean }[] {
    return snapshot.items.map(i => ({ id: i.id, soldOut: i.soldOut }));
}

// JSON with object keys sorted recursively, so the hash depends on content
// alone and never on the order a field happened to be assigned in.
function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function sha256(s: string): string {
    return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** SHA-256 of the snapshot with sold-out state stripped from every item. */
export function dataHashOf(snapshot: MenuSnapshot): string {
    const withoutSoldOut = {
        categories: snapshot.categories,
        items: snapshot.items.map(({ soldOut: _soldOut, ...rest }) => rest),
    };
    return sha256(stableStringify(withoutSoldOut));
}

/** SHA-256 over id + soldOut of every visible item, sorted by id. */
export function soldOutHashOf(snapshot: MenuSnapshot): string {
    const pairs = availabilityOf(snapshot)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(p => [p.id, p.soldOut]);
    return sha256(stableStringify(pairs));
}

export function newForceToken(): string {
    return randomBytes(8).toString('hex');
}

/**
 * The single MenuPublishState row. Created on first read if the seed never
 * ran, so the version route can never 500 on a missing row.
 */
export async function getForceToken(): Promise<string> {
    const row = await prisma.menuPublishState.upsert({
        where: { id: 1 },
        update: {},
        create: { id: 1, forceToken: newForceToken() },
        select: { forceToken: true },
    });
    return row.forceToken;
}

// Offline clients poll these; nothing between the server and the iPad may
// cache them, or a stale version answer would hide a real change.
export const NO_STORE_HEADERS = {
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
} as const;
