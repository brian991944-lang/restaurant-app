import { useTranslations } from 'next-intl';

export default function DashboardPage() {
    const t = useTranslations('Index');
    const td = useTranslations('Dashboard');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>
            <header style={{ textAlign: 'center', marginBottom: '2rem' }}>
                <h1 style={{ fontSize: '3rem', marginBottom: '1rem', background: 'linear-gradient(to right, #fff, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    {t('title')}
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '1.2rem' }}>
                    {t('subtitle')}
                </p>
            </header>

            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: '2rem'
            }}>

                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ background: 'rgba(245, 158, 11, 0.2)', padding: '0.8rem', borderRadius: '12px', color: 'var(--warning)' }}>
                            ⚠️
                        </div>
                        <h3 style={{ fontSize: '1.25rem' }}>{td('low_stock')}</h3>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                            <span>Raw Shrimp (frozen)</span>
                            <span style={{ color: 'var(--danger)', fontWeight: 600 }}>1.2 kg</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'rgba(245, 158, 11, 0.1)', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                            <span>Purple Corn</span>
                            <span style={{ color: 'var(--warning)', fontWeight: 600 }}>4.0 kg</span>
                        </div>
                    </div>
                    <button className="btn-primary" style={{ marginTop: 'auto' }}>Order More</button>
                </div>

                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ background: 'rgba(139, 92, 246, 0.2)', padding: '0.8rem', borderRadius: '12px', color: 'var(--accent-secondary)' }}>
                            📋
                        </div>
                        <h3 style={{ fontSize: '1.25rem' }}>{td('tasks')}</h3>
                    </div>
                    <div style={{ color: 'var(--text-secondary)' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.5rem 0' }}>
                            <input type="checkbox" style={{ width: '1.2rem', height: '1.2rem', accentColor: 'var(--accent-primary)' }} />
                            <span>Thaw 5kg Octopus (Pulpo) for Prep</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.5rem 0' }}>
                            <input type="checkbox" style={{ width: '1.2rem', height: '1.2rem', accentColor: 'var(--accent-primary)' }} />
                            <span>Prepare 20L Chicha Base</span>
                        </label>
                    </div>
                </div>
            </div>
        </div>
    );
}
