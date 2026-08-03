'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Move a 'YYYY-MM-DD' date by whole days.
 *
 * Pure calendar arithmetic through UTC, so it never picks up the viewer's
 * timezone — stepping back from the 1st must land on the previous month's last
 * day regardless of where the tablet thinks it is.
 */
function shiftDate(date: string, days: number): string {
    const [y, m, d] = date.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + days));
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

const control: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
    minHeight: '52px', padding: '0 1rem', borderRadius: '8px',
    fontSize: '1rem', fontWeight: 600, cursor: 'pointer',
    color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.05)',
    border: '1px solid var(--border)'
};

export default function DateNavigator({ date, today }: { date: string; today: string }) {
    const t = useTranslations('Tips');
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const isToday = date === today;

    /**
     * Navigation goes through the URL rather than local state, so a day is
     * linkable and the back button walks the days you actually looked at.
     * Today drops the parameter entirely, keeping the canonical URL clean.
     */
    const go = (next: string) => {
        if (!next) return;
        const params = new URLSearchParams(searchParams.toString());
        if (next === today) params.delete('date');
        else params.set('date', next);
        const query = params.toString();
        router.push(query ? `${pathname}?${query}` : pathname);
    };

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button
                onClick={() => go(shiftDate(date, -1))}
                title={t('previous_day')}
                aria-label={t('previous_day')}
                style={control}
            >
                <ChevronLeft size={18} />
            </button>

            <input
                type="date"
                value={date}
                // The business day is as far forward as there is anything to
                // look at; a future day could only ever be empty.
                max={today}
                onChange={e => go(e.target.value)}
                style={{
                    minHeight: '52px', padding: '0 0.8rem', borderRadius: '8px',
                    fontSize: '1rem', color: 'var(--text-primary)',
                    background: 'var(--bg-primary)', border: '1px solid var(--border)'
                }}
            />

            <button
                onClick={() => go(shiftDate(date, 1))}
                disabled={isToday}
                title={t('next_day')}
                aria-label={t('next_day')}
                style={{
                    ...control,
                    cursor: isToday ? 'not-allowed' : 'pointer',
                    opacity: isToday ? 0.4 : 1
                }}
            >
                <ChevronRight size={18} />
            </button>

            {/* Only worth offering when it would actually go somewhere. */}
            {!isToday && (
                <button onClick={() => go(today)} style={control}>
                    {t('today')}
                </button>
            )}
        </div>
    );
}
