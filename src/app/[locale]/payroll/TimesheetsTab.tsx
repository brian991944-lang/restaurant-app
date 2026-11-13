'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { WeekPunchesView, WeekPunch, WeekPunchEmployee, WeekPunchSource, WeekTipDay } from '@/app/actions/payroll';
import { DatePicker } from '@/components/ui/DatePicker';
import { addDays, sundayOf } from '@/lib/payrollWeek';
import { toCents, sumCents, formatMoney } from '@/lib/money';

/** Wall-clock time is always the restaurant's, whatever the viewer's device says. */
const NY = 'America/New_York';

const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: NY, hour: 'numeric', minute: '2-digit', hour12: true });
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: NY, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "5:31 PM" -> "5:31pm". */
const clock = (iso: string) => timeFmt.format(new Date(iso)).replace(/\s?(AM|PM)$/i, (m) => m.trim().toLowerCase());

/** Cents as a plain two-decimal hours figure: 3522 -> "35.22". */
const hoursText = (cents: number) => (cents / 100).toFixed(2);

/** The flag codes that have a flag_<CODE> label. Unknown codes are shown raw rather than throwing. */
const KNOWN_FLAGS = new Set(['SIN_SALIDA', 'SALIDA_ANTES_DE_ENTRADA', 'HORAS_MINIMAS', 'HORAS_MAXIMAS', 'SIN_ID_CLOVER', 'DOBLE_MARCAJE']);

const initials = (name: string) =>
    name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';

const cell: React.CSSProperties = { padding: '0.5rem 0.9rem', fontSize: '1.02rem', verticalAlign: 'middle', height: '52px' };
const head: React.CSSProperties = { padding: '0.8rem 0.9rem', fontSize: '0.92rem', fontWeight: 500, whiteSpace: 'nowrap', textAlign: 'left' };
const numCell: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const numHead: React.CSSProperties = { ...head, textAlign: 'right' };

/** Cents as money, or a dash for a figure nobody has typed yet. */
const moneyText = (cents: number | null) => (cents === null ? '—' : formatMoney(cents));

/**
 * The tip-sheet figures for one person's week, in cents. Cash stays null until
 * at least one day has a figure typed, so an untouched week reads "—" rather
 * than a $0.00 that looks confirmed.
 */
const tipTotals = (days: WeekTipDay[]) => ({
    cardC: sumCents(days.map(d => d.cardCents)),
    serviceChargeC: sumCents(days.map(d => d.serviceChargeCents)),
    cashC: days.some(d => d.cashCents !== null) ? sumCents(days.map(d => d.cashCents ?? 0)) : null,
});

/** One line of a person's listing: a time card, or a day the tip sheet has that the time cards do not. */
type Line =
    | { kind: 'punch'; p: WeekPunch; tips: WeekTipDay | null }
    | { kind: 'tipsOnly'; tips: WeekTipDay };

const navBtn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '0.4rem', minHeight: '52px', padding: '0 1rem',
    borderRadius: '8px', fontSize: '1.02rem', color: 'var(--text-primary)',
    background: 'var(--bg-primary)', border: '1px solid var(--border)',
};

