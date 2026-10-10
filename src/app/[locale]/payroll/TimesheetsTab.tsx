'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { WeekPunchesView, WeekPunch, WeekPunchEmployee, WeekPunchSource } from '@/app/actions/payroll';
import { DatePicker } from '@/components/ui/DatePicker';
import { addDays, sundayOf } from '@/lib/payrollWeek';
import { toCents, sumCents } from '@/lib/money';

/** Wall-clock time is always the restaurant's, whatever the viewer's device says. */
const NY = 'America/New_York';

const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: NY, hour: 'numeric', minute: '2-digit', hour12: true });
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: NY, year: 'numeric', month: '2-digit', day: '2-digit' });

/** "5:31 PM" -> "5:31pm". */
const clock = (iso: string) => timeFmt.format(new Date(iso)).replace(/\s?(AM|PM)$/i, (m) => m.trim().toLowerCase());

/** Cents as a plain two-decimal hours figure: 3522 -> "35.22". */
const hoursText = (cents: number) => (cents / 100).toFixed(2);

/** The flag codes that have a flag_<CODE> label. Unknown codes are shown raw rather than throwing. */
const KNOWN_FLAGS = new Set(['SIN_SALIDA', 'SALIDA_ANTES_DE_ENTRADA', 'HORAS_MINIMAS', 'HORAS_MAXIMAS', 'SIN_ID_CLOVER']);

const initials = (name: string) =>
    name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';

const cell: React.CSSProperties = { padding: '0.5rem 0.9rem', fontSize: '1.02rem', verticalAlign: 'middle', height: '52px' };
const head: React.CSSProperties = { padding: '0.8rem 0.9rem', fontSize: '0.92rem', fontWeight: 500, whiteSpace: 'nowrap', textAlign: 'left' };
const numCell: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

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
        return { emp, punches, cents: sumCents(punches.map(p => toCents(p.hours))) };
    });
    const totalC = sumCents(groups.map(g => g.cents));
    const deptC = (d: 'COCINA' | 'SALON') => sumCents(groups.filter(g => g.emp.department === d).map(g => g.cents));
    const cardCount = sumCents(groups.map(g => g.punches.length));

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
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
                            <thead>
                                <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>
                                    <th style={head}>{t('ts_date')}</th>
                                    <th style={head}>{t('ts_role')}</th>
                                    <th style={head}>{t('ts_time_card')}</th>
                                    <th style={{ ...head, textAlign: 'right' }}>{t('ts_actual_hours')}</th>
                                </tr>
                            </thead>
                            {groups.map(({ emp, punches, cents }) => (
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
                                    </tr>
                                    {punches.map(p => {
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
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}
