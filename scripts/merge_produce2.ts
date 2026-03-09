import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
    try {
        console.log("Starting Produce & Vegetales y Frutas Merge...");

        // Find the "Vegetales y Frutas" category. This is our surviving slug.
        let targetCategory = await prisma.category.findFirst({
            where: { name: 'Vegetales y Frutas' }
        });

        // Find the "Produce" category to delete
        let redundantCategory = await prisma.category.findFirst({
            where: { name: 'Produce' }
        });

        if (!targetCategory) {
            console.log("Vegetales y Frutas not found, checking if already renamed...");
            targetCategory = await prisma.category.findFirst({
                where: { name: 'Produce', nameEs: 'Vegetales y Frutas' }
            });
            // meaning redundant category is something else or null
            if (targetCategory && targetCategory.id === redundantCategory?.id) redundantCategory = null;
        }

        if (targetCategory && redundantCategory && targetCategory.id !== redundantCategory.id) {
            console.log("Moving ingredients from 'Produce' to 'Vegetales y Frutas'...");
            await prisma.ingredient.updateMany({
                where: { categoryId: redundantCategory.id },
                data: { categoryId: targetCategory.id }
            });

            console.log("Deleting redundant Produce category...");
            await prisma.category.delete({ where: { id: redundantCategory.id } });
        }

        if (targetCategory) {
            console.log("Updating name schema to Produce / Vegetales y Frutas for frontend locale conditional...");
            targetCategory = await prisma.category.update({
                where: { id: targetCategory.id },
                data: { name: 'Produce', nameEs: 'Vegetales y Frutas' }
            });
        }

        // Now deduplication in the merged category
        if (!targetCategory) {
            console.error("Target category not found to dedupe!");
            return;
        }

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

        const groups = new Map<string, any[]>();
        for (const ing of allIngredients) {
            // we'll strip spaces and convert to lower case for comparison
            const lowName = ing.name.toLowerCase().trim();
            if (!groups.has(lowName)) groups.set(lowName, []);
            groups.get(lowName)!.push(ing);
        }

        for (const [name, list] of groups.entries()) {
            if (list.length > 1) {
                console.log(`Found duplicate group for: ${name} (${list.length} records)`);

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

                console.log(`   Keeping rich item: ${rich.name} (${rich.id}) (Score: ${scored[0].score})`);

                for (const dup of duplicates) {
                    console.log(`   Merging duplicate: ${dup.name} (${dup.id}) into ${rich.id}`);

                    if (dup.inventory) {
                        if (!rich.inventory) {
                            await prisma.inventory.update({
                                where: { id: dup.inventory.id },
                                data: { ingredientId: rich.id }
                            });
                            rich.inventory = dup.inventory;
                        } else {
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

                    await prisma.inventoryTransaction.updateMany({
                        where: { ingredientId: dup.id },
                        data: { ingredientId: rich.id }
                    });

                    await prisma.ingredient.updateMany({
                        where: { parentId: dup.id },
                        data: { parentId: rich.id }
                    });

                    await prisma.prepRecipeIngredient.updateMany({
                        where: { prepRecipeId: dup.id },
                        data: { prepRecipeId: rich.id }
                    });

                    let prepRIs = await prisma.prepRecipeIngredient.findMany({ where: { ingredientId: dup.id } });
                    for (const p of prepRIs) {
                        try {
                            await prisma.prepRecipeIngredient.update({ where: { id: p.id }, data: { ingredientId: rich.id } });
                        } catch (e) {
                            await prisma.prepRecipeIngredient.delete({ where: { id: p.id } });
                        }
                    }

                    let menuRIs = await prisma.recipeIngredient.findMany({ where: { ingredientId: dup.id } });
                    for (const m of menuRIs) {
                        try {
                            await prisma.recipeIngredient.update({ where: { id: m.id }, data: { ingredientId: rich.id } });
                        } catch (e) {
                            await prisma.recipeIngredient.delete({ where: { id: m.id } });
                        }
                    }

                    await prisma.prepAssignment.updateMany({
                        where: { ingredientId: dup.id },
                        data: { ingredientId: rich.id }
                    });

                    await prisma.recurringPrepRule.updateMany({
                        where: { ingredientId: dup.id },
                        data: { ingredientId: rich.id }
                    });

                    let vendors = await prisma.vendorMarketItem.findMany({ where: { ingredientId: dup.id } });
                    for (const v of vendors) {
                        try {
                            await prisma.vendorMarketItem.update({ where: { id: v.id }, data: { ingredientId: rich.id } });
                        } catch (e) {
                            await prisma.vendorMarketItem.delete({ where: { id: v.id } });
                        }
                    }

                    await prisma.ingredient.updateMany({
                        where: { activeMarketItemId: dup.id },
                        data: { activeMarketItemId: null }
                    });

                    let modifiers = await prisma.modifierIngredient.findMany({ where: { ingredientId: dup.id } });
                    for (const m of modifiers) {
                        try {
                            await prisma.modifierIngredient.update({ where: { id: m.id }, data: { ingredientId: rich.id } });
                        } catch (e) {
                            await prisma.modifierIngredient.delete({ where: { id: m.id } });
                        }
                    }

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
