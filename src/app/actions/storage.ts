'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { isAdminSession } from '@/lib/adminGuard';
import { computeCredit } from '@/lib/purchaseUnits';
import { restockSalonItem } from '@/app/actions/inventory';

// Almacén. Three places hold stock that is NOT yet in the kitchen:
//   HOME             — Brian's house            → StorageStock rows
//   BASEMENT_KITCHEN — the basement, kitchen side → StorageStock rows
//   BASEMENT_SALON   — the basement, salon side   → SalonStock.qtyBodega (already exists)
// Quantities are admin-only. Cooks only ever get a yes/no signal (see
// getInventarioOverview's `spare`), never a number from here.
//
// The one rule that matters: nothing in this file writes kitchen stock except
// moveStorage(... to: 'KITCHEN'), and that goes through the same computeCredit
// conversion Recibir uses, so "3 bolas · 27 lb" lands as 27 lb.

export type StorageLocation = 'HOME' | 'BASEMENT_KITCHEN';
export type MoveTarget = 'BASEMENT_KITCHEN' | 'KITCHEN';

const LOCATIONS: StorageLocation[] = ['HOME', 'BASEMENT_KITCHEN'];

type Fail = { success: false; error: string };
const fail = (error: string): Fail => ({ success: false, error });

const denied = () => fail('Solo administración.');

function revalidate() {
    revalidatePath('/[locale]/almacen', 'page');
    revalidatePath('/[locale]/inventory', 'page');
    revalidatePath('/[locale]/compras', 'page');
}

// ───────────────────────── read ─────────────────────────

export interface StorageRow {
    ingredientId: string;
    name: string;
    nameEs: string | null;
    category: string;
    categoryEs: string | null;
    metric: string;
    location: StorageLocation;
    qty: number;
    unit: string;
    totalWeightLb: number | null;
    /** True when this row can only be credited to the kitchen with a weight (e.g. "2 cajas" of a lb item) and carries none. */
    needsWeight: boolean;
    lastEntryAt: string | null; // newest movement INTO this location
}

export interface SalonBodegaRow {
    ingredientId: string;
    name: string;
    nameEs: string | null;
    salonGroup: string;
    qtyBodega: number;
    qtyFront: number;
    lastEntryAt: string | null;
}

export interface StorageMovementRow {
    id: string;
    ingredientId: string;
    name: string;
    nameEs: string | null;
    fromLocation: string;
    toLocation: string;
    qty: number;
    unit: string;
    byName: string | null;
    createdAt: string;
}

export async function getStorageOverview(): Promise<
    | { success: true; rows: StorageRow[]; salon: SalonBodegaRow[]; movements: StorageMovementRow[] }
    | Fail
> {
    if (!(await isAdminSession())) return denied();
    try {
        const [stocks, salon, movements, lastIn] = await Promise.all([
            prisma.storageStock.findMany({
                where: { qty: { gt: 0 } },
                include: { ingredient: { select: { name: true, nameEs: true, metric: true, isPacked: true, unitsPerPack: true, packUnit: true, category: { select: { name: true, nameEs: true } } } } },
                orderBy: { ingredient: { name: 'asc' } },
            }),
            prisma.salonStock.findMany({
                where: { ingredient: { isActive: true } },
                include: { ingredient: { select: { name: true, nameEs: true } } },
                orderBy: [{ salonGroup: 'asc' }, { ingredient: { name: 'asc' } }],
            }),
            prisma.storageMovement.findMany({
                orderBy: { createdAt: 'desc' },
                take: 40,
                include: { ingredient: { select: { name: true, nameEs: true } } },
            }),
            // newest movement into each (ingredient, location)
            prisma.storageMovement.groupBy({
                by: ['ingredientId', 'toLocation'],
                _max: { createdAt: true },
            }),
        ]);
        const lastInMap = new Map(lastIn.map(l => [`${l.ingredientId}|${l.toLocation}`, l._max.createdAt?.toISOString() ?? null]));

        const rows: StorageRow[] = stocks.map(s => ({
            ingredientId: s.ingredientId,
            name: s.ingredient.name,
            nameEs: s.ingredient.nameEs,
            category: s.ingredient.category.name,
            categoryEs: s.ingredient.category.nameEs,
            metric: s.ingredient.metric,
            location: s.location as StorageLocation,
            qty: s.qty,
            unit: s.unit,
            totalWeightLb: s.totalWeightLb,
            // Same conversion the move uses: if it fails without a weight, the panel asks for one.
            needsWeight: !(s.totalWeightLb != null && s.totalWeightLb > 0)
                && !computeCredit(s.ingredient, { qty: s.qty, unit: s.unit, totalWeightLb: null }).ok,
            lastEntryAt: lastInMap.get(`${s.ingredientId}|${s.location}`) ?? null,
        }));
        const salonRows: SalonBodegaRow[] = salon.map(s => ({
            ingredientId: s.ingredientId,
            name: s.ingredient.name,
            nameEs: s.ingredient.nameEs,
            salonGroup: s.salonGroup,
            qtyBodega: s.qtyBodega,
            qtyFront: s.qtyFront,
            lastEntryAt: lastInMap.get(`${s.ingredientId}|BASEMENT_SALON`) ?? null,
        }));
        const movementRows: StorageMovementRow[] = movements.map(m => ({
            id: m.id,
            ingredientId: m.ingredientId,
            name: m.ingredient.name,
            nameEs: m.ingredient.nameEs,
            fromLocation: m.fromLocation,
            toLocation: m.toLocation,
            qty: m.qty,
            unit: m.unit,
            byName: m.byName,
            createdAt: m.createdAt.toISOString(),
        }));
        return { success: true, rows, salon: salonRows, movements: movementRows };
    } catch (e: any) {
        console.error('Error loading storage overview:', e);
        return fail(e.message);
    }
}

