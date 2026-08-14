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
    testId,
}: {
    title: string;
    children: React.ReactNode;
    /** Structural marker for tests. The section's CONTENTS are absent from the
     *  DOM until it is opened, so without this there is nothing stable to
     *  assert on — and asserting on the title would be asserting on a
     *  translated string, which differs per locale. */
    testId?: string;
}) {
    const [open, setOpen] = useState(false);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }} data-testid={testId} data-open={open ? 'true' : 'false'}>
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
