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
//
// Bolas (RawPiece): a purchase of a cleaning-mode raw can list each ball with its
// weight. The sheet then cleans ONE ball per session: picking it fills the raw
// weight; a ball with no weight is weighed first. Undo puts the ball back.
// Carne suelta: whatever stays unportioned is counted at closing (grams) on the
// inventory card; the count adjusts raw stock (LOOSE_COUNT) and the history
// attributes it to that business day's cleaning — a leftover lowers that ball's
// unaccounted, a leftover used up the next day raises the next ball's raw.

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
    /** Whole balls still to clean, by number. Empty = no balls registered (weigh by hand, as before). */
    pieces: { id: string; number: number; weightLb: number | null }[];
    /** Loose meat counted at the last closing, still in stock (lb). */
    looseLb: number;
    looseBreakdown: { name: string; nameEs: string | null; g: number }[];
}

const GRAMS_PER_LB = 453.59237;

/**
 * Whole balls left + the loose (unportioned) meat, in lb. Loose = raw stock in lb
 * minus the weighed balls still whole; never negative. Kitchen-safe (no costs).
 */
export async function getPieceSummary(rawIngredientId: string, metric: string, stockInMetric: number) {
    const pieces = await prisma.rawPiece.findMany({
        where: { ingredientId: rawIngredientId, status: 'AVAILABLE' },
        orderBy: { number: 'asc' },
        select: { id: true, number: true, weightLb: true },
    });
    const factor = lbToMetric(metric);
    const stockLb = factor ? stockInMetric / factor : 0;
    const wholeLb = pieces.reduce((a, p) => a + (p.weightLb ?? 0), 0);
    return { pieces, wholeLb, looseLb: Math.max(0, stockLb - wholeLb) };
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
                cleaningSessions: {
                    orderBy: { createdAt: 'desc' }, take: 1,
                    select: {
                        createdAt: true, rawUnits: true, rawWeightLb: true, yieldPct: true, flag: true,
                        outputs: { where: { leftoverG: { gt: 0 } }, select: { leftoverG: true, ingredient: { select: { name: true, nameEs: true } } } },
                    },
                },
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
        const { pieces, looseLb } = await getPieceSummary(raw.id, raw.metric, stock(raw.inventory));
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
                pieces,
                // Only meaningful once balls are registered (otherwise all stock is "loose").
                looseLb: pieces.length > 0 ? looseLb : 0,
                // What the last cleaning left, by product — the label on the "usé la carne suelta" tick.
                looseBreakdown: pieces.length > 0 && looseLb > 0
                    ? (s?.outputs ?? []).map(o => ({ name: o.ingredient.name, nameEs: o.ingredient.nameEs, g: Math.round(o.leftoverG) }))
                    : [],
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
    /** Per product: portions, and grams of its cut left short of a portion (kept as loose meat). */
    outputs: { ingredientId: string; qty: number; leftoverG?: number | null }[];
    cookIds: string[];
    note?: string | null;
    /** The ball being cleaned. Its receipt weight wins over rawWeightLb; an unweighed ball takes rawWeightLb. */
    pieceId?: string | null;
    /** Loose meat from before that went into this cleaning (lb). Capped at what is loose in stock. */
    carryInLb?: number | null;
    /** Meat left unportioned, kept as loose raw for the next ball (lb). Not merma. */
    carryOutLb?: number | null;
}

/** The meat that actually went through the cleaning: ball + loose used − loose kept. */
const effectiveRaw = (s: { rawWeightLb: number; carryInLb?: number | null; carryOutLb?: number | null }) =>
    s.rawWeightLb + (s.carryInLb ?? 0) - (s.carryOutLb ?? 0);

