'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Upload } from 'lucide-react';
import { parseAdpFees, commitAdpFees, type AdpFeeCommitOutcome } from '@/app/actions/payroll';
import type { AdpFeeParseResult } from '@/lib/adpFeeParse';
import { formatMoney } from '@/lib/money';

const cell: React.CSSProperties = { padding: '0.9rem 1rem', fontSize: '1.05rem' };
const head: React.CSSProperties = { padding: '0.9rem 1rem', fontSize: '0.95rem', fontWeight: 500 };
const numericCell: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const numericHead: React.CSSProperties = { ...head, textAlign: 'right' };

/**
 * Read a file as base64 for the server action.
 *
 * Chunked rather than one spread over the whole array: String.fromCharCode
 * applied to a large Uint8Array at once overflows the argument stack, and it
 * does so on file size, which is exactly the input nobody tests with.
 */
async function fileToBase64(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

/**
 * Import ADP's fee invoice.
 *
 * A different document from the Liability report: this is what ADP charged US,
 * it arrives days later, and one file can cover more than one payroll period.
 * The preview lists a row per PERIOD rather than per invoice for that reason.
 */
export default function AdpFeeImporter() {
    const t = useTranslations('Payroll');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [fileName, setFileName] = useState<string | null>(null);
    const [isParsing, setIsParsing] = useState(false);
    const [isCommitting, setIsCommitting] = useState(false);
    const [result, setResult] = useState<AdpFeeParseResult | null>(null);
    const [outcomes, setOutcomes] = useState<AdpFeeCommitOutcome[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<string | null>(null);

    const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsParsing(true);
        setError(null);
        setDone(null);
        setResult(null);
        setOutcomes(null);
        setFileName(file.name);

        try {
            const base64 = await fileToBase64(file);
            const res = await parseAdpFees(base64);
            if (!res.success || !res.result) {
                setError(res.error ?? t('adpfee_parse_failed'));
            } else {
                setResult(res.result);
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setIsParsing(false);
            // Clearing lets the same file be re-selected after a correction.
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleCommit = async () => {
        if (!result) return;
        setIsCommitting(true);
        setError(null);

        const res = await commitAdpFees(result, fileName);
        if (res.success) {
            const matched = res.outcomes?.filter(o => o.matched).length ?? 0;
            const skipped = (res.outcomes?.length ?? 0) - matched;
            setOutcomes(res.outcomes ?? null);
            setDone(t('adpfee_import_done', { matched, skipped }));
            setResult(null);
            setFileName(null);
        } else {
            setError(res.error ?? t('adpfee_import_failed'));
        }
        setIsCommitting(false);
    };

    const money = (cents: number | null) => (cents === null ? '—' : formatMoney(cents));

    const hasWarnings =
        !!result &&
        (result.unrecognisedDescriptions.length > 0 ||
            result.unreadable.length > 0 ||
            result.duplicatedKinds.length > 0 ||
            result.periods.some(p => p.payrollFeeCents === null || p.workersCompFeeCents === null));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }} data-testid="adpfee-importer">

            {/* ── Upload ── */}
            <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <input
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    onChange={handleFile}
                    data-testid="adpfee-file-input"
                />
                <button
                    onClick={() => fileInputRef.current?.click()}
                    className="btn-primary"
                    disabled={isParsing || isCommitting}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '8px', minHeight: '52px' }}
                >
                    <Upload size={18} />
                    <span>{isParsing ? t('adpfee_reading') : t('adpfee_choose_file')}</span>
                </button>
                <span style={{ color: 'var(--text-secondary)', fontSize: '1.05rem' }}>
                    {fileName ?? t('adpfee_no_file')}
                </span>
            </div>

            {done && (
                <div className="glass-panel" style={{ padding: '1.25rem', border: '1px solid var(--success)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }} data-testid="adpfee-done">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <CheckCircle2 size={20} color="var(--success)" />
                        <span style={{ fontSize: '1.05rem' }}>{done}</span>
                    </div>
                    {/* Unmatched periods are named, not merely counted. A period with
                        no run is a payroll that was charged for but never imported,
                        and the date is what makes that findable. */}
                    {outcomes?.some(o => !o.matched) && (
                        <ul style={{ margin: 0, paddingLeft: '1.5rem', fontSize: '1.02rem', color: 'var(--warning)' }} data-testid="adpfee-unmatched">
                            {outcomes.filter(o => !o.matched).map(o => (
                                <li key={o.periodEnding}>
                                    {t('adpfee_unmatched', { period: o.periodEnding, date: o.checkDate ?? '—' })}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {error && (
                <div className="glass-panel" style={{ padding: '1.25rem', border: '1px solid var(--danger)', display: 'flex', alignItems: 'center', gap: '0.6rem' }} data-testid="adpfee-error">
                    <AlertTriangle size={20} color="var(--danger)" />
                    <span style={{ fontSize: '1.05rem' }}>{error}</span>
                </div>
            )}

            {result && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }} data-testid="adpfee-preview">

                    {/* ── What the file covers ── */}
                    <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                        <div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{t('adpfee_invoices')}</div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>
                                {result.invoiceNumbers.length > 0 ? result.invoiceNumbers.join(', ') : '—'}
                            </div>
                        </div>
                        <div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{t('adpfee_periods')}</div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }} data-testid="adpfee-period-count">
                                {result.periods.length}
                            </div>
                        </div>
                        <div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{t('adpfee_skipped')}</div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }} data-testid="adpfee-skipped">
                                {t('adpfee_skipped_detail', { misc: result.miscSkipped, totals: result.totalRowsSkipped })}
                            </div>
                        </div>
                    </div>

                    {/* ── Warnings: impossible to miss, never blocking ── */}
                    {hasWarnings && (
                        <div className="glass-panel" style={{ padding: '1.5rem', border: '2px solid var(--warning)', display: 'flex', flexDirection: 'column', gap: '0.6rem' }} data-testid="adpfee-warnings">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--warning)' }}>
                                <AlertTriangle size={22} />
                                <h2 style={{ fontSize: '1.3rem', margin: 0 }}>{t('adpfee_review_before_import')}</h2>
                            </div>
                            <ul style={{ margin: 0, paddingLeft: '1.5rem', fontSize: '1.05rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                {result.unrecognisedDescriptions.length > 0 && (
                                    <li>{t('adpfee_warn_unrecognised', { items: result.unrecognisedDescriptions.join('; ') })}</li>
                                )}
                                {result.unreadable.length > 0 && (
                                    <li>{t('adpfee_warn_unreadable', { rows: result.unreadable.map(u => u.row).join(', ') })}</li>
                                )}
                                {result.duplicatedKinds.length > 0 && (
                                    <li>{t('adpfee_warn_duplicate', { periods: result.duplicatedKinds.map(d => d.periodEnding).join(', ') })}</li>
                                )}
                                {result.periods.some(p => p.payrollFeeCents === null || p.workersCompFeeCents === null) && (
                                    <li>{t('adpfee_warn_incomplete')}</li>
                                )}
                            </ul>
                            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '1rem' }}>{t('adpfee_warn_not_blocking')}</p>
                        </div>
                    )}

                    {/* ── One row per PERIOD, not per invoice ── */}
                    <div className="glass-panel" style={{ padding: '1.5rem', overflowX: 'auto' }}>
                        <h2 style={{ fontSize: '1.3rem', marginTop: 0, marginBottom: '0.5rem' }}>{t('adpfee_by_period')}</h2>
                        <p style={{ marginTop: 0, color: 'var(--text-secondary)', fontSize: '1rem' }}>{t('adpfee_by_period_note')}</p>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '620px' }}>
                            <thead>
                                <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                                    <th style={head}>{t('adpfee_period_ending')}</th>
                                    <th style={numericHead}>{t('adp_fee_payroll')}</th>
                                    <th style={numericHead}>{t('adpfee_units')}</th>
                                    <th style={numericHead}>{t('adp_fee_workers_comp')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {result.periods.map(p => (
                                    <tr key={p.periodEnding} style={{ borderBottom: '1px solid var(--border)' }} data-testid="adpfee-period-row">
                                        <td style={cell}>{p.periodEnding}</td>
                                        <td style={{ ...numericCell, color: p.payrollFeeCents === null ? 'var(--danger)' : 'var(--text-primary)' }}>
                                            {money(p.payrollFeeCents)}
                                        </td>
                                        <td style={numericCell}>{p.employees ?? '—'}</td>
                                        <td style={{ ...numericCell, color: p.workersCompFeeCents === null ? 'var(--danger)' : 'var(--text-primary)' }}>
                                            {money(p.workersCompFeeCents)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* ── Confirm ── */}
                    <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                        <button
                            onClick={handleCommit}
                            className="btn-primary"
                            disabled={isParsing || isCommitting}
                            style={{ borderRadius: '8px', minHeight: '52px', opacity: isCommitting ? 0.6 : 1 }}
                            data-testid="adpfee-confirm"
                        >
                            {isCommitting ? t('adpfee_importing') : t('adpfee_confirm_import', { count: result.periods.length })}
                        </button>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>{t('adpfee_replace_note')}</span>
                    </div>
                </div>
            )}
        </div>
    );
}
