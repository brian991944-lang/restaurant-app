'use server';

import prisma from '@/lib/prisma';
import { Prisma, type CajaBox, type CajaCorteTipo, type CajaFirmaRol } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { cloverFetch } from '@/lib/clover';
import { getBusinessDate, getBusinessDayWindowUtc } from '@/lib/businessDay';
import { formatMoney } from '@/lib/money';
import { TOLERANCIA_CENTS, nivelFor, isCashTender, type CajaNivel } from '@/lib/cajaRules';

/**
 * Caja: the two physical cash boxes of the Salón.
 *
 * BLANCA holds cash from accounts paid in cash (orders closed in Clover).
 * NEGRA holds cash from accounts still open in Clover. Both are counted at
 * APERTURA, at each RELEVO (staff handoff) and at CIERRE; every count is a
 * "corte", with one line per box and one or more drawn signatures.
 *
 * Esperado is computed here from Clover and SNAPSHOTTED on the corte — it is
 * never recomputed later, so a corte reads the same tomorrow as it did tonight.
 * Money is integer cents throughout (src/lib/money.ts); business dates are the
 * 'YYYY-MM-DD' strings of getBusinessDate(), as on ShiftRun.
 */

const CLOSING_LISTS_ROUTE = '/[locale]/closing-lists';

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

/** How many earlier business days are scanned for tabs left open. */
const PENDIENTES_DAYS = 2;

export type CajaEstado = 'SIN_APERTURA' | 'ABIERTA' | 'CERRADA';

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
    computedAt: Date;
    truncated: boolean;
};

/**
 * The Clover side of esperado for one business day, as of `now`.
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

    return {
        cashVentasCents, cashRefundsCents,
        abiertasCents, abiertasCount,
        pendientesCents, pendientesCount,
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
 * The day's cortes, anulados included (anuladoAt set), each firm line carrying
 * a derived nivel. Judged against the tolerance stored on its own corte, so
 * changing TOLERANCIA_CENTS later does not rewrite history.
 */
export async function getCajaDia(businessDate?: string) {
    const date = businessDate ?? getBusinessDate();
    if (!isBusinessDate(date)) throw new Error('Fecha inválida.');

    const rows = await loadCortes(date);
    const cortes = rows.map(c => ({
        ...c,
        lineas: c.lineas.map(l => ({
            ...l,
            nivel: (l.diffCents === null ? null : nivelFor(l.diffCents, c.toleranciaCents)) as CajaNivel | null,
        })),
    }));

    return { businessDate: date, cortes, estado: estadoOf(rows), toleranciaCents: TOLERANCIA_CENTS };
}

export type CajaEsperadoResult =
    | {
        success: true;
        blanca: { floatCents: number | null; cashVentasCents: number; cashRefundsCents: number; esperadoCents: number | null };
        negra: {
            floatCents: number | null; abiertasCents: number; abiertasCount: number;
            referenciaCents: number | null; pendientesCents: number; pendientesCount: number;
        };
        computedAt: Date;
        truncated: boolean;
    }
    | { success: false; error: string };

/**
 * What the boxes should hold right now, for the client to show beside the
 * count. Without a non-anulado APERTURA there is no float, so esperado and
 * referencia are null while the Clover figures still come back.
 */
