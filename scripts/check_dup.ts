import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
    const r = await prisma.menuItem.findMany({
        where: { name: 'Huancaina Sauce (2oz)' },
        include: { recipeIngredients: { include: { ingredient: true } } }
    });
    console.log(JSON.stringify(r, null, 2));
}

check().finally(() => prisma.$disconnect());
