import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
    const cat = await prisma.category.findFirst({ where: { name: 'Produce' } });
    if (!cat) return;
    const ingredients = await prisma.ingredient.findMany({ where: { categoryId: cat.id } });
    for (const ing of ingredients) {
        console.log(`- ${ing.name} (type: ${ing.type})`);
    }
    console.log(`Total: ${ingredients.length}`);
}

check().catch(console.error).finally(() => prisma.$disconnect());
