'use client';

import { useTranslations } from 'next-intl';
import { Mail, Store, Link as LinkIcon, Download } from 'lucide-react';
import { useState } from 'react';

export default function IntegrationsPage() {
    const [copied, setCopied] = useState(false);

    const emailAddress = "data-drop@fusionista.app";

    const handleCopy = () => {
        navigator.clipboard.writeText(emailAddress);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem', maxWidth: '900px', margin: '0 auto' }}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Data Integrations</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Connect your POS or set up automated email ingestion</p>
                </div>
            </div>

            {/* Direct API Connections Section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <h2 style={{ fontSize: '1.5rem', color: 'var(--text-primary)' }}>Direct API Connections</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>

                    {/* Clover Card */}
                    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                            <div style={{ background: 'rgba(59, 130, 246, 0.1)', padding: '0.8rem', borderRadius: '12px' }}>
                                <Store size={32} color="var(--accent-primary)" />
                            </div>
                            <div>
                                <h3 style={{ fontSize: '1.2rem', margin: 0 }}>Clover POS</h3>
                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Real-time sales sync</span>
                            </div>
                        </div>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
                            Connect directly to your Clover merchant account to pull items, categories, and sales performance daily.
                        </p>
                        <button className="btn-secondary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.8rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)' }}>
                            <LinkIcon size={18} />
                            Connect Clover
                        </button>
                    </div>

                    {/* Toast Card */}
                    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                            <div style={{ background: 'rgba(245, 158, 11, 0.1)', padding: '0.8rem', borderRadius: '12px' }}>
                                <Store size={32} color="var(--warning)" />
                            </div>
                            <div>
                                <h3 style={{ fontSize: '1.2rem', margin: 0 }}>Toast POS</h3>
                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Real-time sales sync</span>
                            </div>
                        </div>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
                            Connect directly to your Toast account to retrieve real-time sales, menus, and discount tracking.
                        </p>
                        <button className="btn-secondary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.8rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.05)', color: 'var(--text-primary)' }}>
                            <LinkIcon size={18} />
                            Connect Toast
                        </button>
                    </div>

                </div>
            </div>

            {/* Email Data Connector Section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <h2 style={{ fontSize: '1.5rem', color: 'var(--text-primary)' }}>Email Ingestion Drop</h2>

                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                        <div style={{ background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', padding: '1.2rem', borderRadius: '16px', boxShadow: '0 4px 15px rgba(59, 130, 246, 0.3)' }}>
                            <Mail size={36} color="white" />
                        </div>
                        <div>
                            <h3 style={{ fontSize: '1.3rem', margin: 0 }}>Automated Email Drop</h3>
                            <p style={{ color: 'var(--text-secondary)', margin: '0.2rem 0 0 0' }}>Forward PDF/CSV reports directly to the AI Engine</p>
                        </div>
                    </div>

                    <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '12px', border: '1px dashed var(--border)' }}>
                        <p style={{ margin: '0 0 1rem 0', color: 'var(--text-secondary)' }}>
                            If you do not want to connect directly to the API, you can set up a daily reporting email from your POS to send "End of Day Sales" reports straight to your unique Drop Address. Our backend AI parser will automatically extract the invoice/sales data.
                        </p>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <input
                                type="text"
                                readOnly
                                value={emailAddress}
                                className="input-field"
                                style={{ flex: 1, fontFamily: 'monospace', fontSize: '1.1rem', padding: '1rem', background: 'rgba(0,0,0,0.3)', color: 'var(--text-primary)' }}
                            />
                            <button
                                onClick={handleCopy}
                                className="btn-primary"
                                style={{ padding: '1rem 1.5rem', borderRadius: '8px', whiteSpace: 'nowrap' }}
                            >
                                {copied ? 'Copied!' : 'Copy Drop Address'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

        </div>
    );
}
