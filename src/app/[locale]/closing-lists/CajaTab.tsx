'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAdmin } from '@/components/AdminContext';
import { getCajaDia, getCajaEsperado, anularCorte, type CajaEsperadoResult } from '@/app/actions/caja';
import { TIPO_LABELS, CAJA_LABELS, nivelFor } from '@/lib/cajaRules';
import { formatMoney } from '@/lib/money';
import { businessDateToUtcDate, formatBusinessDateEs } from '@/lib/businessDay';
import CajaCorteModal from './CajaCorteModal';
import {
    Chip, NivelBadge, SinVerificar, FondoInicial, PosibleTraslado,
    ROL_LABELS, nyTime, signedMoney,
} from './cajaUi';

type Dia = Awaited<ReturnType<typeof getCajaDia>>;
type Corte = Dia['cortes'][number];
type Tipo = Corte['tipo'];
type EsperadoOk = Extract<CajaEsperadoResult, { success: true }>;

type Live =
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; data: EsperadoOk };

const ESTADO_CHIP: Record<Dia['estado'], { tone: 'grey' | 'green' | 'blue'; label: string }> = {
    SIN_APERTURA: { tone: 'grey', label: 'Sin apertura' },
    ABIERTA: { tone: 'green', label: 'Caja abierta' },
    CERRADA: { tone: 'blue', label: 'Caja cerrada' },
};

/**
 * The Caja tab: today's state, what Clover says the boxes should hold right
 * now, and the timeline of cortes. Every write goes through the modal; this
 * component only reads, and re-reads after each save or anulación.
 */
