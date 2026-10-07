/**
 * Toast sales → inventory consumption.
 *
 * Every Toast selection becomes one PosSalesLine. A run computes each line's
 * target (its quantity, or 0 if voided or gone from Toast) and moves stock
 * only by target − appliedQty, so re-running a day is safe and a void after
 * the fact is reversed.
 *
 * What a line takes out of stock is fixed at its first apply, in
 * PosSalesDeduction rows. Later increases reuse those per-unit amounts and
 * reversals scale them down; neither ever re-reads the recipe, so editing a
 * recipe does not move stock for sales already consumed.
 *
 * Read-only toward Toast.
 */
import prisma from '@/lib/prisma';
import { PosSource, Prisma } from '@prisma/client';
import { fetchToastOrders } from '@/lib/toast/client';
import { getConversionFactor } from '@/lib/conversion';
import { fallbackModifierKey, modifierMappingKey } from '@/lib/pos/toastMapping';
import { isProteinModifier } from '@/lib/posNameMatch';
import { dateColumn, fromToastBusinessDate, toastBusinessDateOf } from '@/lib/pos/toastBusinessDate';

const LOCK_STALE_MS = 30 * 60 * 1000;
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));

export type ConsumptionOptions = {
    dryRun: boolean;
    /** false: record lines only, move no stock (used when fixing a baseline). Default true. */
    stock?: boolean;
    /** Use this baseline instead of the stored one (baseline preview). */
    baselineAt?: Date | null;
};

export type ConsumptionReport = {
    date: string;
    skipped?: string;
    lines: number;
    applied: number;
    reversed: number;
    /** Lines from before the baseline: recorded as consumed, stock untouched. */
    baselined: number;
    baselineAt: string | null;
    unmapped: { name: string; guid: string; qty: number }[];
    unmappedModifiers: { name: string; parent: string; key: string; qty: number }[];
    /** What moved (or, in a dry run, would move), per ingredient. */
    deductions: { ingredientId: string; ingredient: string; unit: string; deducted: number; clamped: number; restored: number }[];
    warnings: string[];
    errors: { selectionGuid: string; name: string; error: string }[];
};

type Want = { ingredientId: string; qty: number; sourceKind: 'ITEM' | 'MODIFIER'; menuItemModifierId: string | null };
type Stock = { frozen: number; thawing: number };
type IngredientInfo = { name: string; metric: string; allowNegativeStock: boolean; hasInventory: boolean };

/** Recipe amount in the ingredient's stock unit — same rule as depleteInventoryForMenuItem. */
function toStockUnits(qty: number, recipeUnit: string | null, metric: string | null): number | null {
    const baseUnit = metric || 'Units';
    const unit = recipeUnit || 'Units';
    if (baseUnit.toLowerCase() === 'units' || unit.toLowerCase() === 'units') return qty;
    const factor = getConversionFactor(baseUnit, unit);
    return factor ? qty / factor : null;
}

/**
 * Split a wanted amount across the stock buckets: thawing first, then frozen
 * (total stock is frozen + thawing everywhere it is read). An ingredient that
 * may not go negative stops at zero; the shortfall is "clamped".
 */
function takeFromStock(stock: Stock, want: number, allowNegative: boolean) {
    const fromThawing = Math.min(Math.max(stock.thawing, 0), want);
    const rest = want - fromThawing;
    const fromFrozen = allowNegative ? rest : Math.min(Math.max(stock.frozen, 0), rest);
    return { fromThawing: round4(fromThawing), fromFrozen: round4(fromFrozen), clamped: round4(rest - fromFrozen) };
}

type TargetLine = {
    selectionGuid: string;
    orderGuid: string;
    checkGuid: string;
    businessDate: string;
    posItemGuid: string;
    posDisplayName: string;
    menuItemId: string | null;
    qty: number;
    voided: boolean;
    approvalStatus: string | null;
    /** When the sale happened: opened, or a FUTURE order's promised time. */
    orderAt: Date | null;
    /** From the item mapping: how much of the app dish one unit is. */
    qtyMultiplier: number;
    /** Per one unit of the selection: mapped modifiers with their quantity. */
    modifiers: { menuItemModifierId: string; qty: number }[];
};

