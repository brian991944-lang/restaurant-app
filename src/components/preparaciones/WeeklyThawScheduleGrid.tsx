'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Bot, Pencil } from 'lucide-react';
import {
    getRecurringRules,
    getThawableIngredients,
    upsertRecurringRule,
    updateCategoryCookAssignment,
    updateIngredientCookOverride,
} from '@/app/actions/recurringPrep';

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
    cookAssignmentOverride: number | null;
    category: { id: string; name: string; cookAssignment: number | null };
};

type CategoryGroup = {
    categoryId: string;
    categoryName: string;
    cookAssignment: number;
    ingredients: Ingredient[];
};

function cellKey(ingredientId: string, dayOfWeek: number): string {
    return `${ingredientId}-${dayOfWeek}`;
}

export default function WeeklyThawScheduleGrid() {
    const [groups, setGroups] = useState<CategoryGroup[]>([]);
    const [allCategoryIds, setAllCategoryIds] = useState<string[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [cellValues, setCellValues] = useState<Record<string, string>>({});
    const [cellModes, setCellModes] = useState<Record<string, 'MANUAL' | 'ALGORITHM'>>({});
    const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
    const [isLoading, setIsLoading] = useState(true);
    const committedValues = useRef<Record<string, string>>({});
    const committedModes = useRef<Record<string, 'MANUAL' | 'ALGORITHM'>>({});
    const focusedPrev = useRef<string>('');

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            const [ingredients, rules] = await Promise.all([
                getThawableIngredients(),
                getRecurringRules(),
            ]);

            const ruleMap: Record<string, Record<number, { amount: number; mode: 'MANUAL' | 'ALGORITHM' }>> = {};
            for (const r of rules) {
                if (!ruleMap[r.ingredientId]) ruleMap[r.ingredientId] = {};
                ruleMap[r.ingredientId][r.dayOfWeek] = {
                    amount: r.amount,
                    mode: (r.mode as 'MANUAL' | 'ALGORITHM') ?? 'MANUAL',
                };
            }

            const groupMap: Record<string, CategoryGroup> = {};
            for (const ing of ingredients) {
                const cid = ing.category.id;
                if (!groupMap[cid]) {
                    groupMap[cid] = {
                        categoryId: cid,
                        categoryName: ing.category.name,
                        cookAssignment: ing.category.cookAssignment ?? 1,
                        ingredients: [],
                    };
                }
                groupMap[cid].ingredients.push(ing);
            }
            const orderedGroups = Object.values(groupMap).sort((a, b) =>
                a.categoryName.localeCompare(b.categoryName),
            );

            const values: Record<string, string> = {};
            const modes: Record<string, 'MANUAL' | 'ALGORITHM'> = {};
            for (const ing of ingredients) {
                for (const { dayOfWeek } of DAYS) {
                    const rule = ruleMap[ing.id]?.[dayOfWeek];
                    values[cellKey(ing.id, dayOfWeek)] = rule && rule.amount > 0 ? String(rule.amount) : '';
                    modes[cellKey(ing.id, dayOfWeek)] = rule?.mode ?? 'MANUAL';
                }
            }

            const catIds = orderedGroups.map(g => g.categoryId);
            setGroups(orderedGroups);
            setAllCategoryIds(catIds);
            setCellValues(values);
            setCellModes(modes);
            committedValues.current = { ...values };
            committedModes.current = { ...modes };
        } catch {
            alert('Error al cargar la programación semanal.');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

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
        const mode = cellModes[key] ?? 'MANUAL';

        const committed = committedValues.current[key] ?? '';
        if (rawValue === committed) return;

        markSaving(key);
        const res = await upsertRecurringRule(ingredientId, dayOfWeek, amount, mode);
        if (res.success) {
            const normalised = amount > 0 ? String(amount) : '';
            committedValues.current[key] = normalised;
        } else {
            setCellValues(prev => ({ ...prev, [key]: focusedPrev.current }));
            alert(`Error al guardar: ${res.error ?? 'Inténtelo de nuevo'}`);
        }
        clearSaving(key);
    };

    const handleModeToggle = async (ingredientId: string, dayOfWeek: number) => {
        const key = cellKey(ingredientId, dayOfWeek);
        const currentMode = cellModes[key] ?? 'MANUAL';
        const newMode: 'MANUAL' | 'ALGORITHM' = currentMode === 'MANUAL' ? 'ALGORITHM' : 'MANUAL';
        const amount = parseFloat(cellValues[key] ?? '') || 0;

        setCellModes(prev => ({ ...prev, [key]: newMode }));
        markSaving(key);
        const res = await upsertRecurringRule(ingredientId, dayOfWeek, amount, newMode);
        if (res.success) {
            committedModes.current[key] = newMode;
        } else {
            setCellModes(prev => ({ ...prev, [key]: currentMode }));
            alert(`Error al guardar: ${res.error ?? 'Inténtelo de nuevo'}`);
        }
        clearSaving(key);
    };

    const handleCategoryCookChange = async (categoryId: string, cook: 1 | 2) => {
        setGroups(prev => prev.map(g =>
            g.categoryId === categoryId ? { ...g, cookAssignment: cook } : g,
        ));
        const res = await updateCategoryCookAssignment(categoryId, cook);
        if (!res.success) {
            alert(`Error al guardar: ${res.error ?? 'Inténtelo de nuevo'}`);
            load();
        }
    };

    const handleIngredientCookOverride = async (ingredientId: string, cook: 1 | 2 | null) => {
        setGroups(prev => prev.map(g => ({
            ...g,
            ingredients: g.ingredients.map(ing =>
                ing.id === ingredientId ? { ...ing, cookAssignmentOverride: cook } : ing,
            ),
        })));
        const res = await updateIngredientCookOverride(ingredientId, cook);
        if (!res.success) {
            alert(`Error al guardar: ${res.error ?? 'Inténtelo de nuevo'}`);
            load();
        }
    };

    const visibleGroups = selectedCategory === 'all'
        ? groups
        : groups.filter(g => g.categoryId === selectedCategory);

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
            <style>{`@keyframes wts-spin { to { transform: rotate(360deg); } }`}</style>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: '1rem', borderBottom: '1px solid var(--border)', gap: '1rem', flexWrap: 'wrap' }}>
                <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.95rem' }}>
                    Cantidades sugeridas por ingrediente y día. Dejar en blanco = sin sugerencia ese día.
                </p>
            </div>

            {/* Category filter chips — single-select */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginRight: '0.25rem' }}>Categorías:</span>
                <button
                    onClick={() => setSelectedCategory('all')}
                    style={{
                        padding: '0.3rem 0.75rem',
                        borderRadius: '20px',
                        fontSize: '0.8rem',
                        border: '1px solid var(--border)',
                        cursor: 'pointer',
                        background: selectedCategory === 'all' ? 'var(--accent-primary)' : 'transparent',
                        color: selectedCategory === 'all' ? 'white' : 'var(--text-secondary)',
                        transition: 'all 0.15s',
                    }}
                >
                    Todas
                </button>
                {groups.map((g, idx) => {
                    const active = selectedCategory === g.categoryId;
                    const tint = CATEGORY_TINTS[idx % CATEGORY_TINTS.length];
                    return (
                        <button
                            key={g.categoryId}
                            onClick={() => setSelectedCategory(active ? 'all' : g.categoryId)}
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
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
                    <thead>
                        <tr style={{ background: 'rgba(255,255,255,0.04)', fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                            <th style={{ padding: '0.9rem 1rem', minWidth: '140px' }}>Categoría</th>
                            <th style={{ padding: '0.9rem 1rem', minWidth: '160px' }}>Ingrediente</th>
                            <th style={{ padding: '0.9rem 0.5rem', minWidth: '100px', textAlign: 'center' }}>Cocinero</th>
                            {DAYS.map(d => (
                                <th key={d.dayOfWeek} style={{ padding: '0.9rem 0.5rem', textAlign: 'center', minWidth: '72px' }}>
                                    {d.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {visibleGroups.map((group) => {
                            const tint = CATEGORY_TINTS[
                                allCategoryIds.indexOf(group.categoryId) % CATEGORY_TINTS.length
                            ];
                            return group.ingredients.map((ing, iIdx) => {
                                const effectiveCook = ing.cookAssignmentOverride ?? group.cookAssignment;
                                const hasOverride = ing.cookAssignmentOverride !== null;
                                return (
                                    <tr
                                        key={ing.id}
                                        style={{ borderBottom: '1px solid var(--border)', background: tint }}
                                    >
                                        {/* Category cell — only on first ingredient row */}
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
                                                <div>{group.categoryName}</div>
                                                <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 400 }}>Cocinero:</span>
                                                    <select
                                                        value={group.cookAssignment}
                                                        onChange={e => handleCategoryCookChange(group.categoryId, parseInt(e.target.value) as 1 | 2)}
                                                        style={{
                                                            fontSize: '0.75rem',
                                                            padding: '0.1rem 0.25rem',
                                                            borderRadius: '4px',
                                                            border: '1px solid var(--border)',
                                                            background: 'var(--bg-secondary)',
                                                            color: 'var(--text-primary)',
                                                            cursor: 'pointer',
                                                        }}
                                                    >
                                                        <option value={1}>1</option>
                                                        <option value={2}>2</option>
                                                    </select>
                                                </div>
                                            </td>
                                        ) : null}

                                        {/* Ingredient name */}
                                        <td style={{ padding: '0.65rem 1rem', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                                            <div style={{ fontWeight: 500 }}>{ing.nameEs || ing.name}</div>
                                            {ing.nameEs && ing.nameEs !== ing.name && (
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{ing.name}</div>
                                            )}
                                        </td>

                                        {/* Per-ingredient cook override */}
                                        <td style={{ padding: '0.5rem 0.5rem', textAlign: 'center' }}>
                                            <select
                                                value={ing.cookAssignmentOverride?.toString() ?? ''}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    handleIngredientCookOverride(ing.id, val === '' ? null : parseInt(val) as 1 | 2);
                                                }}
                                                style={{
                                                    fontSize: '0.78rem',
                                                    padding: '0.2rem 0.3rem',
                                                    borderRadius: '6px',
                                                    border: `1px solid ${hasOverride ? 'var(--accent-primary)' : 'var(--border)'}`,
                                                    background: 'var(--bg-secondary)',
                                                    color: hasOverride ? 'var(--text-primary)' : 'var(--text-secondary)',
                                                    fontWeight: hasOverride ? 700 : 400,
                                                    cursor: 'pointer',
                                                    maxWidth: '96px',
                                                }}
                                                title={hasOverride ? `Override: Cocinero ${effectiveCook}` : `Heredado de categoría (${effectiveCook})`}
                                            >
                                                <option value="">Heredado ({group.cookAssignment})</option>
                                                <option value="1">Cocinero 1</option>
                                                <option value="2">Cocinero 2</option>
                                            </select>
                                        </td>

                                        {/* Day cells */}
                                        {DAYS.map(({ dayOfWeek, label }) => {
                                            const key = cellKey(ing.id, dayOfWeek);
                                            const isSaving = savingCells.has(key);
                                            const mode = cellModes[key] ?? 'MANUAL';
                                            const isAlgo = mode === 'ALGORITHM';
                                            return (
                                                <td key={dayOfWeek} style={{ padding: '0.4rem 0.35rem', textAlign: 'center', position: 'relative' }}>
                                                    {/* Mode toggle icon — top-right corner of cell */}
                                                    <button
                                                        onClick={() => handleModeToggle(ing.id, dayOfWeek)}
                                                        title={isAlgo ? 'Algoritmo — clic para cambiar a Manual' : 'Manual — clic para cambiar a Algoritmo'}
                                                        style={{
                                                            position: 'absolute',
                                                            top: '2px',
                                                            right: '2px',
                                                            background: 'transparent',
                                                            border: 'none',
                                                            cursor: 'pointer',
                                                            padding: 0,
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '1px',
                                                            color: isAlgo ? 'var(--accent-primary)' : 'var(--text-secondary)',
                                                            opacity: isAlgo ? 1 : 0.45,
                                                            lineHeight: 1,
                                                        }}
                                                    >
                                                        {isAlgo ? <Bot size={11} /> : <Pencil size={11} />}
                                                        {isAlgo && (
                                                            <span style={{ fontSize: '8px', color: 'var(--text-secondary)', fontWeight: 400 }}>—</span>
                                                        )}
                                                    </button>

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
                                                                color: isAlgo ? 'var(--text-secondary)' : 'var(--text-primary)',
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
                                );
                            });
                        })}
                    </tbody>
                </table>
            </div>

            {/* Footer legend */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
                    Los valores aquí configurados aparecen como "Sugerido" en Estación de Descongelado el día correspondiente.
                    Dejar una celda vacía elimina la sugerencia para ese día.
                </p>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexShrink: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        <Pencil size={11} /> Manual
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', color: 'var(--accent-primary)' }}>
                        <Bot size={11} /> Algoritmo
                    </span>
                </div>
            </div>
        </div>
    );
}
