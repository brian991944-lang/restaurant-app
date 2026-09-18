'use client';

import { useRef, useState } from 'react';

/**
 * A drawn signature: the SVG path data of every stroke, and the viewBox it
 * was drawn in, so it renders at any size later without distortion.
 */
export type SignatureValue = { path: string; box: string };

const VIEW_W = 600;
const VIEW_H = 200;
const BOX = `${VIEW_W} ${VIEW_H}`;

/** Fewer points than this is a tap or a slip, not a signature. */
const MIN_POINTS = 8;

type Point = [number, number];

const round1 = (n: number) => Math.round(n * 10) / 10;

function strokePath(stroke: Point[]): string {
    if (stroke.length === 0) return '';
    const [x0, y0] = stroke[0];
    // A single point still needs an L so the round cap draws a dot.
    const rest = stroke.length === 1 ? [stroke[0]] : stroke.slice(1);
    return `M ${x0} ${y0} ` + rest.map(([x, y]) => `L ${x} ${y}`).join(' ');
}

/**
 * Finger/stylus signature pad on an SVG. Strokes are captured in viewBox
 * units (600×200) regardless of the rendered size, so a signature drawn on a
 * tablet and one drawn on a phone have the same coordinate space.
 */
export default function SignaturePad({ value, onChange, disabled = false, height }: {
    value: SignatureValue | null;
    onChange: (v: SignatureValue | null) => void;
    disabled?: boolean;
    height?: number;
}) {
    const svgRef = useRef<SVGSVGElement>(null);
    const strokesRef = useRef<Point[][]>([]);
    const drawingRef = useRef(false);
    // Mirror of the ref that exists only to trigger re-renders while drawing.
    const [strokes, setStrokes] = useState<Point[][]>([]);

    const toViewBox = (e: React.PointerEvent<SVGSVGElement>): Point | null => {
        const svg = svgRef.current;
        if (!svg) return null;
        const rect = svg.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;
        const x = ((e.clientX - rect.left) / rect.width) * VIEW_W;
        const y = ((e.clientY - rect.top) / rect.height) * VIEW_H;
        return [round1(Math.min(VIEW_W, Math.max(0, x))), round1(Math.min(VIEW_H, Math.max(0, y)))];
    };

    const commit = () => {
        const all = strokesRef.current;
        setStrokes(all.map(s => [...s]));
        const points = all.reduce((n, s) => n + s.length, 0);
        onChange(points >= MIN_POINTS ? { path: all.map(strokePath).join(' '), box: BOX } : null);
    };

    const handleDown = (e: React.PointerEvent<SVGSVGElement>) => {
        if (disabled) return;
        const p = toViewBox(e);
        if (!p) return;
        e.preventDefault();
        svgRef.current?.setPointerCapture(e.pointerId);
        drawingRef.current = true;
        strokesRef.current = [...strokesRef.current, [p]];
        setStrokes(strokesRef.current.map(s => [...s]));
    };

    const handleMove = (e: React.PointerEvent<SVGSVGElement>) => {
        // A hover, or a finger that already lifted, is not ink.
        if (!drawingRef.current || disabled || e.buttons === 0) return;
        const p = toViewBox(e);
        if (!p) return;
        e.preventDefault();
        const current = strokesRef.current[strokesRef.current.length - 1];
        if (!current) return;
        current.push(p);
        setStrokes(strokesRef.current.map(s => [...s]));
    };

    const handleUp = (e: React.PointerEvent<SVGSVGElement>) => {
        if (!drawingRef.current) return;
        drawingRef.current = false;
        try { svgRef.current?.releasePointerCapture(e.pointerId); } catch { /* already released */ }
        commit();
    };

    const clear = () => {
        strokesRef.current = [];
        drawingRef.current = false;
        setStrokes([]);
        onChange(null);
    };

    // Nothing drawn here yet but a value handed in (a remount): show that.
    const path = strokes.length > 0 ? strokes.map(strokePath).join(' ') : (value?.path ?? '');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <svg
                ref={svgRef}
                viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                preserveAspectRatio={height ? 'none' : 'xMidYMid meet'}
                onPointerDown={handleDown}
                onPointerMove={handleMove}
                onPointerUp={handleUp}
                onPointerCancel={handleUp}
                style={{
                    display: 'block', width: '100%', height: height ?? 'auto',
                    border: '1px solid var(--border)', borderRadius: '12px',
                    background: '#ffffff',
                    touchAction: 'none', userSelect: 'none',
                    cursor: disabled ? 'default' : 'crosshair',
                    opacity: disabled ? 0.6 : 1,
                }}
            >
                <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="#ffffff" />
                <line x1="40" y1="150" x2={VIEW_W - 40} y2="150" stroke="#e5e7eb" strokeWidth="1.5" />
                {path && (
                    <path d={path} fill="none" stroke="#111827" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                )}
            </svg>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>Firma aquí</span>
                <button
                    type="button"
                    data-no-capture="true"
                    onClick={clear}
                    disabled={disabled || (strokes.length === 0 && !value)}
                    style={{
                        minHeight: '56px', padding: '0 1.25rem', borderRadius: '8px',
                        fontSize: '1rem', fontWeight: 600, cursor: 'pointer',
                        color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.05)',
                        border: '1px solid var(--border)',
                        opacity: disabled || (strokes.length === 0 && !value) ? 0.5 : 1,
                    }}
                >
                    Borrar
                </button>
            </div>
        </div>
    );
}
