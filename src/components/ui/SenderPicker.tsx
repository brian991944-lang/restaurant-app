'use client';

export type SenderPickerPerson = { id: string; name: string };

/**
 * How each person is shown and printed: first name only, with the initial of
 * the next token when two people share that first name ("José M."). Exported
 * so the share output can print the chosen sender exactly as the pill did.
 */
export function senderDisplayNames(staff: SenderPickerPerson[]): Map<string, string> {
    const tokensOf = (name: string) => name.trim().split(/\s+/).filter(Boolean);
    const counts = new Map<string, number>();
    for (const s of staff) {
        const f = tokensOf(s.name)[0] ?? s.name;
        counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    const out = new Map<string, string>();
    for (const s of staff) {
        const tokens = tokensOf(s.name);
        const f = tokens[0] ?? s.name;
        const dup = (counts.get(f) ?? 0) > 1 && tokens.length > 1;
        out.set(s.id, dup ? `${f} ${tokens[1].charAt(0).toUpperCase()}.` : f);
    }
    return out;
}

/**
 * "Who is sending this?" — a single-select row of staff pills for the share
 * modals. Nothing here is persisted; the chosen name is only printed into the
 * shared text or image. The wrapper is marked data-no-capture so an
 * html-to-image capture that happens to include it leaves it out.
 */
export default function SenderPicker({ staff, value, onChange, label }: {
    staff: SenderPickerPerson[];
    value: SenderPickerPerson | null;
    onChange: (v: SenderPickerPerson | null) => void;
    label: string;
}) {
    const names = senderDisplayNames(staff);
    return (
        <div data-no-capture="true" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.05rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                {staff.map(person => {
                    const isOn = value?.id === person.id;
                    return (
                        <button
                            key={person.id}
                            type="button"
                            onClick={() => onChange(isOn ? null : person)}
                            style={{
                                padding: '0.8rem 1.3rem', minHeight: '56px',
                                borderRadius: '999px', fontSize: '1.1rem', fontWeight: 600,
                                cursor: 'pointer',
                                color: isOn ? 'white' : 'var(--text-secondary)',
                                background: isOn ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)',
                                border: isOn ? '1px solid var(--accent-primary)' : '1px solid var(--border)'
                            }}
                        >
                            {names.get(person.id) ?? person.name}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
