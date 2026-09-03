'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useLocale } from 'next-intl';
import { toPng } from 'html-to-image';
import { useAdmin } from '@/components/AdminContext';
import { ShoppingCart, CheckSquare, Square, PackageSearch, Share2 } from 'lucide-react';
import { getComprasIngredients, toggleNeedsOrdering, setPurchaseStatus } from '@/app/actions/compras';
import { addIngredient } from '@/app/actions/inventory';
import AddIngredientModal from '@/components/modals/AddIngredientModal';

// A frozen copy of what was just sent. Taken BEFORE the server action runs,
// because submitShoppingList flips isSubmittedForOrdering and the refetch that
// follows would otherwise change the list out from under the open modal.
interface SentListSnapshot {
    providerLabel: string;
    sentAt: Date;
    groups: [string, { id: string; name: string }[]][];
}

export default function ComprasPage() {
    const locale = useLocale();
    const { isAdmin } = useAdmin();

    const [activeTab, setActiveTab] = useState('RD_SYSCO');
    const [ingredients, setIngredients] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [sentList, setSentList] = useState<SentListSnapshot | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [capturing, setCapturing] = useState(false);
    const shareRef = useRef<HTMLDivElement>(null);


    const tabs = [
        { id: 'RD_SYSCO', label: 'RD & Sysco', providers: ['Restaurant Depot', 'Sysco'] },
        { id: 'PERUANOS', label: 'Productos Peruanos', providers: ['Productos Peruanos', 'JCC Ganoza'] },
        { id: 'MONARCH', label: 'Monarch Seafood', providers: ['Monarch Seafood'] }
    ];
    if (isAdmin) {
        tabs.push({ id: 'SUBMITTED_LIST', label: locale === 'es' ? 'Lista Enviada' : 'Submitted List', providers: ['Restaurant Depot', 'Sysco', 'Productos Peruanos', 'JCC Ganoza', 'Monarch Seafood'] });
    }

    useEffect(() => {
        loadData();
    }, [activeTab]);

    const loadData = async () => {
        setIsLoading(true);
        const activeTabInfo = tabs.find(t => t.id === activeTab);
        if (activeTabInfo) {
            const res = await getComprasIngredients(activeTabInfo.providers);
            if (res.success && res.data) {
                setIngredients(res.data);
            }
        }
        setIsLoading(false);
    };

    const activeTabProviders = () => {
        const tab = tabs.find(t => t.id === activeTab);
        return tab ? tab.providers[0] : '';
    };

    const handleSaveIngredient = async (data: any) => {
        setIsCreateModalOpen(false);
        const res = await addIngredient(data);
        if (res.success) {
            loadData();
        } else {
            alert((res as any).error || 'Failed to save product');
        }
    };

    const handleToggle = async (id: string, currentVal: boolean) => {
        // Optimistic UI update
        const updated = ingredients.map(ing =>
            ing.id === id ? { ...ing, needsOrdering: !currentVal } : ing
        );
        setIngredients(updated);

        const res = await toggleNeedsOrdering(id, !currentVal);
        if (!res.success) {
            // Revert on failure
            setIngredients(ingredients);
            alert('Failed to update status');
        }
    };

    const handleSetPurchaseStatus = async (id: string, newStatus: string) => {
        // Optimistic UI update
        const updated = ingredients.map(ing =>
            ing.id === id ? { ...ing, purchaseStatus: newStatus } : ing
        );
        setIngredients(updated);

        const res = await setPurchaseStatus(id, newStatus);
        if (!res.success) {
            // Revert on failure
            setIngredients(ingredients);
            alert('Failed to update status');
        }
    };

    const displayName = (ing: any) => (locale === 'es' && ing.nameEs ? ing.nameEs : ing.name);
    const displayCategory = (ing: any) =>
        locale === 'es' && ing.category?.nameEs ? ing.category.nameEs : (ing.category?.name || 'Uncategorized');

    const handleEnviarLista = async () => {
        const activeTabInfo = tabs.find(t => t.id === activeTab);
        if (!activeTabInfo || isSubmitting) return;

        // Snapshot first, send second. Anything read after the await is post-mutation
        // and post-refetch, which is not what the user pressed the button on.
        const flagged = ingredients.filter(ing => ing.needsOrdering);
        const groups = Array.from<[string, { id: string; name: string }[]]>(
            flagged.reduce((acc, ing) => {
                const cat = displayCategory(ing);
                if (!acc.has(cat)) acc.set(cat, []);
                acc.get(cat).push({ id: ing.id, name: displayName(ing) });
                return acc;
            }, new Map<string, { id: string; name: string }[]>())
        ).sort((a, b) => a[0].localeCompare(b[0], locale));
        groups.forEach(([, items]) => items.sort((a, b) => a.name.localeCompare(b.name, locale)));

        setIsSubmitting(true);
        try {
            const { submitShoppingList } = await import('@/app/actions/compras');
            const res = await submitShoppingList(activeTabInfo.providers);
            if (!res.success) {
                alert(locale === 'es'
                    ? 'No se pudo enviar la lista. Intenta de nuevo.'
                    : 'Could not submit the list. Please try again.');
                return;
            }
            setSentList({ providerLabel: activeTabInfo.label, sentAt: new Date(), groups });
            loadData();
        } finally {
            setIsSubmitting(false);
        }
    };

    const slugify = (value: string) =>
        // NFD splits accents into combining marks, which the alphanumeric filter
        // below then drops -- so 'Cafe' with an accent slugifies to 'cafe', not 'caf'.
        value.normalize('NFD')
            .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'lista';

    // Local calendar date, not toISOString() — the filename must agree with the
    // date printed inside the image, and UTC disagrees with it after ~7pm here.
    const ymd = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    // Runs from the modal button's own tap. iOS refuses a share sheet that is not
    // opened by a direct user gesture, so this must never be chained onto the
    // await in handleEnviarLista.
    const handleCompartirLista = async () => {
        if (!shareRef.current || !sentList) return;
        setCapturing(true);
        try {
            const dataUrl = await toPng(shareRef.current, {
                pixelRatio: 2,
                backgroundColor: '#ffffff',
                cacheBust: true,
                filter: (node) => {
                    if (node instanceof HTMLElement && node.dataset.noCapture === 'true') {
                        return false;
                    }
                    return true;
                },
            });
            const blob = await (await fetch(dataUrl)).blob();
            const file = new File(
                [blob],
                `lista-compras-${slugify(sentList.providerLabel)}-${ymd(sentList.sentAt)}.png`,
                { type: 'image/png' }
            );

            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: 'Lista de Compras' });
            } else {
                // Desktop fallback: download the PNG
                const a = document.createElement('a');
                a.href = dataUrl;
                a.download = file.name;
                a.click();
            }
        } catch (err) {
            // AbortError = user closed the share sheet; ignore silently
            if ((err as Error).name !== 'AbortError') {
                console.error('Error al compartir la lista:', err);
                alert('No se pudo generar la imagen. Intenta de nuevo.');
            }
        } finally {
            setCapturing(false);
        }
    };

    return (
        <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 style={{ fontSize: '2.5rem', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <ShoppingCart size={36} color="var(--accent-primary)" />
                        {locale === 'es' ? 'Lista de Compras' : 'Shopping List'}
                    </h1>
                    <p style={{ color: 'var(--text-secondary)' }}>{locale === 'es' ? 'Gestión de pedidos por proveedor.' : 'Provider-based order management.'}</p>
                </div>
            </div>

            <div className="glass-panel" style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2rem', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            style={{
                                padding: '0.6rem 1.2rem',
                                borderRadius: '8px',
                                fontWeight: 500,
                                fontSize: '0.95rem',
                                color: activeTab === tab.id ? 'white' : 'var(--text-secondary)',
                                background: activeTab === tab.id ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))' : 'transparent',
                                border: activeTab === tab.id ? 'none' : '1px solid rgba(255,255,255,0.1)',
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                            }}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
                
                <div style={{ display: 'flex', gap: '1rem' }}>
                    {!isAdmin && (
                        <button
                            onClick={handleEnviarLista}
                            disabled={isSubmitting}
                            style={{ padding: '0.6rem 1.2rem', background: 'var(--success)', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: isSubmitting ? 'default' : 'pointer', opacity: isSubmitting ? 0.6 : 1 }}
                        >
                            {isSubmitting
                                ? (locale === 'es' ? 'Enviando…' : 'Sending…')
                                : (locale === 'es' ? 'Enviar Lista' : 'Submit List')}
                        </button>
                    )}

                    {isAdmin && activeTab === 'SUBMITTED_LIST' && (
                        <button 
                            onClick={async () => {
                                const { completeShoppingList } = await import('@/app/actions/compras');
                                await completeShoppingList(tabs.find(t => t.id === 'SUBMITTED_LIST')!.providers);
                                alert(locale === 'es' ? '¡Compras marcadas como finalizadas!' : 'Shopping marked as completed!');
                                loadData();
                            }}
                            style={{ padding: '0.6rem 1.2rem', background: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                        >
                            {locale === 'es' ? 'Finalizar Compras' : 'Complete Shopping'}
                        </button>
                    )}

                    {isAdmin && activeTab !== 'SUBMITTED_LIST' && (
                        <button 
                            onClick={() => setIsCreateModalOpen(true)}
                            style={{ padding: '0.6rem 1.2rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}
                        >
                            {locale === 'es' ? '+ Crear Producto' : '+ Create Item'}
                        </button>
                    )}
                </div>
            </div>

            <div className="glass-panel" style={{ flex: 1, padding: 0, overflow: 'hidden' }}>
                {isLoading ? (
                    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading...</div>
                ) : ingredients.length === 0 ? (
                    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                        <PackageSearch size={48} opacity={0.5} />
                        <p>{locale === 'es' ? 'No se encontraron productos para este proveedor.' : 'No items found for this provider.'}</p>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                                    <th style={{ padding: '1rem', fontWeight: 600, width: '180px' }}>{locale === 'es' ? 'Categoría' : 'Category'}</th>
                                    <th style={{ padding: '1rem', fontWeight: 600, width: '60px' }}></th>
                                    <th style={{ padding: '1rem', fontWeight: 600 }}>{locale === 'es' ? 'Ingrediente' : 'Ingredient'}</th>
                                    {isAdmin && (
                                        <>
                                            <th style={{ padding: '1rem', fontWeight: 600, width: '150px', textAlign: 'right' }}>{locale === 'es' ? 'Stock Actual' : 'Current Stock'}</th>
                                            <th style={{ padding: '1rem', fontWeight: 600, width: '200px', textAlign: 'right' }}>{locale === 'es' ? 'Proveedor' : 'Provider'}</th>
                                        </>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {(() => {
                                    let filteredIngredients = ingredients;
                                    if (activeTab === 'SUBMITTED_LIST') {
                                        filteredIngredients = ingredients.filter(ing => ing.isSubmittedForOrdering);
                                    }
                                    
                                    if (filteredIngredients.length === 0) {
                                        return (
                                            <tr>
                                                <td colSpan={isAdmin ? 5 : 3} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                                    {activeTab === 'SUBMITTED_LIST' 
                                                        ? (locale === 'es' ? 'No hay productos enviados para comprar.' : 'No items submitted for shopping.')
                                                        : (locale === 'es' ? 'No se encontraron productos.' : 'No items found.')}
                                                </td>
                                            </tr>
                                        );
                                    }

                                    const groupedIngredients = Array.from<[string, any[]]>(
                                        filteredIngredients.reduce((acc, ing) => {
                                            const cat = locale === 'es' && ing.category?.nameEs ? ing.category.nameEs : (ing.category?.name || 'Uncategorized');
                                            if (!acc.has(cat)) acc.set(cat, []);
                                            acc.get(cat).push(ing);
                                            return acc;
                                        }, new Map<string, any[]>())
                                    ).sort((a, b) => a[0].localeCompare(b[0], locale));

                                    return groupedIngredients.map(([category, items]) => {
                                        items.sort((a: any, b: any) => {
                                            const nameA = locale === 'es' && a.nameEs ? a.nameEs : a.name;
                                            const nameB = locale === 'es' && b.nameEs ? b.nameEs : b.name;
                                            return nameA.localeCompare(nameB, locale);
                                        });

                                        return (
                                            <React.Fragment key={category}>
                                                {items.map((ing: any, idx: number) => {
                                                    const qty = (ing.inventory?.frozenQty || 0) + (ing.inventory?.thawingQty || 0);
                                                    let displayStock = `${qty} ${ing.metric}`;
                                                    if (ing.isPacked && ing.unitsPerPack > 0 && qty > 0) {
                                                        const totalPacks = Math.floor(qty / ing.unitsPerPack);
                                                        const packLabel = (locale === 'es' && ing.packUnit?.toLowerCase() === 'bags') ? 'Bolsas' :
                                                            (locale === 'es' && ing.packUnit?.toLowerCase() === 'boxes') ? 'Cajas' : (ing.packUnit || 'Packs');
                                                        displayStock = `${totalPacks} ${packLabel} (${qty} ${ing.metric})`;
                                                    }

                                                    const isEven = idx % 2 === 0;

                                                    // Row styling. In the Lista Enviada view it is driven ONLY by
                                                    // purchaseStatus (plain/neutral by default, green only when Comprado).
                                                    // Every other tab keeps the original needsOrdering-based styling.
                                                    let rowBg: string;
                                                    let rowHoverBg: string;
                                                    let nameColor: string;
                                                    if (activeTab === 'SUBMITTED_LIST') {
                                                        if (ing.purchaseStatus === 'COMPRADO') {
                                                            rowBg = 'rgba(34, 197, 94, 0.05)';
                                                            rowHoverBg = 'rgba(34, 197, 94, 0.1)';
                                                            nameColor = 'var(--success)';
                                                        } else if (ing.purchaseStatus === 'NO_DISPONIBLE') {
                                                            rowBg = 'rgba(245, 158, 11, 0.08)';
                                                            rowHoverBg = 'rgba(245, 158, 11, 0.15)';
                                                            nameColor = '#f59e0b';
                                                        } else {
                                                            rowBg = isEven ? 'rgba(255,255,255,0.02)' : 'transparent';
                                                            rowHoverBg = 'var(--bg-secondary)';
                                                            nameColor = 'inherit';
                                                        }
                                                    } else {
                                                        rowBg = ing.needsOrdering ? (ing.isSubmittedForOrdering ? 'rgba(34, 197, 94, 0.05)' : 'rgba(239, 68, 68, 0.05)') : (isEven ? 'rgba(255,255,255,0.02)' : 'transparent');
                                                        rowHoverBg = ing.needsOrdering ? (ing.isSubmittedForOrdering ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)') : 'var(--bg-secondary)';
                                                        nameColor = ing.needsOrdering ? (ing.isSubmittedForOrdering ? 'var(--success)' : 'var(--danger)') : 'inherit';
                                                    }

                                                    return (
                                                        <tr
                                                            key={ing.id}
                                                            style={{
                                                                borderBottom: '1px solid var(--border)',
                                                                transition: 'background 0.2s',
                                                                background: rowBg
                                                            }}
                                                            onMouseOver={(e) => e.currentTarget.style.background = rowHoverBg}
                                                            onMouseOut={(e) => e.currentTarget.style.background = rowBg}
                                                        >
                                                            {idx === 0 && (
                                                                <td
                                                                    rowSpan={items.length}
                                                                    style={{
                                                                        padding: '1rem',
                                                                        background: 'rgba(139, 92, 246, 0.05)',
                                                                        borderRight: '2px solid var(--border)',
                                                                        borderBottom: '1px solid var(--border)',
                                                                        verticalAlign: 'middle',
                                                                        fontWeight: 700,
                                                                        fontSize: '1.05rem',
                                                                        color: 'var(--text-primary)'
                                                                    }}
                                                                >
                                                                    {category as string}
                                                                </td>
                                                            )}
                                                            <td style={{ padding: '0.8rem 1rem', textAlign: 'center' }}>
                                                                {activeTab === 'SUBMITTED_LIST' ? (
                                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                                        <button
                                                                            data-no-capture="true"
                                                                            onClick={() => handleSetPurchaseStatus(ing.id, ing.purchaseStatus === 'COMPRADO' ? 'PENDIENTE' : 'COMPRADO')}
                                                                            title="Comprado"
                                                                            style={{
                                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                                border: ing.purchaseStatus === 'COMPRADO' ? 'none' : '1px solid var(--border)',
                                                                                background: ing.purchaseStatus === 'COMPRADO' ? 'var(--success)' : 'transparent',
                                                                                color: ing.purchaseStatus === 'COMPRADO' ? '#fff' : 'var(--text-secondary)',
                                                                                cursor: 'pointer', padding: '0.6rem', borderRadius: '8px',
                                                                                minWidth: '48px', minHeight: '48px'
                                                                            }}
                                                                        >
                                                                            {ing.purchaseStatus === 'COMPRADO' ? <CheckSquare size={24} /> : <Square size={24} />}
                                                                        </button>
                                                                        <button
                                                                            data-no-capture="true"
                                                                            onClick={() => handleSetPurchaseStatus(ing.id, ing.purchaseStatus === 'NO_DISPONIBLE' ? 'PENDIENTE' : 'NO_DISPONIBLE')}
                                                                            title="No Disponible"
                                                                            style={{
                                                                                border: ing.purchaseStatus === 'NO_DISPONIBLE' ? 'none' : '1px solid var(--border)',
                                                                                background: ing.purchaseStatus === 'NO_DISPONIBLE' ? '#f59e0b' : 'transparent',
                                                                                color: ing.purchaseStatus === 'NO_DISPONIBLE' ? '#fff' : 'var(--text-secondary)',
                                                                                cursor: 'pointer', padding: '0.6rem 0.8rem', borderRadius: '8px',
                                                                                minHeight: '48px', fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap'
                                                                            }}
                                                                        >
                                                                            No disp.
                                                                        </button>
                                                                    </div>
                                                                ) : (
                                                                    <button
                                                                        data-no-capture="true"
                                                                        onClick={() => handleToggle(ing.id, ing.needsOrdering)}
                                                                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer', padding: '0.25rem' }}
                                                                    >
                                                                        {ing.needsOrdering ? (
                                                                            <CheckSquare size={24} color={ing.isSubmittedForOrdering ? "var(--success)" : "var(--danger)"} />
                                                                        ) : (
                                                                            <Square size={24} color="var(--text-secondary)" />
                                                                        )}
                                                                    </button>
                                                                )}
                                                            </td>
                                                            <td style={{ padding: '0.8rem 1rem', fontWeight: 500, color: nameColor }}>
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                                    {locale === 'es' && ing.nameEs ? ing.nameEs : ing.name}
                                                                    {activeTab === 'SUBMITTED_LIST' ? (
                                                                        <>
                                                                            {ing.purchaseStatus === 'COMPRADO' && (
                                                                                <span style={{ fontSize: '0.75rem', background: 'rgba(34, 197, 94, 0.1)', color: 'var(--success)', padding: '0.2rem 0.4rem', borderRadius: '4px' }}>
                                                                                    Comprado
                                                                                </span>
                                                                            )}
                                                                            {ing.purchaseStatus === 'NO_DISPONIBLE' && (
                                                                                <span style={{ fontSize: '0.75rem', background: 'rgba(245, 158, 11, 0.12)', color: '#f59e0b', padding: '0.2rem 0.4rem', borderRadius: '4px' }}>
                                                                                    No Disponible
                                                                                </span>
                                                                            )}
                                                                            {ing.carriedOver === true && (
                                                                                <span style={{ fontSize: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', padding: '0.2rem 0.4rem', borderRadius: '4px', fontWeight: 700 }}>
                                                                                    Pendiente de antes
                                                                                </span>
                                                                            )}
                                                                        </>
                                                                    ) : (
                                                                        ing.isSubmittedForOrdering && (
                                                                            <span style={{ fontSize: '0.75rem', background: 'rgba(34, 197, 94, 0.1)', color: 'var(--success)', padding: '0.2rem 0.4rem', borderRadius: '4px' }}>
                                                                                {locale === 'es' ? 'Enviado' : 'Submitted'}
                                                                            </span>
                                                                        )
                                                                    )}
                                                                </div>
                                                                {Array.isArray(ing.prepItems) && ing.prepItems.length > 0 && (
                                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                                                                        {ing.prepItems.map((proc: any) => {
                                                                            const procQty = (proc.inventory?.frozenQty || 0) + (proc.inventory?.thawingQty || 0);
                                                                            return (
                                                                                <span
                                                                                    key={proc.id}
                                                                                    title={locale === 'es' ? 'Ya tienes esto porcionado/preparado' : 'You already have this portioned/prepped'}
                                                                                    style={{
                                                                                        fontSize: '0.75rem',
                                                                                        fontWeight: 600,
                                                                                        color: '#60a5fa',
                                                                                        background: 'rgba(59, 130, 246, 0.1)',
                                                                                        border: '1px solid rgba(59, 130, 246, 0.25)',
                                                                                        padding: '0.15rem 0.5rem',
                                                                                        borderRadius: '10px',
                                                                                        whiteSpace: 'nowrap'
                                                                                    }}
                                                                                >
                                                                                    ↳ {locale === 'es' && proc.nameEs ? proc.nameEs : proc.name}: {Number(procQty.toFixed(2))} {proc.metric}
                                                                                </span>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
                                                            </div>
                                                            </td>
                                                            {isAdmin && (
                                                                <>
                                                                    <td style={{ padding: '0.8rem 1rem', textAlign: 'right', fontWeight: 500 }}>
                                                                        {displayStock}
                                                                    </td>
                                                                    <td style={{ padding: '0.8rem 1rem', textAlign: 'right', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                                                        {ing.provider?.name || 'Unknown'}
                                                                    </td>
                                                                </>
                                                            )}
                                                        </tr>
                                                    );
                                                })}
                                            </React.Fragment>
                                        );
                                    });
                                })()}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Confirmation + shareable preview. Plain inline modal: no backdrop-filter,
                no transforms — html-to-image renders neither faithfully. */}
            {sentList && (
                <div
                    onClick={() => setSentList(null)}
                    style={{
                        position: 'fixed', inset: 0, zIndex: 1000,
                        background: 'rgba(0,0,0,0.5)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '1rem'
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            background: 'var(--bg-primary)', border: '1px solid var(--border)',
                            borderRadius: '12px', width: '100%', maxWidth: '560px', maxHeight: '90vh',
                            display: 'flex', flexDirection: 'column', overflow: 'hidden'
                        }}
                    >
                        <h2 style={{ margin: 0, padding: '1.25rem 1.5rem 0.5rem', fontSize: '1.4rem' }}>
                            {locale === 'es' ? 'Lista enviada' : 'List sent'}
                        </h2>
                        <p style={{ margin: 0, padding: '0 1.5rem 1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                            {locale === 'es'
                                ? 'La lista fue enviada al administrador. Puedes compartirla como imagen.'
                                : 'The list was sent to the admin. You can share it as an image.'}
                        </p>

                        <div style={{ overflowY: 'auto', padding: '0 1.5rem 1rem' }}>
                            {/* Everything inside this ref is what lands in the PNG. Colours are
                                literal, not CSS variables: the app theme is dark and the image
                                is white. */}
                            <div
                                ref={shareRef}
                                style={{
                                    background: '#ffffff', color: '#111827',
                                    padding: '1.25rem', borderRadius: '8px',
                                    border: '1px solid #e5e7eb'
                                }}
                            >
                                <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#111827' }}>
                                    {locale === 'es' ? 'Lista de Compras' : 'Shopping List'} — {sentList.providerLabel}
                                </div>
                                <div style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: '0.25rem' }}>
                                    {new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(sentList.sentAt)}
                                </div>

                                {sentList.groups.length === 0 ? (
                                    <div style={{ marginTop: '1rem', color: '#6b7280', fontStyle: 'italic' }}>
                                        {locale === 'es' ? 'No había productos marcados.' : 'No items were flagged.'}
                                    </div>
                                ) : (
                                    <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                        {sentList.groups.map(([category, items]) => (
                                            <div key={category}>
                                                <div style={{
                                                    fontWeight: 700, fontSize: '0.95rem', color: '#111827',
                                                    borderBottom: '2px solid #e5e7eb', paddingBottom: '0.3rem', marginBottom: '0.4rem'
                                                }}>
                                                    {category}
                                                </div>
                                                {items.map(item => (
                                                    <div key={item.id} style={{ fontSize: '0.95rem', color: '#374151', padding: '0.2rem 0' }}>
                                                        • {item.name}
                                                    </div>
                                                ))}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', flexWrap: 'wrap', padding: '0 1.5rem 1.25rem' }}>
                            <button
                                onClick={() => setSentList(null)}
                                style={{ padding: '0.6rem 1.2rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', minHeight: '44px' }}
                            >
                                {locale === 'es' ? 'Cerrar' : 'Close'}
                            </button>
                            {sentList.groups.length > 0 && (
                                <button
                                    onClick={handleCompartirLista}
                                    disabled={capturing}
                                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.2rem', background: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: capturing ? 'default' : 'pointer', opacity: capturing ? 0.6 : 1, minHeight: '44px' }}
                                >
                                    <Share2 size={16} />
                                    {capturing
                                        ? (locale === 'es' ? 'Generando imagen…' : 'Generating image…')
                                        : (locale === 'es' ? 'Compartir por WhatsApp' : 'Share via WhatsApp')}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <AddIngredientModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                onSave={handleSaveIngredient}
                initialData={{ providerName: activeTabProviders() }}
            />
        </div>
    );
}
