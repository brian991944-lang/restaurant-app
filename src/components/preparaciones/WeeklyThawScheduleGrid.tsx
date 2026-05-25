'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { getRecurringRules, getThawableIngredients, upsertRecurringRule } from '@/app/actions/recurringPrep';

// Lun=1, Mar=2, Mié=3, Jue=4, Vie=5, Sáb=6, Dom=0  (matches RecurringPrepRule.dayOfWeek)
const DAYS = [
    { label: 'Lun', dayOfWeek: 1 },
    { label: 'Mar', dayOfWeek: 2 },
    { label: 'Mié', dayOfWeek: 3 },
    { label: 'Jue', dayOfWeek: 4 },
    { label: 'Vie', dayOfWeek: 5 },
    { label: 'Sáb', dayOfWeek: 6 },
    { label: 'Dom', dayOfWeek: 0 },
] as const;

// Pastel background tints for category rows — cycles through if there are more than 6 categories
const CATEGORY_TINTS = [
    'rgba(59,130,246,0.04)',
    'rgba(168,85,247,0.04)',
    'rgba(16,185,129,0.04)',
    'rgba(245,158,11,0.04)',
    'rgba(239,68,68,0.04)',
    'rgba(6,182,212,0.04)',
];

type Ingredient = {
    id: string;
    name: string;
    nameEs: string | null;
    metric: string;
    category: { id: string; name: string };
};

type CategoryGroup = {
    categoryId: string;
    categoryName: string;
    ingredients: Ingredient[];
};

function cellKey(ingredientId: string, dayOfWeek: number): string {
    return `${ingredientId}-${dayOfWeek}`;
}