/** Active RAW ingredients for the "Registrar entrada" picker. */
export async function getStorageIngredientOptions() {
    if (!(await isAdminSession())) return denied();
    const list = await prisma.ingredient.findMany({
        where: { type: 'RAW', isActive: true },
        select: { id: true, name: true, nameEs: true, metric: true, isPacked: true, packUnit: true },
        orderBy: { name: 'asc' },
    });
    return { success: true as const, list };
}

// ───────────────────────── write ─────────────────────────

/** Manual entry into HOME or BASEMENT_KITCHEN (things already sitting there). */
export async function addToStorage(input: {
    ingredientId: string; location: StorageLocation; qty: number; unit: string; totalWeightLb?: number | null; note?: string | null;
}) {
    if (!(await isAdminSession())) return denied();
    if (!LOCATIONS.includes(input.location)) return fail('Lugar inválido.');
    if (!(input.qty > 0)) return fail('La cantidad debe ser mayor que 0.');
    const unit = input.unit.trim();
    if (!unit) return fail('Falta la unidad.');
    try {
        await prisma.$transaction([
            prisma.storageStock.upsert({
                where: { ingredientId_location_unit: { ingredientId: input.ingredientId, location: input.location, unit } },
                create: { ingredientId: input.ingredientId, location: input.location, unit, qty: input.qty, totalWeightLb: input.totalWeightLb ?? null },
                update: { qty: { increment: input.qty }, ...(input.totalWeightLb ? { totalWeightLb: { increment: input.totalWeightLb } } : {}) },
            }),
            prisma.storageMovement.create({
                data: { ingredientId: input.ingredientId, fromLocation: 'MANUAL', toLocation: input.location, qty: input.qty, unit, totalWeightLb: input.totalWeightLb ?? null, note: input.note ?? null },
            }),
        ]);
        revalidate();
        return { success: true as const };
    } catch (e: any) {
        console.error('Error adding to storage:', e);
        return fail(e.message);
    }
}

/** Set the exact quantity of a storage row (a recount). Logs the delta as ADJUST. */
export async function adjustStorage(input: { ingredientId: string; location: StorageLocation; unit: string; qty: number; note?: string | null }) {
    if (!(await isAdminSession())) return denied();
    if (!(input.qty >= 0)) return fail('La cantidad no puede ser negativa.');
    try {
        const where = { ingredientId_location_unit: { ingredientId: input.ingredientId, location: input.location, unit: input.unit } };
        const row = await prisma.storageStock.findUnique({ where });
        const before = row?.qty ?? 0;
        const delta = input.qty - before;
        // Weight follows the count proportionally; a recount to 0 clears it.
        const weight = row?.totalWeightLb != null && before > 0 ? (row.totalWeightLb / before) * input.qty : row?.totalWeightLb ?? null;
        await prisma.$transaction([
            prisma.storageStock.upsert({
                where,
                create: { ingredientId: input.ingredientId, location: input.location, unit: input.unit, qty: input.qty, totalWeightLb: weight },
                update: { qty: input.qty, totalWeightLb: weight },
            }),
            prisma.storageMovement.create({
                data: { ingredientId: input.ingredientId, fromLocation: input.location, toLocation: 'ADJUST', qty: delta, unit: input.unit, note: input.note ?? null },
            }),
        ]);
        revalidate();
        return { success: true as const };
    } catch (e: any) {
        console.error('Error adjusting storage:', e);
        return fail(e.message);
    }
}

/**
 * Move from HOME or BASEMENT_KITCHEN to BASEMENT_KITCHEN or KITCHEN.
 * To KITCHEN credits Inventory.frozenQty through computeCredit — the same path
 * as Recibir — and logs an InventoryTransaction STORAGE_IN plus the movement.
 */
