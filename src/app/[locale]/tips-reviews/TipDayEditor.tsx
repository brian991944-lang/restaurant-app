'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Lock, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useAdmin } from '@/components/AdminContext';
import { saveShift, addShift, removeShift } from '@/app/actions/tips';
import { syncCloverTips } from '@/app/actions/tipSync';
// Type-only: avoids shipping a client reference to an action never called here.
import type { getTipDay } from '@/app/actions/tips';
import { toCents, sumCents, formatMoney } from '@/lib/money';

type TipDay = NonNullable<Awaited<ReturnType<typeof getTipDay>>>;
type TipShift = TipDay['shifts'][number];
type TipEntry = TipShift['entries'][number];
type StaffMember = { id: string; name: string };
type Role = TipEntry['role'];

/**
 * What the user is currently looking at for one row. Money stays as typed.
 *
 * `key` is a client-side identity, not a database one: a row exists on screen
 * before it exists in the database, and saveShift matches on cloverEmployeeId
 * rather than on an entry id, so nothing here needs the row's id.
 */
interface RowDraft {
    key: string;
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

/** Neutral pill used by every non-primary control on the page. */
const quietButton: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
    minHeight: '52px', padding: '0 1.1rem', borderRadius: '8px',
    fontSize: '1.05rem', fontWeight: 600, cursor: 'pointer',
    color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.05)',
    border: '1px solid var(--border)'
};

/**
 * The five data columns are identical in both states, so a submitted day and a
 * draft day line up. Editing adds a sixth, narrow column for the row's remove
 * button; the money columns give up the room rather than the role column,
 * which has to keep fitting "Mesero" on its button at tablet portrait (768px).
 */
function ShiftColGroup({ withActions }: { withActions: boolean }) {
    return (
        <colgroup>
            <col style={{ width: withActions ? '21%' : '23%' }} />
            <col style={{ width: '26%' }} />
            <col style={{ width: withActions ? '15%' : '17%' }} />
            <col style={{ width: withActions ? '15%' : '17%' }} />
            <col style={{ width: withActions ? '15%' : '17%' }} />
            {withActions && <col style={{ width: '8%' }} />}
        </colgroup>
    );
}

