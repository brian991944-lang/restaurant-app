'use client';

import { Upload, DollarSign, ChefHat, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { saveVendorItem, getVendorItems } from '@/app/actions/purchases';
import { getInventory, getProviders, getCategories } from '@/app/actions/inventory';

const processInvoiceImage = async (b: string): Promise<any[]> => [];
import { getDropdownOptions } from '@/app/actions/dropdownOptions';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { ALLOWED_METRICS } from '@/lib/conversion';
import { Trash2 } from 'lucide-react';

export default function PurchasesPage() {
    const [view, setView] = useState<'PRICE' | 'CULINARY'>('PRICE');
    const [vendorItems, setVendorItems] = useState<any[]>([]);
    const [allIngredients, setAllIngredients] = useState<any[]>([]);
    const [providers, setProviders] = useState<any[]>([]);
    const [isUploading, setIsUploading] = useState(false);
    const [pendingInbox, setPendingInbox] = useState<any[]>([]);
    const [culinaryFilter, setCulinaryFilter] = useState('');

    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadData = async () => {
        const vi = await getVendorItems();
        setVendorItems(vi);
        const inv = await getInventory();
        setAllIngredients(inv.filter(i => i.type === 'RAW'));
        setProviders(await getProviders());
    };

    useEffect(() => { loadData(); }, []);

    const groupedItems = vendorItems.reduce((acc, item) => {
        const key = item.ingredient.name;
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
    }, {} as Record<string, any[]>);

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        // Using mock extraction
        const results = await processInvoiceImage("mock_base64");
        setPendingInbox(results);
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleSyncItem = async (inboxItem: any, index: number, mappedValue: string) => {
        if (!mappedValue) return;

        if (mappedValue === 'IGNORE') {
            const newInbox = [...pendingInbox];
            newInbox.splice(index, 1);
            setPendingInbox(newInbox);
            return;
        }

        if (mappedValue === 'NEW_PARENT') {
            alert(`Routing to "Create New Target" for ${inboxItem.extractedDesc}. (In production, this would open AddIngredientModal)`);
            return;
        }

        // Standard mapping to existing ID Let's prompt Brian
        const targetIng = allIngredients.find(i => i.id === mappedValue);
        const shouldAssign = confirm(`I found '${inboxItem.extractedDesc}' on your ${inboxItem.vendorName} invoice. \n\nShould I assign this as the new active Market Source price for the internal ingredient '${targetIng?.name}'?`);

        // Always save the vendor product linkage
        const res = await saveVendorItem({
            ingredientId: mappedValue,
            vendorName: inboxItem.vendorName,
            invoiceDescription: inboxItem.extractedDesc,
            packSize: parseFloat(inboxItem.packSize),
            packUnit: inboxItem.normalizedMetric,
            currentPackPrice: parseFloat(inboxItem.currentPackPrice),
            forceActiveLink: shouldAssign, // pass intention back to backend
            culinaryNotes: inboxItem.packUnit
        });

        const newInbox = [...pendingInbox];
        newInbox.splice(index, 1);
        setPendingInbox(newInbox);

        loadData();
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>Purchases & Vendors</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Automated Vendor Ingestion via AI</p>
                </div>
                <div>
                    <input
                        type="file"
                        accept="image/*,.pdf"
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        onChange={handleFileUpload}
                    />
                    <button onClick={() => fileInputRef.current?.click()} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '8px' }}>
                        <Upload size={18} />
                        <span>{isUploading ? 'Scanning Invoice...' : 'Upload Invoice'}</span>
                    </button>
                </div>
            </div>

            {/* AI Review Inbox */}
            {pendingInbox.length > 0 && (
                <div className="glass-panel" style={{ padding: '1.5rem', border: '1px solid var(--warning)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--warning)', marginBottom: '1rem' }}>
                        <AlertCircle size={20} />
                        <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Human Review Required ({pendingInbox.length})</h2>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {pendingInbox.map((req, idx) => {
                            const normalizedPrice = req.packSize > 0 ? (req.currentPackPrice / req.packSize) : 0;
                            const currentIngredientId = req.mappedIngredientId || allIngredients.find(i => i.name === req.mappedIngredientName)?.id;
                            const isReadyToSync = req.vendorName && currentIngredientId && req.normalizedMetric;

                            return (
                                <div key={idx} style={{ padding: '1.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '1rem', border: '1px solid var(--border)' }}>

                                    {/* Header Row */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>{req.extractedDesc}</div>
                                            <div style={{ fontSize: '0.8rem', color: req.confidence >= 90 ? 'var(--success)' : 'var(--warning)', marginTop: '0.3rem' }}>
                                                AI Match Confidence: {req.confidence}%
                                            </div>
                                        </div>
                                    </div>

                                    {/* Grid Layout for Inputs */}
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Provider Confirmation</label>
                                            <SearchableSelect
                                                value={req.vendorName}
                                                onChange={(val) => {
                                                    const newInbox = [...pendingInbox];
                                                    newInbox[idx].vendorName = val;
                                                    setPendingInbox(newInbox);
                                                }}
                                                options={[
                                                    { value: req.vendorName, label: `${req.vendorName} (Invoice Suggestion)` },
                                                    ...providers.map(p => ({ value: p.name, label: p.name }))
                                                ]}
                                                placeholder="Select Provider..."
                                            />
                                        </div>

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Price Paid ($)</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                className="input-field"
                                                value={req.currentPackPrice}
                                                onChange={(e) => {
                                                    const newInbox = [...pendingInbox];
                                                    newInbox[idx].currentPackPrice = parseFloat(e.target.value) || 0;
                                                    setPendingInbox(newInbox);
                                                }}
                                            />
                                        </div>

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                            <label style={{ fontSize: '0.8rem', color: 'var(--accent-primary)' }}>Normalization Metric</label>
                                            <SearchableSelect
                                                value={req.normalizedMetric || ""}
                                                onChange={(val) => {
                                                    const newInbox = [...pendingInbox];
                                                    newInbox[idx].normalizedMetric = val;
                                                    setPendingInbox(newInbox);
                                                }}
                                                placeholder="Select Internal Metric..."
                                                options={ALLOWED_METRICS.map(m => ({ value: m, label: m }))}
                                            />
                                        </div>

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Quantity Paid</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                className="input-field"
                                                value={req.packSize}
                                                onChange={(e) => {
                                                    const newInbox = [...pendingInbox];
                                                    newInbox[idx].packSize = parseFloat(e.target.value) || 0;
                                                    setPendingInbox(newInbox);
                                                }}
                                            />
                                        </div>

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                            <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Unit Purchased</label>
                                            <input
                                                type="text"
                                                className="input-field"
                                                value={req.packUnit}
                                                onChange={(e) => {
                                                    const newInbox = [...pendingInbox];
                                                    newInbox[idx].packUnit = e.target.value;
                                                    setPendingInbox(newInbox);
                                                }}
                                            />
                                        </div>
                                    </div>

                                    {/* Action Row */}
                                    <div style={{ marginTop: '0.5rem', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: '220px' }}>
                                                <SearchableSelect
                                                    value={currentIngredientId || ""}
                                                    onChange={(val) => {
                                                        const newInbox = [...pendingInbox];
                                                        newInbox[idx].mappedIngredientId = val;
                                                        setPendingInbox(newInbox);
                                                    }}
                                                    placeholder="Select Master Ingredient..."
                                                    options={[
                                                        { value: 'NEW_PARENT', label: '+ Create New Parent Ingredient' },
                                                        ...allIngredients.map(i => ({ value: i.id, label: i.name }))
                                                    ]}
                                                />
                                            </div>

                                            <div style={{ paddingLeft: '1rem', borderLeft: '1px solid var(--border)' }}>
                                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Live Normalized Cost: </span>
                                                <strong style={{ fontSize: '1.25rem', color: 'var(--success)' }}>${normalizedPrice.toFixed(4)}</strong> <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>/ {req.normalizedMetric || "unit"}</span>
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <button
                                                className="btn-primary"
                                                disabled={!isReadyToSync}
                                                onClick={() => handleSyncItem(req, idx, currentIngredientId)}
                                                style={{ padding: '0.5rem 1.5rem', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.4rem', opacity: isReadyToSync ? 1 : 0.5, cursor: isReadyToSync ? 'pointer' : 'not-allowed' }}
                                            >
                                                <CheckCircle2 size={16} /> Sync
                                            </button>
                                            <button
                                                onClick={() => {
                                                    const newInbox = [...pendingInbox];
                                                    newInbox.splice(idx, 1);
                                                    setPendingInbox(newInbox);
                                                }}
                                                style={{ padding: '0.5rem 1rem', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(239,68,68,0.1)', color: 'var(--danger)' }}
                                            >
                                                <Trash2 size={16} /> Dismiss
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Toggle View */}
            <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '0.3rem', borderRadius: '12px', width: 'fit-content' }}>
                <button
                    onClick={() => setView('PRICE')}
                    style={{
                        padding: '0.5rem 1rem', borderRadius: '8px', fontWeight: 500, fontSize: '0.9rem',
                        color: view === 'PRICE' ? 'var(--text-primary)' : 'var(--text-secondary)',
                        background: view === 'PRICE' ? 'var(--bg-primary)' : 'transparent',
                        border: view === 'PRICE' ? '1px solid rgba(255,255,255,0.1)' : '1px solid transparent',
                        display: 'flex', alignItems: 'center', gap: '0.5rem'
                    }}
                >
                    <DollarSign size={16} /> Price View
                </button>
                <button
                    onClick={() => setView('CULINARY')}
                    style={{
                        padding: '0.5rem 1rem', borderRadius: '8px', fontWeight: 500, fontSize: '0.9rem',
                        color: view === 'CULINARY' ? 'var(--text-primary)' : 'var(--text-secondary)',
                        background: view === 'CULINARY' ? 'var(--bg-primary)' : 'transparent',
                        border: view === 'CULINARY' ? '1px solid rgba(255,255,255,0.1)' : '1px solid transparent',
                        display: 'flex', alignItems: 'center', gap: '0.5rem'
                    }}
                >
                    <ChefHat size={16} /> Culinary View
                </button>
            </div>

            {view === 'CULINARY' && (
                <div style={{ maxWidth: '400px' }}>
                    <input
                        type="text"
                        placeholder="Search culinary notes... (e.g., 'Jumbo')"
                        className="input-field"
                        value={culinaryFilter}
                        onChange={(e) => setCulinaryFilter(e.target.value)}
                    />
                </div>
            )}

            {/* Lists */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>
                {(Object.entries(groupedItems) as [string, any[]][]).map(([parentName, items]) => {
                    // Sorting and filtering
                    let displayItems = [...items];

                    if (view === 'PRICE') {
                        displayItems.sort((a, b) => (a.currentPackPrice / a.packSize) - (b.currentPackPrice / b.packSize));
                    } else if (view === 'CULINARY' && culinaryFilter) {
                        displayItems = displayItems.filter(i => (i.culinaryNotes || '').toLowerCase().includes(culinaryFilter.toLowerCase()));
                        if (displayItems.length === 0) return null;
                    }

                    return (
                        <div key={parentName} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <h2 style={{ fontSize: '1.5rem', fontWeight: 600, borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>{parentName}</h2>

                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead>
                                    <tr style={{ color: 'var(--text-secondary)' }}>
                                        <th style={{ padding: '0.8rem 1rem', fontWeight: 500 }}>Invoice Desc</th>
                                        <th style={{ padding: '0.8rem 1rem', fontWeight: 500 }}>Vendor</th>
                                        <th style={{ padding: '0.8rem 1rem', fontWeight: 500 }}>Pack Size</th>
                                        <th style={{ padding: '0.8rem 1rem', fontWeight: 500 }}>Base Unit Price</th>
                                        {view === 'CULINARY' && (
                                            <th style={{ padding: '0.8rem 1rem', fontWeight: 500 }}>Culinary Notes</th>
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {displayItems.map((vItem, index) => {
                                        const unitPrice = vItem.currentPackPrice / vItem.packSize;
                                        const isBestBuy = view === 'PRICE' && index === 0 && displayItems.length > 1; // Only designate best buy if competing items exist

                                        return (
                                            <tr key={vItem.id} style={{
                                                background: isBestBuy ? 'rgba(16, 185, 129, 0.1)' : 'rgba(0,0,0,0.2)',
                                                border: isBestBuy ? '1px solid var(--success)' : '1px solid transparent',
                                                borderBottom: !isBestBuy ? '1px solid rgba(255,255,255,0.05)' : ''
                                            }}>
                                                <td style={{ padding: '1rem' }}>
                                                    <div style={{ fontWeight: 600 }}>{vItem.invoiceDescription}</div>
                                                    {isBestBuy && <span style={{ fontSize: '0.7rem', color: 'var(--success)', fontWeight: 700, padding: '0.1rem 0.4rem', background: 'rgba(16,185,129,0.2)', borderRadius: '12px' }}>BEST BUY</span>}
                                                </td>
                                                <td style={{ padding: '1rem', color: 'var(--text-secondary)' }}>{vItem.vendorName}</td>
                                                <td style={{ padding: '1rem' }}>{vItem.packSize} {vItem.packUnit} <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>${vItem.currentPackPrice.toFixed(2)}</div></td>
                                                <td style={{ padding: '1rem', fontWeight: 600 }}>${unitPrice.toFixed(4)} / {vItem.packUnit}</td>
                                                {view === 'CULINARY' && (
                                                    <td style={{ padding: '1rem', color: 'var(--text-secondary)' }}>{vItem.culinaryNotes || 'No notes'}</td>
                                                )}
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
