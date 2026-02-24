import React, { useState, useRef, useEffect } from 'react';

interface Option {
    value: string;
    label: string;
}

interface SearchableSelectProps {
    options: Option[];
    value: string;
    onChange: (val: string) => void;
    placeholder?: string;
    name?: string;
    required?: boolean;
    disabled?: boolean;
    wrapperStyle?: React.CSSProperties;
}

export function SearchableSelect({ options, value, onChange, placeholder, name, required, disabled, wrapperStyle }: SearchableSelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Keep A-Z sorted options, but keep clear/all options at the top
    const sortedOptions = [...options].sort((a, b) => {
        const aIsClear = a.value === '' || a.value === 'ALL';
        const bIsClear = b.value === '' || b.value === 'ALL';
        if (aIsClear && !bIsClear) return -1;
        if (!aIsClear && bIsClear) return 1;
        return a.label.localeCompare(b.label);
    });

    const filteredOptions = sortedOptions.filter(opt =>
        opt.label.toLowerCase().includes(searchTerm.toLowerCase()) || opt.value === '' || opt.value === 'ALL'
    );

    const selectedOption = options.find(o => o.value === value);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const toggleOpen = () => {
        if (disabled) return;
        setIsOpen(!isOpen);
        if (!isOpen) setSearchTerm('');
    };

    return (
        <div ref={wrapperRef} style={{ position: 'relative', width: '100%', ...wrapperStyle }}>
            {name && <input type="hidden" name={name} value={value} required={required} />}
            <div
                className={`input-field ${disabled ? 'disabled' : ''}`}
                style={{
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    minHeight: '40px',
                    opacity: disabled ? 0.6 : 1,
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    padding: '0.6rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                }}
                onClick={toggleOpen}
            >
                {isOpen ? (
                    <input
                        type="text"
                        autoFocus
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search..."
                        style={{ background: 'transparent', border: 'none', outline: 'none', color: 'inherit', width: '100%', fontSize: '0.9rem' }}
                        onClick={(e) => e.stopPropagation()}
                    />
                ) : (
                    <span style={{ fontSize: '0.9rem', color: selectedOption ? 'inherit' : 'var(--text-secondary)' }}>
                        {selectedOption ? selectedOption.label : placeholder || 'Select...'}
                    </span>
                )}
                <span style={{ fontSize: '0.8rem', opacity: 0.5, marginLeft: '0.5rem' }}>▼</span>
            </div>

            {isOpen && (
                <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0,
                    background: 'var(--bg-secondary, #2a2a2a)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '0 0 8px 8px',
                    maxHeight: '200px', overflowY: 'auto',
                    zIndex: 100,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                    marginTop: '2px'
                }}>
                    {filteredOptions.length > 0 ? filteredOptions.map(opt => (
                        <div
                            key={opt.value}
                            style={{
                                padding: '0.6rem 1rem',
                                cursor: 'pointer',
                                background: opt.value === value ? 'rgba(255,255,255,0.1)' : 'transparent',
                                fontSize: '0.9rem'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = opt.value === value ? 'rgba(255,255,255,0.1)' : 'transparent'}
                            onClick={() => {
                                onChange(opt.value);
                                setIsOpen(false);
                            }}
                        >
                            {opt.label}
                        </div>
                    )) : (
                        <div style={{ padding: '0.6rem 1rem', opacity: 0.5, fontSize: '0.9rem' }}>No results</div>
                    )}
                </div>
            )}
        </div>
    );
}

