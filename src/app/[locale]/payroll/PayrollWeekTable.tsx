'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, ChevronLeft, ChevronRight, CornerDownLeft } from 'lucide-react';
import {
    savePayrollEntry,
    saveRetentionSetting,
    type PayrollWeekView,
    type PayrollRow,
} from '@/app/actions/payroll';
import { DatePicker } from '@/components/ui/DatePicker';
import { addDays, sundayOf } from '@/lib/payrollWeek';
import { calcPaySplit } from '@/lib/payrollCalc';
import { toCents, formatMoney } from '@/lib/money';

/** Which sub-tab is showing. Mirrored in the URL so a view is linkable. */
type Tab = 'salon' | 'cocina';

/**
 * Rows for a tab. A row with no resolved department belongs to NEITHER, so it
 * is shown under BOTH — vanishing from the tab someone expected to find it in
 * is how an unpaid person goes unnoticed. SIN_DEPARTAMENTO prompts the fix.
 */
function rowsForTab(rows: PayrollRow[], tab: Tab): PayrollRow[] {
    const want = tab === 'salon' ? 'SALON' : 'COCINA';
    return rows.filter(r => r.department === null || r.department === want);
}

const cell: React.CSSProperties = { padding: '0.8rem 0.9rem', fontSize: '1.02rem', verticalAlign: 'top' };
const head: React.CSSProperties = { padding: '0.8rem 0.9rem', fontSize: '0.92rem', fontWeight: 500, whiteSpace: 'nowrap' };
const numCell: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const numHead: React.CSSProperties = { ...head, textAlign: 'right' };

/**
 * Tapping a money field highlights what is in it, so the first keystroke
 * replaces the whole amount instead of landing beside it. Selecting rather than
 * blanking on focus: clearing would leave a tap-and-leave-without-typing
 * showing an empty box that reads as a deliberate zero.
 */
const selectAllOnFocus = (e: React.FocusEvent<HTMLInputElement>) => e.currentTarget.select();

const smallInput: React.CSSProperties = {
    width: '110px', padding: '0.5rem 0.6rem', minHeight: '48px',
    fontSize: '1.02rem', borderRadius: '8px', textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--text-primary)', background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
};

/**
 * "27.00 h x $6.05 + 8.20 h x $8.50" — the roles behind a blended rate.
 *
 * Capped at two terms. Three roles cannot occur today (there are only two), but
 * a third would push the line past the column rather than wrapping it, so the
 * remainder is summarised instead.
 */
function breakdownText(parts: { hours: number; rate: number }[]): string {
    const term = (p: { hours: number; rate: number }) => `${p.hours.toFixed(2)} h x $${p.rate.toFixed(2)}`;
    if (parts.length <= 2) return parts.map(term).join(' + ');
    return `${parts.slice(0, 2).map(term).join(' + ')} + …`;
}

/**
 * Flags that name something fixable on the configuration panel below, so the
 * flag carries the user there instead of describing a problem and leaving them
 * to go and find the screen.
 */
const LINKED_FLAGS = new Set(['SIN_TARIFA', 'SIN_DEPARTAMENTO']);

/** A row's role line and warning flags. Shared by both tabs. */
function RowFlags({ row, t }: { row: PayrollRow; t: (k: string) => string }) {
    return (
        <>
            {row.roles.length > 0 && (
                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    {row.roles.map(r => t(`role_${r}`)).join(' + ')}
                </div>
            )}
            {row.flags.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', marginTop: '0.35rem' }}>
                    {row.flags.map(f => {
                        const label = (
                            <>
                                <AlertTriangle size={14} />
                                {t(`rowflag_${f}`)}
                            </>
                        );
                        const style: React.CSSProperties = {
                            display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                            color: 'var(--warning)', fontSize: '0.88rem',
                        };
                        return LINKED_FLAGS.has(f) ? (
                            <a key={f} href="#employee-config" style={{ ...style, textDecoration: 'underline' }}>
                                {label}
                            </a>
                        ) : (
                            <span key={f} style={style}>{label}</span>
                        );
                    })}
                </div>
            )}
        </>
    );
}

type Draft = { adp: string; retActive: boolean; retPct: string };