export default function CajaTab({ staff }: { staff: { id: string; name: string }[] }) {
    const { isAdmin } = useAdmin();

    const [dia, setDia] = useState<Dia | null>(null);
    const [diaLoading, setDiaLoading] = useState(true);
    const [diaError, setDiaError] = useState<string | null>(null);

    const [live, setLive] = useState<Live>({ status: 'loading' });
    const [modalTipo, setModalTipo] = useState<Tipo | null>(null);

    const [anulando, setAnulando] = useState<string | null>(null);
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

    const reloadAll = async () => {
        await loadDia();
        loadLive();
    };

    const handleAnular = async (corteId: string) => {
        const motivo = anularMotivo.trim();
        if (!motivo || anularBusy) return;
        setAnularBusy(true);
        try {
            const r = await anularCorte(corteId, motivo);
            if (!r.success) {
                alert(r.error ?? 'No se pudo anular el corte.');
                return;
            }
            setAnulando(null);
            setAnularMotivo('');
            await reloadAll();
        } catch (e) {
            alert(e instanceof Error ? e.message : String(e));
        } finally {
            setAnularBusy(false);
        }
    };

    if (diaLoading) {
        return <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '1.05rem' }}>Cargando...</p>;
    }
    if (!dia) {
        return <p style={{ margin: 0, color: 'var(--danger)', fontSize: '1.05rem' }}>{diaError ?? 'No se pudo cargar la caja.'}</p>;
    }

    const activos = dia.cortes.filter(c => c.anuladoAt === null);
    const cierre = activos.find(c => c.tipo === 'CIERRE');
    const ultimoActivo = activos[activos.length - 1];
    const estadoChip = ESTADO_CHIP[dia.estado];

    // ── Pieces ───────────────────────────────────────────────────────────────

    const renderLive = () => {
        if (live.status === 'loading') {
            return <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '1.05rem' }}>Consultando Clover…</p>;
        }
        if (live.status === 'error') {
            return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '1.05rem' }}>No se pudo consultar Clover</span>
                    <button type="button" onClick={loadLive} className="btn-secondary" style={secondaryBtn}>Reintentar</button>
                </div>
            );
        }
        const d = live.data;
        const ventasNetas = d.blanca.cashVentasCents - d.blanca.cashRefundsCents;
        return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{CAJA_LABELS.BLANCA}</span>
                    <span style={{ fontSize: '1.05rem', color: 'var(--text-secondary)' }}>
                        Ventas en efectivo hoy: <strong style={{ color: 'var(--text-primary)' }}>{formatMoney(ventasNetas)}</strong>
                    </span>
                    {d.blanca.esperadoCents !== null && (
                        <span style={{ fontSize: '1.05rem', color: 'var(--text-secondary)' }}>
                            Debe haber en Caja Blanca: <strong style={{ color: 'var(--text-primary)' }}>{formatMoney(d.blanca.esperadoCents)}</strong>
                        </span>
                    )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{CAJA_LABELS.NEGRA}</span>
                    <span style={{ fontSize: '1.05rem', color: 'var(--text-secondary)' }}>
                        Mesas abiertas: <strong style={{ color: 'var(--text-primary)' }}>{d.negra.abiertasCount}</strong>
                        {' '}por <strong style={{ color: 'var(--text-primary)' }}>{formatMoney(d.negra.abiertasCents)}</strong>
                    </span>
                </div>
                {d.negra.pendientesCount > 0 && (
                    <p style={{ gridColumn: '1 / -1', margin: 0, padding: '0.75rem 1rem', borderRadius: '10px', background: '#fef3c7', color: '#92400e', fontSize: '0.95rem' }}>
                        {d.negra.pendientesCount} {d.negra.pendientesCount === 1 ? 'mesa' : 'mesas'} de días anteriores
                        {' '}{d.negra.pendientesCount === 1 ? 'sigue abierta' : 'siguen abiertas'} en Clover ({formatMoney(d.negra.pendientesCents)}).
                        {' '}No entran en el esperado.
                    </p>
                )}
                {d.truncated && (
                    <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                        Clover devolvió demasiadas órdenes; el esperado puede estar incompleto.
                    </p>
                )}
            </div>
        );
    };

    const renderLinea = (corte: Corte, linea: Corte['lineas'][number]) => {
        const esApertura = corte.tipo === 'APERTURA';
        const esperado = esApertura
            ? <span style={{ color: 'var(--text-secondary)' }}>—</span>
            : linea.esEstimado
                ? <span style={{ color: 'var(--text-secondary)' }}>Ref. estimada {linea.referenciaCents === null ? '—' : formatMoney(linea.referenciaCents)}</span>
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
                    <span style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>{CAJA_LABELS[linea.caja]}</span>
                    <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{formatMoney(linea.contadoCents)}</span>
                    <span style={{ fontSize: '1.05rem', color: 'var(--text-primary)' }}>{esperado}</span>
                    <span>{badge}</span>
                </div>
                {linea.motivo && (
                    <span style={{ fontSize: '0.95rem', fontStyle: 'italic', color: 'var(--text-secondary)' }}>{linea.motivo}</span>
                )}
            </div>
        );
    };

    const renderCorte = (corte: Corte) => {
        const anulado = corte.anuladoAt !== null;
        const lineas = [...corte.lineas].sort((a, b) => a.caja.localeCompare(b.caja));
        const totalNivel = corte.totalDiffCents === null ? null : nivelFor(corte.totalDiffCents, corte.toleranciaCents);
        const esUltimo = ultimoActivo?.id === corte.id;
        return (
            <div key={corte.id} className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', opacity: anulado ? 0.55 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', textDecoration: anulado ? 'line-through' : 'none' }}>
                        {TIPO_LABELS[corte.tipo]} #{corte.seq} · {nyTime(corte.at)}
                    </span>
                    {isAdmin && !anulado && esUltimo && anulando !== corte.id && (
                        <button type="button" onClick={() => { setAnulando(corte.id); setAnularMotivo(''); }} className="btn-secondary" style={secondaryBtn}>
                            Anular
                        </button>
                    )}
                </div>

                {anulado && (
                    <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>Anulado: {corte.anuladoMotivo}</span>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr 1.2fr', gap: '0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    <span />
                    <span>Contado</span>
                    <span>Esperado</span>
                    <span>Diferencia</span>
                </div>
                {lineas.map(l => renderLinea(corte, l))}

                {(corte.deltaTurnoCents !== null && corte.deltaTurnoCents !== 0) || totalNivel !== null || corte.posibleTraslado ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
                        {corte.deltaTurnoCents !== null && corte.deltaTurnoCents !== 0 && (
                            <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>
                                Este turno: <strong style={{ color: 'var(--text-primary)' }}>{signedMoney(corte.deltaTurnoCents)}</strong>
                            </span>
                        )}
                        {totalNivel !== null && corte.totalDiffCents !== null && (
                            <>
                                <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Total</span>
                                <NivelBadge nivel={totalNivel} diffCents={corte.totalDiffCents} />
                            </>
                        )}
                        {corte.posibleTraslado && <PosibleTraslado />}
                    </div>
                ) : null}

                {corte.firmas.length > 0 && (
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
                        {corte.firmas.map(f => (
                            <div key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                <div style={{ width: '160px', height: '54px', background: '#ffffff', borderRadius: '8px', border: '1px solid var(--border)', overflow: 'hidden' }}>
                                    <svg viewBox={`0 0 ${f.firmaBox}`} width="160" height="54" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
                                        <path d={f.firmaPath} fill="none" stroke="#111827" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </div>
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                    {ROL_LABELS[f.rol]} · {f.employeeName} · {nyTime(f.signedAt)}
                                </span>
                            </div>
                        ))}
                    </div>
                )}

                {isAdmin && anulando === corte.id && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
                        <label style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Motivo</label>
                        <input
                            type="text"
                            value={anularMotivo}
                            disabled={anularBusy}
                            onChange={e => setAnularMotivo(e.target.value)}
                            placeholder="Por qué se anula este corte"
                            style={{
                                minHeight: '56px', padding: '0 1rem', fontSize: '1.05rem', borderRadius: '10px',
                                background: 'rgba(0,0,0,0.2)', color: 'var(--text-primary)', border: '1px solid var(--border)',
                            }}
                        />
                        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                            <button type="button" onClick={() => setAnulando(null)} disabled={anularBusy} className="btn-secondary" style={secondaryBtn}>
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={() => handleAnular(corte.id)}
                                disabled={anularBusy || !anularMotivo.trim()}
                                style={dangerBtn(anularBusy || !anularMotivo.trim())}
                            >
                                {anularBusy ? 'Anulando…' : 'Confirmar anulación'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {/* 1 — Header */}
            <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Caja — {formatBusinessDateEs(businessDateToUtcDate(dia.businessDate))}
                </h2>
                <Chip tone={estadoChip.tone}>{estadoChip.label}</Chip>
            </div>

            {/* 2 — Actions */}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {dia.estado === 'SIN_APERTURA' && (
                    <button type="button" onClick={() => setModalTipo('APERTURA')} style={primaryBtn}>Registrar Apertura</button>
                )}
                {dia.estado === 'ABIERTA' && (
                    <>
                        <button type="button" onClick={() => setModalTipo('RELEVO')} className="btn-secondary" style={secondaryBtn}>Registrar Relevo</button>
                        <button type="button" onClick={() => setModalTipo('CIERRE')} style={primaryBtn}>Registrar Cierre</button>
                    </>
                )}
                {dia.estado === 'CERRADA' && cierre && (
                    <span style={{ fontSize: '1.1rem', color: 'var(--text-secondary)' }}>
                        Cierre registrado a las {nyTime(cierre.at)}
                    </span>
                )}
            </div>

            {/* 3 — Live */}
            <div className="glass-panel" style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent-primary)' }}>Ahora en Clover</h3>
                    <button type="button" onClick={loadLive} disabled={live.status === 'loading'} className="btn-secondary" style={secondaryBtn}>
                        Actualizar
                    </button>
                </div>
                {renderLive()}
            </div>

            {/* 4 — Timeline */}
            {dia.cortes.length === 0 ? (
                <p style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-secondary)' }}>
                    Todavía no hay cortes hoy. Empieza con la Apertura.
                </p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {dia.cortes.map(renderCorte)}
                </div>
            )}

            {modalTipo && (
                <CajaCorteModal
                    tipo={modalTipo}
                    staff={staff}
                    onClose={() => setModalTipo(null)}
                    onSaved={async () => {
                        setModalTipo(null);
                        await reloadAll();
                    }}
                />
            )}
        </div>
    );
}

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
