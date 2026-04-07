'use server';

import prisma from '@/lib/prisma';
import { unstable_noStore as noStore } from 'next/cache';
import { revalidatePath } from 'next/cache';

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
    digitalRecipeId?: string | null;
    digitalRecipeName?: string | null;
    suggestedBaseIngredientName?: string | null;
    suggestedBaseAmount?: number | null;
    isEmergency?: boolean;
    airTightSuggestedAmount?: number;
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
            where: { dayOfWeek },
            include: { baseIngredient: true }
        });

        const recurringMap = new Map<string, any>();
        for (const rule of recurringRules) {
            recurringMap.set(rule.ingredientId, rule);
        }

        // 3. Fetch all ingredients
        const rawIngredients = await prisma.ingredient.findMany({
            where: { type: { in: ['RAW', 'PREP', 'PROCESSED', 'TASK'] } },
            include: { category: true, parent: true, digitalRecipe: true, inventory: true, prepRules: true }
        });

        // 4. Calculate Average Daily Demand from last 14 days of inventory deductions
        const fourteenDaysAgo = new Date(targetDate);
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
        const transactions = await prisma.inventoryTransaction.findMany({
            where: {
                createdAt: { gte: fourteenDaysAgo },
                type: { in: ['SALES_DEDUCT', 'PULL_PREP', 'PREP_COMPLETE'] }
            }
        });
        const demandMap = new Map<string, number>();
        for (const tx of transactions) {
            // we only care about negative shifts roughly mapping consumption
            if (tx.qty < 0 || tx.type === 'SALES_DEDUCT' || tx.type === 'PULL_PREP') {
                const current = demandMap.get(tx.ingredientId) || 0;
                demandMap.set(tx.ingredientId, current + Math.abs(tx.qty));
            }
        }

        const mergedTasks: PrepTask[] = [];

        for (let i = 0; i < rawIngredients.length; i++) {
            const ingredient = rawIngredients[i];
            const assignment = assignedTasksMap.get(ingredient.id);
            const rule = recurringMap.get(ingredient.id);
            const recurringAmount = rule?.amount || 0;
            const hasNightShift = !!assignment;
            const hasRecurring = recurringAmount > 0;

            const isUrgent = assignment ? assignment.isUrgent : false;

            let isEmergency = false;
            let airTightSuggestedAmount = 0;
            const currentStock = ((ingredient as any).inventory?.frozenQty || 0) + ((ingredient as any).inventory?.thawingQty || 0);
            const avgDemand = (demandMap.get(ingredient.id) || 0) / 14;
            let hasAirTightRuleToday = false;

            const rules: any[] = (ingredient as any).prepRules || [];

            // Plan A (Regular / Manual)
            for (const rule of rules) {
                if (rule.ruleType === 'REGULAR' && (rule.activeDays && rule.activeDays.includes(dayOfWeek))) {
                    
                    let shouldTrigger = true;
                    if (rule.triggerThreshold !== null && rule.triggerThreshold !== undefined) {
                        if (currentStock > rule.triggerThreshold) {
                            shouldTrigger = false;
                        }
                    }

                    if (shouldTrigger) {
                        hasAirTightRuleToday = true;
                        if (rule.calculationMode === 'MANUAL') {
                            airTightSuggestedAmount = Math.max(airTightSuggestedAmount, rule.fixedAmount || 0);
                        } else {
                            const totalDaysCovered = rule.coverageDays.length > 0 ? rule.coverageDays.length : 1;
                            const needed = (avgDemand * totalDaysCovered * 1.2) - currentStock;
                            airTightSuggestedAmount = Math.max(airTightSuggestedAmount, Math.round(Math.max(0, needed)));
                        }
                    }
                }
            }

            // Plan B (Emergency) - Check if stock < (Avg Daily * Threshold)
            if (!hasAirTightRuleToday) {
                const emergRule = rules.find((r: any) => r.ruleType === 'EMERGENCY') || { emergencyDays: 3, emergencyThreshold: 1.5 };
                if (currentStock < (avgDemand * emergRule.emergencyThreshold) && avgDemand > 0) {
                    const tomorrowDOW = (dayOfWeek + 1) % 7;
                    const regularTomorrow = rules.some((r: any) => r.ruleType === 'REGULAR' && (r.activeDays && r.activeDays.includes(tomorrowDOW)));
                    if (!regularTomorrow) {
                        isEmergency = true;
                        hasAirTightRuleToday = true;
                        const needed = (avgDemand * (emergRule.emergencyDays || 3) * 1.2) - currentStock;
                        airTightSuggestedAmount = Math.round(Math.max(0, needed));
                    }
                }
            }

            // If no data points to prepping this ingredient today, skip (including airtight triggers)
            if (!hasNightShift && !hasRecurring && !hasAirTightRuleToday) continue;

            let suggestedBaseAmount: number | null = null;
            let suggestedBaseIngredientName: string | null = null;

            if (hasRecurring && rule && rule.baseIngredient) {
                suggestedBaseIngredientName = rule.baseIngredient.name;
                const mathResult = ((recurringAmount * 1.2) - currentStock) * 0.1 / 0.95;
                const roundedResult = Math.round(mathResult);
                suggestedBaseAmount = Math.max(0, roundedResult);
            }

            mergedTasks.push({
                ingredientId: ingredient.id,
                ingredientName: ingredient.name,
                parentName: (ingredient as any).parent?.name || null,
                metric: ingredient.metric || 'units',
                category: (ingredient as any).category.name,
                assignedAmount: assignment ? assignment.portionsAssigned : 0,
                recurringAmount: recurringAmount,
                actualAmount: assignment ? assignment.portionsActual : null,
                completed: assignment ? assignment.completed : false,
                assignmentId: assignment?.id,
                hasNightShift,
                hasRecurring: hasRecurring || hasAirTightRuleToday,
                isUrgent: isUrgent || isEmergency,
                completedBy: assignment?.user?.name || undefined,
                digitalRecipeId: (ingredient as any).digitalRecipeId || null,
                digitalRecipeName: (ingredient as any).digitalRecipe?.name || null,
                suggestedBaseIngredientName,
                suggestedBaseAmount,
                isEmergency,
                airTightSuggestedAmount
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
                // "Descongelar" -> Shifts from Frozen to Thawing. Total Stock (Frozen+Thawing) remains strictly identical.
                frozenInc = -actualAmount;
                thawingInc = actualAmount;
            } else if (taskName.includes('congelar')) {
                // "Congelar" -> only increments FrozenQty (Total)
                thawingInc = 0;
                if ((taskIngredient as any).subtractFromInventory) {
                    frozenInc = -frozenInc;
                }
            } else {
                // Standard Prep Processing Rule (e.g. Chopping)
                if ((taskIngredient as any).subtractFromInventory) {
                    frozenInc = -frozenInc;
                    thawingInc = -thawingInc;
                }
            }

            const newFrozenQty = Math.max(0, inventory.frozenQty + frozenInc);
            // Ignore Cap for Unfrozen stock mathematically if it goes temporarily out of sync, relying on Total physical limits
            const cappedThawingQty = Math.max(0, inventory.thawingQty + thawingInc);

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
                    // Reversing "Descongelar": adding back to frozen, subtracting from thawed perfectly
                    frozenDec = -actualAmount; // Math: inventory.frozenQty - (-actualAmount) = adds to frozen
                    thawingDec = actualAmount; // Math: inventory.thawingQty - actualAmount = subtracts from thawed
                }

                // Invert the decrement logic if 'subtractFromInventory' is true
                if ((taskIngredient as any).subtractFromInventory && !isDescongelar) {
                    frozenDec = -frozenDec;
                    thawingDec = -thawingDec;
                }

                const newFrozenQty = Math.max(0, inventory.frozenQty - frozenDec);
                const newThawingQty = Math.max(0, inventory.thawingQty - thawingDec);

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

// ----------------------------------------------------
// AIR-TIGHT PREP RULES CRUD
// ----------------------------------------------------

export async function getAirTightRules() {
    try {
        const rules = await (prisma as any).prepRule.findMany({
            include: { ingredient: { include: { category: true } } }
        });
        return rules;
    } catch (error) {
        console.error('getAirTightRules error:', error);
        return [];
    }
}

export async function createOrUpdatePrepRule(data: { ingredientId: string, ruleType: string, activeDays: number[], calculationMode: string, fixedAmount: number | null, coverageDays: number[], emergencyDays: number, emergencyThreshold: number, triggerThreshold?: number | null }) {
    try {
        const existing = await (prisma as any).prepRule.findFirst({
            where: { ingredientId: data.ingredientId, ruleType: data.ruleType }
        });

        if (existing) {
            await (prisma as any).prepRule.update({
                where: { id: existing.id },
                data: {
                    activeDays: data.activeDays,
                    calculationMode: data.calculationMode,
                    fixedAmount: data.fixedAmount,
                    coverageDays: data.coverageDays,
                    emergencyDays: data.emergencyDays,
                    emergencyThreshold: data.emergencyThreshold || 1.5,
                    triggerThreshold: data.triggerThreshold !== undefined ? data.triggerThreshold : null
                }
            });
        } else {
            await (prisma as any).prepRule.create({
                data: {
                    ingredientId: data.ingredientId,
                    ruleType: data.ruleType,
                    activeDays: data.activeDays,
                    calculationMode: data.calculationMode,
                    fixedAmount: data.fixedAmount,
                    coverageDays: data.coverageDays,
                    emergencyDays: data.emergencyDays,
                    emergencyThreshold: data.emergencyThreshold || 1.5,
                    triggerThreshold: data.triggerThreshold !== undefined ? data.triggerThreshold : null
                }
            });
        }
        revalidatePath('/[locale]/prep-schedule');
        return { success: true };
    } catch (error) {
        console.error('createOrUpdatePrepRule error:', error);
        return { success: false, error: 'Failed to create or update Prep Rule' };
    }
}

export async function applyRulesToCategory(categoryId: string, data: { activeDays: number[], calculationMode: string, fixedAmount: number | null, coverageDays: number[], triggerThreshold?: number | null }) {
    try {
        // Enforce cascading the rule application to all RAW/PREP/PROCESSED components within this category
        const ingredients = await prisma.ingredient.findMany({
            where: { categoryId: categoryId, type: { in: ['RAW', 'PREP', 'PROCESSED'] } }
        });

        for (const ing of ingredients) {
            const existing = await (prisma as any).prepRule.findFirst({
                where: { ingredientId: ing.id, ruleType: 'REGULAR' }
            });

            if (existing) {
                await (prisma as any).prepRule.update({
                    where: { id: existing.id },
                    data: {
                        activeDays: data.activeDays,
                        calculationMode: data.calculationMode,
                        fixedAmount: data.fixedAmount,
                        coverageDays: data.coverageDays,
                        triggerThreshold: data.triggerThreshold !== undefined ? data.triggerThreshold : null
                    }
                });
            } else {
                await (prisma as any).prepRule.create({
                    data: {
                        ingredientId: ing.id,
                        ruleType: 'REGULAR',
                        activeDays: data.activeDays,
                        calculationMode: data.calculationMode,
                        fixedAmount: data.fixedAmount,
                        coverageDays: data.coverageDays,
                        emergencyDays: 3,
                        emergencyThreshold: 1.5,
                        triggerThreshold: data.triggerThreshold !== undefined ? data.triggerThreshold : null
                    }
                });
            }
        }

        revalidatePath('/[locale]/prep-schedule');
        return { success: true };
    } catch (error) {
        console.error('applyRulesToCategory error:', error);
        return { success: false, error: 'Failed to apply rules to category' };
    }
}

export async function deleteAirTightRule(ruleId: string) {
    try {
        await (prisma as any).prepRule.delete({ where: { id: ruleId } });
        revalidatePath('/[locale]/prep-schedule');
        return { success: true };
    } catch (error) {
        console.error('deleteAirTightRule error:', error);
        return { success: false, error: 'Failed to delete Air-Tight rule' };
    }
}
