'use client';

/**
 * Reseñas del día + tabla del mes, under the tip sheet on /tips-reviews.
 * Server page passes: reviews (getReviewDay), leaderboard (getLeaderboard),
 * staff (getTipEligibleStaff) and the business date being viewed.
 *
 * Tablet-first like the rest of Salón: big tap targets. Copy lives in
 * messages/{es,en}.json under "Reviews".
 */
import { useState, useTransition } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Star, AlertTriangle, Trophy, Link2 } from 'lucide-react';
import { claimGoogleReview, submitExternalReview, type DayReview, type LeaderboardRow } from '@/app/actions/reviewClaims';

type Staff = { id: string; name: string };

const Stars = ({ n, label }: { n: number; label: string }) => (
    <span style={{ display: 'inline-flex', gap: 2 }} aria-label={label}>
        {Array.from({ length: 5 }, (_, i) => (
            <Star key={i} size={18} fill={i < n ? 'var(--warning)' : 'none'} color="var(--warning)" />
        ))}
    </span>
);

function ReviewCard({ r, staff }: { r: DayReview; staff: Staff[] }) {
    const t = useTranslations('Reviews');
    const locale = useLocale();
    const [who, setWho] = useState(r.suggestions[0]?.staffId ?? '');
    const [msg, setMsg] = useState<string | null>(null);
    const [pending, start] = useTransition();
    const suggested = r.suggestions.map(s => s.staffName).join(', ');

    const claim = () => start(async () => {
        const person = staff.find(s => s.id === who);
        if (!person) return setMsg(t('pick_who'));
        const res = await claimGoogleReview({ reviewId: r.id, cloverEmployeeId: person.id, employeeName: person.name });
        setMsg(res.success ? (res.autoApproved ? t('claimed_approved') : t('claimed_pending')) : res.error);
    });

    return (
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem',
            borderLeft: r.isLow ? '4px solid var(--danger)' : undefined }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <Stars n={r.starRating} label={t('stars_aria', { count: r.starRating })} />
                <span style={{ color: 'var(--text-secondary)' }}>
                    {r.reviewerName ?? t('anonymous')} · {new Date(r.createTime).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}
                </span>
            </div>
            {r.isLow && (
                <span style={{ color: 'var(--danger)', fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <AlertTriangle size={18} /> {t('sent_to_management')}
                </span>
            )}
            <p style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-primary)' }}>{r.comment ?? <em>{t('no_comment')}</em>}</p>

            {r.claim ? (
                <p style={{ margin: 0, fontWeight: 600 }}>
                    {r.claim.employeeName} · {r.claim.status === 'APPROVED' ? t('points_awarded', { points: r.claim.points ?? 0 }) : t('awaiting_approval')}
                </p>
            ) : (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    {suggested && <span style={{ color: 'var(--text-secondary)' }}>{t('suggested')} <strong>{suggested}</strong></span>}
                    <select value={who} onChange={e => setWho(e.target.value)} style={{ minHeight: 48, fontSize: '1.05rem' }}>
                        <option value="">{t('who_claims')}</option>
                        {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <button className="btn-primary" style={{ minHeight: 48 }} disabled={pending} onClick={claim}>{t('claim')}</button>
                </div>
            )}
            {msg && <span style={{ color: 'var(--text-secondary)' }}>{msg}</span>}
        </div>
    );
}

function ExternalForm({ staff, businessDate }: { staff: Staff[]; businessDate: string }) {
    const t = useTranslations('Reviews');
    const [source, setSource] = useState<'YELP' | 'RESY' | 'OPENTABLE'>('RESY');
    const [url, setUrl] = useState('');
    const [who, setWho] = useState('');
    const [msg, setMsg] = useState<string | null>(null);
    const [pending, start] = useTransition();

    const submit = () => start(async () => {
        const person = staff.find(s => s.id === who);
        if (!person || !url) return setMsg(t('missing_link_or_who'));
        const res = await submitExternalReview({ source, url, reviewDate: businessDate, cloverEmployeeId: person.id, employeeName: person.name });
        setMsg(res.success ? t('external_sent') : res.error);
        if (res.success) setUrl('');
    });

    return (
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <Link2 size={20} />
            <select value={source} onChange={e => setSource(e.target.value as typeof source)} style={{ minHeight: 48 }}>
                <option value="RESY">Resy</option><option value="OPENTABLE">OpenTable</option><option value="YELP">Yelp</option>
            </select>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder={t('review_link')}
                style={{ flex: '1 1 260px', minHeight: 48, fontSize: '1.05rem' }} />
            <select value={who} onChange={e => setWho(e.target.value)} style={{ minHeight: 48 }}>
                <option value="">{t('who')}</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="btn-primary" style={{ minHeight: 48 }} disabled={pending} onClick={submit}>{t('add')}</button>
            {msg && <span style={{ width: '100%', color: 'var(--text-secondary)' }}>{msg}</span>}
        </div>
    );
}

export default function ReviewsPanel({ reviews, leaderboard, staff, businessDate }: {
    reviews: DayReview[]; leaderboard: LeaderboardRow[]; staff: Staff[]; businessDate: string;
}) {
    const t = useTranslations('Reviews');
    return (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.75rem' }}>{t('day_title', { count: reviews.length })}</h2>
            {reviews.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>{t('none_today')}</p>}
            {reviews.map(r => <ReviewCard key={r.id} r={r} staff={staff} />)}

            <h3 style={{ margin: '0.5rem 0 0', fontSize: '1.3rem' }}>{t('external_title')}</h3>
            <ExternalForm staff={staff} businessDate={businessDate} />

            <h2 style={{ margin: '1rem 0 0', fontSize: '1.75rem', display: 'flex', gap: 8, alignItems: 'center' }}>
                <Trophy size={26} /> {t('leaderboard_title')}
            </h2>
            <div className="glass-panel" style={{ padding: '1rem 1.25rem' }}>
                {leaderboard.length === 0 ? <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('leaderboard_empty')}</p> :
                    leaderboard.map((row, i) => (
                        <div key={row.cloverEmployeeId} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0',
                            fontSize: '1.15rem', fontWeight: i === 0 ? 700 : 500 }}>
                            <span>{i + 1}. {row.employeeName}</span>
                            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                                {t('points_row', { points: row.points })}{row.pending ? t('pending_row', { count: row.pending }) : ''}
                            </span>
                        </div>
                    ))}
            </div>
        </section>
    );
}
