/**
 * Builds PosItemMapping rows for Toast: which app dish each Toast item is,
 * and which app modifier each protein/seafood Toast modifier is.
 *
 * Read-only toward Toast. Rows an admin set by hand (matchedBy MANUAL) are
 * never touched.
 */
import prisma from '@/lib/prisma';
import { PosSource } from '@prisma/client';
import { fetchToastOrders, toastGet } from '@/lib/toast/client';
import { isProteinModifier, normalize, normalizeDetailed, sameTokens } from '@/lib/posNameMatch';
import { lastToastBusinessDates } from '@/lib/pos/toastBusinessDate';

/** How many past business days of orders are scanned for items no longer on the menu. */
const ORDER_SCAN_DAYS = 14;

export type MappingSeedReport = {
    items: { name: string; guid: string; matchedBy: string; menuItem: string | null; note?: string }[];
    modifiers: { name: string; guid: string; parents: string[]; matchedBy: string; modifier: string | null; note?: string }[];
    keptManual: number;
    upserted: number;
};

/** The key a modifier with no Toast menu item behind it is identified by. */
export function fallbackModifierKey(optionGroupGuid: string | null | undefined, name: string): string {
    return `og:${optionGroupGuid ?? ''}:${normalize(name)}`;
}

/**
 * A modifier row is scoped to the dish it is sold on. Toast reuses one option
 * ("Add Chicken") across several dishes, while the app keeps a separate
 * MenuItemModifier — with its own ingredient amounts — on each dish, so one
 * row per option could only ever point at one of them.
 */
export function modifierMappingKey(modifierKey: string, parentItemGuid: string): string {
    return `${modifierKey}|${parentItemGuid}`;
}

type ToastItem = { guid: string; name: string; groupRefs: number[] };
type ToastModifier = { key: string; name: string; optionGroupGuid: string | null; parentItemGuid: string };