const validDate = (v: unknown): Date | null => {
    const d = v ? new Date(String(v)) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
};

export async function runToastConsumptionCore(
    businessDates: string[],
    options: ConsumptionOptions
): Promise<ConsumptionReport[]> {
    const baselineAt = options.baselineAt !== undefined
        ? options.baselineAt
        : (await prisma.posConsumptionBaseline.findUnique({ where: { source: PosSource.TOAST } }))?.baselineAt ?? null;
    const reports: ConsumptionReport[] = [];
    for (const date of businessDates) {
        reports.push(await runOneDay(date, options.dryRun, options.stock ?? true, baselineAt));
    }
    return reports;
}

async function runOneDay(date: string, dryRun: boolean, moveStock: boolean, baselineAt: Date | null): Promise<ConsumptionReport> {
    const report: ConsumptionReport = {
        date, lines: 0, applied: 0, reversed: 0, baselined: 0, baselineAt: baselineAt?.toISOString() ?? null,
        unmapped: [], unmappedModifiers: [], deductions: [], warnings: [], errors: []
    };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        report.skipped = 'Fecha no válida.';
        return report;
    }

    // ── Per-day lock (real runs only: a dry run writes nothing) ──
    let runId: string | null = null;
    if (!dryRun) {
        const busy = await prisma.posSyncRun.findFirst({
            where: {
                source: PosSource.TOAST, businessDate: dateColumn(date), finishedAt: null,
                startedAt: { gt: new Date(Date.now() - LOCK_STALE_MS) }
            }
        });
        if (busy) {
            report.skipped = 'Ya hay una sincronización en curso para este día.';
            return report;
        }
        runId = (await prisma.posSyncRun.create({ data: { source: PosSource.TOAST, businessDate: dateColumn(date) } })).id;
    }

    try {
        const [{ orders, truncated }, mappings] = await Promise.all([
            fetchToastOrders(date.replace(/-/g, '')),
            prisma.posItemMapping.findMany({ where: { source: PosSource.TOAST } })
        ]);
        if (truncated) {
            report.skipped = 'Toast devolvió más órdenes de las que se pueden leer. No se procesó el día.';
            return report;
        }
        const itemMap = new Map(mappings.filter(m => m.kind === 'ITEM').map(m => [m.posGuid, m]));
        const modMap = new Map(mappings.filter(m => m.kind === 'MODIFIER').map(m => [m.posGuid, m]));

        // ── Targets from Toast ──
        const targets = new Map<string, TargetLine>();
        const unmapped = new Map<string, { name: string; guid: string; qty: number }>();
        const unmappedMods = new Map<string, { name: string; parent: string; key: string; qty: number }>();

        for (const order of orders) {
            const orderVoid = !!(order?.voided || order?.deleted);
            // A scheduled order counts toward the day it is for, not the day it was placed.
            const promised = order?.promisedDate ?? order?.estimatedFulfillmentDate;
            const lineDate = order?.approvalStatus === 'FUTURE' && promised
                ? toastBusinessDateOf(new Date(promised))
                : (fromToastBusinessDate(order?.businessDate) ?? date);
            // The moment compared with the baseline: a scheduled order is
            // made at its promised time, so that is when it consumes.
            const orderAt = (order?.approvalStatus === 'FUTURE' ? validDate(promised) : null)
                ?? validDate(order?.openedDate) ?? validDate(order?.createdDate);

            for (const check of order?.checks ?? []) {
                const checkVoid = !!(check?.voided || check?.deleted);
                for (const sel of check?.selections ?? []) {
                    if (typeof sel?.guid !== 'string') continue;
                    const itemGuid = typeof sel?.item?.guid === 'string' ? sel.item.guid : '';
                    const name = String(sel?.displayName ?? '');
                    const qty = sel?.quantity ?? 1;
                    if (!Number.isInteger(qty) || qty < 0) {
                        report.errors.push({ selectionGuid: sel.guid, name, error: `Cantidad no entera (${qty}); la línea no se procesó.` });
                        continue;
                    }
                    const voided = orderVoid || checkVoid || !!sel?.voided;
                    const mapping = itemMap.get(itemGuid);
                    const menuItemId = mapping?.menuItemId ?? null;

                    const modifiers: TargetLine['modifiers'] = [];
                    const visit = (list: any[]) => {
                        for (const m of list ?? []) {
                            if (m?.voided) continue;
                            const mName = String(m?.displayName ?? '');
                            const baseKey = typeof m?.item?.guid === 'string' ? m.item.guid : fallbackModifierKey(m?.optionGroup?.guid, mName);
                            const key = modifierMappingKey(baseKey, itemGuid);
                            const mm = modMap.get(key);
                            const mQty = Number.isFinite(m?.quantity) ? m.quantity : 1;
                            if (mm?.menuItemModifierId) {
                                modifiers.push({ menuItemModifierId: mm.menuItemModifierId, qty: mQty });
                            } else if (isProteinModifier(mName) && !voided) {
                                const u = unmappedMods.get(key) ?? { name: mName, parent: name, key, qty: 0 };
                                u.qty += mQty * qty;
                                unmappedMods.set(key, u);
                            }
                            visit(m?.modifiers);
                        }
                    };
                    visit(sel?.modifiers);

                    if (!menuItemId && !voided) {
                        const u = unmapped.get(itemGuid) ?? { name, guid: itemGuid, qty: 0 };
                        u.qty += qty;
                        unmapped.set(itemGuid, u);
                    }

                    targets.set(sel.guid, {
                        selectionGuid: sel.guid,
                        orderGuid: String(order?.guid ?? ''),
                        checkGuid: String(check?.guid ?? ''),
                        businessDate: lineDate,
                        posItemGuid: itemGuid,
                        posDisplayName: name,
                        menuItemId,
                        qty,
                        voided,
                        approvalStatus: order?.approvalStatus ?? null,
                        orderAt,
                        qtyMultiplier: mapping?.menuItemId && Number.isFinite(mapping.qtyMultiplier) ? mapping.qtyMultiplier : 1,
                        modifiers
                    });
                }
            }
        }
        report.unmapped = [...unmapped.values()].sort((a, b) => b.qty - a.qty);
        report.unmappedModifiers = [...unmappedMods.values()].sort((a, b) => b.qty - a.qty);

        // ── What is already stored for this Toast day ──
        const stored = await prisma.posSalesLine.findMany({
            where: {
                source: PosSource.TOAST,
                OR: [{ posBusinessDate: dateColumn(date) }, { selectionGuid: { in: [...targets.keys()] } }]
            },
            include: { deductions: true }
        });
        const storedByGuid = new Map(stored.map(l => [l.selectionGuid, l]));
        // A line from this Toast day that Toast no longer returns is treated as voided.
        const missing = stored.filter(l => !targets.has(l.selectionGuid) && l.posBusinessDate.toISOString().slice(0, 10) === date);

        // ── Recipes and stock ──
        const menuItemIds = [...new Set([...targets.values()].map(t => t.menuItemId).filter((x): x is string => !!x))];
        const modifierIds = [...new Set([...targets.values()].flatMap(t => t.modifiers.map(m => m.menuItemModifierId)))];
        const [recipes, modRecipes] = await Promise.all([
            prisma.recipeIngredient.findMany({ where: { menuItemId: { in: menuItemIds } } }),
            prisma.modifierIngredient.findMany({ where: { modifierId: { in: modifierIds } } })
        ]);
        const ingredientIds = new Set<string>([
            ...recipes.map(r => r.ingredientId), ...modRecipes.map(r => r.ingredientId),
            ...stored.flatMap(l => l.deductions.map(d => d.ingredientId))
        ]);
        const ingredients = await prisma.ingredient.findMany({
            where: { id: { in: [...ingredientIds] } },
            select: { id: true, name: true, metric: true, allowNegativeStock: true, inventory: { select: { frozenQty: true, thawingQty: true } } }
        });
        const info = new Map<string, IngredientInfo>(ingredients.map(i => [i.id, {
            name: i.name, metric: i.metric || 'Units', allowNegativeStock: i.allowNegativeStock, hasInventory: !!i.inventory
        }]));
        // Dry run: simulated stock, so clamps compound across lines like a real run.
        const simStock = new Map<string, Stock>(ingredients.filter(i => i.inventory).map(i => [i.id, { frozen: i.inventory!.frozenQty, thawing: i.inventory!.thawingQty }]));
        const recipeBy = new Map<string, typeof recipes>();
        for (const r of recipes) recipeBy.set(r.menuItemId, [...(recipeBy.get(r.menuItemId) ?? []), r]);
        const modRecipeBy = new Map<string, typeof modRecipes>();
        for (const r of modRecipes) modRecipeBy.set(r.modifierId, [...(modRecipeBy.get(r.modifierId) ?? []), r]);

        const totals = new Map<string, { deducted: number; clamped: number; restored: number }>();
        const tally = (id: string, k: 'deducted' | 'clamped' | 'restored', v: number) => {
            const t = totals.get(id) ?? { deducted: 0, clamped: 0, restored: 0 };
            t[k] = round4(t[k] + v);
            totals.set(id, t);
        };
        const warnedNoInventory = new Set<string>();

        /** Per-unit wants for a first apply, from the current recipe and modifiers. */
        const firstApplyWants = (t: TargetLine): Want[] | string => {
            const wants: Want[] = [];
            for (const r of recipeBy.get(t.menuItemId ?? '') ?? []) {
                const ing = info.get(r.ingredientId);
                const q = toStockUnits(r.quantity, r.unit, ing?.metric ?? null);
                if (q == null) return `No se puede convertir ${r.unit} a ${ing?.metric} (${ing?.name ?? r.ingredientId}).`;
                wants.push({ ingredientId: r.ingredientId, qty: q, sourceKind: 'ITEM', menuItemModifierId: null });
            }
            for (const m of t.modifiers) {
                for (const r of modRecipeBy.get(m.menuItemModifierId) ?? []) {
                    const ing = info.get(r.ingredientId);
                    const q = toStockUnits(r.quantity, r.unit, ing?.metric ?? null);
                    if (q == null) return `No se puede convertir ${r.unit} a ${ing?.metric} (${ing?.name ?? r.ingredientId}).`;
                    wants.push({ ingredientId: r.ingredientId, qty: q * m.qty, sourceKind: 'MODIFIER', menuItemModifierId: m.menuItemModifierId });
                }
            }
            // One row per ingredient and source, scaled by the mapping's
            // multiplier (½ dozen consumes half the dozen dish).
            const merged = new Map<string, Want>();
            for (const w0 of wants) {
                const w = { ...w0, qty: w0.qty * t.qtyMultiplier };
                const k = `${w.ingredientId}|${w.sourceKind}|${w.menuItemModifierId ?? ''}`;
                const prev = merged.get(k);
                merged.set(k, prev ? { ...prev, qty: prev.qty + w.qty } : { ...w });
            }
            return [...merged.values()];
        };

        const work: { target: TargetLine | null; stored: (typeof stored)[number] | undefined }[] = [
            ...[...targets.values()].map(t => ({ target: t, stored: storedByGuid.get(t.selectionGuid) })),
            ...missing.map(l => ({ target: null, stored: l }))
        ];
        report.lines = work.length;
        const now = new Date();

        for (const { target, stored: line } of work) {
            const selectionGuid = target?.selectionGuid ?? line!.selectionGuid;
            const name = target?.posDisplayName ?? line!.posDisplayName;
            const applied = line?.appliedQty ?? 0;
            const want = target && !target.voided ? target.qty : 0;
            const delta = want - applied;
            const orderAt = target?.orderAt ?? line?.orderAt ?? null;
            // Before the counting point: the counted stock already reflects
            // this sale. It is recorded as consumed and never moves stock —
            // not now, and not on a later void either.
            const beforeBaseline = !!(baselineAt && orderAt && orderAt < baselineAt);
            const mayMove = moveStock && !beforeBaseline;

            try {
                // ── Plan the stock moves for this line ──
                type Move = { key: string; ingredientId: string; sourceKind: string; menuItemModifierId: string | null; addThaw: number; addFrozen: number; addClamped: number; existingId?: string };
                const moves: Move[] = [];

                if (delta > 0 && mayMove) {
                    let perUnit: Want[];
                    const existing = line?.deductions ?? [];
                    if (applied > 0 && existing.length > 0) {
                        // Fixed at first apply: reuse what each unit took then.
                        perUnit = existing.map(d => ({
                            ingredientId: d.ingredientId,
                            qty: (num(d.qtyDeducted) + num(d.qtyClamped)) / applied,
                            sourceKind: d.sourceKind as Want['sourceKind'],
                            menuItemModifierId: d.menuItemModifierId
                        }));
                    } else {
                        const w = firstApplyWants(target!);
                        if (typeof w === 'string') throw new Error(w);
                        perUnit = w;
                    }
                    for (const w of perUnit) {
                        const ing = info.get(w.ingredientId);
                        if (!ing?.hasInventory) {
                            if (!warnedNoInventory.has(w.ingredientId)) {
                                warnedNoInventory.add(w.ingredientId);
                                report.warnings.push(`${ing?.name ?? w.ingredientId} no tiene registro de inventario; no se descuenta.`);
                            }
                            continue;
                        }
                        const stock = simStock.get(w.ingredientId)!;
                        const take = takeFromStock(stock, round4(w.qty * delta), ing.allowNegativeStock);
                        stock.thawing = round4(stock.thawing - take.fromThawing);
                        stock.frozen = round4(stock.frozen - take.fromFrozen);
                        const existingRow = existing.find(d => d.ingredientId === w.ingredientId && d.sourceKind === w.sourceKind && (d.menuItemModifierId ?? null) === (w.menuItemModifierId ?? null));
                        moves.push({
                            key: `${w.ingredientId}|${w.sourceKind}|${w.menuItemModifierId ?? ''}`,
                            ingredientId: w.ingredientId, sourceKind: w.sourceKind, menuItemModifierId: w.menuItemModifierId,
                            addThaw: take.fromThawing, addFrozen: take.fromFrozen, addClamped: take.clamped, existingId: existingRow?.id
                        });
                    }
                } else if (delta < 0 && line && mayMove) {
                    // Reverse proportionally from what was recorded — never from the recipe.
                    const p = -delta / applied;
                    for (const d of line.deductions) {
                        const thaw = round4(num(d.qtyFromThawing) * p);
                        const frozen = round4((num(d.qtyDeducted) - num(d.qtyFromThawing)) * p);
                        const clamped = round4(num(d.qtyClamped) * p);
                        const stock = simStock.get(d.ingredientId);
                        if (stock) { stock.thawing = round4(stock.thawing + thaw); stock.frozen = round4(stock.frozen + frozen); }
                        moves.push({
                            key: d.id, ingredientId: d.ingredientId, sourceKind: d.sourceKind, menuItemModifierId: d.menuItemModifierId,
                            addThaw: -thaw, addFrozen: -frozen, addClamped: -clamped, existingId: d.id
                        });
                    }
                }

                for (const m of moves) {
                    if (delta > 0) {
                        tally(m.ingredientId, 'deducted', m.addThaw + m.addFrozen);
                        tally(m.ingredientId, 'clamped', m.addClamped);
                    } else {
                        tally(m.ingredientId, 'restored', -(m.addThaw + m.addFrozen));
                    }
                }
                // A line that took nothing stays unapplied, so mapping it or
                // giving it a recipe later still consumes it on a re-run.
                const consumes = delta > 0 && moves.length > 0;
                const newApplied = beforeBaseline ? want
                    : !moveStock ? applied
                    : delta < 0 ? want : consumes ? want : applied;
                if (beforeBaseline) report.baselined++;
                else if (moveStock) {
                    if (consumes) report.applied++;
                    if (delta < 0) report.reversed++;
                }

                if (dryRun) continue;

                // ── Write: line, stock, ledger and child rows together ──
                await prisma.$transaction(async tx => {
                    const lineData = {
                        orderGuid: target?.orderGuid ?? line!.orderGuid,
                        checkGuid: target?.checkGuid ?? line!.checkGuid,
                        businessDate: dateColumn(target?.businessDate ?? line!.businessDate.toISOString().slice(0, 10)),
                        posBusinessDate: dateColumn(target ? date : line!.posBusinessDate.toISOString().slice(0, 10)),
                        posItemGuid: target?.posItemGuid ?? line!.posItemGuid,
                        posDisplayName: name,
                        menuItemId: target ? target.menuItemId : line!.menuItemId,
                        qty: target?.qty ?? line!.qty,
                        voided: target ? target.voided : true,
                        approvalStatus: target?.approvalStatus ?? line!.approvalStatus,
                        orderAt,
                        appliedQty: newApplied,
                        lastRunAt: now,
                        ...(consumes && !line?.firstAppliedAt ? { firstAppliedAt: now } : {})
                    };
                    const saved = await tx.posSalesLine.upsert({
                        where: { selectionGuid },
                        create: { source: PosSource.TOAST, selectionGuid, ...lineData },
                        update: lineData,
                        select: { id: true }
                    });

                    for (const m of moves) {
                        const inv = await tx.inventory.findUnique({ where: { ingredientId: m.ingredientId } });
                        if (!inv) continue;
                        const thawing = round4(inv.thawingQty - m.addThaw);
                        const frozen = round4(inv.frozenQty - m.addFrozen);
                        await tx.inventory.update({ where: { ingredientId: m.ingredientId }, data: { thawingQty: thawing, frozenQty: frozen } });
                        // Same invariant prep completion keeps: the ingredient's
                        // unfrozen figure mirrors the thawing bucket.
                        await tx.ingredient.update({ where: { id: m.ingredientId }, data: { unfrozenQuantity: thawing } });

                        const moved = round4(m.addThaw + m.addFrozen);
                        const unit = info.get(m.ingredientId)?.metric ?? 'Units';
                        if (moved !== 0 || m.addClamped !== 0) {
                            await tx.inventoryTransaction.create({
                                data: {
                                    ingredientId: m.ingredientId,
                                    type: delta > 0 ? 'SALES_DEDUCT_TOAST' : 'SALES_REVERSAL_TOAST',
                                    qty: Math.abs(moved),
                                    note: `${delta > 0 ? 'Venta Toast' : 'Anulación Toast'}: ${Math.abs(delta)} x ${name}` +
                                        ` (Descongelado: ${-m.addThaw}, Congelado: ${-m.addFrozen}` +
                                        `${m.addClamped !== 0 ? `, sin stock: ${m.addClamped}` : ''}) [${selectionGuid}]`
                                }
                            });
                        }

                        if (m.existingId) {
                            await tx.posSalesDeduction.update({
                                where: { id: m.existingId },
                                data: {
                                    qtyDeducted: { increment: moved },
                                    qtyClamped: { increment: m.addClamped },
                                    qtyFromThawing: { increment: m.addThaw }
                                }
                            });
                        } else {
                            await tx.posSalesDeduction.create({
                                data: {
                                    lineId: saved.id, ingredientId: m.ingredientId,
                                    qtyDeducted: moved, qtyClamped: m.addClamped, qtyFromThawing: m.addThaw,
                                    unit, sourceKind: m.sourceKind, menuItemModifierId: m.menuItemModifierId
                                }
                            });
                        }
                    }
                });
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error(`Toast consumption failed for ${selectionGuid}:`, msg);
                report.errors.push({ selectionGuid, name, error: msg });
            }
        }

        report.deductions = [...totals.entries()].map(([id, t]) => ({
            ingredientId: id, ingredient: info.get(id)?.name ?? id, unit: info.get(id)?.metric ?? 'Units', ...t
        })).sort((a, b) => a.ingredient.localeCompare(b.ingredient));
        return report;
    } finally {
        if (runId) await prisma.posSyncRun.update({ where: { id: runId }, data: { finishedAt: new Date() } });
    }
}
