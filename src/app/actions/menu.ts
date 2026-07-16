'use server';

import prisma from '@/lib/prisma';
import { fetchCloverItemDetails, updateCloverItemDescription } from './clover';

/**
 * For Clover-linked items, Clover is the source of truth: mirror its live
 * name/price/category over whatever was submitted. Falls back to submitted
 * values if Clover is unreachable. Description flows the other way (app -> Clover).
 */
async function resolveCloverFields(data: any): Promise<{ name: string; category: string | null; salePrice: number }> {
    const submitted = {
        name: data.name,
        category: data.category ?? null,
        salePrice: data.salePrice || 0
    };
    if (!data.cloverId) return submitted;
    const details = await fetchCloverItemDetails(data.cloverId);
    if (!details) return submitted;
    return {
        name: details.name || submitted.name,
        category: details.category ?? submitted.category,
        salePrice: details.price
    };
}

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

export async function getMenuCategories() {
    const rows = await prisma.menuItem.findMany({
        select: { category: true },
        distinct: ['category'],
        where: { category: { not: null } },
        orderBy: { category: 'asc' }
    });
    return rows.map(r => r.category).filter((c): c is string => !!c);
}

export async function addMenuItem(data: any) {
    try {
        const cloverFields = await resolveCloverFields(data);
        const menuItem = await prisma.menuItem.create({
            data: {
                name: cloverFields.name,
                category: cloverFields.category,
                salePrice: cloverFields.salePrice,
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
                                unit: ing.unit || 'units'
                            }))
                        }
                    }))
                }
            }
        });
        // Description is managed from the app -> pushed to Clover. Never blocks the save.
        if (menuItem.cloverId && typeof data.cloverDescription === 'string') {
            await updateCloverItemDescription(menuItem.cloverId, data.cloverDescription);
        }
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
        const cloverFields = await resolveCloverFields(data);
        const menuItem = await prisma.menuItem.update({
            where: { id },
            data: {
                name: cloverFields.name,
                category: cloverFields.category,
                salePrice: cloverFields.salePrice,
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
                                unit: ing.unit || 'units'
                            }))
                        }
                    }))
                }
            }
        });
        // Description is managed from the app -> pushed to Clover. Never blocks the save.
        if (menuItem.cloverId && typeof data.cloverDescription === 'string') {
            await updateCloverItemDescription(menuItem.cloverId, data.cloverDescription);
        }
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
