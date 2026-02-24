'use client';

import { useTranslations } from 'next-intl';
import { Download, Search, FileText, UploadCloud, RefreshCw } from 'lucide-react';
import { useState } from 'react';

const MOCK_DATA = [
    { id: '1', date: '2026-02-20', source: 'Clover POS API', type: 'Sales Data', records: 142, status: 'Synced' },
    { id: '2', date: '2026-02-19', source: 'Clover POS API', type: 'Sales Data', records: 215, status: 'Synced' },
    { id: '3', date: '2026-02-19', source: 'Email Drop (SYSCO)', type: 'Invoice', records: 24, status: 'Synced' },
    { id: '4', date: '2026-02-18', source: 'Local Csv Upload', type: 'Inventory Count', records: 98, status: 'Synced' },
    { id: '5', date: '2026-02-18', source: 'Email Drop (US FOODS)', type: 'Invoice', records: 12, status: 'Manual Review' },
];

export default function RawDataPage() {
    const [search, setSearch] = useState('');

    const filteredData = MOCK_DATA.filter(item =>
        item.source.toLowerCase().includes(search.toLowerCase()) ||
        item.type.toLowerCase().includes(search.toLowerCase())
    );

    const handleExportCsv = () => {
        // Create CSV string
        const headers = ['ID', 'Date', 'Source', 'Type', 'Records', 'Status'];
        const rows = filteredData.map(item => [
            item.id, item.date, item.source, item.type, item.records, item.status
        ]);

        let csvContent = "data:text/csv;charset=utf-8,"
            + headers.join(",") + "\n"
            + rows.map(e => e.join(",")).join("\n");

        // Create download link
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `fusionista_raw_data_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '1200px', margin: '0 auto' }}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>Raw Data Storage</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>View, verify, and export raw ingested data</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button className="btn-secondary" onClick={handleExportCsv} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '8px', padding: '0.6rem 1rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <Download size={18} />
                        <span>Export CSV</span>
                    </button>
                    <button className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '8px', padding: '0.6rem 1rem' }}>
                        <UploadCloud size={18} />
                        <span>Manual Upload</span>
                    </button>
                </div>
            </div>

            {/* Controls Container */}
            <div className="glass-panel" style={{ padding: '1rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '0.3rem', borderRadius: '12px' }}>
                    <button style={{ padding: '0.5rem 1rem', borderRadius: '8px', fontWeight: 500, fontSize: '0.9rem', color: '#fff', background: 'var(--bg-secondary)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                        All Data Logs
                    </button>
                    <button style={{ padding: '0.5rem 1rem', borderRadius: '8px', fontWeight: 500, fontSize: '0.9rem', color: 'var(--text-secondary)', background: 'transparent', border: '1px solid transparent' }}>
                        Invoices
                    </button>
                    <button style={{ padding: '0.5rem 1rem', borderRadius: '8px', fontWeight: 500, fontSize: '0.9rem', color: 'var(--text-secondary)', background: 'transparent', border: '1px solid transparent' }}>
                        Sales Data
                    </button>
                </div>

                <div style={{ display: 'flex', gap: '1rem', flex: 1, justifyContent: 'flex-end' }}>
                    <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
                        <Search size={16} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                        <input
                            type="text"
                            placeholder="Search Source or Type..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="input-field"
                            style={{ paddingLeft: '2.5rem', fontSize: '0.9rem', width: '100%', backgroundColor: 'rgba(255,255,255,0.03)' }}
                        />
                    </div>
                </div>
            </div>

            {/* Data Table */}
            <div className="glass-panel" style={{ padding: '0', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                            <th style={{ padding: '1rem 1.5rem', color: 'var(--text-secondary)', fontWeight: 500, fontSize: '0.9rem' }}>Date Ingested</th>
                            <th style={{ padding: '1rem 1.5rem', color: 'var(--text-secondary)', fontWeight: 500, fontSize: '0.9rem' }}>Source</th>
                            <th style={{ padding: '1rem 1.5rem', color: 'var(--text-secondary)', fontWeight: 500, fontSize: '0.9rem' }}>Data Type</th>
                            <th style={{ padding: '1rem 1.5rem', color: 'var(--text-secondary)', fontWeight: 500, fontSize: '0.9rem' }}>Records Read</th>
                            <th style={{ padding: '1rem 1.5rem', color: 'var(--text-secondary)', fontWeight: 500, fontSize: '0.9rem' }}>Status</th>
                            <th style={{ padding: '1rem 1.5rem', textAlign: 'right', color: 'var(--text-secondary)', fontWeight: 500, fontSize: '0.9rem' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredData.map((item) => (
                            <tr key={item.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', transition: 'background 0.2s' }}>
                                <td style={{ padding: '1rem 1.5rem', fontWeight: 500 }}>{item.date}</td>
                                <td style={{ padding: '1rem 1.5rem', color: 'var(--text-secondary)' }}>{item.source}</td>
                                <td style={{ padding: '1rem 1.5rem', color: 'var(--text-secondary)' }}>{item.type}</td>
                                <td style={{ padding: '1rem 1.5rem', color: 'var(--text-primary)', fontWeight: 500 }}>{item.records} items</td>
                                <td style={{ padding: '1rem 1.5rem' }}>
                                    <span style={{
                                        padding: '0.2rem 0.6rem',
                                        borderRadius: '12px',
                                        fontSize: '0.8rem',
                                        background: item.status === 'Synced' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                                        color: item.status === 'Synced' ? 'var(--success)' : 'var(--warning)',
                                    }}>
                                        {item.status}
                                    </span>
                                </td>
                                <td style={{ padding: '1rem 1.5rem', textAlign: 'right' }}>
                                    <button style={{ color: 'var(--accent-primary)', padding: '0.4rem', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.1)' }}>
                                        <FileText size={18} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {filteredData.length === 0 && (
                            <tr>
                                <td colSpan={6} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                    No records found matching "{search}"
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

        </div>
    );
}
