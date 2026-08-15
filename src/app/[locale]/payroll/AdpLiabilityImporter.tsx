'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Upload } from 'lucide-react';
import { parseAdpLiability, commitAdpRun } from '@/app/actions/payroll';
import type {
    AdpLiabilityParseResult,
    AdpFieldKey,
    AdpRateKey,
    AdpCrossCheck,
} from '@/lib/adpLiabilityParse';
import { formatMoney } from '@/lib/money';

const cell: React.CSSProperties = { padding: '0.9rem 1rem', fontSize: '1.05rem' };
const head: React.CSSProperties = { padding: '0.9rem 1rem', fontSize: '0.95rem', fontWeight: 500 };
const numericCell: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const numericHead: React.CSSProperties = { ...head, textAlign: 'right' };

/** Only OK is green. Nothing else passes. Mirrors TimesheetImporter. */
function checkColor(status: AdpCrossCheck['status']): string {
    return status === 'OK' ? 'var(--success)' : status === 'MISMATCH' ? 'var(--danger)' : 'var(--warning)';
}

/** The employer taxes, in the order the report states them. */
const TAX_FIELDS: { key: AdpFieldKey; rateKey?: AdpRateKey }[] = [
    { key: 'erSocSec' },
    { key: 'erMedicare' },
    { key: 'erFuta', rateKey: 'futaRate' },
    { key: 'erSui', rateKey: 'suiRate' },
    { key: 'erSdi', rateKey: 'sdiRate' },
];

const DEBIT_FIELDS: AdpFieldKey[] = ['debitTaxes', 'debitChecks', 'debitDirectDeposit', 'workersComp'];

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

