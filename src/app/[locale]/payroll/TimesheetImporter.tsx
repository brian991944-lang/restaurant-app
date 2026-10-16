'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Upload } from 'lucide-react';
import {
    parseTimesheet,
    commitTimesheet,
    commitToastTimesheet,
    saveToastNameMapping,
    type EmployeeOption,
} from '@/app/actions/punches';
import type { TimesheetParseResult, CrossCheck, ParsedPunch } from '@/lib/timesheetParse';

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

/** A Toast row starts unchecked only when it carries no hours. */
const defaultInclude = (p: ParsedPunch) => p.hours !== 0;

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

    // Toast only. The text is kept so a saved name mapping can re-parse it.
    const [csvText, setCsvText] = useState<string>('');
    const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
    /** Include checkbox per row, keyed by csvLine — stable across a re-parse. */
    const [included, setIncluded] = useState<Record<number, boolean>>({});
    /** Employee picked for each unresolved Toast name, not yet saved. */
    const [picks, setPicks] = useState<Record<string, string>>({});
    const [savingName, setSavingName] = useState<string | null>(null);

    /** Show a parse result, keeping any Include choices already made. */
    const applyResult = (res: TimesheetParseResult) => {
        setResult(res);
        if (res.format === 'TOAST') {
            setIncluded(prev => {
                const next: Record<number, boolean> = {};
                for (const p of res.punches) next[p.csvLine] = prev[p.csvLine] ?? defaultInclude(p);
                return next;
            });
        }
    };

    const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsParsing(true);
        setError(null);
        setRosterError(null);
        setDone(null);
        setResult(null);
        setIncluded({});
        setPicks({});
        setFileName(file.name);

        try {
            // The file's actual contents — not a placeholder. Everything the
            // preview shows is derived from this text.
            const text = await file.text();
            setCsvText(text);
            const res = await parseTimesheet(text, file.name);

            if (res.rosterError) setRosterError(res.rosterError);
            if (!res.success || !res.result) {
                setError(res.error ?? t('parse_failed'));
            } else {
                applyResult(res.result);
                setEmployeeOptions(res.employeeOptions ?? []);
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

    const handleSaveMapping = async (toastName: string) => {
        const id = picks[toastName];
        if (!id) return;
        setSavingName(toastName);
        setError(null);
        try {
            const saved = await saveToastNameMapping(toastName, id);
            if (!saved.success) {
                setError(saved.error ?? t('toast_map_failed'));
                return;
            }
            // Re-parse rather than patch locally, so the preview is exactly
            // what the next upload of this file would show.
            const res = await parseTimesheet(csvText, fileName);
            if (res.success && res.result) applyResult(res.result);
            else setError(res.error ?? t('parse_failed'));
        } finally {
            setSavingName(null);
        }
    };

    const isToast = result?.format === 'TOAST';
    const toImport = result
        ? (isToast ? result.punches.filter(p => included[p.csvLine]) : result.punches)
        : [];

    const handleCommit = async () => {
        if (!result || toImport.length === 0) return;
        setIsCommitting(true);
        setError(null);

        const punches = toImport.map(p => ({
            businessDate: p.businessDate,
            employeeName: p.employeeName,
            cloverEmployeeId: p.cloverEmployeeId,
            clockIn: p.clockIn,
            clockOut: p.clockOut,
            hours: p.hours,
            isFlagged: p.isFlagged,
            flagReason: p.flagReason,
        }));

        const res = isToast
            ? await commitToastTimesheet(punches, fileName ?? '', result.periodStart, result.periodEnd)
            : await commitTimesheet(punches, batchId, result.periodStart, result.periodEnd, fileName);

        if (res.success) {
            setDone(t('import_done', { created: res.created ?? 0, replaced: res.replaced ?? 0 }));
            setResult(null);
            setFileName(null);
            setCsvText('');
        } else {
            setError(res.error ?? t('import_failed'));
        }
        setIsCommitting(false);
    };

    const mismatchCount = result?.employees.filter(e => e.crossCheck !== 'OK').length ?? 0;
    const totalsMismatch = result ? result.totals.crossCheck !== 'OK' : false;
    const unresolved = result?.unresolvedNames ?? [];
    const excludedCount = isToast && result ? result.punches.length - toImport.length : 0;

    // Toast has no totals rows, so its summary is the rows that will be written.
    const employees = isToast && result
        ? result.employees
            .map(e => {
                const rows = toImport.filter(p => p.employeeName === e.employeeName);
                return {
                    ...e,
                    punchCount: rows.length,
                    hoursSum: rows.reduce((s, p) => s + p.hours, 0),
                    toastNames: [...new Set(result.punches.filter(p => p.employeeName === e.employeeName).map(p => p.sourceName ?? ''))].join(', '),
                };
            })
        : (result?.employees ?? []).map(e => ({ ...e, toastNames: '' }));
    const totalHours = isToast ? toImport.reduce((s, p) => s + p.hours, 0) : (result?.totals.parsedSum ?? 0);

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
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{t('toast_format')}</div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{isToast ? t('ts_source_toast') : t('ts_source_homebase')}</div>
                        </div>
                        <div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{t('period')}</div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{result.payrollPeriod || '—'}</div>
                        </div>
                        <div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{t('punches')}</div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{toImport.length}</div>
                        </div>
                        <div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{t('people')}</div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{result.employees.length}</div>
                        </div>
                        <div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{t('total_hours')}</div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: isToast ? 'var(--text-primary)' : checkColor(result.totals.crossCheck) }}>
                                {totalHours.toFixed(2)}
                                {result.totals.reportedGrandTotal !== null && (
                                    <span style={{ fontSize: '0.95rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
                                        {' '}/ {result.totals.reportedGrandTotal.toFixed(2)}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ── Warnings: impossible to miss, never blocking ── */}
                    {(result.hasWarnings || unresolved.length > 0 || excludedCount > 0) && (
                        <div className="glass-panel" style={{ padding: '1.5rem', border: '2px solid var(--warning)', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--warning)' }}>
                                <AlertTriangle size={22} />
                                <h2 style={{ fontSize: '1.3rem', margin: 0 }}>{t('review_before_import')}</h2>
                            </div>
                            <ul style={{ margin: 0, paddingLeft: '1.5rem', fontSize: '1.05rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                {/* Toast files have no totals rows, so there is nothing to mismatch. */}
                                {!isToast && totalsMismatch && <li>{t('warn_total_mismatch')}</li>}
                                {!isToast && mismatchCount > 0 && <li>{t('warn_employee_mismatch', { count: mismatchCount })}</li>}
                                {unresolved.length > 0 && (
                                    <li>{isToast ? t('toast_warn_unresolved', { names: unresolved.join(', ') }) : t('warn_unresolved', { names: unresolved.join(', ') })}</li>
                                )}
                                {result.flagged.length > 0 && <li>{t('warn_flagged', { count: result.flagged.length })}</li>}
                                {excludedCount > 0 && <li>{t('toast_warn_excluded', { count: excludedCount })}</li>}
                                {result.parseErrors.length > 0 && <li>{t('warn_parse_errors', { count: result.parseErrors.length })}</li>}
                            </ul>
                            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '1rem' }}>{t('warn_not_blocking')}</p>
                        </div>
                    )}

                    {/* ── Toast: map each unmatched name to an employee, once ── */}
                    {isToast && unresolved.length > 0 && (
                        <div className="glass-panel" style={{ padding: '1.5rem', border: '1px solid var(--warning)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <h2 style={{ fontSize: '1.3rem', margin: 0 }}>{t('toast_map_title')}</h2>
                                <p style={{ margin: '0.4rem 0 0', color: 'var(--text-secondary)', fontSize: '1rem' }}>{t('toast_map_note')}</p>
                            </div>
                            {unresolved.map(name => (
                                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: '1.1rem', fontWeight: 600, minWidth: '11rem' }}>{name}</span>
                                    <select
                                        value={picks[name] ?? ''}
                                        onChange={e => setPicks(prev => ({ ...prev, [name]: e.target.value }))}
                                        disabled={savingName !== null}
                                        aria-label={`${t('toast_map_pick')} ${name}`}
                                        style={{ minHeight: '52px', minWidth: '14rem', padding: '0 0.75rem', fontSize: '1.05rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                                    >
                                        <option value="">{t('toast_map_pick')}</option>
                                        {employeeOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                    </select>
                                    <button
                                        onClick={() => handleSaveMapping(name)}
                                        className="btn-primary"
                                        disabled={!picks[name] || savingName !== null}
                                        style={{ minHeight: '52px', borderRadius: '8px', opacity: !picks[name] ? 0.5 : 1 }}
                                    >
                                        {savingName === name ? t('toast_map_saving') : t('toast_map_save')}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* ── Per employee ── */}
                    <div className="glass-panel" style={{ padding: '1.5rem', overflowX: 'auto' }}>
                        <h2 style={{ fontSize: '1.3rem', marginTop: 0, marginBottom: '1rem' }}>{t('per_employee')}</h2>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
                            <thead>
                                <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                                    <th style={head}>{t('name')}</th>
                                    {isToast && <th style={head}>{t('toast_name')}</th>}
                                    <th style={head}>{t('clover_id')}</th>
                                    <th style={numericHead}>{t('punch_count')}</th>
                                    <th style={numericHead}>{t('hours')}</th>
                                    {!isToast && <th style={numericHead}>{t('reported')}</th>}
                                    {!isToast && <th style={head}>{t('cross_check')}</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {employees.map(e => (
                                    <tr key={e.employeeName} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={cell}>{e.employeeName}</td>
                                        {isToast && <td style={{ ...cell, color: 'var(--text-secondary)' }}>{e.toastNames}</td>}
                                        <td style={{ ...cell, color: e.cloverEmployeeId ? 'var(--text-primary)' : 'var(--danger)', fontWeight: e.cloverEmployeeId ? 400 : 600 }}>
                                            {e.cloverEmployeeId ?? t('unresolved')}
                                        </td>
                                        <td style={numericCell}>{e.punchCount}</td>
                                        <td style={numericCell}>{e.hoursSum.toFixed(2)}</td>
                                        {!isToast && <td style={numericCell}>{e.reportedTotal === null ? '—' : e.reportedTotal.toFixed(2)}</td>}
                                        {!isToast && (
                                            <td style={{ ...cell, color: checkColor(e.crossCheck), fontWeight: 600 }}>
                                                {t(`check_${e.crossCheck}`)}
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* ── Toast: every row, with its Include checkbox ── */}
                    {isToast && (
                        <div className="glass-panel" style={{ padding: '1.5rem', overflowX: 'auto' }}>
                            <h2 style={{ fontSize: '1.3rem', marginTop: 0, marginBottom: '0.5rem' }}>
                                {t('toast_rows_title', { count: result.punches.length })}
                            </h2>
                            <p style={{ marginTop: 0, color: 'var(--text-secondary)', fontSize: '1rem' }}>{t('toast_rows_note')}</p>
                            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '820px' }}>
                                <thead>
                                    <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                                        <th style={{ ...head, width: '5.5rem' }}>{t('toast_include')}</th>
                                        <th style={head}>{t('name')}</th>
                                        <th style={head}>{t('business_date')}</th>
                                        <th style={head}>{t('clock_in')}</th>
                                        <th style={head}>{t('clock_out')}</th>
                                        <th style={numericHead}>{t('hours')}</th>
                                        <th style={head}>{t('reason')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {result.punches.map(p => {
                                        const doubleTap = p.flags.includes('DOBLE_MARCAJE');
                                        const on = !!included[p.csvLine];
                                        return (
                                            <tr
                                                key={p.csvLine}
                                                style={{
                                                    borderBottom: '1px solid var(--border)',
                                                    background: doubleTap ? 'rgba(239, 68, 68, 0.12)' : undefined,
                                                    boxShadow: doubleTap ? 'inset 4px 0 0 var(--danger)' : undefined,
                                                    opacity: on ? 1 : 0.55,
                                                }}
                                            >
                                                <td style={{ ...cell, padding: 0 }}>
                                                    {/* The whole cell is the tap target, not just the box. */}
                                                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '56px', cursor: 'pointer' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={on}
                                                            onChange={e => setIncluded(prev => ({ ...prev, [p.csvLine]: e.target.checked }))}
                                                            aria-label={`${t('toast_include')} ${p.employeeName} ${nyTime(p.clockIn)}`}
                                                            style={{ width: '26px', height: '26px', cursor: 'pointer' }}
                                                        />
                                                    </label>
                                                </td>
                                                <td style={cell}>{p.employeeName}</td>
                                                <td style={cell}>{isoDay(p.businessDate)}</td>
                                                <td style={cell}>{nyTime(p.clockIn)}</td>
                                                <td style={{ ...cell, color: p.clockOut ? 'var(--text-primary)' : 'var(--danger)', fontWeight: p.clockOut ? 400 : 600 }}>
                                                    {p.clockOut ? nyTime(p.clockOut) : t('no_clock_out')}
                                                </td>
                                                <td style={numericCell}>{p.hours.toFixed(2)}</td>
                                                <td style={{ ...cell, color: doubleTap ? 'var(--danger)' : 'var(--warning)', fontWeight: doubleTap ? 600 : 400 }}>
                                                    {p.flags.map(f => t(`flag_${f}`)).join('; ')}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* ── Flagged punches (Homebase; Toast shows flags on every row above) ── */}
                    {!isToast && result.flagged.length > 0 && (
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
                            disabled={isParsing || isCommitting || savingName !== null || toImport.length === 0}
                            style={{ borderRadius: '8px', minHeight: '52px', opacity: isCommitting ? 0.6 : 1 }}
                        >
                            {isCommitting ? t('importing') : t('confirm_import', { count: toImport.length })}
                        </button>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>{isToast ? t('toast_replace_note') : t('replace_note')}</span>
                    </div>
                </>
            )}
        </div>
    );
}
