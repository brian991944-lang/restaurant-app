'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { saveEmployeeConfig, type EmployeeConfigRow } from '@/app/actions/payroll';
import { calcPaySplit } from '@/lib/payrollCalc';
import { formatMoney } from '@/lib/money';

/** The week used for the preview. A round number, so the split reads at a glance. */
const PREVIEW_HOURS = 40;

const cell: React.CSSProperties = { padding: '0.8rem 0.9rem', fontSize: '1.02rem', verticalAlign: 'top' };
const head: React.CSSProperties = { padding: '0.8rem 0.9rem', fontSize: '0.92rem', fontWeight: 500, whiteSpace: 'nowrap' };
const numHead: React.CSSProperties = { ...head, textAlign: 'right' };

const numInput: React.CSSProperties = {
    width: '108px', padding: '0.5rem 0.6rem', minHeight: '48px',
    fontSize: '1.02rem', borderRadius: '8px', textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--text-primary)', background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
};

const selectStyle: React.CSSProperties = {
    minHeight: '48px', padding: '0.5rem 0.6rem', borderRadius: '8px',
    fontSize: '1.02rem', color: 'var(--text-primary)',
    background: 'var(--bg-primary)', border: '1px solid var(--border)',
};

/** Tapping a figure highlights it, so the first keystroke replaces the whole value. */
const selectAllOnFocus = (e: React.FocusEvent<HTMLInputElement>) => e.currentTarget.select();

type Draft = { rate: string; dept: string; adpHours: string; adpRate: string };

/**
 * A row's draft from whatever is saved. Empty stays EMPTY for the two ADP
 * fields — seeding them with a number would turn "all hours at their real rate"
 * into a figure someone has to recognise as a default and delete.
 */
function draftFromRow(r: EmployeeConfigRow): Draft {
    return {
        rate: r.hourlyRate !== null ? r.hourlyRate.toFixed(2) : '',
        dept: r.department ?? '',
        adpHours: r.adpHours !== null ? r.adpHours.toFixed(2) : '',
        adpRate: r.adpRate !== null ? r.adpRate.toFixed(2) : '',
    };
}

