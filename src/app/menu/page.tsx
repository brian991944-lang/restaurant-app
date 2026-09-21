import prisma from '@/lib/prisma';
import { isSoldOut } from '@/lib/menuSnapshot';
import MenuClient from './MenuClient';

// Read-only public menu. Always render fresh data (avoids build-time DB
// dependency and shows admin edits without a redeploy).
export const dynamic = 'force-dynamic';

export default async function PublicMenuPage() {
    const now = new Date();
    const [categories, rows] = await Promise.all([
        prisma.menuCategory.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
            select: { id: true, nameEn: true, nameEs: true, subtitleEn: true, subtitleEs: true, sortOrder: true },
        }),
        prisma.menuItem.findMany({
            // isAvailable is Clover-owned (86'd in the POS); hiddenInApp is the
            // admin's own switch. A dish must clear both to reach a guest.
            // soldOutAt does NOT filter: a sold-out dish stays visible, marked.
            where: { isAvailable: true, hiddenInApp: false, menuCategoryId: { not: null } },
            orderBy: { sortOrder: 'asc' },
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
                menuCategoryId: true,
                soldOutAt: true,
            },
        }),
    ]);

    // Same business-date rule as /api/menu/snapshot (isSoldOut), so a guest's
    // phone and the iPad agree on what is "Agotado" today. The raw timestamp
    // never reaches the client.
    const items = rows.map(({ soldOutAt, ...item }) => ({ ...item, soldOut: isSoldOut(soldOutAt, now) }));

    return <MenuClient categories={categories} items={items} />;
}
