'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Camera, RotateCcw } from 'lucide-react';
import {
    getLimpiezaDia, toggleShiftTask, setShiftRunStaff, completeShiftRun, marcarShiftCompartido,
    createShiftDeferral, resolveShiftDeferral, type DeferralPlan,
} from '@/app/actions/shiftLists';
import { businessDateToUtcDate, formatBusinessDateEs } from '@/lib/businessDay';
import SenderPicker, { senderDisplayNames } from '@/components/ui/SenderPicker';
import ShiftShareModal, { buildListaTexto, type ShiftShareSnapshot, type SharePhoto } from './ShiftShareModal';

type Dia = Awaited<ReturnType<typeof getLimpiezaDia>>;
type Section = Dia['sections'][number];
type Task = Section['tasks'][number];
type Deferral = Dia['deferrals'][number];
type Staff = { id: string; name: string };
type PhotoKind = 'antes' | 'despues';

/** One task's photo, held in memory only — nothing here is ever uploaded or stored. */
type TaskPhoto = { url: string; file: File };
type TaskPhotos = { antes?: TaskPhoto; despues?: TaskPhoto };

const PHOTO_HINT = 'Las fotos se guardan solo en este iPad hasta que compartas. Si recargas la página, se pierden.';
const PHOTO_ERROR = 'No se pudo procesar la foto. Intenta de nuevo.';

/** Long edge after downscaling, and JPEG quality for both capture and composite. */
const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.7;

const PLAN_LABEL: Record<DeferralPlan, string> = {
    ESTA_NOCHE: 'Esta noche',
    PROXIMA_APERTURA: 'Próxima apertura',
};

const fechaEs = (businessDate: string) => formatBusinessDateEs(businessDateToUtcDate(businessDate));

const slug = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'foto';

/** Downscale a captured file to a JPEG at most MAX_EDGE on its long side. */
async function compressPhoto(file: File, name: string): Promise<TaskPhoto> {
    const bitmap = await createImageBitmap(file);
    try {
        const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error(PHOTO_ERROR);
        ctx.drawImage(bitmap, 0, 0, w, h);

        const blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(b => (b ? resolve(b) : reject(new Error(PHOTO_ERROR))), 'image/jpeg', JPEG_QUALITY)
        );
        canvas.width = 0;
        canvas.height = 0;

        return { url: URL.createObjectURL(blob), file: new File([blob], name, { type: 'image/jpeg' }) };
    } finally {
        bitmap.close();
    }
}

/** Crop-to-fill draw, like CSS object-fit: cover. */
function drawCover(ctx: CanvasRenderingContext2D, img: ImageBitmap, x: number, y: number, w: number, h: number) {
    const imgRatio = img.width / img.height;
    const targetRatio = w / h;
    let sx = 0, sy = 0, sw = img.width, sh = img.height;
    if (imgRatio > targetRatio) {
        sw = img.height * targetRatio;
        sx = (img.width - sw) / 2;
    } else {
        sh = img.width / targetRatio;
        sy = (img.height - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function wrapCenteredText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, maxWidth: number, lineHeight: number) {
    const words = text.split(' ');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(test).width > maxWidth) {
            lines.push(line);
            line = word;
        } else {
            line = test;
        }
    }
    if (line) lines.push(line);
    const startY = cy - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lineHeight));
}

