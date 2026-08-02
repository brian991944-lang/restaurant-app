'use client';

import { useState, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { saveShift } from '@/app/actions/tips';
// Type-only: avoids shipping a client reference to an action never called here.
import type { getTipDay } from '@/app/actions/tips';
import { toCents, sumCents, formatMoney } from '@/lib/money';

type TipDay = NonNullable<Awaited<ReturnType<typeof getTipDay>>>;
type TipShift = TipDay['shifts'][number];
type TipEntry = TipShift['entries'][number];
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

/** Five columns in both states, so submitted and draft days align identically. */
function ShiftColGroup() {
    return (
        <colgroup>
            <col style={{ width: '24%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '19%' }} />
            <col style={{ width: '19%' }} />
            <col style={{ width: '20%' }} />
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
 * '30.00' does not mark the shift dirty — only a real change does.
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

    // Baseline is what the database holds; drafts are what the user sees. A
    // shift is dirty when any of its rows' signatures differ, so there is no
    // flag to forget to clear after a save.
    const [baseline, setBaseline] = useState<Record<string, RowDraft>>(() =>
        Object.fromEntries(allEntries.map(e => [e.id, draftFromEntry(e)]))
    );
    const [drafts, setDrafts] = useState<Record<string, RowDraft>>(() =>
        Object.fromEntries(allEntries.map(e => [e.id, draftFromEntry(e)]))
    );

    /** Who is filling each shift in, keyed by shift id. */
    const [filler, setFiller] = useState<Record<string, string>>(() =>
        Object.fromEntries(day.shifts.map(s => [s.id, s.filledByCloverId ?? '']))
    );
    /** Local mirror of filledBy so the footer updates without a refetch. */
    const [filled, setFilled] = useState<Record<string, { name: string; at: string }>>(() =>
        Object.fromEntries(
            day.shifts
                .filter(s => s.filledByName && s.filledAt)
                .map(s => [s.id, { name: s.filledByName!, at: String(s.filledAt) }])
        )
    );

    const [busyShiftId, setBusyShiftId] = useState<string | null>(null);
    const [shiftErrors, setShiftErrors] = useState<Record<string, string>>({});

    const isShiftDirty = (shift: TipShift) =>
        shift.entries.some(e => {
            const d = drafts[e.id], b = baseline[e.id];
            return !!d && !!b && signature(d) !== signature(b);
        });

    const dirtyShiftCount = day.shifts.filter(isShiftDirty).length;

    // A dropped write here is somebody's money, so the browser warns rather
    // than the page trying to flush anything on the way out.
    useEffect(() => {
        if (readOnly || dirtyShiftCount === 0) return;
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [readOnly, dirtyShiftCount]);

    const patch = (id: string, change: Partial<RowDraft>) =>
        setDrafts(prev => ({ ...prev, [id]: { ...prev[id], ...change } }));

    const handleSaveShift = async (shift: TipShift) => {
        const fillerId = filler[shift.id];
        const fillerPerson = staff.find(s => s.id === fillerId);
        if (!fillerId) {
            setShiftErrors(prev => ({ ...prev, [shift.id]: t('filled_by_prompt') }));
            return;
        }

        const rows = shift.entries.map(e => drafts[e.id]).filter(Boolean);
        for (let i = 0; i < rows.length; i++) {
            const d = rows[i];
            for (const [label, raw] of [[t('credit_tips'), d.credit], [t('service_charge'), d.service]] as const) {
                if (raw.trim() === '' || !Number.isFinite(Number(raw.replace(/[$,\s]/g, '')))) {
                    setShiftErrors(prev => ({ ...prev, [shift.id]: `Fila ${i + 1} — ${label}: el monto no es válido.` }));
                    return;
                }
            }
            if (d.cash.trim() !== '' && !Number.isFinite(Number(d.cash.replace(/[$,\s]/g, '')))) {
                setShiftErrors(prev => ({ ...prev, [shift.id]: `Fila ${i + 1} — ${t('cash')}: el monto no es válido.` }));
                return;
            }
        }

        setBusyShiftId(shift.id);
        setShiftErrors(prev => {
            const next = { ...prev };
            delete next[shift.id];
            return next;
        });

        try {
            const result = await saveShift(
                shift.id,
                rows.map(d => ({
                    cloverEmployeeId: d.cloverEmployeeId,
                    employeeName: d.employeeName,
                    role: d.role,
                    creditTips: toCents(d.credit) / 100,
                    serviceCharge: toCents(d.service) / 100,
                    cashTips: cashOf(d)
                })),
                fillerId,
                fillerPerson?.name ?? ''
            );

            if (!result.success) {
                setShiftErrors(prev => ({ ...prev, [shift.id]: result.error ?? 'No se pudo guardar el turno.' }));
                return;
            }

            setBaseline(prev => {
                const next = { ...prev };
                for (const e of shift.entries) if (drafts[e.id]) next[e.id] = { ...drafts[e.id] };
                return next;
            });
            setFilled(prev => ({
                ...prev,
                [shift.id]: { name: fillerPerson?.name ?? '', at: new Date().toISOString() }
            }));
        } catch (e) {
            setShiftErrors(prev => ({
                ...prev,
                [shift.id]: e instanceof Error ? e.message : String(e)
            }));
        } finally {
            setBusyShiftId(null);
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

    return (
        <>
            {day.shifts.map(shift => {
                const dirty = !readOnly && isShiftDirty(shift);
                const busy = busyShiftId === shift.id;
                const err = shiftErrors[shift.id];
                const fillerId = filler[shift.id] ?? '';
                const done = filled[shift.id];

                // Someone already on another row of this shift cannot be picked
                // again — the unique constraint would reject it.
                const takenInShift = new Set(
                    shift.entries.map(e => drafts[e.id]?.cloverEmployeeId).filter(Boolean)
                );

                return (
                    <div
                        key={shift.id}
                        className="glass-panel"
                        style={{
                            padding: '0',
                            overflowX: 'auto',
                            // Unsaved work is obvious without reading anything.
                            borderLeft: dirty ? '4px solid var(--warning)' : undefined
                        }}
                    >
                        <h2 style={{ margin: 0, padding: '1.25rem 1rem', fontSize: '1.2rem', fontWeight: 700, color: 'var(--accent-primary)' }}>
                            {t('shift')} {shift.orderIndex + 1}
                        </h2>

                        {shift.entries.length === 0 ? (
                            <p style={{ margin: 0, padding: '0 1rem 1.75rem 1rem', fontSize: '1.1rem', color: 'var(--text-secondary)' }}>
                                {t('no_entries')}
                            </p>
                        ) : (
                            <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', minWidth: '560px', tableLayout: 'fixed' }}>
                                <ShiftColGroup />
                                <thead>
                                    <tr style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                                        <th style={head}>{t('name')}</th>
                                        <th style={head}>{t('role')}</th>
                                        <th style={numericHead}>{t('credit_tips')}</th>
                                        <th style={numericHead}>{t('service_charge')}</th>
                                        <th style={numericHead}>{t('cash')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {shift.entries.map(entry => {
                                        const d = drafts[entry.id];

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
                                            <tr key={entry.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                                <td style={cell}>
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
                                                                style={{
                                                                    flex: 1, minHeight: '52px', padding: '0 0.35rem',
                                                                    borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600,
                                                                    whiteSpace: 'nowrap', cursor: 'pointer',
                                                                    color: d.role === r ? 'white' : 'var(--text-secondary)',
                                                                    background: d.role === r ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)',
                                                                    border: d.role === r ? '1px solid var(--accent-primary)' : '1px solid var(--border)'
                                                                }}
                                                            >
                                                                {roleLabel(r)}
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
                                            </tr>
                                        );
                                    })}

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
                                    </tr>
                                </tbody>
                            </table>
                        )}

                        {!readOnly && (
                            <div style={{
                                padding: '1.25rem 1rem',
                                borderTop: '1px solid var(--border)',
                                display: 'flex', flexDirection: 'column', gap: '0.75rem'
                            }}>
                                <span style={{ fontSize: '1.05rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                    {t('filled_by_prompt')}
                                </span>

                                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                                    {staff.length === 0 && (
                                        <span style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>
                                            No hay personal disponible.
                                        </span>
                                    )}
                                    {staff.map(person => {
                                        const isOn = fillerId === person.id;
                                        return (
                                            <button
                                                key={person.id}
                                                // Single-select: tapping replaces rather than accumulates.
                                                onClick={() => setFiller(prev => ({ ...prev, [shift.id]: person.id }))}
                                                style={{
                                                    padding: '0.8rem 1.3rem', minHeight: '56px',
                                                    borderRadius: '999px', fontSize: '1.1rem', fontWeight: 600,
                                                    cursor: 'pointer',
                                                    color: isOn ? 'white' : 'var(--text-secondary)',
                                                    background: isOn ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)',
                                                    border: isOn ? '1px solid var(--accent-primary)' : '1px solid var(--border)'
                                                }}
                                            >
                                                {person.name}
                                            </button>
                                        );
                                    })}
                                </div>

                                {err && (
                                    <p style={{ margin: 0, color: 'var(--danger)', fontSize: '1.05rem' }}>{err}</p>
                                )}

                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                    <button
                                        onClick={() => handleSaveShift(shift)}
                                        disabled={busy || !dirty || !fillerId}
                                        style={{
                                            minHeight: '56px', padding: '0 1.6rem', borderRadius: '8px',
                                            fontSize: '1.1rem', fontWeight: 700,
                                            color: dirty && fillerId ? 'white' : 'var(--text-secondary)',
                                            background: dirty && fillerId ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)',
                                            border: dirty && fillerId ? '1px solid var(--accent-primary)' : '1px solid var(--border)',
                                            opacity: busy ? 0.5 : 1,
                                            cursor: busy || !dirty || !fillerId ? 'not-allowed' : 'pointer'
                                        }}
                                    >
                                        {busy ? t('saving') : t('save_shift')}
                                    </button>

                                    {done && (
                                        <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>
                                            {t('filled_by')} {done.name} · {new Date(done.at).toLocaleString('es')}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}

            <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {!readOnly && dirtyShiftCount > 0 && (
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