export async function getCajaEsperado(businessDate?: string): Promise<CajaEsperadoResult> {
    const date = businessDate ?? getBusinessDate();
    if (!isBusinessDate(date)) return { success: false, error: 'Fecha inválida.' };

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
                    : floats.BLANCA + snap.cashVentasCents - snap.cashRefundsCents,
            },
            negra: {
                floatCents: floats.NEGRA,
                abiertasCents: snap.abiertasCents,
                abiertasCount: snap.abiertasCount,
                referenciaCents: floats.NEGRA === null ? null : floats.NEGRA + snap.abiertasCents,
                pendientesCents: snap.pendientesCents,
                pendientesCount: snap.pendientesCount,
            },
            computedAt: snap.computedAt,
            truncated: snap.truncated,
        };
    } catch (e) {
        console.error('Failed to compute caja esperado:', e);
        return {
            success: false,
            error: `No se pudo consultar Clover: ${e instanceof Error ? e.message : String(e)}`,
        };
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
function validateShape(input: CajaCorteInput): string | null {
    const boxes = input.lineas.map(l => l.caja);
    if (input.lineas.length !== 2 || !boxes.includes('BLANCA') || !boxes.includes('NEGRA')) {
        return 'Se requiere exactamente una línea por caja (Blanca y Negra).';
    }
    for (const l of input.lineas) {
        if (!Number.isInteger(l.contadoCents) || l.contadoCents < 0) {
            return `El contado de ${BOX_LABEL[l.caja]} debe ser un monto válido, cero o mayor.`;
        }
    }
    return null;
}

function validateFirmas(input: CajaCorteInput): string | null {
    const { tipo, firmas } = input;
    switch (tipo) {
        case 'APERTURA':
            if (firmas.length !== 1 || firmas[0].rol !== 'APERTURA') {
                return 'La apertura requiere exactamente una firma de quien abre.';
            }
            break;
        case 'RELEVO': {
            const saliente = firmas.filter(f => f.rol === 'SALIENTE');
            const entrante = firmas.filter(f => f.rol === 'ENTRANTE');
            if (firmas.length !== 2 || saliente.length !== 1 || entrante.length !== 1) {
                return 'El relevo requiere dos firmas: quien entrega y quien recibe.';
            }
            if (saliente[0].employeeId === entrante[0].employeeId) {
                return 'Quien entrega y quien recibe deben ser personas distintas.';
            }
            break;
        }
        case 'CIERRE':
            if (firmas.length < 1 || firmas.some(f => f.rol !== 'CIERRE')) {
                return 'El cierre requiere al menos una firma de cierre.';
            }
            break;
    }
    for (const f of firmas) {
        if (!f.employeeId?.trim() || !f.employeeName?.trim()) return 'Cada firma debe indicar quién firma.';
        if (!f.firmaPath?.trim() || !f.firmaBox?.trim()) return `Falta la firma de ${f.employeeName}.`;
    }
    return null;
}

/**
 * Record a corte. Validates, snapshots esperado from Clover (except at
 * APERTURA, which only sets the float) and writes header, lines and
 * signatures in one transaction.
 */
export async function createCajaCorte(
    input: CajaCorteInput
): Promise<{ success: boolean; corteId?: string; error?: string }> {
    try {
        const shapeError = validateShape(input);
        if (shapeError) return { success: false, error: shapeError };

        const businessDate = getBusinessDate();
        const existing = await loadCortes(businessDate);
        const estado = estadoOf(existing);

        if (input.tipo === 'APERTURA' && estado !== 'SIN_APERTURA') {
            return { success: false, error: 'La caja de hoy ya tiene apertura.' };
        }
        if (input.tipo !== 'APERTURA' && estado !== 'ABIERTA') {
            return {
                success: false,
                error: estado === 'SIN_APERTURA'
                    ? 'Primero registra la apertura de caja.'
                    : 'La caja de hoy ya está cerrada.',
            };
        }

        const firmasError = validateFirmas(input);
        if (firmasError) return { success: false, error: firmasError };

        if (input.tipo === 'CIERRE' && input.tabsConfirmadas !== true) {
            return { success: false, error: 'Confirma que solo quedan abiertas las mesas que pagaron en efectivo.' };
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
                return { success: false, error: 'La apertura de hoy no tiene el fondo de ambas cajas.' };
            }

            let snap: EsperadoSnapshot;
            try {
                snap = await computeEsperado(businessDate, new Date());
            } catch (e) {
                console.error('Failed to compute caja esperado:', e);
                return {
                    success: false,
                    error: `No se pudo consultar Clover: ${e instanceof Error ? e.message : String(e)}`,
                };
            }

            // BLANCA is firm at every corte.
            const blancaEsperado = floats.BLANCA + snap.cashVentasCents - snap.cashRefundsCents;
            const blancaDiff = blancaIn.contadoCents - blancaEsperado;

            // NEGRA is an estimate until CIERRE confirms the open tabs.
            const negraReferencia = floats.NEGRA + snap.abiertasCents;
            const negraFirm = input.tipo === 'CIERRE';
            const negraDiff = negraFirm ? negraIn.contadoCents - negraReferencia : null;

            const descuadres = [
                { caja: 'BLANCA' as CajaBox, diff: blancaDiff, motivo: motivoOf(blancaIn) },
                ...(negraDiff === null ? [] : [{ caja: 'NEGRA' as CajaBox, diff: negraDiff, motivo: motivoOf(negraIn) }]),
            ].filter(x => nivelFor(x.diff, TOLERANCIA_CENTS) === 'DESCUADRE' && !x.motivo);
            if (descuadres.length > 0) {
                const d = descuadres[0];
                return {
                    success: false,
                    error: `${BOX_LABEL[d.caja]} tiene un descuadre de ${formatMoney(d.diff)}. Indica el motivo.`,
                };
            }

            lineas = [
                {
                    caja: 'BLANCA', contadoCents: blancaIn.contadoCents,
                    esperadoCents: blancaEsperado, esEstimado: false, referenciaCents: null,
                    diffCents: blancaDiff, motivo: motivoOf(blancaIn),
                    floatCents: floats.BLANCA,
                    cashVentasCents: snap.cashVentasCents, cashRefundsCents: snap.cashRefundsCents,
                },
                {
                    caja: 'NEGRA', contadoCents: negraIn.contadoCents,
                    esperadoCents: negraFirm ? negraReferencia : null, esEstimado: !negraFirm,
                    referenciaCents: negraReferencia,
                    diffCents: negraDiff, motivo: motivoOf(negraIn),
                    floatCents: floats.NEGRA,
                    abiertasCents: snap.abiertasCents, abiertasCount: snap.abiertasCount,
                    pendientesCents: snap.pendientesCents, pendientesCount: snap.pendientesCount,
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

        revalidatePath(CLOSING_LISTS_ROUTE, 'page');
        return { success: true, corteId: created.id };
    } catch (e) {
        console.error('Failed to create caja corte:', e);
        return { success: false, error: 'No se pudo guardar el corte.' };
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
): Promise<{ success: boolean; error?: string }> {
    const trimmed = motivo.trim();
    if (!trimmed) return { success: false, error: 'Indica el motivo de la anulación.' };

    try {
        const corte = await prisma.cajaCorte.findUnique({ where: { id: corteId } });
        if (!corte) return { success: false, error: 'No se encontró el corte.' };
        if (corte.anuladoAt) return { success: false, error: 'Este corte ya fue anulado.' };

        const last = await prisma.cajaCorte.findFirst({
            where: { businessDate: corte.businessDate, anuladoAt: null },
            orderBy: { seq: 'desc' },
            select: { id: true },
        });
        if (last?.id !== corteId) {
            return { success: false, error: 'Solo se puede anular el último corte del día.' };
        }

        await prisma.cajaCorte.update({
            where: { id: corteId },
            data: { anuladoAt: new Date(), anuladoMotivo: trimmed },
        });

        revalidatePath(CLOSING_LISTS_ROUTE, 'page');
        return { success: true };
    } catch (e) {
        console.error('Failed to anular caja corte:', e);
        return { success: false, error: 'No se pudo anular el corte.' };
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
