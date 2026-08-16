'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import type { PayrollSpend } from '@/app/actions/payroll';
import { formatMoney } from '@/lib/money';

/**
 * What the week cost, at the top of the Reportes tab.
 *
 * The layout puts three different KINDS of money on one screen, so each is
 * fenced off from the next rather than listed together:
 *
 *   spend      — wages plus the employer's own liability. The headline.
 *   tips       — the customers' money passing through. NOT a cost, and shown
 *                behind its own heading so it cannot be read as part of one.
 *   retention  — wages held back. Already inside the wage figures above, so
 *                adding it would count the same dollars twice.
 *
 * A reader who takes one number away from this screen should take the headline,
 * and the headline must never quietly include the other two.
 */
export default function PayrollSpendReport({ spend }: { spend: PayrollSpend }) {
    const t = useTranslations('Payroll');

    const rowStyle: React.CSSProperties = {
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        gap: '1rem', padding: '0.55rem 0', borderBottom: '1px solid var(--border)',
    };
    const labelStyle: React.CSSProperties = { fontSize: '1.05rem', color: 'var(--text-secondary)' };
    const valueStyle: React.CSSProperties = {
        fontSize: '1.1rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums',
        color: 'var(--text-primary)',
    };

    const line = (label: string, cents: number, testId?: string) => (
        <div style={rowStyle}>
            <span style={labelStyle}>{label}</span>
            <span style={valueStyle} data-testid={testId}>{formatMoney(cents)}</span>
        </div>
    );

    /**
     * An employer-side figure, which is only known once the run is imported.
     *
     * Renders '—' rather than $0.00 while the run is missing. Zero would claim
     * the employer owed nothing that week, which is a statement about the
     * payroll; the dash says the figure is not in yet, which is a statement
     * about the import. They are not the same and the difference is the whole
     * point of this report.
     */
    const employerLine = (label: string, cents: number, testId: string) => (
        <div style={rowStyle}>
            <span style={labelStyle}>{label}</span>
            <span
                style={{ ...valueStyle, color: spend.adpRunMissing ? 'var(--warning)' : 'var(--text-primary)' }}
                data-testid={testId}
            >
                {spend.adpRunMissing ? '—' : formatMoney(cents)}
            </span>
        </div>
    );

    // A week with no settled rows has no spend figure at all. Showing $0.00
    // would read as a week that was worked and cost nothing, which is a
    // different and much worse claim than "not settled yet".
    if (!spend.hasEntries) {
        return (
            <div className="glass-panel" style={{ padding: '1.5rem' }} data-testid="payroll-spend">
                <h2 style={{ fontSize: '1.4rem', marginTop: 0, marginBottom: '0.5rem' }}>{t('spend_title')}</h2>
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '1.05rem' }} data-testid="spend-no-entries">
                    {t('spend_no_entries', { week: spend.weekEnding })}
                </p>
            </div>
        );
    }

    return (
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }} data-testid="payroll-spend">

            {/* ── Headline ── */}
            <div>
                <h2 style={{ fontSize: '1.4rem', marginTop: 0, marginBottom: '0.35rem' }}>{t('spend_title')}</h2>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span
                        style={{
                            fontSize: '2.4rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                            color: spend.spendIsComplete ? 'var(--text-primary)' : 'var(--warning)',
                        }}
                        data-testid="spend-total"
                    >
                        {formatMoney(spend.totalSpendCents)}
                    </span>
                    {!spend.spendIsComplete && (
                        <span
                            style={{
                                fontSize: '1rem', fontWeight: 700, color: 'var(--warning)',
                                border: '1px solid var(--warning)', borderRadius: '8px', padding: '0.25rem 0.6rem',
                            }}
                            data-testid="spend-pending"
                        >
                            {t('spend_pending')}
                        </span>
                    )}
                </div>
                <p style={{ margin: '0.35rem 0 0', color: 'var(--text-secondary)', fontSize: '1rem' }}>
                    {t('spend_week', { start: spend.weekStart, end: spend.weekEnding })}
                </p>
            </div>

            {/* ── Why it is incomplete, stated rather than implied ── */}
            {!spend.spendIsComplete && (
                <div style={{ border: '1px solid var(--warning)', borderRadius: '8px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }} data-testid="spend-incomplete">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--warning)' }}>
                        <AlertTriangle size={20} />
                        <strong style={{ fontSize: '1.05rem' }}>{t('spend_incomplete_title')}</strong>
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '1.4rem', fontSize: '1.02rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                        {spend.adpRunMissing && (
                            <li data-testid="spend-run-missing">{t('spend_run_missing', { date: spend.expectedCheckDate })}</li>
                        )}
                        {!spend.adpRunMissing
                            && (spend.serviceFeePayrollCents === null || spend.serviceFeeWorkersCompCents === null) && (
                                <li data-testid="spend-fee-missing">{t('spend_fee_missing')}</li>
                            )}
                    </ul>
                </div>
            )}

            {/* ── Breakdown: what the headline is made of ── */}
            <div data-testid="spend-breakdown">
                <h3 style={{ fontSize: '1.15rem', margin: '0 0 0.35rem' }}>{t('spend_breakdown')}</h3>
                {line(t('spend_adp_wages'), spend.adpWageCents, 'spend-adp-wages')}
                {line(t('spend_check_wages'), spend.checkWageCents, 'spend-check-wages')}
                {employerLine(t('spend_er_taxes'), spend.erTaxTotalCents, 'spend-er-taxes')}
                {employerLine(t('spend_workers_comp'), spend.workersCompCents, 'spend-workers-comp')}
                {/* The two ADP fees are SEPARATE lines, never one.
                    "Workers comp" three rows up is the PREMIUM, which goes to the
                    carrier; this one is ADP's flat charge for administering the
                    policy. Two small plausible numbers that sum to something
                    plausible is exactly how a double-count survives review, so
                    they are labelled apart and shown apart. */}
                <div style={rowStyle}>
                    <span style={labelStyle}>
                        {t('spend_fee_payroll')}
                        {/* The headcount sits with the fee it explains: this charge is
                            a base plus a per-person rate, so a jump usually means more
                            people were paid rather than a price change. */}
                        {spend.serviceFeeEmployees !== null && (
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }} data-testid="spend-fee-headcount">
                                {' '}{t('spend_fee_headcount', { count: spend.serviceFeeEmployees })}
                            </span>
                        )}
                    </span>
                    <span
                        style={{ ...valueStyle, color: spend.serviceFeePayrollCents === null ? 'var(--warning)' : 'var(--text-primary)' }}
                        data-testid="spend-fee-payroll"
                    >
                        {/* Three states, not two: no run imported at all, a run whose
                            fee invoice has not arrived, and a known fee. */}
                        {spend.adpRunMissing
                            ? '—'
                            : spend.serviceFeePayrollCents === null
                                ? t('spend_fee_pending')
                                : formatMoney(spend.serviceFeePayrollCents)}
                    </span>
                </div>

                <div style={rowStyle}>
                    <span style={labelStyle}>{t('spend_fee_workers_comp')}</span>
                    <span
                        style={{ ...valueStyle, color: spend.serviceFeeWorkersCompCents === null ? 'var(--warning)' : 'var(--text-primary)' }}
                        data-testid="spend-fee-workers-comp"
                    >
                        {spend.adpRunMissing
                            ? '—'
                            : spend.serviceFeeWorkersCompCents === null
                                ? t('spend_fee_pending')
                                : formatMoney(spend.serviceFeeWorkersCompCents)}
                    </span>
                </div>
            </div>

            {/* ── Tips: fenced off, and labelled as not a cost ── */}
            <div
                style={{ borderTop: '2px solid var(--border)', paddingTop: '1rem' }}
                data-testid="spend-tips"
            >
                <h3 style={{ fontSize: '1.15rem', margin: '0 0 0.2rem' }}>{t('spend_tips_title')}</h3>
                <p style={{ margin: '0 0 0.35rem', color: 'var(--text-secondary)', fontSize: '1rem' }}>
                    {t('spend_tips_note')}
                </p>
                {line(t('spend_adp_tips'), spend.adpTipsCents, 'spend-adp-tips')}
                {line(t('spend_check_tips'), spend.checkTipsCents, 'spend-check-tips')}
                <div style={{ ...rowStyle, borderBottom: 'none' }}>
                    <span style={{ ...labelStyle, fontWeight: 600 }}>{t('spend_tips_total')}</span>
                    <span style={valueStyle} data-testid="spend-tips-total">{formatMoney(spend.tipsPassthroughCents)}</span>
                </div>
            </div>

            {/* ── Retention: money held, not money spent ── */}
            <div
                style={{ borderTop: '2px solid var(--border)', paddingTop: '1rem' }}
                data-testid="spend-retention"
            >
                <h3 style={{ fontSize: '1.15rem', margin: '0 0 0.2rem' }}>{t('spend_retention_title')}</h3>
                <p style={{ margin: '0 0 0.35rem', color: 'var(--text-secondary)', fontSize: '1rem' }}>
                    {t('spend_retention_note')}
                </p>
                {line(t('spend_retained'), spend.retainedCents, 'spend-retained')}
                {line(t('spend_delivered'), spend.deliveredCents, 'spend-delivered')}
                <div style={{ ...rowStyle, borderBottom: 'none' }}>
                    <span style={{ ...labelStyle, fontWeight: 600 }}>{t('spend_retention_net')}</span>
                    <span style={valueStyle} data-testid="spend-retention-net">{formatMoney(spend.totalRetainedCents)}</span>
                </div>
            </div>
        </div>
    );
}
