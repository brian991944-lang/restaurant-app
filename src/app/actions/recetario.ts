'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export async function getDigitalRecipes() {
    try {
        return await prisma.digitalRecipe.findMany({
            orderBy: { recipeCode: 'asc' },
            include: { linkedTasks: true, category: true }
        });
    } catch (e) {
        console.error(e);
        return [];
    }
}

export async function getAvailablePrepRecipes() {
    try {
        return await prisma.ingredient.findMany({
            where: { type: 'PREP_RECIPE' },
            select: {
                id: true,
                name: true,
                digitalRecipeId: true,
                portionWeightG: true,
                metric: true,
                composedOf: {
                    select: {
                        quantity: true,
                        unit: true,
                        groupName: true,
                        ingredient: {
                            select: {
                                name: true,
                                nameEs: true
                            }
                        }
                    }
                }
            }
        });
    } catch (e) {
        console.error(e);
        return [];
    }
}

export async function getRecipeHistory(recipeId: string) {
    try {
        return await prisma.digitalRecipeHistory.findMany({
            where: { recipeId },
            orderBy: { savedAt: 'desc' }
        });
    } catch (e) {
        console.error(e);
        return [];
    }
}

export async function createDigitalRecipe(data: any) {
    try {
        if (data.recipeCode) {
            if (data.type === 'EMPLATADO' && !data.recipeCode.startsWith('E-'))
                return { success: false, error: 'Los c\u00f3digos de emplatado deben empezar con E-' };
            if (data.type !== 'EMPLATADO' && data.recipeCode.startsWith('E-'))
                return { success: false, error: 'Solo los emplatados deben empezar con E-' };
            const collision = await prisma.digitalRecipe.findFirst({ where: { recipeCode: data.recipeCode } });
            if (collision) return { success: false, error: `El c\u00f3digo '${data.recipeCode}' ya est\u00e1 en uso por otra receta` };
        }

        let nextCode: string = data.recipeCode || '';
        if (!nextCode) {
            let catPrefix = 'LBX';
            if (data.categoryId) {
                const cat = await prisma.category.findUnique({ where: { id: data.categoryId } });
                if (cat) {
                    const nameToUse = cat.nameEs || cat.name || '';
                    catPrefix = nameToUse.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z]/g, '').substring(0, 3).toUpperCase().padEnd(3, 'X');
                }
            }
            const prefix = data.type === 'EMPLATADO' ? `E-${catPrefix}` : catPrefix;
            const all = await prisma.digitalRecipe.findMany({
                where: { recipeCode: { startsWith: `${prefix}-` } }
            });
            let max = 0;
            all.forEach(r => {
                const parts = r.recipeCode.split('-');
                const num = parseInt(parts[parts.length - 1]);
                if (!isNaN(num) && num > max) max = num;
            });
            nextCode = `${prefix}-${String(max + 1).padStart(3, '0')}`;
        }

        const newRec = await prisma.digitalRecipe.create({
            data: {
                recipeCode: nextCode,
                type: data.type,
                name: data.name,
                yield: data.yield,
                overview: data.overview,
                ingredientsJson: data.ingredientsJson,
                procedureJson: data.procedureJson,
                platingTracksJson: data.platingTracksJson,
                mediaJson: data.mediaJson,
                chefNotes: data.chefNotes,
                categoryId: data.categoryId || null,
                revisionDate: new Date()
            }
        });

        await prisma.digitalRecipeHistory.create({
            data: {
                recipeId: newRec.id,
                type: newRec.type,
                recipeCode: newRec.recipeCode,
                name: newRec.name,
                yield: newRec.yield,
                overview: newRec.overview,
                ingredientsJson: newRec.ingredientsJson,
                procedureJson: newRec.procedureJson,
                platingTracksJson: newRec.platingTracksJson,
                mediaJson: newRec.mediaJson,
                chefNotes: newRec.chefNotes,
                revisionDate: newRec.revisionDate,
                savedBy: 'Initial Creation'
            }
        });

        if (data.linkedIngredientId) {
            await prisma.ingredient.update({
                where: { id: data.linkedIngredientId },
                data: { digitalRecipeId: newRec.id }
            });
        }

        revalidatePath('/[locale]/recetario');
        return { success: true, recipe: newRec };
    } catch (e) {
        console.error(e);
        return { success: false, error: 'Failed to create' };
    }
}

