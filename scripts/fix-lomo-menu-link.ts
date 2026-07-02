// Pass C one-time fix: link the existing 'Lomo Saltado' MenuItem to the
// 'Main Courses' MenuCategory — ONLY if menuCategoryId is currently null.
// Fills nameEs/descriptionEn/descriptionEs only where null. Touches nothing else.
// Run with: npx tsx scripts/fix-lomo-menu-link.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const item = await prisma.menuItem.findUnique({ where: { name: 'Lomo Saltado' } });
    if (!item) {
        console.log('No MenuItem named "Lomo Saltado" found. Nothing to do.');
        return;
    }

    console.log('BEFORE:', JSON.stringify({
        id: item.id,
        name: item.name,
        nameEs: item.nameEs,
        descriptionEn: item.descriptionEn,
        descriptionEs: item.descriptionEs,
        menuCategoryId: item.menuCategoryId,
        salePrice: item.salePrice,
        cloverId: item.cloverId,
    }, null, 2));

    if (item.menuCategoryId !== null) {
        console.log('menuCategoryId is already set — aborting, no changes made.');
        return;
    }

    const mainCourses = await prisma.menuCategory.findFirst({ where: { nameEn: 'Main Courses' } });
    if (!mainCourses) {
        console.log('No "Main Courses" MenuCategory found — aborting, no changes made.');
        return;
    }

    const after = await prisma.menuItem.update({
        where: { id: item.id },
        data: {
            menuCategoryId: mainCourses.id,
            nameEs: item.nameEs ?? 'Lomo Saltado',
            descriptionEn: item.descriptionEn ?? 'Wok-seared beef tenderloin with onions, tomatoes and fries, served with rice.',
            descriptionEs: item.descriptionEs ?? 'Lomo de res salteado al wok con cebolla, tomate y papas fritas, servido con arroz.',
        },
    });

    console.log('AFTER:', JSON.stringify({
        id: after.id,
        name: after.name,
        nameEs: after.nameEs,
        descriptionEn: after.descriptionEn,
        descriptionEs: after.descriptionEs,
        menuCategoryId: after.menuCategoryId,
        salePrice: after.salePrice,
        cloverId: after.cloverId,
    }, null, 2));
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
