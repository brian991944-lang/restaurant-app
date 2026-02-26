'use server';

import prisma from '@/lib/prisma';

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
}

/**
 * Gets the prep tasks for a specific date, merging explicit assignments 
 * with the recurring rules.
 */
export async function getDailyPrepTasks(targetDate: Date): Promise<PrepTask[]> {
    try {
        // 1. Get explicit assignments (e.g. from the night shift schedule) for this day
        // Strip time to just get the date start/end
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

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
                        }
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
        const dayOfWeek = targetDate.getDay();
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
                isUrgent
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

        // 1. Update or create the PrepAssignment if one existed
        let finalAssignmentId = assignmentId;
        if (assignmentId) {
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
            const startOfDay = new Date(today);
            startOfDay.setHours(0, 0, 0, 0);

            let schedule = await prisma.schedule.findFirst({
                where: {
                    date: { gte: startOfDay, lte: new Date(new Date(today).setHours(23, 59, 59, 999)) }
                }
            });

            if (!schedule) {
                schedule = await prisma.schedule.create({
                    data: {
                        date: today,
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

        // 2. We need to create an Inventory transaction.
        // Concept: Prepping means deducting from Frozen and adding to Thawing/Ready
        // The user's specification: "the actual amount is the one that moves the inventory count."

        // Ensure inventory record exists
        let inventory = await prisma.inventory.findUnique({
            where: { ingredientId }
        });

        if (!inventory) {
            inventory = await prisma.inventory.create({
                data: {
                    ingredientId,
                    frozenQty: 0,
                    thawingQty: 0
                }
            });
        }

        // 3. Move the qty from Frozen -> Thawing (or just increment thawing representing it is now prepped)
        await prisma.inventory.update({
            where: { id: inventory.id },
            data: {
                frozenQty: Math.max(0, inventory.frozenQty - actualAmount),
                thawingQty: inventory.thawingQty + actualAmount
            }
        });

        // 4. Log the transaction historical record
        await prisma.inventoryTransaction.create({
            data: {
                ingredientId,
                type: 'PULL_PREP',
                qty: actualAmount,
                note: note || `Morning Prep task completed by cook ${userId}`
            }
        });

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
            await prisma.prepAssignment.update({
                where: { id: assignmentId },
                data: {
                    portionsActual: null,
                    completed: false,
                    completedAt: null
                }
            });
        }

        let inventory = await prisma.inventory.findUnique({
            where: { ingredientId }
        });

        if (inventory) {
            await prisma.inventory.update({
                where: { id: inventory.id },
                data: {
                    frozenQty: inventory.frozenQty + actualAmount,
                    thawingQty: Math.max(0, inventory.thawingQty - actualAmount)
                }
            });
        }

        await prisma.inventoryTransaction.create({
            data: {
                ingredientId,
                type: 'UNDO_PREP',
                qty: -actualAmount,
                note: 'Morning Prep task undone via UI'
            }
        });
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
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);

        let schedule = await prisma.schedule.findFirst({
            where: {
                date: { gte: startOfDay, lte: new Date(new Date(targetDate).setHours(23, 59, 59, 999)) }
            }
        });

        if (!schedule) {
            schedule = await prisma.schedule.create({
                data: {
                    date: targetDate,
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
