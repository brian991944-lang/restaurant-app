'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { isAdminSession } from '@/lib/adminGuard';
import { getConversionFactor } from '@/lib/conversion';
import { isWeightMetric } from '@/lib/purchaseUnits';
import { getBusinessDate, getScheduleAnchorUtc, getScheduleWindowUtc } from '@/lib/businessDay';
import { getRecentPurchaseWeights } from '@/app/actions/purchases';
import { bandFor, computeCleaning, type CleaningMath } from '@/lib/cleaningMath';

// Hoja de limpieza. One raw protein with cleaningMode=true (Teres Major…) has
// PROCESSED children (portions) and may have a merma child (name starts with
// "Merma"). Completing any child task opens ONE sheet: peso crudo → merma →
// porciones por producto. Confirming writes every stock effect in one
// transaction and keeps a CleaningSession so the admin can audit the yield.
//
// Stock rule: raw loses rawWeightLb (converted to its metric), each product
// gains its portions (frozenQty, like completePrepTask), the merma child gains
// wasteWeightLb. Undo reverses all of it and reopens the closed tasks.

type Fail = { success: false; error: string };
const fail = (error: string): Fail => ({ success: false, error });

function revalidate() {
    revalidatePath('/[locale]/prep-schedule', 'page');
    revalidatePath('/[locale]/inventory', 'page');
    revalidatePath('/[locale]/dashboard', 'page');
}

const isMerma = (name: string) => /^merma/i.test(name.trim());

/** lb → the ingredient's own metric (Lbs → 1, Kg → 0.4536 …). Null when the metric isn't a weight. */
function lbToMetric(metric: string): number | null {
    if (!isWeightMetric(metric)) return null;
    return getConversionFactor('lb', metric);
}

// ───────────────────────── context for the sheet ─────────────────────────

export interface CleaningProduct {
    id: string; name: string; nameEs: string | null; portionWeightG: number; yieldPercent: number; stock: number;
    /** The task (type PREP/TASK) under this product that the sheet closes, when one exists. */
    taskIngredientId: string | null;
}

export interface CleaningContext {
    raw: { id: string; name: string; nameEs: string | null; metric: string; stock: number };
    products: CleaningProduct[];
    merma: { id: string; name: string; nameEs: string | null; metric: string; stock: number } | null;
    lastPurchase: { qty: number; unit: string; totalWeightLb: number | null; purchasedAt: string } | null;
    avgLbPerUnit: number | null;
    band: { min: number; max: number };
    cooks: { id: string; name: string }[];
    lastSession: { createdAt: string; rawUnits: number | null; rawWeightLb: number; yieldPct: number; flag: string } | null;
}