export async function completeCleaningSession(input: CleaningInput): Promise<{ success: true; sessionId: string; math: CleaningMath } | Fail> {
    try {
        let piece: { id: string; number: number; weightLb: number | null } | null = null;
        if (input.pieceId) {
            piece = await prisma.rawPiece.findFirst({
                where: { id: input.pieceId, ingredientId: input.rawIngredientId, status: 'AVAILABLE' },
                select: { id: true, number: true, weightLb: true },
            });
            if (!piece) return fail('Esa bola ya se limpió. Elige otra.');
            if (piece.weightLb != null) input = { ...input, rawWeightLb: piece.weightLb };
            input = { ...input, rawUnits: 1 };
        }
        if (!(input.rawWeightLb > 0)) return fail('Escribe el peso crudo.');
        if (!(input.wasteWeightLb >= 0)) return fail('La merma no puede ser negativa.');
        if (!input.cookIds?.length) return fail('Elige quién limpió.');
        const leftoverOf = (o: { leftoverG?: number | null }) => Math.max(0, Number(o.leftoverG) || 0);
        const wanted = input.outputs.filter(o => o.qty > 0);
        if (wanted.length === 0) return fail('Escribe al menos una porción.');
        // Rows saved on the session: any with portions or with a leftover.
        const rowsOut = input.outputs.filter(o => o.qty > 0 || leftoverOf(o) > 0);
        // Leftover per product adds up to the loose meat kept (overrides a bare carryOutLb).
        const leftoverTotalG = input.outputs.reduce((a, o) => a + leftoverOf(o), 0);
        if (leftoverTotalG > 0) input = { ...input, carryOutLb: leftoverTotalG / GRAMS_PER_LB };

        const ctx = await getCleaningContext(input.rawIngredientId);
        if (!ctx.success) return ctx;
        const { raw, products, merma, band } = ctx.context;

        const carryInLb = Math.max(0, Math.min(input.carryInLb ?? 0, ctx.context.looseLb + 0.001));
        const carryOutLb = Math.max(0, input.carryOutLb ?? 0);
        if (carryOutLb >= input.rawWeightLb + carryInLb) return fail('El sobrante no puede ser mayor que la carne cruda.');
        input = { ...input, carryInLb, carryOutLb };
        const usedLb = effectiveRaw(input);

        const byId = new Map(products.map(p => [p.id, p]));
        for (const o of rowsOut) if (!byId.has(o.ingredientId)) return fail('Producto desconocido en la hoja.');
        if (input.wasteWeightLb > 0 && merma && !isWeightMetric(merma.metric)) return fail(`${merma.name} no se mide por peso.`);

        const math = computeCleaning({
            rawWeightLb: usedLb, wasteWeightLb: input.wasteWeightLb,
            outputs: wanted.map(o => ({ qty: o.qty, portionWeightG: byId.get(o.ingredientId)!.portionWeightG, yieldPercent: byId.get(o.ingredientId)!.yieldPercent })),
            band,
        });

        const rawFactor = lbToMetric(raw.metric)!;
        // The leftover kept stays in raw stock (as loose meat); the leftover used leaves it.
        const rawOut = usedLb * rawFactor;
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
                data: { ingredientId: raw.id, type: 'CLEANING_RAW', qty: -rawOut, note: `Hoja de limpieza: ${piece ? `bola #${piece.number}, ` : ''}${input.rawWeightLb} lb crudo${carryInLb > 0 ? ` + ${Math.round(carryInLb * GRAMS_PER_LB)} g suelta` : ''}${carryOutLb > 0 ? ` − ${Math.round(carryOutLb * GRAMS_PER_LB)} g sobrante` : ''} (${cookNames})` },
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
                    carryInLb,
                    carryOutLb,
                    flag: math.flag,
                    cookNames,
                    note: input.note?.trim() || null,
                    assignmentIds,
                    outputs: {
                        create: [
                            ...rowsOut.map(o => ({ ingredientId: o.ingredientId, qty: o.qty, portionWeightG: byId.get(o.ingredientId)!.portionWeightG, isWaste: false, leftoverG: leftoverOf(o) })),
                            ...(merma && input.wasteWeightLb > 0 ? [{ ingredientId: merma.id, qty: input.wasteWeightLb, portionWeightG: null as number | null, isWaste: true }] : []),
                        ],
                    },
                },
                select: { id: true },
            });

            // 5. the ball is used (guarded: two tablets can't clean the same ball)
            if (piece) {
                const taken = await tx.rawPiece.updateMany({
                    where: { id: piece.id, status: 'AVAILABLE' },
                    data: { status: 'CLEANED', cleaningSessionId: session.id, ...(piece.weightLb == null ? { weightLb: input.rawWeightLb } : {}) },
                });
                if (taken.count !== 1) throw new Error('PIECE_TAKEN');
            }
            return session.id;
        }, { maxWait: 10000, timeout: 30000 });

        revalidate();
        return { success: true, sessionId, math };
    } catch (e: any) {
        console.error('Error saving cleaning session:', e);
        if (e.message === 'PIECE_TAKEN') return fail('Esa bola ya se limpió. Elige otra.');
        return fail(e.message === 'ANY_COOK_MISSING' ? 'Falta el usuario "Any Cook" del sistema.' : e.message);
    }
}

// ───────────────────────── carne suelta (closing count) ─────────────────────────

/**
 * Closing count of the loose (unportioned) meat of a cleaning-mode raw, in grams.
 * Sets raw stock to (whole balls + counted loose) by logging the difference as
 * LOOSE_COUNT. Cook-callable, like the rest of the sheet.
 */
