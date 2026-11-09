'use client';

/**
 * Reseñas del día + tabla del mes, under the tip sheet on /tips-reviews.
 * Server page passes: reviews (getReviewDay), leaderboard (getLeaderboard),
 * staff (getTipEligibleStaff) and the business date being viewed.
 *
 * Tablet-first like the rest of Salón: big tap targets, Spanish copy inline
 * here for the draft; move strings to messages/es.json under "Reviews" when
 * wiring it in.
 */
import { useState, useTransition } from 'react';
import { Star, AlertTriangle, Trophy, Link2 } from 'lucide-react';
import { claimGoogleReview, submitExternalReview, type DayReview, type LeaderboardRow } from '@/app/actions/reviewClaims';

type Staff = { id: string; name: string };

const Stars = ({ n }: { n: number }) => (
    <span style={{ display: 'inline-flex', gap: 2 }} aria-label={`${n} estrellas`}>
        {Array.from({ length: 5 }, (_, i) => (
            <Star key={i} size={18} fill={i < n ? 'var(--warning)' : 'none'} color="var(--warning)" />
        ))}
    </span>
);

function ReviewCard({ r, staff }: { r: DayReview; staff: Staff[] }) {
    const [who, setWho] = useState(r.suggestions[0]?.staffId ?? '');
    const [msg, setMsg] = useState<string | null>(null);
    const [pending, start] = useTransition();
    const suggested = r.suggestions.map(s => s.staffName).join(', ');

    const claim = () => start(async () => {
        const person = staff.find(s => s.id === who);
        if (!person) return setMsg('Elige quién la reclama.');
        const res = await claimGoogleReview({ reviewId: r.id, cloverEmployeeId: person.id, employeeName: person.name });
        setMsg(res.success ? (res.autoApproved ? 'Reclamada y aprobada.' : 'Reclamada. Falta aprobación de gerencia.') : res.error);
    });

    return (
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem',
            borderLeft: r.isLow ? '4px solid var(--danger)' : undefined }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <Stars n={r.starRating} />
                <span style={{ color: 'var(--text-secondary)' }}>
                    {r.reviewerName ?? 'Anónimo'} · {new Date(r.createTime).toLocaleTimeString('es', { hour: 'numeric', minute: '2-digit' })}
                </span>
            </div>
            {r.isLow && (
                <span style={{ color: 'var(--danger)', fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center' }}>
                    <AlertTriangle size={18} /> Enviada a gerencia para seguimiento
                </span>
            )}
            <p style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-primary)' }}>{r.comment ?? <em>Sin comentario</em>}</p>

            {r.claim ? (
                <p style={{ margin: 0, fontWeight: 600 }}>
                    {r.claim.employeeName} · {r.claim.status === 'APPROVED' ? `+${r.claim.points ?? 0} pts` : 'pendiente de aprobación'}
                </p>
            ) : (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    {suggested && <span style={{ color: 'var(--text-secondary)' }}>Sugerido: <strong>{suggested}</strong></span>}
                    <select value={who} onChange={e => setWho(e.target.value)} style={{ minHeight: 48, fontSize: '1.05rem' }}>
                        <option value="">¿Quién la reclama?</option>
                        {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <button className="btn-primary" style={{ minHeight: 48 }} disabled={pending} onClick={claim}>Reclamar</button>
                </div>
            )}
            {msg && <span style={{ color: 'var(--text-secondary)' }}>{msg}</span>}
        </div>
    );
}

function ExternalForm({ staff, businessDate }: { staff: Staff[]; businessDate: string }) {
    const [source, setSource] = useState<'YELP' | 'RESY' | 'OPENTABLE'>('RESY');
    const [url, setUrl] = useState('');
    const [who, setWho] = useState('');
    const [msg, setMsg] = useState<string | null>(null);
    const [pending, start] = useTransition();

    const submit = () => start(async () => {
        const person = staff.find(s => s.id === who);
        if (!person || !url) return setMsg('Falta el enlace o quién la reclama.');
        const res = await submitExternalReview({ source, url, reviewDate: businessDate, cloverEmployeeId: person.id, employeeName: person.name });
        setMsg(res.success ? 'Enviada. Gerencia la revisa y aprueba.' : res.error);
        if (res.success) setUrl('');
    });

    return (
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <Link2 size={20} />
            <select value={source} onChange={e => setSource(e.target.value as typeof source)} style={{ minHeight: 48 }}>
                <option value="RESY">Resy</option><option value="OPENTABLE">OpenTable</option><option value="YELP">Yelp</option>
            </select>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="Enlace de la reseña"
                style={{ flex: '1 1 260px', minHeight: 48, fontSize: '1.05rem' }} />
            <select value={who} onChange={e => setWho(e.target.value)} style={{ minHeight: 48 }}>
                <option value="">¿Quién?</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="btn-primary" style={{ minHeight: 48 }} disabled={pending} onClick={submit}>Agregar</button>
            {msg && <span style={{ width: '100%', color: 'var(--text-secondary)' }}>{msg}</span>}
        </div>
    );
}

export default function ReviewsPanel({ reviews, leaderboard, staff, businessDate }: {
    reviews: DayReview[]; leaderboard: LeaderboardRow[]; staff: Staff[]; businessDate: string;
}) {
    return (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.75rem' }}>Reseñas del día ({reviews.length})</h2>
            {reviews.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>No hay reseñas de Google para este día todavía.</p>}
            {reviews.map(r => <ReviewCard key={r.id} r={r} staff={staff} />)}

            <h3 style={{ margin: '0.5rem 0 0', fontSize: '1.3rem' }}>Reseña de Resy, OpenTable o Yelp</h3>
            <ExternalForm staff={staff} businessDate={businessDate} />

            <h2 style={{ margin: '1rem 0 0', fontSize: '1.75rem', display: 'flex', gap: 8, alignItems: 'center' }}>
                <Trophy size={26} /> Competencia del mes
            </h2>
            <div className="glass-panel" style={{ padding: '1rem 1.25rem' }}>
                {leaderboard.length === 0 ? <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Aún no hay puntos este mes.</p> :
                    leaderboard.map((row, i) => (
                        <div key={row.cloverEmployeeId} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0',
                            fontSize: '1.15rem', fontWeight: i === 0 ? 700 : 500 }}>
                            <span>{i + 1}. {row.employeeName}</span>
                            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                                {row.points} pts{row.pending ? ` · ${row.pending} pendientes` : ''}
                            </span>
                        </div>
                    ))}
            </div>
        </section>
    );
}