/**
 * A row's draft as it starts life, from whatever is already saved for it.
 *
 * The single definition used by the initial seed, the week-change rebuild and
 * the defensive read below — three copies of this would be three chances for a
 * row to start out different depending on which path reached it.
 */
function draftFromRow(r: PayrollRow): Draft {
    return {
        // Never prefilled with the suggestion — a typed figure and a suggested
        // one must not be indistinguishable.
        adp: r.savedAdpTips !== null ? r.savedAdpTips.toFixed(2) : '',
        retActive: r.retentionActive,
        retPct: r.retentionPercentage.toFixed(2),
    };
}

export default function PayrollWeekTable({
    view,
    maxSelectableDate,
}: {
    view: PayrollWeekView;
    /** Sunday ending the most recent complete week; the picker's upper bound. */
    maxSelectableDate: string;
}) {
    const t = useTranslations('Payroll');
    const locale = useLocale();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
        Object.fromEntries(view.rows.map(r => [r.key, draftFromRow(r)]))
    );

    const [savingKey, setSavingKey] = useState<string | null>(null);
    const [rowError, setRowError] = useState<Record<string, string>>({});
    const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({});

    /** The week the current drafts belong to, to tell navigation from a refresh. */
    const draftWeek = useRef(view.weekEnding);

    /**
     * Rebuild the drafts when the view changes.
     *
     * A useState initializer runs once for the life of the component, and
     * navigating between weeks re-renders it with a new `view` rather than
     * remounting — so without this the drafts stay keyed to the week you came
     * from, and any person not in both weeks reads back undefined.
     *
     * Within ONE week the merge follows TipDayEditor: rows already known keep
     * their unsaved edits, unseen rows get a fresh draft, and rows no longer
     * present are dropped by only iterating the new list. That is what makes the
     * router.refresh() after a save non-destructive.
     *
     * Across weeks everything is rebuilt instead. row.key is the Clover employee
     * id, which is the SAME key in every week — unlike TipDayEditor's globally
     * unique shift ids — so preserving by key would carry an ADP figure typed
     * for one week into another, where saving it would write it against the
     * wrong week. A stale draft here is somebody's money in the wrong column.
     */
    useEffect(() => {
        const weekChanged = draftWeek.current !== view.weekEnding;
        draftWeek.current = view.weekEnding;

        setDrafts(prev => {
            let changed = weekChanged || Object.keys(prev).length !== view.rows.length;
            const next: Record<string, Draft> = {};
            for (const r of view.rows) {
                if (!weekChanged && r.key in prev) {
                    next[r.key] = prev[r.key];
                } else {
                    next[r.key] = draftFromRow(r);
                    changed = true;
                }
            }
            // Returning prev unchanged keeps a new `view.rows` identity on every
            // server render from causing a pointless re-render.
            return changed ? next : prev;
        });

        // Per-row status belongs to the week it was earned in: a "Guardado" badge
        // or an error message must not follow a person across the picker.
        if (weekChanged) {
            setSavedKeys(prev => (Object.keys(prev).length ? {} : prev));
            setRowError(prev => (Object.keys(prev).length ? {} : prev));
            setSavingKey(prev => (prev === null ? prev : null));
        }
    }, [view.weekEnding, view.rows]);

    /**
     * A row's draft, or one derived from the row itself.
     *
     * The effect above should always have seeded it, but this is read during
     * render — including the render that happens BEFORE an effect runs. Seeding
     * correctly is not enough on its own; the default is what makes a missing
     * draft impossible to crash on.
     */
    const draftFor = (row: PayrollRow): Draft => drafts[row.key] ?? draftFromRow(row);

    const patch = (row: PayrollRow, next: Partial<Draft>) => {
        setDrafts(d => ({ ...d, [row.key]: { ...(d[row.key] ?? draftFromRow(row)), ...next } }));
        setSavedKeys(s => ({ ...s, [row.key]: false }));
    };

    /**
     * Navigation goes through the URL rather than local state, so a week is
     * linkable and the back button walks the weeks you actually looked at.
     * The existing params are cloned rather than replaced — pushing a bare
     * `?week=` would silently drop anything else on the query string.
     */
    const go = (weekEnding: string) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('week', weekEnding);
        const query = params.toString();
        router.push(query ? `${pathname}?${query}` : pathname);
    };

    const goWeek = (delta: number) => go(addDays(view.weekEnding, delta * 7));

    // The tab lives in the URL beside ?week, so a specific view can be sent to
    // someone rather than described to them.
    const tab: Tab = searchParams.get('dept') === 'cocina' ? 'cocina' : 'salon';
    const setTab = (next: Tab) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('dept', next);
        router.push(`${pathname}?${params.toString()}`);
    };

    const salonRows = rowsForTab(view.rows, 'salon');
    const cocinaRows = rowsForTab(view.rows, 'cocina');
    const shownRows = tab === 'salon' ? salonRows : cocinaRows;

    /** Per-tab totals, summed from what each row actually renders. */
    const totals = shownRows.reduce(
        (t, row) => {
            const d = draftFor(row);
            const wage = row.weekWageCents ?? 0;
            const tips = Math.round(row.tipsTotal * 100);
            const adp = toCents(d.adp);
            if (tab === 'salon') {
                return {
                    hours: t.hours + row.hoursWorked,
                    wage: t.wage + wage,
                    tips: t.tips + tips,
                    adp: t.adp + wage + adp,
                    check: t.check + (tips - adp),
                };
            }
            // Kitchen has no tips: the split comes from their configured ADP
            // hours and rate, not from anything typed into the row.
            const split = row.hourlyRate === null ? null : calcPaySplit({
                hours: row.hoursWorked,
                hourlyRate: row.hourlyRate,
                adpHours: row.adpHours,
                adpRate: row.adpRate,
            });
            return {
                hours: t.hours + row.hoursWorked,
                wage: t.wage + wage,
                tips: t.tips,
                adp: t.adp + (split?.adpTotalCents ?? 0),
                check: t.check + (split?.checkTotalCents ?? 0),
            };
        },
        { hours: 0, wage: 0, tips: 0, adp: 0, check: 0 }
    );

    /**
     * Any picked day resolves to the week containing it: snap to that Monday,
     * then address the week by its Sunday, which is what `?week=` holds.
     *
     * The empty-string guard is for the picker's "Limpiar" button, which fires
     * onChange('') — snapping that would produce NaN and navigate nowhere good.
     */
    const pickWeek = (picked: string) => {
        if (!picked) return;
        go(sundayOf(picked));
    };

    const handleSave = async (row: PayrollRow) => {
        if (!row.cloverEmployeeId) return;
        const draft = draftFor(row);

        setSavingKey(row.key);
        setRowError(e => ({ ...e, [row.key]: '' }));

        const adp = toCents(draft.adp) / 100;
        const entry = await savePayrollEntry(view.weekEnding, row.cloverEmployeeId, adp);

        let failure = entry.success ? null : (entry.error ?? t('row_save_failed'));

        if (!failure) {
            const ret = await saveRetentionSetting(
                row.cloverEmployeeId,
                row.employeeName,
                draft.retActive,
                Number(draft.retPct) || 0
            );
            if (!ret.success) failure = ret.error ?? t('row_save_failed');
        }

        if (failure) setRowError(e => ({ ...e, [row.key]: failure! }));
        else {
            setSavedKeys(s => ({ ...s, [row.key]: true }));
            router.refresh();
        }
        setSavingKey(null);
    };

    return (
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            {/* ── Week picker ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <button
                    onClick={() => goWeek(-1)}
                    aria-label={t('prev_week')}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', minHeight: '52px', padding: '0 1rem', borderRadius: '8px', cursor: 'pointer', fontSize: '1.02rem', color: 'var(--text-primary)', background: 'var(--bg-primary)', border: '1px solid var(--border)' }}
                >
                    <ChevronLeft size={18} />
                    <span>{t('prev_week')}</span>
                </button>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <span style={{ fontSize: '0.92rem', color: 'var(--text-secondary)' }}>{t('week')}</span>
                    {/* The picker's value is the Monday, but the trigger shows the
                        whole range: the selection stands for a week, and naming
                        one day of it would misdescribe what is on screen. */}
                    <DatePicker
                        value={view.weekStart}
                        label={`${view.weekStart} — ${view.weekEnding}`}
                        onChange={pickWeek}
                        locale={locale as 'es' | 'en'}
                        max={maxSelectableDate}
                    />
                </div>

                <button
                    onClick={() => goWeek(1)}
                    disabled={view.isLatestComplete}
                    aria-label={t('next_week')}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', minHeight: '52px', padding: '0 1rem', borderRadius: '8px', cursor: view.isLatestComplete ? 'not-allowed' : 'pointer', opacity: view.isLatestComplete ? 0.45 : 1, fontSize: '1.02rem', color: 'var(--text-primary)', background: 'var(--bg-primary)', border: '1px solid var(--border)' }}
                >
                    <span>{t('next_week')}</span>
                    <ChevronRight size={18} />
                </button>

                {view.isLatestComplete && (
                    <span style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>{t('latest_complete_note')}</span>
                )}
            </div>

            {/* ── Sub-tabs ── */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {([['salon', t('tab_salon'), salonRows.length], ['cocina', t('tab_cocina'), cocinaRows.length]] as const).map(
                    ([key, label, count]) => (
                        <button
                            key={key}
                            onClick={() => setTab(key)}
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                                minHeight: '52px', padding: '0 1.2rem', borderRadius: '8px',
                                fontSize: '1.05rem', fontWeight: 600, cursor: 'pointer',
                                color: tab === key ? '#fff' : 'var(--text-primary)',
                                background: tab === key ? 'var(--accent-primary)' : 'var(--bg-primary)',
                                border: '1px solid var(--border)',
                            }}
                        >
                            <span>{label}</span>
                            <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.85 }}>({count})</span>
                        </button>
                    )
                )}
            </div>

            {shownRows.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: '1.05rem', margin: 0 }}>{t('no_rows')}</p>
            ) : tab === 'cocina' ? (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1120px' }}>
                        <thead>
                            <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                                <th style={head}>{t('name')}</th>
                                <th style={numHead}>{t('hours')}</th>
                                <th style={numHead}>{t('rate')}</th>
                                <th style={numHead}>{t('total_earned')}</th>
                                <th style={numHead}>{t('adp_hours')}</th>
                                <th style={numHead}>{t('adp_rate')}</th>
                                <th style={numHead}>{t('adp_total')}</th>
                                <th style={numHead}>{t('check')}</th>
                                <th style={head}>{t('retention')}</th>
                                <th style={numHead}>{t('retained')}</th>
                                <th style={head}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {shownRows.map(row => {
                                const draft = draftFor(row);
                                const unlinked = !row.cloverEmployeeId;
                                const noRate = row.hourlyRate === null;
                                const locked = unlinked || noRate;

                                // The kitchen split is entirely configuration-driven:
                                // their ADP hours and rate come from EmployeeRate, so
                                // nothing on this row is typed except retention.
                                const split = noRate ? null : calcPaySplit({
                                    hours: row.hoursWorked,
                                    hourlyRate: row.hourlyRate!,
                                    adpHours: row.adpHours,
                                    adpRate: row.adpRate,
                                });

                                const pct = Number(draft.retPct) || 0;
                                const retainedC = draft.retActive && split
                                    ? Math.round(split.checkTotalCents * pct / 100)
                                    : null;

                                return (
                                    <tr key={row.key} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={cell}>
                                            <div style={{ fontWeight: 600 }}>{row.employeeName}</div>
                                            <RowFlags row={row} t={t} />
                                        </td>
                                        <td style={numCell}>{row.hoursWorked.toFixed(2)}</td>
                                        <td style={numCell}>
                                            {noRate
                                                ? <span style={{ color: 'var(--warning)' }}>—</span>
                                                : formatMoney(Math.round((row.effectiveRate ?? row.hourlyRate!) * 100))}
                                        </td>
                                        <td style={{ ...numCell, fontWeight: 700 }}>
                                            {row.weekWageCents === null ? '—' : formatMoney(row.weekWageCents)}
                                        </td>
                                        <td style={numCell}>
                                            {split === null ? '—' : split.effectiveAdpHours.toFixed(2)}
                                            {row.adpHours === null && (
                                                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{t('adp_hours_placeholder')}</div>
                                            )}
                                        </td>
                                        <td style={numCell}>
                                            {split === null ? '—' : formatMoney(Math.round(split.effectiveAdpRate * 100))}
                                            {row.adpRate === null && (
                                                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{t('adp_rate_placeholder')}</div>
                                            )}
                                        </td>
                                        <td style={numCell}>{split === null ? '—' : formatMoney(split.adpTotalCents)}</td>
                                        <td style={numCell}>{split === null ? '—' : formatMoney(split.checkTotalCents)}</td>
                                        <td style={cell}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={draft.retActive}
                                                    disabled={locked}
                                                    onChange={e => patch(row, { retActive: e.target.checked })}
                                                    style={{ width: '22px', height: '22px', cursor: locked ? 'not-allowed' : 'pointer' }}
                                                />
                                                <input
                                                    type="number" step="0.01" min="0" max="100" inputMode="decimal"
                                                    value={draft.retPct}
                                                    disabled={locked || !draft.retActive}
                                                    onFocus={selectAllOnFocus}
                                                    onChange={e => patch(row, { retPct: e.target.value })}
                                                    style={{ ...smallInput, width: '84px', opacity: (locked || !draft.retActive) ? 0.5 : 1 }}
                                                />
                                                <span style={{ color: 'var(--text-secondary)' }}>%</span>
                                            </div>
                                        </td>
                                        <td style={numCell}>
                                            {retainedC === null ? (
                                                <span style={{ color: 'var(--text-secondary)' }}>—</span>
                                            ) : (
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                                                    <span style={{ fontWeight: 700 }}>{formatMoney(retainedC)}</span>
                                                    <span style={{ fontSize: '0.84rem', color: 'var(--warning)' }}>
                                                        {t('retained_not_recorded')}
                                                    </span>
                                                </div>
                                            )}
                                        </td>
                                        <td style={cell}>
                                            <button
                                                onClick={() => handleSave(row)}
                                                className="btn-primary"
                                                disabled={locked || savingKey === row.key}
                                                style={{ borderRadius: '8px', minHeight: '48px', whiteSpace: 'nowrap', opacity: (locked || savingKey === row.key) ? 0.55 : 1 }}
                                            >
                                                {savingKey === row.key ? t('saving') : savedKeys[row.key] ? t('saved') : t('save')}
                                            </button>
                                            {noRate && !unlinked && (
                                                <a href="#employee-config" style={{ display: 'block', fontSize: '0.86rem', color: 'var(--warning)', marginTop: '0.3rem', maxWidth: '160px', textDecoration: 'underline' }}>
                                                    {t('no_rate_cannot_save')}
                                                </a>
                                            )}
                                            {rowError[row.key] && (
                                                <div style={{ fontSize: '0.86rem', color: 'var(--danger)', marginTop: '0.3rem', maxWidth: '160px' }}>
                                                    {rowError[row.key]}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                                <td style={cell}>{t('totals')}</td>
                                <td style={numCell}>{totals.hours.toFixed(2)}</td>
                                <td style={numCell}></td>
                                <td style={numCell}>{formatMoney(totals.wage)}</td>
                                <td style={numCell}></td>
                                <td style={numCell}></td>
                                <td style={numCell}>{formatMoney(totals.adp)}</td>
                                <td style={numCell}>{formatMoney(totals.check)}</td>
                                <td style={cell}></td>
                                <td style={numCell}></td>
                                <td style={cell}></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            ) : (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1320px' }}>
                        <thead>
                            <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                                <th style={head}>{t('name')}</th>
                                <th style={numHead}>{t('hours')}</th>
                                <th style={numHead}>{t('rate')}</th>
                                <th style={numHead}>{t('wage')}</th>
                                <th style={numHead}>{t('tips')}</th>
                                <th style={numHead}>{t('total')}</th>
                                <th style={numHead}>{t('adp_tips')}</th>
                                <th style={numHead}>{t('adp_total')}</th>
                                <th style={numHead}>{t('check_tips')}</th>
                                <th style={head}>{t('retention')}</th>
                                <th style={numHead}>{t('retained')}</th>
                                <th style={head}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {shownRows.map(row => {
                                const draft = draftFor(row);

                                // No resolved rate means no wage, and everything
                                // derived from a wage is unknown rather than zero.
                                // A $0.00 in these cells would read as a computed
                                // figure; a dash reads as the absence of one.
                                const noRate = row.hourlyRate === null;
                                // Straight from the action: the sum of per-day
                                // wages. Multiplying hours by the blended rate
                                // here would disagree with it by cents.
                                const wageC = row.weekWageCents;
                                const tipsC = Math.round(row.tipsTotal * 100);
                                const adpC = toCents(draft.adp);
                                const adpTotalC = wageC === null ? null : wageC + adpC;
                                const checkC = tipsC - adpC;

                                // (hours × minimum wage) − wage + cushion. Never
                                // written anywhere; it is a number to read.
                                const suggestedC = wageC === null ? null : Math.max(
                                    0,
                                    Math.round(row.hoursWorked * view.rateConfig.minimumWage * 100)
                                    - wageC
                                    + Math.round(view.rateConfig.cushionAmount * 100)
                                );

                                const pct = Number(draft.retPct) || 0;
                                const retainedC = draft.retActive ? Math.round(checkC * pct / 100) : null;

                                const unlinked = !row.cloverEmployeeId;
                                // Both conditions make the row unsettleable, so
                                // one flag drives every disabled state below.
                                const locked = unlinked || noRate;

                                return (
                                    <tr key={row.key} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={cell}>
                                            <div style={{ fontWeight: 600 }}>{row.employeeName}</div>
                                            <RowFlags row={row} t={t} />
                                        </td>

                                        <td style={numCell}>{row.hoursWorked.toFixed(2)}</td>
                                        <td style={numCell}>
                                            {row.hourlyRate === null ? (
                                                <span style={{ color: 'var(--warning)' }}>—</span>
                                            ) : (
                                                <>
                                                    {formatMoney(Math.round((row.effectiveRate ?? row.hourlyRate) * 100))}
                                                    {/* Always visible, never a tooltip: this runs on a tablet,
                                                        where there is no hover to reveal it. One line, clipped
                                                        rather than wrapped — a wrapping cell breaks the row
                                                        alignment the whole table is read across. */}
                                                    {row.rateBreakdown.length > 1 && (
                                                        <div
                                                            title={breakdownText(row.rateBreakdown)}
                                                            style={{
                                                                fontSize: '0.82rem', color: 'var(--text-secondary)',
                                                                fontWeight: 400, marginTop: '0.15rem',
                                                                whiteSpace: 'nowrap', overflow: 'hidden',
                                                                textOverflow: 'ellipsis', maxWidth: '190px',
                                                                marginLeft: 'auto',
                                                            }}
                                                        >
                                                            {breakdownText(row.rateBreakdown)}
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </td>
                                        <td style={numCell}>{wageC === null ? '—' : formatMoney(wageC)}</td>
                                        <td style={numCell}>{formatMoney(tipsC)}</td>
                                        <td style={{ ...numCell, fontWeight: 700 }}>
                                            {wageC === null ? '—' : formatMoney(wageC + tipsC)}
                                        </td>

                                        <td style={numCell}>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                inputMode="decimal"
                                                value={draft.adp}
                                                disabled={locked}
                                                onFocus={selectAllOnFocus}
                                                onChange={e => patch(row, { adp: e.target.value })}
                                                style={{ ...smallInput, opacity: locked ? 0.5 : 1 }}
                                            />
                                            <div style={{ marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.35rem', justifyContent: 'flex-end' }}>
                                                <span style={{ fontSize: '0.86rem', color: 'var(--text-secondary)' }}>
                                                    {t('suggested')}: {suggestedC === null ? '—' : formatMoney(suggestedC)}
                                                </span>
                                                <button
                                                    onClick={() => suggestedC !== null && patch(row, { adp: (suggestedC / 100).toFixed(2) })}
                                                    disabled={locked || suggestedC === null}
                                                    title={t('use_suggested')}
                                                    aria-label={t('use_suggested')}
                                                    style={{ display: 'inline-flex', alignItems: 'center', padding: '0.3rem', borderRadius: '6px', cursor: (locked || suggestedC === null) ? 'not-allowed' : 'pointer', color: 'var(--text-primary)', background: 'var(--bg-primary)', border: '1px solid var(--border)' }}
                                                >
                                                    <CornerDownLeft size={14} />
                                                </button>
                                            </div>
                                        </td>

                                        <td style={numCell}>{adpTotalC === null ? '—' : formatMoney(adpTotalC)}</td>
                                        <td style={{ ...numCell, color: checkC < 0 ? 'var(--danger)' : 'var(--text-primary)' }}>
                                            {formatMoney(checkC)}
                                        </td>

                                        <td style={cell}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={draft.retActive}
                                                    disabled={locked}
                                                    onChange={e => patch(row, { retActive: e.target.checked })}
                                                    style={{ width: '22px', height: '22px', cursor: locked ? 'not-allowed' : 'pointer' }}
                                                />
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    min="0"
                                                    max="100"
                                                    inputMode="decimal"
                                                    value={draft.retPct}
                                                    disabled={locked || !draft.retActive}
                                                    onFocus={selectAllOnFocus}
                                                    onChange={e => patch(row, { retPct: e.target.value })}
                                                    style={{ ...smallInput, width: '84px', opacity: (locked || !draft.retActive) ? 0.5 : 1 }}
                                                />
                                                <span style={{ color: 'var(--text-secondary)' }}>%</span>
                                            </div>
                                        </td>

                                        <td style={numCell}>
                                            {retainedC === null ? (
                                                <span style={{ color: 'var(--text-secondary)' }}>—</span>
                                            ) : (
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                                                    <span style={{ fontWeight: 700 }}>{formatMoney(retainedC)}</span>
                                                    {/* Nothing writes RetentionLedger yet. Saying so on the
                                                        figure itself is the only thing stopping it from
                                                        reading as money already set aside. */}
                                                    <span style={{ fontSize: '0.84rem', color: 'var(--warning)' }}>
                                                        {t('retained_not_recorded')}
                                                    </span>
                                                </div>
                                            )}
                                        </td>

                                        <td style={cell}>
                                            <button
                                                onClick={() => handleSave(row)}
                                                className="btn-primary"
                                                disabled={locked || savingKey === row.key}
                                                style={{ borderRadius: '8px', minHeight: '48px', whiteSpace: 'nowrap', opacity: (locked || savingKey === row.key) ? 0.55 : 1 }}
                                            >
                                                {savingKey === row.key ? t('saving') : savedKeys[row.key] ? t('saved') : t('save')}
                                            </button>
                                            {noRate && !unlinked && (
                                                <a
                                                    href="#employee-config"
                                                    style={{ display: 'block', fontSize: '0.86rem', color: 'var(--warning)', marginTop: '0.3rem', maxWidth: '160px', textDecoration: 'underline' }}
                                                >
                                                    {t('no_rate_cannot_save')}
                                                </a>
                                            )}
                                            {unlinked && (
                                                <div style={{ fontSize: '0.86rem', color: 'var(--warning)', marginTop: '0.3rem', maxWidth: '160px' }}>
                                                    {t('unlinked_cannot_save')}
                                                </div>
                                            )}
                                            {rowError[row.key] && (
                                                <div style={{ fontSize: '0.86rem', color: 'var(--danger)', marginTop: '0.3rem', maxWidth: '160px' }}>
                                                    {rowError[row.key]}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot>
                            <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                                <td style={cell}>{t('totals')}</td>
                                <td style={numCell}>{totals.hours.toFixed(2)}</td>
                                <td style={numCell}></td>
                                <td style={numCell}>{formatMoney(totals.wage)}</td>
                                <td style={numCell}>{formatMoney(totals.tips)}</td>
                                <td style={numCell}>{formatMoney(totals.wage + totals.tips)}</td>
                                <td style={numCell}></td>
                                <td style={numCell}>{formatMoney(totals.adp)}</td>
                                <td style={numCell}>{formatMoney(totals.check)}</td>
                                <td style={cell}></td>
                                <td style={numCell}></td>
                                <td style={cell}></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
        </div>
    );
}
