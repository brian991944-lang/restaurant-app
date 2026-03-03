const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('Starting migration for PREP_RECIPE batch sizes...');
    const recipes = await prisma.ingredient.findMany({
        where: { type: 'PREP_RECIPE' }
    });

    console.log(`Found ${recipes.length} prep recipes.`);

    for (const recipe of recipes) {
        if (recipe.yieldPercent !== 100) {
            console.log(`Migrating recipe: ${recipe.name}. Moving batch size ${recipe.yieldPercent} to portionWeightG.`);
            await prisma.ingredient.update({
                where: { id: recipe.id },
                data: {
                    portionWeightG: recipe.yieldPercent, // Save the batch size to the new location
                    yieldPercent: 100, // Reset the Waste % to 100 (0% waste by default)
                }
            });
        }
    }

    console.log('Migration completed successfully.');
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
