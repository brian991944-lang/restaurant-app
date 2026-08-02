'use client';
import { useEffect, useState } from 'react';
import { fetchCloverItemsForSalon, probeCloverStockEndpoints, probeCloverStockWrite, probeCocaColaStockReads } from '@/app/actions/clover';

type Result = Awaited<ReturnType<typeof fetchCloverItemsForSalon>>;
type Probe = Awaited<ReturnType<typeof probeCloverStockEndpoints>>;
type StockProbe = Awaited<ReturnType<typeof probeCloverStockWrite>>;
type ColaProbe = Awaited<ReturnType<typeof probeCocaColaStockReads>>;

const DRINK_WORDS = ['drink', 'bebida', 'beverage', 'soda', 'refresco'];

export default function SalonDebugPage() {
    const [data, setData] = useState<Result | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [probe, setProbe] = useState<Probe | null>(null);
    const [probeError, setProbeError] = useState<string | null>(null);
    const [stockProbe, setStockProbe] = useState<StockProbe | null>(null);
    const [stockProbeError, setStockProbeError] = useState<string | null>(null);
    const [colaProbe, setColaProbe] = useState<ColaProbe | null>(null);
    const [colaProbeError, setColaProbeError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetchCloverItemsForSalon()
            .then(r => { if (!cancelled) setData(r); })
            .catch(e => { if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e)); });
        probeCloverStockEndpoints()
            .then(r => { if (!cancelled) setProbe(r); })
            .catch(e => { if (!cancelled) setProbeError(e instanceof Error ? e.message : String(e)); });
        probeCloverStockWrite()
            .then(r => { if (!cancelled) setStockProbe(r); })
            .catch(e => { if (!cancelled) setStockProbeError(e instanceof Error ? e.message : String(e)); });
        probeCocaColaStockReads()
            .then(r => { if (!cancelled) setColaProbe(r); })
            .catch(e => { if (!cancelled) setColaProbeError(e instanceof Error ? e.message : String(e)); });
        return () => { cancelled = true; };
    }, []);

    const lines: string[] = [];

    // Sections 1-2 come from fetchCloverItemsForSalon; sections 3-4 from the
    // probe. They are guarded separately so one failing action does not hide
    // the other's output.
    if (loadError) {
        lines.push(`Fallo al llamar fetchCloverItemsForSalon: ${loadError}`);
    } else if (!data) {
        lines.push('Cargando secciones 1-2...');
    } else {
        // Section 1: distinct categoryName with counts, sorted by name, null included.
        const counts = new Map<string | null, number>();
        for (const it of data.items) {
            counts.set(it.categoryName, (counts.get(it.categoryName) ?? 0) + 1);
        }
        const named = [...counts.entries()]
            .filter(([name]) => name !== null)
            .sort((a, b) => (a[0] as string).localeCompare(b[0] as string));
        const nullCount = counts.get(null) ?? 0;

        // Section 2: items in categories whose name matches a drink keyword.
        const drinkItems = data.items.filter(it =>
            it.categoryName !== null &&
            DRINK_WORDS.some(w => it.categoryName!.toLowerCase().includes(w))
        );

        lines.push(`total items: ${data.items.length}`);
        lines.push(`alreadyLinked: ${data.alreadyLinked.length}`);
        if (data.error !== null) lines.push(`error: ${data.error}`);
        lines.push('');
        lines.push('--- SECTION 1: categories ---');
        for (const [name, count] of named) lines.push(`${name}: ${count}`);
        lines.push(`(null): ${nullCount}`);
        lines.push('');
        lines.push('--- SECTION 2: drink-like categories ---');
        if (drinkItems.length === 0) {
            lines.push('(no matching categories)');
        } else {
            for (const it of drinkItems) {
                lines.push(
                    `[${it.categoryName}] id=${it.id} | name=${it.name} | price=${it.price} | ` +
                    `stockCount=${it.stockCount === null ? 'null' : it.stockCount} | ` +
                    `autoManage=${it.autoManage} | available=${it.available}`
                );
            }
        }
    }

    lines.push('');
    if (probeError) {
        lines.push(`Fallo al llamar probeCloverStockEndpoints: ${probeError}`);
    } else if (!probe) {
        lines.push('Cargando secciones 3-4...');
    } else {
        const els = probe.itemStocks?.elements;

        lines.push('--- SECTION 3: GET /item_stocks?limit=100 ---');
        if (probe.itemStocksError !== null) {
            lines.push(probe.itemStocksError);
        } else {
            lines.push(`element count: ${Array.isArray(els) ? els.length : 'no elements array'}`);
            lines.push('first 3 elements:');
            lines.push(JSON.stringify(Array.isArray(els) ? els.slice(0, 3) : probe.itemStocks, null, 2));
        }

        lines.push('');
        lines.push('--- SECTION 4: GET /items/AS7W11RAMW4CW (Inca Kola Diet) ---');
        if (probe.incaKolaDietError !== null) {
            lines.push(probe.incaKolaDietError);
        } else {
            lines.push(JSON.stringify(probe.incaKolaDiet, null, 2));
        }
    }

    lines.push('');
    if (stockProbeError) {
        lines.push(`Fallo al llamar probeCloverStockWrite: ${stockProbeError}`);
    } else if (!stockProbe) {
        lines.push('Cargando sección 5...');
    } else {
        lines.push('--- SECTION 5: estado actual de Inca Kola Diet ---');

        lines.push('GET /item_stocks/AS7W11RAMW4CW:');
        if (stockProbe.itemStockError !== null) {
            lines.push(stockProbe.itemStockError);
        } else {
            lines.push(JSON.stringify(stockProbe.itemStockRaw, null, 2));
        }

        lines.push('');
        lines.push('GET /items/AS7W11RAMW4CW:');
        if (stockProbe.itemError !== null) {
            lines.push(stockProbe.itemError);
        } else {
            lines.push(`stockCount: ${stockProbe.itemStockCount === null ? 'null' : stockProbe.itemStockCount}`);
            lines.push(`available: ${stockProbe.itemAvailable === null ? 'null' : stockProbe.itemAvailable}`);
        }
    }

    lines.push('');
    if (colaProbeError) {
        lines.push(`Fallo al llamar probeCocaColaStockReads: ${colaProbeError}`);
    } else if (!colaProbe) {
        lines.push('Cargando sección 6...');
    } else {
        lines.push('--- SECTION 6: Coca Cola Diet (2JJ8XPD1480JJ), dashboard muestra 44 ---');

        lines.push('(a) GET /item_stocks/2JJ8XPD1480JJ:');
        if (colaProbe.itemStockError !== null) {
            lines.push(colaProbe.itemStockError);
        } else {
            lines.push(JSON.stringify(colaProbe.itemStockRaw, null, 2));
        }

        lines.push('');
        lines.push('(b) GET /items/2JJ8XPD1480JJ:');
        if (colaProbe.itemError !== null) {
            lines.push(colaProbe.itemError);
        } else {
            lines.push(`stockCount: ${colaProbe.itemStockCount === null ? 'null' : colaProbe.itemStockCount}`);
        }

        lines.push('');
        lines.push('(c) GET /items/2JJ8XPD1480JJ?expand=itemStock:');
        if (colaProbe.expandError !== null) {
            lines.push(colaProbe.expandError);
        } else {
            lines.push(JSON.stringify(colaProbe.expandRaw, null, 2));
        }

        // Which read path, if any, actually reports the dashboard number.
        const aCount = colaProbe.itemStockRaw?.stockCount;
        const bCount = colaProbe.itemStockCount;
        const cCount = colaProbe.expandRaw?.itemStock?.stockCount;
        const matches: string[] = [];
        if (aCount === 44) matches.push('(a) /item_stocks');
        if (bCount === 44) matches.push('(b) /items stockCount');
        if (cCount === 44) matches.push('(c) /items?expand=itemStock');

        lines.push('');
        lines.push(`valores leídos -> a: ${aCount ?? 'ausente'} | b: ${bCount ?? 'ausente'} | c: ${cCount ?? 'ausente'}`);
        lines.push(`devuelven 44: ${matches.length > 0 ? matches.join(', ') : 'ninguno'}`);
    }

    return <pre>{lines.join('\n')}</pre>;
}