/** One Antes | Después composite for a task, with its name printed on top. */
async function buildTaskComposite(taskText: string, antes: TaskPhoto, despues: TaskPhoto): Promise<File> {
    const [imgA, imgB] = await Promise.all([createImageBitmap(antes.file), createImageBitmap(despues.file)]);
    try {
        const PANEL_W = 480, PANEL_H = 480, LABEL_H = 64, CAPTION_H = 40, GAP = 8;
        const canvas = document.createElement('canvas');
        canvas.width = PANEL_W * 2 + GAP;
        canvas.height = LABEL_H + PANEL_H + CAPTION_H;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No se pudo generar la imagen.');

        ctx.fillStyle = '#111827';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 28px sans-serif';
        wrapCenteredText(ctx, taskText, canvas.width / 2, LABEL_H / 2, canvas.width - 24, 32);

        drawCover(ctx, imgA, 0, LABEL_H, PANEL_W, PANEL_H);
        drawCover(ctx, imgB, PANEL_W + GAP, LABEL_H, PANEL_W, PANEL_H);

        ctx.font = '600 22px sans-serif';
        ctx.fillText('Antes', PANEL_W / 2, LABEL_H + PANEL_H + CAPTION_H / 2);
        ctx.fillText('Después', PANEL_W + GAP + PANEL_W / 2, LABEL_H + PANEL_H + CAPTION_H / 2);

        const blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(b => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen.'))), 'image/jpeg', 0.85)
        );
        canvas.width = 0;
        canvas.height = 0;
        return new File([blob], `${slug(taskText)}.jpg`, { type: 'image/jpeg' });
    } finally {
        imgA.close();
        imgB.close();
    }
}

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
 * the other lists. Photos are per-task, held in memory for the session only —
 * nothing about them is ever stored — and go out as one composite per task
 * with the share.
 */
