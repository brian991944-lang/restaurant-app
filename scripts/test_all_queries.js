const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testAll() {
    try {
        console.log("Fetching recipes...");
        const data = await prisma.digitalRecipe.findMany({
            orderBy: { recipeCode: 'asc' },
            include: { linkedTasks: true, category: true }
        });
        console.log("Recipes:", data.length);

        console.log("Fetching preps...");
        const preps = await prisma.ingredient.findMany({
            where: { type: 'PREP_RECIPE' },
            select: { id: true, name: true, digitalRecipeId: true, type: true }
        });
        console.log("Preps:", preps.length);

        console.log("Fetching categories...");
        const cats = await prisma.category.findMany({
            orderBy: { order: 'asc' }
        });
        console.log("Cats:", cats.length);
    } catch (e) {
        console.error("PRISMA ERROR:", e);
    }
}

testAll().finally(() => prisma.$disconnect());
