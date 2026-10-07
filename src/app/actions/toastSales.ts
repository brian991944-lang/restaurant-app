'use server';

import { revalidatePath } from 'next/cache';
import { isAdminSession } from '@/lib/adminGuard';
import { runToastConsumptionCore, type ConsumptionReport } from '@/lib/pos/toastConsumption';

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
