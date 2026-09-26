// ONE-TIME BACKFILL — 2026-09-23 cash box counts (paper log), void the
// 2026-09-18 test count.
//
// Temporary script, deleted after use. Read-only by default; pass --write to
// actually insert/update. Run with:
//
//   node --env-file=.env scripts/backfill-0923.mjs           (dry run)
//   node --env-file=.env scripts/backfill-0923.mjs --write   (writes)
//
// DATABASE_URL, CLOVER_MERCHANT_ID and CLOVER_API_TOKEN are read from the
// environment only — this file never hardcodes or prints any of them.
//
// The Clover/business-day/nivel logic below is copied from
// src/app/actions/caja.ts, src/lib/businessDay.ts and src/lib/cajaRules.ts
// so this script has no dependency on the Next.js/TS build.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const WRITE = process.argv.includes('--write');

const BUSINESS_DATE = '2026-09-23';
const TEST_DATE = '2026-09-18';
const TOLERANCIA_CENTS = 200;

// ── Business-day math (copied from src/lib/businessDay.ts) ─────────────────

const NY_TZ = 'America/New_York';

function nyWallParts(instant) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: NY_TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    }).formatToParts(instant);
    const get = (type) => Number(parts.find(p => p.type === type)?.value);
    const rawHour = get('hour');
    return {
        year: get('year'), month: get('month'), day: get('day'),
        hour: rawHour === 24 ? 0 : rawHour, minute: get('minute'), second: get('second'),
    };
}

function pad(n) { return String(n).padStart(2, '0'); }
function ymd(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }

function addDays(dateStr, days) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + days));
    return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function nyWallToUtc(dateStr, hour, minute = 0) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const desired = Date.UTC(y, m - 1, d, hour, minute, 0);
    let guess = desired;
    for (let i = 0; i < 2; i++) {
        const wall = nyWallParts(new Date(guess));
        const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
        guess += desired - wallAsUtc;
    }
    return new Date(guess);
}

function getBusinessDayWindowUtc(businessDate) {
    const start = nyWallToUtc(businessDate, 5, 0);
    const nextCutover = nyWallToUtc(addDays(businessDate, 1), 5, 0);
    return { start, end: new Date(nextCutover.getTime() - 1) };
}

// ── Clover client (copied from src/lib/clover.ts) ───────────────────────────

function requireCloverEnv(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing ${name} in the environment.`);
    return value;
}

async function cloverFetch(path) {
    const merchantId = requireCloverEnv('CLOVER_MERCHANT_ID');
    const token = requireCloverEnv('CLOVER_API_TOKEN');
    const url = `https://api.clover.com/v3/merchants/${merchantId}${path}`;
    for (let attempt = 1; attempt <= 4; attempt++) {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
        if (res.status === 429) { await new Promise(r => setTimeout(r, attempt * 2000)); continue; }
        if (!res.ok) throw new Error(`Clover GET ${path} -> ${res.status}: ${await res.text()}`);
        return res.json();
    }
    throw new Error(`Clover ${path}: rate limited (429) after retries`);
}

// ── Esperado math (copied from src/app/actions/caja.ts / src/lib/cajaRules.ts) ──

function centsOf(v) { return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0; }

function isCashTender(t) {
    if (!t) return false;
    if (t.labelKey) return t.labelKey === 'com.clover.tender.cash';
    const label = t.label ?? '';
    return /cash|efectivo/i.test(label) && !/discount|descuento/i.test(label);
}

function isCountedPayment(p) { return p?.voided !== true && (p?.result === undefined || p?.result === 'SUCCESS'); }
function isOpenOrder(o) { return o?.paymentState === 'OPEN' || o?.paymentState === 'PARTIALLY_PAID'; }

