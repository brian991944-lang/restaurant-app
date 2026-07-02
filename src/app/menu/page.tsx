import prisma from '@/lib/prisma';
import MenuClient from './MenuClient';

// Read-only public menu. Always render fresh data (avoids build-time DB
// dependency and shows admin edits without a redeploy).
export const dynamic = 'force-dynamic';

export default async function PublicMenuPage() {
    const [categories, items] = await Promise.all([
        prisma.menuCategory.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
            select: { id: true, nameEn: true, nameEs: true, sortOrder: true },
        }),
        prisma.menuItem.findMany({
            where: { isAvailable: true, menuCategoryId: { not: null } },
            orderBy: { sortOrder: 'asc' },
            select: {
                id: true,
                name: true,
                nameEs: true,
                descriptionEn: true,
                descriptionEs: true,
                salePrice: true,
                photoUrl: true,
                videoUrl: true,
                isFeatured: true,
                menuCategoryId: true,
            },
        }),
    ]);

    return <MenuClient categories={categories} items={items} />;
}