function Pill({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', padding: '0.6rem 1rem', borderRadius: '999px', background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{label}</span>
            <span style={{ fontSize: '1.15rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        </div>
    );
}

export default function TimesheetsTab({
    view,
    maxSelectableDate,
}: {
    view: WeekPunchesView;
    /** Sunday ending the most recent complete week; the picker's upper bound. */
    maxSelectableDate: string;
}) {
    const t = useTranslations('Payroll');
    const locale = useLocale();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const go = (weekEnding: string) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('week', weekEnding);
        router.push(`${pathname}?${params.toString()}`);
    };
    const pickWeek = (picked: string) => {
        if (!picked) return;
        go(sundayOf(picked));
    };

    const dateLabel = (businessDate: string) =>
        new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
            .format(new Date(`${businessDate}T00:00:00Z`)).replace(',', '');

    const deptLabel = (d: WeekPunchEmployee['department']) =>
        d === 'COCINA' ? t('ts_dept_cocina') : d === 'SALON' ? t('ts_dept_salon') : '—';

    const sourceLabel: Record<WeekPunchSource, string> = {
        TOAST: t('ts_source_toast'),
        HOMEBASE: t('ts_source_homebase'),
        MANUAL: t('ts_source_manual'),
    };

    // Hours come from the stored column; only the SUMS are done here, in cents.
    const groups = view.employees.map(emp => {
        const punches = [...emp.punches].sort((a, b) => a.clockIn.localeCompare(b.clockIn));

        // Tips are a per-DAY figure and time cards are not: a split shift is two
        // cards on one day. The day's tips go on its first card only, so a
        // column never shows the same money twice; a day the tip sheet has but
        // the time cards do not gets a line of its own, so the column still
        // adds up to the header figure.
        const tipsByDate = new Map(emp.tipDays.map(d => [d.businessDate, d]));
        const seen = new Set<string>();
        const lines: Line[] = punches.map(p => {
            const tips = tipsByDate.get(p.businessDate) ?? null;
            const first = !seen.has(p.businessDate);
            seen.add(p.businessDate);
            return { kind: 'punch', p, tips: first ? tips : null };
        });
        for (const d of emp.department === 'SALON' ? emp.tipDays : []) {
            if (seen.has(d.businessDate)) continue;
            const at = lines.findIndex(l => (l.kind === 'punch' ? l.p.businessDate : l.tips.businessDate) > d.businessDate);
            lines.splice(at === -1 ? lines.length : at, 0, { kind: 'tipsOnly', tips: d });
        }

        return {
            emp, punches, lines,
            isSalon: emp.department === 'SALON',
            cents: sumCents(punches.map(p => toCents(p.hours))),
            ...tipTotals(emp.tipDays),
        };
    });
    const totalC = sumCents(groups.map(g => g.cents));
    const deptC = (d: 'COCINA' | 'SALON') => sumCents(groups.filter(g => g.emp.department === d).map(g => g.cents));
    const cardCount = sumCents(groups.map(g => g.punches.length));

    // The tip columns are for salón only. Whatever the tip sheet may hold for
    // anyone else stays off this screen, so these totals are over the same rows
    // that show figures.
    const salon = groups.filter(g => g.emp.department === 'SALON');
    const totalCardC = sumCents(salon.map(g => g.cardC));
    const totalServiceChargeC = sumCents(salon.map(g => g.serviceChargeC));
    const totalCashC = salon.some(g => g.cashC !== null) ? sumCents(salon.map(g => g.cashC ?? 0)) : null;

    /** The three tip cells, or three empty ones off the salón. */
    const tipCells = (show: boolean, t3: { cardC: number; serviceChargeC: number; cashC: number | null } | null, style: React.CSSProperties) =>
        show && t3 ? (
            <>
                <td style={style}>{moneyText(t3.cardC)}</td>
                <td style={style}>{moneyText(t3.serviceChargeC)}</td>
                <td style={style}>{moneyText(t3.cashC)}</td>
            </>
        ) : (
            <>
                <td style={style} />
                <td style={style} />
                <td style={style} />
            </>
        );
    const dayCells = (d: WeekTipDay | null) =>
        d ? { cardC: d.cardCents, serviceChargeC: d.serviceChargeCents, cashC: d.cashCents } : null;

    const timeCard = (p: WeekPunch) => {
        if (!p.clockOut) {
            return <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{t('ts_no_clock_out')}</span>;
        }
        const out = clock(p.clockOut);
        const nextDay = dayFmt.format(new Date(p.clockOut)) > dayFmt.format(new Date(p.clockIn));
        return (
            <>
                {clock(p.clockIn)} – {out}{nextDay ? ' (+1)' : ''}
                {out === '12:00am' && (
                    <div style={{ fontSize: '0.84rem', color: 'var(--warning)' }}>{t('ts_check_midnight')}</div>
                )}
            </>
        );
    };

    return (
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            {/* ── Week picker ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <button
                    onClick={() => go(addDays(view.weekEnding, -7))}
                    aria-label={t('prev_week')}
                    style={{ ...navBtn, cursor: 'pointer' }}
                >
                    <ChevronLeft size={18} />
                    <span>{t('prev_week')}</span>
                </button>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <span style={{ fontSize: '0.92rem', color: 'var(--text-secondary)' }}>{t('week')}</span>
                    <DatePicker
                        value={view.weekStart}
                        label={`${view.weekStart} — ${view.weekEnding}`}
                        onChange={pickWeek}
                        locale={locale as 'es' | 'en'}
                        max={maxSelectableDate}
                    />
                </div>

                <button
                    onClick={() => go(addDays(view.weekEnding, 7))}
                    disabled={view.isLatestComplete}
                    aria-label={t('next_week')}
                    style={{ ...navBtn, cursor: view.isLatestComplete ? 'not-allowed' : 'pointer', opacity: view.isLatestComplete ? 0.45 : 1 }}
                >
                    <span>{t('next_week')}</span>
                    <ChevronRight size={18} />
                </button>

                {view.isLatestComplete && (
                    <span style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>{t('latest_complete_note')}</span>
                )}
            </div>

            {view.forbidden ? (
                <p style={{ color: 'var(--danger)', fontSize: '1.05rem', margin: 0 }}>{t('ts_forbidden')}</p>
            ) : groups.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: '1.05rem', margin: 0 }}>{t('ts_empty')}</p>
            ) : (
                <>
                    {/* ── Summary pills ── */}
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <Pill label={t('ts_pill_total')} value={hoursText(totalC)} />
                        <Pill label={t('ts_pill_kitchen')} value={hoursText(deptC('COCINA'))} />
                        <Pill label={t('ts_pill_foh')} value={hoursText(deptC('SALON'))} />
                        <Pill label={t('ts_pill_people')} value={String(groups.length)} />
                        <Pill label={t('ts_pill_cards')} value={String(cardCount)} />
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '960px' }}>
                            <thead>
                                <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>
                                    <th style={head}>{t('ts_date')}</th>
                                    <th style={head}>{t('ts_role')}</th>
                                    <th style={head}>{t('ts_time_card')}</th>
                                    <th style={numHead}>{t('ts_actual_hours')}</th>
                                    <th style={numHead}>{t('ts_card_tips')}</th>
                                    <th style={numHead}>{t('ts_service_charge')}</th>
                                    <th style={numHead}>{t('ts_cash_tips')}</th>
                                </tr>
                            </thead>
                            {groups.map(({ emp, punches, lines, isSalon, cents, cardC, serviceChargeC, cashC }) => (
                                <tbody key={emp.key}>
                                    <tr style={{ background: 'var(--bg-secondary)', borderTop: '1px solid var(--border)' }}>
                                        <td style={cell} colSpan={2}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
                                                <span
                                                    aria-hidden
                                                    style={{
                                                        width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
                                                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                        background: 'var(--accent-primary)', color: '#fff', fontSize: '0.85rem', fontWeight: 700,
                                                    }}
                                                >
                                                    {initials(emp.employeeName)}
                                                </span>
                                                <span style={{ fontWeight: 600 }}>{emp.employeeName}</span>
                                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>{deptLabel(emp.department)}</span>
                                            </div>
                                        </td>
                                        <td style={{ ...cell, color: 'var(--text-secondary)' }}>
                                            {t('ts_cards_count', { count: punches.length })}
                                        </td>
                                        <td style={{ ...numCell, fontWeight: 700 }}>{hoursText(cents)}</td>
                                        {tipCells(isSalon, { cardC, serviceChargeC, cashC }, { ...numCell, fontWeight: 700 })}
                                    </tr>
                                    {lines.map(line => {
                                        if (line.kind === 'tipsOnly') {
                                            return (
                                                <tr
                                                    key={`tips:${line.tips.businessDate}`}
                                                    style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                                                >
                                                    <td style={cell}>{dateLabel(line.tips.businessDate)}</td>
                                                    <td style={cell}>{deptLabel(emp.department)}</td>
                                                    <td style={{ ...cell, fontStyle: 'italic' }}>{t('ts_tips_no_card')}</td>
                                                    <td style={numCell} />
                                                    {tipCells(isSalon, dayCells(line.tips), numCell)}
                                                </tr>
                                            );
                                        }
                                        const { p, tips } = line;
                                        const labels = p.flagCodes.filter(c => !(c === 'SIN_SALIDA' && !p.clockOut));
                                        return (
                                            <tr
                                                key={p.id}
                                                style={{
                                                    borderBottom: '1px solid var(--border)',
                                                    background: p.isFlagged ? 'rgba(245, 158, 11, 0.12)' : undefined,
                                                }}
                                            >
                                                <td style={cell}>{dateLabel(p.businessDate)}</td>
                                                <td style={cell}>{deptLabel(emp.department)}</td>
                                                <td style={cell}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                        <span>{timeCard(p)}</span>
                                                        <span style={{ fontSize: '0.78rem', padding: '0.1rem 0.5rem', borderRadius: '999px', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                                                            {sourceLabel[p.sourceKind]}
                                                        </span>
                                                    </div>
                                                    {p.isFlagged && labels.map(code => (
                                                        <div key={code} style={{ fontSize: '0.84rem', color: 'var(--warning)' }}>
                                                            {KNOWN_FLAGS.has(code) ? t(`flag_${code}`) : code}
                                                        </div>
                                                    ))}
                                                </td>
                                                <td style={numCell}>{hoursText(toCents(p.hours))}</td>
                                                {tipCells(isSalon, dayCells(tips), numCell)}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            ))}
                            <tfoot>
                                <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                                    <td style={cell} colSpan={2}>{t('totals')}</td>
                                    <td style={cell}>{t('ts_cards_count', { count: cardCount })}</td>
                                    <td style={numCell}>{hoursText(totalC)}</td>
                                    {tipCells(true, { cardC: totalCardC, serviceChargeC: totalServiceChargeC, cashC: totalCashC }, numCell)}
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}