export default function AdpLiabilityImporter() {
    const t = useTranslations('Payroll');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [fileName, setFileName] = useState<string | null>(null);
    const [isParsing, setIsParsing] = useState(false);
    const [isCommitting, setIsCommitting] = useState(false);
    const [result, setResult] = useState<AdpLiabilityParseResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<string | null>(null);

    const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsParsing(true);
        setError(null);
        setDone(null);
        setResult(null);
        setFileName(file.name);

        try {
            const base64 = await fileToBase64(file);
            const res = await parseAdpLiability(base64);
            if (!res.success || !res.result) {
                setError(res.error ?? t('adp_parse_failed'));
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

        const res = await commitAdpRun(result, fileName);
        if (res.success) {
            setDone(res.created ? t('adp_import_created') : t('adp_import_replaced'));
            setResult(null);
            setFileName(null);
        } else {
            setError(res.error ?? t('adp_import_failed'));
        }
        setIsCommitting(false);
    };

    const money = (cents: number | null): string => (cents === null ? '—' : formatMoney(cents));

    const renderCheck = (label: string, check: AdpCrossCheck) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }} data-testid="adp-crosscheck">
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{label}</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 700, color: checkColor(check.status) }}>
                {t(`adp_check_${check.status}`)}
            </div>
            <div style={{ fontSize: '1rem', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                {t('adp_components')}: {formatMoney(check.componentsCents)}
                {' · '}
                {t('adp_reported')}: {money(check.reportedCents)}
                {check.differenceCents !== null && check.differenceCents !== 0 && (
                    <>
                        {' · '}
                        <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
                            {t('adp_difference')}: {formatMoney(check.differenceCents)}
                        </span>
                    </>
                )}
            </div>
        </div>
    );

    const hasWarnings =
        !!result &&
        (result.missingLabels.length > 0 ||
            result.unreadableValues.length > 0 ||
            result.duplicateLabels.length > 0 ||
            result.taxCheck.status !== 'OK' ||
            result.cashCheck.status !== 'OK');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }} data-testid="adp-importer">

            {/* ── Upload ── */}
            <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <input
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    onChange={handleFile}
                    data-testid="adp-file-input"
                />
                <button
                    onClick={() => fileInputRef.current?.click()}
                    className="btn-primary"
                    disabled={isParsing || isCommitting}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '8px', minHeight: '52px' }}
                >
                    <Upload size={18} />
                    <span>{isParsing ? t('adp_reading') : t('adp_choose_file')}</span>
                </button>
                <span style={{ color: 'var(--text-secondary)', fontSize: '1.05rem' }}>
                    {fileName ?? t('adp_no_file')}
                </span>
            </div>

            {done && (
                <div className="glass-panel" style={{ padding: '1.25rem', border: '1px solid var(--success)', display: 'flex', alignItems: 'center', gap: '0.6rem' }} data-testid="adp-done">
                    <CheckCircle2 size={20} color="var(--success)" />
                    <span style={{ fontSize: '1.05rem' }}>{done}</span>
                </div>
            )}

            {error && (
                <div className="glass-panel" style={{ padding: '1.25rem', border: '1px solid var(--danger)', display: 'flex', alignItems: 'center', gap: '0.6rem' }} data-testid="adp-error">
                    <AlertTriangle size={20} color="var(--danger)" />
                    <span style={{ fontSize: '1.05rem' }}>{error}</span>
                </div>
            )}

            {result && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }} data-testid="adp-preview">

                    {/* ── Which run this is ── */}
                    <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                        <div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{t('adp_check_date')}</div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700 }} data-testid="adp-check-date">{result.checkDate ?? '—'}</div>
                        </div>
                        <div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{t('adp_payroll_number')}</div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{result.payrollNumber ?? '—'}</div>
                        </div>
                        <div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{t('adp_employer_cost_parsed')}</div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                                {money((result.amountsCents.erTaxTotal ?? 0) + (result.amountsCents.workersComp ?? 0))}
                                <span style={{ fontSize: '0.95rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
                                    {' '}{t('adp_before_fee')}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* ── Warnings: impossible to miss, never blocking ── */}
                    {hasWarnings && (
                        <div className="glass-panel" style={{ padding: '1.5rem', border: '2px solid var(--warning)', display: 'flex', flexDirection: 'column', gap: '0.6rem' }} data-testid="adp-warnings">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--warning)' }}>
                                <AlertTriangle size={22} />
                                <h2 style={{ fontSize: '1.3rem', margin: 0 }}>{t('adp_review_before_import')}</h2>
                            </div>
                            <ul style={{ margin: 0, paddingLeft: '1.5rem', fontSize: '1.05rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                {result.missingLabels.length > 0 && (
                                    <li>{t('adp_warn_missing', { labels: result.missingLabels.map(k => t(`adp_field_${k}`)).join(', ') })}</li>
                                )}
                                {result.unreadableValues.length > 0 && (
                                    <li>{t('adp_warn_unreadable', { labels: result.unreadableValues.map(u => `${t(`adp_field_${u.key}`)} (${t('adp_row')} ${u.row})`).join(', ') })}</li>
                                )}
                                {result.duplicateLabels.length > 0 && (
                                    <li>{t('adp_warn_duplicate', { labels: result.duplicateLabels.map(d => `${d.label} (${d.rows.join(', ')})`).join('; ') })}</li>
                                )}
                                {result.taxCheck.status !== 'OK' && <li>{t('adp_warn_tax_check')}</li>}
                                {result.cashCheck.status !== 'OK' && <li>{t('adp_warn_cash_check')}</li>}
                            </ul>
                            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '1rem' }}>{t('adp_warn_not_blocking')}</p>
                        </div>
                    )}

                    {/* ── Cross-checks: reported, never auto-corrected ── */}
                    <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', gap: '2.5rem', flexWrap: 'wrap' }}>
                        {renderCheck(t('adp_check_taxes'), result.taxCheck)}
                        {renderCheck(t('adp_check_cash'), result.cashCheck)}
                    </div>

                    {/* ── Employer taxes ── */}
                    <div className="glass-panel" style={{ padding: '1.5rem', overflowX: 'auto' }}>
                        <h2 style={{ fontSize: '1.3rem', marginTop: 0, marginBottom: '1rem' }}>{t('adp_employer_taxes')}</h2>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '480px' }}>
                            <thead>
                                <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                                    <th style={head}>{t('adp_concept')}</th>
                                    <th style={numericHead}>{t('adp_rate')}</th>
                                    <th style={numericHead}>{t('adp_amount')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {TAX_FIELDS.map(({ key, rateKey }) => (
                                    <tr key={key} style={{ borderBottom: '1px solid var(--border)' }} data-testid="adp-tax-row">
                                        <td style={cell}>{t(`adp_field_${key}`)}</td>
                                        <td style={numericCell}>
                                            {rateKey && result.rates[rateKey] !== null ? `${result.rates[rateKey]} %` : '—'}
                                        </td>
                                        <td style={{ ...numericCell, color: result.amountsCents[key] === null ? 'var(--danger)' : 'var(--text-primary)', fontWeight: result.amountsCents[key] === null ? 600 : 400 }}>
                                            {result.amountsCents[key] === null ? t('adp_not_found') : money(result.amountsCents[key])}
                                        </td>
                                    </tr>
                                ))}
                                <tr style={{ borderTop: '2px solid var(--border)' }}>
                                    <td style={{ ...cell, fontWeight: 700 }}>{t('adp_field_erTaxTotal')}</td>
                                    <td style={numericCell}>—</td>
                                    <td style={{ ...numericCell, fontWeight: 700, color: checkColor(result.taxCheck.status) }}>
                                        {result.amountsCents.erTaxTotal === null ? t('adp_not_found') : money(result.amountsCents.erTaxTotal)}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    {/* ── Debits ── */}
                    <div className="glass-panel" style={{ padding: '1.5rem', overflowX: 'auto' }}>
                        <h2 style={{ fontSize: '1.3rem', marginTop: 0, marginBottom: '0.5rem' }}>{t('adp_debits')}</h2>
                        <p style={{ marginTop: 0, color: 'var(--text-secondary)', fontSize: '1rem' }}>{t('adp_debits_note')}</p>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '480px' }}>
                            <thead>
                                <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                                    <th style={head}>{t('adp_concept')}</th>
                                    <th style={numericHead}>{t('adp_amount')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {DEBIT_FIELDS.map(key => (
                                    <tr key={key} style={{ borderBottom: '1px solid var(--border)' }} data-testid="adp-debit-row">
                                        <td style={cell}>{t(`adp_field_${key}`)}</td>
                                        <td style={{ ...numericCell, color: result.amountsCents[key] === null ? 'var(--danger)' : 'var(--text-primary)', fontWeight: result.amountsCents[key] === null ? 600 : 400 }}>
                                            {result.amountsCents[key] === null ? t('adp_not_found') : money(result.amountsCents[key])}
                                        </td>
                                    </tr>
                                ))}
                                <tr style={{ borderTop: '2px solid var(--border)' }}>
                                    <td style={{ ...cell, fontWeight: 700 }}>{t('adp_field_totalCashRequired')}</td>
                                    <td style={{ ...numericCell, fontWeight: 700, color: checkColor(result.cashCheck.status) }}>
                                        {result.amountsCents.totalCashRequired === null ? t('adp_not_found') : money(result.amountsCents.totalCashRequired)}
                                    </td>
                                </tr>
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
                            data-testid="adp-confirm"
                        >
                            {isCommitting ? t('adp_importing') : t('adp_confirm_import')}
                        </button>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>{t('adp_replace_note')}</span>
                    </div>
                </div>
            )}
        </div>
    );
}
