'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Printer, Refrigerator, Snowflake } from 'lucide-react';
import { useAdmin } from '@/components/AdminContext';
import LabelPrintModal from '@/components/preparaciones/LabelPrintModal';
import { getLabelProducts, updateShelfLife, type LabelProduct } from '@/app/actions/labels';
import { DEFAULT_FREEZER_DAYS, DEFAULT_FRIDGE_DAYS, MAX_FRIDGE_DAYS } from '@/lib/labels';

// Etiquetas — every kitchen product that can carry a label, searchable. Cooks
// tap a product to print; an admin also sees the two shelf-life numbers
// (nevera / congelador) and can change them in place.

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function EtiquetasView({ locale }: { locale: 'es' | 'en' }) {
    const t = useTranslations('Labels');
    const { isAdmin } = useAdmin();
    const [products, setProducts] = useState<LabelProduct[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [query, setQuery] = useState('');
    const [printing, setPrinting] = useState<LabelProduct | null>(null);
    const [savingId, setSavingId] = useState<string | null>(null);

    useEffect(() => {
        getLabelProducts().then(res => {
            setProducts(res.products);
            setFailed(!res.success);
            setLoading(false);
        });
    }, []);

    const displayName = (p: LabelProduct) => (locale === 'es' ? (p.nameEs || p.name) : p.name);

    const groups = useMemo(() => {
        const q = norm(query.trim());
        const byCategory = new Map<string, LabelProduct[]>();
        for (const p of products) {
            if (q && !norm(`${p.name} ${p.nameEs ?? ''}`).includes(q)) continue;
            const key = p.category || t('no_category');
            byCategory.set(key, [...(byCategory.get(key) ?? []), p]);
        }
        return [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    }, [products, query, t]);

    const saveDays = async (p: LabelProduct, field: 'fridgeDays' | 'freezerDays', raw: string) => {
        const parsed = raw.trim() === '' ? null : Number(raw);
        const value = parsed !== null && Number.isFinite(parsed) && parsed >= 1 ? Math.round(parsed) : null;
        if (value === p[field]) return;
        const next = { ...p, [field]: value };
        setSavingId(p.id);
        const res = await updateShelfLife(p.id, next.fridgeDays, next.freezerDays);
        setSavingId(null);
        if (res.success && res.product) {
            const saved = res.product;
            setProducts(prev => prev.map(x => (x.id === p.id ? saved : x)));
        } else {
            alert(t('save_failed'));
        }
    };

    const dayInput = (p: LabelProduct, field: 'fridgeDays' | 'freezerDays') => (
        <input
            key={`${p.id}-${field}-${p[field] ?? ''}`}
            type="number"
            inputMode="numeric"
            min={1}
            defaultValue={p[field] ?? ''}
            placeholder={String(field === 'fridgeDays' ? DEFAULT_FRIDGE_DAYS : DEFAULT_FREEZER_DAYS)}
            aria-label={field === 'fridgeDays' ? t('fridge_days_label') : t('freezer_days_label')}
            disabled={savingId === p.id}
            onBlur={e => saveDays(p, field, e.target.value)}
            style={{ width: '64px', height: '40px', textAlign: 'center', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: '1rem' }}
        />
    );

    const chip = (Icon: typeof Snowflake, days: number, warn: boolean) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.85rem', color: warn ? 'var(--danger)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            <Icon size={15} /> {t('days', { count: days })}
        </span>
    );

    return (
        <div style={{ padding: '1.5rem', maxWidth: '900px', margin: '0 auto' }}>
            <h1 style={{ margin: '0 0 0.25rem 0', fontSize: '1.6rem' }}>{t('page_title')}</h1>
            <p style={{ margin: '0 0 1rem 0', color: 'var(--text-secondary)' }}>{isAdmin ? t('page_hint_admin') : t('page_hint')}</p>

            <input
                className="input-field"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t('search')}
                style={{ marginBottom: '1.25rem', fontSize: '1rem', minHeight: '48px', border: '1px solid var(--border)' }}
            />

            {loading && <p style={{ color: 'var(--text-secondary)' }}>{t('loading')}</p>}
            {!loading && failed && <p style={{ color: 'var(--danger)' }}>{t('load_failed')}</p>}
            {!loading && !failed && groups.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>{t('no_results')}</p>}

            {groups.map(([category, items]) => (
                <section key={category} style={{ marginBottom: '1.5rem' }}>
                    <h2 style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', margin: '0 0 0.5rem 0' }}>{category}</h2>
                    <div style={{ border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
                        {items.map((p, i) => {
                            const fridge = p.fridgeDays ?? DEFAULT_FRIDGE_DAYS;
                            const freezer = p.freezerDays ?? DEFAULT_FREEZER_DAYS;
                            return (
                                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', padding: '0.6rem 0.9rem', borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                                    <span style={{ flex: '1 1 220px', fontWeight: 600 }}>{displayName(p)}</span>
                                    {isAdmin ? (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)' }}>
                                            <Refrigerator size={16} />{dayInput(p, 'fridgeDays')}
                                            <Snowflake size={16} style={{ marginLeft: '0.4rem' }} />{dayInput(p, 'freezerDays')}
                                        </span>
                                    ) : (
                                        <span style={{ display: 'inline-flex', gap: '0.9rem' }}>
                                            {chip(Refrigerator, fridge, false)}
                                            {chip(Snowflake, freezer, false)}
                                        </span>
                                    )}
                                    {isAdmin && fridge > MAX_FRIDGE_DAYS && (
                                        <span style={{ flexBasis: '100%', fontSize: '0.8rem', color: 'var(--danger)' }}>{t('over_limit', { max: MAX_FRIDGE_DAYS })}</span>
                                    )}
                                    <button type="button" className="btn-primary" onClick={() => setPrinting(p)}
                                        style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.55rem 1rem', minHeight: '44px' }}>
                                        <Printer size={17} /> {t('label_button')}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </section>
            ))}

            {printing && (
                <LabelPrintModal
                    ingredientId={printing.id}
                    fallbackName={displayName(printing)}
                    locale={locale}
                    onClose={() => setPrinting(null)}
                />
            )}
        </div>
    );
}
