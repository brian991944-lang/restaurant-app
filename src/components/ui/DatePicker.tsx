'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

interface DatePickerProps {
    value: string;
    onChange: (v: string) => void;
    locale: 'es' | 'en';
    /**
     * Latest selectable date, 'YYYY-MM-DD'. Omitted, the picker is unbounded
     * and behaves exactly as it always has — prep is scheduled forward, so its
     * callers must keep being able to pick future days.
     */
    max?: string;
}

const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MONTHS_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_ES = ['Lu','Ma','Mi','Ju','Vi','Sa','Do'];
const DAYS_EN = ['Mo','Tu','We','Th','Fr','Sa','Su'];

function toYMD(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

function parseYMD(s: string): Date {
    return new Date(`${s}T12:00:00`);
}

export function DatePicker({ value, onChange, locale, max }: DatePickerProps) {
    const [open, setOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const init = value ? parseYMD(value) : new Date();
    const [viewYear, setViewYear] = useState(init.getFullYear());
    const [viewMonth, setViewMonth] = useState(init.getMonth());

    const months = locale === 'es' ? MONTHS_ES : MONTHS_EN;
    const dayHeaders = locale === 'es' ? DAYS_ES : DAYS_EN;
    const todayStr = toYMD(new Date());

    useEffect(() => {
        const handle = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handle);
        return () => document.removeEventListener('mousedown', handle);
    }, []);

    useEffect(() => {
        if (value) {
            const d = parseYMD(value);
            setViewMonth(d.getMonth());
            setViewYear(d.getFullYear());
        }
    }, [value]);

    const buildGrid = () => {
        const firstDow = new Date(viewYear, viewMonth, 1).getDay(); // 0=Sun
        const startOffset = (firstDow + 6) % 7; // Monday-first
        const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate();
        const cells: Array<{ date: Date | null; dayNum: number | null }> = [];
        for (let i = 0; i < startOffset; i++) cells.push({ date: null, dayNum: null });
        for (let d = 1; d <= lastDay; d++) cells.push({ date: new Date(viewYear, viewMonth, d), dayNum: d });
        while (cells.length < 42) cells.push({ date: null, dayNum: null });
        return cells;
    };

    const prevMonth = () => {
        if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
        else setViewMonth(m => m - 1);
    };
    const nextMonth = () => {
        if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
        else setViewMonth(m => m + 1);
    };

    /** String comparison is safe here: 'YYYY-MM-DD' sorts chronologically. */
    const beyondMax = (dateStr: string) => !!max && dateStr > max;
    // The whole of next month is out of range exactly when its first day is.
    const nextMonthDisabled = beyondMax(toYMD(new Date(viewYear, viewMonth + 1, 1)));
    // toYMD reads the device's calendar date, which is not the same thing as a
    // caller's business date — between midnight and the cutover the two differ,
    // and the shortcut would emit a date the caller just said was too late.
    const todayDisabled = beyondMax(todayStr);

    const formatDisplay = (v: string) => {
        if (!v) return locale === 'es' ? 'Seleccionar fecha' : 'Select date';
        const d = parseYMD(v);
        return locale === 'es'
            ? `${d.getDate()} de ${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}`
            : `${MONTHS_EN[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    };

    const cells = buildGrid();

    return (
        <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-block' }}>
            {/* Trigger box — full area clickable */}
            <div
                onClick={() => setOpen(o => !o)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.6rem 1rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)', cursor: 'pointer', minWidth: '220px', userSelect: 'none', fontSize: '0.95rem' }}
            >
                <Calendar size={16} color="var(--accent-primary)" />
                <span style={{ flex: 1 }}>{formatDisplay(value)}</span>
                <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>▼</span>
            </div>

            {/* Popup */}
            {open && (
                <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200, background: 'var(--bg-glass)', border: 'var(--glass-border)', borderRadius: 'var(--border-radius)', boxShadow: 'var(--glass-shadow)', padding: '1rem', minWidth: '280px', backdropFilter: 'blur(12px)' }}>
                    {/* Month navigation */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                        <button onClick={prevMonth} style={{ padding: '0.3rem', borderRadius: '6px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-primary)', display: 'flex', alignItems: 'center' }}>
                            <ChevronLeft size={18} />
                        </button>
                        <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                            {months[viewMonth]} {viewYear}
                        </span>
                        <button onClick={nextMonth} disabled={nextMonthDisabled} style={{ padding: '0.3rem', borderRadius: '6px', border: 'none', background: 'transparent', cursor: nextMonthDisabled ? 'not-allowed' : 'pointer', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', opacity: nextMonthDisabled ? 0.3 : undefined }}>
                            <ChevronRight size={18} />
                        </button>
                    </div>

                    {/* Weekday headers */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '0.25rem' }}>
                        {dayHeaders.map(d => (
                            <div key={d} style={{ textAlign: 'center', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', padding: '0.25rem 0' }}>{d}</div>
                        ))}
                    </div>

                    {/* Day grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
                        {cells.map((cell, i) => {
                            if (!cell.date) return <div key={i} />;
                            const dateStr = toYMD(cell.date);
                            const isSelected = dateStr === value;
                            const isToday = dateStr === todayStr;
                            const outOfRange = beyondMax(dateStr);
                            return (
                                <button
                                    key={i}
                                    onClick={() => { onChange(toYMD(cell.date!)); setOpen(false); }}
                                    disabled={outOfRange}
                                    style={{ padding: '0.4rem', borderRadius: '6px', border: isToday && !isSelected ? '1.5px solid var(--accent-primary)' : '1.5px solid transparent', background: isSelected ? 'var(--accent-primary)' : 'transparent', color: isSelected ? '#fff' : 'var(--text-primary)', cursor: outOfRange ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: isSelected ? 600 : 400, textAlign: 'center', transition: 'background 0.1s', opacity: outOfRange ? 0.3 : undefined }}
                                    onMouseEnter={e => { if (!isSelected && !outOfRange) e.currentTarget.style.background = 'rgba(59,130,246,0.15)'; }}
                                    onMouseLeave={e => { if (!isSelected && !outOfRange) e.currentTarget.style.background = 'transparent'; }}
                                >
                                    {cell.dayNum}
                                </button>
                            );
                        })}
                    </div>

                    {/* Footer quick links */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                        <button onClick={() => { onChange(todayStr); setOpen(false); }} disabled={todayDisabled} style={{ fontSize: '0.85rem', color: 'var(--accent-primary)', background: 'transparent', border: 'none', cursor: todayDisabled ? 'not-allowed' : 'pointer', fontWeight: 500, opacity: todayDisabled ? 0.3 : undefined }}>
                            {locale === 'es' ? 'Hoy' : 'Today'}
                        </button>
                        <button onClick={() => { onChange(''); setOpen(false); }} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                            {locale === 'es' ? 'Limpiar' : 'Clear'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
