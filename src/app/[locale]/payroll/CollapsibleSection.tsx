'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * A section that starts closed. Used to keep the timesheet importer out of the
 * way of the weekly figures, which are what the page is opened for.
 */
export default function CollapsibleSection({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(false);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <button
                onClick={() => setOpen(o => !o)}
                style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                    minHeight: '52px', padding: '0 1.1rem', borderRadius: '8px',
                    fontSize: '1.1rem', fontWeight: 600, cursor: 'pointer',
                    alignSelf: 'flex-start',
                    color: 'var(--text-primary)', background: 'var(--bg-primary)',
                    border: '1px solid var(--border)',
                }}
            >
                {open ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                <span>{title}</span>
            </button>
            {open && children}
        </div>
    );
}
