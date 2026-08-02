import { getTranslations } from 'next-intl/server';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { getTipDay } from '@/app/actions/tips';
import { getBusinessDateAsDate, formatBusinessDateEs } from '@/lib/businessDay';
import { toCents, sumCents, formatMoney } from '@/lib/money';

type TipDay = NonNullable<Awaited<ReturnType<typeof getTipDay>>>;
type TipShift = TipDay['shifts'][number];
type TipEntry = TipShift['entries'][number];

const cell: React.CSSProperties = { padding: '0.9rem 1rem', fontSize: '1.05rem' };
const head: React.CSSProperties = { padding: '0.9rem 1rem', fontSize: '0.95rem', fontWeight: 500 };
const numericCell: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const numericHead: React.CSSProperties = { ...head, textAlign: 'right' };

/**
 * Sentence-case the first character only. CSS `capitalize` would title-case
 * every word ("Domingo, 2 De Agosto De 2026"); Spanish wants the month and the
 * connecting words left lowercase exactly as Intl produced them.
 */
const upperFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Shared column widths so every shift table lines up with the others. */
function ShiftColGroup() {
    return (
        <colgroup>
            <col style={{ width: '22%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '20.66%' }} />
            <col style={{ width: '20.66%' }} />
            <col style={{ width: '20.66%' }} />
        </colgroup>
    );
}

/** One of the three money columns, resolved to cents for every entry. */
type Column = {
    key: 'credit_tips' | 'service_charge' | 'cash';
    label: string;
    /** null means the entry has no value recorded yet (cash only). */
    centsOf: (e: TipEntry) => number | null;
    targetCents: number;
};

function MetricCard({ label, value, note }: { label: string; value: string; note?: string }) {
    return (
        <div
            className="glass-panel"
            style={{ padding: '1.5rem', flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}
        >
            <span style={{ fontSize: '1rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>
            <span style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                {value}
            </span>
            {note && <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{note}</span>}
        </div>
    );
}

/**
 * Distributed-vs-target for one column, stated in cents.
 *
 * Three outcomes rather than a signed number: a shortfall and an overshoot
 * mean different things to whoever is closing out, and "cuadra" needs to be
 * unmistakable at a glance.
 */
function Reconciliation({
    distributed,
    target,
    labels
}: {
    distributed: number;
    target: number;
    labels: { remaining: string; excess: string; balanced: string };
}) {
    const diff = target - distributed;

    if (diff === 0) {
        return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: 'var(--success)', fontWeight: 600 }}>
                <CheckCircle2 size={18} />
                {labels.balanced}
            </span>
        );
    }

    const over = diff < 0;
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
            color: over ? 'var(--danger)' : 'var(--warning)', fontWeight: 600
        }}>
            <AlertTriangle size={18} />
            {over ? labels.excess : labels.remaining}: {formatMoney(Math.abs(diff))}
        </span>
    );
}

export default async function TipsReviewsPage() {
    const t = await getTranslations('Tips');
    const day = await getTipDay();
    const headerDate = formatBusinessDateEs(day ? new Date(day.businessDate) : getBusinessDateAsDate());

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '1100px', margin: '0 auto', padding: '1.5rem' }}>

            <div>
                <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                    {t('title')}
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', margin: 0 }}>
                    {t('subtitle')}
                </p>
                <p style={{ color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: 600, margin: '0.75rem 0 0 0' }}>
                    {upperFirst(headerDate)}
                </p>
            </div>

            {!day ? (
                <div className="glass-panel" style={{ padding: '3rem 2rem', textAlign: 'center' }}>
                    <p style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-secondary)' }}>
                        {t('no_day_yet')}
                    </p>
                </div>
            ) : (
                <TipDayView day={day} t={t} />
            )}
        </div>
    );
}

