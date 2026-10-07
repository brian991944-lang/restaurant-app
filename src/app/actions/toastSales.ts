'use server';

import prisma from '@/lib/prisma';
import { PosSource } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { isAdminSession } from '@/lib/adminGuard';
import { nyWallToUtc } from '@/lib/businessDay';
import { runToastConsumptionCore, type ConsumptionReport } from '@/lib/pos/toastConsumption';
import { lastToastBusinessDates } from '@/lib/pos/toastBusinessDate';

/** The window a baseline pre-records, so no line from before it is missed. */
const BASELINE_WINDOW_DAYS = 3;

/** 'YYYY-MM-DDTHH:mm' in New York time → the UTC instant, or null if malformed. */
function parseNyLocal(value: string): Date | null {
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value ?? '');
    if (!m) return null;
    const hour = Number(m[2]), minute = Number(m[3]);
    if (hour > 23 || minute > 59) return null;
    return nyWallToUtc(m[1], hour, minute);
}

export type BaselineSummary = { baselineAt: string; before: number; after: number; days: { date: string; before: number; after: number }[] };

const summarize = (reports: ConsumptionReport[], at: Date): BaselineSummary => ({
    baselineAt: at.toISOString(),
    before: reports.reduce((s, r) => s + r.baselined, 0),
    after: reports.reduce((s, r) => s + (r.lines - r.baselined), 0),
    days: reports.map(r => ({ date: r.date, before: r.baselined, after: r.lines - r.baselined }))
});

/** The stored Toast counting point, if any. */
export async function getToastBaseline(): Promise<string | null> {
    const row = await prisma.posConsumptionBaseline.findUnique({ where: { source: PosSource.TOAST } });
    return row?.baselineAt.toISOString() ?? null;
}

/**
 * Preview of "Fijar punto de conteo": how many Toast lines in the last 3
 * business days fall before and after the given New York time. Writes nothing.
 */
export async function previewToastBaseline(nyLocal: string): Promise<{ success: boolean; error?: string; summary?: BaselineSummary }> {
    if (!(await isAdminSession())) return { success: false, error: 'Solo un administrador puede fijar el punto de conteo.' };
    const at = parseNyLocal(nyLocal);
    if (!at) return { success: false, error: 'La fecha y hora no son válidas.' };
    if (at.getTime() > Date.now() + 60_000) return { success: false, error: 'El punto de conteo no puede estar en el futuro.' };
    try {
        const reports = await runToastConsumptionCore(lastToastBusinessDates(BASELINE_WINDOW_DAYS), { dryRun: true, stock: false, baselineAt: at });
        const skipped = reports.find(r => r.skipped);
        if (skipped) return { success: false, error: `${skipped.date}: ${skipped.skipped}` };
        return { success: true, summary: summarize(reports, at) };
    } catch (e) {
        console.error('Baseline preview failed:', e instanceof Error ? e.message : e);
        return { success: false, error: 'No se pudo calcular el punto de conteo.' };
    }
}

/**
 * Fix the counting point. Saves it, then records every Toast line of the last
 * 3 business days: lines from before it are marked consumed at their full
 * quantity WITHOUT moving stock or writing InventoryTransactions; lines after
 * it are recorded unconsumed for the engine to take. The engine itself also
 * enforces the point, so a line it first sees later is treated the same way.
 */
export async function setToastBaseline(nyLocal: string): Promise<{ success: boolean; error?: string; summary?: BaselineSummary }> {
    if (!(await isAdminSession())) return { success: false, error: 'Solo un administrador puede fijar el punto de conteo.' };
    const at = parseNyLocal(nyLocal);
    if (!at) return { success: false, error: 'La fecha y hora no son válidas.' };
    if (at.getTime() > Date.now() + 60_000) return { success: false, error: 'El punto de conteo no puede estar en el futuro.' };
    try {
        await prisma.posConsumptionBaseline.upsert({
            where: { source: PosSource.TOAST },
            create: { source: PosSource.TOAST, baselineAt: at },
            update: { baselineAt: at }
        });
        const reports = await runToastConsumptionCore(lastToastBusinessDates(BASELINE_WINDOW_DAYS), { dryRun: false, stock: false, baselineAt: at });
        const problems = reports.filter(r => r.skipped || r.errors.length);
        revalidatePath('/[locale]/menu', 'page');
        revalidatePath('/[locale]/sales', 'page');
        if (problems.length) {
            return {
                success: false,
                error: `Punto de conteo guardado, pero hubo problemas: ${problems.map(r => r.skipped ?? `${r.errors.length} errores`).join('; ')}. Vuelve a confirmar para reintentar.`,
                summary: summarize(reports, at)
            };
        }
        return { success: true, summary: summarize(reports, at) };
    } catch (e) {
        console.error('Set baseline failed:', e instanceof Error ? e.message : e);
        return { success: false, error: 'No se pudo fijar el punto de conteo.' };
    }
}

/**
 * Consume inventory for Toast sales on the given business dates
 * ('YYYY-MM-DD'). dryRun computes the same report and writes nothing.
 *
 * Admin only: a real run moves stock. The nightly cron calls the core
 * directly, behind TOAST_CONSUMPTION_ENABLED.
 */
export async function runToastConsumption(
    businessDates: string[],
    { dryRun }: { dryRun: boolean }
): Promise<{ success: boolean; error?: string; reports?: ConsumptionReport[] }> {
    if (!(await isAdminSession())) return { success: false, error: 'Solo un administrador puede procesar ventas de Toast.' };
    try {
        const reports = await runToastConsumptionCore(businessDates, { dryRun });
        if (!dryRun) {
            revalidatePath('/[locale]/inventory', 'page');
            revalidatePath('/[locale]/sales', 'page');
        }
        return { success: true, reports };
    } catch (e) {
        console.error('Toast consumption failed:', e instanceof Error ? e.message : e);
        return { success: false, error: 'No se pudieron procesar las ventas de Toast.' };
    }
}