export async function updateDigitalRecipe(id: string, data: any) {
    try {
        const oldRec = await prisma.digitalRecipe.findUnique({ where: { id } });
        if (!oldRec) return { success: false, error: 'Not found' };

        if (data.recipeCode && data.recipeCode !== oldRec.recipeCode) {
            if (data.type === 'EMPLATADO' && !data.recipeCode.startsWith('E-'))
                return { success: false, error: 'Los códigos de emplatado deben empezar con E-' };
            if (data.type !== 'EMPLATADO' && data.recipeCode.startsWith('E-'))
                return { success: false, error: 'Solo los emplatados deben empezar con E-' };
            const collision = await prisma.digitalRecipe.findFirst({ where: { recipeCode: data.recipeCode, id: { not: id } } });
            if (collision) return { success: false, error: `El código '${data.recipeCode}' ya está en uso por otra receta` };
        }

        await prisma.digitalRecipeHistory.create({
            data: {
                recipeId: oldRec.id,
                type: oldRec.type,
                recipeCode: oldRec.recipeCode,
                name: oldRec.name,
                yield: oldRec.yield,
                overview: oldRec.overview,
                ingredientsJson: oldRec.ingredientsJson,
                procedureJson: oldRec.procedureJson,
                platingTracksJson: oldRec.platingTracksJson,
                mediaJson: oldRec.mediaJson,
                chefNotes: oldRec.chefNotes,
                revisionDate: oldRec.revisionDate,
                savedBy: 'Admin Edit'
            }
        });

        const updated = await prisma.digitalRecipe.update({
            where: { id },
            data: {
                recipeCode: data.recipeCode || oldRec.recipeCode,
                name: data.name,
                type: data.type,
                yield: data.yield,
                overview: data.overview,
                ingredientsJson: data.ingredientsJson,
                procedureJson: data.procedureJson,
                platingTracksJson: data.platingTracksJson,
                mediaJson: data.mediaJson,
                chefNotes: data.chefNotes,
                categoryId: data.categoryId || null,
                revisionDate: new Date()
            }
        });

        const currentLinked = await prisma.ingredient.findFirst({
            where: { digitalRecipeId: id, type: 'PREP_RECIPE' }
        });

        const incomingId = data.linkedIngredientId || undefined;
        const currentId = currentLinked?.id;

        if (currentId !== incomingId) {
            if (currentLinked) {
                await prisma.ingredient.update({
                    where: { id: currentLinked.id },
                    data: { digitalRecipeId: null }
                });
            }
            if (incomingId) {
                await prisma.ingredient.update({
                    where: { id: incomingId },
                    data: { digitalRecipeId: id }
                });
            }
        }

        revalidatePath('/[locale]/recetario');
        return { success: true, recipe: updated };
    } catch (e) {
        console.error(e);
        return { success: false, error: 'Failed to update' };
    }
}

export async function isRecipeCodeAvailable(code: string, excludeId?: string) {
    try {
        const existing = await prisma.digitalRecipe.findFirst({
            where: { recipeCode: code, ...(excludeId ? { id: { not: excludeId } } : {}) },
            select: { id: true }
        });
        return { available: !existing };
    } catch (e) {
        console.error(e);
        return { available: false };
    }
}

export async function suggestNextRecipeCode(type: string, categoryId: string) {
    try {
        const cat = await prisma.category.findUnique({ where: { id: categoryId } });
        if (!cat) return { success: false as const, error: 'Category not found' };

        const nameToUse = cat.nameEs || cat.name || '';
        const catPrefix = nameToUse
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .replace(/[^A-Za-z]/g, '')
            .substring(0, 3)
            .toUpperCase()
            .padEnd(3, 'X');

        const codePrefix = type === 'EMPLATADO' ? `E-${catPrefix}-` : `${catPrefix}-`;

        const existing = await prisma.digitalRecipe.findMany({
            where: { recipeCode: { startsWith: codePrefix } },
            select: { recipeCode: true }
        });

        let max = 0;
        for (const r of existing) {
            const parts = r.recipeCode.split('-');
            const num = parseInt(parts[parts.length - 1]);
            if (!isNaN(num) && num > max) max = num;
        }

        const suggestedCode = `${codePrefix}${String(max + 1).padStart(3, '0')}`;
        return { success: true as const, suggestedCode };
    } catch (e) {
        console.error(e);
        return { success: false as const, error: 'Failed to suggest code' };
    }
}

export async function deleteDigitalRecipe(id: string) {
    try {
        await prisma.digitalRecipe.delete({ where: { id } });
        revalidatePath('/[locale]/recetario');
        return { success: true };
    } catch (e) {
        console.error(e);
        return { success: false };
    }
}