function TipDayView({ day, t }: { day: TipDay; t: Awaited<ReturnType<typeof getTranslations<'Tips'>>> }) {
    const allEntries = day.shifts.flatMap(s => s.entries);

    // Every figure below is integer cents. Decimals arrive as numbers from the
    // action's mapper and are converted once, here — nothing is compared as a
    // float anywhere on this page.
    const columns: Column[] = [
        {
            key: 'credit_tips',
            label: t('credit_tips'),
            centsOf: e => toCents(e.creditTips),
            targetCents: toCents(day.totalCreditTips)
        },
        {
            key: 'service_charge',
            label: t('service_charge'),
            centsOf: e => toCents(e.serviceCharge),
            targetCents: toCents(day.totalServiceCharge)
        },
        {
            key: 'cash',
            label: t('cash'),
            // null is preserved: an uncounted drawer is not a zero one.
            centsOf: e => (e.cashTips === null ? null : toCents(e.cashTips)),
            targetCents: toCents(day.totalCashTips)
        }
    ];

    const distributed = (c: Column) =>
        sumCents(allEntries.map(e => c.centsOf(e) ?? 0));

    const labels = { remaining: t('remaining'), excess: t('excess'), balanced: t('balanced') };
    const roleLabel = (role: TipEntry['role']) => (role === 'MESERO' ? t('mesero') : t('busser'));

    return (
        <>
            {day.status === 'ENVIADO' && (
                <div style={{
                    padding: '1.25rem 1.5rem', borderRadius: '12px',
                    background: 'color-mix(in srgb, var(--success) 12%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--success) 35%, transparent)',
                    display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap'
                }}>
                    <CheckCircle2 size={22} color="var(--success)" />
                    <span style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--success)' }}>
                        {t('submitted')}
                    </span>
                    {day.submittedByName && (
                        <span style={{ fontSize: '1.05rem', color: 'var(--text-secondary)' }}>
                            · {t('submitted_by')}: {day.submittedByName}
                        </span>
                    )}
                    {day.submittedAt && (
                        <span style={{ fontSize: '1.05rem', color: 'var(--text-secondary)' }}>
                            · {new Date(day.submittedAt).toLocaleString('es')}
                        </span>
                    )}
                </div>
            )}

            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <MetricCard
                    label={t('total_tips')}
                    value={formatMoney(toCents(day.totalCreditTips))}
                    note={day.cloverSyncedAt ? t('clover_synced') : undefined}
                />
                <MetricCard
                    label={t('total_service_charge')}
                    value={formatMoney(toCents(day.totalServiceCharge))}
                    note={day.cloverSyncedAt ? t('clover_synced') : undefined}
                />
                <MetricCard
                    label={t('total_cash')}
                    value={formatMoney(toCents(day.totalCashTips))}
                />
            </div>

            <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {columns.map(c => (
                    <div
                        key={c.key}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}
                    >
                        <span style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {c.label}
                        </span>
                        <span style={{ fontSize: '1.05rem', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                            {formatMoney(distributed(c))} / {formatMoney(c.targetCents)}
                        </span>
                        <Reconciliation distributed={distributed(c)} target={c.targetCents} labels={labels} />
                    </div>
                ))}
            </div>

            {day.shifts.map(shift => (
                <div key={shift.id} className="glass-panel" style={{ padding: '0', overflowX: 'auto' }}>
                    {/* padding-left matches the first cell's, so the heading
                        sits on the same vertical line as the Nombre column. */}
                    <h2 style={{ margin: 0, padding: '1.25rem 1rem', fontSize: '1.2rem', fontWeight: 700, color: 'var(--accent-primary)' }}>
                        {t('shift')} {shift.orderIndex + 1}
                    </h2>

                    {shift.entries.length === 0 ? (
                        <p style={{ margin: 0, padding: '0 1rem 1.75rem 1rem', fontSize: '1.1rem', color: 'var(--text-secondary)' }}>
                            {t('no_entries')}
                        </p>
                    ) : (
                        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', minWidth: '680px', tableLayout: 'fixed' }}>
                            <ShiftColGroup />
                            <thead>
                                <tr style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                                    <th style={head}>{t('name')}</th>
                                    <th style={head}>{t('role')}</th>
                                    {columns.map(c => (
                                        <th key={c.key} style={numericHead}>{c.label}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {shift.entries.map(entry => (
                                    <tr key={entry.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={{ ...cell, fontWeight: 500, color: 'var(--text-primary)' }}>
                                            {entry.employeeName}
                                        </td>
                                        <td style={{ ...cell, color: 'var(--text-secondary)' }}>
                                            {roleLabel(entry.role)}
                                        </td>
                                        <td style={numericCell}>{formatMoney(toCents(entry.creditTips))}</td>
                                        <td style={numericCell}>{formatMoney(toCents(entry.serviceCharge))}</td>
                                        <td style={numericCell}>
                                            {entry.cashTips === null ? (
                                                <span style={{
                                                    display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                                                    justifyContent: 'flex-end', color: 'var(--warning)', fontWeight: 600
                                                }}>
                                                    <AlertTriangle size={18} />
                                                    — {t('not_counted')}
                                                </span>
                                            ) : (
                                                formatMoney(toCents(entry.cashTips))
                                            )}
                                        </td>
                                    </tr>
                                ))}

                                <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                                    <td style={{ ...cell, fontWeight: 700, color: 'var(--text-primary)' }} colSpan={2}>
                                        {t('subtotal')}
                                    </td>
                                    {columns.map(c => {
                                        // Uncounted cash is excluded from the subtotal and flagged,
                                        // rather than being silently added as zero.
                                        const hasUncounted = shift.entries.some(e => c.centsOf(e) === null);
                                        const sum = sumCents(shift.entries.map(e => c.centsOf(e) ?? 0));
                                        return (
                                            <td key={c.key} style={{ ...numericCell, fontWeight: 700 }}>
                                                {formatMoney(sum)}
                                                {hasUncounted && (
                                                    <AlertTriangle
                                                        size={16}
                                                        color="var(--warning)"
                                                        style={{ marginLeft: '0.4rem', verticalAlign: 'text-bottom' }}
                                                    />
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            </tbody>
                        </table>
                    )}
                </div>
            ))}

        </>
    );
}
