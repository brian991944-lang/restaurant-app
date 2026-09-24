'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useAdmin } from '@/components/AdminContext';
import {
    getCajaDia, getCajaEsperado, anularCorte, anularMovimiento, getCajaHistorial, getCajaRetiros,
    type CajaEsperadoResult, type CajaHistorialResult, type CajaRetirosResult,
} from '@/app/actions/caja';
import { nivelFor } from '@/lib/cajaRules';
import { formatMoney } from '@/lib/money';
import { businessDateToUtcDate } from '@/lib/businessDay';
import { DatePicker } from '@/components/ui/DatePicker';
import CajaCorteModal from './CajaCorteModal';
import CajaMovimientoModal from './CajaMovimientoModal';
import CajaShareModal from './CajaShareModal';
import {
    Chip, NivelBadge, SinVerificar, FondoInicial, PosibleTraslado,
    nyTime, longDate, signedMoney, shiftBusinessDate,
} from './cajaUi';

type Dia = Awaited<ReturnType<typeof getCajaDia>>;
type Corte = Dia['cortes'][number];
type Mov = Dia['movimientos'][number];
type Tipo = Corte['tipo'];
type EsperadoOk = Extract<CajaEsperadoResult, { success: true }>;
type HistorialOk = Extract<CajaHistorialResult, { success: true }>;
type RetirosOk = Extract<CajaRetirosResult, { success: true }>;

type Live =
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; data: EsperadoOk };

type Hist =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; data: HistorialOk };

type Retiros =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; data: RetirosOk };

/** Default admin range: the seven business days before today. */
const HISTORY_DEFAULT_DAYS = 7;

/** Default range for the admin Withdrawals tab. */
const RETIROS_DEFAULT_DAYS = 30;

const ESTADO_TONE: Record<Dia['estado'], 'grey' | 'green' | 'blue'> = {
    SIN_APERTURA: 'grey',
    ABIERTA: 'green',
    CERRADA: 'blue',
};

const MOV_TONE: Record<Mov['tipo'], 'red' | 'amber' | 'green'> = {
    RETIRO: 'red',
    COMPRA: 'amber',
    INGRESO: 'green',
};

/** A movement as the signed amount it adds to its box. */
const movSigned = (m: Mov): number => (m.tipo === 'INGRESO' ? m.amountCents : -m.amountCents);

const secondaryBtn: React.CSSProperties = {
    minHeight: '56px', padding: '0.9rem 1.4rem', borderRadius: '8px',
    fontSize: '1.1rem', fontWeight: 600, cursor: 'pointer',
    background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
    color: 'var(--text-primary)',
};

const primaryBtn: React.CSSProperties = {
    minHeight: '56px', padding: '0.9rem 1.6rem', borderRadius: '8px',
    fontSize: '1.1rem', fontWeight: 700, cursor: 'pointer',
    background: 'var(--accent-primary)', border: '1px solid var(--accent-primary)',
    color: 'white',
};

const dangerBtn = (disabled: boolean): React.CSSProperties => ({
    minHeight: '56px', padding: '0.9rem 1.4rem', borderRadius: '8px',
    fontSize: '1.1rem', fontWeight: 700, cursor: disabled ? 'default' : 'pointer',
    background: 'var(--danger)', border: '1px solid var(--danger)',
    color: 'white', opacity: disabled ? 0.5 : 1,
});