export async function moveStorage(input: {
    ingredientId: string; from: StorageLocation; to: MoveTarget; qty: number; unit: string; byName?: string | null;
    /** Weight of what is being moved; only used when the storage row carries no weight of its own. */
    totalWeightLb?: number | null;
}) {
    if (!(await isAdminSession())) return denied();
    if (!LOCATIONS.includes(input.from)) return fail('Origen inválido.');
    if (input.to !== 'BASEMENT_KITCHEN' && input.to !== 'KITCHEN') return fail('Destino inválido.');
    if (input.from === input.to) return fail('Origen y destino son el mismo lugar.');
    if (!(input.qty > 0)) return fail('La cantidad debe ser mayor que 0.');
    try {
        const where = { ingredientId_location_unit: { ingredientId: input.ingredientId, location: input.from, unit: input.unit } };
        const [row, ing] = await Promise.all([
            prisma.storageStock.findUnique({ where }),
            prisma.ingredient.findUnique({ where: { id: input.ingredientId }, select: { id: true, name: true, metric: true, isPacked: true, unitsPerPack: true, packUnit: true } }),
        ]);
        if (!ing) return fail('Ingrediente no encontrado.');
        if (!row || row.qty < input.qty) return fail(`No hay suficiente: hay ${row?.qty ?? 0} ${input.unit}.`);

        // The weight that travels with this many units: the row's own share when
        // it carries one, otherwise whatever was weighed at the door.
        const rowHasWeight = row.totalWeightLb != null && row.totalWeightLb > 0 && row.qty > 0;
        const share = rowHasWeight
            ? (row.totalWeightLb! / row.qty) * input.qty
            : input.totalWeightLb != null && input.totalWeightLb > 0 ? input.totalWeightLb : null;

        let credited: number | null = null;
        if (input.to === 'KITCHEN') {
            const c = computeCredit(ing, { qty: input.qty, unit: input.unit, totalWeightLb: share });
            if (!c.ok) return fail(c.error);
            credited = c.credited;
        }

        await prisma.$transaction(async tx => {
            await tx.storageStock.update({
                where,
                data: { qty: { decrement: input.qty }, ...(rowHasWeight && share != null ? { totalWeightLb: { decrement: share } } : {}) },
            });
            if (input.to === 'BASEMENT_KITCHEN') {
                await tx.storageStock.upsert({
                    where: { ingredientId_location_unit: { ingredientId: input.ingredientId, location: 'BASEMENT_KITCHEN', unit: input.unit } },
                    create: { ingredientId: input.ingredientId, location: 'BASEMENT_KITCHEN', unit: input.unit, qty: input.qty, totalWeightLb: share },
                    update: { qty: { increment: input.qty }, ...(share != null ? { totalWeightLb: { increment: share } } : {}) },
                });
            } else {
                await tx.inventory.upsert({
                    where: { ingredientId: input.ingredientId },
                    create: { ingredientId: input.ingredientId, frozenQty: credited!, thawingQty: 0 },
                    update: { frozenQty: { increment: credited! } },
                });
                await tx.inventoryTransaction.create({
                    data: { ingredientId: input.ingredientId, type: 'STORAGE_IN', qty: credited!, note: `Almacén ${input.from} → cocina: ${input.qty} ${input.unit}` },
                });
            }
            await tx.storageMovement.create({
                data: {
                    ingredientId: input.ingredientId, fromLocation: input.from, toLocation: input.to,
                    qty: input.qty, unit: input.unit, totalWeightLb: share, creditedMetric: credited, byName: input.byName ?? null,
                },
            });
            // rows at 0 are hidden by the overview's qty > 0 filter; no delete needed
        });
        revalidate();
        return { success: true as const, credited };
    } catch (e: any) {
        console.error('Error moving storage:', e);
        return fail(e.message);
    }
}

/** Sótano · Salón → barra. Same action the salon page uses; this just logs it in the Almacén too. */
export async function moveSalonBodegaToFront(ingredientId: string, quantity: number, byName?: string | null) {
    if (!(await isAdminSession())) return denied();
    const res = await restockSalonItem(ingredientId, quantity, null, byName ?? null);
    if (!res.success) return fail(res.error ?? 'No se pudo bajar a barra.');
    try {
        await prisma.storageMovement.create({
            data: { ingredientId, fromLocation: 'BASEMENT_SALON', toLocation: 'SALON_FRONT', qty: quantity, unit: 'unid.', byName: byName ?? null },
        });
    } catch (e) {
        console.error('Salon move saved but the Almacén log failed:', e);
    }
    revalidate();
    return { success: true as const };
}
