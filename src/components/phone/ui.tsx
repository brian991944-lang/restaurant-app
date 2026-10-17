'use client';

import React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

// Building blocks of the phone (Admin) screens: Square/Toast-style cards,
// stat tiles, list rows, period pills and a tiny SVG bar chart. Palette and
// fonts come from globals.css tokens so light and dark both work. Nothing here
// uses backdrop-filter / transform / filter (house rule).

export const num = (n: number, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

export function Card({ children, style, onClick }: { children: React.ReactNode; style?: React.CSSProperties; onClick?: () => void }) {
    const base: React.CSSProperties = { padding: '0.9rem 1rem', borderRadius: '16px', background: 'var(--bg-primary)', border: '1px solid var(--border)', boxShadow: '0 1px 2px rgba(15,23,42,0.04)', ...style };
    if (onClick) return <button type="button" onClick={onClick} style={{ ...base, textAlign: 'left', width: '100%', color: 'inherit', fontFamily: 'inherit', cursor: 'pointer' }}>{children}</button>;
    return <div style={base}>{children}</div>;
}

export function Section({ title, right, onRight }: { title: string; right?: string; onRight?: () => void }) {
    return (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{title}</div>
            {right && (onRight
                ? <button type="button" onClick={onRight} style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'inherit', fontSize: '0.82rem', color: 'var(--accent-primary)', fontWeight: 600, cursor: 'pointer' }}>{right}</button>
                : <span style={{ fontSize: '0.82rem', color: 'var(--accent-primary)', fontWeight: 600 }}>{right}</span>)}
        </div>
    );
}

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'warn' | 'good' | 'bad' }) {
    const color = tone === 'warn' ? 'var(--warning)' : tone === 'good' ? 'var(--success)' : tone === 'bad' ? 'var(--danger)' : 'var(--text-primary)';
    return (
        <div style={{ flex: '1 1 0', minWidth: 0, padding: '0.75rem 0.9rem', borderRadius: '14px', background: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, lineHeight: 1.15, marginTop: 2, color, overflowWrap: 'anywhere' }}>{value}</div>
            {sub && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2 }}>{sub}</div>}
        </div>
    );
}

export function Delta({ pct, label }: { pct: number | null; label: string }) {
    if (pct === null) return <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>— {label}</span>;
    const up = pct >= 0;
    return (
        <span style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
            <span style={{ fontWeight: 700, color: up ? 'var(--success)' : 'var(--danger)' }}>{up ? '▲' : '▼'} {Math.abs(Math.round(pct))}%</span>
            <span style={{ color: 'var(--text-secondary)' }}> {label}</span>
        </span>
    );
}

export function Row({ title, sub, right, rsub, onClick, href, last }: { title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; rsub?: React.ReactNode; onClick?: () => void; href?: string; last?: boolean }) {
    const inner = (
        <>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.95rem', fontWeight: 600, overflowWrap: 'anywhere' }}>{title}</div>
                {sub && <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{sub}</div>}
            </div>
            {(right || rsub) && (
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    {right && <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>{right}</div>}
                    {rsub && <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{rsub}</div>}
                </div>
            )}
            {(onClick || href) && <ChevronRight size={18} color="var(--text-secondary)" style={{ flexShrink: 0 }} />}
        </>
    );
    const style: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.7rem 0', borderBottom: last ? 'none' : '1px solid var(--border)', width: '100%' };
    const interactive: React.CSSProperties = { ...style, background: 'none', border: 'none', borderBottom: style.borderBottom, textAlign: 'left', color: 'inherit', fontFamily: 'inherit', cursor: 'pointer', minHeight: 44, textDecoration: 'none', boxSizing: 'border-box' };
    if (href) return <Link href={href} style={interactive}>{inner}</Link>;
    if (onClick) return <button type="button" onClick={onClick} style={interactive}>{inner}</button>;
    return <div style={style}>{inner}</div>;
}

export function Pills<T extends string>({ items, active, onChange }: { items: { key: T; label: string }[]; active: T; onChange: (k: T) => void }) {
    return (
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none', margin: '0 -1rem', padding: '0 1rem' }}>
            {items.map(it => {
                const on = it.key === active;
                return (
                    <button key={it.key} type="button" onClick={() => onChange(it.key)} aria-pressed={on}
                        style={{ flexShrink: 0, height: 36, padding: '0 14px', borderRadius: 999, fontFamily: 'inherit', fontSize: '0.9rem', fontWeight: on ? 700 : 500, cursor: 'pointer',
                            background: on ? 'var(--text-primary)' : 'transparent', color: on ? 'var(--bg-primary)' : 'var(--text-primary)', border: `1px solid ${on ? 'var(--text-primary)' : 'var(--border)'}` }}>
                        {it.label}
                    </button>
                );
            })}
        </div>
    );
}

/** Bars with optional labels; `hi` is the highlighted index (others dim); `ghost` draws a comparison series behind. */
export function Bars({ values, labels, hi, color = 'var(--accent-primary)', height = 72, ghost, onPick }: {
    values: number[]; labels?: (string | null)[]; hi?: number | null; color?: string; height?: number; ghost?: number[]; onPick?: (i: number) => void;
}) {
    const n = values.length;
    if (n === 0) return null;
    const max = Math.max(1, ...values, ...(ghost ?? []));
    const w = 100; // percent-based: the SVG stretches to the card width
    const gap = n > 12 ? 0.6 : 1.4;
    const bw = (w - gap * (n - 1)) / n;
    const labelH = labels ? 14 : 0;
    return (
        <svg viewBox={`0 0 ${w} ${height + labelH}`} preserveAspectRatio="none" style={{ width: '100%', height: height + labelH, display: 'block' }} aria-hidden="true">
            {values.map((v, i) => {
                const x = i * (bw + gap);
                const g = ghost?.[i] ?? 0;
                const gh = g > 0 ? Math.max(0.5, (g / max) * (height - 2)) : 0;
                const bh = v > 0 ? Math.max(0.8, (v / max) * (height - 2)) : 0.4;
                const dim = hi != null && hi !== i;
                return (
                    <g key={i} onClick={onPick ? () => onPick(i) : undefined} style={onPick ? { cursor: 'pointer' } : undefined}>
                        {gh > 0 && <rect x={x} y={height - gh} width={bw} height={gh} rx={0.6} fill="var(--text-secondary)" opacity={0.18} />}
                        <rect x={x} y={height - bh} width={bw} height={bh} rx={0.6} fill={color} opacity={dim ? 0.4 : 1} />
                    </g>
                );
            })}
            {labels && labels.map((l, i) => l ? (
                <text key={i} x={i * (bw + gap) + bw / 2} y={height + 11} fontSize={3.2} textAnchor="middle" fill="var(--text-secondary)" style={{ fontFamily: 'inherit' }}>{l}</text>
            ) : null)}
        </svg>
    );
}

export function PhoneHeader({ eyebrow, title, right }: { eyebrow?: string; title: string; right?: React.ReactNode }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
            <div style={{ minWidth: 0 }}>
                {eyebrow && <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{eyebrow}</div>}
                <h1 style={{ fontSize: '1.6rem', fontWeight: 700, lineHeight: 1.1, margin: 0 }}>{title}</h1>
            </div>
            {right && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'right', flexShrink: 0 }}>{right}</div>}
        </div>
    );
}

export const page: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: 560, margin: '0 auto' };