/** A drawn signature at card size, on white, with its caption. */
function SignatureBox({ firmaBox, firmaPath, caption }: { firmaBox: string; firmaPath: string; caption: string }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            <div style={{ width: '160px', height: '54px', background: '#ffffff', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
                <svg viewBox={`0 0 ${firmaBox}`} width="160" height="54" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
                    <path d={firmaPath} fill="none" stroke="#111827" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </div>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{caption}</span>
        </div>
    );
}

/**
 * One corte as a card. Used for today's timeline and, unchanged, for the
 * history days — only today's last live corte gets the void controls, which
 * the parent passes in as slots.
 */
export function CorteCard({ corte, headerAction, footer }: {
    corte: Corte;
    headerAction?: React.ReactNode;
    footer?: React.ReactNode;
}) {
    const t = useTranslations('Caja');
    const anulado = corte.anuladoAt !== null;
    const lineas = [...corte.lineas].sort((a, b) => a.caja.localeCompare(b.caja));
    const totalNivel = corte.totalDiffCents === null ? null : nivelFor(corte.totalDiffCents, corte.toleranciaCents);
    const showSummary = (corte.deltaTurnoCents !== null && corte.deltaTurnoCents !== 0) || totalNivel !== null || corte.posibleTraslado;

    const renderLinea = (linea: Corte['lineas'][number]) => {
        const esApertura = corte.tipo === 'APERTURA';
        const esperado = esApertura
            ? <span style={{ color: 'var(--text-secondary)' }}>—</span>
            : linea.esEstimado
                ? <span style={{ color: 'var(--text-secondary)' }}>{t('estimate_ref', { amount: linea.referenciaCents === null ? '—' : formatMoney(linea.referenciaCents) })}</span>
                : <span>{linea.esperadoCents === null ? '—' : formatMoney(linea.esperadoCents)}</span>;
        const badge = esApertura
            ? <FondoInicial />
            : linea.esEstimado
                ? <SinVerificar />
                : linea.nivel !== null && linea.diffCents !== null
                    ? <NivelBadge nivel={linea.nivel} diffCents={linea.diffCents} />
                    : null;
        return (
            <div key={linea.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', padding: '0.75rem 0', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr 1.2fr', gap: '0.75rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>{t(`box_${linea.caja}`)}</span>
                    <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{formatMoney(linea.contadoCents)}</span>
                    <span style={{ fontSize: '1.05rem', color: 'var(--text-primary)' }}>{esperado}</span>
                    <span>{badge}</span>
                </div>
                {linea.movimientosCents !== null && linea.movimientosCents !== 0 && (
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {t('includes_movements', { amount: signedMoney(linea.movimientosCents) })}
                    </span>
                )}
                {linea.motivo && (
                    <span style={{ fontSize: '0.95rem', fontStyle: 'italic', color: 'var(--text-secondary)' }}>{linea.motivo}</span>
                )}
            </div>
        );
    };

    return (
        <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', opacity: anulado ? 0.55 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', textDecoration: anulado ? 'line-through' : 'none' }}>
                    {t('corte_header', { tipo: t(`tipo_${corte.tipo}`), seq: corte.seq, time: nyTime(corte.at) })}
                </span>
                {headerAction}
            </div>

            {anulado && (
                <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>{t('voided_reason', { reason: corte.anuladoMotivo ?? '' })}</span>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr 1.2fr', gap: '0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                <span />
                <span>{t('col_counted')}</span>
                <span>{t('col_expected')}</span>
                <span>{t('col_difference')}</span>
            </div>
            {lineas.map(renderLinea)}

            {showSummary && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
                    {corte.deltaTurnoCents !== null && corte.deltaTurnoCents !== 0 && (
                        <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>
                            {t('this_shift', { amount: signedMoney(corte.deltaTurnoCents) })}
                        </span>
                    )}
                    {totalNivel !== null && corte.totalDiffCents !== null && (
                        <>
                            <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{t('total')}</span>
                            <NivelBadge nivel={totalNivel} diffCents={corte.totalDiffCents} />
                        </>
                    )}
                    {corte.posibleTraslado && <PosibleTraslado />}
                </div>
            )}

            {corte.firmas.length > 0 && (
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
                    {corte.firmas.map(f => (
                        <SignatureBox
                            key={f.id}
                            firmaBox={f.firmaBox}
                            firmaPath={f.firmaPath}
                            caption={t('firma_caption', { rol: t(`rol_${f.rol}`), name: f.employeeName, time: nyTime(f.signedAt) })}
                        />
                    ))}
                </div>
            )}

            {footer}
        </div>
    );
}

/**
 * One movimiento as a compact card: what kind, which box, the signed amount,
 * what it was for, and who signed it. Same signature markup as a corte.
 */
export function MovimientoCard({ mov, headerAction, footer }: {
    mov: Mov;
    headerAction?: React.ReactNode;
    footer?: React.ReactNode;
}) {
    const t = useTranslations('Caja');
    const anulado = mov.anuladoAt !== null;
    return (
        <div className="glass-panel" style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem', opacity: anulado ? 0.55 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', textDecoration: anulado ? 'line-through' : 'none' }}>
                    <Chip tone={MOV_TONE[mov.tipo]}>{t(`mov_${mov.tipo}`)}</Chip>
                    <span style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>{t(`box_${mov.caja}`)}</span>
                    <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>{signedMoney(movSigned(mov))}</span>
                    <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>{nyTime(mov.at)}</span>
                </div>
                {headerAction}
            </div>

            {anulado && (
                <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>{t('voided_reason', { reason: mov.anuladoMotivo ?? '' })}</span>
            )}

            <span style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>{mov.descripcion}</span>

            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <SignatureBox
                    firmaBox={mov.firmaBox}
                    firmaPath={mov.firmaPath}
                    caption={t('mov_caption', { name: mov.employeeName, time: nyTime(mov.at) })}
                />
            </div>

            {footer}
        </div>
    );
}

