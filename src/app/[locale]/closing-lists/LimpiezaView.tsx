'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    getLimpiezaDia, toggleShiftTask, setShiftRunStaff, completeShiftRun,
    createShiftDeferral, resolveShiftDeferral, type DeferralPlan,
} from '@/app/actions/shiftLists';
import { businessDateToUtcDate, formatBusinessDateEs } from '@/lib/businessDay';
import PhotoCapture, { type CapturedPhoto } from '@/components/ui/PhotoCapture';
import ShiftShareModal, { type ShiftShareSnapshot } from './ShiftShareModal';

type Dia = Awaited<ReturnType<typeof getLimpiezaDia>>;
type Section = Dia['sections'][number];
type Deferral = Dia['deferrals'][number];
type Staff = { id: string; name: string };

/** Photos live here, in React state, and nowhere else. */
type SectionPhotos = { antes: CapturedPhoto[]; despues: CapturedPhoto[] };

const PHOTO_HINT = 'Las fotos solo se guardan hasta que compartas. Si recargas la página se pierden.';

const PLAN_LABEL: Record<DeferralPlan, string> = {
    ESTA_NOCHE: 'Esta noche',
    PROXIMA_APERTURA: 'Próxima apertura',
};

const fechaEs = (businessDate: string) => formatBusinessDateEs(businessDateToUtcDate(businessDate));

/**
 * Deferrals are stored one per task; on screen they read as one postponed
 * section, so they are grouped back by run + section + plan + reason.
 */
function groupDeferrals(deferrals: Deferral[]) {
    const groups = new Map<string, {
        key: string; sectionName: string; businessDate: string;
        plannedFor: string; reason: string; ids: string[]; tasks: string[];
    }>();
    for (const d of deferrals) {
        const key = `${d.runId}|${d.task.section.id}|${d.plannedFor}|${d.reason}`;
        const g = groups.get(key);
        if (g) {
            g.ids.push(d.id);
            g.tasks.push(d.task.text);
        } else {
            groups.set(key, {
                key, sectionName: d.task.section.name, businessDate: d.run.businessDate,
                plannedFor: d.plannedFor, reason: d.reason, ids: [d.id], tasks: [d.task.text],
            });
        }
    }
    return [...groups.values()];
}

/**
 * The deep-cleaning tab. One LIMPIEZA section per weekday as seeded; on a day
 * with none this is just an empty state. Tasks write through immediately like
 * the other lists. Photos are held in memory for the session and go out with
 * the share — nothing about them is ever stored.
 */
