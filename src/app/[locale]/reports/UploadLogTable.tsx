'use client';

import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import type { UploadWeekRow, UploadSlot, UploadState } from '@/app/actions/reports';

const cell: React.CSSProperties = { padding: '0.85rem 1rem', fontSize: '1.02rem', verticalAlign: 'top' };
const head: React.CSSProperties = { padding: '0.85rem 1rem', fontSize: '0.95rem', fontWeight: 500 };

/**
 * A light red wash for a week that is genuinely missing something.
 *
 * Deliberately a background-color and nothing else — no filter, no transform.
 * Written as an rgba literal rather than a token because there is no
 * "danger, 8%" variable and inventing one for a single table would put a
 * half-used token in the palette.
 */
const GAP_BG = 'rgba(239, 68, 68, 0.08)';

function stateColor(state: UploadState): string {
    return state === 'PRESENT' ? 'var(--success)' : state === 'MISSING' ? 'var(--danger)' : 'var(--text-secondary)';
}

function StateIcon({ state }: { state: UploadState }) {
    const color = stateColor(state);
    if (state === 'PRESENT') return <CheckCircle2 size={18} color={color} />;
    if (state === 'MISSING') return <AlertTriangle size={18} color={color} />;
    return <Clock size={18} color={color} />;
}

/**
 * One week's upload status: what happened, in words, not only in colour.
 *
 * Colour alone would carry the whole message for a reader who cannot separate
 * red from grey, and "missing" versus "not due yet" is exactly the distinction
 * that matters most here.
 */
export default function UploadLogTable({ rows }: { rows: UploadWeekRow[] }) {
    const t = useTranslations('Reports');
    const locale = useLocale();

    const when = (isoInstant: string | null): string => {
        if (!isoInstant) return '';
        return new Intl.DateTimeFormat(locale === 'es' ? 'es' : 'en', {
            timeZone: 'America/New_York',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: false,
        }).format(new Date(isoInstant));
    };

    const slotCell = (slot: UploadSlot, testId: string) => (
        <td style={cell} data-testid={testId} data-state={slot.state}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: stateColor(slot.state), fontWeight: 600 }}>
                <StateIcon state={slot.state} />
                <span>{t(`upload_state_${slot.state}`)}</span>
            </div>
            {slot.lastAt && (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginTop: '0.2rem' }}>
                    {when(slot.lastAt)}
                </div>
            )}
            {slot.fileName && (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', wordBreak: 'break-all' }}>
                    {slot.fileName}
                </div>
            )}
            {slot.uploadCount > 1 && (
                <div style={{ color: 'var(--warning)', fontSize: '0.95rem', marginTop: '0.2rem' }} data-testid={`${testId}-reuploaded`}>
                    {t('upload_reuploaded', { count: slot.uploadCount })}
                </div>
            )}
        </td>
    );

    if (rows.length === 0) {
        return (
            <div className="glass-panel" style={{ padding: '1.5rem' }} data-testid="upload-log">
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '1.05rem' }} data-testid="upload-log-empty">
                    {t('upload_none')}
                </p>
            </div>
        );
    }

    const gapCount = rows.filter(r => r.hasGap).length;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }} data-testid="upload-log">
            <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <h2 style={{ fontSize: '1.4rem', margin: 0 }}>{t('upload_title')}</h2>
                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '1.02rem' }}>{t('upload_subtitle')}</p>
                <p
                    style={{ margin: '0.2rem 0 0', fontSize: '1.05rem', fontWeight: 600, color: gapCount > 0 ? 'var(--danger)' : 'var(--success)' }}
                    data-testid="upload-gap-count"
                >
                    {gapCount > 0 ? t('upload_gaps', { count: gapCount }) : t('upload_no_gaps')}
                </p>
            </div>

            <div className="glass-panel" style={{ padding: '1.5rem', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '820px' }}>
                    <thead>
                        <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                            <th style={head}>{t('upload_week')}</th>
                            <th style={head}>{t('upload_timesheet')}</th>
                            <th style={head}>{t('upload_adp')}</th>
                            <th style={head}>{t('upload_missing')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(row => {
                            const missing: string[] = [];
                            if (row.timesheet.state === 'MISSING') missing.push(t('upload_missing_timesheet'));
                            if (row.adp.state === 'MISSING') missing.push(t('upload_missing_adp', { date: row.expectedCheckDate }));

                            return (
                                <tr
                                    key={row.weekEnding}
                                    data-testid="upload-week-row"
                                    data-week={row.weekEnding}
                                    data-gap={row.hasGap ? 'true' : 'false'}
                                    style={{
                                        borderBottom: '1px solid var(--border)',
                                        // Only a real gap is washed. A week still being
                                        // worked has nothing to upload yet and is left alone.
                                        background: row.hasGap ? GAP_BG : 'transparent',
                                    }}
                                >
                                    <td style={cell}>
                                        <div style={{ fontWeight: 600 }}>{row.weekStart} — {row.weekEnding}</div>
                                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
                                            {t('upload_check_date', { date: row.expectedCheckDate })}
                                        </div>
                                        {row.isCurrentWeek && (
                                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', fontStyle: 'italic' }} data-testid="upload-current-week">
                                                {t('upload_in_progress')}
                                            </div>
                                        )}
                                    </td>
                                    {slotCell(row.timesheet, 'upload-timesheet')}
                                    {slotCell(row.adp, 'upload-adp')}
                                    <td style={{ ...cell, color: missing.length > 0 ? 'var(--danger)' : 'var(--text-secondary)' }} data-testid="upload-missing-text">
                                        {missing.length > 0 ? missing.join(' · ') : t('upload_nothing_missing')}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
