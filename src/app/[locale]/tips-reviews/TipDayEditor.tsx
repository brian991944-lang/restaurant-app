'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Save } from 'lucide-react';
import { upsertEntry, removeEntry } from '@/app/actions/tips';
// Type-only: avoids shipping a client reference to an action never called here.
import type { getTipDay } from '@/app/actions/tips';
import { toCents, sumCents, formatMoney } from '@/lib/money';

type TipDay = NonNullable<Awaited<ReturnType<typeof getTipDay>>>;
type TipEntry = TipDay['shifts'][number]['entries'][number];
type StaffMember = { id: string; name: string };
type Role = TipEntry['role'];

/** What the user is currently looking at for one row. Money stays as typed. */
interface RowDraft {
    cloverEmployeeId: string;
    employeeName: string;
    role: Role;
    credit: string;
    service: string;
    /** '' means null — not counted. A typed '0' means counted, and zero. */
    cash: string;
}

const cell: React.CSSProperties = { padding: '0.9rem 1rem', fontSize: '1.05rem' };
const head: React.CSSProperties = { padding: '0.9rem 1rem', fontSize: '0.95rem', fontWeight: 500 };
const numericCell: React.CSSProperties = { ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const numericHead: React.CSSProperties = { ...head, textAlign: 'right' };

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.6rem 0.7rem', minHeight: '52px',
    fontSize: '1.05rem', borderRadius: '8px', textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--text-primary)', background: 'var(--bg-primary)',
    border: '1px solid var(--border)'
};

/** Six columns when editable, five when submitted. Each set sums to exactly 100%. */
function ShiftColGroup({ editable }: { editable: boolean }) {
    return (
        <colgroup>
            <col style={{ width: editable ? '22%' : '24%' }} />
            <col style={{ width: editable ? '16%' : '18%' }} />
            <col style={{ width: editable ? '17%' : '19%' }} />
            <col style={{ width: editable ? '17%' : '19%' }} />
            <col style={{ width: editable ? '17%' : '20%' }} />
            {editable && <col style={{ width: '11%' }} />}
        </colgroup>
    );
}

const draftFromEntry = (e: TipEntry): RowDraft => ({
    cloverEmployeeId: e.cloverEmployeeId,
    employeeName: e.employeeName,
    role: e.role,
    credit: e.creditTips.toFixed(2),
    service: e.serviceCharge.toFixed(2),
    cash: e.cashTips === null ? '' : e.cashTips.toFixed(2)
});

/** Cash input to the value the action stores: blank is null, not zero. */
const cashOf = (d: RowDraft): number | null => (d.cash.trim() === '' ? null : toCents(d.cash) / 100);

/**
 * Comparable form of a row. Money is compared in cents, so re-typing '30' over
 * '30.00' does not mark the row dirty — only a real change does.
 */
const signature = (d: RowDraft) =>
    JSON.stringify([
        d.cloverEmployeeId,
        d.role,
        toCents(d.credit),
        toCents(d.service),
        d.cash.trim() === '' ? null : toCents(d.cash)
    ]);