export async function getCleaningContext(rawIngredientId: string): Promise<{ success: true; context: CleaningContext } | Fail> {
    try {
        const raw = await prisma.ingredient.findUnique({
            where: { id: rawIngredientId },
            select: {
                id: true, name: true, nameEs: true, metric: true, cleaningMode: true,
                inventory: { select: { frozenQty: true, thawingQty: true } },
                prepItems: {
                    where: { type: 'PROCESSED', isActive: true },
                    orderBy: { name: 'asc' },
                    select: {
                        id: true, name: true, nameEs: true, metric: true, portionWeightG: true, yieldPercent: true,
                        inventory: { select: { frozenQty: true, thawingQty: true } },
                        prepItems: { where: { type: { in: ['PREP', 'TASK'] }, isActive: true }, orderBy: { name: 'asc' }, select: { id: true }, take: 1 },
                    },
                },
                purchaseLines: { orderBy: { createdAt: 'desc' }, take: 1, select: { qty: true, unit: true, totalWeightLb: true, receipt: { select: { purchasedAt: true } } } },
                cleaningSessions: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true, rawUnits: true, rawWeightLb: true, yieldPct: true, flag: true } },
            },
        });
        if (!raw) return fail('Ingrediente no encontrado.');
        if (!raw.cleaningMode) return fail('Este ingrediente no tiene hoja de limpieza.');
        if (!isWeightMetric(raw.metric)) return fail(`${raw.name} se mide en ${raw.metric}; la hoja de limpieza necesita un ingrediente por peso.`);

        const stock = (inv: { frozenQty: number; thawingQty: number } | null) => (inv?.frozenQty ?? 0) + (inv?.thawingQty ?? 0);
        const mermaChild = raw.prepItems.find(p => isMerma(p.name)) ?? null;
        const products: CleaningProduct[] = raw.prepItems.filter(p => !isMerma(p.name)).map(p => ({
            id: p.id, name: p.name, nameEs: p.nameEs, portionWeightG: p.portionWeightG, yieldPercent: p.yieldPercent,
            stock: stock(p.inventory), taskIngredientId: p.prepItems[0]?.id ?? null,
        }));
        if (products.length === 0) return fail(`${raw.name} no tiene productos (porciones) debajo.`);

        const last = raw.purchaseLines[0];
        const w = await getRecentPurchaseWeights(raw.id);
        const cookRows = await prisma.user.findMany({
            where: { role: 'KITCHEN', isActive: true, email: { not: 'anycook@system.local' } },
            select: { id: true, name: true }, orderBy: { name: 'asc' },
        });
        const cooks = cookRows.map(c => ({ id: c.id, name: c.name ?? '—' }));
        const s = raw.cleaningSessions[0];
        return {
            success: true,
            context: {
                raw: { id: raw.id, name: raw.name, nameEs: raw.nameEs, metric: raw.metric, stock: stock(raw.inventory) },
                products,
                merma: mermaChild ? { id: mermaChild.id, name: mermaChild.name, nameEs: mermaChild.nameEs, metric: mermaChild.metric, stock: stock(mermaChild.inventory) } : null,
                lastPurchase: last ? { qty: last.qty, unit: last.unit, totalWeightLb: last.totalWeightLb, purchasedAt: last.receipt.purchasedAt.toISOString() } : null,
                avgLbPerUnit: w.success ? w.avgLbPerUnit ?? null : null,
                band: bandFor(products.map(p => p.yieldPercent)),
                cooks,
                lastSession: s ? { createdAt: s.createdAt.toISOString(), rawUnits: s.rawUnits, rawWeightLb: s.rawWeightLb, yieldPct: s.yieldPct, flag: s.flag } : null,
            },
        };
    } catch (e: any) {
        console.error('Error loading cleaning context:', e);
        return fail(e.message);
    }
}

// ───────────────────────── save ─────────────────────────

export interface CleaningInput {
    rawIngredientId: string;
    rawUnits?: number | null;
    rawWeightLb: number;
    wasteWeightLb: number;
    outputs: { ingredientId: string; qty: number }[];
    cookIds: string[];
    note?: string | null;
}