export default function LimpiezaView({ staff }: { staff: Staff[] }) {
    const [dia, setDia] = useState<Dia | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [checked, setChecked] = useState<Set<string>>(new Set());
    const [staffBySection, setStaffBySection] = useState<Record<string, string[]>>({});
    const [actionError, setActionError] = useState<string | null>(null);

    const [taskPhotos, setTaskPhotos] = useState<Record<string, TaskPhotos>>({});
    const taskPhotosRef = useRef(taskPhotos);
    taskPhotosRef.current = taskPhotos;
    const [photoBusy, setPhotoBusy] = useState<Record<string, boolean>>({});
    const [photoError, setPhotoError] = useState<Record<string, string>>({});
    const captureTargetRef = useRef<{ taskId: string; kind: PhotoKind } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [deferOpen, setDeferOpen] = useState<string | null>(null);
    const [deferReason, setDeferReason] = useState('');
    const [deferPlan, setDeferPlan] = useState<DeferralPlan | null>(null);
    const [deferBusy, setDeferBusy] = useState(false);
    const [resolvingKey, setResolvingKey] = useState<string | null>(null);

    // Composite built as soon as a task has both Antes and Después, so it is
    // ready before the completion tap rather than built from it — iOS refuses
    // a share sheet that isn't opened from the tap's own user activation.
    const [composites, setComposites] = useState<Record<string, File>>({});
    const builtForRef = useRef<Record<string, string>>({});

    const [isCompleting, setIsCompleting] = useState(false);
    const [completed, setCompleted] = useState(false);
    // For a manual re-share from the completed banner only, via ShiftShareModal.
    const [shareData, setShareData] = useState<{ snapshot: ShiftShareSnapshot; photos: SharePhoto[] } | null>(null);
    const [shareModalOpen, setShareModalOpen] = useState(false);
    const [sender, setSender] = useState<Staff | null>(null);
    // Set only when the list WAS shared but the save came back failed — the
    // person has to know the message went out against nothing.
    const [shareBanner, setShareBanner] = useState<string | null>(null);

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

    // Revoke every outstanding object URL when the tab is left, so switching
    // back and forth doesn't leak memory across the session.
    useEffect(() => {
        return () => {
            for (const p of Object.values(taskPhotosRef.current)) {
                if (p.antes) URL.revokeObjectURL(p.antes.url);
                if (p.despues) URL.revokeObjectURL(p.despues.url);
            }
        };
    }, []);

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

    /** Opens the file picker directly on tap — iOS requires a direct user gesture. */
    const openCapture = (taskId: string, kind: PhotoKind) => {
        captureTargetRef.current = { taskId, kind };
        fileInputRef.current?.click();
    };

    const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        const target = captureTargetRef.current;
        captureTargetRef.current = null;
        if (!file || !target) return;

        const { taskId, kind } = target;
        const key = `${taskId}:${kind}`;
        const previous = taskPhotos[taskId]?.[kind];

        // Immediate local preview while it processes, so the tap feels instant.
        const tempUrl = URL.createObjectURL(file);
        setTaskPhotos(prev => ({ ...prev, [taskId]: { ...(prev[taskId] ?? {}), [kind]: { url: tempUrl, file } } }));
        setPhotoBusy(prev => ({ ...prev, [key]: true }));
        setPhotoError(prev => { const next = { ...prev }; delete next[key]; return next; });

        try {
            const compressed = await compressPhoto(file, `${slug(taskId)}-${kind}.jpg`);
            URL.revokeObjectURL(tempUrl);
            if (previous) URL.revokeObjectURL(previous.url);
            setTaskPhotos(prev => ({ ...prev, [taskId]: { ...(prev[taskId] ?? {}), [kind]: compressed } }));
        } catch {
            URL.revokeObjectURL(tempUrl);
            setTaskPhotos(prev => {
                const current = { ...(prev[taskId] ?? {}) };
                if (previous) current[kind] = previous; else delete current[kind];
                return { ...prev, [taskId]: current };
            });
            setPhotoError(prev => ({ ...prev, [key]: PHOTO_ERROR }));
        } finally {
            setPhotoBusy(prev => ({ ...prev, [key]: false }));
        }
    };

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

    // Builds each task's Antes|Después composite as soon as both photos exist,
    // keyed by a signature of the two photo URLs so a "Repetir foto" retake
    // rebuilds it. A composite failure is skipped rather than thrown, so a
    // bad photo never blocks Completar.
    useEffect(() => {
        if (!dia) return;
        let cancelled = false;
        (async () => {
            for (const section of dia.sections) {
                for (const task of section.tasks) {
                    const p = taskPhotos[task.id];
                    if (!p?.antes || !p?.despues) continue;
                    const sig = `${p.antes.url}|${p.despues.url}`;
                    if (builtForRef.current[task.id] === sig) continue;
                    try {
                        const file = await buildTaskComposite(task.text, p.antes, p.despues);
                        if (cancelled) return;
                        builtForRef.current[task.id] = sig;
                        setComposites(prev => ({ ...prev, [task.id]: file }));
                    } catch (e) {
                        console.error('No se pudo generar la foto compuesta:', task.text, e);
                    }
                }
            }
        })();
        return () => { cancelled = true; };
    }, [dia, taskPhotos]);

    /** The list as it stands right now, in the shape the share modal sends. */
    const buildSnapshot = (): ShiftShareSnapshot | null => {
        if (!dia) return null;
        return {
            listType: 'LIMPIEZA',
            businessDate: dia.businessDate,
            sections: dia.sections.map(section => ({
                name: section.name,
                tasks: section.tasks.map(task => {
                    const p = taskPhotos[task.id];
                    return { text: task.text, checked: checked.has(task.id), hasPhotos: !!(p?.antes && p?.despues) };
                }),
                staffNames: (staffBySection[section.id] ?? [])
                    .map(id => staff.find(s => s.id === id)?.name)
                    .filter((n): n is string => !!n),
            })),
        };
    };

    /**
     * The one-button flow. iOS Safari refuses navigator.share unless it runs
     * from the tap's own user activation, so nothing may be awaited before
     * it: the composites are already built (see the effect above), the save
     * starts and is held as a promise, the share fires immediately after,
     * and only then is the save promise awaited.
     */
    const handleComplete = async () => {
        const snapshot = buildSnapshot();
        if (!snapshot || !sender) return;

        const names = senderDisplayNames(staff);
        const senderLabel = names.get(sender.id) ?? sender.name;
        const texto = buildListaTexto(snapshot, senderLabel);
        const photos: SharePhoto[] = Object.entries(composites).map(([id, file]) => ({ id, file }));
        const files = photos.map(p => p.file);

        setIsCompleting(true);
        setActionError(null);
        setShareBanner(null);

        const savePromise = completeShiftRun('LIMPIEZA');

        let shared = false;
        try {
            if (navigator.share) {
                const withFiles = files.length > 0 && !!navigator.canShare && navigator.canShare({ files });
                await navigator.share(withFiles ? { files, text: texto } : { text: texto });
                shared = true;
            }
        } catch {
            // AbortError = the sheet was dismissed; any other share error is
            // treated the same way — the save is still the source of truth.
        }

        try {
            const result = await savePromise;
            if (!result.success) {
                if (shared) { setShareBanner('Se compartió la lista pero NO se guardó. Vuelve a intentar.'); return; }
                setActionError(result.error ?? 'No se pudo cerrar la lista.');
                return;
            }
            setCompleted(true);
            setShareData({ snapshot, photos });
            if (shared) void marcarShiftCompartido('LIMPIEZA');

            // The composites are already sent (or ready for a manual retry);
            // the in-memory originals are done.
            for (const p of Object.values(taskPhotosRef.current)) {
                if (p.antes) URL.revokeObjectURL(p.antes.url);
                if (p.despues) URL.revokeObjectURL(p.despues.url);
            }
            setTaskPhotos({});
            setPhotoError({});
            setPhotoBusy({});
            setComposites({});
            builtForRef.current = {};
        } catch (e) {
            if (shared) setShareBanner('Se compartió la lista pero NO se guardó. Vuelve a intentar.');
            else setActionError(e instanceof Error ? e.message : String(e));
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
    const deferredTaskIds = new Set(dia.deferrals.map(d => d.taskId));
    const allTasks = dia.sections.flatMap(s => s.tasks);
    const doneCount = allTasks.filter(t => checked.has(t.id)).length;
    const everySectionStaffed = dia.sections.every(s => (staffBySection[s.id] ?? []).length > 0);

    const renderPhotoSlot = (task: Task, kind: PhotoKind, label: string, disabled: boolean) => {
        const key = `${task.id}:${kind}`;
        const photo = taskPhotos[task.id]?.[kind];
        const busy = photoBusy[key] === true;
        const error = photoError[key];

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>
                {photo ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', alignItems: 'center' }}>
                        <div style={{ position: 'relative', width: '84px', height: '84px' }}>
                            <img
                                src={photo.url}
                                alt=""
                                style={{ width: '84px', height: '84px', objectFit: 'cover', borderRadius: '10px', border: '1px solid var(--border)', display: 'block', opacity: busy ? 0.5 : 1 }}
                            />
                            {busy && (
                                <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 700 }}>
                                    …
                                </span>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => openCapture(task.id, kind)}
                            disabled={busy}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.3rem',
                                minHeight: '44px', padding: '0.5rem 0.8rem', borderRadius: '8px',
                                fontSize: '0.9rem', fontWeight: 600, color: 'var(--accent-primary)',
                                background: 'none', border: 'none', cursor: busy ? 'not-allowed' : 'pointer',
                                opacity: busy ? 0.5 : 1
                            }}
                        >
                            <RotateCcw size={16} /> Repetir foto
                        </button>
                    </div>
                ) : (
                    <button
                        type="button"
                        onClick={() => openCapture(task.id, kind)}
                        disabled={disabled || busy}
                        style={{
                            width: '84px', height: '84px', borderRadius: '10px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: 'rgba(255,255,255,0.05)', border: '1px dashed var(--border)',
                            color: 'var(--text-secondary)',
                            cursor: disabled || busy ? 'not-allowed' : 'pointer',
                            opacity: disabled ? 0.4 : 1
                        }}
                    >
                        <Camera size={28} />
                    </button>
                )}
                {error && <span style={{ fontSize: '0.8rem', color: 'var(--danger)', textAlign: 'center', maxWidth: '110px' }}>{error}</span>}
            </div>
        );
    };

    const renderSection = (section: Section) => {
        const selectedIds = staffBySection[section.id] ?? [];
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
                        const isDeferred = deferredTaskIds.has(task.id);
                        const hasAntes = !!taskPhotos[task.id]?.antes;
                        const hasDespues = !!taskPhotos[task.id]?.despues;
                        const canToggle = isOn || isDeferred || (hasAntes && hasDespues);
                        const missing = !isDeferred && !isOn
                            ? (!hasAntes ? 'Falta foto de antes' : !hasDespues ? 'Falta foto de después' : null)
                            : null;

                        return (
                            <div
                                key={task.id}
                                className="glass-panel"
                                style={{
                                    display: 'flex', flexDirection: 'column', gap: '0.75rem',
                                    padding: '1.1rem 1.25rem',
                                    border: isOn
                                        ? '1px solid color-mix(in srgb, var(--success) 45%, transparent)'
                                        : '1px solid var(--border)',
                                    background: isOn
                                        ? 'color-mix(in srgb, var(--success) 10%, transparent)'
                                        : undefined
                                }}
                            >
                                <button
                                    onClick={() => handleToggleTask(task.id)}
                                    disabled={!canToggle}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '1rem',
                                        minHeight: '56px', textAlign: 'left', width: '100%',
                                        background: 'none', border: 'none', padding: 0,
                                        cursor: canToggle ? 'pointer' : 'not-allowed',
                                        opacity: canToggle ? 1 : 0.7
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

                                <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                                    {renderPhotoSlot(task, 'antes', 'Antes', false)}
                                    {renderPhotoSlot(task, 'despues', 'Después', !hasAntes)}
                                </div>

                                {missing && (
                                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{missing}</span>
                                )}
                            </div>
                        );
                    })}
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
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleFileSelected}
                style={{ display: 'none' }}
            />

            <div>
                <h2 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Limpieza Profunda — {fechaEs(dia.businessDate)}
                </h2>
                <p style={{ margin: '0.4rem 0 0 0', fontSize: '0.95rem', color: 'var(--text-secondary)' }}>{PHOTO_HINT}</p>
            </div>

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
                    Hoy no hay limpieza profunda programada.
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

                        <SenderPicker staff={staff} value={sender} onChange={setSender} label="¿Quién envía?" />

                        {shareBanner && (
                            <div style={{
                                padding: '1rem 1.25rem', borderRadius: '10px', fontSize: '1.05rem', fontWeight: 600,
                                color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
                                border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
                            }}>
                                {shareBanner}
                            </div>
                        )}

                        <button
                            onClick={handleComplete}
                            disabled={!everySectionStaffed || !sender || isCompleting}
                            className="btn-primary"
                            style={{
                                alignSelf: 'flex-start',
                                borderRadius: '10px', padding: '1rem 2rem', minHeight: '72px',
                                fontSize: '1.25rem', fontWeight: 700,
                                opacity: !everySectionStaffed || !sender || isCompleting ? 0.5 : 1,
                                cursor: !everySectionStaffed || !sender || isCompleting ? 'not-allowed' : 'pointer'
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
                                    onClick={() => setShareModalOpen(true)}
                                    disabled={!shareData}
                                    className="btn-secondary"
                                    style={{
                                        borderRadius: '8px', padding: '0.9rem 1.4rem', minHeight: '56px',
                                        fontSize: '1.1rem', fontWeight: 600,
                                        background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                                        color: 'var(--text-primary)', cursor: shareData ? 'pointer' : 'not-allowed',
                                        opacity: shareData ? 1 : 0.5
                                    }}
                                >
                                    Compartir
                                </button>
                            </div>
                        )}
                    </div>
                </>
            )}

            {shareModalOpen && shareData && (
                <ShiftShareModal
                    snapshot={shareData.snapshot}
                    staff={staff}
                    photos={shareData.photos}
                    onClose={() => setShareModalOpen(false)}
                />
            )}
        </div>
    );
}