export default function EmployeeConfigPanel({ configs }: { configs: EmployeeConfigRow[] }) {
    const t = useTranslations('Payroll');
    const router = useRouter();

    const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
        Object.fromEntries(configs.map(r => [r.cloverEmployeeId, draftFromRow(r)]))
    );
    const [savingKey, setSavingKey] = useState<string | null>(null);
    const [rowError, setRowError] = useState<Record<string, string>>({});
    const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({});

    const seenKeys = useRef(configs.map(r => r.cloverEmployeeId).join('|'));

    // The list arrives again after every save. Rows already on screen keep their
    // unsaved edits; people who appear for the first time get a fresh draft.
    // Same shape as the payroll table's sync — a useState initializer alone runs
    // once and would leave a newly-listed person with no draft at all.
    useEffect(() => {
        const key = configs.map(r => r.cloverEmployeeId).join('|');
        const listChanged = seenKeys.current !== key;
        seenKeys.current = key;

        setDrafts(prev => {
            let changed = Object.keys(prev).length !== configs.length;
            const next: Record<string, Draft> = {};
            for (const r of configs) {
                if (r.cloverEmployeeId in prev) next[r.cloverEmployeeId] = prev[r.cloverEmployeeId];
                else { next[r.cloverEmployeeId] = draftFromRow(r); changed = true; }
            }
            return changed || listChanged ? next : prev;
        });
    }, [configs]);

    const draftFor = (r: EmployeeConfigRow): Draft => drafts[r.cloverEmployeeId] ?? draftFromRow(r);

    const patch = (r: EmployeeConfigRow, next: Partial<Draft>) => {
        setDrafts(d => ({
            ...d,
            [r.cloverEmployeeId]: { ...(d[r.cloverEmployeeId] ?? draftFromRow(r)), ...next },
        }));
        setSavedKeys(s => ({ ...s, [r.cloverEmployeeId]: false }));
    };

    const handleSave = async (r: EmployeeConfigRow) => {
        const d = draftFor(r);
        setSavingKey(r.cloverEmployeeId);
        setRowError(e => ({ ...e, [r.cloverEmployeeId]: '' }));

        const res = await saveEmployeeConfig(
            r.cloverEmployeeId,
            r.employeeName,
            Number(d.rate),
            d.dept === '' ? null : (d.dept as 'SALON' | 'COCINA'),
            // Empty means the default, and the default is a real setting — not a
            // missing one. It is sent as null, never coerced to 0.
            d.adpHours.trim() === '' ? null : Number(d.adpHours),
            d.adpRate.trim() === '' ? null : Number(d.adpRate)
        );

        if (res.success) {
            setSavedKeys(s => ({ ...s, [r.cloverEmployeeId]: true }));
            router.refresh();
        } else {
            setRowError(e => ({ ...e, [r.cloverEmployeeId]: res.error ?? t('config_save_failed') }));
        }
        setSavingKey(null);
    };

    const unconfigured = configs.filter(c => !c.hasRow).length;

    return (
        <div id="employee-config" className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
                <h2 style={{ fontSize: '1.3rem', margin: 0 }}>{t('config_title')}</h2>
                <p style={{ margin: '0.35rem 0 0', color: 'var(--text-secondary)', fontSize: '1rem' }}>
                    {t('config_subtitle')}
                </p>
            </div>

            {unconfigured > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--warning)', fontSize: '1.02rem' }}>
                    <AlertTriangle size={20} />
                    <span>{t('config_unconfigured_count', { count: unconfigured })}</span>
                </div>
            )}

            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1120px' }}>
                    <thead>
                        <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                            <th style={head}>{t('name')}</th>
                            <th style={head}>{t('department')}</th>
                            <th style={numHead}>{t('real_rate')}</th>
                            <th style={numHead}>{t('adp_hours')}</th>
                            <th style={numHead}>{t('adp_rate')}</th>
                            <th style={head}>{t('preview_40h')}</th>
                            <th style={head}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {configs.map(r => {
                            const d = draftFor(r);
                            const rate = Number(d.rate);
                            const hasRate = d.rate.trim() !== '' && Number.isFinite(rate) && rate > 0;

                            const split = hasRate
                                ? calcPaySplit({
                                    hours: PREVIEW_HOURS,
                                    hourlyRate: rate,
                                    adpHours: d.adpHours.trim() === '' ? null : Number(d.adpHours),
                                    adpRate: d.adpRate.trim() === '' ? null : Number(d.adpRate),
                                })
                                : null;

                            return (
                                <tr
                                    key={r.cloverEmployeeId}
                                    style={{
                                        borderBottom: '1px solid var(--border)',
                                        // Unconfigured rows are the job in front of the user.
                                        borderLeft: r.hasRow ? '3px solid transparent' : '3px solid var(--warning)',
                                        background: r.hasRow ? 'transparent' : 'rgba(234, 179, 8, 0.06)',
                                    }}
                                >
                                    <td style={cell}>
                                        <div style={{ fontWeight: 600 }}>{r.employeeName}</div>
                                        {!r.hasRow && (
                                            <div style={{ fontSize: '0.88rem', color: 'var(--warning)' }}>{t('config_missing')}</div>
                                        )}
                                        {r.roleVaries && (
                                            <div style={{ fontSize: '0.88rem', color: 'var(--warning)' }}>
                                                {t('config_role_varies', { roles: r.rolesSeen.map(x => t(`role_${x}`)).join(' + ') })}
                                            </div>
                                        )}
                                    </td>

                                    <td style={cell}>
                                        <select
                                            value={d.dept}
                                            onChange={e => patch(r, { dept: e.target.value })}
                                            style={selectStyle}
                                        >
                                            <option value="">{t('dept_from_role')}</option>
                                            <option value="SALON">{t('dept_SALON')}</option>
                                            <option value="COCINA">{t('dept_COCINA')}</option>
                                        </select>
                                    </td>

                                    <td style={{ ...cell, textAlign: 'right' }}>
                                        <input
                                            type="number" step="0.01" min="0" inputMode="decimal"
                                            value={d.rate}
                                            placeholder="0.00"
                                            onFocus={selectAllOnFocus}
                                            onChange={e => patch(r, { rate: e.target.value })}
                                            style={{ ...numInput, borderColor: hasRate ? 'var(--border)' : 'var(--warning)' }}
                                        />
                                    </td>

                                    <td style={{ ...cell, textAlign: 'right' }}>
                                        <input
                                            type="number" step="0.01" min="0" inputMode="decimal"
                                            value={d.adpHours}
                                            placeholder={t('adp_hours_placeholder')}
                                            onFocus={selectAllOnFocus}
                                            onChange={e => patch(r, { adpHours: e.target.value })}
                                            style={numInput}
                                        />
                                        <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                                            {t('adp_hours_hint')}
                                        </div>
                                    </td>

                                    <td style={{ ...cell, textAlign: 'right' }}>
                                        <input
                                            type="number" step="0.01" min="0" inputMode="decimal"
                                            value={d.adpRate}
                                            placeholder={t('adp_rate_placeholder')}
                                            onFocus={selectAllOnFocus}
                                            onChange={e => patch(r, { adpRate: e.target.value })}
                                            style={numInput}
                                        />
                                        <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                                            {t('adp_rate_hint')}
                                        </div>
                                    </td>

                                    <td style={cell}>
                                        {split === null ? (
                                            <span style={{ color: 'var(--text-secondary)' }}>{t('preview_needs_rate')}</span>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', fontVariantNumeric: 'tabular-nums' }}>
                                                <span>{t('preview_total')}: <strong>{formatMoney(split.totalEarnedCents)}</strong></span>
                                                <span>{t('preview_adp')}: <strong>{formatMoney(split.adpTotalCents)}</strong></span>
                                                <span>{t('preview_check')}: <strong>{formatMoney(split.checkTotalCents)}</strong></span>
                                                <span style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                                                    {t('preview_basis', {
                                                        hours: split.effectiveAdpHours.toFixed(2),
                                                        rate: split.effectiveAdpRate.toFixed(2),
                                                    })}
                                                </span>
                                            </div>
                                        )}
                                    </td>

                                    <td style={cell}>
                                        <button
                                            onClick={() => handleSave(r)}
                                            className="btn-primary"
                                            disabled={!hasRate || savingKey === r.cloverEmployeeId}
                                            style={{ borderRadius: '8px', minHeight: '48px', whiteSpace: 'nowrap', opacity: (!hasRate || savingKey === r.cloverEmployeeId) ? 0.55 : 1 }}
                                        >
                                            {savingKey === r.cloverEmployeeId
                                                ? t('saving')
                                                : savedKeys[r.cloverEmployeeId] ? t('saved') : t('save')}
                                        </button>
                                        {rowError[r.cloverEmployeeId] && (
                                            <div style={{ fontSize: '0.86rem', color: 'var(--danger)', marginTop: '0.3rem', maxWidth: '170px' }}>
                                                {rowError[r.cloverEmployeeId]}
                                            </div>
                                        )}
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
