'use client';

/**
 * Admin-only block on /tips-reviews: claims waiting for approval and low
 * reviews to follow up. The page renders it only when isAdminSession().
 */
import { useState, useTransition } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { AlertTriangle, Check, X } from 'lucide-react';
import { decideClaim, resolveFollowUp, type PendingClaim, type OpenFollowUp } from '@/app/actions/reviewClaims';

const SOURCE_LABEL = { GOOGLE: 'Google', YELP: 'Yelp', RESY: 'Resy', OPENTABLE: 'OpenTable' } as const;

function ClaimRow({ c }: { c: PendingClaim }) {
    const t = useTranslations('Reviews');
    const locale = useLocale();
    const [stars, setStars] = useState<number>(c.starRating ?? 5);
    const [done, setDone] = useState<string | null>(null);
    const [pending, start] = useTransition();
    const needsStars = c.source !== 'GOOGLE';

    const decide = (approve: boolean) => start(async () => {
        const res = await decideClaim({
            claimId: c.id, approve, decidedBy: 'Gerencia',
            starRating: needsStars ? stars : undefined,
            rejectReason: approve ? undefined : 'Rechazada por gerencia',
        });
        setDone(res.success ? (approve ? t('approved') : t('rejected')) : res.error ?? t('error'));
    });

    return (
        <div className="glass-panel" style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <strong>{c.employeeName} · {SOURCE_LABEL[c.source]}</strong>
                <span style={{ color: 'var(--text-secondary)' }}>{new Date(c.claimedAt).toLocaleString(locale)}</span>
            </div>
            {c.comment && <p style={{ margin: 0 }}>{c.comment}</p>}
            {c.url && (
                <a href={c.url} target="_blank" rel="noreferrer noopener" style={{ wordBreak: 'break-all' }}>{t('open_review')}</a>
            )}
            {c.source === 'GOOGLE' && (
                <span style={{ color: 'var(--text-secondary)' }}>
                    {c.suggestedName ? t('names_server', { name: c.suggestedName }) : t('names_nobody')}
                </span>
            )}
            {done ? <strong>{done}</strong> : (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    {needsStars && (
                        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            {t('stars_label')}
                            <select value={stars} onChange={e => setStars(Number(e.target.value))} style={{ minHeight: 44 }}>
                                {[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                        </label>
                    )}
                    <button className="btn-primary" style={{ minHeight: 44 }} disabled={pending} onClick={() => decide(true)}>
                        <Check size={18} /> {t('approve')}
                    </button>
                    <button style={{ minHeight: 44, padding: "0 1rem", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-primary)" }} disabled={pending} onClick={() => decide(false)}>
                        <X size={18} /> {t('reject')}
                    </button>
                </div>
            )}
        </div>
    );
}

function FollowUpRow({ f }: { f: OpenFollowUp }) {
    const t = useTranslations('Reviews');
    const [note, setNote] = useState('');
    const [done, setDone] = useState(false);
    const [pending, start] = useTransition();
    const resolve = () => start(async () => {
        if (!note.trim()) return;
        const res = await resolveFollowUp({ id: f.id, note: note.trim(), resolvedBy: 'Gerencia' });
        if (res.success) setDone(true);
    });
    if (done) return null;
    return (
        <div className="glass-panel" style={{ padding: '1rem 1.25rem', borderLeft: '4px solid var(--danger)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <strong>{t('low_heading', { count: f.starRating, source: SOURCE_LABEL[f.source], reviewer: f.reviewerName ?? t('anonymous') })}</strong>
            {f.comment && <p style={{ margin: 0 }}>{f.comment}</p>}
            {f.url && <a href={f.url} target="_blank" rel="noreferrer noopener">{t('open_review')}</a>}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <input value={note} onChange={e => setNote(e.target.value)} placeholder={t('resolution_placeholder')}
                    style={{ flex: '1 1 260px', minHeight: 44 }} />
                <button className="btn-primary" style={{ minHeight: 44 }} disabled={pending || !note.trim()} onClick={resolve}>{t('resolved')}</button>
            </div>
        </div>
    );
}

export default function ReviewsManagerPanel({ claims, followUps }: { claims: PendingClaim[]; followUps: OpenFollowUp[] }) {
    const t = useTranslations('Reviews');
    return (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.6rem', display: 'flex', gap: 8, alignItems: 'center' }}>
                <AlertTriangle size={24} color="var(--danger)" /> {t('low_title', { count: followUps.length })}
            </h2>
            {followUps.length === 0 && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('none_pending')}</p>}
            {followUps.map(f => <FollowUpRow key={f.id} f={f} />)}

            <h2 style={{ margin: '0.5rem 0 0', fontSize: '1.6rem' }}>{t('claims_title', { count: claims.length })}</h2>
            {claims.length === 0 && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('no_claims')}</p>}
            {claims.map(c => <ClaimRow key={c.id} c={c} />)}
        </section>
    );
}
