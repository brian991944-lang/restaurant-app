const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function getDigitalRecipes() {
    try {
        return await prisma.digitalRecipe.findMany({
            orderBy: { recipeCode: 'asc' },
            include: { linkedTasks: true, category: true }
        });
    } catch (e) {
        console.error("PRISMA ERROR:", e);
        return [];
    }
}

getDigitalRecipes().then(res => console.log("Returned count:", res.length)).catch(console.error).finally(() => prisma.$disconnect());
