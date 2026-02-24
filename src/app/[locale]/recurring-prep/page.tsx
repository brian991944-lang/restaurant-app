'use client';

import { Calendar, Repeat } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getRecurringRules } from '@/app/actions/recurringPrep';

export default function RecurringPrepPage() {
    const [rules, setRules] = useState<any[]>([]);

    useEffect(() => {
        getRecurringRules().then(setRules);
    }, []);

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Recurring Prep Rules</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Set items to naturally drop into the Morning Prep Schedule on specific days.</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Repeat size={32} color="var(--accent-primary)" />
                </div>
            </div>

            <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Active Network Rules: <strong>{rules.length}</strong></span>
                <button className="btn-primary" style={{ padding: '0.6rem 1.2rem', borderRadius: '12px' }}>
                    + Add New Weekly Rule
                </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
                {days.map((day, idx) => {
                    const dayRules = rules.filter(r => r.dayOfWeek === idx);
                    return (
                        <div key={day} className="glass-panel" style={{ padding: '1.5rem' }}>
                            <h3 style={{ margin: '0 0 1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem', fontSize: '1.1rem' }}>
                                <Calendar size={18} color={dayRules.length > 0 ? "var(--accent-primary)" : "var(--text-secondary)"} />
                                {day}
                            </h3>
                            {dayRules.length === 0 ? (
                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', textAlign: 'center', padding: '1rem', background: 'rgba(255,255,255,0.01)', borderRadius: '8px' }}>
                                    No rules scheduled
                                </div>
                            ) : (
                                dayRules.map(rule => (
                                    <div key={rule.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', padding: '0.8rem', borderRadius: '8px', marginBottom: '0.5rem' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <strong style={{ fontSize: '1rem' }}>{rule.ingredient.name}</strong>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{rule.ingredient.category.name}</span>
                                        </div>
                                        <div style={{ background: 'rgba(168, 85, 247, 0.1)', color: '#a855f7', padding: '0.3rem 0.6rem', borderRadius: '8px', fontWeight: 'bold', fontSize: '0.9rem' }}>
                                            {rule.amount} kg
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
