'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Upload } from 'lucide-react';
import { parseTimesheet, commitTimesheet } from '@/app/actions/punches';
import type { TimesheetParseResult, CrossCheck } from '@/lib/timesheetParse';

const cell: React.CSSProperties = { padding: '0.9rem 1rem', fontSize: '1.05rem' };
const head: React.CSSProperties = { padding: '0.9rem 1rem', fontSize: '0.95rem', fontWeight: 500 };
const numericCell: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const numericHead: React.CSSProperties = { ...head, textAlign: 'right' };

/** Colour for a cross-check outcome. Only OK is green; nothing else passes. */
function checkColor(c: CrossCheck): string {
    return c === 'OK' ? 'var(--success)' : c === 'MISMATCH' ? 'var(--danger)' : 'var(--warning)';
}

const nyTime = (iso: string | Date) =>
    new Intl.DateTimeFormat('es', {
        timeZone: 'America/New_York',
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));

const isoDay = (d: string | Date) => new Date(d).toISOString().slice(0, 10);

export default function TimesheetImporter() {
    const t = useTranslations('Payroll');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [fileName, setFileName] = useState<string | null>(null);
    const [isParsing, setIsParsing] = useState(false);
    const [isCommitting, setIsCommitting] = useState(false);
    const [result, setResult] = useState<TimesheetParseResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [rosterError, setRosterError] = useState<string | null>(null);
    const [done, setDone] = useState<string | null>(null);
    const [batchId, setBatchId] = useState<string>('');

    const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsParsing(true);
        setError(null);
        setRosterError(null);
        setDone(null);
        setResult(null);
        setFileName(file.name);

        try {
            // The file's actual contents — not a placeholder. Everything the
            // preview shows is derived from this text.
            const text = await file.text();
            const res = await parseTimesheet(text);

            if (res.rosterError) setRosterError(res.rosterError);
            if (!res.success || !res.result) {
                setError(res.error ?? t('parse_failed'));
            } else {
                setResult(res.result);
                setBatchId(`${file.name}-${Date.now()}`);
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

        const res = await commitTimesheet(
            result.punches.map(p => ({
                businessDate: p.businessDate,
                employeeName: p.employeeName,
                cloverEmployeeId: p.cloverEmployeeId,
                clockIn: p.clockIn,
                clockOut: p.clockOut,
                hours: p.hours,
                isFlagged: p.isFlagged,
                flagReason: p.flagReason,
            })),
            batchId,
            result.periodStart,
            result.periodEnd,
            fileName
        );

        if (res.success) {
            setDone(t('import_done', { created: res.created ?? 0, replaced: res.replaced ?? 0 }));
            setResult(null);
            setFileName(null);
        } else {
            setError(res.error ?? t('import_failed'));
        }
        setIsCommitting(false);
    };

    const mismatchCount = result?.employees.filter(e => e.crossCheck !== 'OK').length ?? 0;
    const totalsMismatch = result ? result.totals.crossCheck !== 'OK' : false;
    const unresolved = result?.unresolvedNames ?? [];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {/* ── Upload ── */}
            <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <input
                    type="file"
                    accept=".csv,text/csv"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    onChange={handleFile}
                />
                <button
                    onClick={() => fileInputRef.current?.click()}
                    className="btn-primary"
                    disabled={isParsing || isCommitting}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '8px', minHeight: '52px' }}
                >
                    <Upload size={18} />
                    <span>{isParsing ? t('reading') : t('choose_file')}</span>
                </button>
                <span style={{ color: 'var(--text-secondary)', fontSize: '1.05rem' }}>
                    {fileName ?? t('no_file')}
                </span>
            </div>

            {done && (
                <div className="glass-panel" style={{ padding: '1.25rem', border: '1px solid var(--success)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <CheckCircle2 size={20} color="var(--success)" />
                    <span style={{ fontSize: '1.05rem' }}>{done}</span>
                </div>
            )}

            {error && (
                <div className="glass-panel" style={{ padding: '1.25rem', border: '1px solid var(--danger)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <AlertTriangle size={20} color="var(--danger)" />
                    <span style={{ fontSize: '1.05rem' }}>{error}</span>
                </div>
            )}

            {rosterError && (
                <div className="glass-panel" style={{ padding: '1.25rem', border: '1px solid var(--warning)', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <AlertTriangle size={20} color="var(--warning)" />
                    <span style={{ fontSize: '1.05rem' }}>{rosterError}</span>
                </div>
            )}

            {result && (
                <>
                    {/* ── Period summary ── */}
                    <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                        <div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{t('period')}</div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{result.payrollPeriod || '—'}</div>
                        </div>
                        <div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{t('punches')}</div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{result.punches.length}</div>
                        </div>
                        <div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{t('people')}</div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{result.employees.length}</div>
                        </div>
                        <div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{t('total_hours')}</div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: checkColor(result.totals.crossCheck) }}>
                                {result.totals.parsedSum.toFixed(2)}
                                {result.totals.reportedGrandTotal !== null && (
                                    <span style={{ fontSize: '0.95rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
                                        {' '}/ {result.totals.reportedGrandTotal.toFixed(2)}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ── Warnings: impossible to miss, never blocking ── */}
                    {(result.hasWarnings || unresolved.length > 0) && (
                        <div className="glass-panel" style={{ padding: '1.5rem', border: '2px solid var(--warning)', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--warning)' }}>
                                <AlertTriangle size={22} />
                                <h2 style={{ fontSize: '1.3rem', margin: 0 }}>{t('review_before_import')}</h2>
                            </div>
                            <ul style={{ margin: 0, paddingLeft: '1.5rem', fontSize: '1.05rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                {totalsMismatch && <li>{t('warn_total_mismatch')}</li>}
                                {mismatchCount > 0 && <li>{t('warn_employee_mismatch', { count: mismatchCount })}</li>}
                                {unresolved.length > 0 && <li>{t('warn_unresolved', { names: unresolved.join(', ') })}</li>}
                                {result.flagged.length > 0 && <li>{t('warn_flagged', { count: result.flagged.length })}</li>}
                                {result.parseErrors.length > 0 && <li>{t('warn_parse_errors', { count: result.parseErrors.length })}</li>}
                            </ul>
                            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '1rem' }}>{t('warn_not_blocking')}</p>
                        </div>
                    )}

                    {/* ── Per employee ── */}
                    <div className="glass-panel" style={{ padding: '1.5rem', overflowX: 'auto' }}>
                        <h2 style={{ fontSize: '1.3rem', marginTop: 0, marginBottom: '1rem' }}>{t('per_employee')}</h2>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
                            <thead>
                                <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                                    <th style={head}>{t('name')}</th>
                                    <th style={head}>{t('clover_id')}</th>
                                    <th style={numericHead}>{t('punch_count')}</th>
                                    <th style={numericHead}>{t('hours')}</th>
                                    <th style={numericHead}>{t('reported')}</th>
                                    <th style={head}>{t('cross_check')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {result.employees.map(e => (
                                    <tr key={e.employeeName} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={cell}>{e.employeeName}</td>
                                        <td style={{ ...cell, color: e.cloverEmployeeId ? 'var(--text-primary)' : 'var(--danger)', fontWeight: e.cloverEmployeeId ? 400 : 600 }}>
                                            {e.cloverEmployeeId ?? t('unresolved')}
                                        </td>
                                        <td style={numericCell}>{e.punchCount}</td>
                                        <td style={numericCell}>{e.hoursSum.toFixed(2)}</td>
                                        <td style={numericCell}>{e.reportedTotal === null ? '—' : e.reportedTotal.toFixed(2)}</td>
                                        <td style={{ ...cell, color: checkColor(e.crossCheck), fontWeight: 600 }}>
                                            {t(`check_${e.crossCheck}`)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* ── Flagged punches ── */}
                    {result.flagged.length > 0 && (
                        <div className="glass-panel" style={{ padding: '1.5rem', border: '1px solid var(--warning)', overflowX: 'auto' }}>
                            <h2 style={{ fontSize: '1.3rem', marginTop: 0, marginBottom: '0.5rem', color: 'var(--warning)' }}>
                                {t('flagged_title', { count: result.flagged.length })}
                            </h2>
                            <p style={{ marginTop: 0, color: 'var(--text-secondary)', fontSize: '1rem' }}>{t('flagged_note')}</p>
                            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '720px' }}>
                                <thead>
                                    <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                                        <th style={head}>{t('name')}</th>
                                        <th style={head}>{t('business_date')}</th>
                                        <th style={head}>{t('clock_in')}</th>
                                        <th style={head}>{t('clock_out')}</th>
                                        <th style={numericHead}>{t('hours')}</th>
                                        <th style={head}>{t('reason')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {result.flagged.map(p => (
                                        <tr key={`${p.employeeName}-${p.csvLine}`} style={{ borderBottom: '1px solid var(--border)' }}>
                                            <td style={cell}>{p.employeeName}</td>
                                            <td style={cell}>{isoDay(p.businessDate)}</td>
                                            <td style={cell}>{nyTime(p.clockIn)}</td>
                                            <td style={{ ...cell, color: p.clockOut ? 'var(--text-primary)' : 'var(--danger)', fontWeight: p.clockOut ? 400 : 600 }}>
                                                {p.clockOut ? nyTime(p.clockOut) : t('no_clock_out')}
                                            </td>
                                            <td style={numericCell}>{p.hours.toFixed(2)}</td>
                                            {/* The parser emits codes, not prose — the locale is chosen here. */}
                                            <td style={{ ...cell, color: 'var(--warning)' }}>
                                                {p.flags.map(f => t(`flag_${f}`)).join('; ')}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* ── Parse errors ── */}
                    {result.parseErrors.length > 0 && (
                        <div className="glass-panel" style={{ padding: '1.5rem', border: '1px solid var(--danger)' }}>
                            <h2 style={{ fontSize: '1.3rem', marginTop: 0, marginBottom: '0.75rem', color: 'var(--danger)' }}>{t('parse_errors')}</h2>
                            <ul style={{ margin: 0, paddingLeft: '1.5rem', fontSize: '1.02rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                {result.parseErrors.map((e, i) => <li key={i}>{e}</li>)}
                            </ul>
                        </div>
                    )}

                    {/* ── Confirm ── */}
                    <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                        <button
                            onClick={handleCommit}
                            className="btn-primary"
                            disabled={isParsing || isCommitting || result.punches.length === 0}
                            style={{ borderRadius: '8px', minHeight: '52px', opacity: isCommitting ? 0.6 : 1 }}
                        >
                            {isCommitting ? t('importing') : t('confirm_import', { count: result.punches.length })}
                        </button>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>{t('replace_note')}</span>
                    </div>
                </>
            )}
        </div>
    );
}