function balanceOf(order) {
    const paid = (order?.payments?.elements ?? [])
        .filter(isCountedPayment)
        .reduce((sum, p) => sum + centsOf(p?.amount), 0);
    return centsOf(order?.total) - paid;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

async function fetchOrdersInWindow(startMs, endMs) {
    const orders = [];
    let offset = 0;
    let pages = 0;
    while (true) {
        if (pages >= MAX_PAGES) return { orders, truncated: true };
        const data = await cloverFetch(
            `/orders?filter=createdTime>=${startMs}&filter=createdTime<=${endMs}` +
            `&expand=payments,payments.tender,payments.refunds&limit=${PAGE_SIZE}&offset=${offset}`
        );
        const page = data?.elements ?? [];
        orders.push(...page);
        pages++;
        if (page.length < PAGE_SIZE) return { orders, truncated: false };
        offset += PAGE_SIZE;
    }
}

async function computeEsperadoFigures(businessDate) {
    const tenderById = new Map();
    const tenderData = await cloverFetch('/tenders?limit=100');
    for (const t of tenderData?.elements ?? []) {
        if (t?.id) tenderById.set(String(t.id), { label: t.label, labelKey: t.labelKey });
    }
    const isCashPayment = (p) => {
        const own = p?.tender;
        if (own && (own.labelKey || own.label)) return isCashTender(own);
        return isCashTender(own?.id ? tenderById.get(String(own.id)) : undefined);
    };

    const window = getBusinessDayWindowUtc(businessDate);
    const { orders, truncated } = await fetchOrdersInWindow(window.start.getTime(), window.end.getTime());

    let cashVentasCents = 0;
    let cashRefundsCents = 0;
    let abiertasCents = 0;
    let abiertasCount = 0;
    for (const order of orders) {
        for (const p of order?.payments?.elements ?? []) {
            if (!isCountedPayment(p) || !isCashPayment(p)) continue;
            cashVentasCents += centsOf(p.amount);
            for (const r of p?.refunds?.elements ?? []) cashRefundsCents += centsOf(r?.amount);
        }
        if (isOpenOrder(order)) {
            const balance = balanceOf(order);
            if (balance > 0) { abiertasCents += balance; abiertasCount++; }
        }
    }

    return { cashVentasCents, cashRefundsCents, abiertasCents, abiertasCount, truncated, window, orderCount: orders.length };
}

function nivelFor(diffCents, tol = TOLERANCIA_CENTS) {
    if (diffCents === 0) return 'OK';
    return Math.abs(diffCents) <= tol ? 'MENOR' : 'DESCUADRE';
}

// ── Employees ────────────────────────────────────────────────────────────────

/** Wait Staff whose first name (nickname or name) matches, case-insensitive. */
async function findWaitStaffByFirstName(firstName) {
    const data = await cloverFetch('/employees?limit=100&expand=roles');
    const employees = data?.elements ?? [];
    const isWaitStaff = (emp) =>
        (emp?.roles?.elements ?? []).some(
            (r) => typeof r?.name === 'string' && r.name.trim().toLowerCase() === 'wait staff'
        );
    return employees
        .filter(isWaitStaff)
        .map((emp) => ({ id: String(emp?.id ?? ''), name: String(emp?.nickname || emp?.name || '') }))
        .filter((emp) => (emp.name.trim().split(/\s+/)[0] ?? '').toLowerCase() === firstName.toLowerCase());
}

// ── Main ─────────────────────────────────────────────────────────────────────

function stop(message) {
    console.error(`\nSTOP: ${message}\n`);
    process.exitCode = 1;
    return true;
}

async function main() {
    console.log(`Mode: ${WRITE ? 'WRITE' : 'DRY RUN (pass --write to apply)'}`);
    console.log('='.repeat(70));

    // ── 1a. Existing rows ───────────────────────────────────────────────────
    const [cortes0923, movs0923, cortes0918, movs0918] = await Promise.all([
        prisma.cajaCorte.findMany({ where: { businessDate: BUSINESS_DATE }, include: { lineas: true, firmas: true }, orderBy: { seq: 'asc' } }),
        prisma.cajaMovimiento.findMany({ where: { businessDate: BUSINESS_DATE } }),
        prisma.cajaCorte.findMany({ where: { businessDate: TEST_DATE }, include: { lineas: true, firmas: true }, orderBy: { seq: 'asc' } }),
        prisma.cajaMovimiento.findMany({ where: { businessDate: TEST_DATE } }),
    ]);

    console.log(`\n--- Existing CajaCorte rows for ${BUSINESS_DATE} (${cortes0923.length}) ---`);
    console.dir(cortes0923, { depth: null });
    console.log(`\n--- Existing CajaMovimiento rows for ${BUSINESS_DATE} (${movs0923.length}) ---`);
    console.dir(movs0923, { depth: null });
    console.log(`\n--- Existing CajaCorte rows for ${TEST_DATE} (${cortes0918.length}) ---`);
    console.dir(cortes0918, { depth: null });
    console.log(`\n--- Existing CajaMovimiento rows for ${TEST_DATE} (${movs0918.length}) ---`);
    console.dir(movs0918, { depth: null });

    let stopped = false;
    if (cortes0923.length > 0) {
        stopped = stop(`${BUSINESS_DATE} already has ${cortes0923.length} corte(s). Not writing anything.`) || stopped;
    }
    if (movs0923.length > 0) {
        // Not in the literal instructions, but movimientosCents is hardcoded to
        // 0 below on the assumption the day is otherwise empty — that would be
        // wrong if a movimiento already exists.
        stopped = stop(`${BUSINESS_DATE} already has ${movs0923.length} movimiento(s), which the planned CIERRE line's movimientosCents:0 does not account for.`) || stopped;
    }
    const activeTest = cortes0918.filter((c) => c.anuladoAt === null);
    if (activeTest.length !== 1) {
        stopped = stop(`Expected exactly one non-voided corte on ${TEST_DATE}, found ${activeTest.length}.`) || stopped;
    }
    if (stopped) {
        await prisma.$disconnect();
        return;
    }
    const testCorte = activeTest[0];

    // ── 1b. Clover figures ──────────────────────────────────────────────────
    console.log(`\n--- Clover figures for ${BUSINESS_DATE} business-day window ---`);
    const figures = await computeEsperadoFigures(BUSINESS_DATE);
    console.log({
        windowStartUtc: figures.window.start.toISOString(),
        windowEndUtc: figures.window.end.toISOString(),
        orderCount: figures.orderCount,
        cashVentasCents: figures.cashVentasCents,
        cashRefundsCents: figures.cashRefundsCents,
        abiertasCents: figures.abiertasCents,
        abiertasCount: figures.abiertasCount,
        truncated: figures.truncated,
    });
    if (figures.truncated) {
        stopped = stop('Clover order fetch was truncated (hit MAX_PAGES) — figures may be incomplete.') || stopped;
    }

    // ── 1c. Planned rows ────────────────────────────────────────────────────
    const BLANCA_FLOAT = 3464;   // $34.64
    const NEGRA_FLOAT = 19778;   // $197.78
    const BLANCA_CLOSE = 5236;   // $52.36
    const NEGRA_CLOSE = 73278;   // $732.78

    const blancaEsperado = BLANCA_FLOAT + figures.cashVentasCents - figures.cashRefundsCents;
    const blancaDiff = BLANCA_CLOSE - blancaEsperado;
    const blancaNivel = nivelFor(blancaDiff);

    const negraEsperado = NEGRA_FLOAT + figures.abiertasCents;
    const negraDiff = NEGRA_CLOSE - negraEsperado;
    const negraNivel = nivelFor(negraDiff);

    const totalDiff = blancaDiff + negraDiff;
    const posibleTraslado = Math.abs(totalDiff) <= TOLERANCIA_CENTS && (blancaNivel === 'DESCUADRE' || negraNivel === 'DESCUADRE');

    console.log('\n--- Planned rows ---');
    console.log('APERTURA (seq 1):', {
        BLANCA: { contadoCents: BLANCA_FLOAT }, NEGRA: { contadoCents: NEGRA_FLOAT },
        firma: 'Josh (rol APERTURA)',
    });
    console.log('CIERRE (seq 2):', {
        BLANCA: { contadoCents: BLANCA_CLOSE, esperadoCents: blancaEsperado, diffCents: blancaDiff, nivel: blancaNivel },
        NEGRA: { contadoCents: NEGRA_CLOSE, esperadoCents: negraEsperado, diffCents: negraDiff, nivel: negraNivel },
        totalDiffCents: totalDiff, posibleTraslado, deltaTurnoCents: blancaDiff,
        firmas: 'Josh + Alex (rol CIERRE)',
    });
    if (blancaNivel === 'DESCUADRE' || negraNivel === 'DESCUADRE') {
        console.log(`\n⚠ NOTE: at least one line lands on DESCUADRE (beyond the ${TOLERANCIA_CENTS}¢ tolerance). The live UI would require a reason before saving; this backfill writes no per-line motivo. Review before confirming --write.`);
    }

    // ── 1d. Employees ───────────────────────────────────────────────────────
    console.log('\n--- Employee resolution (Wait Staff, first-name match) ---');
    const joshMatches = await findWaitStaffByFirstName('Josh');
    const alexMatches = await findWaitStaffByFirstName('Alex');
    console.log('Josh matches:', joshMatches);
    console.log('Alex matches:', alexMatches);

    if (joshMatches.length !== 1) {
        stopped = stop(`"Josh" resolved to ${joshMatches.length} Wait Staff match(es); need exactly 1.`) || stopped;
    }
    if (alexMatches.length !== 1) {
        stopped = stop(`"Alex" resolved to ${alexMatches.length} Wait Staff match(es); need exactly 1.`) || stopped;
    }
    if (stopped) {
        await prisma.$disconnect();
        return;
    }
    const josh = joshMatches[0];
    const alex = alexMatches[0];

    if (!WRITE) {
        console.log('\n' + '='.repeat(70));
        console.log('Dry run complete. Nothing was written. Re-run with --write to apply.');
        await prisma.$disconnect();
        return;
    }

    // ── STEP 2 — write ──────────────────────────────────────────────────────
    const FIRMA_PATH = ''; // no drawn signature exists — this is a paper record
    const FIRMA_BOX = '600 200'; // matches SignaturePad's real viewBox dimensions
    const NOTAS = 'Registro retroactivo del cuaderno de papel. Firmas en papel.';
    const aperturaAt = nyWallToUtc(BUSINESS_DATE, 15, 0);
    const cierreAt = nyWallToUtc(addDays(BUSINESS_DATE, 1), 1, 0);

    console.log('\n--- Writing ---');
    const written = await prisma.$transaction(async (tx) => {
        const voided = await tx.cajaCorte.update({
            where: { id: testCorte.id },
            data: { anuladoAt: new Date(), anuladoMotivo: 'Prueba del sistema' },
        });

        const apertura = await tx.cajaCorte.create({
            data: {
                businessDate: BUSINESS_DATE, seq: 1, tipo: 'APERTURA', at: aperturaAt,
                toleranciaCents: TOLERANCIA_CENTS, tabsConfirmadas: false,
                esperadoCalcAt: null, totalDiffCents: null, deltaTurnoCents: null, posibleTraslado: false,
                notas: NOTAS,
                lineas: {
                    create: [
                        { caja: 'BLANCA', contadoCents: BLANCA_FLOAT, esperadoCents: null, esEstimado: false, referenciaCents: null, diffCents: null },
                        { caja: 'NEGRA', contadoCents: NEGRA_FLOAT, esperadoCents: null, esEstimado: false, referenciaCents: null, diffCents: null },
                    ],
                },
                firmas: {
                    create: [
                        { rol: 'APERTURA', employeeId: josh.id, employeeName: josh.name, firmaPath: FIRMA_PATH, firmaBox: FIRMA_BOX },
                    ],
                },
            },
            include: { lineas: true, firmas: true },
        });

        const cierre = await tx.cajaCorte.create({
            data: {
                businessDate: BUSINESS_DATE, seq: 2, tipo: 'CIERRE', at: cierreAt,
                toleranciaCents: TOLERANCIA_CENTS, tabsConfirmadas: true,
                esperadoCalcAt: new Date(), totalDiffCents: totalDiff, deltaTurnoCents: blancaDiff, posibleTraslado,
                notas: NOTAS,
                lineas: {
                    create: [
                        {
                            caja: 'BLANCA', contadoCents: BLANCA_CLOSE,
                            esperadoCents: blancaEsperado, esEstimado: false, referenciaCents: null,
                            diffCents: blancaDiff, floatCents: BLANCA_FLOAT,
                            cashVentasCents: figures.cashVentasCents, cashRefundsCents: figures.cashRefundsCents,
                            movimientosCents: 0,
                        },
                        {
                            caja: 'NEGRA', contadoCents: NEGRA_CLOSE,
                            esperadoCents: negraEsperado, esEstimado: false, referenciaCents: negraEsperado,
                            diffCents: negraDiff, floatCents: NEGRA_FLOAT,
                            abiertasCents: figures.abiertasCents, abiertasCount: figures.abiertasCount,
                            movimientosCents: 0,
                        },
                    ],
                },
                firmas: {
                    create: [
                        { rol: 'CIERRE', employeeId: josh.id, employeeName: josh.name, firmaPath: FIRMA_PATH, firmaBox: FIRMA_BOX },
                        { rol: 'CIERRE', employeeId: alex.id, employeeName: alex.name, firmaPath: FIRMA_PATH, firmaBox: FIRMA_BOX },
                    ],
                },
            },
            include: { lineas: true, firmas: true },
        });

        return { voided, apertura, cierre };
    });

    console.log('Voided 2026-09-18 corte:', written.voided.id);
    console.log('Apertura corte id:', written.apertura.id, '— lineas:', written.apertura.lineas.map((l) => l.id), '— firmas:', written.apertura.firmas.map((f) => f.id));
    console.log('Cierre corte id:', written.cierre.id, '— lineas:', written.cierre.lineas.map((l) => l.id), '— firmas:', written.cierre.firmas.map((f) => f.id));

    console.log('\n--- Re-read after write ---');
    const reread0923 = await prisma.cajaCorte.findMany({ where: { businessDate: BUSINESS_DATE }, include: { lineas: true, firmas: true }, orderBy: { seq: 'asc' } });
    const reread0918 = await prisma.cajaCorte.findMany({ where: { businessDate: TEST_DATE }, include: { lineas: true, firmas: true }, orderBy: { seq: 'asc' } });
    console.log(`\n${BUSINESS_DATE}:`); console.dir(reread0923, { depth: null });
    console.log(`\n${TEST_DATE}:`); console.dir(reread0918, { depth: null });

    await prisma.$disconnect();
}

main().catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exitCode = 1;
});