type Entry =
    | { kind: 'corte'; at: number; corte: Corte }
    | { kind: 'mov'; at: number; mov: Mov };

/** Cortes and movimientos as one list, oldest first. */
function timelineOf(cortes: Corte[], movs: Mov[]): Entry[] {
    return [
        ...cortes.map(c => ({ kind: 'corte' as const, at: new Date(c.at).getTime(), corte: c })),
        ...movs.map(m => ({ kind: 'mov' as const, at: new Date(m.at).getTime(), mov: m })),
    ].sort((a, b) => a.at - b.at);
}

/**
 * The Cash Boxes page body: today's state, what Clover says the boxes should
 * hold right now, and the timeline of counts and movements. Every write goes
 * through a modal; this component only reads, and re-reads after each save
 * or void.
 */
export default function CajaTab({ staff }: { staff: { id: string; name: string }[] }) {
    const t = useTranslations('Caja');
    const locale = useLocale();
    const { isAdmin } = useAdmin();

    const [dia, setDia] = useState<Dia | null>(null);
    const [diaLoading, setDiaLoading] = useState(true);
    const [diaError, setDiaError] = useState<string | null>(null);

    // Admin-only tab row: everyone else always sees 'HOY', with no row at all.
    const [cajaView, setCajaView] = useState<'HOY' | 'RETIROS'>('HOY');

    const [live, setLive] = useState<Live>({ status: 'loading' });
    const [modalTipo, setModalTipo] = useState<Tipo | null>(null);
    const [movModalOpen, setMovModalOpen] = useState(false);
    // The closing being shared: opens on its own after a CIERRE saves, and
    // again from the card's Share button if the first attempt failed.
    const [shareCorteId, setShareCorteId] = useState<string | null>(null);

    // One inline void form at a time; the id is a corte's or a movimiento's.
    const [anulando, setAnulando] = useState<{ kind: 'corte' | 'mov'; id: string } | null>(null);
    const [anularMotivo, setAnularMotivo] = useState('');
    const [anularBusy, setAnularBusy] = useState(false);

    const loadDia = useCallback(async () => {
        try {
            setDia(await getCajaDia());
            setDiaError(null);
        } catch (e) {
            setDiaError(e instanceof Error ? e.message : String(e));
        } finally {
            setDiaLoading(false);
        }
    }, []);

    // Non-blocking: the timeline renders whether or not Clover answers.
    const loadLive = useCallback(async () => {
        setLive({ status: 'loading' });
        try {
            const r = await getCajaEsperado();
            setLive(r.success ? { status: 'ready', data: r } : { status: 'error' });
        } catch {
            setLive({ status: 'error' });
        }
    }, []);

    useEffect(() => { loadDia(); loadLive(); }, [loadDia, loadLive]);

    // ── History. Servers see yesterday behind a toggle; admin picks a range.
    // The server enforces the same split, so this only shapes what is asked.
    const [showYesterday, setShowYesterday] = useState(false);
    const [hist, setHist] = useState<Hist>({ status: 'idle' });
    const [histFrom, setHistFrom] = useState('');
    const [histTo, setHistTo] = useState('');

    const today = dia?.businessDate ?? null;
    const yesterday = today ? shiftBusinessDate(today, -1) : null;

    useEffect(() => {
        if (!today) return;
        setHistFrom(shiftBusinessDate(today, -HISTORY_DEFAULT_DAYS));
        setHistTo(shiftBusinessDate(today, -1));
    }, [today]);

    const loadHist = useCallback(async (from: string, to: string) => {
        setHist({ status: 'loading' });
        try {
            const r = await getCajaHistorial({ from, to });
            setHist(r.success ? { status: 'ready', data: r } : { status: 'error' });
        } catch {
            setHist({ status: 'error' });
        }
    }, []);

    const histRangeValid = histFrom !== '' && histTo !== '' && histFrom <= histTo;
    useEffect(() => {
        if (isAdmin && histRangeValid) loadHist(histFrom, histTo);
    }, [isAdmin, histRangeValid, histFrom, histTo, loadHist]);

    useEffect(() => {
        if (!isAdmin && showYesterday && yesterday) loadHist(yesterday, yesterday);
    }, [isAdmin, showYesterday, yesterday, loadHist]);

    // ── Withdrawals tab. Admin only; fetched only while that tab is open.
    const [retiros, setRetiros] = useState<Retiros>({ status: 'idle' });
    const [retirosFrom, setRetirosFrom] = useState('');
    const [retirosTo, setRetirosTo] = useState('');

    useEffect(() => {
        if (!today) return;
        setRetirosFrom(shiftBusinessDate(today, -(RETIROS_DEFAULT_DAYS - 1)));
        setRetirosTo(today);
    }, [today]);

    const loadRetiros = useCallback(async (from: string, to: string) => {
        setRetiros({ status: 'loading' });
        try {
            const r = await getCajaRetiros({ from, to });
            setRetiros(r.success ? { status: 'ready', data: r } : { status: 'error' });
        } catch {
            setRetiros({ status: 'error' });
        }
    }, []);

    const retirosRangeValid = retirosFrom !== '' && retirosTo !== '' && retirosFrom <= retirosTo;
    useEffect(() => {
        if (isAdmin && cajaView === 'RETIROS' && retirosRangeValid) loadRetiros(retirosFrom, retirosTo);
    }, [isAdmin, cajaView, retirosRangeValid, retirosFrom, retirosTo, loadRetiros]);

    const reloadAll = async () => {
        await loadDia();
        loadLive();
    };

    const handleAnular = async () => {
        const motivo = anularMotivo.trim();
        if (!anulando || !motivo || anularBusy) return;
        setAnularBusy(true);
        try {
            const r = anulando.kind === 'corte'
                ? await anularCorte(anulando.id, motivo)
                : await anularMovimiento(anulando.id, motivo);
            if (!r.success) {
                // errorKey is a Caja message key; `error` is the server's own Spanish fallback.
                alert(r.errorKey ? t(r.errorKey) : (r.error ?? t('void_failed')));
                return;
            }
            setAnulando(null);
            setAnularMotivo('');
            await reloadAll();
        } catch (e) {
            alert(e instanceof Error ? e.message : t('void_failed'));
        } finally {
            setAnularBusy(false);
        }
    };

    if (diaLoading) {
        return <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '1.05rem' }}>{t('loading')}</p>;
    }
    if (!dia) {
        return <p style={{ margin: 0, color: 'var(--danger)', fontSize: '1.05rem' }}>{diaError ?? t('load_failed')}</p>;
    }

    const activos = dia.cortes.filter(c => c.anuladoAt === null);
    const cierre = activos.find(c => c.tipo === 'CIERRE');
    const ultimoActivo = activos[activos.length - 1];

    // ── Pieces ───────────────────────────────────────────────────────────────

    const renderLive = () => {
        if (live.status === 'loading') {
            return <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '1.05rem' }}>{t('checking_clover')}</p>;
        }
        if (live.status === 'error') {
            return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '1.05rem' }}>{t('clover_unavailable')}</span>
                    <button type="button" onClick={loadLive} className="btn-secondary" style={secondaryBtn}>{t('retry')}</button>
                </div>
            );
        }
        const d = live.data;
        const ventasNetas = d.blanca.cashVentasCents - d.blanca.cashRefundsCents;
        const muted: React.CSSProperties = { fontSize: '1.05rem', color: 'var(--text-secondary)' };
        return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{t('box_BLANCA')}</span>
                    <span style={muted}>{t('cash_sales_today', { amount: formatMoney(ventasNetas) })}</span>
                    {d.movimientos.BLANCA !== 0 && (
                        <span style={muted}>{t('movements_line', { amount: signedMoney(d.movimientos.BLANCA) })}</span>
                    )}
                    {d.blanca.esperadoCents !== null && (
                        <span style={muted}>
                            {t('should_be_in', { box: t('box_BLANCA'), amount: formatMoney(d.blanca.esperadoCents) })}
                        </span>
                    )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{t('box_NEGRA')}</span>
                    <span style={muted}>{t('open_tables', { count: d.negra.abiertasCount, amount: formatMoney(d.negra.abiertasCents) })}</span>
                    {d.movimientos.NEGRA !== 0 && (
                        <span style={muted}>{t('movements_line', { amount: signedMoney(d.movimientos.NEGRA) })}</span>
                    )}
                    {d.negra.referenciaCents !== null && (
                        <span style={muted}>
                            {t('should_be_in', { box: t('box_NEGRA'), amount: formatMoney(d.negra.referenciaCents) })}
                        </span>
                    )}
                </div>
                {d.negra.pendientesCount > 0 && (
                    <p style={{ gridColumn: '1 / -1', margin: 0, padding: '0.75rem 1rem', borderRadius: '10px', background: '#fef3c7', color: '#92400e', fontSize: '0.95rem' }}>
                        {t('pendientes_note', { count: d.negra.pendientesCount, amount: formatMoney(d.negra.pendientesCents) })}
                    </p>
                )}
                {d.truncated && (
                    <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: '0.95rem', color: 'var(--text-secondary)' }}>{t('truncated_note')}</p>
                )}
            </div>
        );
    };

    const voidButton = (kind: 'corte' | 'mov', id: string) => (
        <button type="button" onClick={() => { setAnulando({ kind, id }); setAnularMotivo(''); }} className="btn-secondary" style={secondaryBtn}>
            {t('void')}
        </button>
    );

    const voidForm = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
            <label style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{t('void_reason_label')}</label>
            <input
                type="text"
                value={anularMotivo}
                disabled={anularBusy}
                onChange={e => setAnularMotivo(e.target.value)}
                placeholder={t('void_reason_placeholder')}
                style={{
                    minHeight: '56px', padding: '0 1rem', fontSize: '1.05rem', borderRadius: '10px',
                    background: 'rgba(0,0,0,0.2)', color: 'var(--text-primary)', border: '1px solid var(--border)',
                }}
            />
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setAnulando(null)} disabled={anularBusy} className="btn-secondary" style={secondaryBtn}>
                    {t('cancel')}
                </button>
                <button
                    type="button"
                    onClick={handleAnular}
                    disabled={anularBusy || !anularMotivo.trim()}
                    style={dangerBtn(anularBusy || !anularMotivo.trim())}
                >
                    {anularBusy ? t('voiding') : t('confirm_void')}
                </button>
            </div>
        </div>
    );

    /** Today's timeline carries void and share controls; history is read-only. */
    const renderTimeline = (entries: Entry[], withVoid: boolean) => entries.map(e => {
        if (e.kind === 'corte') {
            const c = e.corte;
            const canVoid = withVoid && isAdmin && c.anuladoAt === null && ultimoActivo?.id === c.id;
            const canShare = withVoid && c.tipo === 'CIERRE' && c.anuladoAt === null;
            const open = anulando?.kind === 'corte' && anulando.id === c.id;
            const actions = (canShare || (canVoid && !open)) ? (
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                    {canShare && (
                        <button type="button" onClick={() => setShareCorteId(c.id)} className="btn-secondary" style={secondaryBtn}>
                            {t('share_button')}
                        </button>
                    )}
                    {canVoid && !open && voidButton('corte', c.id)}
                </div>
            ) : null;
            return (
                <CorteCard
                    key={c.id}
                    corte={c}
                    headerAction={actions}
                    footer={open ? voidForm : null}
                />
            );
        }
        const m = e.mov;
        const canVoid = withVoid && isAdmin && m.anuladoAt === null;
        const open = anulando?.kind === 'mov' && anulando.id === m.id;
        return (
            <MovimientoCard
                key={m.id}
                mov={m}
                headerAction={canVoid && !open ? voidButton('mov', m.id) : null}
                footer={open ? voidForm : null}
            />
        );
    });

    const todayEntries = timelineOf(dia.cortes, dia.movimientos);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {/* 1 — Header */}
            <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {t('header_date', { date: longDate(businessDateToUtcDate(dia.businessDate), locale) })}
                </h2>
                <Chip tone={ESTADO_TONE[dia.estado]}>{t(`estado_${dia.estado}`)}</Chip>
            </div>

            {/* 1b — Admin tab row */}
            {isAdmin && (
                <div style={{ display: 'inline-flex', gap: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '0.3rem', borderRadius: '12px', alignSelf: 'flex-start' }}>
                    {(['HOY', 'RETIROS'] as const).map(v => (
                        <button
                            key={v}
                            type="button"
                            onClick={() => setCajaView(v)}
                            style={{
                                padding: '0.8rem 1.6rem', minHeight: '56px', borderRadius: '8px',
                                fontWeight: 600, fontSize: '1.1rem', cursor: 'pointer',
                                color: cajaView === v ? 'var(--text-primary)' : 'var(--text-secondary)',
                                background: cajaView === v ? 'var(--bg-primary)' : 'transparent',
                                border: cajaView === v ? '1px solid var(--border)' : '1px solid transparent',
                            }}
                        >
                            {t(v === 'HOY' ? 'view_today' : 'view_retiros')}
                        </button>
                    ))}
                </div>
            )}

            {cajaView === 'RETIROS' && isAdmin ? (
                /* 2' — Withdrawals */
                <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{t('retiros_title')}</h3>

                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>{t('from')}</span>
                            <DatePicker value={retirosFrom} onChange={setRetirosFrom} locale={locale === 'es' ? 'es' : 'en'} max={retirosTo || dia.businessDate} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>{t('to')}</span>
                            <DatePicker value={retirosTo} onChange={setRetirosTo} locale={locale === 'es' ? 'es' : 'en'} max={dia.businessDate} />
                        </div>
                    </div>

                    {retiros.status === 'loading' || retiros.status === 'idle' ? (
                        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '1.05rem' }}>{t('loading')}</p>
                    ) : retiros.status === 'error' ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                            <span style={{ color: 'var(--danger)', fontSize: '1.05rem' }}>{t('history_failed')}</span>
                            <button
                                type="button"
                                onClick={() => retirosRangeValid && loadRetiros(retirosFrom, retirosTo)}
                                className="btn-secondary"
                                style={secondaryBtn}
                            >
                                {t('retry')}
                            </button>
                        </div>
                    ) : (
                        <>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                    <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>{t('box_BLANCA')}</span>
                                    <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>{formatMoney(retiros.data.totals.BLANCA)}</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                    <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>{t('box_NEGRA')}</span>
                                    <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>{formatMoney(retiros.data.totals.NEGRA)}</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                    <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>{t('total')}</span>
                                    <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{formatMoney(retiros.data.totals.total)}</span>
                                </div>
                            </div>

                            {retiros.data.rows.length === 0 ? (
                                <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '1.05rem' }}>{t('retiros_empty')}</p>
                            ) : (
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '1rem' }}>
                                        <thead>
                                            <tr style={{ textAlign: 'left', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                                <th style={{ padding: '0.5rem 0.75rem' }}>{t('retiros_col_date')}</th>
                                                <th style={{ padding: '0.5rem 0.75rem' }}>{t('retiros_col_time')}</th>
                                                <th style={{ padding: '0.5rem 0.75rem' }}>{t('mov_box_label')}</th>
                                                <th style={{ padding: '0.5rem 0.75rem' }}>{t('mov_amount_label')}</th>
                                                <th style={{ padding: '0.5rem 0.75rem' }}>{t('mov_desc_label')}</th>
                                                <th style={{ padding: '0.5rem 0.75rem' }}>{t('retiros_col_who')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {retiros.data.rows.map(r => {
                                                const voided = r.anuladoAt !== null;
                                                return (
                                                    <tr key={r.id} style={{ borderTop: '1px solid var(--border)', opacity: voided ? 0.55 : 1 }}>
                                                        <td style={{ padding: '0.6rem 0.75rem', textDecoration: voided ? 'line-through' : 'none' }}>
                                                            {longDate(businessDateToUtcDate(r.businessDate), locale)}
                                                        </td>
                                                        <td style={{ padding: '0.6rem 0.75rem', textDecoration: voided ? 'line-through' : 'none' }}>{nyTime(r.at)}</td>
                                                        <td style={{ padding: '0.6rem 0.75rem', textDecoration: voided ? 'line-through' : 'none' }}>{t(`box_${r.caja}`)}</td>
                                                        <td style={{ padding: '0.6rem 0.75rem', fontWeight: 700, textDecoration: voided ? 'line-through' : 'none' }}>{formatMoney(r.amountCents)}</td>
                                                        <td style={{ padding: '0.6rem 0.75rem' }}>
                                                            <div style={{ textDecoration: voided ? 'line-through' : 'none' }}>{r.descripcion}</div>
                                                            {voided && (
                                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                                    {t('voided_reason', { reason: r.anuladoMotivo ?? '' })}
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td style={{ padding: '0.6rem 0.75rem', textDecoration: voided ? 'line-through' : 'none' }}>{r.employeeName}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </>
                    )}
                </div>
            ) : (
            <>
            {/* 2 — Actions */}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {dia.estado === 'SIN_APERTURA' && (
                    <button type="button" onClick={() => setModalTipo('APERTURA')} style={primaryBtn}>{t('record_APERTURA')}</button>
                )}
                {dia.estado === 'ABIERTA' && (
                    <>
                        <button type="button" onClick={() => setModalTipo('RELEVO')} className="btn-secondary" style={secondaryBtn}>{t('record_RELEVO')}</button>
                        <button type="button" onClick={() => setMovModalOpen(true)} className="btn-secondary" style={secondaryBtn}>{t('record_MOVIMIENTO')}</button>
                        <button type="button" onClick={() => setModalTipo('CIERRE')} style={primaryBtn}>{t('record_CIERRE')}</button>
                    </>
                )}
                {dia.estado === 'CERRADA' && cierre && (
                    <span style={{ fontSize: '1.1rem', color: 'var(--text-secondary)' }}>
                        {t('closing_recorded_at', { time: nyTime(cierre.at) })}
                    </span>
                )}
            </div>

            {/* 3 — Live */}
            <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{t('live_title')}</h3>
                    <button type="button" onClick={loadLive} disabled={live.status === 'loading'} className="btn-secondary" style={secondaryBtn}>
                        {t('refresh')}
                    </button>
                </div>
                {renderLive()}
            </div>

            {/* 4 — Timeline */}
            {todayEntries.length === 0 ? (
                <p style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-secondary)' }}>{t('empty_today')}</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {renderTimeline(todayEntries, true)}
                </div>
            )}

            {/* 5 — History */}
            <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{t('history')}</h3>
                    {!isAdmin && (
                        <button type="button" onClick={() => setShowYesterday(v => !v)} className="btn-secondary" style={secondaryBtn}>
                            {showYesterday ? t('hide_yesterday') : t('show_yesterday')}
                        </button>
                    )}
                </div>

                {isAdmin && (
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>{t('from')}</span>
                            <DatePicker value={histFrom} onChange={setHistFrom} locale={locale === 'es' ? 'es' : 'en'} max={histTo || dia.businessDate} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>{t('to')}</span>
                            <DatePicker value={histTo} onChange={setHistTo} locale={locale === 'es' ? 'es' : 'en'} max={dia.businessDate} />
                        </div>
                    </div>
                )}

                {(isAdmin || showYesterday) && (
                    hist.status === 'loading' || hist.status === 'idle' ? (
                        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '1.05rem' }}>{t('loading')}</p>
                    ) : hist.status === 'error' ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                            <span style={{ color: 'var(--danger)', fontSize: '1.05rem' }}>{t('history_failed')}</span>
                            <button
                                type="button"
                                onClick={() => (isAdmin ? histRangeValid && loadHist(histFrom, histTo) : yesterday && loadHist(yesterday, yesterday))}
                                className="btn-secondary"
                                style={secondaryBtn}
                            >
                                {t('retry')}
                            </button>
                        </div>
                    ) : hist.data.days.length === 0 ? (
                        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '1.05rem' }}>
                            {isAdmin ? t('history_empty') : t('history_day_empty')}
                        </p>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            {hist.data.days.map(day => (
                                <div key={day.businessDate} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                        <span style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                            {longDate(businessDateToUtcDate(day.businessDate), locale)}
                                        </span>
                                        <Chip tone={ESTADO_TONE[day.estado]}>{t(`estado_${day.estado}`)}</Chip>
                                    </div>
                                    {renderTimeline(timelineOf(day.cortes, day.movimientos), false)}
                                </div>
                            ))}
                        </div>
                    )
                )}
            </div>
            </>
            )}

            {modalTipo && (
                <CajaCorteModal
                    tipo={modalTipo}
                    staff={staff}
                    businessDate={dia.businessDate}
                    nextSeq={dia.cortes.length + 1}
                    movimientos={dia.movimientos.filter(m => m.anuladoAt === null)}
                    onClose={() => setModalTipo(null)}
                    onSaved={async () => {
                        // For CIERRE, sharing already happened (or was declined)
                        // inside the modal's own save-and-share button — this
                        // callback only ever closes and reloads. Retries go
                        // through the closing card's own Share button.
                        setModalTipo(null);
                        await reloadAll();
                    }}
                />
            )}

            {shareCorteId && (() => {
                const corte = dia.cortes.find(c => c.id === shareCorteId);
                return corte ? (
                    <CajaShareModal
                        corte={corte}
                        movimientos={dia.movimientos.filter(m => m.anuladoAt === null)}
                        businessDate={dia.businessDate}
                        staff={staff}
                        onClose={() => setShareCorteId(null)}
                    />
                ) : null;
            })()}

            {movModalOpen && (
                <CajaMovimientoModal
                    staff={staff}
                    onClose={() => setMovModalOpen(false)}
                    onSaved={async () => {
                        setMovModalOpen(false);
                        await reloadAll();
                    }}
                />
            )}
        </div>
    );
}
