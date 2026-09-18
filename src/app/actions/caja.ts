'use server';

import prisma from '@/lib/prisma';
import { Prisma, type CajaBox, type CajaCorteTipo, type CajaFirmaRol, type CajaMovimientoTipo } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { cloverFetch } from '@/lib/clover';
import { getBusinessDate, getBusinessDayWindowUtc } from '@/lib/businessDay';
import { formatMoney } from '@/lib/money';
import { isAdminSession } from '@/lib/adminGuard';
import { TOLERANCIA_CENTS, nivelFor, isCashTender, type CajaNivel } from '@/lib/cajaRules';

/**
 * Caja: the two physical cash boxes of the Salón.
 *
 * BLANCA holds cash from accounts paid in cash (orders closed in Clover).
 * NEGRA holds cash from accounts still open in Clover. Both are counted at
 * APERTURA, at each RELEVO (staff handoff) and at CIERRE; every count is a
 * "corte", with one line per box and one or more drawn signatures.
 *
 * Between counts, cash also leaves or enters a box on purpose — a withdrawal
 * by the owner, a store run, change brought in. Those are "movimientos", and
 * the ones recorded up to the moment a corte is judged are part of what the
 * box is expected to hold.
 *
 * Esperado is computed here from Clover and SNAPSHOTTED on the corte — it is
 * never recomputed later, so a corte reads the same tomorrow as it did tonight.
 * Money is integer cents throughout (src/lib/money.ts); business dates are the
 * 'YYYY-MM-DD' strings of getBusinessDate(), as on ShiftRun.
 */

const CAJA_ROUTE = '/[locale]/caja';

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

/** How many earlier business days are scanned for tabs left open. */
const PENDIENTES_DAYS = 2;

/** Longest range one history call will serve. */
const HISTORIAL_MAX_DAYS = 60;

export type CajaEstado = 'SIN_APERTURA' | 'ABIERTA' | 'CERRADA';

/**
 * Keys in the "Caja" message namespace, one per failure this file can
 * report. The UI shows t(errorKey) and falls back to `error`, which stays
 * the Spanish sentence the action always returned.
 */
export type CajaErrorKey =
    | 'err_invalid_date' | 'err_range_invalid' | 'err_range_too_long'
    | 'err_lines_shape' | 'err_count_invalid'
    | 'err_already_opened' | 'err_no_opening' | 'err_day_closed'
    | 'err_firma_apertura' | 'err_firma_relevo' | 'err_firma_distinct' | 'err_firma_cierre'
    | 'err_firma_who' | 'err_firma_missing'
    | 'err_confirm_tabs' | 'err_no_float' | 'err_clover' | 'err_descuadre_reason'
    | 'err_void_reason' | 'err_not_found' | 'err_already_voided' | 'err_void_only_last'
    | 'err_amount_invalid' | 'err_desc_required' | 'err_admin_only'
    | 'save_failed' | 'void_failed' | 'movement_save_failed';

type Fail = { success: false; error: string; errorKey: CajaErrorKey };
const fail = (errorKey: CajaErrorKey, error: string): Fail => ({ success: false, error, errorKey });

const isBusinessDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Clover sends money as integer cents. Anything else reads as zero rather than
 * poisoning a sum, and nothing here is ever held as a float.
 */
const centsOf = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;

