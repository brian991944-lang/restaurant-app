'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { getAnalyticsReputation } from '@/app/actions/analytics';
import type { AnalyticsReputationResult, ReviewLite, ThemeKey } from '@/lib/analytics/reputation';
import { emptyMetricDay } from '@/lib/analytics/reputation';
import type { DateRange } from '@/lib/analytics/range';
import { datesBetween } from '@/lib/analytics/range';
import { DayBars, Tile, useDateLabels, numStyle, panelStyle, PAID_COLOR, OPEN_COLOR, CASH_COLOR, GRID_COLOR, pctText } from './charts';

/**
 * Analytics › Reputación: Google reviews and Business Profile performance for
 * the window, from the tables /api/gbp/sync fills every morning. Reviews are
 * dated by the New York calendar day Google shows; performance figures lag
 * two or three days behind, and the page says up to when they reach.
 *
 * The themes and dish mentions are keyword tallies on the review text, with
 * the review's own stars as the only sentiment signal — stated as such.
 */

const STAR = '★';
const PURPLE = 'var(--accent-secondary)';

const starsText = (n: number) => STAR.repeat(Math.max(0, Math.min(5, Math.round(n))));
const intText = (n: number) => n.toLocaleString('en-US');
const pct1 = (part: number, whole: number) => (whole > 0 ? (Math.round((part / whole) * 1000) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 }) : '0');

