'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DatePicker } from '@/components/ui/DatePicker';
import { addDays, sundayOf } from '@/lib/payrollWeek';

/**
 * The week picker for the Gastos tab.
 *
 * Its own picker rather than a shared one with PayrollWeekTable: that picker is
 * welded to the payroll table's state and its "next" button is bounded by that
 * view's isLatestComplete. Lifting it would mean giving it a second set of
 * props for a second caller, which is how a component ends up serving neither
 * screen well. This is thirty lines and the same DatePicker underneath.
 *
 * Navigation goes through the URL so a week is linkable and the back button
 * walks the weeks actually looked at. The existing params are cloned rather
 * than replaced — pushing a bare `?week=` would drop ?tab and bounce the reader
 * back to the default tab.
 */
export default function ReportsWeekPicker({
    weekStart,
    weekEnding,
    maxSelectableDate,
}: {
    weekStart: string;
    weekEnding: string;
    /** Sunday ending the most recent complete week; the picker's upper bound. */
    maxSelectableDate: string;
}) {
    const t = useTranslations('Reports');
    const locale = useLocale();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const go = (nextWeekEnding: string) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('week', nextWeekEnding);
        router.push(`${pathname}?${params.toString()}`);
    };

    /**
     * Any picked day resolves to the week containing it: snap to that week's
     * Sunday, which is what `?week=` holds. The empty-string guard is for the
     * picker's clear button, which fires onChange('') — snapping that would
     * produce NaN and navigate nowhere good.
     */
    const pickWeek = (day: string) => {
        if (!day) return;
        go(sundayOf(day));
    };

    const isLatest = weekEnding >= maxSelectableDate;

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }} data-testid="reports-week-picker">
            <button
                onClick={() => go(addDays(weekEnding, -7))}
                aria-label={t('prev_week')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', minHeight: '52px', padding: '0 1rem', borderRadius: '8px', cursor: 'pointer', fontSize: '1.02rem', color: 'var(--text-primary)', background: 'var(--bg-primary)', border: '1px solid var(--border)' }}
            >
                <ChevronLeft size={18} />
                <span>{t('prev_week')}</span>
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={{ fontSize: '0.92rem', color: 'var(--text-secondary)' }}>{t('week')}</span>
                {/* The picker's value is the Monday, but the trigger shows the
                    whole range: the selection stands for a week, and naming one
                    day of it would misdescribe what is on screen. */}
                <DatePicker
                    value={weekStart}
                    label={`${weekStart} — ${weekEnding}`}
                    onChange={pickWeek}
                    locale={locale as 'es' | 'en'}
                    max={maxSelectableDate}
                />
            </div>

            <button
                onClick={() => go(addDays(weekEnding, 7))}
                disabled={isLatest}
                aria-label={t('next_week')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', minHeight: '52px', padding: '0 1rem', borderRadius: '8px', cursor: isLatest ? 'not-allowed' : 'pointer', opacity: isLatest ? 0.45 : 1, fontSize: '1.02rem', color: 'var(--text-primary)', background: 'var(--bg-primary)', border: '1px solid var(--border)' }}
            >
                <span>{t('next_week')}</span>
                <ChevronRight size={18} />
            </button>
        </div>
    );
}
