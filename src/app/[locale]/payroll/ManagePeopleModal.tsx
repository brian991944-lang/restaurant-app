'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Search, X } from 'lucide-react';
import {
    getAllCloverEmployees,
    addEmployeeToConfig,
    setEmployeeHidden,
    type CloverEmployeeRow,
} from '@/app/actions/payroll';

/**
 * Where a person currently stands relative to the config panel.
 *
 * Derived here rather than sent from the server so the three states line up
 * with the badge, the available action and the row tint from one definition.
 */
type State = 'in' | 'hidden' | 'out';

/**
 * Mirrors getEmployeeConfigs' relevance rule: hidden beats everything, then a
 * rate, a pin or recent activity puts someone on the panel.
 *
 * The one intentional simplification is the viewed week — getEmployeeConfigs
 * also lists anyone appearing in the week on screen, which can only ADD people
 * for a week older than the 90-day window. Someone in that position reads as
 * "sin agregar" here while already being on the panel; the actions still behave
 * correctly, since adding them is a no-op and hiding them works.
 */
function stateOf(r: CloverEmployeeRow): State {
    if (r.isHidden) return 'hidden';
    return r.hasRate || r.isPinned || r.hasRecentActivity ? 'in' : 'out';
}

const STATE_COLOR: Record<State, string> = {
    in: 'var(--success)',
    hidden: 'var(--text-secondary)',
    out: 'var(--warning)',
};

/** Touch-sized, and never smaller — this runs on a tablet. */
const actionButton: React.CSSProperties = {
    minHeight: '48px', padding: '0 1rem', borderRadius: '8px',
    fontSize: '1rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
    color: 'var(--text-primary)', background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
};

