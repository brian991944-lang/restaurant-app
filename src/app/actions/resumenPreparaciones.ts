'use server';

import prisma from '@/lib/prisma';

const DUMMY_COOK_EMAIL = 'anycook@system.local';

export interface ResumenCook {
    id: string;
    name: string;
}

export interface ResumenTask {
    assignmentId: string;
    taskName: string;
    categoryName: string;
    esfuerzo: 'MANUAL' | 'HERVIDO';
    metric: string;
    unitLabel: string;
    portionsActual: number;
    portionsAssigned: number;
    cooks: ResumenCook[];
}

export interface ResumenPreparaciones {
    tasks: ResumenTask[];
    cooks: ResumenCook[];
    perCookCounts: Record<string, { manual: number; hervido: number }>;
    totals: { manualTasks: number; hervidoTasks: number };
}

/**
 * Read-only aggregation of completed prep tasks for the Dashboard
 * "Resumen de Preparaciones" report. No writes, no schema changes.
 *
 * Optional completedAt date range; if omitted, returns all completed tasks.
 * The return shape is stable so a date filter can be added later without
 * reshaping it.
 */
export async function getResumenPreparaciones(
    startDate?: Date | string,
    endDate?: Date | string
): Promise<ResumenPreparaciones> {
    try {
        // Optional completedAt filter. (GAP 6: finish-time is otherwise ignored —
        // we do not return it or compute throughput.)
        const where: any = { completed: true };
        if (startDate || endDate) {
            where.completedAt = {};
            if (startDate) where.completedAt.gte = new Date(startDate);
            if (endDate) where.completedAt.lte = new Date(endDate);
        }

        const assignments = await prisma.prepAssignment.findMany({
            where,
            include: {
                completedByCooks: { include: { user: true } },
                ingredient: { include: { category: true } },
                user: true, // legacy fallback only
            },
        });

        // GAP 5: resolve human-readable unit labels from DropdownOption (group 'Metric').
        // Map both name and nameEs to the display label so lookups succeed regardless
        // of which form Ingredient.metric happens to store.
        const metricOptions = await prisma.dropdownOption.findMany({
            where: { group: 'Metric' },
        });
        const metricLabelMap = new Map<string, string>();
        for (const opt of metricOptions) {
            const label = opt.nameEs || opt.name;
            metricLabelMap.set(opt.name, label);
            if (opt.nameEs) metricLabelMap.set(opt.nameEs, label);
        }

        const tasks: ResumenTask[] = [];
        const cooksMap = new Map<string, ResumenCook>(); // all distinct real cooks
        const perCookCounts: Record<string, { manual: number; hervido: number }> = {};
        let manualTasks = 0;
        let hervidoTasks = 0;

        for (const a of assignments) {
            // GAP 2 + 3: resolve cooks.
            // Primary source: the real completing cooks in the join table.
            let rawCooks: any[] = a.completedByCooks.map(c => c.user).filter(Boolean);

            // Legacy fallback: if none, fall back to the single assigned user
            // (mirrors prepSchedule.ts:193–195).
            if (rawCooks.length === 0 && a.user) {
                rawCooks = [a.user];
            }

            // Exclude the dummy 'Any Cook' in BOTH paths; dedupe by id.
            const seen = new Set<string>();
            const cooks: ResumenCook[] = [];
            for (const u of rawCooks) {
                if (!u) continue;
                if (u.email === DUMMY_COOK_EMAIL) continue;
                if (seen.has(u.id)) continue;
                seen.add(u.id);
                cooks.push({ id: u.id, name: u.name || 'Sin nombre' });
            }

            // GAP 4: split by esfuerzo (field only — no name/category heuristic).
            // 'HERVIDO' is boiling; everything else (incl. null/missing) is 'MANUAL'.
            const esfuerzo: 'MANUAL' | 'HERVIDO' =
                a.ingredient?.esfuerzo === 'HERVIDO' ? 'HERVIDO' : 'MANUAL';

            const metric = a.ingredient?.metric || '';
            const unitLabel = metricLabelMap.get(metric) || metric;

            const taskName = a.ingredient?.nameEs || a.ingredient?.name || 'Sin nombre';
            const categoryName =
                a.ingredient?.category?.nameEs || a.ingredient?.category?.name || 'Sin categoría';

            // GAP 1: quantity belongs to the TASK, once. Never split or duplicate per cook.
            // Null portionsActual → quantity 0, but the task is still included.
            const portionsActual = a.portionsActual ?? 0;
            const portionsAssigned = a.portionsAssigned ?? 0;

            tasks.push({
                assignmentId: a.id,
                taskName,
                categoryName,
                esfuerzo,
                metric,
                unitLabel,
                portionsActual,
                portionsAssigned,
                cooks,
            });

            // totals: DISTINCT task counts per esfuerzo.
            if (esfuerzo === 'HERVIDO') hervidoTasks++;
            else manualTasks++;

            // perCookCounts + distinct-cook registry: a shared task counts once for
            // EACH participant (so these can exceed totals — that is by design).
            for (const cook of cooks) {
                cooksMap.set(cook.id, cook);
                if (!perCookCounts[cook.id]) {
                    perCookCounts[cook.id] = { manual: 0, hervido: 0 };
                }
                if (esfuerzo === 'HERVIDO') perCookCounts[cook.id].hervido++;
                else perCookCounts[cook.id].manual++;
            }
        }

        return {
            tasks,
            cooks: Array.from(cooksMap.values()),
            perCookCounts,
            totals: { manualTasks, hervidoTasks },
        };
    } catch (e) {
        console.error('Failed to build resumen de preparaciones:', e);
        return {
            tasks: [],
            cooks: [],
            perCookCounts: {},
            totals: { manualTasks: 0, hervidoTasks: 0 },
        };
    }
}
