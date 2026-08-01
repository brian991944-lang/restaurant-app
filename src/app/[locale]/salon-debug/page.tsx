'use client';
import { useEffect, useState } from 'react';
import { fetchCloverItemsForSalon } from '@/app/actions/clover';

type Result = Awaited<ReturnType<typeof fetchCloverItemsForSalon>>;

const DRINK_WORDS = ['drink', 'bebida', 'beverage', 'soda', 'refresco'];

export default function SalonDebugPage() {
    const [data, setData] = useState<Result | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetchCloverItemsForSalon()
            .then(r => { if (!cancelled) setData(r); })
            .catch(e => { if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e)); });
        return () => { cancelled = true; };
    }, []);

    if (loadError) return <pre>Fallo al llamar la acción: {loadError}</pre>;
    if (!data) return <pre>Cargando...</pre>;

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

    const lines: string[] = [];
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

    return <pre>{lines.join('\n')}</pre>;
}
