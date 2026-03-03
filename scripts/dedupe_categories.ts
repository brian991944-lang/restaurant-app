import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
    try {
        console.log("Starting Category Merge & Deduplication...");

        // 1. Find the target category
        let targetCategory = await prisma.category.findFirst({
            where: { name: 'Vegetales y Frutas' }
        });

        let oldCategory = await prisma.category.findFirst({
            where: { name: 'Vegetales' }
        });

        if (!targetCategory && oldCategory) {
            console.log("Renaming Vegetales to Vegetales y Frutas...");
            targetCategory = await prisma.category.update({
                where: { id: oldCategory.id },
                data: { name: 'Vegetales y Frutas', nameEs: 'Vegetales y Frutas' }
            });
            oldCategory = null;
        } else if (!targetCategory) {
            console.log("Creating Vegetales y Frutas...");
            targetCategory = await prisma.category.create({
                data: { name: 'Vegetales y Frutas', nameEs: 'Vegetales y Frutas', department: 'FOOD' }
            });
        }

        if (oldCategory && oldCategory.id !== targetCategory.id) {
            console.log("Moving ingredients from Vegetales to Vegetales y Frutas...");
            await prisma.ingredient.updateMany({
                where: { categoryId: oldCategory.id },
                data: { categoryId: targetCategory.id }
            });

            console.log("Deleting old Vegetales category...");
            await prisma.category.delete({ where: { id: oldCategory.id } });
        }

        // 2. Find all ingredients in the new category to check for duplicates
        const allIngredients = await prisma.ingredient.findMany({
            where: { categoryId: targetCategory.id },
            include: {
                inventory: true,
                transactions: true,
                recipeIngredients: true,
                prepAssignments: true,
                composedOf: true,
                usedInPreps: true
            }
        });

        // Group by case-insensitive name
        const groups = new Map<string, any[]>();
        for (const ing of allIngredients) {
            const lowName = ing.name.toLowerCase().trim();
            if (!groups.has(lowName)) groups.set(lowName, []);
            groups.get(lowName)!.push(ing);
        }

        for (const [name, list] of groups.entries()) {
            if (list.length > 1) {
                console.log(`Found duplicate group for: ${name} (${list.length} records)`);

                // Score them to find the "rich" one
                const scored = list.map(item => {
                    let score = 0;
                    if (item.currentPrice > 0) score += 10;
                    if (item.recipeIngredients.length > 0) score += 5;
                    if (item.composedOf.length > 0) score += 5;
                    if (item.usedInPreps.length > 0) score += 5;
                    if (item.inventory) score += 2;
                    if (item.transactions.length > 0) score += 2;
                    if (item.prepAssignments.length > 0) score += 2;
                    return { item, score };
                });

                scored.sort((a, b) => b.score - a.score);
                const rich = scored[0].item;
                const duplicates = scored.slice(1).map(s => s.item);

                console.log(`   Keeping rich item: ${rich.id} (Score: ${scored[0].score})`);

                for (const dup of duplicates) {
                    console.log(`   Merging duplicate: ${dup.id} into ${rich.id}`);

                    // Re-link Inventory
                    if (dup.inventory) {
                        if (!rich.inventory) {
                            await prisma.inventory.update({
                                where: { id: dup.inventory.id },
                                data: { ingredientId: rich.id }
                            });
                            // Update rich object so we know it has inventory now
                            rich.inventory = dup.inventory;
                        } else {
                            // Both have inventory, maybe merge quantities?
                            await prisma.inventory.update({
                                where: { id: rich.inventory.id },
                                data: {
                                    frozenQty: rich.inventory.frozenQty + dup.inventory.frozenQty,
                                    thawingQty: rich.inventory.thawingQty + dup.inventory.thawingQty
                                }
                            });
                            await prisma.inventory.delete({ where: { id: dup.inventory.id } });
                        }
                    }

                    // Move Transactions
                    await prisma.inventoryTransaction.updateMany({
                        where: { ingredientId: dup.id },
                        data: { ingredientId: rich.id }
                    });

                    // Move child relationships where parentId = dup
                    await prisma.ingredient.updateMany({
                        where: { parentId: dup.id },
                        data: { parentId: rich.id }
                    });

                    // Prep recipe memberships
                    await prisma.prepRecipeIngredient.updateMany({
                        where: { prepRecipeId: dup.id },
                        data: { prepRecipeId: rich.id }
                    });

                    // We need to be careful with unique constraints or duplicate pairs if a recipe has both dup and rich?
                    // But assume they don't simultaneously exist in the same recipe.
                    let prepRIs = await prisma.prepRecipeIngredient.findMany({ where: { ingredientId: dup.id } });
                    for (const p of prepRIs) {
                        try {
                            await prisma.prepRecipeIngredient.update({ where: { id: p.id }, data: { ingredientId: rich.id } });
                        } catch (e) {
                            // if combination already exists, just delete the duplicate row
                            await prisma.prepRecipeIngredient.delete({ where: { id: p.id } });
                        }
                    }

                    // Menu recipe ingredients
                    let menuRIs = await prisma.recipeIngredient.findMany({ where: { ingredientId: dup.id } });
                    for (const m of menuRIs) {
                        try {
                            await prisma.recipeIngredient.update({ where: { id: m.id }, data: { ingredientId: rich.id } });
                        } catch (e) {
                            await prisma.recipeIngredient.delete({ where: { id: m.id } });
                        }
                    }

                    // Prep assignments
                    await prisma.prepAssignment.updateMany({
                        where: { ingredientId: dup.id },
                        data: { ingredientId: rich.id }
                    });

                    // Recurring Prep rules
                    await prisma.recurringPrepRule.updateMany({
                        where: { ingredientId: dup.id },
                        data: { ingredientId: rich.id }
                    });

                    // Vendor Market Items
                    let vendors = await prisma.vendorMarketItem.findMany({ where: { ingredientId: dup.id } });
                    for (const v of vendors) {
                        try {
                            await prisma.vendorMarketItem.update({ where: { id: v.id }, data: { ingredientId: rich.id } });
                        } catch (e) {
                            await prisma.vendorMarketItem.delete({ where: { id: v.id } });
                        }
                    }

                    // Active vendor items pointer
                    await prisma.ingredient.updateMany({
                        where: { activeMarketItemId: dup.id },
                        data: { activeMarketItemId: null } // Or rich.activeMarketItemId if applicable, but safer null
                    });

                    // Modifier Ingredients
                    let modifiers = await prisma.modifierIngredient.findMany({ where: { ingredientId: dup.id } });
                    for (const m of modifiers) {
                        try {
                            await prisma.modifierIngredient.update({ where: { id: m.id }, data: { ingredientId: rich.id } });
                        } catch (e) {
                            await prisma.modifierIngredient.delete({ where: { id: m.id } });
                        }
                    }

                    // Finally delete duplicate
                    await prisma.ingredient.delete({ where: { id: dup.id } });
                    console.log(`   Deleted duplicate ${dup.id}`);
                }
            }
        }
        console.log("Migration complete.");
    } catch (error) {
        console.error("Migration failed:", error);
    } finally {
        await prisma.$disconnect();
    }
}

run();