export default function WeeklyThawScheduleGrid() {
    const [groups, setGroups] = useState<CategoryGroup[]>([]);
    const [allCategoryIds, setAllCategoryIds] = useState<string[]>([]);
    const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(new Set());
    const [cellValues, setCellValues] = useState<Record<string, string>>({});
    const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
    const [isLoading, setIsLoading] = useState(true);
    // Holds the committed value for each cell so we can revert on save error
    const committedValues = useRef<Record<string, string>>({});
    const focusedPrev = useRef<string>('');

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            const [ingredients, rules] = await Promise.all([
                getThawableIngredients(),
                getRecurringRules(),
            ]);

            // Build rule lookup: ruleMap[ingredientId][dayOfWeek] = amount
            const ruleMap: Record<string, Record<number, number>> = {};
            for (const r of rules) {
                if (!ruleMap[r.ingredientId]) ruleMap[r.ingredientId] = {};
                ruleMap[r.ingredientId][r.dayOfWeek] = r.amount;
            }

            // Group by category
            const groupMap: Record<string, CategoryGroup> = {};
            for (const ing of ingredients) {
                const cid = ing.category.id;
                if (!groupMap[cid]) {
                    groupMap[cid] = { categoryId: cid, categoryName: ing.category.name, ingredients: [] };
                }
                groupMap[cid].ingredients.push(ing);
            }
            const orderedGroups = Object.values(groupMap).sort((a, b) =>
                a.categoryName.localeCompare(b.categoryName),
            );

            // Build initial cell values from rules
            const values: Record<string, string> = {};
            for (const ing of ingredients) {
                for (const { dayOfWeek } of DAYS) {
                    const amount = ruleMap[ing.id]?.[dayOfWeek];
                    values[cellKey(ing.id, dayOfWeek)] = amount ? String(amount) : '';
                }
            }

            const catIds = orderedGroups.map(g => g.categoryId);
            setGroups(orderedGroups);
            setAllCategoryIds(catIds);
            setSelectedCategoryIds(new Set(catIds));
            setCellValues(values);
            committedValues.current = { ...values };
        } catch {
            alert('Error al cargar la programación semanal.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const toggleCategory = (catId: string) => {
        setSelectedCategoryIds(prev => {
            const next = new Set(prev);
            if (next.has(catId)) {
                if (next.size === 1) return prev; // keep at least one selected
                next.delete(catId);
            } else {
                next.add(catId);
            }
            return next;
        });
    };

    const toggleAllCategories = () => {
        setSelectedCategoryIds(prev =>
            prev.size === allCategoryIds.length
                ? new Set([allCategoryIds[0]]) // collapse to first only
                : new Set(allCategoryIds),
        );
    };

    const markSaving = (key: string) =>
        setSavingCells(prev => new Set(prev).add(key));
    const clearSaving = (key: string) =>
        setSavingCells(prev => { const s = new Set(prev); s.delete(key); return s; });

    const handleFocus = (key: string) => {
        focusedPrev.current = cellValues[key] ?? '';
    };

    const handleBlur = async (ingredientId: string, dayOfWeek: number) => {
        const key = cellKey(ingredientId, dayOfWeek);
        const rawValue = cellValues[key] ?? '';
        const amount = parseFloat(rawValue) || 0;

        // If value is unchanged from committed, skip the network call
        const committed = committedValues.current[key] ?? '';
        if (rawValue === committed) return;

        markSaving(key);
        const res = await upsertRecurringRule(ingredientId, dayOfWeek, amount);
        if (res.success) {
            const normalised = amount > 0 ? String(amount) : '';
            committedValues.current[key] = normalised;
            // Normalise the display (e.g. "5.0" → "5" isn't forced, leave as typed)
        } else {
            // Revert to the pre-focus value
            setCellValues(prev => ({ ...prev, [key]: focusedPrev.current }));
            alert(`Error al guardar: ${res.error ?? 'Inténtelo de nuevo'}`);
        }
        clearSaving(key);
    };

    const visibleGroups = groups.filter(g => selectedCategoryIds.has(g.categoryId));

    if (isLoading) {
        return (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Cargando programación semanal...
            </div>
        );
    }

    if (groups.length === 0) {
        return (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.01)', borderRadius: '12px' }}>
                <p style={{ marginBottom: '0.5rem' }}>No hay ingredientes con seguimiento de congelado activo.</p>
                <p style={{ fontSize: '0.85rem' }}>Activa "Seguimiento de Congelado" en un ingrediente para verlo aquí.</p>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Inline spin keyframe */}
            <style>{`@keyframes wts-spin { to { transform: rotate(360deg); } }`}</style>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: '1rem', borderBottom: '1px solid var(--border)', gap: '1rem', flexWrap: 'wrap' }}>
                <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.95rem' }}>
                    Cantidades sugeridas por ingrediente y día. Dejar en blanco = sin sugerencia ese día.
                </p>
            </div>

            {/* Category filter chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginRight: '0.25rem' }}>Categorías:</span>
                <button
                    onClick={toggleAllCategories}
                    style={{
                        padding: '0.3rem 0.75rem',
                        borderRadius: '20px',
                        fontSize: '0.8rem',
                        border: '1px solid var(--border)',
                        cursor: 'pointer',
                        background: selectedCategoryIds.size === allCategoryIds.length ? 'var(--accent-primary)' : 'transparent',
                        color: selectedCategoryIds.size === allCategoryIds.length ? 'white' : 'var(--text-secondary)',
                        transition: 'all 0.15s',
                    }}
                >
                    Todas
                </button>
                {groups.map((g, idx) => {
                    const active = selectedCategoryIds.has(g.categoryId);
                    const tint = CATEGORY_TINTS[idx % CATEGORY_TINTS.length];
                    return (
                        <button
                            key={g.categoryId}
                            onClick={() => toggleCategory(g.categoryId)}
                            style={{
                                padding: '0.3rem 0.75rem',
                                borderRadius: '20px',
                                fontSize: '0.8rem',
                                border: `1px solid ${active ? 'var(--accent-primary)' : 'var(--border)'}`,
                                cursor: 'pointer',
                                background: active ? tint : 'transparent',
                                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                                transition: 'all 0.15s',
                                fontWeight: active ? 600 : 400,
                            }}
                        >
                            {g.categoryName}
                        </button>
                    );
                })}
            </div>

            {/* Grid */}
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '700px' }}>
                    <thead>
                        <tr style={{ background: 'rgba(255,255,255,0.04)', fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                            <th style={{ padding: '0.9rem 1rem', minWidth: '130px' }}>Categoría</th>
                            <th style={{ padding: '0.9rem 1rem', minWidth: '160px' }}>Ingrediente</th>
                            {DAYS.map(d => (
                                <th key={d.dayOfWeek} style={{ padding: '0.9rem 0.5rem', textAlign: 'center', minWidth: '72px' }}>
                                    {d.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {visibleGroups.map((group, gIdx) => {
                            const tint = CATEGORY_TINTS[
                                allCategoryIds.indexOf(group.categoryId) % CATEGORY_TINTS.length
                            ];
                            return group.ingredients.map((ing, iIdx) => (
                                <tr
                                    key={ing.id}
                                    style={{ borderBottom: '1px solid var(--border)', background: tint }}
                                >
                                    {/* Category cell — only on first row of each group */}
                                    {iIdx === 0 ? (
                                        <td
                                            rowSpan={group.ingredients.length}
                                            style={{
                                                padding: '0.75rem 1rem',
                                                fontWeight: 600,
                                                fontSize: '0.875rem',
                                                color: 'var(--text-primary)',
                                                verticalAlign: 'top',
                                                borderRight: '1px solid var(--border)',
                                                lineHeight: 1.4,
                                            }}
                                        >
                                            {group.categoryName}
                                        </td>
                                    ) : null}

                                    {/* Ingredient name */}
                                    <td style={{ padding: '0.65rem 1rem', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                                        <div style={{ fontWeight: 500 }}>{ing.nameEs || ing.name}</div>
                                        {ing.nameEs && ing.nameEs !== ing.name && (
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{ing.name}</div>
                                        )}
                                    </td>

                                    {/* Day cells */}
                                    {DAYS.map(({ dayOfWeek, label }) => {
                                        const key = cellKey(ing.id, dayOfWeek);
                                        const isSaving = savingCells.has(key);
                                        return (
                                            <td key={dayOfWeek} style={{ padding: '0.4rem 0.35rem', textAlign: 'center' }}>
                                                <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="0.5"
                                                        aria-label={`${ing.nameEs || ing.name} — ${label}`}
                                                        value={cellValues[key] ?? ''}
                                                        disabled={isSaving}
                                                        onFocus={() => handleFocus(key)}
                                                        onChange={e =>
                                                            setCellValues(prev => ({ ...prev, [key]: e.target.value }))
                                                        }
                                                        onBlur={() => handleBlur(ing.id, dayOfWeek)}
                                                        style={{
                                                            width: '62px',
                                                            minHeight: '44px',
                                                            padding: '0.4rem 0.3rem',
                                                            fontSize: '1rem',
                                                            textAlign: 'center',
                                                            fontWeight: 600,
                                                            border: '1px solid var(--border)',
                                                            borderRadius: '8px',
                                                            background: isSaving
                                                                ? 'rgba(59,130,246,0.08)'
                                                                : 'var(--bg-secondary)',
                                                            color: 'var(--text-primary)',
                                                            outline: 'none',
                                                            transition: 'border-color 0.15s, background 0.15s',
                                                        }}
                                                        onFocusCapture={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                                                        onBlurCapture={e => (e.currentTarget.style.borderColor = 'var(--border)')}
                                                    />
                                                    {isSaving && (
                                                        <span
                                                            style={{
                                                                position: 'absolute',
                                                                top: '-6px',
                                                                right: '-6px',
                                                                width: '12px',
                                                                height: '12px',
                                                                border: '2px solid var(--border)',
                                                                borderTopColor: 'var(--accent-primary)',
                                                                borderRadius: '50%',
                                                                animation: 'wts-spin 0.8s linear infinite',
                                                                background: 'var(--bg-primary)',
                                                            }}
                                                        />
                                                    )}
                                                </div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ));
                        })}
                    </tbody>
                </table>
            </div>

            {/* Footer legend */}
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
                Los valores aquí configurados aparecen como "Sugerido" en Estación de Descongelado el día correspondiente.
                Dejar una celda vacía elimina la sugerencia para ese día.
            </p>
        </div>
    );
}
