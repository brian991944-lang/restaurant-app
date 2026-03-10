'use server';

import prisma from '@/lib/prisma';
import { unstable_noStore as noStore } from 'next/cache';

export interface PrepTask {
    ingredientId: string;
    ingredientName: string;
    parentName: string | null;
    metric: string;
    category: string;
    assignedAmount: number; // Put by night shift
    recurringAmount: number; // Fixed day of week rule
    actualAmount: number | null;
    completed: boolean;
    assignmentId?: string; // If it was explicitly assigned
    hasNightShift: boolean;
    hasRecurring: boolean;
    isUrgent: boolean;
    completedBy?: string;
}

/**
 * Gets the prep tasks for a specific date, merging explicit assignments 
 * with the recurring rules.
 */
export async function getDailyPrepTasks(targetDate: Date): Promise<PrepTask[]> {
    try {
        const estFormatted = targetDate.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        const startOfDay = new Date(`${estFormatted}T00:00:00-05:00`);
        const endOfDay = new Date(`${estFormatted}T23:59:59.999-05:00`);

        // Fetch Schedule + prepAssignments
        const schedules = await prisma.schedule.findMany({
            where: {
                date: { gte: startOfDay, lte: endOfDay }
            },
            include: {
                prepAssignments: {
                    include: {
                        ingredient: {
                            include: { category: true }
                        },
                        user: true
                    }
                }
            }
        });

        const assignedTasksMap = new Map<string, any>();

        for (const sched of schedules) {
            for (const assignment of sched.prepAssignments) {
                assignedTasksMap.set(assignment.ingredientId, assignment);
            }
        }

        // 2. Fetch recurring rules for TODAY'S day of week (0=Sun, 1=Mon, etc)
        const targetEstDate = new Date(`${estFormatted}T12:00:00-05:00`);
        const dayOfWeek = targetEstDate.getDay();
        const recurringRules = await prisma.recurringPrepRule.findMany({
            where: { dayOfWeek }
        });

        const recurringMap = new Map<string, number>();
        for (const rule of recurringRules) {
            recurringMap.set(rule.ingredientId, rule.amount);
        }

        // 3. Fetch all ingredients
        const rawIngredients = await prisma.ingredient.findMany({
            where: { type: { in: ['RAW', 'PREP', 'PROCESSED'] } },
            include: { category: true, parent: true }
        });

        const mergedTasks: PrepTask[] = [];

        for (let i = 0; i < rawIngredients.length; i++) {
            const ingredient = rawIngredients[i];
            const assignment = assignedTasksMap.get(ingredient.id);
            const recurringAmount = recurringMap.get(ingredient.id) || 0;
            const hasNightShift = !!assignment;
            const hasRecurring = recurringAmount > 0;

            const isUrgent = assignment ? assignment.isUrgent : false;

            // If no data points to prepping this ingredient today, skip
            if (!hasNightShift && !hasRecurring) continue;

            mergedTasks.push({
                ingredientId: ingredient.id,
                ingredientName: ingredient.name,
                parentName: ingredient.parent?.name || null,
                metric: ingredient.metric || 'units',
                category: ingredient.category.name,
                assignedAmount: assignment ? assignment.portionsAssigned : 0,
                recurringAmount: recurringAmount,
                actualAmount: assignment ? assignment.portionsActual : null,
                completed: assignment ? assignment.completed : false,
                assignmentId: assignment?.id,
                hasNightShift,
                hasRecurring,
                isUrgent,
                completedBy: assignment?.user?.name || undefined
            });
        }

        return mergedTasks;
    } catch (error) {
        console.error('Failed to get daily prep tasks:', error);
        return [];
    }
}

/**
 * Saves a completed prep task, logging the actual amount & creating a transaction
 */