export async function completeCleaningSession(input: CleaningInput): Promise<{ success: true; sessionId: string; math: CleaningMath } | Fail> {
    try {
        if (!(input.rawWeightLb > 0)) return fail('Escribe el peso crudo.');
        if (!(input.wasteWeightLb >= 0)) return fail('La merma no puede ser negativa.');
        if (!input.cookIds?.length) return fail('Elige quién limpió.');
        const wanted = input.outputs.filter(o => o.qty > 0);
        if (wanted.length === 0) return fail('Escribe al menos una porción.');

        const ctx = await getCleaningContext(input.rawIngredientId);
        if (!ctx.success) return ctx;
        const { raw, products, merma, band } = ctx.context;

        const byId = new Map(products.map(p => [p.id, p]));
        for (const o of wanted) if (!byId.has(o.ingredientId)) return fail('Producto desconocido en la hoja.');
        if (input.wasteWeightLb > 0 && merma && !isWeightMetric(merma.metric)) return fail(`${merma.name} no se mide por peso.`);

        const math = computeCleaning({
            rawWeightLb: input.rawWeightLb, wasteWeightLb: input.wasteWeightLb,
            outputs: wanted.map(o => ({ qty: o.qty, portionWeightG: byId.get(o.ingredientId)!.portionWeightG, yieldPercent: byId.get(o.ingredientId)!.yieldPercent })),
            band,
        });

        const rawFactor = lbToMetric(raw.metric)!;
        const rawOut = input.rawWeightLb * rawFactor;
        const mermaFactor = merma ? lbToMetric(merma.metric) ?? 1 : 1;

        const rawRow = await prisma.ingredient.findUnique({ where: { id: raw.id }, select: { allowNegativeStock: true } });
        const anyCook = await prisma.user.findFirst({ where: { email: 'anycook@system.local' }, select: { id: true } });
        const cooks = await prisma.user.findMany({ where: { id: { in: input.cookIds } }, select: { id: true, name: true } });
        if (cooks.length === 0) return fail('Elige quién limpió.');
        const cookNames = cooks.map(c => c.name ?? '—').join(', ');

        const now = new Date();
        const businessDate = getBusinessDate(now);
        const { start, end } = getScheduleWindowUtc(businessDate);

        const sessionId = await prisma.$transaction(async tx => {
            // 1. raw out
            const rawInv = await tx.inventory.upsert({
                where: { ingredientId: raw.id },
                create: { ingredientId: raw.id, frozenQty: 0, thawingQty: 0 },
                update: {},
            });
            // Take from thawing first (meat being worked is out of the freezer), then frozen.
            const takeThaw = Math.max(0, Math.min(rawInv.thawingQty, rawOut));
            let takeFrozen = rawOut - takeThaw;
            if (!(rawRow?.allowNegativeStock ?? true)) takeFrozen = Math.min(takeFrozen, Math.max(0, rawInv.frozenQty));
            await tx.inventory.update({
                where: { id: rawInv.id },
                data: { thawingQty: rawInv.thawingQty - takeThaw, frozenQty: rawInv.frozenQty - takeFrozen },
            });
            await tx.ingredient.update({ where: { id: raw.id }, data: { unfrozenQuantity: rawInv.thawingQty - takeThaw } });
            await tx.inventoryTransaction.create({
                data: { ingredientId: raw.id, type: 'CLEANING_RAW', qty: -rawOut, note: `Hoja de limpieza: ${input.rawWeightLb} lb crudo (${cookNames})` },
            });

            // 2. products in + close their tasks for today
            const assignmentIds: string[] = [];
            let schedule: { id: string } | null = null;
            for (const o of wanted) {
                const p = byId.get(o.ingredientId)!;
                await tx.inventory.upsert({
                    where: { ingredientId: p.id },
                    create: { ingredientId: p.id, frozenQty: o.qty, thawingQty: 0 },
                    update: { frozenQty: { increment: o.qty } },
                });
                await tx.inventoryTransaction.create({
                    data: { ingredientId: p.id, type: 'PREP_COMPLETE', qty: o.qty, note: `Hoja de limpieza: ${raw.name} → ${o.qty} porciones` },
                });

                if (!p.taskIngredientId) continue;
                const open = await tx.prepAssignment.findFirst({
                    where: { ingredientId: p.taskIngredientId, completed: false, schedule: { date: { gte: start, lte: end } } },
                    orderBy: { id: 'asc' },
                });
                let assignmentId: string;
                if (open) {
                    await tx.prepAssignment.update({ where: { id: open.id }, data: { portionsActual: o.qty, completed: true, completedAt: now } });
                    assignmentId = open.id;
                } else {
                    if (!anyCook) throw new Error('ANY_COOK_MISSING');
                    if (!schedule) {
                        schedule = await tx.schedule.findFirst({ where: { date: { gte: start, lte: end } }, select: { id: true } })
                            ?? await tx.schedule.create({ data: { date: getScheduleAnchorUtc(businessDate), createdBy: 'System (Hoja de limpieza)', assignedTo: 'MorningCrew' }, select: { id: true } });
                    }
                    const created = await tx.prepAssignment.create({
                        data: { scheduleId: schedule.id, userId: anyCook.id, ingredientId: p.taskIngredientId, portionsAssigned: 0, portionsActual: o.qty, completed: true, completedAt: now },
                    });
                    assignmentId = created.id;
                }
                await tx.prepAssignmentCompletedBy.deleteMany({ where: { assignmentId } });
                await tx.prepAssignmentCompletedBy.createMany({ data: cooks.map(c => ({ assignmentId, userId: c.id })), skipDuplicates: true });
                assignmentIds.push(assignmentId);
            }

            // 3. merma in
            if (merma && input.wasteWeightLb > 0) {
                const wasteQty = input.wasteWeightLb * mermaFactor;
                await tx.inventory.upsert({
                    where: { ingredientId: merma.id },
                    create: { ingredientId: merma.id, frozenQty: wasteQty, thawingQty: 0 },
                    update: { frozenQty: { increment: wasteQty } },
                });
                await tx.inventoryTransaction.create({
                    data: { ingredientId: merma.id, type: 'PREP_COMPLETE', qty: wasteQty, note: `Hoja de limpieza: merma de ${raw.name}` },
                });
            }

            // 4. the session itself
            const session = await tx.cleaningSession.create({
                data: {
                    rawIngredientId: raw.id,
                    rawUnits: input.rawUnits && input.rawUnits > 0 ? input.rawUnits : null,
                    rawWeightLb: input.rawWeightLb,
                    wasteWeightLb: input.wasteWeightLb,
                    producedWeightLb: math.producedWeightLb,
                    yieldPct: math.yieldPct,
                    unaccountedLb: math.unaccountedLb,
                    flag: math.flag,
                    cookNames,
                    note: input.note?.trim() || null,
                    assignmentIds,
                    outputs: {
                        create: [
                            ...wanted.map(o => ({ ingredientId: o.ingredientId, qty: o.qty, portionWeightG: byId.get(o.ingredientId)!.portionWeightG, isWaste: false })),
                            ...(merma && input.wasteWeightLb > 0 ? [{ ingredientId: merma.id, qty: input.wasteWeightLb, portionWeightG: null as number | null, isWaste: true }] : []),
                        ],
                    },
                },
                select: { id: true },
            });
            return session.id;
        }, { maxWait: 10000, timeout: 30000 });

        revalidate();
        return { success: true, sessionId, math };
    } catch (e: any) {
        console.error('Error saving cleaning session:', e);
        return fail(e.message === 'ANY_COOK_MISSING' ? 'Falta el usuario "Any Cook" del sistema.' : e.message);
    }
}