/** Whole days added to a 'YYYY-MM-DD' string. Pure calendar math, no TZ. */
function shiftBusinessDate(businessDate: string, days: number): string {
    const [y, m, d] = businessDate.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + days));
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Calendar days from one 'YYYY-MM-DD' to another; negative when `to` is earlier. */
function daysBetween(from: string, to: string): number {
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

// ─── Clover ──────────────────────────────────────────────────────────────────

/**
 * A payment that actually moved money: not voided and, when Clover reports a
 * result, a successful one. A declined card attempt still appears on the
 * order and must not count as paid, or an open table would look settled.
 */
const isCountedPayment = (p: any): boolean =>
    p?.voided !== true && (p?.result === undefined || p?.result === 'SUCCESS');

/** Unpaid balance of an order: its total minus what has actually been paid. */
function balanceOf(order: any): number {
    const paid = ((order?.payments?.elements ?? []) as any[])
        .filter(isCountedPayment)
        .reduce((sum, p) => sum + centsOf(p?.amount), 0);
    return centsOf(order?.total) - paid;
}

const isOpenOrder = (order: any): boolean =>
    order?.paymentState === 'OPEN' || order?.paymentState === 'PARTIALLY_PAID';

/**
 * Every order created in [startMs, endMs], payments expanded with their tender
 * and refunds. The probe confirmed all three expansions populate on this
 * merchant. Pages are capped; `truncated` says whether the cap was hit.
 */
async function fetchOrdersInWindow(startMs: number, endMs: number): Promise<{ orders: any[]; truncated: boolean }> {
    const orders: any[] = [];
    let offset = 0;
    let pages = 0;
    while (true) {
        if (pages >= MAX_PAGES) return { orders, truncated: true };
        const data = await cloverFetch(
            `/orders?filter=createdTime>=${startMs}&filter=createdTime<=${endMs}` +
            `&expand=payments,payments.tender,payments.refunds&limit=${PAGE_SIZE}&offset=${offset}`
        );
        const page: any[] = data?.elements ?? [];
        orders.push(...page);
        pages++;
        if (page.length < PAGE_SIZE) return { orders, truncated: false };
        offset += PAGE_SIZE;
    }
}

// ─── Movements ───────────────────────────────────────────────────────────────

/**
 * Net cash moved into (+) or out of (−) each box by the day's live
 * movimientos recorded at or before `at`. INGRESO adds; RETIRO and COMPRA
 * subtract. The time bound is what keeps a saved corte honest: it was judged
 * against the movements that existed when it was judged, and a movement
 * recorded afterwards belongs to the next corte, not to it.
 */
async function netMovimientos(businessDate: string, at: Date): Promise<Record<CajaBox, number>> {
    const rows = await prisma.cajaMovimiento.findMany({
        where: { businessDate, anuladoAt: null, at: { lte: at } },
        select: { caja: true, tipo: true, amountCents: true },
    });
    const net: Record<CajaBox, number> = { BLANCA: 0, NEGRA: 0 };
    for (const m of rows) {
        net[m.caja] += m.tipo === 'INGRESO' ? m.amountCents : -m.amountCents;
    }
    return net;
}

type EsperadoSnapshot = {
    /** Non-voided cash payments on today's orders, tips excluded. */
    cashVentasCents: number;
    /** Refunds issued against those cash payments. */
    cashRefundsCents: number;
    /** Unpaid balance of today's orders still OPEN / PARTIALLY_PAID. */
    abiertasCents: number;
    abiertasCount: number;
    /** Same, for orders created in the previous business days. */
    pendientesCents: number;
    pendientesCount: number;
    /** Net movimientos per box as of computedAt (see netMovimientos). */
    movimientos: Record<CajaBox, number>;
    computedAt: Date;
    truncated: boolean;
};

/**
 * The Clover side of esperado for one business day, as of `now`, plus the
 * movimientos net as of the same instant.
 *
 * Attribution is by order createdTime inside the business-day window, not by
 * payment time: a table opened tonight and paid at 1 AM belongs to tonight.
 * Cash tips are not part of it — payment.amount excludes tipAmount, and the
 * tips do not go into the boxes.
 *
 * Throws on any Clover failure; exported callers turn that into an error
 * result. A total short by one page is wrong, and wrong is worse than absent
 * for a figure someone is asked to sign against.
 */
async function computeEsperado(businessDate: string, now: Date): Promise<EsperadoSnapshot> {
    // Tender map for a payment whose own tender did not expand.
    const tenderById = new Map<string, { label?: string; labelKey?: string }>();
    const tenderData = await cloverFetch('/tenders?limit=100');
    for (const t of tenderData?.elements ?? []) {
        if (t?.id) tenderById.set(String(t.id), { label: t.label, labelKey: t.labelKey });
    }
    const isCashPayment = (p: any): boolean => {
        const own = p?.tender;
        if (own && (own.labelKey || own.label)) return isCashTender(own);
        return isCashTender(own?.id ? tenderById.get(String(own.id)) : undefined);
    };

    const window = getBusinessDayWindowUtc(businessDate);
    const endMs = Math.min(now.getTime(), window.end.getTime());
    const today = await fetchOrdersInWindow(window.start.getTime(), endMs);

    let cashVentasCents = 0;
    let cashRefundsCents = 0;
    let abiertasCents = 0;
    let abiertasCount = 0;
    for (const order of today.orders) {
        for (const p of (order?.payments?.elements ?? []) as any[]) {
            if (!isCountedPayment(p) || !isCashPayment(p)) continue;
            cashVentasCents += centsOf(p.amount);
            for (const r of (p?.refunds?.elements ?? []) as any[]) {
                cashRefundsCents += centsOf(r?.amount);
            }
        }
        if (isOpenOrder(order)) {
            const balance = balanceOf(order);
            if (balance > 0) {
                abiertasCents += balance;
                abiertasCount++;
            }
        }
    }

    // Tabs left open on earlier days are reported, never part of esperado.
    const oldest = getBusinessDayWindowUtc(shiftBusinessDate(businessDate, -PENDIENTES_DAYS));
    const newest = getBusinessDayWindowUtc(shiftBusinessDate(businessDate, -1));
    const previous = await fetchOrdersInWindow(oldest.start.getTime(), newest.end.getTime());

    let pendientesCents = 0;
    let pendientesCount = 0;
    for (const order of previous.orders) {
        if (!isOpenOrder(order)) continue;
        const balance = balanceOf(order);
        if (balance > 0) {
            pendientesCents += balance;
            pendientesCount++;
        }
    }

    const movimientos = await netMovimientos(businessDate, now);

    return {
        cashVentasCents, cashRefundsCents,
        abiertasCents, abiertasCount,
        pendientesCents, pendientesCount,
        movimientos,
        computedAt: now,
        truncated: today.truncated || previous.truncated,
    };
}

// ─── Day state ───────────────────────────────────────────────────────────────

const corteInclude = {
    lineas: { orderBy: { caja: 'asc' as const } },
    firmas: { orderBy: { signedAt: 'asc' as const } },
} satisfies Prisma.CajaCorteInclude;

type CorteRow = Prisma.CajaCorteGetPayload<{ include: typeof corteInclude }>;

async function loadCortes(businessDate: string): Promise<CorteRow[]> {
    return prisma.cajaCorte.findMany({
        where: { businessDate },
        include: corteInclude,
        orderBy: { seq: 'asc' },
    });
}

/** Every movimiento of the day, anulados included, oldest first. */
async function loadMovimientos(businessDate: string) {
    return prisma.cajaMovimiento.findMany({
        where: { businessDate },
        orderBy: { at: 'asc' },
    });
}

/** Anulados never count towards the state of the day. */
function estadoOf(cortes: CorteRow[]): CajaEstado {
    const active = cortes.filter(c => c.anuladoAt === null);
    if (!active.some(c => c.tipo === 'APERTURA')) return 'SIN_APERTURA';
    if (active.some(c => c.tipo === 'CIERRE')) return 'CERRADA';
    return 'ABIERTA';
}

/** The day's float per box: the contado of the non-anulado APERTURA. */
function floatsOf(cortes: CorteRow[]): { BLANCA: number | null; NEGRA: number | null } {
    const apertura = cortes.find(c => c.tipo === 'APERTURA' && c.anuladoAt === null);
    const of = (caja: CajaBox) => apertura?.lineas.find(l => l.caja === caja)?.contadoCents ?? null;
    return { BLANCA: of('BLANCA'), NEGRA: of('NEGRA') };
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/**
 * Each firm line judged against the tolerance stored on its own corte, so
 * changing TOLERANCIA_CENTS later does not rewrite history.
 */
function withNivel(rows: CorteRow[]) {
    return rows.map(c => ({
        ...c,
        lineas: c.lineas.map(l => ({
            ...l,
            nivel: (l.diffCents === null ? null : nivelFor(l.diffCents, c.toleranciaCents)) as CajaNivel | null,
        })),
    }));
}

/**
 * The day's cortes and movimientos, anulados included (anuladoAt set), each
 * firm corte line carrying a derived nivel.
 */
export async function getCajaDia(businessDate?: string) {
    const date = businessDate ?? getBusinessDate();
    if (!isBusinessDate(date)) throw new Error('Fecha inválida.');

    const [rows, movimientos] = await Promise.all([loadCortes(date), loadMovimientos(date)]);
    return {
        businessDate: date,
        cortes: withNivel(rows),
        movimientos,
        estado: estadoOf(rows),
        toleranciaCents: TOLERANCIA_CENTS,
    };
}

export type CajaHistorialResult =
    | {
        success: true;
        from: string;
        to: string;
        /** True when the caller is not admin and the range was cut down to yesterday. */
        limited: boolean;
        days: {
            businessDate: string;
            estado: CajaEstado;
            cortes: ReturnType<typeof withNivel>;
            movimientos: Awaited<ReturnType<typeof loadMovimientos>>;
        }[];
    }
    | Fail;

/**
 * Cortes and movimientos over a range of business days, newest day first;
 * days with neither are omitted. An admin may ask for any range up to
 * HISTORIAL_MAX_DAYS; anyone else is cut down to yesterday.
 *
 * The admin check is the same fusionista_admin cookie the payroll actions
 * trust. src/lib/adminGuard.ts is explicit that it is a client-set speed
 * bump, not hardened auth — it keeps a server from handing a floor tablet
 * sixty days of counts by accident, nothing more.
 */
export async function getCajaHistorial(opts: { from: string; to: string }): Promise<CajaHistorialResult> {
    let { from, to } = opts;
    if (!isBusinessDate(from) || !isBusinessDate(to)) return fail('err_invalid_date', 'Fecha inválida.');
    if (from > to) return fail('err_range_invalid', 'El rango de fechas es inválido.');
    if (daysBetween(from, to) + 1 > HISTORIAL_MAX_DAYS) {
        return fail('err_range_too_long', `El rango no puede superar ${HISTORIAL_MAX_DAYS} días.`);
    }

    let limited = false;
    if (!(await isAdminSession())) {
        limited = true;
        const yesterday = shiftBusinessDate(getBusinessDate(), -1);
        if (from > yesterday || to < yesterday) return { success: true, from, to, limited, days: [] };
        from = yesterday;
        to = yesterday;
    }

    const [rows, movs] = await Promise.all([
        prisma.cajaCorte.findMany({
            where: { businessDate: { gte: from, lte: to } },
            include: corteInclude,
            orderBy: [{ businessDate: 'desc' }, { seq: 'asc' }],
        }),
        prisma.cajaMovimiento.findMany({
            where: { businessDate: { gte: from, lte: to } },
            orderBy: { at: 'asc' },
        }),
    ]);

    const cortesByDay = new Map<string, CorteRow[]>();
    for (const row of rows) {
        const bucket = cortesByDay.get(row.businessDate);
        if (bucket) bucket.push(row);
        else cortesByDay.set(row.businessDate, [row]);
    }
    const movsByDay = new Map<string, typeof movs>();
    for (const m of movs) {
        const bucket = movsByDay.get(m.businessDate);
        if (bucket) bucket.push(m);
        else movsByDay.set(m.businessDate, [m]);
    }

    const dates = [...new Set([...cortesByDay.keys(), ...movsByDay.keys()])].sort().reverse();
    const days = dates.map(businessDate => {
        const cortes = cortesByDay.get(businessDate) ?? [];
        return {
            businessDate,
            estado: estadoOf(cortes),
            cortes: withNivel(cortes),
            movimientos: movsByDay.get(businessDate) ?? [],
        };
    });

    return { success: true, from, to, limited, days };
}

export type CajaEsperadoResult =
    | {
        success: true;
        blanca: { floatCents: number | null; cashVentasCents: number; cashRefundsCents: number; esperadoCents: number | null };
        negra: {
            floatCents: number | null; abiertasCents: number; abiertasCount: number;
            referenciaCents: number | null; pendientesCents: number; pendientesCount: number;
        };
        /** Net movimientos per box, already folded into esperado / referencia. */
        movimientos: Record<CajaBox, number>;
        computedAt: Date;
        truncated: boolean;
    }
    | Fail;

/**
 * What the boxes should hold right now, for the client to show beside the
 * count. Without a non-anulado APERTURA there is no float, so esperado and
 * referencia are null while the Clover figures still come back.
 */
export async function getCajaEsperado(businessDate?: string): Promise<CajaEsperadoResult> {
    const date = businessDate ?? getBusinessDate();
    if (!isBusinessDate(date)) return fail('err_invalid_date', 'Fecha inválida.');

    try {
        const floats = floatsOf(await loadCortes(date));
        const snap = await computeEsperado(date, new Date());
        return {
            success: true,
            blanca: {
                floatCents: floats.BLANCA,
                cashVentasCents: snap.cashVentasCents,
                cashRefundsCents: snap.cashRefundsCents,
                esperadoCents: floats.BLANCA === null
                    ? null
                    : floats.BLANCA + snap.cashVentasCents - snap.cashRefundsCents + snap.movimientos.BLANCA,
            },
            negra: {
                floatCents: floats.NEGRA,
                abiertasCents: snap.abiertasCents,
                abiertasCount: snap.abiertasCount,
                referenciaCents: floats.NEGRA === null
                    ? null
                    : floats.NEGRA + snap.abiertasCents + snap.movimientos.NEGRA,
                pendientesCents: snap.pendientesCents,
                pendientesCount: snap.pendientesCount,
            },
            movimientos: snap.movimientos,
            computedAt: snap.computedAt,
            truncated: snap.truncated,
        };
    } catch (e) {
        console.error('Failed to compute caja esperado:', e);
        return fail('err_clover', `No se pudo consultar Clover: ${e instanceof Error ? e.message : String(e)}`);
    }
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export type CajaCorteInput = {
    tipo: CajaCorteTipo;
    lineas: { caja: CajaBox; contadoCents: number; motivo?: string }[];
    firmas: { rol: CajaFirmaRol; employeeId: string; employeeName: string; firmaPath: string; firmaBox: string }[];
    tabsConfirmadas?: boolean;
    notas?: string;
};

const BOX_LABEL: Record<CajaBox, string> = { BLANCA: 'Caja Blanca', NEGRA: 'Caja Negra' };

/** The first problem with the input that does not need the database. */
function validateShape(input: CajaCorteInput): Fail | null {
    const boxes = input.lineas.map(l => l.caja);
    if (input.lineas.length !== 2 || !boxes.includes('BLANCA') || !boxes.includes('NEGRA')) {
        return fail('err_lines_shape', 'Se requiere exactamente una línea por caja (Blanca y Negra).');
    }
    for (const l of input.lineas) {
        if (!Number.isInteger(l.contadoCents) || l.contadoCents < 0) {
            return fail('err_count_invalid', `El contado de ${BOX_LABEL[l.caja]} debe ser un monto válido, cero o mayor.`);
        }
    }
    return null;
}

function validateFirmas(input: CajaCorteInput): Fail | null {
    const { tipo, firmas } = input;
    switch (tipo) {
        case 'APERTURA':
            if (firmas.length !== 1 || firmas[0].rol !== 'APERTURA') {
                return fail('err_firma_apertura', 'La apertura requiere exactamente una firma de quien abre.');
            }
            break;
        case 'RELEVO': {
            const saliente = firmas.filter(f => f.rol === 'SALIENTE');
            const entrante = firmas.filter(f => f.rol === 'ENTRANTE');
            if (firmas.length !== 2 || saliente.length !== 1 || entrante.length !== 1) {
                return fail('err_firma_relevo', 'El relevo requiere dos firmas: quien entrega y quien recibe.');
            }
            if (saliente[0].employeeId === entrante[0].employeeId) {
                return fail('err_firma_distinct', 'Quien entrega y quien recibe deben ser personas distintas.');
            }
            break;
        }
        case 'CIERRE':
            if (firmas.length < 1 || firmas.some(f => f.rol !== 'CIERRE')) {
                return fail('err_firma_cierre', 'El cierre requiere al menos una firma de cierre.');
            }
            break;
    }
    for (const f of firmas) {
        if (!f.employeeId?.trim() || !f.employeeName?.trim()) return fail('err_firma_who', 'Cada firma debe indicar quién firma.');
        if (!f.firmaPath?.trim() || !f.firmaBox?.trim()) return fail('err_firma_missing', `Falta la firma de ${f.employeeName}.`);
    }
    return null;
}

/**
 * Record a corte. Validates, snapshots esperado from Clover and the
 * movimientos net (except at APERTURA, which only sets the float) and writes
 * header, lines and signatures in one transaction.
 */
export async function createCajaCorte(
    input: CajaCorteInput
): Promise<{ success: boolean; corteId?: string; error?: string; errorKey?: CajaErrorKey }> {
    try {
        const shapeError = validateShape(input);
        if (shapeError) return shapeError;

        const businessDate = getBusinessDate();
        const existing = await loadCortes(businessDate);
        const estado = estadoOf(existing);

        if (input.tipo === 'APERTURA' && estado !== 'SIN_APERTURA') {
            return fail('err_already_opened', 'La caja de hoy ya tiene apertura.');
        }
        if (input.tipo !== 'APERTURA' && estado !== 'ABIERTA') {
            return estado === 'SIN_APERTURA'
                ? fail('err_no_opening', 'Primero registra la apertura de caja.')
                : fail('err_day_closed', 'La caja de hoy ya está cerrada.');
        }

        const firmasError = validateFirmas(input);
        if (firmasError) return firmasError;

        if (input.tipo === 'CIERRE' && input.tabsConfirmadas !== true) {
            return fail('err_confirm_tabs', 'Confirma que solo quedan abiertas las mesas que pagaron en efectivo.');
        }

        const blancaIn = input.lineas.find(l => l.caja === 'BLANCA')!;
        const negraIn = input.lineas.find(l => l.caja === 'NEGRA')!;
        const motivoOf = (l: { motivo?: string }) => l.motivo?.trim() || null;

        let lineas: Prisma.CajaCorteLineaCreateWithoutCorteInput[];
        let header: Pick<Prisma.CajaCorteCreateInput, 'esperadoCalcAt' | 'deltaTurnoCents' | 'totalDiffCents' | 'posibleTraslado'>;

        if (input.tipo === 'APERTURA') {
            // The float. Nothing to compare against, so no Clover call.
            lineas = [blancaIn, negraIn].map(l => ({
                caja: l.caja, contadoCents: l.contadoCents, motivo: motivoOf(l),
            }));
            header = { esperadoCalcAt: null, deltaTurnoCents: null, totalDiffCents: null, posibleTraslado: false };
        } else {
            const floats = floatsOf(existing);
            if (floats.BLANCA === null || floats.NEGRA === null) {
                return fail('err_no_float', 'La apertura de hoy no tiene el fondo de ambas cajas.');
            }

            let snap: EsperadoSnapshot;
            try {
                snap = await computeEsperado(businessDate, new Date());
            } catch (e) {
                console.error('Failed to compute caja esperado:', e);
                return fail('err_clover', `No se pudo consultar Clover: ${e instanceof Error ? e.message : String(e)}`);
            }

            // BLANCA is firm at every corte. The movimientos net is the one
            // taken at snap.computedAt, and is written on the line beside it.
            const blancaEsperado = floats.BLANCA + snap.cashVentasCents - snap.cashRefundsCents + snap.movimientos.BLANCA;
            const blancaDiff = blancaIn.contadoCents - blancaEsperado;

            // NEGRA is an estimate until CIERRE confirms the open tabs.
            const negraReferencia = floats.NEGRA + snap.abiertasCents + snap.movimientos.NEGRA;
            const negraFirm = input.tipo === 'CIERRE';
            const negraDiff = negraFirm ? negraIn.contadoCents - negraReferencia : null;

            const descuadres = [
                { caja: 'BLANCA' as CajaBox, diff: blancaDiff, motivo: motivoOf(blancaIn) },
                ...(negraDiff === null ? [] : [{ caja: 'NEGRA' as CajaBox, diff: negraDiff, motivo: motivoOf(negraIn) }]),
            ].filter(x => nivelFor(x.diff, TOLERANCIA_CENTS) === 'DESCUADRE' && !x.motivo);
            if (descuadres.length > 0) {
                const d = descuadres[0];
                return fail('err_descuadre_reason', `${BOX_LABEL[d.caja]} tiene un descuadre de ${formatMoney(d.diff)}. Indica el motivo.`);
            }

            lineas = [
                {
                    caja: 'BLANCA', contadoCents: blancaIn.contadoCents,
                    esperadoCents: blancaEsperado, esEstimado: false, referenciaCents: null,
                    diffCents: blancaDiff, motivo: motivoOf(blancaIn),
                    floatCents: floats.BLANCA,
                    cashVentasCents: snap.cashVentasCents, cashRefundsCents: snap.cashRefundsCents,
                    movimientosCents: snap.movimientos.BLANCA,
                },
                {
                    caja: 'NEGRA', contadoCents: negraIn.contadoCents,
                    esperadoCents: negraFirm ? negraReferencia : null, esEstimado: !negraFirm,
                    referenciaCents: negraReferencia,
                    diffCents: negraDiff, motivo: motivoOf(negraIn),
                    floatCents: floats.NEGRA,
                    abiertasCents: snap.abiertasCents, abiertasCount: snap.abiertasCount,
                    pendientesCents: snap.pendientesCents, pendientesCount: snap.pendientesCount,
                    movimientosCents: snap.movimientos.NEGRA,
                },
            ];

            // Shift-over-shift movement of Blanca. The APERTURA has no diff of
            // its own — the float is by definition on target — so it counts as 0.
            const previous = existing.filter(c => c.anuladoAt === null).at(-1);
            const previousBlancaDiff = previous?.lineas.find(l => l.caja === 'BLANCA')?.diffCents ?? 0;

            const totalDiff = negraDiff === null ? null : blancaDiff + negraDiff;
            const posibleTraslado = totalDiff !== null
                && Math.abs(totalDiff) <= TOLERANCIA_CENTS
                && (nivelFor(blancaDiff) === 'DESCUADRE' || nivelFor(negraDiff!) === 'DESCUADRE');

            header = {
                esperadoCalcAt: snap.computedAt,
                deltaTurnoCents: blancaDiff - previousBlancaDiff,
                totalDiffCents: totalDiff,
                posibleTraslado,
            };
        }

        const firmas: Prisma.CajaFirmaCreateWithoutCorteInput[] = input.firmas.map(f => ({
            rol: f.rol,
            employeeId: f.employeeId.trim(),
            employeeName: f.employeeName.trim(),
            firmaPath: f.firmaPath,
            firmaBox: f.firmaBox.trim(),
        }));

        const write = () => prisma.$transaction(async tx => {
            // seq counts anulados too, so a voided corte keeps its number.
            const count = await tx.cajaCorte.count({ where: { businessDate } });
            return tx.cajaCorte.create({
                data: {
                    businessDate,
                    seq: count + 1,
                    tipo: input.tipo,
                    toleranciaCents: TOLERANCIA_CENTS,
                    tabsConfirmadas: input.tabsConfirmadas === true,
                    notas: input.notas?.trim() || null,
                    ...header,
                    lineas: { create: lineas },
                    firmas: { create: firmas },
                },
                select: { id: true },
            });
        });

        let created: { id: string };
        try {
            created = await write();
        } catch (e) {
            // Two tablets closing at once: the second one lost the seq race.
            const isSeqClash = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
            if (!isSeqClash) throw e;
            created = await write();
        }

        revalidatePath(CAJA_ROUTE, 'page');
        return { success: true, corteId: created.id };
    } catch (e) {
        console.error('Failed to create caja corte:', e);
        return fail('save_failed', 'No se pudo guardar el corte.');
    }
}

/**
 * Void a corte. Nothing is deleted — lines and signatures stay for the audit,
 * anuladoAt marks it. Only the last live corte of its day can be voided, so the
 * sequence of firm diffs behind deltaTurno is never broken in the middle.
 */
export async function anularCorte(
    corteId: string,
    motivo: string
): Promise<{ success: boolean; error?: string; errorKey?: CajaErrorKey }> {
    const trimmed = motivo.trim();
    if (!trimmed) return fail('err_void_reason', 'Indica el motivo de la anulación.');

    try {
        const corte = await prisma.cajaCorte.findUnique({ where: { id: corteId } });
        if (!corte) return fail('err_not_found', 'No se encontró el corte.');
        if (corte.anuladoAt) return fail('err_already_voided', 'Este corte ya fue anulado.');

        const last = await prisma.cajaCorte.findFirst({
            where: { businessDate: corte.businessDate, anuladoAt: null },
            orderBy: { seq: 'desc' },
            select: { id: true },
        });
        if (last?.id !== corteId) {
            return fail('err_void_only_last', 'Solo se puede anular el último corte del día.');
        }

        await prisma.cajaCorte.update({
            where: { id: corteId },
            data: { anuladoAt: new Date(), anuladoMotivo: trimmed },
        });

        revalidatePath(CAJA_ROUTE, 'page');
        return { success: true };
    } catch (e) {
        console.error('Failed to anular caja corte:', e);
        return fail('void_failed', 'No se pudo anular el corte.');
    }
}

export type CajaMovimientoInput = {
    caja: CajaBox;
    tipo: CajaMovimientoTipo;
    amountCents: number;
    descripcion: string;
    employeeId: string;
    employeeName: string;
    firmaPath: string;
    firmaBox: string;
};

/**
 * Record cash leaving or entering a box between counts. RETIRO is the owner
 * taking money out and needs the admin cookie; COMPRA and INGRESO are for any
 * member of staff. The day must be open: before the APERTURA there is no box
 * to take from, and after the CIERRE the day is settled — void the closing
 * first if something still has to be recorded.
 */
export async function createCajaMovimiento(
    input: CajaMovimientoInput
): Promise<{ success: boolean; movimientoId?: string; error?: string; errorKey?: CajaErrorKey }> {
    try {
        if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
            return fail('err_amount_invalid', 'El monto debe ser mayor que cero.');
        }
        const descripcion = input.descripcion?.trim() ?? '';
        if (!descripcion) return fail('err_desc_required', 'Indica una descripción.');
        if (!input.employeeId?.trim() || !input.employeeName?.trim()) {
            return fail('err_firma_who', 'Cada firma debe indicar quién firma.');
        }
        if (!input.firmaPath?.trim() || !input.firmaBox?.trim()) {
            return fail('err_firma_missing', `Falta la firma de ${input.employeeName}.`);
        }
        if (input.tipo === 'RETIRO' && !(await isAdminSession())) {
            return fail('err_admin_only', 'Solo un administrador puede registrar un retiro.');
        }

        const businessDate = getBusinessDate();
        const estado = estadoOf(await loadCortes(businessDate));
        if (estado === 'SIN_APERTURA') return fail('err_no_opening', 'Primero registra la apertura de caja.');
        if (estado === 'CERRADA') return fail('err_day_closed', 'La caja de hoy ya está cerrada.');

        const created = await prisma.cajaMovimiento.create({
            data: {
                businessDate,
                caja: input.caja,
                tipo: input.tipo,
                amountCents: input.amountCents,
                descripcion,
                employeeId: input.employeeId.trim(),
                employeeName: input.employeeName.trim(),
                firmaPath: input.firmaPath,
                firmaBox: input.firmaBox.trim(),
            },
            select: { id: true },
        });

        revalidatePath(CAJA_ROUTE, 'page');
        return { success: true, movimientoId: created.id };
    } catch (e) {
        console.error('Failed to create caja movimiento:', e);
        return fail('movement_save_failed', 'No se pudo guardar el movimiento.');
    }
}

/**
 * Void a movimiento. Admin only; nothing is deleted. This does NOT reach back
 * into any corte already saved: a corte's esperado and its movimientosCents
 * are a snapshot of what stood when it was judged, and voiding a movement
 * afterwards only changes what the NEXT corte will be judged against.
 */
export async function anularMovimiento(
    id: string,
    motivo: string
): Promise<{ success: boolean; error?: string; errorKey?: CajaErrorKey }> {
    const trimmed = motivo.trim();
    if (!trimmed) return fail('err_void_reason', 'Indica el motivo de la anulación.');

    try {
        if (!(await isAdminSession())) {
            return fail('err_admin_only', 'Solo un administrador puede anular un movimiento.');
        }
        const mov = await prisma.cajaMovimiento.findUnique({ where: { id } });
        if (!mov) return fail('err_not_found', 'No se encontró el movimiento.');
        if (mov.anuladoAt) return fail('err_already_voided', 'Este movimiento ya fue anulado.');

        await prisma.cajaMovimiento.update({
            where: { id },
            data: { anuladoAt: new Date(), anuladoMotivo: trimmed },
        });

        revalidatePath(CAJA_ROUTE, 'page');
        return { success: true };
    } catch (e) {
        console.error('Failed to anular caja movimiento:', e);
        return fail('void_failed', 'No se pudo anular el movimiento.');
    }
}

/** Records that the corte was shared. Best effort — a failure here never blocks the share. */
export async function marcarCajaCompartido(corteId: string): Promise<{ success: boolean }> {
    try {
        await prisma.cajaCorte.update({
            where: { id: corteId },
            data: { shareAttemptedAt: new Date() },
        });
        return { success: true };
    } catch (e) {
        console.error('Failed to mark caja corte as shared:', e);
        return { success: false };
    }
}
