'use client';

import { useState, useMemo, Fragment } from 'react';
import { useTranslations, useLocale } from 'next-intl';

interface Cook { id: string; name: string; }
interface Task {
    assignmentId: string;
    taskName: string;
    categoryName: string;
    esfuerzo: 'MANUAL' | 'HERVIDO';
    metric: string;
    unitLabel: string;
    portionsActual: number;
    portionsAssigned: number;
    cooks: Cook[];
}
interface ResumenData {
    tasks: Task[];
    cooks: Cook[];
    perCookCounts: Record<string, { manual: number; hervido: number }>;
    totals: { manualTasks: number; hervidoTasks: number };
}

const MANUAL_COLOR = '#2a78d6';
const HERVIDO_COLOR = '#c98500';

export default function ResumenPreparaciones({ data }: { data: ResumenData }) {
    const locale = useLocale();
    const es = locale === 'es';
    const tOptions = useTranslations('Options');
    const [selectedCook, setSelectedCook] = useState('todos');

    // Spanish collation everywhere (accents / ñ order correctly).
    const byText = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' });

    // Resolve unit label the same way getOptName does on the inventory page:
    // translate the raw metric via the Options namespace; fall back to the raw
    // string on a missing key. (Do NOT use the server-provided unitLabel.)
    const resolveUnit = (metric: string) => {
        if (!metric) return metric;
        try {
            const translated = tOptions(metric as any);
            if (translated && translated.includes('Options.')) return metric;
            return translated || metric;
        } catch { return metric; }
    };

    const sortedCooks = useMemo(
        () => [...data.cooks].sort((a, b) => byText(a.name, b.name)),
        [data.cooks]
    );

    // KPI counts
    const manualCount = selectedCook === 'todos'
        ? data.totals.manualTasks
        : (data.perCookCounts[selectedCook]?.manual ?? 0);
    const hervidoCount = selectedCook === 'todos'
        ? data.totals.hervidoTasks
        : (data.perCookCounts[selectedCook]?.hervido ?? 0);

    const renderBar = (key: string, label: string, value: number, max: number, color: string, valueLabel: string) => {
        const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
        return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <div style={{ width: '150px', flexShrink: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={label}>
                    {label}
                </div>
                <div style={{ flex: 1, background: 'rgba(255,255,255,0.06)', borderRadius: '6px', height: '22px', position: 'relative', minWidth: '80px' }}>
                    <div style={{ width: `${pct}%`, background: color, height: '100%', borderRadius: '6px' }} />
                    <span style={{ position: 'absolute', left: '8px', top: 0, height: '22px', display: 'flex', alignItems: 'center', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {valueLabel}
                    </span>
                </div>
            </div>
        );
    };

    const renderSection = (esfuerzo: 'HERVIDO' | 'MANUAL') => {
        const color = esfuerzo === 'HERVIDO' ? HERVIDO_COLOR : MANUAL_COLOR;
        const title = esfuerzo === 'HERVIDO'
            ? (es ? 'Tareas de hervido por cocinero' : 'Boiling tasks by cook')
            : (es ? 'Tareas manuales por cocinero' : 'Manual tasks by cook');
        const barEmpty = esfuerzo === 'HERVIDO'
            ? (es ? 'Sin tareas de hervido.' : 'No boiling tasks.')
            : (es ? 'Sin tareas manuales.' : 'No manual tasks.');
        const perCookKey = esfuerzo === 'HERVIDO' ? 'hervido' : 'manual';

        // Tasks for this esfuerzo, honoring the cook filter.
        const sectionTasks = data.tasks.filter(t =>
            t.esfuerzo === esfuerzo &&
            (selectedCook === 'todos' || t.cooks.some(c => c.id === selectedCook))
        );

        // ---- Bar chart ----
        let bars: React.ReactNode;
        if (sectionTasks.length === 0) {
            bars = <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', padding: '0.5rem 0' }}>{barEmpty}</div>;
        } else if (selectedCook === 'todos') {
            // one bar per cook, alphabetical, length = that cook's count for this esfuerzo
            const items = sortedCooks.map(c => ({
                key: c.id,
                label: c.name,
                value: data.perCookCounts[c.id]?.[perCookKey] ?? 0,
            }));
            const max = Math.max(1, ...items.map(i => i.value));
            bars = items.map(i => renderBar(i.key, i.label, i.value, max, color, String(i.value)));
        } else {
            // one bar per task the cook participated in, alphabetical by task name,
            // length = portionsActual; each bar labeled with its own unit.
            const items = [...sectionTasks]
                .sort((a, b) => byText(a.taskName, b.taskName))
                .map(t => ({
                    key: t.assignmentId,
                    label: t.taskName,
                    value: t.portionsActual,
                    valueLabel: `${t.portionsActual} ${resolveUnit(t.metric)}`.trim(),
                }));
            const max = Math.max(1, ...items.map(i => i.value));
            bars = items.map(i => renderBar(i.key, i.label, i.value, max, color, i.valueLabel));
        }

        // ---- Category table ----
        const grouped = Array.from<[string, Task[]]>(
            sectionTasks.reduce((acc, t) => {
                const cat = t.categoryName || (es ? 'Sin categoría' : 'Uncategorized');
                if (!acc.has(cat)) acc.set(cat, []);
                acc.get(cat)!.push(t);
                return acc;
            }, new Map<string, Task[]>())
        ).sort((a, b) => byText(a[0], b[0]));

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* (a) section title with colored dot */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span style={{ width: '12px', height: '12px', borderRadius: '3px', background: color, display: 'inline-block' }} />
                    <h3 style={{ margin: 0, fontSize: '1.15rem' }}>{title}</h3>
                </div>

                {/* (b) bar chart */}
                <div>{bars}</div>

                {/* (c) category-grouped table */}
                <div style={{ overflowX: 'auto', borderLeft: `3px solid ${color}`, borderRadius: '4px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '640px' }}>
                        <thead>
                            <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)' }}>
                                <th style={{ padding: '0.8rem 1rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{es ? 'Categoría' : 'Category'}</th>
                                <th style={{ padding: '0.8rem 1rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{es ? 'Tarea' : 'Task'}</th>
                                <th style={{ padding: '0.8rem 1rem', fontWeight: 500, color: 'var(--text-secondary)', textAlign: 'right' }}>{es ? 'Cantidad' : 'Quantity'}</th>
                                <th style={{ padding: '0.8rem 1rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{es ? 'Cocineros' : 'Cooks'}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {grouped.length === 0 ? (
                                <tr>
                                    <td colSpan={4} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                                        {es ? 'Sin tareas.' : 'No tasks.'}
                                    </td>
                                </tr>
                            ) : (
                                grouped.map(([category, items]) => {
                                    const sortedItems = [...items].sort((a, b) => byText(a.taskName, b.taskName));
                                    return (
                                        <Fragment key={category}>
                                            {sortedItems.map((t, idx) => {
                                                const chips = [...t.cooks].sort((a, b) => byText(a.name, b.name));
                                                const shared = t.cooks.length > 1;
                                                return (
                                                    <tr key={t.assignmentId} style={{ borderBottom: '1px solid var(--border)' }}>
                                                        {idx === 0 && (
                                                            <td rowSpan={sortedItems.length} style={{ padding: '0.8rem 1rem', background: 'rgba(139, 92, 246, 0.05)', borderRight: '2px solid var(--border)', verticalAlign: 'middle', fontWeight: 700, color: 'var(--text-primary)' }}>
                                                                {category}
                                                            </td>
                                                        )}
                                                        <td style={{ padding: '0.8rem 1rem', fontWeight: 600 }}>
                                                            {t.taskName}
                                                            {shared && (
                                                                <span style={{ color: 'var(--text-secondary)', fontWeight: 400, fontSize: '0.8rem' }}>
                                                                    {' '}· {es ? 'compartida' : 'shared'}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td style={{ padding: '0.8rem 1rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                            {t.portionsActual} {resolveUnit(t.metric)}
                                                        </td>
                                                        <td style={{ padding: '0.8rem 1rem' }}>
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                                                                {chips.length === 0 ? (
                                                                    <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic', fontSize: '0.8rem' }}>—</span>
                                                                ) : chips.map(c => (
                                                                    <span key={c.id} style={{ fontSize: '0.78rem', background: 'rgba(255,255,255,0.06)', color: 'var(--text-primary)', padding: '0.2rem 0.5rem', borderRadius: '999px', whiteSpace: 'nowrap' }}>
                                                                        {c.name}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </Fragment>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    return (
        <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: '1.5rem' }}>{es ? 'Resumen de Preparaciones' : 'Prep Summary'}</h2>
                <select
                    value={selectedCook}
                    onChange={(e) => setSelectedCook(e.target.value)}
                    style={{ padding: '0.6rem 1rem', borderRadius: '8px', fontSize: '0.9rem', minHeight: '44px', color: 'var(--text-primary)', background: 'var(--bg-primary)', border: '1px solid var(--border)', cursor: 'pointer' }}
                >
                    <option value="todos">{es ? 'Todos los cocineros' : 'All cooks'}</option>
                    {sortedCooks.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
            </div>

            {/* Two KPI cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem' }}>
                <div style={{ padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border)', borderLeft: `3px solid ${MANUAL_COLOR}` }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>{es ? 'Tareas manuales' : 'Manual tasks'}</div>
                    <div style={{ fontSize: '2rem', fontWeight: 700, color: MANUAL_COLOR }}>{manualCount}</div>
                </div>
                <div style={{ padding: '1.25rem', borderRadius: '12px', border: '1px solid var(--border)', borderLeft: `3px solid ${HERVIDO_COLOR}` }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>{es ? 'Tareas de hervido' : 'Boiling tasks'}</div>
                    <div style={{ fontSize: '2rem', fontWeight: 700, color: HERVIDO_COLOR }}>{hervidoCount}</div>
                </div>
            </div>

            {/* Sections: HERVIDO first, then MANUAL (intentional) */}
            {renderSection('HERVIDO')}
            {renderSection('MANUAL')}
        </div>
    );
}