export async function completePrepTask(
    ingredientId: string,
    actualAmount: number,
    userId: string,
    assignmentId?: string,
    note?: string
) {
    try {
        const today = new Date();

        const estFormatted = today.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

        let finalAssignmentId = assignmentId;
        if (assignmentId) {
            const assignment = await prisma.prepAssignment.findUnique({ where: { id: assignmentId } });
            if (assignment?.completed) return { success: true }; // Prevent Duplicate Processing

            await prisma.prepAssignment.update({
                where: { id: assignmentId },
                data: {
                    portionsActual: actualAmount,
                    completed: true,
                    completedAt: today,
                    userId
                }
            });
        } else {
            // Find or create schedule for today
            const startOfDay = new Date(`${estFormatted}T00:00:00-05:00`);
            const endOfDay = new Date(`${estFormatted}T23:59:59.999-05:00`);

            let schedule = await prisma.schedule.findFirst({
                where: {
                    date: { gte: startOfDay, lte: endOfDay }
                }
            });

            if (!schedule) {
                schedule = await prisma.schedule.create({
                    data: {
                        date: new Date(`${estFormatted}T12:00:00-05:00`),
                        createdBy: 'System (Auto-Complete)',
                        assignedTo: 'MorningCrew'
                    }
                });
            }

            const newAssignment = await prisma.prepAssignment.create({
                data: {
                    scheduleId: schedule.id,
                    userId,
                    ingredientId,
                    portionsAssigned: 0,
                    portionsActual: actualAmount,
                    completed: true,
                    completedAt: today
                }
            });
            finalAssignmentId = newAssignment.id;
        }

        // 2. Handle Base Ingredient Linking (Enlace a Ingrediente Base)
        const taskIngredient = await prisma.ingredient.findUnique({
            where: { id: ingredientId },
            include: { category: true } // Need category to check for 'Descongelar'
        });

        if (taskIngredient && taskIngredient.parentId) {
            const taskName = (taskIngredient.name || '').toLowerCase();
            const baseIngredientId = taskIngredient.parentId;

            let inventory = await prisma.inventory.findUnique({
                where: { ingredientId: baseIngredientId }
            });

            if (!inventory) {
                inventory = await prisma.inventory.create({
                    data: { ingredientId: baseIngredientId, frozenQty: 0, thawingQty: 0 }
                });
            }

            let frozenInc = actualAmount;
            let thawingInc = 0;

            const isDescongelar = taskName.includes('descongelar') ||
                (taskIngredient.category && taskIngredient.category.name.toLowerCase().includes('descongelar'));

            if (isDescongelar) {
                // "Descongelar" -> does NOT increment total stock (frozenQty). It only increments thawingQty/unfrozenQuantity.
                frozenInc = 0;
                thawingInc = actualAmount;
            } else if (taskName.includes('congelar')) {
                // "Congelar" -> only increments FrozenQty (Total)
                thawingInc = 0;
            }

            // Invert the increment logic if 'subtractFromInventory' is true
            if ((taskIngredient as any).subtractFromInventory) {
                frozenInc = -frozenInc;
                thawingInc = -thawingInc;
            }

            const newFrozenQty = Math.max(0, inventory.frozenQty + frozenInc);
            // Cap the thawingQty (unfrozen stock) so it never exceeds the total available stock
            const cappedThawingQty = Math.min(newFrozenQty, Math.max(0, inventory.thawingQty + thawingInc));

            await prisma.inventory.update({
                where: { id: inventory.id },
                data: {
                    frozenQty: newFrozenQty,
                    thawingQty: cappedThawingQty
                }
            });

            // Also update the ingredient's unfrozenQuantity field for complete sync
            await prisma.ingredient.update({
                where: { id: baseIngredientId },
                data: {
                    unfrozenQuantity: cappedThawingQty
                }
            });

            await prisma.inventoryTransaction.create({
                data: {
                    ingredientId: baseIngredientId,
                    type: 'PREP_COMPLETE',
                    qty: actualAmount,
                    note: note || `Prep task completed: ${taskIngredient.name}`
                }
            });
        }

        return { success: true };
    } catch (error) {
        console.error('Failed to complete prep task:', error);
        return { success: false, error: 'Database error' };
    }
}

/**
 * Undoes a completed prep task, revering the inventory move
 */
