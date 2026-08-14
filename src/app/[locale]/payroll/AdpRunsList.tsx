'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { setAdpServiceFee, type AdpRunRow } from '@/app/actions/payroll';
import { formatMoney, toCents } from '@/lib/money';

const cell: React.CSSProperties = { padding: '0.9rem 1rem', fontSize: '1.05rem' };
const head: React.CSSProperties = { padding: '0.9rem 1rem', fontSize: '0.95rem', fontWeight: 500 };
const numericCell: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const numericHead: React.CSSProperties = { ...head, textAlign: 'right' };

/**
 * The imported ADP runs, with the employer's true cost per run.
 *
 * The fee is entered here rather than at import because ADP does not know it at
 * run time: the invoice arrives the Monday after and debits three days later.
 * Until it is entered the cost is shown as PENDING, never as a finished figure
 * — a run awaiting its fee costs more than the figure on screen, and rendering
 * it as complete would understate it exactly the way this whole model exists to
 * stop happening.
 */
export default function AdpRunsList({ runs }: { runs: AdpRunRow[] }) {
    const t = useTranslations('Payroll');

    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [savingId, setSavingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const save = async (run: AdpRunRow) => {
        const raw = drafts[run.id];
        if (raw === undefined) return;

        setSavingId(run.id);
        setError(null);

        // An emptied field clears the fee back to pending rather than storing 0.
        const trimmed = raw.trim();
        const amount = trimmed === '' ? null : toCents(trimmed) / 100;

        const res = await setAdpServiceFee(run.id, amount);
        if (!res.success) {
            setError(res.error ?? t('adp_fee_failed'));
        } else {
            setDrafts(d => {
                const next = { ...d };
                delete next[run.id];
                return next;
            });
        }
        setSavingId(null);
    };

    if (runs.length === 0) {
        return (
            <div className="glass-panel" style={{ padding: '1.5rem' }} data-testid="adp-runs">
                <h2 style={{ fontSize: '1.3rem', marginTop: 0, marginBottom: '0.5rem' }}>{t('adp_runs_title')}</h2>
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '1.05rem' }}>{t('adp_no_runs')}</p>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }} data-testid="adp-runs">
            {error && (
                <div className="glass-panel" style={{ padding: '1.25rem', border: '1px solid var(--danger)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <AlertTriangle size={20} color="var(--danger)" />
                    <span style={{ fontSize: '1.05rem' }}>{error}</span>
                </div>
            )}

            <div className="glass-panel" style={{ padding: '1.5rem', overflowX: 'auto' }}>
                <h2 style={{ fontSize: '1.3rem', marginTop: 0, marginBottom: '0.5rem' }}>{t('adp_runs_title')}</h2>
                <p style={{ marginTop: 0, color: 'var(--text-secondary)', fontSize: '1rem' }}>{t('adp_cost_note')}</p>

                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '860px' }}>
                    <thead>
                        <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                            <th style={head}>{t('adp_check_date')}</th>
                            <th style={head}>{t('adp_payroll_number')}</th>
                            <th style={numericHead}>{t('adp_field_erTaxTotal')}</th>
                            <th style={numericHead}>{t('adp_field_workersComp')}</th>
                            <th style={numericHead}>{t('adp_service_fee')}</th>
                            <th style={numericHead}>{t('adp_employer_cost')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {runs.map(run => {
                            const draft = drafts[run.id];
                            const dirty = draft !== undefined;
                            const value = dirty
                                ? draft
                                : run.serviceFee === null
                                    ? ''
                                    : run.serviceFee.toFixed(2);

                            return (
                                <tr key={run.id} style={{ borderBottom: '1px solid var(--border)' }} data-testid="adp-run-row">
                                    <td style={cell} data-testid="adp-run-date">{run.checkDate}</td>
                                    <td style={cell}>{run.payrollNumber ?? '—'}</td>
                                    <td style={numericCell}>{formatMoney(Math.round(run.erTaxTotal * 100))}</td>
                                    <td style={numericCell}>{formatMoney(Math.round(run.workersComp * 100))}</td>
                                    <td style={numericCell}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                            <input
                                                type="text"
                                                inputMode="decimal"
                                                value={value}
                                                placeholder={t('adp_fee_pending')}
                                                onChange={e => setDrafts(d => ({ ...d, [run.id]: e.target.value }))}
                                                data-testid="adp-fee-input"
                                                style={{
                                                    width: '7.5rem', minHeight: '44px', padding: '0 0.6rem',
                                                    textAlign: 'right', fontSize: '1.05rem',
                                                    fontVariantNumeric: 'tabular-nums',
                                                    borderRadius: '8px',
                                                    color: 'var(--text-primary)',
                                                    background: 'var(--bg-primary)',
                                                    border: `1px solid ${dirty ? 'var(--warning)' : 'var(--border)'}`,
                                                }}
                                            />
                                            <button
                                                onClick={() => save(run)}
                                                disabled={!dirty || savingId === run.id}
                                                data-testid="adp-fee-save"
                                                style={{
                                                    minHeight: '44px', padding: '0 0.9rem', borderRadius: '8px',
                                                    fontSize: '1rem', fontWeight: 600,
                                                    cursor: dirty ? 'pointer' : 'default',
                                                    opacity: dirty ? 1 : 0.4,
                                                    color: 'var(--text-primary)',
                                                    background: 'var(--bg-primary)',
                                                    border: '1px solid var(--border)',
                                                }}
                                            >
                                                {savingId === run.id ? t('adp_fee_saving') : t('adp_fee_save')}
                                            </button>
                                        </div>
                                    </td>
                                    <td
                                        style={{
                                            ...numericCell,
                                            fontWeight: 700,
                                            color: run.employerCostPending ? 'var(--warning)' : 'var(--text-primary)',
                                        }}
                                        data-testid="adp-employer-cost"
                                    >
                                        {formatMoney(run.employerCostCents)}
                                        {run.employerCostPending && (
                                            <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>{t('adp_cost_pending')}</div>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
