'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import { createAdvance } from '@/app/actions/payroll';

/** Just enough to pick a person. Comes from the config panel's own list. */
export type AdvancePerson = { cloverEmployeeId: string; employeeName: string };

const field: React.CSSProperties = {
    minHeight: '48px', padding: '0.5rem 0.7rem', borderRadius: '8px',
    fontSize: '1.02rem', color: 'var(--text-primary)',
    background: 'var(--bg-primary)', border: '1px solid var(--border)',
};

const label: React.CSSProperties = { fontSize: '0.92rem', color: 'var(--text-secondary)' };

export default function NewAdvanceModal({
    people,
    defaultWeekEnding,
    onClose,
}: {
    people: AdvancePerson[];
    /** The last complete week — where a new advance normally starts. */
    defaultWeekEnding: string;
    onClose: () => void;
}) {
    const t = useTranslations('Payroll');
    const router = useRouter();

    const [personId, setPersonId] = useState('');
    const [principal, setPrincipal] = useState('');
    const [weekly, setWeekly] = useState('');
    const [startWeek, setStartWeek] = useState(defaultWeekEnding);
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const principalNum = Number(principal);
    const weeklyNum = Number(weekly);
    const valid =
        personId !== '' &&
        Number.isFinite(principalNum) && principalNum > 0 &&
        Number.isFinite(weeklyNum) && weeklyNum > 0 &&
        weeklyNum <= principalNum &&
        startWeek !== '';

    const submit = async () => {
        const person = people.find(p => p.cloverEmployeeId === personId);
        if (!person) return;

        setSaving(true);
        setError('');
        const res = await createAdvance(
            person.cloverEmployeeId,
            person.employeeName,
            principalNum,
            weeklyNum,
            startWeek,
            note
        );
        if (!res.success) {
            setError(res.error ?? t('advance_create_failed'));
            setSaving(false);
            return;
        }
        router.refresh();
        onClose();
    };

    return (
        <div
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label={t('advance_new_title')}
            style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                // Plain translucent black — no backdrop-filter, which would make
                // this a containing block for its own fixed descendants.
                background: 'rgba(0,0,0,0.5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 1000, padding: '1rem',
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                className="glass-panel"
                style={{
                    width: '100%', maxWidth: '560px', maxHeight: '88vh',
                    padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
                    <div>
                        <h2 style={{ fontSize: '1.3rem', margin: 0 }}>{t('advance_new_title')}</h2>
                        <p style={{ margin: '0.35rem 0 0', color: 'var(--text-secondary)', fontSize: '0.98rem' }}>
                            {t('advance_new_subtitle')}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label={t('manage_close')}
                        style={{ ...field, minWidth: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                    >
                        <X size={20} />
                    </button>
                </div>

                <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', overflowY: 'auto' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <label style={label} htmlFor="adv-person">{t('advance_person')}</label>
                        <select
                            id="adv-person"
                            value={personId}
                            onChange={e => setPersonId(e.target.value)}
                            style={{ ...field, cursor: 'pointer' }}
                        >
                            <option value="">{t('advance_pick_person')}</option>
                            {people.map(p => (
                                <option key={p.cloverEmployeeId} value={p.cloverEmployeeId}>
                                    {p.employeeName}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', flex: '1 1 180px' }}>
                            <label style={label} htmlFor="adv-principal">{t('advance_principal')}</label>
                            <input
                                id="adv-principal" type="number" step="0.01" min="0.01" inputMode="decimal"
                                value={principal} onChange={e => setPrincipal(e.target.value)}
                                style={{ ...field, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                            />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', flex: '1 1 180px' }}>
                            <label style={label} htmlFor="adv-weekly">{t('advance_weekly')}</label>
                            <input
                                id="adv-weekly" type="number" step="0.01" min="0.01" inputMode="decimal"
                                value={weekly} onChange={e => setWeekly(e.target.value)}
                                style={{ ...field, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                            />
                        </div>
                    </div>

                    {/* Stated before saving rather than returned as a server error:
                        the rule is easier to obey than to recover from. */}
                    {principal !== '' && weekly !== '' && Number.isFinite(principalNum) && Number.isFinite(weeklyNum)
                        && weeklyNum > 0 && principalNum > 0 && weeklyNum > principalNum && (
                            <span style={{ color: 'var(--warning)', fontSize: '0.92rem' }}>
                                {t('advance_weekly_too_big')}
                            </span>
                        )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <label style={label} htmlFor="adv-week">{t('advance_start_week')}</label>
                        <input
                            id="adv-week" type="date"
                            value={startWeek} onChange={e => setStartWeek(e.target.value)}
                            style={field}
                        />
                        <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                            {t('advance_start_week_note')}
                        </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <label style={label} htmlFor="adv-note">{t('advance_note')}</label>
                        <input
                            id="adv-note" type="text"
                            value={note} onChange={e => setNote(e.target.value)}
                            style={field}
                        />
                    </div>

                    {error && <span style={{ color: 'var(--danger)', fontSize: '0.98rem' }}>{error}</span>}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', padding: '1rem 1.5rem', borderTop: '1px solid var(--border)' }}>
                    <button onClick={onClose} disabled={saving} style={{ ...field, cursor: 'pointer' }}>
                        {t('manage_cancel')}
                    </button>
                    <button
                        onClick={submit}
                        disabled={!valid || saving}
                        className="btn-primary"
                        style={{ borderRadius: '8px', minHeight: '48px', opacity: (!valid || saving) ? 0.55 : 1 }}
                    >
                        {saving ? t('saving') : t('advance_create')}
                    </button>
                </div>
            </div>
        </div>
    );
}