export async function undoPrepTask(
    ingredientId: string,
    actualAmount: number,
    assignmentId?: string
) {
    try {
        if (assignmentId) {
            const assignment = await prisma.prepAssignment.findUnique({ where: { id: assignmentId } });
            if (!assignment || !assignment.completed) return { success: true }; // Already undone

            await prisma.prepAssignment.update({
                where: { id: assignmentId },
                data: {
                    portionsActual: null,
                    completed: false,
                    completedAt: null
                }
            });
        }

        const taskIngredient = await prisma.ingredient.findUnique({
            where: { id: ingredientId },
            include: { category: true }
        });

        if (taskIngredient && taskIngredient.parentId) {
            const taskName = (taskIngredient.name || '').toLowerCase();
            const baseIngredientId = taskIngredient.parentId;

            let inventory = await prisma.inventory.findUnique({ where: { ingredientId: baseIngredientId } });

            if (inventory) {
                let frozenDec = actualAmount;
                let thawingDec = 0;

                const isDescongelar = taskName.includes('descongelar') ||
                    (taskIngredient.category && taskIngredient.category.name.toLowerCase().includes('descongelar'));

                if (isDescongelar) {
                    // Do not decrement total stock when undoing a 'Descongelar' task
                    frozenDec = 0;
                    thawingDec = actualAmount;
                }

                // Invert the decrement logic if 'subtractFromInventory' is true
                if ((taskIngredient as any).subtractFromInventory) {
                    frozenDec = -frozenDec;
                    thawingDec = -thawingDec;
                }

                const newFrozenQty = Math.max(0, inventory.frozenQty - frozenDec);
                const newThawingQty = Math.min(newFrozenQty, Math.max(0, inventory.thawingQty - thawingDec));

                await prisma.inventory.update({
                    where: { id: inventory.id },
                    data: {
                        frozenQty: newFrozenQty,
                        thawingQty: newThawingQty
                    }
                });

                await prisma.ingredient.update({
                    where: { id: baseIngredientId },
                    data: {
                        unfrozenQuantity: newThawingQty
                    }
                });

                await prisma.inventoryTransaction.create({
                    data: {
                        ingredientId: baseIngredientId,
                        type: 'UNDO_PREP',
                        qty: -actualAmount,
                        note: `Prep task undone: ${taskIngredient.name}`
                    }
                });
            }
        }
        return { success: true };
    } catch (error) {
        console.error('Failed to undo prep task:', error);
        return { success: false, error: 'Failed to undo prep task' };
    }
}

/**
 * Creates a manual prep task for a specific date (usually today).
 */
export async function createManualPrepAssignment(
    ingredientId: string,
    targetDate: Date,
    isUrgent: boolean,
    amount: number
) {
    try {
        const estFormatted = targetDate.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        const startOfDay = new Date(`${estFormatted}T00:00:00-05:00`);
        const endOfDay = new Date(`${estFormatted}T23:59:59.999-05:00`);

        let schedule = await prisma.schedule.findFirst({
            where: {
                date: { gte: startOfDay, lte: endOfDay }
            }
        });

        if (!schedule) {
            schedule = await prisma.schedule.create({
                data: {
                    date: new Date(`${estFormatted}T12:00:00-05:00`),
                    createdBy: 'System (Manual Add)',
                    assignedTo: 'MorningCrew'
                }
            });
        }

        let defaultUser = await prisma.user.findFirst({ where: { role: 'KITCHEN' } });
        if (!defaultUser) defaultUser = await prisma.user.findFirst();

        if (!defaultUser) {
            throw new Error("No users exist in the database to assign manual tasks");
        }

        await prisma.prepAssignment.create({
            data: {
                scheduleId: schedule.id,
                userId: defaultUser.id, // Fixed invalid foreign key reference
                ingredientId,
                portionsAssigned: amount || 0,
                isUrgent
            }
        });

        return { success: true };
    } catch (error) {
        console.error('Failed to create manual prep task:', error);
        return { success: false };
    }
}

/**
 * Gets a history of completed prep tasks (for a specific date range or all time limit 50).
 */
export async function getCompletedPrepLogs() {
    try {
        const completedAssignments = await prisma.prepAssignment.findMany({
            where: {
                completed: true,
                completedAt: { not: null }
            },
            include: {
                ingredient: {
                    include: { category: true }
                },
                user: true
            },
            orderBy: {
                completedAt: 'desc'
            },
            take: 50
        });

        return completedAssignments.map(a => ({
            id: a.id,
            ingredientName: a.ingredient.name,
            category: a.ingredient.category.name,
            actualAmount: a.portionsActual,
            assignedAmount: a.portionsAssigned,
            completedAt: a.completedAt,
            completedBy: a.user?.name || 'Unknown User'
        }));
    } catch (error) {
        console.error('Failed to fetch prep logs:', error);
        return [];
    }
}

export async function deletePrepAssignment(assignmentId: string) {
    try {
        await prisma.prepAssignment.delete({
            where: { id: assignmentId }
        });
        return { success: true };
    } catch (error) {
        console.error('Failed to delete prep assignment:', error);
        return { success: false, error: 'Database error' };
    }
}

/**
 * Gets the ingredient data for static defrosting presets by exact name match.
 */
export async function getDefrostingPresets(names: string[]) {
    noStore();
    try {
        const ingredients = await prisma.ingredient.findMany({
            where: {
                name: { in: names }
            },
            include: { category: true }
        });

        // Return a map of name to id along with any needed metadata
        return ingredients.map(ing => ({
            id: ing.id,
            name: ing.name,
            metric: ing.metric,
            category: ing.category?.name
        }));
    } catch (error) {
        console.error('Failed to fetch defrosting presets:', error);
        return [];
    }
}
