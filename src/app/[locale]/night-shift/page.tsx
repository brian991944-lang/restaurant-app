'use client';

import { MoonStar, Calendar, User, Clock, Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getAssignmentsForDate } from '@/app/actions/nightShift';

export default function NightShiftPage() {
    const [assignments, setAssignments] = useState<any[]>([]);

    useEffect(() => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        getAssignmentsForDate(tomorrow).then(setAssignments);
    }, []);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Night Shift Planner</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Override or manually assign specific items for tomorrow's morning crew.</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <MoonStar size={32} color="var(--accent-primary)" />
                </div>
            </div>

            <div className="glass-panel" style={{ padding: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ background: 'rgba(59, 130, 246, 0.2)', padding: '0.8rem', borderRadius: '12px' }}>
                        <Calendar size={24} color="var(--accent-primary)" />
                    </div>
                    <div>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Assigning Prep For</div>
                        <div style={{ fontWeight: 600, fontSize: '1.2rem', color: 'var(--text-primary)' }}>
                            {tomorrow.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                        </div>
                    </div>
                </div>
                <button className="btn-primary" style={{ padding: '0.8rem 1.5rem', borderRadius: '12px' }}>
                    + Assign New Item
                </button>
            </div>

            {/* List of Tasks Assigned for Tomorrow */}
            <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-secondary)' }}>Current manual overrides for tomorrow:</h3>

                {assignments.length === 0 ? (
                    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.01)', borderRadius: '12px' }}>
                        <MoonStar size={40} style={{ opacity: 0.5, margin: '0 auto 1rem auto' }} />
                        <p>No manual targets set for tomorrow.</p>
                        <p style={{ fontSize: '0.9rem' }}>Morning prep will rely purely on the AI Sales Forecasts and Recurring Weekly Rules.</p>
                    </div>
                ) : (
                    assignments.map((assignment: any) => (
                        <div key={assignment.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '1rem 1.5rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <strong style={{ fontSize: '1.1rem' }}>{assignment.ingredient.name}</strong>
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{assignment.ingredient.category.name}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Target Assigned</span>
                                    <div style={{ background: 'rgba(245, 158, 11, 0.1)', color: 'var(--warning)', padding: '0.4rem 0.8rem', borderRadius: '8px', fontWeight: 'bold' }}>
                                        {assignment.portionsAssigned} kg
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                    <User size={16} /> Night Commander
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
