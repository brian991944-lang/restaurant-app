'use client';

import { useTranslations } from 'next-intl';
import { type AdpRunRow } from '@/app/actions/payroll';
import { formatMoney } from '@/lib/money';

const cell: React.CSSProperties = { padding: '0.9rem 1rem', fontSize: '1.05rem' };
const head: React.CSSProperties = { padding: '0.9rem 1rem', fontSize: '0.95rem', fontWeight: 500 };
const numericCell: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const numericHead: React.CSSProperties = { ...head, textAlign: 'right' };

/**
 * The imported ADP runs, with the employer's true cost per run.
 *
 * READ ONLY. The fees used to be typed in here, one field per run, because
 * nothing imported them. The fee invoice is now imported and is the only source:
 * a single hand-typed figure could not say which of the two fees it was, and a
 * second source for one number is how the two drift apart.
 *
 * Until an invoice arrives the cost is shown as PENDING, never as a finished
 * figure — a run awaiting its fees costs more than what is on screen, and
 * rendering it as complete would understate it exactly the way this whole model
 * exists to stop happening.
 */
export default function AdpRunsList({ runs }: { runs: AdpRunRow[] }) {
    const t = useTranslations('Payroll');

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
                            <th style={numericHead}>{t('adp_fee_payroll')}</th>
                            <th style={numericHead}>{t('adp_fee_workers_comp')}</th>
                            <th style={numericHead}>{t('adp_employer_cost')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {runs.map(run => {
                            /** A fee not yet invoiced reads as pending, never as $0.00. */
                            const fee = (value: number | null) =>
                                value === null
                                    ? <span style={{ color: 'var(--warning)' }}>{t('adp_fee_pending')}</span>
                                    : formatMoney(Math.round(value * 100));

                            return (
                                <tr key={run.id} style={{ borderBottom: '1px solid var(--border)' }} data-testid="adp-run-row">
                                    <td style={cell} data-testid="adp-run-date">{run.checkDate}</td>
                                    <td style={cell}>{run.payrollNumber ?? '—'}</td>
                                    <td style={numericCell}>{formatMoney(Math.round(run.erTaxTotal * 100))}</td>
                                    <td style={numericCell}>{formatMoney(Math.round(run.workersComp * 100))}</td>
                                    <td style={numericCell} data-testid="adp-fee-payroll">
                                        {fee(run.serviceFeePayroll)}
                                        {run.serviceFeeEmployees !== null && (
                                            <div style={{ fontSize: '0.86rem', fontWeight: 400, color: 'var(--text-secondary)' }}>
                                                {t('adp_fee_headcount', { count: run.serviceFeeEmployees })}
                                            </div>
                                        )}
                                    </td>
                                    <td style={numericCell} data-testid="adp-fee-workers-comp">{fee(run.serviceFeeWorkersComp)}</td>
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