export async function seedToastMappingsCore(): Promise<MappingSeedReport> {
    // ── Toast side: menu, plus recent orders for anything since removed ──
    const menu = await toastGet<any>('/menus/v2/menus');
    const groupRefs: Record<string, any> = menu?.modifierGroupReferences ?? {};
    const optionRefs: Record<string, any> = menu?.modifierOptionReferences ?? {};

    const items = new Map<string, ToastItem>();
    const walk = (groups: any[]) => {
        for (const g of groups ?? []) {
            for (const it of g?.menuItems ?? []) {
                if (typeof it?.guid === 'string') {
                    items.set(it.guid, { guid: it.guid, name: String(it.name ?? ''), groupRefs: it.modifierGroupReferences ?? [] });
                }
            }
            walk(g?.menuGroups);
        }
    };
    for (const m of menu?.menus ?? []) walk(m?.menuGroups);

    const modifiers = new Map<string, ToastModifier>();
    const addModifier = (modKey: string, name: string, optionGroupGuid: string | null, parentGuid: string) => {
        const key = modifierMappingKey(modKey, parentGuid);
        if (!modifiers.has(key)) modifiers.set(key, { key, name, optionGroupGuid, parentItemGuid: parentGuid });
    };
    for (const it of items.values()) {
        for (const ref of it.groupRefs) {
            const group = groupRefs[String(ref)];
            for (const optRef of group?.modifierOptionReferences ?? []) {
                const opt = optionRefs[String(optRef)];
                if (typeof opt?.guid === 'string') addModifier(opt.guid, String(opt.name ?? ''), group?.guid ?? null, it.guid);
            }
        }
    }

    for (const date of lastToastBusinessDates(ORDER_SCAN_DAYS)) {
        const { orders } = await fetchToastOrders(date.replace(/-/g, ''));
        for (const o of orders) for (const c of o?.checks ?? []) for (const s of c?.selections ?? []) {
            const sg = s?.item?.guid;
            if (typeof sg !== 'string') continue;
            if (!items.has(sg)) items.set(sg, { guid: sg, name: String(s.displayName ?? ''), groupRefs: [] });
            const visit = (list: any[]) => {
                for (const m of list ?? []) {
                    const name = String(m?.displayName ?? '');
                    const modKey = typeof m?.item?.guid === 'string'
                        ? m.item.guid
                        : fallbackModifierKey(m?.optionGroup?.guid, name);
                    addModifier(modKey, name, m?.optionGroup?.guid ?? null, sg);
                    visit(m?.modifiers);
                }
            };
            visit(s?.modifiers);
        }
    }

    // ── App side ──
    const [menuItems, existing] = await Promise.all([
        prisma.menuItem.findMany({
            select: { id: true, name: true, nameEn: true, modifiers: { select: { id: true, name: true, menuItemId: true } } }
        }),
        prisma.posItemMapping.findMany({ where: { source: PosSource.TOAST } })
    ]);
    const byNorm = new Map<string, typeof menuItems>();
    for (const mi of menuItems) {
        for (const n of new Set([mi.name, mi.nameEn].filter(Boolean).map(x => normalize(x as string)))) {
            if (!n) continue;
            const list = byNorm.get(n) ?? [];
            if (!list.includes(mi)) list.push(mi);
            byNorm.set(n, list);
        }
    }
    const menuItemById = new Map(menuItems.map(m => [m.id, m]));
    const existingByKey = new Map(existing.map(e => [`${e.kind}|${e.posGuid}`, e]));

    const report: MappingSeedReport = { items: [], modifiers: [], keptManual: 0, upserted: 0 };
    const writes: { kind: string; posGuid: string; data: any }[] = [];
    const itemTarget = new Map<string, string | null>(); // Toast item guid -> menuItemId

    // ── Items ──
    for (const it of items.values()) {
        const prior = existingByKey.get(`ITEM|${it.guid}`);
        if (prior?.matchedBy === 'MANUAL') {
            itemTarget.set(it.guid, prior.menuItemId);
            report.keptManual++;
            report.items.push({ name: it.name, guid: it.guid, matchedBy: 'MANUAL', menuItem: prior.menuItemId ? menuItemById.get(prior.menuItemId)?.name ?? prior.menuItemId : null });
            continue;
        }
        const { name, gfStripped } = normalizeDetailed(it.name);
        const hits = byNorm.get(name) ?? [];
        const match = hits.length === 1 ? hits[0] : null;
        const matchedBy = match ? (gfStripped ? 'NAME_GF' : 'NAME') : 'NONE';
        itemTarget.set(it.guid, match?.id ?? null);
        report.items.push({
            name: it.name, guid: it.guid, matchedBy, menuItem: match?.name ?? null,
            note: hits.length > 1 ? `ambiguo: ${hits.map(h => h.name).join(' / ')}` : undefined
        });
        writes.push({
            kind: 'ITEM', posGuid: it.guid,
            data: { posDisplayName: it.name, optionGroupGuid: null, menuItemId: match?.id ?? null, menuItemModifierId: null, matchedBy }
        });
    }

    // ── Modifiers: protein/seafood only ──
    for (const mod of modifiers.values()) {
        if (!isProteinModifier(mod.name)) continue;
        const parentName = items.get(mod.parentItemGuid)?.name ?? mod.parentItemGuid;
        const displayName = `${mod.name} (${parentName})`;
        const prior = existingByKey.get(`MODIFIER|${mod.key}`);
        if (prior?.matchedBy === 'MANUAL') {
            report.keptManual++;
            report.modifiers.push({ name: mod.name, guid: mod.key, parents: [parentName], matchedBy: 'MANUAL', modifier: prior.menuItemModifierId });
            continue;
        }
        // Candidates: app modifiers on the SAME parent dish with the same tokens.
        const menuItemId = itemTarget.get(mod.parentItemGuid);
        const parent = menuItemId ? menuItemById.get(menuItemId) : undefined;
        const candidates = (parent?.modifiers ?? []).filter(am => sameTokens(am.name, mod.name));
        const only = candidates.length === 1 ? candidates[0] : null;
        const matchedBy = only ? 'NAME' : 'NONE';
        report.modifiers.push({
            name: mod.name, guid: mod.key, parents: [parentName], matchedBy,
            modifier: only ? `${parent!.name} — ${only.name}` : null,
            note: !parent ? 'el plato no está vinculado'
                : candidates.length > 1 ? `varios: ${candidates.map(c => c.name).join(' / ')}` : undefined
        });
        writes.push({
            kind: 'MODIFIER', posGuid: mod.key,
            data: { posDisplayName: displayName, optionGroupGuid: mod.optionGroupGuid, menuItemId: null, menuItemModifierId: only?.id ?? null, matchedBy }
        });
    }

    // One transaction: a failed seed leaves the previous mapping intact. New
    // rows are inserted; existing ones are updated only where matchedBy is not
    // MANUAL, checked in the UPDATE itself so a hand mapping saved while this
    // ran still wins.
    await prisma.$transaction([
        prisma.posItemMapping.createMany({
            data: writes.map(w => ({ source: PosSource.TOAST, kind: w.kind, posGuid: w.posGuid, ...w.data })),
            skipDuplicates: true
        }),
        ...writes.map(w => prisma.posItemMapping.updateMany({
            where: { source: PosSource.TOAST, kind: w.kind, posGuid: w.posGuid, matchedBy: { not: 'MANUAL' } },
            data: w.data
        }))
    ]);
    report.upserted = writes.length;
    return report;
}