function useAnalyticsReputation(range: DateRange) {
    const t = useTranslations('Analytics');
    const [data, setData] = useState<AnalyticsReputationResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        getAnalyticsReputation(range.from, range.to)
            .then(res => {
                if (cancelled) return;
                if (res.success) { setData(res); setError(null); }
                else setError(res.code === 'NOT_ADMIN' ? t('err_admin') : res.code === 'BAD_DATE' ? t('err_range') : t('rep_err_read'));
            })
            .catch(() => { if (!cancelled) setError(t('err_rejected')); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [range.from, range.to]);
    return { data, error, loading };
}

export default function ReputacionView({ locale, range, today }: { locale: string; range: DateRange; today: string }) {
    const t = useTranslations('Analytics');
    const { data, error, loading } = useAnalyticsReputation(range);
    const { dayLabel } = useDateLabels(locale);
    /** Reviews answered from this page in this session, so the list updates without a refetch. */
    const [repliedHere, setRepliedHere] = useState<Set<string>>(new Set());

    if (error) return <p style={{ margin: 0, color: 'var(--danger)' }}>{error}</p>;
    if (!data) return <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('loading')}</p>;

    const s = data.summary;
    const prev = data.previous.summary;
    const m = data.metricTotals;
    const pm = data.previous.metrics;
    const days = datesBetween(data.range.from, data.range.to);
    const deltaPct = (cur: number, before: number) => {
        if (before === 0) return <span style={{ color: 'var(--text-secondary)' }}>{t('delta_na')}</span>;
        const pct = Math.round(((cur - before) / before) * 1000) / 10;
        return <span style={{ color: pct >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>{pctText(pct)} <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>{t('delta_vs')}</span></span>;
    };
    const deltaStars = s.avgStars !== null && prev.avgStars !== null
        ? (() => { const d = Math.round((s.avgStars! - prev.avgStars!) * 10) / 10; return <span style={{ color: d >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>{d > 0 ? '+' : ''}{d.toFixed(1)} <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>{t('delta_vs')}</span></span>; })()
        : <span style={{ color: 'var(--text-secondary)' }}>{t('delta_na')}</span>;
    const metricRows = data.metrics.map((d, i) => d ? { ...d, reported: true } : { ...emptyMetricDay(days[i]), reported: false });
    const unansweredNow = Math.max(0, s.unanswered - data.latest.filter(r => !r.replied && repliedHere.has(r.id)).length);
    const starMax = Math.max(1, ...s.byStar.slice(1));
    const themeLabel = (theme: ThemeKey) => t(`rep_theme_${theme}`);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', opacity: loading ? 0.6 : 1, transition: 'opacity 0.2s' }}>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                {data.headline
                    ? t('rep_headline', { rating: data.headline.rating.toFixed(1), total: intText(data.headline.total), day: dayLabel(data.headline.date) })
                    : t('rep_headline_none')}
                {data.lastMetricDate && <> · {t('rep_metrics_until', { day: dayLabel(data.lastMetricDate) })}</>}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                <Tile title={t('rep_kpi_rating')} value={s.avgStars !== null ? `${s.avgStars.toFixed(1)} ${STAR}` : '—'} color={PAID_COLOR}
                    sub={t('rep_kpi_rating_sub', { count: s.count, withComment: s.withComment })} delta={deltaStars} />
                <Tile title={t('rep_kpi_new')} value={intText(s.count)} color={PAID_COLOR}
                    sub={t('rep_kpi_new_sub', { perDay: (Math.round((s.count / Math.max(days.length, 1)) * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 }) })}
                    delta={deltaPct(s.count, prev.count)} series={data.perDay.map(d => d.five + d.four + d.lowOrLess)} />
                <Tile title={t('rep_kpi_unanswered')} value={intText(unansweredNow)} color={unansweredNow > 0 ? OPEN_COLOR : CASH_COLOR} tone={unansweredNow > 0 ? 'warn' : undefined}
                    sub={unansweredNow > 0 && s.oldestUnanswered ? t('rep_kpi_unanswered_sub', { day: dayLabel(s.oldestUnanswered), rate: s.responseRate ?? 0 }) : t('rep_kpi_unanswered_none', { rate: s.responseRate ?? 0 })} />
                <Tile title={t('rep_kpi_actions')} value={intText(m.actions)} color={PURPLE}
                    sub={t('rep_kpi_actions_sub', { calls: intText(m.calls), directions: intText(m.directions), website: intText(m.website), menu: intText(m.menu), bookings: intText(m.bookings) })}
                    delta={deltaPct(m.actions, pm.actions)} series={metricRows.map(d => (d.reported ? d.directions + d.calls + d.website + d.menu + d.bookings : null))} />
                <Tile title={t('rep_kpi_impressions')} value={intText(m.impressions)} color={PURPLE}
                    sub={t('rep_kpi_impressions_sub', { search: pct1(m.searchImpressions, m.impressions), maps: pct1(m.mapsImpressions, m.impressions), days: m.days })}
                    delta={deltaPct(m.impressions, pm.impressions)} series={metricRows.map(d => (d.reported ? d.impressions : null))} />
            </div>

            <DayBars title={t('rep_chart_reviews')} subtitle={t('rep_chart_reviews_sub')} rows={data.perDay} today={today} dayLabel={dayLabel} format={v => intText(Math.round(v))}
                series={[
                    { label: `5 ${STAR}`, color: PAID_COLOR, value: d => d.five },
                    { label: `4 ${STAR}`, color: CASH_COLOR, value: d => d.four },
                    { label: `≤ 3 ${STAR}`, color: OPEN_COLOR, value: d => d.lowOrLess }
                ]}
                tip={d => t('rep_chart_reviews_tip', { day: dayLabel(d.date), five: d.five, four: d.four, low: d.lowOrLess })} />

            <DayBars title={t('rep_chart_actions')} subtitle={t('rep_chart_actions_sub')} rows={metricRows} today={today} dayLabel={dayLabel} read={d => d.reported} format={v => intText(Math.round(v))}
                series={[
                    { label: t('rep_m_directions'), color: PAID_COLOR, value: d => d.directions },
                    { label: t('rep_m_calls'), color: CASH_COLOR, value: d => d.calls },
                    { label: t('rep_m_website'), color: PURPLE, value: d => d.website },
                    { label: t('rep_m_menu'), color: OPEN_COLOR, value: d => d.menu }
                ]}
                tip={d => t('rep_chart_actions_tip', { day: dayLabel(d.date), directions: d.directions, calls: d.calls, website: d.website, menu: d.menu, impressions: intText(d.impressions) })} />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem', alignItems: 'start' }}>
                <div className="glass-panel" style={panelStyle}>
                    <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{t('rep_stars_title')}</h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                        {[5, 4, 3, 2, 1].map(star => (
                            <div key={star} style={{ display: 'grid', gridTemplateColumns: '4.6rem 1fr auto', alignItems: 'center', gap: '0.6rem', fontSize: '0.95rem' }}>
                                <span style={{ color: '#f59e0b', letterSpacing: '0.05em' }}>{starsText(star)}</span>
                                <div style={{ height: '10px', borderRadius: '5px', background: 'rgba(127,127,127,0.12)', overflow: 'hidden' }}>
                                    <div style={{ width: `${(s.byStar[star] / starMax) * 100}%`, height: '100%', background: star >= 5 ? PAID_COLOR : star === 4 ? CASH_COLOR : OPEN_COLOR }} />
                                </div>
                                <span style={{ ...numStyle, textAlign: 'right' }}><strong>{intText(s.byStar[star])}</strong> <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>· {pct1(s.byStar[star], s.count)}%</span></span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="glass-panel" style={panelStyle}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{t('rep_themes_title')}</h2>
                        <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('rep_themes_sub')}</p>
                    </div>
                    {data.themes.length === 0 ? <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('rep_none')}</p> : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {data.themes.map(th => {
                                const lowPct = th.mentions > 0 ? Math.round((th.lowStarMentions / th.mentions) * 100) : 0;
                                return (
                                    <div key={th.theme} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', fontSize: '0.95rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                                            <span>{themeLabel(th.theme)} <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>· {t('rep_mentions', { count: th.mentions })}</span></span>
                                            <span style={{ ...numStyle, fontWeight: 600, color: lowPct >= 25 ? OPEN_COLOR : 'var(--success)' }}>{t('rep_low_share', { pct: lowPct })}</span>
                                        </div>
                                        <div style={{ display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', background: 'rgba(127,127,127,0.12)' }}>
                                            <div style={{ width: `${100 - lowPct}%`, background: PAID_COLOR }} />
                                            <div style={{ width: `${lowPct}%`, background: OPEN_COLOR }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="glass-panel" style={panelStyle}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{t('rep_dishes_title')}</h2>
                        <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('rep_dishes_sub')}</p>
                    </div>
                    {data.dishes.length === 0 ? <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('rep_none')}</p> : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            {data.dishes.slice(0, 10).map(d => (
                                <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.95rem' }}>
                                    <span>{d.name}</span>
                                    <span style={{ ...numStyle }}><strong>{t('rep_mentions', { count: d.mentions })}</strong> <span style={{ color: '#f59e0b' }}>{STAR}</span> <span style={{ color: 'var(--text-secondary)' }}>{d.avgStars.toFixed(1)}</span></span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="glass-panel" style={panelStyle}>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{t('rep_latest_title')}</h2>
                        <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('rep_latest_sub', { count: data.latest.length, total: s.count })}</p>
                    </div>
                </div>
                {data.latest.length === 0 ? <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('rep_none')}</p> : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '0.75rem' }}>
                        {data.latest.map(r => (
                            <ReviewCard key={r.id} review={r} replied={r.replied || repliedHere.has(r.id)} dayLabel={dayLabel}
                                onReplied={() => setRepliedHere(prevSet => new Set(prevSet).add(r.id))} />
                        ))}
                    </div>
                )}
            </div>

            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('rep_footnote')}</p>
        </div>
    );
}

const replyBox: CSSProperties = { width: '100%', minHeight: '72px', padding: '0.6rem', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', font: 'inherit', fontSize: '0.9rem', resize: 'vertical', boxSizing: 'border-box' };

function ReviewCard({ review, replied, dayLabel, onReplied }: { review: ReviewLite; replied: boolean; dayLabel: (date: string) => string; onReplied: () => void }) {
    const t = useTranslations('Analytics');
    const [open, setOpen] = useState(false);
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const send = async () => {
        const comment = text.trim();
        if (!comment) return;
        setBusy(true);
        setErr(null);
        try {
            // Same-origin: the admin cookie rides along, and the route checks it.
            const res = await fetch(`/api/gbp/reviews/${encodeURIComponent(review.id)}/reply`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment })
            });
            if (!res.ok) { setErr(t('rep_reply_failed')); return; }
            onReplied();
            setOpen(false);
        } catch {
            setErr(t('rep_reply_failed'));
        } finally {
            setBusy(false);
        }
    };

    const low = review.stars <= 3;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', padding: '0.85rem 1rem', borderRadius: '12px', border: `1px solid ${low && !replied ? OPEN_COLOR : GRID_COLOR}`, background: low && !replied ? 'rgba(201,133,0,0.08)' : 'transparent' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', fontSize: '0.85rem' }}>
                <span style={{ color: '#f59e0b', letterSpacing: '0.05em' }}>{starsText(review.stars)}<span style={{ color: 'var(--border)' }}>{STAR.repeat(5 - review.stars)}</span></span>
                <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{dayLabel(review.date)} · {replied ? t('rep_replied') : <span style={{ color: OPEN_COLOR, fontWeight: 600 }}>{t('rep_unanswered')}</span>}</span>
            </div>
            <div style={{ fontSize: '0.9rem', lineHeight: 1.4 }}>
                {review.reviewer && <strong>{review.reviewer}: </strong>}
                {review.comment ? review.comment : <span style={{ color: 'var(--text-secondary)' }}>{t('rep_no_text')}</span>}
            </div>
            {!replied && (
                open ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <textarea value={text} onChange={e => setText(e.target.value)} placeholder={t('rep_reply_placeholder')} style={replyBox} maxLength={4096} />
                        {err && <span style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{err}</span>}
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button type="button" onClick={() => setOpen(false)} disabled={busy} style={{ minHeight: '40px', padding: '0 0.9rem', borderRadius: '10px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', font: 'inherit', cursor: 'pointer' }}>{t('rep_reply_cancel')}</button>
                            <button type="button" onClick={send} disabled={busy || text.trim().length === 0} className="btn-primary" style={{ minHeight: '40px', padding: '0 1rem', borderRadius: '10px', opacity: busy || text.trim().length === 0 ? 0.6 : 1 }}>{busy ? t('rep_reply_sending') : t('rep_reply_send')}</button>
                        </div>
                    </div>
                ) : (
                    <button type="button" onClick={() => setOpen(true)} style={{ alignSelf: 'flex-start', minHeight: '36px', padding: '0 0.8rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--accent-primary)', font: 'inherit', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}>{t('rep_reply_open')}</button>
                )
            )}
        </div>
    );
}