// ───────────────────────── undo ─────────────────────────

/** Reverses every stock effect of a session and reopens the tasks it closed. Cook-callable, like undoPrepTask. */
export async function undoCleaningSession(sessionId: string): Promise<{ success: true } | Fail> {
    try {
        const session = await prisma.cleaningSession.findUnique({
            where: { id: sessionId },
            include: { outputs: { include: { ingredient: { select: { metric: true, name: true } } } }, rawIngredient: { select: { id: true, name: true, metric: true } } },
        });
        if (!session) return { success: true }; // already undone
        const rawFactor = lbToMetric(session.rawIngredient.metric) ?? 1;
        const rawBack = session.rawWeightLb * rawFactor;

        await prisma.$transaction(async tx => {
            const rawInv = await tx.inventory.upsert({
                where: { ingredientId: session.rawIngredientId },
                create: { ingredientId: session.rawIngredientId, frozenQty: rawBack, thawingQty: 0 },
                update: { frozenQty: { increment: rawBack } },
            });
            await tx.inventoryTransaction.create({
                data: { ingredientId: session.rawIngredientId, type: 'CLEANING_UNDO', qty: rawBack, note: `Hoja de limpieza deshecha (${session.cookNames ?? ''})`.trim() },
            });
            void rawInv;
            for (const o of session.outputs) {
                const qty = o.isWaste ? o.qty * (lbToMetric(o.ingredient.metric) ?? 1) : o.qty;
                const inv = await tx.inventory.findUnique({ where: { ingredientId: o.ingredientId } });
                if (inv) {
                    // Portions leave the freezer first, then the fridge; never below 0 (sales may have used them).
                    const fromFrozen = Math.min(inv.frozenQty, qty);
                    const fromThaw = Math.min(inv.thawingQty, qty - fromFrozen);
                    await tx.inventory.update({ where: { id: inv.id }, data: { frozenQty: inv.frozenQty - fromFrozen, thawingQty: inv.thawingQty - fromThaw } });
                }
                await tx.inventoryTransaction.create({
                    data: { ingredientId: o.ingredientId, type: 'UNDO_PREP', qty: -qty, note: `Hoja de limpieza deshecha: ${session.rawIngredient.name}` },
                });
            }
            if (session.assignmentIds.length) {
                await tx.prepAssignment.updateMany({ where: { id: { in: session.assignmentIds } }, data: { completed: false, portionsActual: null, completedAt: null } });
                await tx.prepAssignmentCompletedBy.deleteMany({ where: { assignmentId: { in: session.assignmentIds } } });
            }
            await tx.cleaningSession.delete({ where: { id: session.id } });
        });
        revalidate();
        return { success: true };
    } catch (e: any) {
        console.error('Error undoing cleaning session:', e);
        return fail(e.message);
    }
}

