const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const recipes = await prisma.digitalRecipe.findMany({
        include: { category: true },
        orderBy: { createdAt: 'asc' }
    });

    const prefixCounters = {};

    for (const recipe of recipes) {
        let prefix = "LBX";
        if (recipe.category) {
            const nameToUse = recipe.category.nameEs || recipe.category.name || '';
            let rawStr = nameToUse.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z]/g, '');
            if (rawStr.length > 0) {
                prefix = rawStr.substring(0, 3).toUpperCase().padEnd(3, 'X');
            }
        }

        if (!prefixCounters[prefix]) {
            prefixCounters[prefix] = 1;
        } else {
            prefixCounters[prefix]++;
        }

        const nextNum = prefixCounters[prefix];
        const newCode = `${prefix}-${String(nextNum).padStart(3, '0')}`;

        if (recipe.recipeCode !== newCode) {
            console.log(`Updating ${recipe.name}: ${recipe.recipeCode} -> ${newCode}`);
            await prisma.digitalRecipe.update({
                where: { id: recipe.id },
                data: { recipeCode: newCode }
            });

            await prisma.digitalRecipeHistory.updateMany({
                where: { recipeId: recipe.id },
                data: { recipeCode: newCode }
            });
        }
    }
    console.log("Migration complete.");
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