export async function countLooseMeat(rawIngredientId: string, grams: number): Promise<{ success: true; looseLb: number; deltaLb: number } | Fail> {
    try {
        if (!(grams >= 0) || !Number.isFinite(grams)) return fail('Escribe los gramos (0 si no quedó nada).');
        const raw = await prisma.ingredient.findUnique({
            where: { id: rawIngredientId },
            select: { id: true, name: true, metric: true, cleaningMode: true, inventory: { select: { frozenQty: true, thawingQty: true } } },
        });
        if (!raw?.cleaningMode) return fail('Este ingrediente no tiene hoja de limpieza.');
        const factor = lbToMetric(raw.metric);
        if (!factor) return fail(`${raw.name} no se mide por peso.`);
        const stock = (raw.inventory?.frozenQty ?? 0) + (raw.inventory?.thawingQty ?? 0);
        const { looseLb } = await getPieceSummary(raw.id, raw.metric, stock);
        const targetLb = grams / GRAMS_PER_LB;
        const deltaLb = targetLb - looseLb;
        if (Math.abs(deltaLb) < 0.0005) return { success: true, looseLb: targetLb, deltaLb: 0 };
        const delta = deltaLb * factor;

        await prisma.$transaction(async tx => {
            const inv = await tx.inventory.upsert({ where: { ingredientId: raw.id }, create: { ingredientId: raw.id, frozenQty: 0, thawingQty: 0 }, update: {} });
            // Loose meat is in the fridge: a decrease comes out of thawing first.
            if (delta >= 0) {
                await tx.inventory.update({ where: { id: inv.id }, data: { frozenQty: inv.frozenQty + delta } });
            } else {
                const fromThaw = Math.min(inv.thawingQty, -delta);
                await tx.inventory.update({ where: { id: inv.id }, data: { thawingQty: inv.thawingQty - fromThaw, frozenQty: inv.frozenQty - (-delta - fromThaw) } });
                if (fromThaw > 0) await tx.ingredient.update({ where: { id: raw.id }, data: { unfrozenQuantity: inv.thawingQty - fromThaw } });
            }
            await tx.inventoryTransaction.create({
                data: { ingredientId: raw.id, type: 'LOOSE_COUNT', qty: delta, note: `Carne suelta al cierre: ${Math.round(grams)} g (antes ${Math.round(looseLb * GRAMS_PER_LB)} g)` },
            });
        });
        revalidate();
        return { success: true, looseLb: targetLb, deltaLb };
    } catch (e: any) {
        console.error('Error counting loose meat:', e);
        return fail(e.message);
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
        const rawBack = effectiveRaw(session) * rawFactor;

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
                if (!o.isWaste && o.qty === 0) continue; // a leftover-only row moved no portions
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
            // The ball goes back to the list of balls to clean.
            await tx.rawPiece.updateMany({ where: { cleaningSessionId: session.id }, data: { status: 'AVAILABLE', cleaningSessionId: null } });
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
    outputs: { ingredientId: string; name: string; nameEs: string | null; qty: number; isWaste: boolean; leftoverG: number }[];
    /** Ball number, when the session cleaned a registered ball. */
    pieceNumber: number | null;
    /** Loose meat used from before / kept for the next ball, as entered on the sheet (lb). */
    carryInLb: number;
    carryOutLb: number;
    /** Corrections of loose meat from the inventory card that business day, net lb (+ more found, − less). */
    countLb: number;
}

export interface CleaningBatch {
    purchasedAt: string; supplierName: string | null; pieces: number; cleaned: number;
    rawLb: number; cleanedRawLb: number; producedLb: number; wasteLb: number; looseLb: number;
    /** produced ÷ raw actually used (cleaned balls − loose meat still in stock). */
    yieldPct: number | null;
    costCents: number | null;
}

export async function getCleaningHistory(rawIngredientId: string, days = 30): Promise<
    { success: true; rows: CleaningHistoryRow[]; summary: { avgYield: number | null; wastePct: number | null; missing: number; count: number }; batch: CleaningBatch | null } | Fail
> {
    if (!(await isAdminSession())) return fail('Solo administración.');
    try {
        const since = new Date(Date.now() - days * 86400000);
        const sessions = await prisma.cleaningSession.findMany({
            where: { rawIngredientId, createdAt: { gte: since } },
            orderBy: { createdAt: 'desc' },
            include: {
                outputs: { include: { ingredient: { select: { name: true, nameEs: true } } } },
                rawPiece: { select: { number: true } },
            },
        });
        const raw = await prisma.ingredient.findUnique({ where: { id: rawIngredientId }, select: { metric: true } });
        const factor = (raw && lbToMetric(raw.metric)) || 1;

        // Closing counts → the last cleaning of the same business day (none that day: unattributed).
        const counts = await prisma.inventoryTransaction.findMany({
            where: { ingredientId: rawIngredientId, type: 'LOOSE_COUNT', createdAt: { gte: since } },
            select: { qty: true, createdAt: true },
        });
        const lastSessionByDay = new Map<string, string>();
        for (const s of sessions) { const d = getBusinessDate(s.createdAt); if (!lastSessionByDay.has(d)) lastSessionByDay.set(d, s.id); }
        const looseBySession = new Map<string, number>();
        for (const c of counts) {
            const sid = lastSessionByDay.get(getBusinessDate(c.createdAt));
            if (sid) looseBySession.set(sid, (looseBySession.get(sid) ?? 0) + c.qty / factor);
        }

        const rows: CleaningHistoryRow[] = sessions.map(s => ({
            id: s.id, createdAt: s.createdAt.toISOString(), cookNames: s.cookNames, rawUnits: s.rawUnits, rawWeightLb: s.rawWeightLb,
            wasteWeightLb: s.wasteWeightLb, producedWeightLb: s.producedWeightLb, yieldPct: s.yieldPct, unaccountedLb: s.unaccountedLb, flag: s.flag,
            outputs: s.outputs.map(o => ({ ingredientId: o.ingredientId, name: o.ingredient.name, nameEs: o.ingredient.nameEs, qty: o.qty, isWaste: o.isWaste, leftoverG: o.leftoverG })),
            pieceNumber: s.rawPiece?.number ?? null,
            carryInLb: s.carryInLb,
            carryOutLb: s.carryOutLb,
            countLb: looseBySession.get(s.id) ?? 0,
        }));

        // The latest purchase that registered balls: how the whole batch is doing so far.
        let batch: CleaningBatch | null = null;
        const latest = await prisma.rawPiece.findFirst({
            where: { ingredientId: rawIngredientId, purchaseLineId: { not: null } },
            orderBy: { receivedAt: 'desc' },
            select: { purchaseLineId: true },
        });
        if (latest?.purchaseLineId) {
            const line = await prisma.purchaseLine.findUnique({
                where: { id: latest.purchaseLineId },
                select: {
                    priceCents: true, receipt: { select: { purchasedAt: true, supplierName: true } },
                    rawPieces: { select: { weightLb: true, status: true, cleaningSession: { select: { id: true, rawWeightLb: true, carryInLb: true, carryOutLb: true, producedWeightLb: true, wasteWeightLb: true, createdAt: true } } } },
                },
            });
            if (line) {
                const cleanedSessions = line.rawPieces.map(p => p.cleaningSession).filter((s): s is NonNullable<typeof s> => !!s);
                const firstClean = cleanedSessions.reduce<Date | null>((a, s) => (!a || s.createdAt < a ? s.createdAt : a), null);
                // Card corrections of the loose meat since this batch started being cleaned.
                const countSince = firstClean
                    ? (await prisma.inventoryTransaction.aggregate({ where: { ingredientId: rawIngredientId, type: 'LOOSE_COUNT', createdAt: { gte: firstClean } }, _sum: { qty: true } }))._sum.qty ?? 0
                    : 0;
                const cleanedRawLb = cleanedSessions.reduce((a, s) => a + s.rawWeightLb, 0);
                const producedLb = cleanedSessions.reduce((a, s) => a + s.producedWeightLb, 0);
                // Loose meat this batch left sitting in stock: kept − used again + corrections.
                const looseLb = cleanedSessions.reduce((a, s) => a + s.carryOutLb - s.carryInLb, 0) + countSince / factor;
                const usedLb = cleanedRawLb - looseLb;
                batch = {
                    purchasedAt: line.receipt.purchasedAt.toISOString(), supplierName: line.receipt.supplierName,
                    pieces: line.rawPieces.length, cleaned: cleanedSessions.length,
                    rawLb: line.rawPieces.reduce((a, p) => a + (p.weightLb ?? 0), 0),
                    cleanedRawLb, producedLb, wasteLb: cleanedSessions.reduce((a, s) => a + s.wasteWeightLb, 0), looseLb,
                    yieldPct: usedLb > 0 ? (producedLb / usedLb) * 100 : null,
                    costCents: line.priceCents,
                };
            }
        }
        const rawTotal = sessions.reduce((a, s) => a + s.rawWeightLb, 0);
        const summary = {
            count: sessions.length,
            avgYield: rawTotal > 0 ? (sessions.reduce((a, s) => a + s.producedWeightLb, 0) / rawTotal) * 100 : null,
            wastePct: rawTotal > 0 ? (sessions.reduce((a, s) => a + s.wasteWeightLb, 0) / rawTotal) * 100 : null,
            missing: sessions.filter(s => s.flag === 'MISSING').length,
        };
        return { success: true, rows, summary, batch };
    } catch (e: any) {
        console.error('Error loading cleaning history:', e);
        return fail(e.message);
    }
}