export default function ManagePeopleModal({ onClose }: { onClose: () => void }) {
    const t = useTranslations('Payroll');
    const router = useRouter();

    const [rows, setRows] = useState<CloverEmployeeRow[] | null>(null);
    const [query, setQuery] = useState('');
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState('');
    /** The row awaiting "hide anyway" confirmation, if any. */
    const [confirmHideId, setConfirmHideId] = useState<string | null>(null);

    const load = useCallback(async () => {
        const list = await getAllCloverEmployees();
        setRows(list);
    }, []);

    useEffect(() => { void load(); }, [load]);

    // Escape closes. A modal that can only be dismissed by hitting a small X is
    // a trap on a tablet with a keyboard attached.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const run = async (id: string, fn: () => Promise<{ success: boolean; error?: string }>) => {
        setBusyId(id);
        setError('');
        const res = await fn();
        if (!res.success) setError(res.error ?? t('manage_failed'));
        else {
            await load();
            // The panel behind the modal is server-rendered from
            // getEmployeeConfigs, so it only reflects the change after a refresh.
            router.refresh();
        }
        setConfirmHideId(null);
        setBusyId(null);
    };

    const q = query.trim().toLowerCase();
    const shown = (rows ?? []).filter(r =>
        q === '' ||
        r.employeeName.toLowerCase().includes(q) ||
        (r.cloverRole ?? '').toLowerCase().includes(q)
    );

    return (
        <div
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label={t('manage_title')}
            style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                // Plain translucent black. No backdrop-filter: it creates a
                // containing block for fixed descendants and is the usual reason
                // a modal ends up anchored to the wrong box.
                background: 'rgba(0,0,0,0.5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 1000, padding: '1rem',
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                className="glass-panel"
                style={{
                    width: '100%', maxWidth: '760px', maxHeight: '88vh',
                    padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
                }}
            >
                {/* ── Header ── */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ minWidth: 0 }}>
                        <h2 style={{ fontSize: '1.3rem', margin: 0 }}>{t('manage_title')}</h2>
                        <p style={{ margin: '0.35rem 0 0', color: 'var(--text-secondary)', fontSize: '0.98rem' }}>
                            {t('manage_subtitle')}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label={t('manage_close')}
                        style={{ ...actionButton, minWidth: '48px', padding: '0 0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* ── Search ── */}
                <div style={{ padding: '1rem 1.5rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0 0.8rem', borderRadius: '8px', background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
                        <Search size={18} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                        <input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder={t('manage_search')}
                            aria-label={t('manage_search')}
                            style={{
                                flex: 1, minHeight: '48px', padding: '0.5rem 0',
                                fontSize: '1.02rem', color: 'var(--text-primary)',
                                background: 'transparent', border: 'none', outline: 'none',
                            }}
                        />
                    </div>
                    {rows !== null && (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                            {t('manage_count', { shown: shown.length, total: rows.length })}
                        </span>
                    )}
                </div>

                {error && (
                    <div style={{ margin: '0 1.5rem 0.5rem', color: 'var(--danger)', fontSize: '0.98rem' }}>{error}</div>
                )}

                {/* ── List ── */}
                <div style={{ overflowY: 'auto', padding: '0 1.5rem 1.25rem' }}>
                    {rows === null ? (
                        <p style={{ color: 'var(--text-secondary)', fontSize: '1.02rem' }}>{t('manage_loading')}</p>
                    ) : shown.length === 0 ? (
                        <p style={{ color: 'var(--text-secondary)', fontSize: '1.02rem' }}>{t('manage_empty')}</p>
                    ) : (
                        shown.map(r => {
                            const state = stateOf(r);
                            const busy = busyId === r.cloverEmployeeId;
                            const confirming = confirmHideId === r.cloverEmployeeId;

                            return (
                                <div
                                    key={r.cloverEmployeeId}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
                                        padding: '0.85rem 0', borderBottom: '1px solid var(--border)',
                                        opacity: state === 'hidden' ? 0.6 : 1,
                                    }}
                                >
                                    <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                                        <div style={{ fontWeight: 600, fontSize: '1.05rem' }}>{r.employeeName}</div>
                                        {/* One line, clipped rather than wrapped: a wrapping
                                            cell breaks the alignment the list is scanned down.
                                            Always visible, never a tooltip — no hover here. */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            <span>{r.cloverRole ?? t('manage_no_role')}</span>
                                            <span aria-hidden="true">·</span>
                                            <span style={{ color: STATE_COLOR[state], fontWeight: 600 }}>
                                                {t(`manage_state_${state}`)}
                                            </span>
                                            {r.hasRecentActivity && (
                                                <>
                                                    <span aria-hidden="true">·</span>
                                                    <span style={{ color: 'var(--warning)' }}>{t('manage_has_activity')}</span>
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    {confirming ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: '1 1 320px' }}>
                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', color: 'var(--warning)', fontSize: '0.92rem' }}>
                                                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '0.15rem' }} />
                                                <span>{t('manage_hide_warning')}</span>
                                            </div>
                                            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                <button
                                                    onClick={() => run(r.cloverEmployeeId, () => setEmployeeHidden(r.cloverEmployeeId, true))}
                                                    disabled={busy}
                                                    style={{ ...actionButton, color: '#fff', background: 'var(--warning)', border: '1px solid var(--warning)', opacity: busy ? 0.6 : 1 }}
                                                >
                                                    {t('manage_confirm_hide')}
                                                </button>
                                                <button onClick={() => setConfirmHideId(null)} disabled={busy} style={actionButton}>
                                                    {t('manage_cancel')}
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                            {state === 'hidden' ? (
                                                <button
                                                    onClick={() => run(r.cloverEmployeeId, () => setEmployeeHidden(r.cloverEmployeeId, false))}
                                                    disabled={busy}
                                                    style={{ ...actionButton, opacity: busy ? 0.6 : 1 }}
                                                >
                                                    {t('manage_show')}
                                                </button>
                                            ) : (
                                                <>
                                                    {state === 'out' && (
                                                        <button
                                                            onClick={() => run(r.cloverEmployeeId, () => addEmployeeToConfig(r.cloverEmployeeId))}
                                                            disabled={busy}
                                                            style={{ ...actionButton, color: '#fff', background: 'var(--accent-primary)', border: '1px solid var(--accent-primary)', opacity: busy ? 0.6 : 1 }}
                                                        >
                                                            {t('manage_add')}
                                                        </button>
                                                    )}
                                                    <button
                                                        // Someone with hours gets the warning first; for
                                                        // everyone else hiding is trivially reversible and
                                                        // a confirm step would just be noise.
                                                        onClick={() =>
                                                            r.hasRecentActivity
                                                                ? setConfirmHideId(r.cloverEmployeeId)
                                                                : run(r.cloverEmployeeId, () => setEmployeeHidden(r.cloverEmployeeId, true))
                                                        }
                                                        disabled={busy}
                                                        style={{ ...actionButton, opacity: busy ? 0.6 : 1 }}
                                                    >
                                                        {t('manage_hide')}
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>
    );
}
