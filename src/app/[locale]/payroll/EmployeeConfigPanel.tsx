'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { AlertTriangle, RefreshCw, Users } from 'lucide-react';
import { saveEmployeeConfig, syncCloverRoles, setEmployeeIncludeInTips, setEmployeeInAdp, type EmployeeConfigRow, type RoleSyncResult } from '@/app/actions/payroll';
import ManagePeopleModal from './ManagePeopleModal';
import { calcPaySplit } from '@/lib/payrollCalc';
import { formatMoney } from '@/lib/money';

/** The week used for the preview. A round number, so the split reads at a glance. */
const PREVIEW_HOURS = 40;

/**
 * The sync time is rendered in the restaurant's own zone, not the reader's.
 * Fixing it also keeps the server and the client producing the same string: a
 * phone set to another timezone would otherwise mismatch on hydration.
 */
const SYNC_TIME_ZONE = 'America/New_York';

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
    const locale = useLocale();
    const router = useRouter();

    const formatSyncTime = (iso: string) =>
        new Date(iso).toLocaleString(locale, {
            timeZone: SYNC_TIME_ZONE,
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });

    const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
        Object.fromEntries(configs.map(r => [r.cloverEmployeeId, draftFromRow(r)]))
    );
    const [savingKey, setSavingKey] = useState<string | null>(null);
    const [rowError, setRowError] = useState<Record<string, string>>({});
    const [savedKeys, setSavedKeys] = useState<Record<string, boolean>>({});

    /**
     * The tip-dropdown flag, held locally so the checkbox responds at once and
     * is put back if the save fails. A checkbox that stayed ticked after a failed
     * write would claim somebody is on the tip sheet when they are not.
     */
    const [tipFlags, setTipFlags] = useState<Record<string, boolean>>(() =>
        Object.fromEntries(configs.map(c => [c.cloverEmployeeId, c.includeInTips]))
    );
    const [tipSavingKey, setTipSavingKey] = useState<string | null>(null);

    /** Same optimistic-with-rollback pattern as the tip flag above. */
    const [adpFlags, setAdpFlags] = useState<Record<string, boolean>>(() =>
        Object.fromEntries(configs.map(c => [c.cloverEmployeeId, c.inAdp]))
    );
    const [adpSavingKey, setAdpSavingKey] = useState<string | null>(null);

    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<RoleSyncResult | null>(null);
    const [syncError, setSyncError] = useState('');
    const [managingPeople, setManagingPeople] = useState(false);

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

    /**
     * Toggle one person on or off the tip-entry dropdown.
     *
     * Saves on its own rather than waiting for the row's Save button: that button
     * is disabled until a rate is entered, and the people this flag exists for —
     * a manager who works the floor — may never have one.
     */
    const handleTipToggle = async (r: EmployeeConfigRow, next: boolean) => {
        setTipSavingKey(r.cloverEmployeeId);
        setTipFlags(f => ({ ...f, [r.cloverEmployeeId]: next }));
        setRowError(e => ({ ...e, [r.cloverEmployeeId]: '' }));

        const res = await setEmployeeIncludeInTips(r.cloverEmployeeId, r.employeeName, next);

        if (res.success) {
            router.refresh();
        } else {
            // Put it back. The flag did not change, so the box must not say it did.
            setTipFlags(f => ({ ...f, [r.cloverEmployeeId]: !next }));
            setRowError(e => ({ ...e, [r.cloverEmployeeId]: res.error ?? t('tips_toggle_failed') }));
        }
        setTipSavingKey(null);
    };

    /**
     * Move one person in or out of ADP.
     *
     * Saves on its own for the same reason the tip toggle does: the row's Save
     * button needs an hourly rate, and somebody paid entirely by the owner may
     * not have one configured here.
     */
    const handleAdpToggle = async (r: EmployeeConfigRow, next: boolean) => {
        setAdpSavingKey(r.cloverEmployeeId);
        setAdpFlags(f => ({ ...f, [r.cloverEmployeeId]: next }));
        setRowError(e => ({ ...e, [r.cloverEmployeeId]: '' }));

        const res = await setEmployeeInAdp(r.cloverEmployeeId, r.employeeName, next);

        if (res.success) {
            router.refresh();
        } else {
            // Put it back. The flag did not change, so the box must not say it did.
            setAdpFlags(f => ({ ...f, [r.cloverEmployeeId]: !next }));
            setRowError(e => ({ ...e, [r.cloverEmployeeId]: res.error ?? t('in_adp_toggle_failed') }));
        }
        setAdpSavingKey(null);
    };

    const handleSyncRoles = async () => {
        setSyncing(true);
        setSyncError('');
        setSyncResult(null);

        const res = await syncCloverRoles();

        if (res.success) {
            setSyncResult(res);
            router.refresh();
        } else {
            setSyncError(res.error ?? t('config_sync_failed'));
        }
        setSyncing(false);
    };

    const unconfigured = configs.filter(c => !c.isConfigured).length;

    // The most recent refresh across everyone. Rows are written with one
    // timestamp per run, so the newest is when the last sync happened.
    const lastSyncedAt = configs.reduce<string | null>(
        (latest, r) => (r.cloverRoleAt && (latest === null || r.cloverRoleAt > latest) ? r.cloverRoleAt : latest),
        null
    );

    return (
        <div id="employee-config" className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                    <h2 style={{ fontSize: '1.3rem', margin: 0 }}>{t('config_title')}</h2>
                    <p style={{ margin: '0.35rem 0 0', color: 'var(--text-secondary)', fontSize: '1rem' }}>
                        {t('config_subtitle')}
                    </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.92rem' }}>
                        {lastSyncedAt ? t('config_sync_last', { when: formatSyncTime(lastSyncedAt) }) : t('config_sync_never')}
                    </span>
                    <button
                        onClick={() => setManagingPeople(true)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            minHeight: '48px', padding: '0.6rem 1.1rem', borderRadius: '8px',
                            fontSize: '1rem', fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
                            color: 'var(--text-primary)', background: 'var(--bg-primary)',
                            border: '1px solid var(--border)',
                        }}
                    >
                        <Users size={18} />
                        {t('manage_people')}
                    </button>
                    <button
                        onClick={handleSyncRoles}
                        disabled={syncing}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            minHeight: '48px', padding: '0.6rem 1.1rem', borderRadius: '8px',
                            border: 'none', fontSize: '1rem', fontWeight: 500, color: 'white',
                            background: 'var(--success)', cursor: syncing ? 'default' : 'pointer',
                            opacity: syncing ? 0.6 : 1, whiteSpace: 'nowrap',
                        }}
                    >
                        <RefreshCw size={18} />
                        {syncing ? t('config_syncing') : t('config_sync_roles')}
                    </button>
                </div>
            </div>

            {syncError && (
                <div style={{ color: 'var(--danger)', fontSize: '1rem' }}>{syncError}</div>
            )}

            {syncResult && (
                <div style={{
                    display: 'flex', flexDirection: 'column', gap: '0.3rem',
                    padding: '0.9rem 1rem', borderRadius: '8px',
                    border: '1px solid var(--success)', background: 'rgba(16, 185, 129, 0.08)',
                    fontSize: '1rem',
                }}>
                    <span>{t('config_sync_summary', { checked: syncResult.checked, changed: syncResult.changed.length })}</span>
                    {syncResult.created > 0 && (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.92rem' }}>
                            {t('config_sync_created', { count: syncResult.created })}
                        </span>
                    )}
                    {syncResult.withoutRole > 0 && (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.92rem' }}>
                            {t('config_sync_norole', { count: syncResult.withoutRole })}
                        </span>
                    )}
                    {syncResult.changed.length === 0 ? (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.92rem' }}>
                            {t('config_sync_no_changes')}
                        </span>
                    ) : (
                        <ul style={{ margin: '0.2rem 0 0', paddingLeft: '1.2rem' }}>
                            {syncResult.changed.map(c => (
                                <li key={c.employeeName} style={{ fontSize: '0.96rem' }}>
                                    {t('config_sync_moved', {
                                        name: c.employeeName,
                                        from: c.from ? t(`dept_${c.from}`) : t('dept_none'),
                                        to: c.to ? t(`dept_${c.to}`) : t('dept_none'),
                                    })}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {unconfigured > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--warning)', fontSize: '1.02rem' }}>
                    <AlertTriangle size={20} />
                    <span>{t('config_unconfigured_count', { count: unconfigured })}</span>
                </div>
            )}

            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1280px' }}>
                    <thead>
                        <tr style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                            <th style={head}>{t('name')}</th>
                            <th style={head}>{t('clover_role')}</th>
                            <th style={head}>{t('department')}</th>
                            <th style={numHead}>{t('real_rate')}</th>
                            <th style={numHead}>{t('adp_hours')}</th>
                            <th style={numHead}>{t('adp_rate')}</th>
                            <th style={head}>{t('preview_40h')}</th>
                            <th style={head}>
                                {t('in_adp')}
                                <div style={{ fontWeight: 400, fontSize: '0.82rem', color: 'var(--text-secondary)', maxWidth: '200px' }}>
                                    {t('in_adp_hint')}
                                </div>
                            </th>
                            <th style={head}>
                                {t('tips_dropdown')}
                                {/* The hint is in the header, not per row: it says what
                                    the column DOES, and repeating it 56 times would not
                                    make it any clearer. */}
                                <div style={{ fontWeight: 400, fontSize: '0.82rem', color: 'var(--text-secondary)', maxWidth: '190px' }}>
                                    {t('tips_dropdown_hint')}
                                </div>
                            </th>
                            <th style={head}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {configs.map(r => {
                            const d = draftFor(r);
                            const rate = Number(d.rate);
                            const hasRate = d.rate.trim() !== '' && Number.isFinite(rate) && rate > 0;

                            // Compared against the DRAFT, not the saved value, so the
                            // warning appears while the choice is being made rather
                            // than one save later.
                            const deptConflict =
                                d.dept !== '' && r.departmentFromRole !== null && d.dept !== r.departmentFromRole;

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
                                        borderLeft: r.isConfigured ? '3px solid transparent' : '3px solid var(--warning)',
                                        background: r.isConfigured ? 'transparent' : 'rgba(234, 179, 8, 0.06)',
                                    }}
                                >
                                    <td style={cell}>
                                        <div style={{ fontWeight: 600 }}>{r.employeeName}</div>
                                        {!r.isConfigured && (
                                            <div style={{ fontSize: '0.88rem', color: 'var(--warning)' }}>{t('config_missing')}</div>
                                        )}
                                        {r.roleVaries && (
                                            <div style={{ fontSize: '0.88rem', color: 'var(--warning)' }}>
                                                {t('config_role_varies', { roles: r.rolesSeen.map(x => t(`role_${x}`)).join(' + ') })}
                                            </div>
                                        )}
                                    </td>

                                    <td style={cell}>
                                        {r.cloverRole ? (
                                            <>
                                                <div>{r.cloverRole}</div>
                                                <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
                                                    {r.departmentFromRole ? t(`dept_${r.departmentFromRole}`) : t('dept_none')}
                                                </div>
                                            </>
                                        ) : (
                                            <span style={{ color: 'var(--text-secondary)' }}>{t('config_role_never_synced')}</span>
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

                                        {/* Not an error — an override is allowed to disagree with
                                            Clover, and sometimes should. It is shown so the
                                            disagreement is a decision somebody can see, rather
                                            than one buried in a column nobody compares. */}
                                        {deptConflict && (
                                            <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.35rem', fontSize: '0.84rem', color: 'var(--warning)' }}>
                                                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                                                <span>
                                                    {t('config_dept_conflict', {
                                                        clover: t(`dept_${r.departmentFromRole!}`),
                                                    })}
                                                </span>
                                            </div>
                                        )}
                                        {r.department === null && r.resolvedDepartment !== null && (
                                            <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                                                {t('config_dept_resolved', { dept: t(`dept_${r.resolvedDepartment}`) })}
                                            </div>
                                        )}
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

                                    <td style={cell} data-testid="in-adp-cell">
                                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer', minHeight: '44px' }}>
                                            <input
                                                type="checkbox"
                                                checked={adpFlags[r.cloverEmployeeId] ?? true}
                                                disabled={adpSavingKey === r.cloverEmployeeId}
                                                onChange={e => handleAdpToggle(r, e.target.checked)}
                                                aria-label={t('in_adp')}
                                                style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                                            />
                                            {adpSavingKey === r.cloverEmployeeId && (
                                                <span style={{ fontSize: '0.86rem', color: 'var(--text-secondary)' }}>{t('saving')}</span>
                                            )}
                                        </label>
                                        {/* Only when OFF, and stated positively: an unchecked box
                                            beside every ADP field on the row is otherwise easy to
                                            read as a mistake rather than a decision. */}
                                        {adpFlags[r.cloverEmployeeId] === false && (
                                            <div style={{ fontSize: '0.82rem', color: 'var(--warning)', maxWidth: '200px' }}>
                                                {t('in_adp_off_note')}
                                            </div>
                                        )}
                                    </td>

                                    <td style={cell} data-testid="tips-dropdown-cell">
                                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem', cursor: 'pointer', minHeight: '44px' }}>
                                            <input
                                                type="checkbox"
                                                checked={tipFlags[r.cloverEmployeeId] ?? false}
                                                disabled={tipSavingKey === r.cloverEmployeeId}
                                                onChange={e => handleTipToggle(r, e.target.checked)}
                                                aria-label={t('tips_dropdown')}
                                                style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                                            />
                                            {tipSavingKey === r.cloverEmployeeId && (
                                                <span style={{ fontSize: '0.86rem', color: 'var(--text-secondary)' }}>{t('saving')}</span>
                                            )}
                                        </label>
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

            {/* Mounted inside the panel, which is safe: the ancestor chain up to
                <main> sets no transform, filter, backdrop-filter, perspective,
                will-change or contain, so the modal's position:fixed still
                resolves against the viewport. */}
            {managingPeople && <ManagePeopleModal onClose={() => setManagingPeople(false)} />}
        </div>
    );
}