const rowFromEntry = (e: TipEntry): RowDraft => ({
    key: e.id,
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
 * '30.00' does not mark the shift dirty — only a real change does. The key is
 * left out: it identifies the row on screen, not its content.
 */
const rowSignature = (d: RowDraft) =>
    JSON.stringify([
        d.cloverEmployeeId,
        d.role,
        toCents(d.credit),
        toCents(d.service),
        d.cash.trim() === '' ? null : toCents(d.cash)
    ]);

/** Comparable form of a whole shift, so adding or removing a row counts too. */
const shiftSignature = (rows: RowDraft[]) => JSON.stringify(rows.map(rowSignature));

const isAmount = (raw: string) => raw.trim() !== '' && Number.isFinite(Number(raw.replace(/[$,\s]/g, '')));

export default function TipDayEditor({
    day,
    staff,
    isHistorical = false
}: {
    day: TipDay;
    staff: StaffMember[];
    isHistorical?: boolean;
}) {
    const t = useTranslations('Tips');
    const router = useRouter();
    const { isAdmin } = useAdmin();

    const submitted = day.status === 'ENVIADO';

    /**
     * A past day opens locked. An admin can unlock a draft one; nobody can
     * unlock a submitted one from here, because every writer goes through
     * assertEditable and would reject the save — offering a toggle that
     * produces a server error is worse than not offering it. Reopening is the
     * admin path for that, and it audits.
     */
    const [editing, setEditing] = useState(false);
    const canToggleEdit = isHistorical && isAdmin && !submitted;
    const readOnly = submitted || (isHistorical && !(canToggleEdit && editing));

    // Keys for rows the database has never seen. A counter rather than a random
    // id so the first render is identical on server and client.
    const nextKey = useRef(0);
    const blankRow = (): RowDraft => ({
        key: `new-${nextKey.current++}`,
        cloverEmployeeId: '',
        employeeName: '',
        role: 'MESERO',
        credit: '0.00',
        service: '0.00',
        cash: ''
    });

    // Rows are the working copy; baseline is what the database holds. A shift is
    // dirty when its signature differs, so there is no flag to forget to clear.
    const [rows, setRows] = useState<Record<string, RowDraft[]>>(() =>
        Object.fromEntries(day.shifts.map(s => [s.id, s.entries.map(rowFromEntry)]))
    );
    const [baseline, setBaseline] = useState<Record<string, string>>(() =>
        Object.fromEntries(day.shifts.map(s => [s.id, shiftSignature(s.entries.map(rowFromEntry))]))
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

    const [busy, setBusy] = useState(false);
    const [structureBusy, setStructureBusy] = useState(false);
    const [shiftErrors, setShiftErrors] = useState<Record<string, string>>({});
    const [notice, setNotice] = useState<string | null>(null);

    const [syncing, setSyncing] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);
    const [syncSummary, setSyncSummary] = useState<string | null>(null);

    const [breakdownOpen, setBreakdownOpen] = useState(false);

    // Adding or removing a shift is a server write, so the new set of shifts
    // arrives as a new `day` prop. Only shifts this component has never seen are
    // initialised from it — edits in flight elsewhere survive the refresh.
    useEffect(() => {
        const sync = <T,>(prev: Record<string, T>, make: (s: TipShift) => T): Record<string, T> => {
            let changed = Object.keys(prev).length !== day.shifts.length;
            const next: Record<string, T> = {};
            for (const s of day.shifts) {
                if (s.id in prev) {
                    next[s.id] = prev[s.id];
                } else {
                    next[s.id] = make(s);
                    changed = true;
                }
            }
            return changed ? next : prev;
        };

        setRows(prev => sync(prev, s => s.entries.map(rowFromEntry)));
        setBaseline(prev => sync(prev, s => shiftSignature(s.entries.map(rowFromEntry))));
        setFiller(prev => sync(prev, s => s.filledByCloverId ?? ''));
    }, [day.shifts]);

    const shiftRows = (shiftId: string) => rows[shiftId] ?? [];

    const isShiftDirty = (shiftId: string) =>
        !readOnly && shiftSignature(shiftRows(shiftId)) !== (baseline[shiftId] ?? '[]');

    const dirtyShifts = day.shifts.filter(s => isShiftDirty(s.id));

    // A dropped write here is somebody's money, so the browser warns rather
    // than the page trying to flush anything on the way out.
    useEffect(() => {
        if (readOnly || dirtyShifts.length === 0) return;
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [readOnly, dirtyShifts.length]);

    const patchRow = (shiftId: string, key: string, change: Partial<RowDraft>) =>
        setRows(prev => ({
            ...prev,
            [shiftId]: (prev[shiftId] ?? []).map(r => (r.key === key ? { ...r, ...change } : r))
        }));

    const addRow = (shiftId: string) =>
        setRows(prev => ({ ...prev, [shiftId]: [...(prev[shiftId] ?? []), blankRow()] }));

    // Dropping a row locally is enough to delete it: saveShift treats the array
    // it receives as the shift's whole roster and removes anyone missing from it.
    const removeRow = (shiftId: string, key: string) =>
        setRows(prev => ({ ...prev, [shiftId]: (prev[shiftId] ?? []).filter(r => r.key !== key) }));

    const handleSaveAll = async () => {
        setNotice(null);
        const targets = dirtyShifts;
        if (targets.length === 0) return;

        // Everything is checked before the first write, so a save either starts
        // clean or reports back without having touched the day.
        const errors: Record<string, string> = {};
        for (const shift of targets) {
            const list = shiftRows(shift.id);

            if (!filler[shift.id]) {
                errors[shift.id] = t('filled_by_prompt');
                continue;
            }

            // Position is 1-based: it is read by someone looking at a numbered
            // list of rows, not at an array.
            for (let i = 0; i < list.length; i++) {
                const d = list[i];
                if (!d.cloverEmployeeId) continue; // Skipped rather than saved.
                for (const [label, raw] of [[t('credit_tips'), d.credit], [t('service_charge'), d.service]] as const) {
                    if (!isAmount(raw)) {
                        errors[shift.id] = `Fila ${i + 1} — ${label}: el monto no es válido.`;
                    }
                }
                if (d.cash.trim() !== '' && !isAmount(d.cash)) {
                    errors[shift.id] = `Fila ${i + 1} — ${t('cash')}: el monto no es válido.`;
                }
            }
        }

        if (Object.keys(errors).length > 0) {
            setShiftErrors(errors);
            return;
        }

        setShiftErrors({});
        setBusy(true);

        let skipped = 0;
        try {
            for (const shift of targets) {
                const list = shiftRows(shift.id);
                const named = list.filter(r => r.cloverEmployeeId);
                const fillerId = filler[shift.id];
                const fillerPerson = staff.find(s => s.id === fillerId);

                const result = await saveShift(
                    shift.id,
                    named.map(d => ({
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
                    // Stop at the first failure rather than writing on past it,
                    // so what did and did not land stays legible.
                    setShiftErrors(prev => ({
                        ...prev,
                        [shift.id]: result.error ?? 'No se pudo guardar el turno.'
                    }));
                    return;
                }

                skipped += list.length - named.length;

                // Baseline follows the rows on screen, including any personless
                // row left behind: it stays for the user to finish, and picking
                // a person for it makes the shift dirty again.
                setBaseline(prev => ({ ...prev, [shift.id]: shiftSignature(list) }));
                setFilled(prev => ({
                    ...prev,
                    [shift.id]: { name: fillerPerson?.name ?? '', at: new Date().toISOString() }
                }));
            }

            if (skipped > 0) setNotice(`${skipped} ${t('rows_skipped')}`);
            router.refresh();
        } catch (e) {
            setNotice(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    };

    const handleAddShift = async () => {
        setStructureBusy(true);
        setNotice(null);
        try {
            const result = await addShift(day.id);
            if (!result.success) {
                setNotice(result.error ?? 'No se pudo añadir el turno.');
                return;
            }
            router.refresh();
        } finally {
            setStructureBusy(false);
        }
    };

    const handleRemoveShift = async (shift: TipShift) => {
        if (!window.confirm(t('remove_shift_confirm'))) return;

        setStructureBusy(true);
        setNotice(null);
        try {
            const result = await removeShift(shift.id);
            if (!result.success) {
                setShiftErrors(prev => ({ ...prev, [shift.id]: result.error ?? 'No se pudo borrar el turno.' }));
                return;
            }

            // Dropped locally as well as on the server so the panel does not
            // flash the old shift while the refresh is in flight.
            const drop = <T,>(prev: Record<string, T>) => {
                const next = { ...prev };
                delete next[shift.id];
                return next;
            };
            setRows(drop);
            setBaseline(drop);
            setFiller(drop);
            setShiftErrors(drop);
            router.refresh();
        } finally {
            setStructureBusy(false);
        }
    };

    // Live figures come from the rows on screen, so the numbers track what the
    // user is looking at rather than what was last written. Display only.
    const liveCents = (d: RowDraft, field: 'credit' | 'service' | 'cash'): number | null => {
        if (field === 'cash') return d.cash.trim() === '' ? null : toCents(d.cash);
        return toCents(d[field]);
    };

    /**
     * The three money columns of a shift table. Cash is here because it is
     * recorded per person — it is simply not reconciled against anything.
     */
    const moneyColumns = [
        { key: 'credit' as const, label: t('credit_tips') },
        { key: 'service' as const, label: t('service_charge') },
        { key: 'cash' as const, label: t('cash') }
    ];

    /**
     * What the day is reconciled against. Card tips and the service charge come
     * from Clover, which settled them, so the target is not open to argument.
     *
     * Cash is deliberately absent: it never passes through Clover, so there is
     * no independent figure to check the count against. It is recorded, and an
     * uncounted row still blocks submission, but there is no total for it to
     * fail to add up to.
     */
    const balanceColumns = [
        { key: 'credit' as const, label: t('credit_tips'), target: toCents(day.totalCreditTips) },
        { key: 'service' as const, label: t('service_charge'), target: toCents(day.totalServiceCharge) }
    ];

    const handleSync = async () => {
        setSyncing(true);
        setSyncError(null);
        setSyncSummary(null);
        try {
            const result = await syncCloverTips();
            if (!result.success) {
                setSyncError(result.error ?? t('sync_failed'));
                return;
            }
            const s = result.summary;
            if (s) {
                // Counted over scanned, so excluded delivery payments are
                // visible as the gap rather than silently missing.
                setSyncSummary(
                    `${t('sync_summary')}: ${s.paymentsCounted}/${s.paymentsScanned} ${t('payments')}` +
                    ` · ${t('card_tips_col')} ${formatMoney(s.cardTipsCents)}` +
                    ` · ${t('service_charge')} ${formatMoney(s.serviceChargeCents)}` +
                    ` · ${(s.durationMs / 1000).toFixed(1)}s`
                );
            }
            router.refresh();
        } catch (e) {
            setSyncError(e instanceof Error ? e.message : t('sync_failed'));
        } finally {
            setSyncing(false);
        }
    };

    const roleLabel = (role: Role) => (role === 'MESERO' ? t('mesero') : t('busser'));

    const allRows = day.shifts.flatMap(s => shiftRows(s.id));
    const canSave = !readOnly && dirtyShifts.length > 0 && !busy;
    const canSync = !syncing && !readOnly && !isHistorical;

    return (
        <>
            {isHistorical && (
                <div
                    className="glass-panel"
                    style={{
                        padding: '1.25rem 1.5rem',
                        display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
                        borderLeft: `4px solid ${editing ? 'var(--warning)' : 'var(--border)'}`
                    }}
                >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        <Lock size={18} />
                        {t('historical_view')}
                    </span>

                    {submitted && (
                        <span style={{ fontSize: '1.05rem', color: 'var(--text-secondary)' }}>
                            {t('day_submitted_locked')}
                        </span>
                    )}

                    {canToggleEdit && (
                        <button
                            onClick={() => setEditing(on => !on)}
                            aria-pressed={editing}
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
                                minHeight: '52px', padding: '0 1.1rem', borderRadius: '8px',
                                fontSize: '1.05rem', fontWeight: 600, cursor: 'pointer',
                                color: editing ? 'white' : 'var(--text-secondary)',
                                background: editing ? 'var(--warning)' : 'rgba(255,255,255,0.05)',
                                border: editing ? '1px solid var(--warning)' : '1px solid var(--border)'
                            }}
                        >
                            <Pencil size={18} />
                            {editing ? t('editing_enabled') : t('edit_record')}
                        </button>
                    )}
                </div>
            )}

            {/* Balances sit above the shifts: they are what the day is judged on,
                and they have to stay readable while rows are being typed. */}
            <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {balanceColumns.map(c => {
                    const distributed = sumCents(allRows.map(r => liveCents(r, c.key) ?? 0));
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

                {/* Sync sits with the balances because that is what it moves. */}
                <div style={{
                    display: 'flex', flexDirection: 'column', gap: '0.6rem',
                    borderTop: '1px solid var(--border)', paddingTop: '1rem'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                        <button
                            onClick={handleSync}
                            // Historical days are excluded whatever the admin
                            // state: the sync sets the targets outright, so
                            // re-running it would move the figures a finished
                            // day was reconciled against. It also always syncs
                            // today, since the action is called without a date.
                            disabled={syncing || readOnly || isHistorical}
                            style={{
                                ...quietButton,
                                minHeight: '52px',
                                color: canSync ? 'white' : 'var(--text-secondary)',
                                background: canSync ? 'var(--success)' : 'rgba(255,255,255,0.05)',
                                border: canSync ? '1px solid var(--success)' : '1px solid var(--border)',
                                cursor: canSync ? 'pointer' : 'not-allowed',
                                opacity: canSync ? 1 : 0.5
                            }}
                        >
                            <RefreshCw size={18} />
                            {syncing ? t('syncing') : t('sync_clover')}
                        </button>

                        <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>
                            {day.cloverSyncedAt
                                ? `${t('synced_at')}: ${new Date(day.cloverSyncedAt).toLocaleString('es')}`
                                : t('never_synced')}
                        </span>
                    </div>

                    {isHistorical ? (
                        <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>
                            {t('viewing_history')}
                        </span>
                    ) : submitted && (
                        <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>
                            {t('sync_blocked_submitted')}
                        </span>
                    )}
                    {syncSummary && (
                        <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>{syncSummary}</span>
                    )}
                    {syncError && (
                        <p style={{ margin: 0, color: 'var(--danger)', fontSize: '1.05rem' }}>{syncError}</p>
                    )}
                </div>

                {!readOnly && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
                        borderTop: '1px solid var(--border)', paddingTop: '1rem'
                    }}>
                        {/* One save for the whole day: every dirty shift is written
                            in turn, so nobody has to remember which tables they
                            touched. */}
                        <button
                            onClick={handleSaveAll}
                            disabled={!canSave}
                            style={{
                                minHeight: '56px', padding: '0 1.6rem', borderRadius: '8px',
                                fontSize: '1.1rem', fontWeight: 700,
                                color: canSave ? 'white' : 'var(--text-secondary)',
                                background: canSave ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)',
                                border: canSave ? '1px solid var(--accent-primary)' : '1px solid var(--border)',
                                opacity: busy ? 0.5 : 1,
                                cursor: canSave ? 'pointer' : 'not-allowed'
                            }}
                        >
                            {busy ? t('saving') : t('save_all')}
                        </button>

                        {dirtyShifts.length > 0 && (
                            <span style={{ color: 'var(--warning)', fontSize: '1.05rem', fontWeight: 600 }}>
                                {t('unsaved_warning')}
                            </span>
                        )}

                        {notice && (
                            <span style={{ color: 'var(--text-secondary)', fontSize: '1.05rem' }}>{notice}</span>
                        )}
                    </div>
                )}
            </div>

            {day.shifts.map(shift => {
                const dirty = isShiftDirty(shift.id);
                const err = shiftErrors[shift.id];
                const fillerId = filler[shift.id] ?? '';
                const done = filled[shift.id];
                const list = shiftRows(shift.id);

                // Someone already on another row of this shift cannot be picked
                // again — the unique constraint would reject it.
                const takenInShift = new Set(list.map(r => r.cloverEmployeeId).filter(Boolean));

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
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '1.25rem 1rem' }}>
                            <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--accent-primary)' }}>
                                {t('shift')} {shift.orderIndex + 1}
                            </h2>

                            {!readOnly && day.shifts.length > 1 && (
                                <button
                                    onClick={() => handleRemoveShift(shift)}
                                    disabled={structureBusy}
                                    title={t('remove_shift')}
                                    aria-label={t('remove_shift')}
                                    style={{
                                        ...quietButton,
                                        minWidth: '52px', padding: '0 0.9rem',
                                        cursor: structureBusy ? 'not-allowed' : 'pointer',
                                        opacity: structureBusy ? 0.5 : 1
                                    }}
                                >
                                    <Trash2 size={18} />
                                </button>
                            )}
                        </div>

                        {list.length === 0 ? (
                            <p style={{ margin: 0, padding: '0 1rem 1.25rem 1rem', fontSize: '1.1rem', color: 'var(--text-secondary)' }}>
                                {t('no_entries')}
                            </p>
                        ) : (
                            <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', minWidth: readOnly ? '560px' : '640px', tableLayout: 'fixed' }}>
                                <ShiftColGroup withActions={!readOnly} />
                                <thead>
                                    <tr style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                                        <th style={head}>{t('name')}</th>
                                        <th style={head}>{t('role')}</th>
                                        <th style={numericHead}>{t('credit_tips')}</th>
                                        <th style={numericHead}>{t('service_charge')}</th>
                                        <th style={numericHead}>{t('cash')}</th>
                                        {!readOnly && <th style={head} aria-label={t('remove_row')} />}
                                    </tr>
                                </thead>
                                <tbody>
                                    {list.map(d => {
                                        if (readOnly) {
                                            return (
                                                <tr key={d.key} style={{ borderBottom: '1px solid var(--border)' }}>
                                                    <td style={{ ...cell, fontWeight: 500, color: 'var(--text-primary)' }}>{d.employeeName}</td>
                                                    <td style={{ ...cell, color: 'var(--text-secondary)' }}>{roleLabel(d.role)}</td>
                                                    <td style={numericCell}>{formatMoney(toCents(d.credit))}</td>
                                                    <td style={numericCell}>{formatMoney(toCents(d.service))}</td>
                                                    <td style={numericCell}>
                                                        {d.cash.trim() === '' ? (
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'flex-end', color: 'var(--warning)', fontWeight: 600 }}>
                                                                <AlertTriangle size={18} />
                                                                — {t('not_counted')}
                                                            </span>
                                                        ) : (
                                                            formatMoney(toCents(d.cash))
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        }

                                        return (
                                            <tr key={d.key} style={{ borderBottom: '1px solid var(--border)' }}>
                                                <td style={cell}>
                                                    <select
                                                        value={d.cloverEmployeeId}
                                                        onChange={e => {
                                                            const person = staff.find(s => s.id === e.target.value);
                                                            patchRow(shift.id, d.key, {
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
                                                                onClick={() => patchRow(shift.id, d.key, { role: r })}
                                                                title={roleLabel(r)}
                                                                style={{
                                                                    flex: 1, minHeight: '52px', padding: '0 0.5rem',
                                                                    borderRadius: '8px', fontSize: '0.95rem', fontWeight: 600,
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
                                                        onChange={e => patchRow(shift.id, d.key, { credit: e.target.value })}
                                                        style={inputStyle}
                                                    />
                                                </td>
                                                <td style={cell}>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={d.service}
                                                        onChange={e => patchRow(shift.id, d.key, { service: e.target.value })}
                                                        style={inputStyle}
                                                    />
                                                </td>
                                                <td style={cell}>
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        value={d.cash}
                                                        placeholder={t('not_counted')}
                                                        onChange={e => patchRow(shift.id, d.key, { cash: e.target.value })}
                                                        style={{
                                                            ...inputStyle,
                                                            borderColor: d.cash.trim() === '' ? 'var(--warning)' : 'var(--border)'
                                                        }}
                                                    />
                                                </td>

                                                <td style={{ ...cell, textAlign: 'center' }}>
                                                    <button
                                                        onClick={() => removeRow(shift.id, d.key)}
                                                        title={t('remove_row')}
                                                        aria-label={t('remove_row')}
                                                        style={{
                                                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                            minWidth: '52px', minHeight: '52px', borderRadius: '8px',
                                                            cursor: 'pointer', color: 'var(--danger)',
                                                            background: 'rgba(255,255,255,0.05)',
                                                            border: '1px solid var(--border)'
                                                        }}
                                                    >
                                                        <Trash2 size={18} />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}

                                    <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                                        <td style={{ ...cell, fontWeight: 700, color: 'var(--text-primary)' }} colSpan={2}>
                                            {t('subtotal')}
                                        </td>
                                        {moneyColumns.map(c => {
                                            const values = list.map(r => liveCents(r, c.key));
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

                        {!readOnly && (
                            <div style={{
                                padding: '1.25rem 1rem',
                                borderTop: '1px solid var(--border)',
                                display: 'flex', flexDirection: 'column', gap: '0.75rem'
                            }}>
                                <div>
                                    <button onClick={() => addRow(shift.id)} style={quietButton}>
                                        <Plus size={18} />
                                        {t('add_person')}
                                    </button>
                                </div>

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

                                {done && (
                                    <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>
                                        {t('filled_by')} {done.name} · {new Date(done.at).toLocaleString('es')}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}

            {!readOnly && (
                <div>
                    <button
                        onClick={handleAddShift}
                        disabled={structureBusy}
                        style={{
                            ...quietButton,
                            minHeight: '56px',
                            cursor: structureBusy ? 'not-allowed' : 'pointer',
                            opacity: structureBusy ? 0.5 : 1
                        }}
                    >
                        <Plus size={18} />
                        {t('add_shift')}
                    </button>
                </div>
            )}

            {day.employeeTips.length > 0 && (
                <div className="glass-panel" style={{ padding: '0', overflowX: 'auto' }}>
                    {/* Collapsed by default: it is a cross-check, not part of the
                        job of filling the day in. */}
                    <button
                        onClick={() => setBreakdownOpen(open => !open)}
                        aria-expanded={breakdownOpen}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '0.6rem',
                            width: '100%', padding: '1.25rem 1rem', minHeight: '56px',
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)',
                            textAlign: 'left'
                        }}
                    >
                        {breakdownOpen ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                        {t('employee_breakdown')}
                    </button>

                    {breakdownOpen && (
                        <>
                            <p style={{ margin: 0, padding: '0 1rem 1rem 1rem', fontSize: '1rem', color: 'var(--text-secondary)' }}>
                                {t('clover_not_owed')}
                            </p>
                            <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', minWidth: '560px' }}>
                                <thead>
                                    <tr style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                                        <th style={head}>{t('employee')}</th>
                                        <th style={numericHead}>{t('payments')}</th>
                                        <th style={numericHead}>{t('card_tips_col')}</th>
                                        <th style={numericHead}>{t('service_charge')}</th>
                                        <th style={numericHead}>{t('sales')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {day.employeeTips.map(tip => (
                                        <tr key={tip.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                            <td style={{ ...cell, fontWeight: 500, color: 'var(--text-primary)' }}>{tip.employeeName}</td>
                                            <td style={numericCell}>{tip.paymentCount}</td>
                                            <td style={numericCell}>{formatMoney(toCents(tip.cardTips))}</td>
                                            <td style={numericCell}>{formatMoney(toCents(tip.serviceCharge))}</td>
                                            <td style={numericCell}>{formatMoney(toCents(tip.salesAmount))}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </>
                    )}
                </div>
            )}
        </>
    );
}