export default function LimpiezaView({ staff }: { staff: Staff[] }) {
    const [dia, setDia] = useState<Dia | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [checked, setChecked] = useState<Set<string>>(new Set());
    const [staffBySection, setStaffBySection] = useState<Record<string, string[]>>({});
    const [photos, setPhotos] = useState<Record<string, SectionPhotos>>({});
    const [actionError, setActionError] = useState<string | null>(null);

    const [deferOpen, setDeferOpen] = useState<string | null>(null);
    const [deferReason, setDeferReason] = useState('');
    const [deferPlan, setDeferPlan] = useState<DeferralPlan | null>(null);
    const [deferBusy, setDeferBusy] = useState(false);
    const [resolvingKey, setResolvingKey] = useState<string | null>(null);

    const [isCompleting, setIsCompleting] = useState(false);
    const [completed, setCompleted] = useState(false);
    const [shareSnapshot, setShareSnapshot] = useState<ShiftShareSnapshot | null>(null);
    const [sharePhotos, setSharePhotos] = useState<CapturedPhoto[]>([]);

    const load = useCallback(async () => {
        setIsLoading(true);
        try {
            const result = await getLimpiezaDia();
            setDia(result);
            setChecked(new Set((result.run?.checks ?? []).map(c => c.taskId)));
            const bySection: Record<string, string[]> = {};
            for (const s of result.run?.staff ?? []) {
                (bySection[s.sectionId] ??= []).push(s.employeeId);
            }
            setStaffBySection(bySection);
            setCompleted(result.run?.completedAt != null);
            setLoadError(null);
        } catch (e) {
            setLoadError(e instanceof Error ? e.message : String(e));
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const handleToggleTask = async (taskId: string) => {
        const next = !checked.has(taskId);
        setChecked(prev => {
            const copy = new Set(prev);
            if (next) copy.add(taskId);
            else copy.delete(taskId);
            return copy;
        });
        setActionError(null);
        const result = await toggleShiftTask('LIMPIEZA', taskId, next);
        if (!result.success) {
            setChecked(prev => {
                const copy = new Set(prev);
                if (next) copy.delete(taskId);
                else copy.add(taskId);
                return copy;
            });
            setActionError(result.error ?? 'No se pudo guardar la tarea.');
        }
    };

    const handleToggleStaff = async (sectionId: string, employee: Staff) => {
        const current = staffBySection[sectionId] ?? [];
        const nextIds = current.includes(employee.id)
            ? current.filter(id => id !== employee.id)
            : [...current, employee.id];
        setStaffBySection(prev => ({ ...prev, [sectionId]: nextIds }));
        setActionError(null);
        const employees = nextIds
            .map(id => staff.find(s => s.id === id))
            .filter((s): s is Staff => !!s)
            .map(s => ({ id: s.id, name: s.name }));
        const result = await setShiftRunStaff('LIMPIEZA', sectionId, employees);
        if (!result.success) {
            setStaffBySection(prev => ({ ...prev, [sectionId]: current }));
            setActionError(result.error ?? 'No se pudo guardar el personal.');
        }
    };

    const photosOf = (sectionId: string): SectionPhotos => photos[sectionId] ?? { antes: [], despues: [] };
    const setSectionPhotos = (sectionId: string, kind: keyof SectionPhotos, list: CapturedPhoto[]) =>
        setPhotos(prev => ({ ...prev, [sectionId]: { ...photosOf(sectionId), [kind]: list } }));

    const handleDefer = async (sectionId: string) => {
        if (!deferPlan || !deferReason.trim() || deferBusy) return;
        setDeferBusy(true);
        setActionError(null);
        try {
            const r = await createShiftDeferral({ listType: 'LIMPIEZA', sectionId, reason: deferReason, plannedFor: deferPlan });
            if (!r.success) {
                setActionError(r.error ?? 'No se pudo posponer la sección.');
                return;
            }
            setDeferOpen(null);
            setDeferReason('');
            setDeferPlan(null);
            await load();
        } finally {
            setDeferBusy(false);
        }
    };

    const handleResolve = async (group: { key: string; ids: string[] }) => {
        if (resolvingKey) return;
        setResolvingKey(group.key);
        setActionError(null);
        try {
            for (const id of group.ids) {
                const r = await resolveShiftDeferral(id);
                if (!r.success) {
                    setActionError(r.error ?? 'No se pudo marcar como resuelto.');
                    return;
                }
            }
            await load();
        } finally {
            setResolvingKey(null);
        }
    };

    /** The list as it stands right now, in the shape the share modal sends. */
    const takeSnapshot = (): { snapshot: ShiftShareSnapshot; photos: CapturedPhoto[] } | null => {
        if (!dia) return null;
        const all: CapturedPhoto[] = [];
        const snapshot: ShiftShareSnapshot = {
            listType: 'LIMPIEZA',
            businessDate: dia.businessDate,
            sections: dia.sections.map(section => {
                const p = photosOf(section.id);
                all.push(...p.antes, ...p.despues);
                return {
                    name: section.name,
                    tasks: section.tasks.map(task => ({ text: task.text, checked: checked.has(task.id) })),
                    staffNames: (staffBySection[section.id] ?? [])
                        .map(id => staff.find(s => s.id === id)?.name)
                        .filter((n): n is string => !!n),
                    photos: p.antes.length + p.despues.length,
                };
            }),
        };
        return { snapshot, photos: all };
    };

    const handleComplete = async () => {
        // Snapshot first, send second. Anything read after the await is
        // post-mutation, which is not what the user pressed the button on.
        const snap = takeSnapshot();
        if (!snap) return;
        setIsCompleting(true);
        setActionError(null);
        try {
            const result = await completeShiftRun('LIMPIEZA');
            if (!result.success) {
                setActionError(result.error ?? 'No se pudo cerrar la lista.');
                return;
            }
            setCompleted(true);
            // Opens the modal only. The share sheet itself runs from the
            // modal's button — iOS needs a direct tap for it.
            setShareSnapshot(snap.snapshot);
            setSharePhotos(snap.photos);
        } catch (e) {
            setActionError(e instanceof Error ? e.message : String(e));
        } finally {
            setIsCompleting(false);
        }
    };

    if (isLoading) {
        return <p style={{ color: 'var(--text-secondary)', fontSize: '1.15rem' }}>Cargando...</p>;
    }
    if (loadError || !dia) {
        return <p style={{ color: 'var(--danger)', fontSize: '1.15rem' }}>Error al cargar: {loadError ?? 'sin datos'}</p>;
    }

    const groups = groupDeferrals(dia.deferrals);
    const allTasks = dia.sections.flatMap(s => s.tasks);
    const doneCount = allTasks.filter(t => checked.has(t.id)).length;
    const everySectionStaffed = dia.sections.every(s => (staffBySection[s.id] ?? []).length > 0);

    const renderSection = (section: Section) => {
        const selectedIds = staffBySection[section.id] ?? [];
        const p = photosOf(section.id);
        const deferring = deferOpen === section.id;
        return (
            <div key={section.id} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-primary)' }}>
                    {section.name}
                </h2>

                <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <span style={{ fontSize: '1.05rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                        ¿Quién hizo esta sección?
                    </span>
                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                        {staff.length === 0 && (
                            <span style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>No hay personal disponible.</span>
                        )}
                        {staff.map(person => {
                            const isOn = selectedIds.includes(person.id);
                            return (
                                <button
                                    key={person.id}
                                    onClick={() => handleToggleStaff(section.id, person)}
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
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {section.tasks.map(task => {
                        const isOn = checked.has(task.id);
                        return (
                            <button
                                key={task.id}
                                onClick={() => handleToggleTask(task.id)}
                                className="glass-panel"
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '1rem',
                                    padding: '1.1rem 1.25rem', minHeight: '72px',
                                    textAlign: 'left', width: '100%', cursor: 'pointer',
                                    border: isOn
                                        ? '1px solid color-mix(in srgb, var(--success) 45%, transparent)'
                                        : '1px solid var(--border)',
                                    background: isOn
                                        ? 'color-mix(in srgb, var(--success) 10%, transparent)'
                                        : undefined
                                }}
                            >
                                <span
                                    aria-hidden
                                    style={{
                                        flexShrink: 0,
                                        width: '32px', height: '32px', borderRadius: '8px',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: '1.3rem', fontWeight: 700, lineHeight: 1,
                                        color: isOn ? 'white' : 'transparent',
                                        background: isOn ? 'var(--success)' : 'transparent',
                                        border: isOn ? '1px solid var(--success)' : '2px solid var(--border)'
                                    }}
                                >
                                    ✓
                                </span>
                                <span style={{
                                    fontSize: '1.2rem',
                                    color: isOn ? 'var(--text-secondary)' : 'var(--text-primary)',
                                    textDecoration: isOn ? 'line-through' : 'none'
                                }}>
                                    {task.text}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    <PhotoCapture
                        label="Antes"
                        photos={p.antes}
                        onChange={list => setSectionPhotos(section.id, 'antes', list)}
                        hint={PHOTO_HINT}
                    />
                    <PhotoCapture
                        label="Después"
                        photos={p.despues}
                        onChange={list => setSectionPhotos(section.id, 'despues', list)}
                        hint={PHOTO_HINT}
                    />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {!deferring ? (
                        <button
                            onClick={() => { setDeferOpen(section.id); setDeferReason(''); setDeferPlan(null); }}
                            className="btn-secondary"
                            style={{
                                alignSelf: 'flex-start',
                                borderRadius: '8px', padding: '0.9rem 1.4rem', minHeight: '56px',
                                fontSize: '1.1rem', fontWeight: 600,
                                background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                                color: 'var(--text-primary)', cursor: 'pointer'
                            }}
                        >
                            Posponer
                        </button>
                    ) : (
                        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Posponer esta sección</span>
                            <textarea
                                value={deferReason}
                                disabled={deferBusy}
                                onChange={e => setDeferReason(e.target.value)}
                                placeholder="Motivo"
                                rows={2}
                                style={{
                                    width: '100%', boxSizing: 'border-box', fontSize: '1.05rem', padding: '0.75rem',
                                    borderRadius: '10px', background: 'rgba(0,0,0,0.2)', color: 'var(--text-primary)',
                                    border: '1px solid var(--border)', resize: 'vertical',
                                }}
                            />
                            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                                {(['ESTA_NOCHE', 'PROXIMA_APERTURA'] as DeferralPlan[]).map(plan => {
                                    const isOn = deferPlan === plan;
                                    return (
                                        <button
                                            key={plan}
                                            type="button"
                                            disabled={deferBusy}
                                            onClick={() => setDeferPlan(plan)}
                                            style={{
                                                padding: '0.8rem 1.3rem', minHeight: '56px',
                                                borderRadius: '999px', fontSize: '1.1rem', fontWeight: 600, cursor: 'pointer',
                                                color: isOn ? 'white' : 'var(--text-secondary)',
                                                background: isOn ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)',
                                                border: isOn ? '1px solid var(--accent-primary)' : '1px solid var(--border)'
                                            }}
                                        >
                                            {PLAN_LABEL[plan]}
                                        </button>
                                    );
                                })}
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                                <button
                                    type="button"
                                    onClick={() => setDeferOpen(null)}
                                    disabled={deferBusy}
                                    className="btn-secondary"
                                    style={{
                                        borderRadius: '8px', padding: '0.9rem 1.4rem', minHeight: '56px',
                                        fontSize: '1.1rem', fontWeight: 600,
                                        background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                                        color: 'var(--text-primary)', cursor: 'pointer'
                                    }}
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDefer(section.id)}
                                    disabled={deferBusy || !deferPlan || !deferReason.trim()}
                                    className="btn-primary"
                                    style={{
                                        borderRadius: '8px', padding: '0.9rem 1.6rem', minHeight: '56px',
                                        fontSize: '1.1rem', fontWeight: 700,
                                        opacity: deferBusy || !deferPlan || !deferReason.trim() ? 0.5 : 1,
                                        cursor: deferBusy || !deferPlan || !deferReason.trim() ? 'not-allowed' : 'pointer'
                                    }}
                                >
                                    {deferBusy ? 'Guardando...' : 'Confirmar'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Limpieza Profunda — {fechaEs(dia.businessDate)}
            </h2>

            {groups.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {groups.map(g => (
                        <div
                            key={g.key}
                            style={{
                                padding: '1rem 1.25rem', borderRadius: '12px',
                                background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d',
                                display: 'flex', flexDirection: 'column', gap: '0.5rem'
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                                    Pospuesto · {g.sectionName}
                                </span>
                                <span style={{ fontSize: '0.95rem' }}>
                                    {fechaEs(g.businessDate)} · {PLAN_LABEL[g.plannedFor as DeferralPlan] ?? g.plannedFor}
                                </span>
                            </div>
                            <span style={{ fontSize: '1rem', fontStyle: 'italic' }}>{g.reason}</span>
                            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.95rem' }}>
                                {g.tasks.map((text, i) => <li key={i}>{text}</li>)}
                            </ul>
                            <button
                                type="button"
                                onClick={() => handleResolve(g)}
                                disabled={resolvingKey !== null}
                                style={{
                                    alignSelf: 'flex-start',
                                    borderRadius: '8px', padding: '0.8rem 1.3rem', minHeight: '56px',
                                    fontSize: '1.05rem', fontWeight: 700, cursor: 'pointer',
                                    background: '#92400e', color: '#ffffff', border: 'none',
                                    opacity: resolvingKey !== null ? 0.6 : 1
                                }}
                            >
                                {resolvingKey === g.key ? 'Guardando...' : 'Resuelto'}
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {dia.sections.length === 0 ? (
                <p style={{ margin: 0, fontSize: '1.3rem', color: 'var(--text-secondary)' }}>
                    No hay limpieza profunda programada para hoy.
                </p>
            ) : (
                <>
                    {dia.sections.map(renderSection)}

                    {actionError && (
                        <p style={{ margin: 0, color: 'var(--danger)', fontSize: '1.1rem' }}>{actionError}</p>
                    )}

                    <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <p style={{ margin: 0, fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                            {doneCount} de {allTasks.length} completadas
                        </p>

                        {!everySectionStaffed && (
                            <p style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-secondary)' }}>
                                Selecciona quién hizo cada sección para poder completar.
                            </p>
                        )}

                        <button
                            onClick={handleComplete}
                            disabled={!everySectionStaffed || isCompleting}
                            className="btn-primary"
                            style={{
                                alignSelf: 'flex-start',
                                borderRadius: '10px', padding: '1rem 2rem', minHeight: '72px',
                                fontSize: '1.25rem', fontWeight: 700,
                                opacity: !everySectionStaffed || isCompleting ? 0.5 : 1,
                                cursor: !everySectionStaffed || isCompleting ? 'not-allowed' : 'pointer'
                            }}
                        >
                            {isCompleting ? 'Guardando...' : 'Completar y compartir'}
                        </button>

                        {completed && (
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap',
                                padding: '1rem 1.25rem', borderRadius: '12px', fontSize: '1.1rem', fontWeight: 600,
                                color: 'var(--success)',
                                background: 'color-mix(in srgb, var(--success) 12%, transparent)',
                                border: '1px solid color-mix(in srgb, var(--success) 35%, transparent)'
                            }}>
                                <span>✓ Lista completada.</span>
                                <button
                                    onClick={() => { const s = takeSnapshot(); if (s) { setShareSnapshot(s.snapshot); setSharePhotos(s.photos); } }}
                                    className="btn-secondary"
                                    style={{
                                        borderRadius: '8px', padding: '0.9rem 1.4rem', minHeight: '56px',
                                        fontSize: '1.1rem', fontWeight: 600,
                                        background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                                        color: 'var(--text-primary)', cursor: 'pointer'
                                    }}
                                >
                                    Compartir
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}

            {shareSnapshot && (
                <ShiftShareModal
                    snapshot={shareSnapshot}
                    staff={staff}
                    photos={sharePhotos}
                    onClose={() => setShareSnapshot(null)}
                />
            )}
        </div>
    );
}
