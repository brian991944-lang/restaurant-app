import { getTranslations } from 'next-intl/server';
import { CheckCircle2 } from 'lucide-react';
import { getTipDay, ensureTipDay } from '@/app/actions/tips';
import { getWaitStaff } from '@/app/actions/clover';
import { formatBusinessDateEs } from '@/lib/businessDay';
import { toCents, formatMoney } from '@/lib/money';
import TipDayEditor from './TipDayEditor';

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

export default async function TipsReviewsPage() {
    const t = await getTranslations('Tips');

    // Reading never creates. Arriving on this page is the intent to work on the
    // day, so this is the one place a day is brought into existence.
    let day = await getTipDay();
    let openError: string | null = null;
    if (!day) {
        const opened = await ensureTipDay();
        if (opened.success) day = opened.day;
        else openError = opened.error;
    }

    const { staff, error: staffError } = await getWaitStaff();
    const headerDate = formatBusinessDateEs(day ? new Date(day.businessDate) : new Date());

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

            {openError && (
                <div className="glass-panel" style={{ padding: '1.5rem' }}>
                    <p style={{ margin: 0, color: 'var(--danger)', fontSize: '1.1rem' }}>{openError}</p>
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
                        <MetricCard
                            label={t('total_cash')}
                            value={formatMoney(toCents(day.totalCashTips))}
                        />
                    </div>

                    {staffError && (
                        <p style={{ margin: 0, color: 'var(--danger)', fontSize: '1.05rem' }}>{staffError}</p>
                    )}

                    <TipDayEditor day={day} staff={staff} />
                </>
            )}
        </div>
    );
}
