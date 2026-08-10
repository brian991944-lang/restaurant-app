'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { recordDeduction, deleteDeduction, type AdvanceRow } from '@/app/actions/payroll';
import NewAdvanceModal, { type AdvancePerson } from './NewAdvanceModal';
import { formatMoney, toCents } from '@/lib/money';

const stat: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.15rem', minWidth: '110px' };
const statLabel: React.CSSProperties = { fontSize: '0.85rem', color: 'var(--text-secondary)' };
const statValue: React.CSSProperties = { fontSize: '1.1rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' };

const button: React.CSSProperties = {
    minHeight: '48px', padding: '0 1rem', borderRadius: '8px',
    fontSize: '1rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
    color: 'var(--text-primary)', background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
};

/** Tapping a figure highlights it, so the first keystroke replaces the whole value. */
const selectAllOnFocus = (e: React.FocusEvent<HTMLInputElement>) => e.currentTarget.select();

export default function AdvancesPanel({
    advances,
    people,
    defaultWeekEnding,
}: {
    advances: AdvanceRow[];
    /** The config panel's own people, so the picker matches what is on screen. */
    people: AdvancePerson[];
    /** The last complete week — what a deduction defaults to being recorded for. */
    defaultWeekEnding: string;
}) {
    const t = useTranslations('Payroll');
    const router = useRouter();

    const [creating, setCreating] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<Record<string, string>>({});
    /** Per-advance amount and week for the "record a deduction" control. */
    const [drafts, setDrafts] = useState<Record<string, { amount: string; week: string }>>({});

    const draftFor = (a: AdvanceRow) =>
        drafts[a.id] ?? {
            // Prefilled with the agreed weekly amount, but editable: a short week
            // or a partial payment is a real thing that has to be recordable.
            amount: (a.weeklyDeductionCents / 100).toFixed(2),
            week: defaultWeekEnding,
        };

    const patch = (a: AdvanceRow, next: Partial<{ amount: string; week: string }>) =>
        setDrafts(d => ({ ...d, [a.id]: { ...draftFor(a), ...next } }));

    const run = async (key: string, fn: () => Promise<{ success: boolean; error?: string }>) => {
        setBusyId(key);
        setError(e => ({ ...e, [key]: '' }));
        const res = await fn();
        if (!res.success) setError(e => ({ ...e, [key]: res.error ?? t('advance_action_failed') }));
        else {
            setDrafts(d => {
                const next = { ...d };
                delete next[key];
                return next;
            });
            router.refresh();
        }
        setBusyId(null);
    };

    const active = advances.filter(a => !a.status.isPaidOff);
    const totalOutstanding = active.reduce((s, a) => s + a.status.outstandingCents, 0);
    const totalMissed = active.reduce((s, a) => s + a.status.missedWeeks.length, 0);

    return (
        <div id="advances" className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                    <h2 style={{ fontSize: '1.3rem', margin: 0 }}>{t('advances_title')}</h2>
                    <p style={{ margin: '0.35rem 0 0', color: 'var(--text-secondary)', fontSize: '1rem' }}>
                        {t('advances_subtitle')}
                    </p>
                </div>
                <button
                    onClick={() => setCreating(true)}
                    style={{ ...button, display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                    <Plus size={18} />
                    {t('advance_new')}
                </button>
            </div>

            {/* The one number worth reading before any individual row, and the
                count of forgotten deductions beside it. */}
            {advances.length > 0 && (
                <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', paddingBottom: '0.25rem' }}>
                    <div style={stat}>
                        <span style={statLabel}>{t('advances_total_outstanding')}</span>
                        <span style={statValue}>{formatMoney(totalOutstanding)}</span>
                    </div>
                    <div style={stat}>
                        <span style={statLabel}>{t('advances_active_count')}</span>
                        <span style={statValue}>{active.length}</span>
                    </div>
                    {totalMissed > 0 && (
                        <div style={stat}>
                            <span style={{ ...statLabel, color: 'var(--warning)' }}>{t('advances_missed_total')}</span>
                            <span style={{ ...statValue, color: 'var(--warning)' }}>{totalMissed}</span>
                        </div>
                    )}
                </div>
            )}

            {advances.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: '1.05rem', margin: 0 }}>{t('advances_empty')}</p>
            ) : (
                advances.map(a => {
                    const d = draftFor(a);
                    const busy = busyId === a.id;
                    const paidOff = a.status.isPaidOff;
                    const missed = a.status.missedWeeks;

                    return (
                        <div
                            key={a.id}
                            style={{
                                display: 'flex', flexDirection: 'column', gap: '0.9rem',
                                padding: '1.1rem', borderRadius: '10px',
                                border: `1px solid ${missed.length > 0 ? 'var(--warning)' : 'var(--border)'}`,
                                background: missed.length > 0 ? 'rgba(234, 179, 8, 0.06)' : 'transparent',
                            }}
                        >
                            {/* ── Identity and figures ── */}
                            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                                <div style={{ ...stat, flex: '1 1 200px' }}>
                                    <span style={{ fontSize: '1.15rem', fontWeight: 700 }}>{a.employeeName}</span>
                                    <span style={statLabel}>
                                        {t('advance_started', { week: a.startWeekEnding })}
                                    </span>
                                    {a.note && (
                                        <span style={{ ...statLabel, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '260px' }}>
                                            {a.note}
                                        </span>
                                    )}
                                </div>

                                <div style={stat}>
                                    <span style={statLabel}>{t('advance_principal')}</span>
                                    <span style={statValue}>{formatMoney(a.principalCents)}</span>
                                </div>
                                <div style={stat}>
                                    <span style={statLabel}>{t('advance_weekly')}</span>
                                    <span style={statValue}>{formatMoney(a.weeklyDeductionCents)}</span>
                                </div>
                                <div style={stat}>
                                    <span style={statLabel}>{t('advance_paid')}</span>
                                    <span style={statValue}>{formatMoney(a.status.paidCents)}</span>
                                </div>
                                <div style={stat}>
                                    <span style={statLabel}>{t('advance_outstanding')}</span>
                                    <span style={{ ...statValue, color: paidOff ? 'var(--success)' : 'var(--text-primary)' }}>
                                        {formatMoney(a.status.outstandingCents)}
                                    </span>
                                </div>
                                <div style={stat}>
                                    <span style={statLabel}>{t('advance_weeks_left')}</span>
                                    <span style={statValue}>
                                        {a.status.weeksRemaining === null ? '—' : a.status.weeksRemaining}
                                    </span>
                                </div>
                            </div>

                            {paidOff && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--success)', fontSize: '1.02rem', fontWeight: 600 }}>
                                    <CheckCircle2 size={20} />
                                    <span>{t('advance_paid_off')}</span>
                                </div>
                            )}

                            {/* ── Missed weeks: the point of the screen ── */}
                            {missed.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--warning)', fontWeight: 700, fontSize: '1.05rem' }}>
                                        <AlertTriangle size={20} />
                                        <span>{t('advance_missed_count', { count: missed.length })}</span>
                                    </div>
                                    {/* Listed by date, not summarised to a number: a
                                        count says something is wrong, the dates say
                                        which weeks to go and fix. */}
                                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                        {missed.map(w => (
                                            <span
                                                key={w}
                                                style={{
                                                    padding: '0.3rem 0.6rem', borderRadius: '6px',
                                                    background: 'rgba(234, 179, 8, 0.16)', color: 'var(--warning)',
                                                    fontSize: '0.95rem', fontVariantNumeric: 'tabular-nums',
                                                }}
                                            >
                                                {w}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* ── Record a deduction ── */}
                            {!paidOff && (
                                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                        <span style={statLabel}>{t('advance_deduct_week')}</span>
                                        <input
                                            type="date"
                                            value={d.week}
                                            onChange={e => patch(a, { week: e.target.value })}
                                            style={{ ...button, fontWeight: 400, padding: '0 0.7rem' }}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                        <span style={statLabel}>{t('advance_deduct_amount')}</span>
                                        <input
                                            type="number" step="0.01" min="0.01" inputMode="decimal"
                                            value={d.amount}
                                            onFocus={selectAllOnFocus}
                                            onChange={e => patch(a, { amount: e.target.value })}
                                            style={{ ...button, fontWeight: 400, width: '130px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', padding: '0 0.7rem' }}
                                        />
                                    </div>
                                    <button
                                        onClick={() => run(a.id, () => recordDeduction(a.id, d.week, toCents(d.amount)))}
                                        disabled={busy || toCents(d.amount) <= 0}
                                        className="btn-primary"
                                        style={{ borderRadius: '8px', minHeight: '48px', opacity: (busy || toCents(d.amount) <= 0) ? 0.55 : 1 }}
                                    >
                                        {busy ? t('saving') : t('advance_record')}
                                    </button>
                                    {/* Named on the control itself: the last payment is
                                        exactly the outstanding balance, and it is allowed. */}
                                    <button
                                        onClick={() => patch(a, { amount: (a.status.outstandingCents / 100).toFixed(2) })}
                                        disabled={busy}
                                        style={button}
                                    >
                                        {t('advance_pay_rest', { amount: formatMoney(a.status.outstandingCents) })}
                                    </button>
                                </div>
                            )}

                            {error[a.id] && (
                                <span style={{ color: 'var(--danger)', fontSize: '0.98rem' }}>{error[a.id]}</span>
                            )}

                            {/* ── Deductions already recorded ── */}
                            {a.deductions.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                    <span style={statLabel}>{t('advance_deductions')}</span>
                                    {a.deductions.map(x => (
                                        <div
                                            key={x.id}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
                                                padding: '0.45rem 0', borderBottom: '1px solid var(--border)',
                                            }}
                                        >
                                            <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: '110px' }}>{x.weekEnding}</span>
                                            <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatMoney(x.amountCents)}</span>
                                            {x.recordedByName && (
                                                <span style={statLabel}>{x.recordedByName}</span>
                                            )}
                                            <button
                                                onClick={() => run(x.id, () => deleteDeduction(x.id))}
                                                disabled={busyId === x.id}
                                                aria-label={t('advance_delete_deduction')}
                                                title={t('advance_delete_deduction')}
                                                style={{
                                                    ...button, minWidth: '48px', padding: '0 0.6rem',
                                                    marginLeft: 'auto', color: 'var(--danger)',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    opacity: busyId === x.id ? 0.55 : 1,
                                                }}
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                            {error[x.id] && (
                                                <span style={{ color: 'var(--danger)', fontSize: '0.92rem', flexBasis: '100%' }}>
                                                    {error[x.id]}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })
            )}

            {creating && (
                <NewAdvanceModal
                    people={people}
                    defaultWeekEnding={defaultWeekEnding}
                    onClose={() => setCreating(false)}
                />
            )}
        </div>
    );
}
