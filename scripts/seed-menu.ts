// Pass B seed: digital menu categories + sample items.
// Idempotent: categories match on nameEn; sample items are only created
// if NO MenuItem has a menuCategoryId yet, so re-runs and existing
// Clover-mapped items are never touched.
// Run with: npx tsx scripts/seed-menu.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CATEGORIES = [
    { nameEn: 'Appetizers', nameEs: 'Entradas', sortOrder: 0 },
    { nameEn: 'Tapas', nameEs: 'Tapas', sortOrder: 1 },
    { nameEn: 'Main Courses', nameEs: 'Platos Principales', sortOrder: 2 },
    { nameEn: 'Desserts', nameEs: 'Postres', sortOrder: 3 },
    { nameEn: 'Cold Drinks', nameEs: 'Bebidas Frías', sortOrder: 4 },
    { nameEn: 'Hot Drinks', nameEs: 'Bebidas Calientes', sortOrder: 5 },
    { nameEn: 'Kids Menu', nameEs: 'Menú Infantil', sortOrder: 6 },
    { nameEn: 'Sauces', nameEs: 'Salsas', sortOrder: 7 },
];

async function main() {
    // 1. Upsert categories (nameEn is not @unique, so emulate upsert with find-then-create/update)
    const categoryIds: Record<string, string> = {};
    for (const cat of CATEGORIES) {
        const existing = await prisma.menuCategory.findFirst({ where: { nameEn: cat.nameEn } });
        if (existing) {
            const updated = await prisma.menuCategory.update({
                where: { id: existing.id },
                data: { nameEs: cat.nameEs, sortOrder: cat.sortOrder },
            });
            categoryIds[cat.nameEn] = updated.id;
            console.log(`Category updated: ${cat.nameEn} / ${cat.nameEs} (sortOrder ${cat.sortOrder})`);
        } else {
            const created = await prisma.menuCategory.create({ data: cat });
            categoryIds[cat.nameEn] = created.id;
            console.log(`Category created: ${cat.nameEn} / ${cat.nameEs} (sortOrder ${cat.sortOrder})`);
        }
    }

    // 2. Sample menu items — only if no MenuItem is linked to a menu category yet
    const alreadyLinked = await prisma.menuItem.count({ where: { menuCategoryId: { not: null } } });
    if (alreadyLinked > 0) {
        console.log(`Skipping sample items: ${alreadyLinked} MenuItem(s) already have a menuCategoryId.`);
        return;
    }

    const SAMPLE_ITEMS = [
        {
            name: 'Ceviche Clásico',
            nameEs: 'Ceviche Clásico',
            descriptionEn: 'Fresh fish cured in lime juice with red onion, cilantro, sweet potato and Peruvian corn.',
            descriptionEs: 'Pescado fresco marinado en jugo de limón con cebolla roja, cilantro, camote y choclo.',
            salePrice: 18.5,
            isAvailable: true,
            menuCategoryId: categoryIds['Appetizers'],
        },
        {
            name: 'Lomo Saltado',
            nameEs: 'Lomo Saltado',
            descriptionEn: 'Wok-seared beef tenderloin with onions, tomatoes and fries, served with rice.',
            descriptionEs: 'Lomo de res salteado al wok con cebolla, tomate y papas fritas, servido con arroz.',
            salePrice: 22.0,
            isAvailable: true,
            menuCategoryId: categoryIds['Main Courses'],
        },
        {
            name: 'Chicha Morada',
            nameEs: 'Chicha Morada',
            descriptionEn: 'Traditional Peruvian purple corn drink with pineapple, cinnamon and clove.',
            descriptionEs: 'Bebida tradicional peruana de maíz morado con piña, canela y clavo.',
            salePrice: 6.0,
            isAvailable: true,
            menuCategoryId: categoryIds['Cold Drinks'],
        },
    ];

    for (const item of SAMPLE_ITEMS) {
        // name is @unique on MenuItem — never overwrite an existing row
        const existing = await prisma.menuItem.findUnique({ where: { name: item.name } });
        if (existing) {
            console.log(`Sample item skipped (name already exists): ${item.name}`);
            continue;
        }
        await prisma.menuItem.create({ data: item });
        console.log(`Sample item created: ${item.name} ($${item.salePrice})`);
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
