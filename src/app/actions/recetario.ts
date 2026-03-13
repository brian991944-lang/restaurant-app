'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export async function getDigitalRecipes() {
    try {
        return await prisma.digitalRecipe.findMany({
            orderBy: { recipeCode: 'asc' },
            include: { linkedTasks: true }
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
        const all = await prisma.digitalRecipe.findMany();
        let max = 0;
        all.forEach(r => {
            if (r.recipeCode.startsWith('LB-')) {
                const num = parseInt(r.recipeCode.split('-')[1]);
                if (!isNaN(num) && num > max) max = num;
            }
        });
        const nextCode = `LB-${String(max + 1).padStart(3, '0')}`;

        const newRec = await prisma.digitalRecipe.create({
            data: {
                recipeCode: nextCode,
                type: data.type,
                name: data.name,
                yield: data.yield,
                overview: data.overview,
                ingredientsJson: data.ingredientsJson,
                procedureJson: data.procedureJson,
                chefNotes: data.chefNotes,
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
                chefNotes: newRec.chefNotes,
                revisionDate: newRec.revisionDate,
                savedBy: 'Initial Creation'
            }
        });

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
                chefNotes: oldRec.chefNotes,
                revisionDate: oldRec.revisionDate,
                savedBy: 'Admin Edit'
            }
        });

        const updated = await prisma.digitalRecipe.update({
            where: { id },
            data: {
                name: data.name,
                type: data.type,
                yield: data.yield,
                overview: data.overview,
                ingredientsJson: data.ingredientsJson,
                procedureJson: data.procedureJson,
                chefNotes: data.chefNotes,
                revisionDate: new Date()
            }
        });

        revalidatePath('/[locale]/recetario');
        return { success: true, recipe: updated };
    } catch (e) {
        console.error(e);
        return { success: false, error: 'Failed to update' };
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
