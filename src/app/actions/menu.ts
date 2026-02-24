'use server';

import prisma from '@/lib/prisma';

export async function getMenuItems() {
    return prisma.menuItem.findMany({
        include: {
            modifiers: { include: { ingredients: true } },
            recipeIngredients: {
                include: {
                    ingredient: {
                        include: {
                            parent: true,
                            composedOf: { include: { ingredient: true } }
                        }
                    }
                }
            }
        }
    });
}

export async function addMenuItem(data: any) {
    try {
        const menuItem = await prisma.menuItem.create({
            data: {
                name: data.name,
                category: data.category,
                salePrice: data.salePrice || 0,
                targetFoodCostPct: data.targetFoodCostPct || 25.0,
                cloverId: data.cloverId || null,
                hasInventoryModifiers: data.hasInventoryModifiers || false,
                recipeIngredients: {
                    create: data.ingredients.map((ing: any) => ({
                        ingredientId: ing.ingredientId,
                        quantity: ing.quantity,
                        unit: ing.unit || 'units'
                    }))
                },
                modifiers: {
                    create: (data.modifiers || []).map((mod: any) => ({
                        name: mod.name,
                        cloverModifierId: mod.cloverModifierId,
                        ingredients: {
                            create: mod.ingredients.map((ing: any) => ({
                                ingredientId: ing.ingredientId,
                                quantity: ing.quantity,
                                unit: 'units' // keeping unit simple for mods or mapped correctly
                            }))
                        }
                    }))
                }
            }
        });
        return { success: true, menuItem };
    } catch (e) {
        console.error('Failed to add menu item:', e);
        return { success: false, error: 'Database Error' };
    }
}

export async function editMenuItem(id: string, data: any) {
    try {
        // Delete old ingredients and modifiers
        await prisma.recipeIngredient.deleteMany({ where: { menuItemId: id } });
        await prisma.menuItemModifier.deleteMany({ where: { menuItemId: id } });

        // Update item and create new ingredients
        const menuItem = await prisma.menuItem.update({
            where: { id },
            data: {
                name: data.name,
                category: data.category,
                salePrice: data.salePrice || 0,
                targetFoodCostPct: data.targetFoodCostPct || 25.0,
                cloverId: data.cloverId || null,
                hasInventoryModifiers: data.hasInventoryModifiers || false,
                recipeIngredients: {
                    create: data.ingredients.map((ing: any) => ({
                        ingredientId: ing.ingredientId,
                        quantity: ing.quantity,
                        unit: ing.unit || 'units'
                    }))
                },
                modifiers: {
                    create: (data.modifiers || []).map((mod: any) => ({
                        name: mod.name,
                        cloverModifierId: mod.cloverModifierId,
                        ingredients: {
                            create: mod.ingredients.map((ing: any) => ({
                                ingredientId: ing.ingredientId,
                                quantity: ing.quantity,
                                unit: 'units'
                            }))
                        }
                    }))
                }
            }
        });
        return { success: true, menuItem };
    } catch (e) {
        console.error('Failed to edit menu item:', e);
        return { success: false, error: 'Database Error' };
    }
}

export async function deleteMenuItem(id: string) {
    try {
        await prisma.recipeIngredient.deleteMany({ where: { menuItemId: id } });
        await prisma.menuItem.delete({ where: { id } });
        return { success: true };
    } catch (e) {
        return { success: false, error: 'Database Error' };
    }
}
