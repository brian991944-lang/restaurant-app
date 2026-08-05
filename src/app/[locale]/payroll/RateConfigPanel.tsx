'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { saveRateConfig, type RateConfig } from '@/app/actions/payroll';

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.6rem 0.7rem', minHeight: '52px',
    fontSize: '1.05rem', borderRadius: '8px', textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--text-primary)', background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
};

export default function RateConfigPanel({ config }: { config: RateConfig }) {
    const t = useTranslations('Payroll');

    const [serverRate, setServerRate] = useState(config.serverRate.toFixed(2));
    const [busserRate, setBusserRate] = useState(config.busserRate.toFixed(2));
    const [minimumWage, setMinimumWage] = useState(config.minimumWage.toFixed(2));
    const [cushionAmount, setCushionAmount] = useState(config.cushionAmount.toFixed(2));

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        setSaved(false);

        const res = await saveRateConfig(
            Number(serverRate), Number(busserRate),
            Number(minimumWage), Number(cushionAmount)
        );

        if (res.success) setSaved(true);
        else setError(res.error ?? t('rates_failed'));
        setSaving(false);
    };

    const field = (label: string, value: string, onChange: (v: string) => void) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: '1 1 180px' }}>
            <label style={{ fontSize: '0.95rem', color: 'var(--text-secondary)' }}>{label}</label>
            <input
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={value}
                onChange={e => { onChange(e.target.value); setSaved(false); }}
                style={inputStyle}
            />
        </div>
    );

    return (
        <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h2 style={{ fontSize: '1.3rem', margin: 0 }}>{t('rates_title')}</h2>

            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                {field(t('server_rate'), serverRate, setServerRate)}
                {field(t('busser_rate'), busserRate, setBusserRate)}
                {field(t('minimum_wage'), minimumWage, setMinimumWage)}
                {field(t('cushion'), cushionAmount, setCushionAmount)}

                <button
                    onClick={handleSave}
                    className="btn-primary"
                    disabled={saving}
                    style={{ borderRadius: '8px', minHeight: '52px', opacity: saving ? 0.6 : 1 }}
                >
                    {saving ? t('saving') : t('save_rates')}
                </button>
            </div>

            {saved && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--success)', fontSize: '1.02rem' }}>
                    <CheckCircle2 size={18} />
                    <span>{t('rates_saved')}</span>
                </div>
            )}
            {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger)', fontSize: '1.02rem' }}>
                    <AlertTriangle size={18} />
                    <span>{error}</span>
                </div>
            )}
        </div>
    );
}
