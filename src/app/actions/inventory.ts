'use server';

import prisma from '@/lib/prisma';
import { getConversionFactor } from '@/lib/conversion';

async function translateToSpanish(text: string): Promise<string> {
    if (!text) return text;
    try {
        const response = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=es&dt=t&q=${encodeURIComponent(text)}`);
        const data = await response.json();
        return data[0][0][0] || text;
    } catch (e) {
        console.error("Translation fail:", e);
        return `${text} (ES)`;
    }
}

export async function getInventory() {
    return prisma.ingredient.findMany({
        where: {
            type: {
                in: ['RAW', 'PROCESSED', 'PREP_RECIPE']
            }
        },
        include: {
            category: true,
            provider: true,
            inventory: true,
            parent: true,
            vendorMarketItems: true,
            composedOf: {
                include: {
                    ingredient: true
                }
            },
            transactions: {
                where: {
                    type: 'SALES_DEDUCT_CLOVER',
                    createdAt: {
                        gte: new Date(new Date().setHours(0, 0, 0, 0))
                    }
                }
            }
        }
    });
}

export async function getProviders() {
    return prisma.provider.findMany({
        include: {
            _count: {
                select: { ingredients: true }
            }
        }
    });
}

export async function getCategories() {
    return prisma.category.findMany({
        include: {
            _count: {
                select: { ingredients: true }
            }
        }
    });
}

export async function addIngredient(data: any) {
    try {
        let categoryNameEs = data.categoryNameEs || null;
        if (data.autoTranslate && data.categoryName && !categoryNameEs) {
            categoryNameEs = await translateToSpanish(data.categoryName);
        }

        let nameEs = data.nameEs || null;
        if (data.autoTranslate && data.name && !nameEs) {
            nameEs = await translateToSpanish(data.name);
        }

        // Find or create category by name first, so we don't break if the user just typed it
        let category = await prisma.category.findFirst({
            where: { name: data.categoryName }
        });

        if (!category) {
            category = await prisma.category.create({
                data: {
                    name: data.categoryName,
                    nameEs: categoryNameEs,
                    autoTranslate: data.autoTranslate,
                    department: 'FOOD' // Default
                }
            });
        }

        let providerId = null;
        if (data.providerName) {
            let provider = await prisma.provider.findFirst({
                where: { name: data.providerName }
            });
            if (!provider) {
                provider = await prisma.provider.create({ data: { name: data.providerName } });
            }
            providerId = provider.id;
        }

        const ingredient = await prisma.ingredient.create({
            data: {
                name: data.name,
                nameEs: nameEs,
                autoTranslate: data.autoTranslate,
                type: data.type,
                categoryId: category.id,
                metric: data.metric || 'units',
                providerId: providerId,
                portionWeightG: data.portionSize !== null && data.portionSize !== undefined ? parseFloat(data.portionSize) : 1000,
                yieldPercent: data.yieldPercent !== undefined ? data.yieldPercent : 100,
                trackFreezerStatus: data.trackFreezerStatus !== undefined ? data.trackFreezerStatus : false,
                currentPrice: data.currentPrice || 0,
                parentId: data.parentId || null,
                cloverId: data.cloverId || null,
                mappingMultiplier: data.mappingMultiplier !== undefined ? parseFloat(data.mappingMultiplier) : 1.0,
                inventory: {
                    create: {
                        frozenQty: data.initialQty || 0,
                        thawingQty: data.unfrozenQuantity !== undefined ? parseFloat(data.unfrozenQuantity) : 0
                    }
                }
            }
        });
        return { success: true, ingredient };
    } catch (e) {
        console.error('Failed to add ingredient:', e);
        return { success: false, error: 'Database Error' };
    }
}

export async function editIngredient(id: string, data: any) {
    try {
        let categoryNameEs = data.categoryNameEs || null;
        if (data.autoTranslate && data.categoryName && !categoryNameEs) {
            categoryNameEs = await translateToSpanish(data.categoryName);
        }

        let nameEs = data.nameEs || null;
        if (data.autoTranslate && data.name && !nameEs) {
            nameEs = await translateToSpanish(data.name);
        }

        let category = await prisma.category.findFirst({
            where: { name: data.categoryName }
        });

        if (!category) {
            category = await prisma.category.create({
                data: {
                    name: data.categoryName,
                    nameEs: categoryNameEs,
                    autoTranslate: data.autoTranslate,
                    department: 'FOOD'
                }
            });
        }

        let providerId = undefined;
        if (data.providerName !== undefined) {
            if (data.providerName) {
                let provider = await prisma.provider.findFirst({
                    where: { name: data.providerName }
                });
                if (!provider) {
                    provider = await prisma.provider.create({ data: { name: data.providerName } });
                }
                providerId = provider.id;
            } else {
                providerId = null;
            }
        }

        const ingredient = await prisma.ingredient.update({
            where: { id },
            data: {
                name: data.name,
                nameEs: nameEs,
                autoTranslate: data.autoTranslate,
                type: data.type,
                categoryId: category.id,
                metric: data.metric || 'units',
                providerId: providerId !== undefined ? providerId : undefined,
                portionWeightG: data.portionSize !== null && data.portionSize !== undefined ? parseFloat(data.portionSize) : undefined,
                yieldPercent: data.yieldPercent !== undefined ? data.yieldPercent : 100,
                trackFreezerStatus: data.trackFreezerStatus !== undefined ? data.trackFreezerStatus : undefined,
                currentPrice: data.currentPrice !== undefined ? data.currentPrice : undefined,
                parentId: data.parentId !== undefined ? data.parentId : undefined,
                cloverId: data.cloverId !== undefined ? (data.cloverId || null) : undefined,
                mappingMultiplier: data.mappingMultiplier !== undefined ? parseFloat(data.mappingMultiplier) : undefined,
                activeMarketItemId: data.activeMarketItemId !== undefined ? (data.activeMarketItemId || null) : undefined,
            }
        });

        if (data.unfrozenQuantity !== undefined) {
            await prisma.inventory.upsert({
                where: { ingredientId: id },
                create: { ingredientId: id, thawingQty: parseFloat(data.unfrozenQuantity), frozenQty: 0 },
                update: { thawingQty: parseFloat(data.unfrozenQuantity) }
            });
        }

        // Set the active market item price directly onto current price
        if (data.activeMarketItemId) {
            const vm = await prisma.vendorMarketItem.findUnique({ where: { id: data.activeMarketItemId } });
            if (vm) {
                await prisma.ingredient.update({
                    where: { id },
                    data: {
                        currentPrice: vm.currentPackPrice / vm.packSize
                    }
                })
            }
        }

        return { success: true, ingredient };
    } catch (e) {
        console.error('Failed to edit ingredient:', e);
        return { success: false, error: 'Database Error' };
    }
}

export async function savePrepRecipe(id: string | null, data: any) {
    try {
        let categoryNameEs = data.categoryNameEs || null;
        if (data.autoTranslate && data.categoryName && !categoryNameEs) {
            categoryNameEs = await translateToSpanish(data.categoryName);
        }

        let nameEs = data.nameEs || null;
        if (data.autoTranslate && data.name && !nameEs) {
            nameEs = await translateToSpanish(data.name);
        }

        let category = await prisma.category.findFirst({
            where: { name: data.categoryName }
        });

        if (!category) {
            category = await prisma.category.create({
                data: {
                    name: data.categoryName,
                    nameEs: categoryNameEs,
                    department: 'FOOD'
                }
            });
        }

        const ingredientData = {
            name: data.name,
            nameEs: nameEs,
            type: 'PREP_RECIPE',
            categoryId: category.id,
            metric: data.metric || 'L',
            yieldPercent: data.yieldPercent || 1, // yieldPercent will literally be Batch Size (amount produced)
            currentPrice: 0,
        };

        if (id) {
            const updated = await prisma.ingredient.update({
                where: { id },
                data: ingredientData
            });
            // Update composedOf
            await prisma.prepRecipeIngredient.deleteMany({ where: { prepRecipeId: id } });
            if (data.components && data.components.length > 0) {
                await prisma.prepRecipeIngredient.createMany({
                    data: data.components.map((c: any) => ({
                        prepRecipeId: id,
                        ingredientId: c.ingredientId,
                        quantity: parseFloat(c.quantity)
                    }))
                });
            }
            return { success: true, ingredient: updated };
        } else {
            const ingredient = await prisma.ingredient.create({
                data: {
                    ...ingredientData,
                    inventory: {
                        create: { frozenQty: 0, thawingQty: 0 }
                    }
                }
            });
            if (data.components && data.components.length > 0) {
                await prisma.prepRecipeIngredient.createMany({
                    data: data.components.map((c: any) => ({
                        prepRecipeId: ingredient.id,
                        ingredientId: c.ingredientId,
                        quantity: parseFloat(c.quantity)
                    }))
                });
            }
            return { success: true, ingredient };
        }
    } catch (e) {
        console.error('Failed to save prep recipe:', e);
        return { success: false, error: 'Database Error' };
    }
}

export async function bulkAddIngredients(ingredients: any[]) {
    try {
        let addedCount = 0;
        for (const data of ingredients) {
            try {
                // Simplified lookup or create category
                let category = await prisma.category.findFirst({
                    where: { name: data.categoryName }
                });
                if (!category) {
                    category = await prisma.category.create({
                        data: { name: data.categoryName || 'Uncategorized', department: 'FOOD' }
                    });
                }

                // Simplified lookup or create provider
                let providerId = null;
                if (data.providerName) {
                    let provider = await prisma.provider.findFirst({
                        where: { name: data.providerName }
                    });
                    if (!provider) {
                        provider = await prisma.provider.create({ data: { name: data.providerName } });
                    }
                    providerId = provider.id;
                }

                await prisma.ingredient.create({
                    data: {
                        name: data.name,
                        nameEs: data.nameEs || null,
                        type: data.type || 'RAW',
                        categoryId: category.id,
                        metric: data.metric || 'units',
                        providerId: providerId,
                        portionWeightG: 1000,
                        yieldPercent: data.yieldPercent !== undefined ? data.yieldPercent : 100,
                        inventory: {
                            create: {
                                frozenQty: data.initialQty || 0,
                                thawingQty: 0
                            }
                        }
                    }
                });
                addedCount++;
            } catch (err) {
                console.error('Failed to import specific ingredient row:', data.name, err);
            }
        }
        return { success: true, count: addedCount };
    } catch (error) {
        console.error('Failed bulk import:', error);
        return { success: false, error: 'Failed bulk import' };
    }
}

export async function addCategory(name: string, department: string = 'FOOD', nameEs?: string) {
    try {
        const category = await prisma.category.create({
            data: { name, department, nameEs: nameEs || null }
        });
        return { success: true, category };
    } catch (error) {
        console.error('Failed to create category:', error);
        return { success: false, error: 'Failed to create category' };
    }
}

export async function editCategory(id: string, name: string, nameEs?: string) {
    try {
        const category = await prisma.category.update({
            where: { id },
            data: { name, nameEs: nameEs || null }
        });
        return { success: true, category };
    } catch (error) {
        console.error('Failed to edit category:', error);
        return { success: false, error: 'Failed to edit category' };
    }
}

export async function deleteCategory(id: string) {
    try {
        const count = await prisma.ingredient.count({ where: { categoryId: id } });
        if (count > 0) {
            return { success: false, error: 'Cannot delete a category that contains ingredients.' };
        }
        await prisma.category.delete({
            where: { id }
        });
        return { success: true };
    } catch (error) {
        console.error('Failed to delete category:', error);
        return { success: false, error: 'Failed to delete category' };
    }
}

export async function addProvider(name: string) {
    try {
        const provider = await prisma.provider.create({
            data: { name }
        });
        return { success: true, provider };
    } catch (error) {
        console.error('Failed to create provider:', error);
        return { success: false, error: 'Failed to create provider' };
    }
}

export async function editProvider(id: string, name: string) {
    try {
        const provider = await prisma.provider.update({
            where: { id },
            data: { name }
        });
        return { success: true, provider };
    } catch (error) {
        console.error('Failed to edit provider:', error);
        return { success: false, error: 'Failed to edit provider' };
    }
}

export async function deleteProvider(id: string) {
    try {
        const count = await prisma.ingredient.count({ where: { providerId: id } });
        if (count > 0) {
            return { success: false, error: 'Cannot delete a provider linked to ingredients.' };
        }
        await prisma.provider.delete({
            where: { id }
        });
        return { success: true };
    } catch (error) {
        console.error('Failed to delete provider:', error);
        return { success: false, error: 'Failed to delete provider' };
    }
}

export async function deleteIngredient(id: string) {
    try {
        // First delete dependent inventory record if it exists
        await prisma.inventory.deleteMany({
            where: { ingredientId: id }
        });

        await prisma.ingredient.delete({
            where: { id }
        });

        return { success: true };
    } catch (error) {
        console.error('Failed to delete ingredient:', error);
        return { success: false, error: 'Failed to delete ingredient' };
    }
}

export async function depleteInventoryForMenuItem(menuItemId: string, qtySold: number) {
    try {
        const menuItem = await prisma.menuItem.findUnique({
            where: { id: menuItemId },
            include: {
                recipeIngredients: {
                    include: { ingredient: { include: { inventory: true } } }
                }
            }
        });

        if (!menuItem) return { success: false, error: 'Menu item not found' };

        for (const recipeIng of menuItem.recipeIngredients) {
            const dbIng = recipeIng.ingredient;
            if (!dbIng.inventory) continue;

            const baseUnit = dbIng.metric || 'Units';
            const recipeUnit = recipeIng.unit || 'Units';
            let qtyToDeduct = 0;

            if (baseUnit.toLowerCase() === 'units' || recipeUnit.toLowerCase() === 'units') {
                qtyToDeduct = recipeIng.quantity * qtySold;
            } else {
                const cFactor = getConversionFactor(baseUnit, recipeUnit);
                if (cFactor) {
                    qtyToDeduct = (recipeIng.quantity / cFactor) * qtySold;
                } else {
                    console.error(`Cannot convert recipe unit ${recipeUnit} to inventory unit ${baseUnit}`);
                    continue; // Skip or handle error
                }
            }

            await prisma.inventory.update({
                where: { ingredientId: dbIng.id },
                data: {
                    frozenQty: { decrement: qtyToDeduct }
                }
            });

            await prisma.inventoryTransaction.create({
                data: {
                    ingredientId: dbIng.id,
                    type: 'SALES_DEDUCT',
                    qty: qtyToDeduct,
                    note: `Sold ${qtySold} x ${menuItem.name}`
                }
            });
        }
        return { success: true };
    } catch (error) {
        console.error('Failed to deplete inventory:', error);
        return { success: false, error: 'Failed to deplete inventory' };
    }
}

export async function logWaste(ingredientId: string, qty: number, note?: string) {
    try {
        await prisma.inventory.update({
            where: { ingredientId },
            data: { frozenQty: { decrement: qty } }
        });

        await prisma.inventoryTransaction.create({
            data: {
                ingredientId,
                type: 'WASTE',
                qty,
                note: note || 'Waste correction'
            }
        });
        return { success: true };
    } catch (e) {
        console.error("Failed to log waste:", e);
        return { success: false, error: "Database error logging waste" };
    }
}

export async function logInventoryAdjustment(ingredientId: string, qtyChange: number, userId: string) {
    try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const userName = user?.name || 'Unknown User';

        await prisma.inventory.update({
            where: { ingredientId },
            data: { frozenQty: { increment: qtyChange } }
        });

        await prisma.inventoryTransaction.create({
            data: {
                ingredientId,
                type: qtyChange > 0 ? 'MANUAL_ADD' : 'MANUAL_DEDUCT',
                qty: Math.abs(qtyChange),
                note: `Manual adjustment by ${userName}`
            }
        });
        return { success: true };
    } catch (e) {
        console.error("Failed to log inventory adjustment:", e);
        return { success: false, error: 'Database error logging adjustment' };
    }
}

export async function adjustUnfrozenQuantity(id: string, delta: number) {
    try {
        const inventory = await prisma.inventory.findUnique({
            where: { ingredientId: id }
        });

        if (!inventory) {
            return { success: false, error: 'Inventory not found' };
        }

        const newUnfrozen = Math.max(0, inventory.thawingQty + delta);

        await prisma.inventory.update({
            where: { ingredientId: id },
            data: { thawingQty: newUnfrozen }
        });

        return { success: true, updatedValue: newUnfrozen };
    } catch (e) {
        console.error('Failed to adjust unfrozen quantity:', e);
        return { success: false, error: 'Failed to adjust unfrozen quantity' };
    }
}