export default function TipDayEditor({ day, staff }: { day: TipDay; staff: StaffMember[] }) {
    const t = useTranslations('Tips');
    const readOnly = day.status === 'ENVIADO';

    const allEntries = useMemo(() => day.shifts.flatMap(s => s.entries), [day]);

    // Baseline is what the database holds; drafts are what the user sees. A row
    // is dirty when their signatures differ, so there is no flag to forget to
    // clear after a save.
    const [baseline, setBaseline] = useState<Record<string, RowDraft>>(() =>
        Object.fromEntries(allEntries.map(e => [e.id, draftFromEntry(e)]))
    );
    const [drafts, setDrafts] = useState<Record<string, RowDraft>>(() =>
        Object.fromEntries(allEntries.map(e => [e.id, draftFromEntry(e)]))
    );

    const [busyId, setBusyId] = useState<string | null>(null);
    const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

    const isDirty = (id: string) => {
        const d = drafts[id], b = baseline[id];
        return !!d && !!b && signature(d) !== signature(b);
    };
    const dirtyCount = Object.keys(drafts).filter(isDirty).length;

    // A dropped write here is somebody's money, so the browser warns rather
    // than the page trying to flush anything on the way out.
    useEffect(() => {
        if (readOnly || dirtyCount === 0) return;
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [readOnly, dirtyCount]);

    const patch = (id: string, change: Partial<RowDraft>) =>
        setDrafts(prev => ({ ...prev, [id]: { ...prev[id], ...change } }));

    const handleSave = async (entry: TipEntry, shiftId: string) => {
        const d = drafts[entry.id];
        if (!d) return;

        if (!d.cloverEmployeeId) {
            setRowErrors(prev => ({ ...prev, [entry.id]: t('choose_person') }));
            return;
        }
        for (const [label, raw] of [[t('credit_tips'), d.credit], [t('service_charge'), d.service]] as const) {
            if (raw.trim() === '' || !Number.isFinite(Number(raw.replace(/[$,\s]/g, '')))) {
                setRowErrors(prev => ({ ...prev, [entry.id]: `${label}: el monto no es válido.` }));
                return;
            }
        }
        if (d.cash.trim() !== '' && !Number.isFinite(Number(d.cash.replace(/[$,\s]/g, '')))) {
            setRowErrors(prev => ({ ...prev, [entry.id]: `${t('cash')}: el monto no es válido.` }));
            return;
        }

        setBusyId(entry.id);
        setRowErrors(prev => {
            const next = { ...prev };
            delete next[entry.id];
            return next;
        });

        try {
            const result = await upsertEntry(
                shiftId,
                d.cloverEmployeeId,
                d.employeeName,
                d.role,
                toCents(d.credit) / 100,
                toCents(d.service) / 100,
                cashOf(d)
            );
            if (!result.success) {
                setRowErrors(prev => ({ ...prev, [entry.id]: result.error ?? 'No se pudo guardar la fila.' }));
                return;
            }

            // upsertEntry keys on [shift, cloverEmployeeId], so reassigning a row
            // to a different person writes a new row rather than moving this
            // one. Remove the old one after the new one exists — a failure here
            // leaves a visible duplicate rather than losing the amounts.
            const previousId = baseline[entry.id]?.cloverEmployeeId;
            if (previousId && previousId !== d.cloverEmployeeId) {
                const removed = await removeEntry(entry.id);
                if (!removed.success) {
                    setRowErrors(prev => ({
                        ...prev,
                        [entry.id]: 'Se guardó con la persona nueva, pero quedó duplicada la anterior. Avisa a un administrador.'
                    }));
                    return;
                }
            }

            setBaseline(prev => ({ ...prev, [entry.id]: { ...d } }));
        } catch (e) {
            setRowErrors(prev => ({
                ...prev,
                [entry.id]: e instanceof Error ? e.message : String(e)
            }));
        } finally {
            setBusyId(null);
        }
    };

    // Live figures come from the drafts, so the numbers track what the user is
    // looking at rather than what was last written. Display only.
    const liveCents = (id: string, field: 'credit' | 'service' | 'cash'): number | null => {
        const d = drafts[id];
        if (!d) return 0;
        if (field === 'cash') return d.cash.trim() === '' ? null : toCents(d.cash);
        return toCents(d[field]);
    };

    const columns = [
        { key: 'credit' as const, label: t('credit_tips'), target: toCents(day.totalCreditTips) },
        { key: 'service' as const, label: t('service_charge'), target: toCents(day.totalServiceCharge) },
        { key: 'cash' as const, label: t('cash'), target: toCents(day.totalCashTips) }
    ];

    const roleLabel = (role: Role) => (role === 'MESERO' ? t('mesero') : t('busser'));
    // The Rol column is 16%, which at tablet-portrait width leaves ~28px of text
    // room per button — not enough for "Mesero". The full word stays as the
    // title and aria-label so nothing is lost to a screen reader or on hover.
    const roleShort = (role: Role) => (role === 'MESERO' ? 'Mes.' : 'Bus.');

    return (
        <>
            {day.shifts.map(shift => {
                // Someone already on another row of this shift cannot be picked
                // again — the unique constraint would reject it.
                const takenInShift = new Set(
                    shift.entries.map(e => drafts[e.id]?.cloverEmployeeId).filter(Boolean)
                );

                return (
                    <div key={shift.id} className="glass-panel" style={{ padding: '0', overflowX: 'auto' }}>
                        <h2 style={{ margin: 0, padding: '1.25rem 1rem', fontSize: '1.2rem', fontWeight: 700, color: 'var(--accent-primary)' }}>
                            {t('shift')} {shift.orderIndex + 1}
                        </h2>

                        {shift.entries.length === 0 ? (
                            <p style={{ margin: 0, padding: '0 1rem 1.75rem 1rem', fontSize: '1.1rem', color: 'var(--text-secondary)' }}>
                                {t('no_entries')}
                            </p>
                        ) : (
                            <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', minWidth: '560px', tableLayout: 'fixed' }}>
                                <ShiftColGroup editable={!readOnly} />
                                <thead>
                                    <tr style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                                        <th style={head}>{t('name')}</th>
                                        <th style={head}>{t('role')}</th>
                                        <th style={numericHead}>{t('credit_tips')}</th>
                                        <th style={numericHead}>{t('service_charge')}</th>
                                        <th style={numericHead}>{t('cash')}</th>
                                        {!readOnly && <th style={numericHead} />}
                                    </tr>
                                </thead>
                                <tbody>
                                    {shift.entries.map(entry => {
                                        const d = drafts[entry.id];
                                        const dirty = isDirty(entry.id);
                                        const busy = busyId === entry.id;
                                        const err = rowErrors[entry.id];

                                        if (readOnly || !d) {
                                            return (
                                                <tr key={entry.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                                    <td style={{ ...cell, fontWeight: 500, color: 'var(--text-primary)' }}>{entry.employeeName}</td>
                                                    <td style={{ ...cell, color: 'var(--text-secondary)' }}>{roleLabel(entry.role)}</td>
                                                    <td style={numericCell}>{formatMoney(toCents(entry.creditTips))}</td>
                                                    <td style={numericCell}>{formatMoney(toCents(entry.serviceCharge))}</td>
                                                    <td style={numericCell}>
                                                        {entry.cashTips === null ? (
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'flex-end', color: 'var(--warning)', fontWeight: 600 }}>
                                                                <AlertTriangle size={18} />
                                                                — {t('not_counted')}
                                                            </span>
                                                        ) : (
                                                            formatMoney(toCents(entry.cashTips))
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        }

                                        return (
                                            <tr
                                                key={entry.id}
                                                style={{
                                                    borderBottom: err ? 'none' : '1px solid var(--border)',
                                                    // Unsaved work is obvious without reading anything.
                                                    borderLeft: dirty ? '4px solid var(--warning)' : '4px solid transparent'
                                                }}
                                            >
                                                <td style={{ ...cell, paddingLeft: 'calc(1rem - 4px)' }}>
                                                    <select
                                                        value={d.cloverEmployeeId}
                                                        onChange={e => {
                                                            const person = staff.find(s => s.id === e.target.value);
                                                            patch(entry.id, {
                                                                cloverEmployeeId: e.target.value,
                                                                employeeName: person?.name ?? d.employeeName
                                                            });
                                                        }}
                                                        style={{ ...inputStyle, textAlign: 'left', cursor: 'pointer' }}
                                                    >
                                                        <option value="">{t('choose_person')}</option>
                                                        {/* Whoever is on the row stays selectable even if they
                                                            are hidden or no longer wait staff, so opening the
                                                            row cannot silently reassign it. */}
                                                        {d.cloverEmployeeId && !staff.some(s => s.id === d.cloverEmployeeId) && (
                                                            <option value={d.cloverEmployeeId}>{d.employeeName}</option>
                                                        )}
                                                        {staff
                                                            .filter(s => s.id === d.cloverEmployeeId || !takenInShift.has(s.id))
                                                            .map(s => (
                                                                <option key={s.id} value={s.id}>{s.name}</option>
                                                            ))}
                                                    </select>
                                                </td>

                                                <td style={cell}>
                                                    <div style={{ display: 'flex', gap: '0.3rem' }}>
                                                        {(['MESERO', 'BUSSER'] as Role[]).map(r => (
                                                            <button
                                                                key={r}
                                                                onClick={() => patch(entry.id, { role: r })}
                                                                title={roleLabel(r)}
                                                                aria-label={roleLabel(r)}
                                                                style={{
                                                                    flex: 1, minHeight: '52px', padding: '0 0.35rem',
                                                                    borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600,
                                                                    whiteSpace: 'nowrap', cursor: 'pointer',
                                                                    color: d.role === r ? 'white' : 'var(--text-secondary)',
                                                                    background: d.role === r ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)',
                                                                    border: d.role === r ? '1px solid var(--accent-primary)' : '1px solid var(--border)'
                                                                }}
                                                            >
                                                                {roleShort(r)}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </td>

                                                <td style={cell}>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={d.credit}
                                                        onChange={e => patch(entry.id, { credit: e.target.value })}
                                                        style={inputStyle}
                                                    />
                                                </td>
                                                <td style={cell}>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={d.service}
                                                        onChange={e => patch(entry.id, { service: e.target.value })}
                                                        style={inputStyle}
                                                    />
                                                </td>
                                                <td style={cell}>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={d.cash}
                                                        placeholder={t('not_counted')}
                                                        onChange={e => patch(entry.id, { cash: e.target.value })}
                                                        style={{
                                                            ...inputStyle,
                                                            borderColor: d.cash.trim() === '' ? 'var(--warning)' : 'var(--border)'
                                                        }}
                                                    />
                                                </td>

                                                <td style={{ ...cell, textAlign: 'right' }}>
                                                    <button
                                                        onClick={() => handleSave(entry, shift.id)}
                                                        disabled={busy || !dirty || !d.cloverEmployeeId}
                                                        title={busy ? t('saving') : t('save')}
                                                        aria-label={t('save')}
                                                        aria-busy={busy}
                                                        style={{
                                                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                            minHeight: '52px', minWidth: '52px', padding: '0 0.5rem',
                                                            borderRadius: '8px',
                                                            color: dirty && d.cloverEmployeeId ? 'white' : 'var(--text-secondary)',
                                                            background: dirty && d.cloverEmployeeId ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)',
                                                            border: dirty && d.cloverEmployeeId ? '1px solid var(--accent-primary)' : '1px solid var(--border)',
                                                            opacity: busy ? 0.5 : 1,
                                                            cursor: busy || !dirty || !d.cloverEmployeeId ? 'not-allowed' : 'pointer'
                                                        }}
                                                    >
                                                        {/* Identical element in both states, so the column never
                                                            reflows mid-save. There is no working spinner in this
                                                            codebase to reuse, so busy reads as dimming. */}
                                                        <Save size={18} style={{ opacity: busy ? 0.4 : 1 }} />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}

                                    {/* Per-row errors sit on their own line so they can be read
                                        in full without squeezing the grid. */}
                                    {shift.entries.map(entry =>
                                        rowErrors[entry.id] ? (
                                            <tr key={`${entry.id}-error`} style={{ borderBottom: '1px solid var(--border)' }}>
                                                <td colSpan={readOnly ? 5 : 6} style={{ padding: '0 1rem 0.9rem 1rem' }}>
                                                    <span style={{ color: 'var(--danger)', fontSize: '1rem' }}>
                                                        {drafts[entry.id]?.employeeName || entry.employeeName}: {rowErrors[entry.id]}
                                                    </span>
                                                </td>
                                            </tr>
                                        ) : null
                                    )}

                                    <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                                        <td style={{ ...cell, fontWeight: 700, color: 'var(--text-primary)' }} colSpan={2}>
                                            {t('subtotal')}
                                        </td>
                                        {columns.map(c => {
                                            const values = shift.entries.map(e => liveCents(e.id, c.key));
                                            const hasUncounted = values.some(v => v === null);
                                            const sum = sumCents(values.map(v => v ?? 0));
                                            return (
                                                <td key={c.key} style={{ ...numericCell, fontWeight: 700 }}>
                                                    {formatMoney(sum)}
                                                    {hasUncounted && (
                                                        <AlertTriangle size={16} color="var(--warning)" style={{ marginLeft: '0.4rem', verticalAlign: 'text-bottom' }} />
                                                    )}
                                                </td>
                                            );
                                        })}
                                        {!readOnly && <td style={cell} />}
                                    </tr>
                                </tbody>
                            </table>
                        )}
                    </div>
                );
            })}

            <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {!readOnly && dirtyCount > 0 && (
                    <p style={{ margin: 0, color: 'var(--warning)', fontSize: '1.05rem', fontWeight: 600 }}>
                        {t('unsaved_warning')}
                    </p>
                )}

                {columns.map(c => {
                    const distributed = sumCents(allEntries.map(e => liveCents(e.id, c.key) ?? 0));
                    const diff = c.target - distributed;
                    return (
                        <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{c.label}</span>
                            <span style={{ fontSize: '1.05rem', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                                {formatMoney(distributed)} / {formatMoney(c.target)}
                            </span>
                            {diff === 0 ? (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: 'var(--success)', fontWeight: 600 }}>
                                    <CheckCircle2 size={18} />
                                    {t('balanced')}
                                </span>
                            ) : (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: diff < 0 ? 'var(--danger)' : 'var(--warning)', fontWeight: 600 }}>
                                    <AlertTriangle size={18} />
                                    {diff < 0 ? t('excess') : t('remaining')}: {formatMoney(Math.abs(diff))}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        </>
    );
}
