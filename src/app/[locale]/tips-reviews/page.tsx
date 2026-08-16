import { getTranslations } from 'next-intl/server';
import { CheckCircle2 } from 'lucide-react';
import { getTipDay, ensureTipDay } from '@/app/actions/tips';
import { getTipEligibleStaff } from '@/app/actions/clover';
import { formatBusinessDateEs, getBusinessDate, businessDateToUtcDate } from '@/lib/businessDay';
import { toCents, formatMoney } from '@/lib/money';
import TipDayEditor from './TipDayEditor';
import DateNavigator from './DateNavigator';

const isBusinessDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Sentence-case the first character only. CSS `capitalize` would title-case
 * every word ("Domingo, 2 De Agosto De 2026"); Spanish wants the month and the
 * connecting words left lowercase exactly as Intl produced them.
 */
const upperFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function MetricCard({ label, value, note }: { label: string; value: string; note?: string }) {
    return (
        <div
            className="glass-panel"
            style={{ padding: '1.5rem', flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}
        >
            <span style={{ fontSize: '1rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>
            <span style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                {value}
            </span>
            {note && <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{note}</span>}
        </div>
    );
}

export default async function TipsReviewsPage({
    searchParams
}: {
    searchParams: Promise<{ date?: string | string[] }>;
}) {
    const t = await getTranslations('Tips');

    const { date: rawDate } = await searchParams;
    const requested = Array.isArray(rawDate) ? rawDate[0] : rawDate;
    const today = getBusinessDate();

    // Anything unusable falls back to today rather than erroring: a mistyped or
    // hand-edited URL should land somewhere sensible. A future date is treated
    // the same way — there is nothing there to look at yet.
    const viewDate =
        requested && isBusinessDate(requested) && requested <= today ? requested : today;
    const isHistorical = viewDate !== today;
    const dateValue = businessDateToUtcDate(viewDate);

    // Reading never creates. Opening TODAY is the intent to work on it, so that
    // is the one case a day is brought into existence — looking at a past day
    // must never manufacture a record that never existed.
    let day = await getTipDay(dateValue);
    let openError: string | null = null;
    if (!day && !isHistorical) {
        const opened = await ensureTipDay(dateValue);
        if (opened.success) day = opened.day;
        else openError = opened.error;
    }

    // Tip-eligible, not merely Wait Staff: somebody who works the floor under a
    // different Clover role is added here by the includeInTips flag.
    const { staff, error: staffError } = await getTipEligibleStaff();
    const headerDate = formatBusinessDateEs(dateValue);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '1100px', margin: '0 auto', padding: '1.5rem' }}>

            <div>
                <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                    {t('title')}
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', margin: 0 }}>
                    {t('subtitle')}
                </p>
                <p style={{ color: 'var(--text-primary)', fontSize: '1.25rem', fontWeight: 600, margin: '0.75rem 0 0 0' }}>
                    {upperFirst(headerDate)}
                </p>
            </div>

            <DateNavigator date={viewDate} today={today} />

            {openError && (
                <div className="glass-panel" style={{ padding: '1.5rem' }}>
                    <p style={{ margin: 0, color: 'var(--danger)', fontSize: '1.1rem' }}>{openError}</p>
                </div>
            )}

            {/* A past day with no record is a normal answer, not a failure —
                the restaurant simply did not record tips that day. */}
            {!day && isHistorical && (
                <div className="glass-panel" style={{ padding: '1.5rem' }}>
                    <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '1.1rem' }}>
                        {t('no_record_for_date')}
                    </p>
                </div>
            )}

            {day && (
                <>
                    {day.status === 'ENVIADO' && (
                        <div style={{
                            padding: '1.25rem 1.5rem', borderRadius: '12px',
                            background: 'color-mix(in srgb, var(--success) 12%, transparent)',
                            border: '1px solid color-mix(in srgb, var(--success) 35%, transparent)',
                            display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap'
                        }}>
                            <CheckCircle2 size={22} color="var(--success)" />
                            <span style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--success)' }}>
                                {t('submitted')}
                            </span>
                            {day.submittedByName && (
                                <span style={{ fontSize: '1.05rem', color: 'var(--text-secondary)' }}>
                                    · {t('submitted_by')}: {day.submittedByName}
                                </span>
                            )}
                            {day.submittedAt && (
                                <span style={{ fontSize: '1.05rem', color: 'var(--text-secondary)' }}>
                                    · {new Date(day.submittedAt).toLocaleString('es')}
                                </span>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                        <MetricCard
                            label={t('total_tips')}
                            value={formatMoney(toCents(day.totalCreditTips))}
                            note={day.cloverSyncedAt ? t('clover_synced') : undefined}
                        />
                        <MetricCard
                            label={t('total_service_charge')}
                            value={formatMoney(toCents(day.totalServiceCharge))}
                            note={day.cloverSyncedAt ? t('clover_synced') : undefined}
                        />
                        {/* No cash card: cash has no day total to show. It is
                            recorded per person in the shift tables and is not
                            reconciled against anything. */}
                    </div>

                    {staffError && (
                        <p style={{ margin: 0, color: 'var(--danger)', fontSize: '1.05rem' }}>{staffError}</p>
                    )}

                    <TipDayEditor day={day} staff={staff} isHistorical={isHistorical} />
                </>
            )}
        </div>
    );
}