// ───────────────────────── admin: history ─────────────────────────

export interface CleaningHistoryRow {
    id: string; createdAt: string; cookNames: string | null; rawUnits: number | null; rawWeightLb: number; wasteWeightLb: number;
    producedWeightLb: number; yieldPct: number; unaccountedLb: number; flag: string;
    outputs: { ingredientId: string; name: string; nameEs: string | null; qty: number; isWaste: boolean }[];
}

export async function getCleaningHistory(rawIngredientId: string, days = 30): Promise<
    { success: true; rows: CleaningHistoryRow[]; summary: { avgYield: number | null; wastePct: number | null; missing: number; count: number } } | Fail
> {
    if (!(await isAdminSession())) return fail('Solo administración.');
    try {
        const since = new Date(Date.now() - days * 86400000);
        const sessions = await prisma.cleaningSession.findMany({
            where: { rawIngredientId, createdAt: { gte: since } },
            orderBy: { createdAt: 'desc' },
            include: { outputs: { include: { ingredient: { select: { name: true, nameEs: true } } } } },
        });
        const rows: CleaningHistoryRow[] = sessions.map(s => ({
            id: s.id, createdAt: s.createdAt.toISOString(), cookNames: s.cookNames, rawUnits: s.rawUnits, rawWeightLb: s.rawWeightLb,
            wasteWeightLb: s.wasteWeightLb, producedWeightLb: s.producedWeightLb, yieldPct: s.yieldPct, unaccountedLb: s.unaccountedLb, flag: s.flag,
            outputs: s.outputs.map(o => ({ ingredientId: o.ingredientId, name: o.ingredient.name, nameEs: o.ingredient.nameEs, qty: o.qty, isWaste: o.isWaste })),
        }));
        const rawTotal = sessions.reduce((a, s) => a + s.rawWeightLb, 0);
        const summary = {
            count: sessions.length,
            avgYield: rawTotal > 0 ? (sessions.reduce((a, s) => a + s.producedWeightLb, 0) / rawTotal) * 100 : null,
            wastePct: rawTotal > 0 ? (sessions.reduce((a, s) => a + s.wasteWeightLb, 0) / rawTotal) * 100 : null,
            missing: sessions.filter(s => s.flag === 'MISSING').length,
        };
        return { success: true, rows, summary };
    } catch (e: any) {
        console.error('Error loading cleaning history:', e);
        return fail(e.message);
    }
}
