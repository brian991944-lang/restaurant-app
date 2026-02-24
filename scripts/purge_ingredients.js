const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
    console.log("Starting duplicate ingredients purge script...");

    const allIngredients = await prisma.ingredient.findMany();

    // Group by name
    const groupedByName = {};
    for (const ing of allIngredients) {
        if (!groupedByName[ing.name]) {
            groupedByName[ing.name] = [];
        }
        groupedByName[ing.name].push(ing);
    }

    let deletedCount = 0;

    for (const name in groupedByName) {
        let items = groupedByName[name];

        // If there's more than 1 item with the same name
        if (items.length > 1) {
            console.log(`Found ${items.length} duplicates for "${name}"`);

            // Sort to keep the one with most relations or just the first one
            // We'll keep the first one
            const keptItem = items[0];
            const duplicateItems = items.slice(1);

            for (const dup of duplicateItems) {
                console.log(`Deleting duplicate ID: ${dup.id} (${name})`);

                // First update child references if any
                await prisma.ingredient.updateMany({
                    where: { parentId: dup.id },
                    data: { parentId: keptItem.id }
                });

                // Update recipe ingredients
                await prisma.recipeIngredient.updateMany({
                    where: { ingredientId: dup.id },
                    data: { ingredientId: keptItem.id }
                });

                // Update vendor items
                await prisma.vendorMarketItem.updateMany({
                    where: { ingredientId: dup.id },
                    data: { ingredientId: keptItem.id }
                });

                // Delete inventory and transactions to avoid constraint failures
                await prisma.inventory.deleteMany({
                    where: { ingredientId: dup.id }
                });

                await prisma.ingredient.delete({
                    where: { id: dup.id }
                });
                deletedCount++;
            }
        }
    }

    console.log(`Purge complete! Deleted ${deletedCount} duplicate items.`);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
